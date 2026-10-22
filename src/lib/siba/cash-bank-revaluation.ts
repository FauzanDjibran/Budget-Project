import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatMoney, formatRate } from "@/lib/format";
import { recordCashBankEntry } from "./cash-bank";
import {
  LayerNotAvailable,
  collapseLayers,
  layersByIds,
  openLayersFor,
  reconcileLayers,
  type LayerOption,
} from "./cash-bank-layers";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { PeriodShut, checkTransactionDate, holdPostingPeriod, todayDay } from "./fiscal";
import { revalue, roundBase } from "./fx";
import {
  describeJournalLines,
  postJournal,
  type JournalLineInput,
  type JournalPreviewLine,
} from "./journal";
import { REVALUATION_SERIES, type RevaluationStatus } from "./cash-bank-revaluation-workflow";
import { checkSystemAccountValue, systemAccountId } from "./system-account-data";
import { baseCurrencyId } from "./system-settings";

/**
 * Revaluasi Kurs: one foreign Cash & Bank restated at a kurs the user states
 * (SIBA multi-currency §7, KB rate-layers 2.0).
 *
 * **A document of its own, raised by a user.** Nothing raises one
 * automatically — not a period close, not a schedule. It names one resource,
 * a Tanggal Akuntansi and the kurs the user states as current.
 *
 * **Post collapses the layers.** Every open layer of the resource is closed
 * (`ClosedByRevaluation`) and one layer is opened holding the whole foreign
 * balance at the stated kurs, its base `foreign × kurs`. The foreign balance
 * never moves; one base-only Cash Bank Book entry states what the base did,
 * and the journal states it against the Company's Laba/Rugi Revaluasi Kurs
 * account. A difference of nil still collapses the layers and writes neither.
 *
 * **It reads the present.** The layers are taken as they stand when Post
 * runs, whatever the document's date; a document backdated before a
 * revaluation later finds only the layer it left. Accepted, the user's rule.
 *
 * **Final.** No reversal: a wrong kurs is corrected by another revaluation.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const day = (d: Date): string => d.toISOString().slice(0, 10);
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

// --------------------------------------------------------------------- rows

export type RevaluationRow = {
  id: number;
  revaluation_no: string;
  accounting_date: string | null;
  posted_at: string | null;
  company_id: number;
  company_label: string;
  cash_bank_id: number;
  cash_bank_label: string;
  cash_bank_name: string;
  currency_id: number;
  currency_label: string;
  exchange_rate: number;
  foreign_balance: number;
  base_before: number;
  base_after: number;
  /** Signed: positive a gain, negative a loss. */
  fx_difference: number;
  note: string | null;
  status: RevaluationStatus;
  created_by: number;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

/** A layer the document closes (a draft: would close) — oldest first. */
export type RevaluationLayerRow = {
  layerId: number;
  layerNo: string;
  date: string | null;
  rate: number;
  foreign: number;
  base: number;
};

const ROW_INCLUDE = {
  company: { select: { company_label: true } },
  cash_bank: { select: { cash_bank_label: true, cash_bank_name: true } },
  currency: { select: { currency_label: true } },
} as const;

type RevaluationRecord = Prisma.FinCashBankRevaluationGetPayload<{ include: typeof ROW_INCLUDE }>;

