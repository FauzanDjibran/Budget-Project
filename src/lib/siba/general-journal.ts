import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { LEDGER_TEXT } from "./account-code";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import {
  PeriodShut,
  checkTransactionDate,
  holdPostingPeriod,
  todayDay,
} from "./fiscal";
import {
  adapterFor,
  type AdapterAccount,
  type AdapterLine,
  type LedgerAdapter,
} from "./general-journal-ledgers";
import { InsufficientFunds } from "./cash-bank";
import { LayerNotAvailable } from "./cash-bank-layers";
import { SubledgerItemUnavailable } from "./subledger";
import { isBalanced, valueGeneralJournal } from "./general-journal-valuation";
import {
  JournalImbalance,
  describeJournalLines,
  postJournal,
  type JournalLineInput,
  type JournalPreviewLine,
} from "./journal";
import { systemAccountId } from "./system-account-data";

/**
 * Jurnal Umum — one journal for every money ledger (Journal 2.0).
 *
 * A line names an account, and the account names its ledger
 * (`acc_account.ledger`, D18). The ledger's adapter checks what the line must
 * name and, at Post, writes its own book beside the journal, so the General
 * Ledger and the book can never drift apart. Unlike the manual journal it
 * accepts a control account, because the account's ledger then demands its
 * subject (D16).
 *
 * Post writes an ordinary posted `acc_journal` whose lines equal the draft's,
 * the one netted Selisih Kurs line included (D3, D7), and links it in
 * `posted_journal_id`.
 */

type Client = typeof prisma | Prisma.TransactionClient;

export type GeneralJournalHeader = {
  company_id: number | null;
  /** `YYYY-MM-DD`; left out by a caller in code, it is today. */
  journal_date?: string | null;
  description: string;
};

/** One row of the line editor, as the form submits it. */
export type GeneralJournalLineValues = {
  account_id: number | null;
  partner_id: number | null;
  currency_id: number | null;
  /** Null on a base-currency line, where the kurs is 1 and is not asked. */
  exchange_rate: number | null;
  /** In the line's own currency. Exactly one of the two is non-zero. */
  debit: number;
  credit: number;
  description: string;
  /** What the line moves in its ledger: an open item (null for a new one), or a Cash & Bank. */
  subject_id?: number | null;
  /** The book a new item opens in, on a `partner` account keeping several. */
  budget_category_id?: number | null;
  /** The rate layer a foreign Cash & Bank payment draws on. */
  cash_bank_layer_id?: number | null;
  /** Left out by the form; Post passes the stored figure back to be held to it. */
  balance_before?: number | null;
};

/** A line as it is stored and posted, the Selisih line among them. */
type ResolvedLine = JournalLineInput & {
  isGenerated: boolean;
  subjectId: number | null;
  bookId: number | null;
  layerId: number | null;
  balanceBefore: number | null;
};

type Checked = {
  companyId: number;
  date: string;
  description: string;
  lines: ResolvedLine[];
  /** The user's lines with their adapters, for Post's locks and writes. */
  ledgerLines: { adapter: LedgerAdapter; line: AdapterLine; account: AdapterAccount }[];
  balanced: boolean;
  imbalance: string | null;
};

const lineKey = (index: number, field: string) => `lines.${index}.${field}`;

const docDate = (date: string) => new Date(`${date}T00:00:00Z`);

/**
 * The whole document, checked and valued as Post will write it. Reachable from
 * a test, which is why it lives here and not in a Server Action.
 *
 * Like the manual journal, an unbalanced journal is allowed to be saved —
 * the balance is Post's rule — but its imbalance is stated, naming the
 * currency whose amounts do not balance (§4).
 */
