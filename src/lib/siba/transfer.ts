import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { InsufficientFunds, lockCashBanks, recordCashBankEntry } from "./cash-bank";
import { drawFromLayer, openLayer } from "./cash-bank-layers";
import { BASE_CURRENCY_LABEL, consumesLayer, isBaseCurrency } from "./currency";

import {
  PeriodShut,
  checkTransactionDate,
  holdPostingPeriod,
  todayDay,
} from "./fiscal";
import { roundBase } from "./fx";
import { valueTransferLine } from "./transfer-valuation";
import {
  describeJournalLines,
  postJournal,
  type JournalLineInput,
  type JournalPreviewLine,
} from "./journal";
import { systemAccountId } from "./system-account-data";
import { transferPurposeOf } from "./transfer-catalogue";
import { transferDocTypeId } from "./transfer-rows";


/**
 * Cash Bank Transfer: the Company's own money moving between its own Cash &
 * Bank resources.
 *
 * The header names the **source** and each line names a destination, so one
 * document splits one withdrawal across several accounts. A transfer realizes
 * no Budget, names no Partner and writes no subject book — it is not a business
 * event with a counterparty, it is treasury moving money between pockets. That
 * is why this is its own module with its own tables rather than a third
 * `transaction_type` on `fin_cash_bank_transaction`, whose every line settles a
 * Budget.
 *
 * ## The two rules the arithmetic rests on
 *
 * **Base value is conserved** (CORE multi-currency §5.8, invariant 18): a
 * transfer creates no value, so what the destination receives in base is
 * exactly what the source released — never a product recomputed from a derived
 * rate.
 *
 * **Layers propagate one-for-one** (SIBA multi-currency §6): each line draws
 * its own amount out of the source layer and opens its own layer on the
 * destination. Three destinations therefore create three layers, never one
 * blended one — blending would let an unwanted rate be laundered into a fresh
 * average, which is the whole thing layering exists to prevent.
 *
 * ## The one place a difference can arise
 *
 * **Pencairan alone.** Selling foreign currency resolves two independently
 * determined base values: what the source layer was carried at, and what the
 * bank actually credited at the sale rate. The residual is a realized gain or
 * loss and is the balancing figure of the journal, exactly as it is for a Cash
 * Bank Transaction settling an obligation.
 *
 * A Transfer conserves by construction. A Pembelian Valas is origination —
 * nothing is on the books to disagree with, so the rupiah spent *is* the base
 * value of the currency bought (CLAUDE.md §10 rule 73).
 *
 * Nothing here moves money. Draft is inert; Post is the boundary, and it is one
 * database transaction.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const day = (d: Date): string => d.toISOString().slice(0, 10);

// ------------------------------------------------------------------ posting

export type TransferPostingResult =
  | { ok: true; fxDifference: number; journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/**
 * What one line moves, on both sides of the transfer.
 *
 * `outBase` and `inBase` are two independently determined facts, and on a
 * Pencairan they genuinely differ. Everywhere else they are equal because base
 * value is conserved — which is a property of the arithmetic below, not a rule
 * applied on top of it.
 */
type PlannedLine = {
  toCashBankId: number;
  /** In the document currency. */
  amount: number;
  /** The document-currency-to-base rate recorded on the line. */
  rate: number;
  /** What left the source, in the source's own currency. */
  outAmount: number;
  outBase: number;
  /** What arrived, in the destination's own currency. */
  inAmount: number;
  inBase: number;
  /** The destination's own rate, for its book entry and any layer it opens. */
  inRate: number;
  fxDifference: number;
  /** Whether this line's arrival is foreign currency acquired, so a layer opens. */
  opensLayer: boolean;
};

type TransferPlan = {
  /** What the source gives up, in its own currency, across the whole document. */
  sourceAmount: number;
  sourceBase: number;
  /** The rate the source's own book entry is valued at. */
  sourceRate: number;
  lines: PlannedLine[];
  fxDifference: number;
  fxAccountId: number | null;
};