function toRow(r: RevaluationRecord): RevaluationRow {
  return {
    id: r.id,
    revaluation_no: r.revaluation_no,
    accounting_date: r.accounting_date ? day(r.accounting_date) : null,
    posted_at: r.posted_at ? r.posted_at.toISOString() : null,
    company_id: r.company_id,
    company_label: r.company.company_label,
    cash_bank_id: r.cash_bank_id,
    cash_bank_label: r.cash_bank.cash_bank_label,
    cash_bank_name: r.cash_bank.cash_bank_name,
    currency_id: r.currency_id,
    currency_label: r.currency.currency_label,
    exchange_rate: r.exchange_rate.toNumber(),
    foreign_balance: r.foreign_balance.toNumber(),
    base_before: r.base_before.toNumber(),
    base_after: r.base_after.toNumber(),
    fx_difference: r.fx_difference.toNumber(),
    note: r.note,
    status: r.status as RevaluationStatus,
    created_by: r.created_by,
    updated_by: r.updated_by,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export async function listRevaluations(companyIds: number[]): Promise<RevaluationRow[]> {
  const rows = await prisma.finCashBankRevaluation.findMany({
    where: { company_id: { in: companyIds } },
    orderBy: [{ id: "desc" }],
    include: ROW_INCLUDE,
  });
  return rows.map(toRow);
}

export async function getRevaluation(id: number): Promise<RevaluationRow | null> {
  const row = await prisma.finCashBankRevaluation.findUnique({
    where: { id },
    include: ROW_INCLUDE,
  });
  return row ? toRow(row) : null;
}

/**
 * The layers a posted revaluation closed, as they stood when it closed them.
 * A draft has none recorded: what it would close is the resource's open
 * layers, which the form reads live.
 */
export async function revaluationClosedLayers(revaluationId: number): Promise<RevaluationLayerRow[]> {
  const rows = await prisma.finCashBankRevaluationLayer.findMany({
    where: { revaluation_id: revaluationId },
    orderBy: { sequence_no: "asc" },
  });
  const layers = await layersByIds(rows.map((r) => r.cash_bank_layer_id));
  return rows.map((r) => ({
    layerId: r.cash_bank_layer_id,
    layerNo: layers.get(r.cash_bank_layer_id)?.layerNo ?? "—",
    date: layers.get(r.cash_bank_layer_id)?.date ?? null,
    rate: r.rate.toNumber(),
    foreign: r.foreign_amount.toNumber(),
    base: r.base_amount.toNumber(),
  }));
}

/** The layer a posted revaluation opened, for the detail screen. */
export async function revaluationOpenedLayerNo(id: number): Promise<string | null> {
  const doc = await prisma.finCashBankRevaluation.findUnique({
    where: { id },
    select: { opened_layer_id: true },
  });
  if (!doc?.opened_layer_id) return null;
  return (await layersByIds([doc.opened_layer_id])).get(doc.opened_layer_id)?.layerNo ?? null;
}

// ----------------------------------------------------------------- doc type

export async function revaluationDocTypeId(): Promise<number> {
  const row = await prisma.sysDocType.findFirstOrThrow({
    where: { doc_table: "fin_cash_bank_revaluation" },
    select: { id: true },
  });
  return row.id;
}

/**
 * Document numbers for a set of ids — how another module names a revaluation
 * it holds a reference to, without reading `fin_cash_bank_revaluation` itself.
 */
export async function revaluationNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.finCashBankRevaluation.findMany({
    where: { id: { in: ids } },
    select: { id: true, revaluation_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.revaluation_no]));
}

/** Next number, `RVK-0001`. */
export async function nextRevaluationNo(db: Db = prisma): Promise<string> {
  return nextDocumentNumber(REVALUATION_SERIES, async () => {
    const row = await db.finCashBankRevaluation.findFirst({
      orderBy: { id: "desc" },
      select: { revaluation_no: true },
    });
    return row?.revaluation_no ?? null;
  });
}

// --------------------------------------------------------------------- refs

export type RevaluationCashBankOption = {
  id: number;
  label: string;
  name: string;
  companyId: number;
  companyLabel: string;
  currencyId: number;
  currencyLabel: string;
  /** The open layers, oldest first — what Post would close now. */
  layers: LayerOption[];
};

export type RevaluationRefs = {
  cashBanks: RevaluationCashBankOption[];
};

/**
 * The resources a revaluation may name: active, foreign-currency Cash & Bank
 * of the Companies this reader may write for, each with the layers it holds
 * open now. A base-currency resource has nothing to restate.
 */
export async function revaluationRefs(companyIds: number[]): Promise<RevaluationRefs> {
  const resources = await prisma.mCashBank.findMany({
    where: { company_id: { in: companyIds }, status: "Active" },
    orderBy: [{ company_id: "asc" }, { cash_bank_label: "asc" }],
    select: {
      id: true,
      cash_bank_label: true,
      cash_bank_name: true,
      company_id: true,
      currency_id: true,
      company: { select: { company_label: true } },
      currency: { select: { currency_label: true } },
    },
  });
  const foreign = resources.filter((r) => !isBaseCurrency(r.currency.currency_label));
  const layers = await openLayersFor(foreign.map((r) => r.id));
  return {
    cashBanks: foreign.map((r) => ({
      id: r.id,
      label: r.cash_bank_label,
      name: r.cash_bank_name,
      companyId: r.company_id,
      companyLabel: r.company.company_label,
      currencyId: r.currency_id,
      currencyLabel: r.currency.currency_label,
      layers: layers.get(r.id) ?? [],
    })),
  };
}

// ------------------------------------------------------------------- header

export type RevaluationHeader = {
  cash_bank_id: number | null;
  exchange_rate: number | null;
};

export type ResolvedRevaluationHeader = {
  cashBankId: number;
  cashBankLabel: string;
  accountId: number;
  companyId: number;
  companyIsParent: boolean;
  currencyId: number;
  currencyLabel: string;
  rate: number;
};

export type RevaluationHeaderCheck =
  | ({ ok: true } & ResolvedRevaluationHeader)
  | { ok: false; errors: Record<string, string> };

/**
 * The header, checked against every rule at once. The form narrows the
 * picker, but a Server Action is reachable directly with any id — this is
 * what actually enforces it.
 */
export async function checkRevaluationHeader(
  header: RevaluationHeader,
  companyIds: number[]
): Promise<RevaluationHeaderCheck> {
  if (!header.cash_bank_id) {
    return { ok: false, errors: { cash_bank_id: "Cash & Bank wajib dipilih." } };
  }
  const resource = await prisma.mCashBank.findUnique({
    where: { id: header.cash_bank_id },
    select: {
      id: true,
      cash_bank_label: true,
      company_id: true,
      currency_id: true,
      account_id: true,
      status: true,
      company: { select: { is_parent: true } },
      currency: { select: { currency_label: true } },
    },
  });
  if (!resource || !companyIds.includes(resource.company_id)) {
    return { ok: false, errors: { cash_bank_id: "Cash & Bank tidak ditemukan." } };
  }
  if (resource.status !== "Active") {
    return {
      ok: false,
      errors: { cash_bank_id: "Cash & Bank tersebut non-aktif dan tidak dapat direvaluasi." },
    };
  }
  // Rupiah is the measure everything is reported in; restating it is
  // stating that a rupiah is worth a rupiah.
  if (isBaseCurrency(resource.currency.currency_label)) {
    return {
      ok: false,
      errors: {
        cash_bank_id: `Cash & Bank ${BASE_CURRENCY_LABEL} tidak memiliki kurs untuk direvaluasi.`,
      },
    };
  }

  const rate = header.exchange_rate;
  if (rate == null || !Number.isFinite(rate) || !(rate > 0)) {
    return { ok: false, errors: { exchange_rate: "Kurs wajib diisi dan lebih besar dari nol." } };
  }
  // Six decimals is what a kurs holds (CLAUDE.md §9); anything finer would be
  // stored as something other than what was typed.
  if (Math.round(rate * 1e6) / 1e6 !== rate) {
    return { ok: false, errors: { exchange_rate: "Kurs memuat paling banyak enam angka desimal." } };
  }

  return {
    ok: true,
    cashBankId: resource.id,
    cashBankLabel: resource.cash_bank_label,
    accountId: resource.account_id,
    companyId: resource.company_id,
    companyIsParent: resource.company.is_parent,
    currencyId: resource.currency_id,
    currencyLabel: resource.currency.currency_label,
    rate,
  };
}

// ---------------------------------------------------------------- valuation

export type RevaluationValuation = {
  foreign: number;
  baseBefore: number;
  baseAfter: number;
  /** Signed: positive a gain, negative a loss. */
  difference: number;
};

export class RevaluationRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevaluationRefused";
  }
}