export async function checkGeneralJournal(
  header: GeneralJournalHeader,
  lines: GeneralJournalLineValues[]
): Promise<{ ok: true; checked: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const companyId = header.company_id;
  if (!companyId) errors.company_id = "Company wajib dipilih.";
  const description = String(header.description ?? "").trim();
  if (!description) errors.description = "Keterangan wajib diisi.";
  if (lines.length < 2) errors._form = "Journal memerlukan minimal dua baris.";
  if (!companyId || Object.keys(errors).length) return { ok: false, errors };

  const dated = await checkTransactionDate(
    header.journal_date === undefined ? todayDay() : header.journal_date,
    [companyId]
  );
  if (!dated.ok) return { ok: false, errors: { journal_date: dated.message } };

  const ids = <K extends keyof GeneralJournalLineValues>(k: K) =>
    [...new Set(lines.map((l) => l[k]).filter(Boolean))] as number[];
  const [accounts, currencies] = await Promise.all([
    prisma.accAccount.findMany({
      where: { id: { in: ids("account_id") } },
      select: {
        id: true,
        account_label: true,
        company_id: true,
        is_postable: true,
        is_active: true,
        ledger: true,
        partner_category_id: true,
        books: { where: { status: "Active" }, select: { budget_category_id: true } },
        _count: { select: { children: true } },
      },
    }),
    prisma.refCurrency.findMany({
      where: { id: { in: ids("currency_id") } },
      select: { id: true, currency_label: true },
    }),
  ]);
  const accountById = new Map(
    accounts.map((a) => [a.id, { ...a, bookIds: a.books.map((b) => b.budget_category_id) }])
  );
  const currencyById = new Map(currencies.map((c) => [c.id, c]));
  const ctx = { companyId, date: dated.date };

  const resolved: ResolvedLine[] = [];
  const valuation: Parameters<typeof valueGeneralJournal>[0] = [];
  const ledgerLines: Checked["ledgerLines"] = [];

  for (const [i, line] of lines.entries()) {
    const account = line.account_id ? accountById.get(line.account_id) : null;
    if (!account) {
      errors[lineKey(i, "account_id")] = "Account wajib dipilih.";
      continue;
    }
    if (account.company_id !== companyId) {
      errors[lineKey(i, "account_id")] = "Account tersebut milik Company lain.";
      continue;
    }
    if (!account.is_active) {
      errors[lineKey(i, "account_id")] = "Account tersebut non-aktif.";
      continue;
    }
    if (!account.is_postable || account._count.children > 0) {
      errors[lineKey(i, "account_id")] =
        "Account ini adalah header dan tidak menerima posting. Pilih salah satu sub-accountnya.";
      continue;
    }
    const adapter = adapterFor(account.ledger);
    if (adapter === undefined) {
      errors[lineKey(i, "account_id")] =
        `Account ${account.account_label} memakai ledger ${LEDGER_TEXT[account.ledger]}, ` +
        "yang belum dapat ditulis lewat Jurnal Umum.";
      continue;
    }

    const currency = line.currency_id ? currencyById.get(line.currency_id) : null;
    if (!currency) {
      errors[lineKey(i, "currency_id")] = "Currency wajib dipilih.";
      continue;
    }
    const d = Math.max(0, Number(line.debit) || 0);
    const c = Math.max(0, Number(line.credit) || 0);
    const onDebit = Math.round(d * 100) > 0;
    if (onDebit === Math.round(c * 100) > 0) {
      errors[lineKey(i, "amount")] = onDebit
        ? "Isi debit atau kredit, bukan keduanya."
        : "Nominal wajib diisi pada salah satu sisi.";
      continue;
    }

    // A kurs of 1 is right only for base money (CLAUDE.md §10 rule 68). An
    // entry that carries its own kurs overrides the typed one in its adapter.
    const base = isBaseCurrency(currency.currency_label);
    // An account with no ledger takes no Partner and no entry; what the ledger
    // names is the adapter's to check.
    const adapterLine: AdapterLine = {
      accountId: account.id,
      partnerId: adapter ? line.partner_id : null,
      currencyId: currency.id,
      side: onDebit ? "debit" : "credit",
      face: onDebit ? d : c,
      rate: base ? 1 : Number(line.exchange_rate),
      subjectId: adapter ? line.subject_id ?? null : null,
      bookId: adapter ? line.budget_category_id ?? null : null,
      layerId: adapter ? line.cash_bank_layer_id ?? null : null,
      balanceBefore: line.balance_before,
      description: String(line.description ?? "").trim() || description,
    };
    if (adapter) {
      const refused = await adapter.check(adapterLine, account, ctx);
      for (const [field, message] of Object.entries(refused)) {
        errors[lineKey(i, field)] = message;
      }
      if (Object.keys(refused).length) continue;
      ledgerLines.push({ adapter, line: adapterLine, account });
    }
    const rate = adapterLine.rate;
    if (!(rate > 0)) {
      errors[lineKey(i, "exchange_rate")] =
        `Kurs ${currency.currency_label} ke ${BASE_CURRENCY_LABEL} wajib diisi.`;
      continue;
    }

    const debitSide = adapterLine.side === "debit";
    resolved.push({
      accountId: account.id,
      partnerId: adapterLine.partnerId,
      currencyId: currency.id,
      rate,
      debit: debitSide ? adapterLine.face : 0,
      credit: debitSide ? 0 : adapterLine.face,
      description: adapterLine.description,
      isGenerated: false,
      subjectId: adapterLine.subjectId,
      bookId: adapterLine.bookId,
      layerId: adapterLine.layerId,
      balanceBefore: adapterLine.balanceBefore ?? null,
    });
    valuation.push({
      currencyLabel: currency.currency_label,
      isBase: base,
      side: adapterLine.side,
      face: adapterLine.face,
      rate,
      baseAmount: adapterLine.baseAmount,
    });
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const valued = valueGeneralJournal(valuation);
  resolved.forEach((l, i) => (l.baseAmount = valued.bases[i]));

  // The one netted Selisih Kurs line (D7). Its account is resolved only when a
  // difference arises, and a missing one refuses by name.
  if (valued.selisih !== 0) {
    const company = await prisma.sysCompany.findUniqueOrThrow({
      where: { id: companyId },
      select: { is_parent: true },
    });
    const fxAccountId = await systemAccountId(company.is_parent, "fx");
    if (!fxAccountId) {
      return {
        ok: false,
        errors: {
          _form:
            "Selisih kurs muncul pada journal ini, tetapi Account Selisih Kurs belum diatur " +
            "untuk Company ini. Lengkapi di Accounting › Mapping Account System.",
        },
      };
    }
    const baseCurrency = await prisma.refCurrency.findFirstOrThrow({
      where: { currency_label: BASE_CURRENCY_LABEL },
      select: { id: true },
    });
    const amount = Math.abs(valued.selisih);
    resolved.push({
      accountId: fxAccountId,
      partnerId: null,
      currencyId: baseCurrency.id,
      rate: 1,
      debit: valued.selisih > 0 ? amount : 0,
      credit: valued.selisih > 0 ? 0 : amount,
      baseAmount: amount,
      description: "Selisih kurs",
      isGenerated: true,
      subjectId: null,
      bookId: null,
      layerId: null,
      balanceBefore: null,
    });
  }

  const balanced = isBalanced(valued);
  return {
    ok: true,
    checked: {
      companyId,
      date: dated.date,
      description,
      lines: resolved,
      ledgerLines,
      balanced,
      imbalance: balanced
        ? null
        : valued.unbalancedCurrencies.length
          ? `Nominal ${valued.unbalancedCurrencies.join(", ")} tidak seimbang, sehingga journal ` +
            `tidak seimbang dalam ${BASE_CURRENCY_LABEL}.`
          : new JournalImbalance(valued.debit, valued.credit).message,
    },
  };
}

// --------------------------------------------------------------- storage

function lineRows(lines: ResolvedLine[], actorId: number) {
  return lines.map((l, i) => {
    const onDebit = l.debit > 0;
    const base = l.baseAmount ?? 0;
    return {
      sequence_no: i + 1,
      account_id: l.accountId,
      partner_id: l.partnerId ?? null,
      currency_id: l.currencyId,
      exchange_rate: l.rate,
      trx_amount: onDebit ? l.debit : l.credit,
      debit_amount: onDebit ? base : 0,
      kredit_amount: onDebit ? 0 : base,
      description: l.description,
      is_generated: l.isGenerated,
      subject_id: l.subjectId,
      budget_category_id: l.bookId,
      cash_bank_layer_id: l.layerId,
      balance_before: l.balanceBefore,
      created_by: actorId,
    };
  });
}

async function nextNumber(tx: Client): Promise<string> {
  return nextDocumentNumber("JUM", async () => {
    const row = await tx.accGeneralJournal.findFirst({
      where: { journal_no: { startsWith: "JUM-" } },
      orderBy: { id: "desc" },
      select: { journal_no: true },
    });
    return row?.journal_no ?? null;
  });
}

async function audit(tx: Client, rowId: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await tx.auditLog.create({
    data: { entity_key: "acc_general_journal", row_id: rowId, action, event, by },
  });
}

export type GeneralJournalResult =
  | { ok: true; id: number; journalNo: string }
  | { ok: false; errors: Record<string, string> };

/** A draft, `JUM-0001`, holding the figures Post will write. */
export async function createGeneralJournal(
  header: GeneralJournalHeader,
  lines: GeneralJournalLineValues[],
  actorId: number
): Promise<GeneralJournalResult> {
  const result = await checkGeneralJournal(header, lines);
  if (!result.ok) return result;
  const c = result.checked;

  return prisma.$transaction(async (tx) => {
    const journal = await tx.accGeneralJournal.create({
      data: {
        journal_no: await nextNumber(tx),
        accounting_date: docDate(c.date),
        posted_at: null,
        company_id: c.companyId,
        description: c.description,
        status: "Draft",
        created_by: actorId,
        lines: { create: lineRows(c.lines, actorId) },
      },
      select: { id: true, journal_no: true },
    });
    await audit(tx, journal.id, "TAMBAH", "create", actorId);
    return { ok: true as const, id: journal.id, journalNo: journal.journal_no };
  });
}

/** Replaces a draft's content; a draft's lines are content, not history. */
export async function updateGeneralJournal(
  id: number,
  header: GeneralJournalHeader,
  lines: GeneralJournalLineValues[],
  actorId: number,
  companyIds: number[]
): Promise<GeneralJournalResult> {
  const existing = await draftOrRefusal(id, companyIds);
  if ("errors" in existing) return { ok: false, errors: existing.errors };
  const result = await checkGeneralJournal(header, lines);
  if (!result.ok) return result;
  const c = result.checked;

  await prisma.$transaction(async (tx) => {
    await tx.accGeneralJournalLine.deleteMany({ where: { journal_id: id } });
    await tx.accGeneralJournal.update({
      where: { id },
      data: {
        company_id: c.companyId,
        accounting_date: docDate(c.date),
        description: c.description,
        updated_by: actorId,
        lines: { create: lineRows(c.lines, actorId) },
      },
    });
    await audit(tx, id, "UPDATE", "update", actorId);
  });
  return { ok: true, id, journalNo: existing.journalNo };
}

class DryRun extends Error {}

/**
 * Post, in one transaction (§3.5): the period held, every ledger's locks taken
 * in rank and key order, each adapter's book written, then the `acc_journal`
 * whose lines equal the draft's. Everything is re-checked first, never
 * trusted from the draft. A dry run does the same and rolls back, which is
 * what the Post confirmation's `JournalPreview` shows.
 */
export async function postGeneralJournal(
  id: number,
  actorId: number,
  companyIds: number[],
  dryRun = false
): Promise<
  | { ok: true; journalNo: string; postedJournalNo: string | null; preview: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const existing = await draftOrRefusal(id, companyIds);
  if ("errors" in existing) return { ok: false, errors: existing.errors };

  const recheck = await checkGeneralJournal(
    { company_id: existing.companyId, journal_date: existing.date, description: existing.description },
    existing.lines
  );
  // Post is pressed from the detail page, so per-line refusals are stated in
  // full rather than keyed to fields nobody is looking at.
  if (!recheck.ok) {
    return { ok: false, errors: { _form: Object.values(recheck.errors).join(" ") } };
  }
  const c = recheck.checked;
  if (!c.balanced) return { ok: false, errors: { _form: c.imbalance ?? "" } };

  const preview = await describeJournalLines(c.lines);
  try {
    const postedJournalNo = await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, [c.companyId], c.date);

      const keys = c.ledgerLines.flatMap(({ adapter, line, account }) =>
        (adapter.lockKeys?.(line, account) ?? []).map((k) => ({ ...k, adapter }))
      );
      keys.sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
      for (const k of keys) await k.adapter.lock?.(tx, k.key);

      const docType = await tx.sysDocType.findFirstOrThrow({
        where: { doc_table: "acc_general_journal" },
        select: { id: true },
      });
      const ctx = {
        companyId: c.companyId,
        date: c.date,
        actorId,
        sourceDocTypeId: docType.id,
        sourceDocId: id,
      };
      for (const { adapter, line, account } of c.ledgerLines) {
        await adapter.write?.(tx, line, account, ctx);
      }

      const posted = await postJournal(tx, {
        companyId: c.companyId,
        description: c.description,
        sourceDocTypeId: docType.id,
        sourceDocId: id,
        lines: c.lines,
        actorId,
        accountingDate: docDate(c.date),
      });

      await tx.accGeneralJournalLine.deleteMany({ where: { journal_id: id } });
      await tx.accGeneralJournal.update({
        where: { id },
        data: {
          status: "Posted",
          accounting_date: docDate(c.date),
          posted_at: new Date(),
          posted_journal_id: posted.id,
          updated_by: actorId,
          lines: { create: lineRows(c.lines, actorId) },
        },
      });
      await audit(tx, id, "UPDATE", "post", actorId);

      if (dryRun) throw new DryRun();
      return posted.journalNo;
    });
    return { ok: true, journalNo: existing.journalNo, postedJournalNo, preview };
  } catch (error) {
    if (error instanceof DryRun) {
      return { ok: true, journalNo: existing.journalNo, postedJournalNo: null, preview };
    }
    if (
      error instanceof PeriodShut ||
      error instanceof SubledgerItemUnavailable ||
      error instanceof InsufficientFunds ||
      error instanceof LayerNotAvailable
    ) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }
}