/**
 * Everything the posting needs to know before it writes anything.
 *
 * Three shapes, and the discriminator is always **which side holds foreign
 * currency**, never the Purpose's name — the Purpose has already been checked
 * against the resources by the time this runs.
 *
 *   * The source is foreign (Transfer between foreign accounts, Pencairan).
 *     What it gives up in base is what its layer *releases*, computed per line
 *     by `drawFromLayer` so a layer drawn to nothing releases its remainder
 *     exactly rather than as a recomputed product.
 *   * The source is base. What it gives up in base is simply the rupiah, and
 *     the rate is 1 — which here means what it always should: the money is
 *     already the measure.
 *   * The destination is foreign (Transfer between foreign accounts, Pembelian
 *     Valas). It acquires currency, so it opens a layer of its own.
 *
 * The layer draws happen inside the caller's transaction, which is why this
 * takes `db` rather than reading `prisma` — a plan that spent a layer and then
 * failed to write the journal would leave the source short.
 */
async function planTransfer(
  db: Db,
  doc: {
    id: number;
    company_id: number;
    purpose: string;
    from_cash_bank_id: number;
    cash_bank_layer_id: number | null;
    currency: { currency_label: string };
    from_cash_bank: { currency: { currency_label: string } };
    lines: {
      to_cash_bank_id: number;
      amount: { toNumber(): number };
      exchange_rate: { toNumber(): number };
      to_cash_bank: { currency: { currency_label: string } };
    }[];
  },
  date: string,
  actorId: number
): Promise<{ ok: true; plan: TransferPlan } | { ok: false; errors: Record<string, string> }> {
  const documentCurrency = doc.currency.currency_label;
  const sourceCurrency = doc.from_cash_bank.currency.currency_label;
  const sourceIsBase = isBaseCurrency(sourceCurrency);
  const drawsLayer = consumesLayer("Out", documentCurrency, sourceCurrency);

  if (drawsLayer && !doc.cash_bank_layer_id) {
    return {
      ok: false,
      errors: {
        cash_bank_layer_id:
          "Pilih layer kurs yang dipakai. Satu transfer memakai tepat satu layer.",
      },
    };
  }

  const planned: PlannedLine[] = [];
  let sourceAmount = 0;
  let sourceBase = 0;
  /**
   * The rate the source's own book entry is valued at: the layer's where one
   * is drawn, and 1 where the source holds rupiah — which here means what it
   * always should, that the money is already the measure.
   */
  let sourceRate = 1;

  for (const line of doc.lines) {
    const amount = line.amount.toNumber();
    const rate = line.exchange_rate.toNumber();
    const destinationIsBase = isBaseCurrency(
      line.to_cash_bank.currency.currency_label
    );

    // The layer is drawn per line, which is what makes layers propagate
    // one-for-one: each destination layer is the relief of the source layer
    // for its own amount. `drawFromLayer` throws on a layer another document
    // has since spent, and a throw here takes the whole posting down.
    let releasedBase: number | undefined;
    if (drawsLayer) {
      const drawn = await drawFromLayer(db, {
        layerId: doc.cash_bank_layer_id!,
        cashBankId: doc.from_cash_bank_id,
        foreign: amount,
        date,
        actorId,
      });
      releasedBase = drawn.base;
      // Read from the draw rather than from the line, so a rate written when
      // the document was drafted cannot outvote the layer the posting actually
      // consumed.
      sourceRate = drawn.rate;
    }

    const valued = valueTransferLine({
      amount,
      rate,
      sourceIsBase,
      destinationIsBase,
      drawsLayer,
      releasedBase,
      layerRate: sourceRate,
    });

    sourceAmount = roundBase(sourceAmount + valued.outAmount);
    sourceBase = roundBase(sourceBase + valued.outBase);

    planned.push({
      toCashBankId: line.to_cash_bank_id,
      amount,
      rate,
      ...valued,
    });
  }

  const fxDifference = roundBase(
    planned.reduce((t, l) => t + l.fxDifference, 0)
  );

  // A difference has to land somewhere named. Resolved only when one actually
  // arises, so an ordinary rupiah transfer is never blocked by a setting it
  // does not use.
  let fxAccountId: number | null = null;
  if (fxDifference !== 0) {
    const company = await prisma.sysCompany.findUnique({
      where: { id: doc.company_id },
      select: { is_parent: true },
    });
    fxAccountId = await systemAccountId(Boolean(company?.is_parent), "fx");
    if (!fxAccountId) {
      return {
        ok: false,
        errors: {
          _form:
            "Selisih kurs muncul pada transfer ini, tetapi Account Selisih Kurs " +
            "belum diatur untuk Company ini. Lengkapi di Accounting › Mapping " +
            "Account System sebelum dokumen diposting.",
        },
      };
    }
  }

  return {
    ok: true,
    plan: { sourceAmount, sourceBase, sourceRate, lines: planned, fxDifference, fxAccountId },
  };
}