/**
 * What a revaluation of this resource at this kurs would write **now**: the
 * open layers summed, and restated. Refused while the resource holds no
 * currency, or while its layers no longer agree with its book — collapsing
 * layers that do not add up to the balance would carry the disagreement into
 * the one layer left, where nothing could show it any more.
 */
export async function valueRevaluation(
  header: ResolvedRevaluationHeader
): Promise<RevaluationValuation> {
  const check = await reconcileLayers(header.cashBankId);
  if (!check.reconciles) {
    throw new RevaluationRefused(
      `Layer kurs ${header.cashBankLabel} tidak cocok dengan Buku Kas & Bank-nya ` +
        `(layer ${formatMoney(check.layerForeign, header.currencyLabel)} / ` +
        `${formatMoney(check.layerBase, BASE_CURRENCY_LABEL)}, buku ` +
        `${formatMoney(check.bookBalance, header.currencyLabel)} / ` +
        `${formatMoney(check.bookBaseBalance, BASE_CURRENCY_LABEL)}). ` +
        "Periksa Posisi Layer Kurs sebelum revaluasi."
    );
  }
  if (!(check.layerForeign > 0)) {
    throw new RevaluationRefused(
      `${header.cashBankLabel} tidak memegang ${header.currencyLabel} saat ini, jadi tidak ada yang direvaluasi.`
    );
  }
  const before = { foreign: roundBase(check.layerForeign), base: roundBase(check.layerBase) };
  const restated = revalue(before, header.rate);
  return {
    foreign: before.foreign,
    baseBefore: before.base,
    baseAfter: restated.balance.base,
    difference: restated.difference.amount,
  };
}