/** Retires a draft; cancelled, never deleted. */
export async function cancelGeneralJournal(
  id: number,
  actorId: number,
  companyIds: number[]
): Promise<GeneralJournalResult> {
  const existing = await draftOrRefusal(id, companyIds);
  if ("errors" in existing) return { ok: false, errors: existing.errors };
  await prisma.$transaction(async (tx) => {
    await tx.accGeneralJournal.update({
      where: { id },
      data: { status: "Cancelled", updated_by: actorId },
    });
    await audit(tx, id, "UPDATE", "cancel", actorId);
  });
  return { ok: true, id, journalNo: existing.journalNo };
}

/**
 * The draft as the form and the check speak it, or the reason there is none.
 * A journal of a Company the caller may not see reads as not found. The
 * generated Selisih line is left out: every save writes it afresh.
 */
async function draftOrRefusal(
  id: number,
  companyIds: number[]
): Promise<
  | {
      journalNo: string;
      companyId: number;
      date: string;
      description: string;
      lines: GeneralJournalLineValues[];
    }
  | { errors: Record<string, string> }
> {
  const journal = await prisma.accGeneralJournal.findFirst({
    where: { id, company_id: { in: companyIds } },
    include: {
      lines: {
        where: { is_generated: false },
        orderBy: { sequence_no: "asc" },
        include: { currency: { select: { currency_label: true } } },
      },
    },
  });
  if (!journal) return { errors: { _form: "Jurnal Umum tidak ditemukan." } };
  if (journal.status !== "Draft") {
    return {
      errors: {
        _form: "Jurnal Umum hanya dapat diubah selama berstatus Draft. Yang sudah diposting bersifat final.",
      },
    };
  }
  return {
    journalNo: journal.journal_no,
    companyId: journal.company_id,
    date: (journal.accounting_date ?? docDate(todayDay())).toISOString().slice(0, 10),
    description: journal.description,
    lines: journal.lines.map((l) => {
      const onDebit = l.debit_amount.toNumber() > 0;
      return {
        account_id: l.account_id,
        partner_id: l.partner_id,
        currency_id: l.currency_id,
        exchange_rate: isBaseCurrency(l.currency.currency_label) ? null : l.exchange_rate.toNumber(),
        debit: onDebit ? l.trx_amount.toNumber() : 0,
        credit: onDebit ? 0 : l.trx_amount.toNumber(),
        description: l.description,
        subject_id: l.subject_id,
        cash_bank_layer_id: l.cash_bank_layer_id,
        budget_category_id: l.budget_category_id,
        balance_before: l.balance_before?.toNumber() ?? null,
      };
    }),
  };
}

/** Numbers for a set of ids — how another module names a Jurnal Umum. */
export async function generalJournalNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.accGeneralJournal.findMany({
    where: { id: { in: ids } },
    select: { id: true, journal_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.journal_no]));
}