/**
 * The accounting entries a transfer produces.
 *
 * One credit for the source, one debit per destination, and — only where the
 * two sides disagree — the Company's FX difference account. Each line carries
 * its own currency and its own rate, because they need not be the same one: a
 * Pencairan produces a foreign credit and a rupiah debit in the same journal,
 * and the entry balances in base alone.
 */
async function transferJournalLines(
  doc: {
    transfer_no: string;
    from_cash_bank_id: number;
    lines: { to_cash_bank_id: number }[];
  },
  plan: TransferPlan,
  label: string
): Promise<
  { ok: true; lines: JournalLineInput[] } | { ok: false; errors: Record<string, string> }
> {
  const ids = [doc.from_cash_bank_id, ...plan.lines.map((l) => l.toCashBankId)];
  const resources = await prisma.mCashBank.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      account_id: true,
      currency_id: true,
      cash_bank_label: true,
    },
  });
  const byId = new Map(resources.map((r) => [r.id, r]));

  const source = byId.get(doc.from_cash_bank_id);
  if (!source) {
    return { ok: false, errors: { _form: "Cash & Bank sumber tidak ditemukan." } };
  }

  const lines: JournalLineInput[] = [
    {
      accountId: source.account_id,
      currencyId: source.currency_id,
      rate: plan.sourceRate,
      debit: 0,
      credit: plan.sourceAmount,
      baseAmount: plan.sourceBase,
      description: `${doc.transfer_no} — ${source.cash_bank_label}`,
    },
  ];

  for (const line of plan.lines) {
    const to = byId.get(line.toCashBankId);
    if (!to) {
      return { ok: false, errors: { _form: "Cash & Bank tujuan tidak ditemukan." } };
    }
    lines.push({
      accountId: to.account_id,
      currencyId: to.currency_id,
      rate: line.inRate,
      debit: line.inAmount,
      credit: 0,
      baseAmount: line.inBase,
      description: `${label} — ${to.cash_bank_label}`,
    });
  }

  // The residual, and only when there is one. Its side is the balancing side,
  // never chosen: selling above the carrying rate gave up less base than was
  // received, which is a gain on the credit side, and a loss sits on the debit
  // side for the mirror reason.
  if (plan.fxDifference !== 0 && plan.fxAccountId) {
    const magnitude = Math.abs(plan.fxDifference);
    const gain = plan.fxDifference > 0;
    const base = await prisma.refCurrency.findFirst({
      where: { currency_label: BASE_CURRENCY_LABEL },
      select: { id: true },
    });
    if (!base) {
      throw new Error(
        `Currency dasar ${BASE_CURRENCY_LABEL} tidak ada pada master. Jalankan db:seed.`
      );
    }
    lines.push({
      accountId: plan.fxAccountId,
      currencyId: base.id,
      rate: 1,
      debit: gain ? 0 : magnitude,
      credit: gain ? magnitude : 0,
      description: `Selisih kurs — ${doc.transfer_no}`,
    });
  }

  return { ok: true, lines };
}