/** A draft's figures, written inside its own save: what Post would write now. */
export async function writeRevaluationDraftValues(
  db: Db,
  id: number,
  valued: RevaluationValuation
): Promise<void> {
  await db.finCashBankRevaluation.update({
    where: { id },
    data: {
      foreign_balance: valued.foreign,
      base_before: valued.baseBefore,
      base_after: valued.baseAfter,
      fx_difference: valued.difference,
    },
  });
}

/** What the book entry, the layer and the journal say about the document. */
export function describeRevaluation(no: string, rate: number, currencyLabel: string): string {
  return `${no} — Revaluasi Kurs ${currencyLabel} @ ${formatRate(rate)}`;
}

// ------------------------------------------------------------------ posting

export type RevaluationPostingResult =
  | { ok: true; valuation: RevaluationValuation; journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/** Carries a dry run's journal out of the transaction it rolls back. */
class RevaluationDryRun extends Error {
  constructor(
    readonly lines: JournalLineInput[],
    readonly valuation: RevaluationValuation
  ) {
    super("Pratinjau revaluasi");
    this.name = "RevaluationDryRun";
  }
}

/**
 * Post: the actual boundary, and one database transaction.
 *
 * Everything that can be decided outside the transaction is decided first —
 * the period, the resource, the accounts — so an ordinary refusal comes back
 * without a transaction ever opening. Inside it the period is held, the open
 * layers are re-read and collapsed under guarded writes, and the book entry,
 * the journal, the closed-layer record and the document's own figures are
 * written together. Either all of it happened or none of it did.
 *
 * Lives here rather than inside the Server Action so the rule is testable.
 */
export async function applyRevaluation(
  revaluationId: number,
  actorId: number,
  /**
   * Run the whole posting and roll it back once the journal is known — what
   * the Post confirmation shows. The layers are collapsed inside the
   * transaction, so a rolled-back run values them exactly as Post will.
   */
  dryRun = false
): Promise<RevaluationPostingResult> {
  const doc = await prisma.finCashBankRevaluation.findUnique({ where: { id: revaluationId } });
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Draft") {
    return { ok: false, errors: { _form: "Hanya dokumen berstatus Draft yang dapat diposting." } };
  }

  // The day this belongs to in the books — chosen on the draft, possibly
  // earlier than today, and re-checked here because a year can close in
  // between.
  const dated = await checkTransactionDate(
    doc.accounting_date ? day(doc.accounting_date) : todayDay(),
    [doc.company_id]
  );
  if (!dated.ok) return { ok: false, errors: { _form: dated.message } };
  const date = dated.date;

  // Re-checked rather than trusted from the draft: the resource may have been
  // deactivated since.
  const header = await checkRevaluationHeader(
    { cash_bank_id: doc.cash_bank_id, exchange_rate: doc.exchange_rate.toNumber() },
    [doc.company_id]
  );
  if (!header.ok) return { ok: false, errors: { _form: Object.values(header.errors)[0] } };

  let preview: RevaluationValuation;
  try {
    preview = await valueRevaluation(header);
  } catch (error) {
    if (error instanceof RevaluationRefused) return { ok: false, errors: { _form: error.message } };
    throw error;
  }

  // The account the difference lands on is resolved only when there is one,
  // so a revaluation that restates nothing is never blocked by a setting it
  // does not use.
  let revaluationAccountId: number | null = null;
  let baseId: number | null = null;
  if (preview.difference !== 0) {
    revaluationAccountId = await systemAccountId(header.companyIsParent, "fx_revaluation");
    const refusal = revaluationAccountId
      ? await checkSystemAccountValue(doc.company_id, "fx_revaluation", revaluationAccountId)
      : "belum diatur";
    if (!revaluationAccountId || refusal) {
      return {
        ok: false,
        errors: {
          _form:
            `Account Laba/Rugi Revaluasi Kurs untuk Company ini ${
              revaluationAccountId ? `tidak dapat dipakai: ${refusal}` : "belum diatur"
            }. Lengkapi di Accounting › Mapping Account System sebelum dokumen diposting.`,
        },
      };
    }
    baseId = await baseCurrencyId();
    if (!baseId) {
      return { ok: false, errors: { _form: `Currency ${BASE_CURRENCY_LABEL} tidak ditemukan.` } };
    }
  }

  const docTypeId = await revaluationDocTypeId();
  const description = describeRevaluation(doc.revaluation_no, header.rate, header.currencyLabel);
  let valuation = preview;

  try {
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, [doc.company_id], date);

      // Read again inside, under guarded writes: a payment drawing on a layer
      // between the preview above and here moves what is collapsed.
      const collapsed = await collapseLayers(tx, {
        cashBankId: header.cashBankId,
        date,
        rate: header.rate,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        note: description,
        actorId,
      });
      const difference = roundBase(collapsed.after.base - collapsed.before.base);
      valuation = {
        foreign: collapsed.before.foreign,
        baseBefore: collapsed.before.base,
        baseAfter: collapsed.after.base,
        difference,
      };

      const journal: JournalLineInput[] = [];
      if (difference !== 0) {
        // If the difference appeared only inside the transaction, the account
        // was never resolved; refuse rather than post somewhere unchecked.
        if (!revaluationAccountId || !baseId) {
          throw new RevaluationRefused(
            "Saldo Cash & Bank berubah saat revaluasi diproses. Muat ulang dan coba lagi."
          );
        }
        const gain = difference > 0;
        const amount = Math.abs(difference);

        // No currency moves: the entry restates base and nothing else.
        await recordCashBankEntry(tx, {
          cashBankId: header.cashBankId,
          date,
          type: "Revaluation",
          direction: gain ? "In" : "Out",
          amount: 0,
          rate: header.rate,
          baseAmount: amount,
          sourceDocTypeId: docTypeId,
          sourceDocId: doc.id,
          note: description,
          actorId,
        });

        // Both lines in base currency: what moved is rupiah value, and a
        // foreign face of nil cannot carry it. Debits first.
        const cashLine: JournalLineInput = {
          accountId: header.accountId,
          currencyId: baseId,
          rate: 1,
          debit: gain ? amount : 0,
          credit: gain ? 0 : amount,
          description,
        };
        const counterLine: JournalLineInput = {
          accountId: revaluationAccountId,
          currencyId: baseId,
          rate: 1,
          debit: gain ? 0 : amount,
          credit: gain ? amount : 0,
          description,
        };
        journal.push(...(gain ? [cashLine, counterLine] : [counterLine, cashLine]));
      }
      if (dryRun) throw new RevaluationDryRun(journal, valuation);

      if (journal.length) {
        await postJournal(tx, {
          companyId: doc.company_id,
          accountingDate: asDate(date),
          description,
          sourceDocTypeId: docTypeId,
          sourceDocId: doc.id,
          lines: journal,
          actorId,
        });
      }

      await tx.finCashBankRevaluationLayer.createMany({
        data: collapsed.closed.map((l, i) => ({
          revaluation_id: doc.id,
          sequence_no: i + 1,
          cash_bank_layer_id: l.id,
          rate: l.rate,
          foreign_amount: l.foreign,
          base_amount: l.base,
          created_by: actorId,
        })),
      });
      await tx.finCashBankRevaluation.update({
        where: { id: doc.id },
        data: {
          status: "Posted",
          accounting_date: asDate(date),
          posted_at: new Date(),
          foreign_balance: valuation.foreign,
          base_before: valuation.baseBefore,
          base_after: valuation.baseAfter,
          fx_difference: valuation.difference,
          opened_layer_id: collapsed.openedLayerId,
          updated_by: actorId,
        },
      });
    });
  } catch (error) {
    if (error instanceof RevaluationDryRun) {
      return { ok: true, valuation: error.valuation, journal: error.lines };
    }
    if (
      error instanceof PeriodShut ||
      error instanceof LayerNotAvailable ||
      error instanceof RevaluationRefused
    ) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }

  return { ok: true, valuation };
}

/** The journal Post would write for this document, or its refusal. Writes nothing. */
export async function previewRevaluation(
  revaluationId: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const result = await applyRevaluation(revaluationId, 0, true);
  if (!result.ok) return result;
  return { ok: true, lines: await describeJournalLines(result.journal ?? []) };
}

// ------------------------------------------------------------------ summary

export type RevaluationSummary = {
  draft: number;
  posted: number;
  cancelled: number;
  /** Posted differences in base — one measure, so they may be added. */
  gain: number;
  loss: number;
};

export function summariseRevaluations(rows: RevaluationRow[]): RevaluationSummary {
  const posted = rows.filter((r) => r.status === "Posted");
  return {
    draft: rows.filter((r) => r.status === "Draft").length,
    posted: posted.length,
    cancelled: rows.filter((r) => r.status === "Cancelled").length,
    gain: roundBase(posted.filter((r) => r.fx_difference > 0).reduce((t, r) => t + r.fx_difference, 0)),
    loss: roundBase(posted.filter((r) => r.fx_difference < 0).reduce((t, r) => t - r.fx_difference, 0)),
  };
}