/**
 * Post: the actual boundary, and it is one database transaction.
 *
 * Either all of this happened or none of it did:
 *
 *   1. the source **layer** is drawn down, per line, where one is involved;
 *   2. the source's **Cash Bank Book** entry and its balance — one entry for
 *      the whole document, because the money left once;
 *   3. each destination's book entry and balance;
 *   4. each destination's **rate layer**, where foreign currency arrived;
 *   5. the **Journal**, balanced in base (`postJournal`);
 *   6. what each line was worth on both sides, and the document's own dates.
 *
 * The books are written straight from the document and never derived from a
 * journal line: operational books are independent historical stores, and only
 * the General Ledger derives from journals (concept doc §2.5, §11.7).
 *
 * `recordCashBankEntry` throws on an overdrawn resource, `drawFromLayer` throws
 * on a layer another document has spent since, and `postJournal` throws on an
 * unbalanced journal. All three take the whole posting down rather than being
 * reported and skipped, which is the guarantee.
 *
 * Lives here rather than inside the Server Action so the rule is testable: the
 * action resolves a caller and then calls this, and the test suite calls the
 * same function.
 */
export async function applyTransfer(
  transferId: number,
  actorId: number,
  /**
   * Run the whole posting and roll it back once the journal is known — what
   * the Post confirmation shows. The layers are drawn inside the transaction,
   * so a rolled-back run is the only way to value them exactly as Post will.
   */
  dryRun = false
): Promise<TransferPostingResult> {
  const doc = await prisma.finCashBankTransfer.findUnique({
    where: { id: transferId },
    include: {
      lines: {
        orderBy: { sequence_no: "asc" },
        include: {
          to_cash_bank: { select: { currency: { select: { currency_label: true } } } },
        },
      },
      currency: { select: { currency_label: true } },
      from_cash_bank: {
        select: { currency: { select: { currency_label: true } } },
      },
    },
  });

  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Draft") {
    return {
      ok: false,
      errors: { _form: "Hanya dokumen berstatus Draft yang dapat diposting." },
    };
  }
  if (!doc.lines.length) {
    return {
      ok: false,
      errors: {
        _form: "Tambahkan minimal satu Cash & Bank tujuan sebelum dokumen diposting.",
      },
    };
  }

  // The day this transfer belongs to in the books — chosen on the draft, and
  // possibly earlier than today. Both legs belong to one Company (§10 rule 84),
  // so one check answers for the whole document — asked before the transaction
  // opens, because a refusal in there would have to be raised as a throw and
  // rolled back. Re-checked here rather than trusted from the save: a year can
  // close in between. A draft saved before drafts carried a date posts as today.
  const dated = await checkTransactionDate(
    doc.accounting_date ?? todayDay(),
    [doc.company_id]
  );
  if (!dated.ok) return { ok: false, errors: { _form: dated.message } };
  const date = dated.date;

  const docTypeId = await transferDocTypeId();
  const label = transferPurposeOf(doc.purpose)?.label ?? doc.purpose;
  let fxDifference = 0;

  try {
    await prisma.$transaction(async (tx) => {
      // The year this is dated in, held against a close and re-asked under
      // the hold: the check above was before the transaction opened.
      await holdPostingPeriod(tx, [doc.company_id], date);
      await lockCashBanks(tx, [doc.from_cash_bank_id, ...doc.lines.map((l) => l.to_cash_bank_id)]);

      // The layers are drawn inside the transaction, which is why the plan is
      // built in here rather than before it opens: a plan that spent a layer
      // and then failed would leave the source short.
      const planned = await planTransfer(tx, doc, date, actorId);
      if (!planned.ok) throw new TransferRefused(planned.errors);
      const plan = planned.plan;
      fxDifference = plan.fxDifference;

      const entries = await transferJournalLines(doc, plan, label);
      if (!entries.ok) throw new TransferRefused(entries.errors);

      // The source gives up once, however many destinations there are.
      await recordCashBankEntry(tx, {
        cashBankId: doc.from_cash_bank_id,
        date,
        type: "Transaction",
        direction: "Out",
        amount: plan.sourceAmount,
        rate: plan.sourceRate,
        baseAmount: plan.sourceBase,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        note: `${doc.transfer_no} — ${label}`,
        actorId,
      });
      // Stopped after the source's entry, so the preview is refused exactly
      // where Post would be — on a day the source would go below nothing.
      if (dryRun) throw new TransferDryRun(entries.lines);

      for (const [i, line] of plan.lines.entries()) {
        await recordCashBankEntry(tx, {
          cashBankId: line.toCashBankId,
          date,
          type: "Transaction",
          direction: "In",
          amount: line.inAmount,
          rate: line.inRate,
          baseAmount: line.inBase,
          sourceDocTypeId: docTypeId,
          sourceDocId: doc.id,
          note: `${doc.transfer_no} — ${label}`,
          actorId,
        });

        // Foreign currency arriving is currency acquired, and it acquires a
        // layer of its own — one per line, never merged with an existing one
        // and never blended with its siblings. The base is passed exactly,
        // because it is the base the source released and conservation is the
        // whole point.
        if (line.opensLayer) {
          await openLayer(tx, {
            cashBankId: line.toCashBankId,
            date,
            rate: line.inRate,
            foreign: line.inAmount,
            baseAmount: line.inBase,
            sourceDocTypeId: docTypeId,
            sourceDocId: doc.id,
            note: `${doc.transfer_no} — ${label}`,
            actorId,
          });
        }

        await tx.finCashBankTransferLine.update({
          where: { id: doc.lines[i].id },
          data: {
            out_amount: line.outAmount,
            out_base_amount: line.outBase,
            in_amount: line.inAmount,
            in_base_amount: line.inBase,
            fx_difference: line.fxDifference,
            updated_by: actorId,
          },
        });
      }

      // The Journal is written *alongside* the books, never from them.
      // `postJournal` throws unless the two sides sum equal, and a throw in
      // here takes the whole posting down — which is the guarantee.
      await postJournal(tx, {
        companyId: doc.company_id,
        accountingDate: new Date(`${date}T00:00:00Z`),
        description: `${doc.transfer_no} — ${label}`,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        lines: entries.lines,
        actorId,
      });

      await tx.finCashBankTransfer.update({
        where: { id: transferId },
        data: {
          status: "Posted",
          accounting_date: new Date(`${date}T00:00:00Z`),
          posted_at: new Date(),
          transfer_base_amount: plan.sourceBase,
          updated_by: actorId,
        },
      });
    });
  } catch (error) {
    // A refusal is a decision, not a failure: it is raised as a throw only
    // because it has to roll back the layers already drawn inside the
    // transaction, and it comes back out as the ordinary error shape.
    if (error instanceof PeriodShut || error instanceof InsufficientFunds) {
      return { ok: false, errors: { _form: error.message } };
    }
    if (error instanceof TransferDryRun) {
      return { ok: true, fxDifference, journal: error.lines };
    }
    if (error instanceof TransferRefused) {
      return { ok: false, errors: error.errors };
    }
    throw error;
  }

  return { ok: true, fxDifference };
}

/**
 * A posting refused after the transaction had already opened.
 *
 * Everything a Cash Bank Transaction checks is resolved *before* its
 * transaction opens, which is the better shape. A transfer cannot do that
 * entirely: what its layer releases is known only by drawing it, and drawing it
 * is a write. So the refusals that depend on the draw are thrown and converted
 * back, and the rollback is what makes the draw safe.
 */
class TransferRefused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("Transfer ditolak");
    this.name = "TransferRefused";
  }
}

/** Carries a dry run's journal out of the transaction it rolls back. */
class TransferDryRun extends Error {
  constructor(readonly lines: JournalLineInput[]) {
    super("Pratinjau transfer");
    this.name = "TransferDryRun";
  }
}

/** The journal Post would write for this transfer, or its refusal. Writes nothing. */
export async function previewTransfer(
  transferId: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const result = await applyTransfer(transferId, 0, true);
  if (!result.ok) return result;
  return { ok: true, lines: await describeJournalLines(result.journal ?? []) };
}

/** Document numbers by id, for a book report to name the document an entry came from. */
export async function documentNumbers(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.finCashBankTransfer.findMany({ where: { id: { in: ids } }, select: { id: true, transfer_no: true } });
  return new Map(rows.map((r) => [r.id, r.transfer_no]));
}
