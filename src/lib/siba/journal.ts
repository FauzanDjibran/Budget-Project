import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { isBaseCurrency } from "./currency";
import { roundBase } from "./fx";

/**
 * The accounting journal.
 *
 * A journal is *produced by a posting*, and `postJournal` is the only thing
 * that ever produces one. A **posted** journal is immutable: nothing updates,
 * deletes or reverses one, and a correction is a new journal exactly as a
 * corrected document is a new document (concept doc §15).
 *
 * ## Automatic and manual journals
 *
 * Almost every journal here is written *by* a business document being posted —
 * a Cash Bank Transaction, a confirmed Funding Request — and is `Posted` the
 * moment it exists, because it records something that has already happened.
 *
 * A **manual** journal is typed by a person: a depreciation entry, an accrual,
 * a reclassification. It is saved `Draft` first, edited freely while it is one,
 * and reaches `Posted` through `postDraftJournal`, which runs **the same
 * validation** `postJournal` does. A draft is not accounting — it has no
 * posting date, and no report can see it — so the frozen guarantee is unchanged
 * in substance: nothing is in the books until a posting put it there, and once
 * it is there it never moves.
 *
 * Which accounts a manual journal may touch is deliberately **not** decided
 * here. That question needs the Cash Bank Book, the subject books and the
 * System Defaults, and this module imports none of them — it is a book and
 * books depend on nothing (CLAUDE.md §3). `lib/siba/manual-journal.ts` owns
 * those rules and hands this module lines it has already checked.
 *
 * **The journal is measured in base currency.** `debit_amount` and
 * `kredit_amount` are rupiah; `trx_amount`, `currency_id` and `exchange_rate`
 * carry the transaction-currency face of the same line. That is concept doc
 * §16: the operational books keep both measures, and the General Ledger is
 * base.
 *
 * A consequence worth stating plainly: **one journal may now hold lines in two
 * different currencies** — a foreign document paid from a base-currency
 * resource produces exactly that — and it balances only in base. Every journal
 * in this application used to be single-currency, and three places in the code
 * relied on it.
 *
 * **The balance is enforced here and nowhere else.** `postJournal` refuses to
 * write a journal whose base debits and credits differ, and because it is
 * always called inside the posting transaction, a refusal rolls the whole
 * posting back. That is the whole guarantee: if every journal balances, every
 * sum of journals balances, and a trial balance that does not is a system fault
 * rather than a data-entry one.
 *
 * Only the General Ledger reads these lines. The Cash Bank Book and the subject
 * books are written alongside the journal in the same transaction and never
 * derived from it (§2.5, §11.7).
 */

type Client = typeof prisma | Prisma.TransactionClient;

/**
 * One side of one entry. Exactly one of `debit` / `credit` is non-zero.
 *
 * The amounts are in the line's **own currency**; `rate` converts them to base,
 * which is what the journal balances in. A base-currency line passes `1`, and
 * that is the only case where `1` is right.
 */
export type JournalLineInput = {
  accountId: number;
  partnerId?: number | null;
  currencyId: number;
  /** Transaction currency to base. Never defaulted — see `lib/siba/currency.ts`. */
  rate: number;
  debit: number;
  credit: number;
  /**
   * The exact base value, where the caller already knows it and it may differ
   * from the product by a rounding unit — a position relieved to nothing
   * releases its remaining base exactly. Supplied on the same side as the
   * non-zero foreign amount.
   */
  baseAmount?: number;
  description: string;
};

/**
 * Which series a posted journal's number comes from.
 *
 * `JRN` is every journal a business document produced. `CLS` is a fiscal
 * year's closing entry, which is the one journal in the application that is
 * dated anything but today — see `postingDate` below. A manual journal's
 * `JUR` is not here: it is numbered when its draft is created, not when it is
 * posted.
 */
export type JournalSeries = "JRN" | "CLS";

export type JournalInput = {
  companyId: number;
  description: string;
  sourceDocTypeId?: number | null;
  sourceDocId?: number | null;
  lines: JournalLineInput[];
  actorId: number;
  /** Defaults to `JRN` — the series of every journal a document produces. */
  series?: JournalSeries;
  /**
   * The day the journal is dated. Omitted everywhere but a close.
   *
   * A journal records when the books were written, so it is dated the day it
   * was posted and never back-dated. The **one** exception is a fiscal year's
   * closing entry, which belongs to the year it closes and is therefore dated
   * that year's last day: a closing entry dated after the year it closes would
   * fall inside the year it opens, and would be the first thing the new year
   * inherited.
   *
   * That exception is why this field is tied to `series: "CLS"` below rather
   * than simply offered. Nothing else gains a date, and making it
   * unrepresentable is stronger than writing it down.
   */
  postingDate?: Date;
};

/**
 * Money is compared in whole cents.
 *
 * Amounts are `Decimal(18,2)` in the database and JavaScript numbers here, so
 * 0.1 + 0.2 must not be allowed to fail a balance check that is arithmetically
 * sound. Rounding to cents is the same precision the column stores.
 */
const cents = (n: number): number => Math.round(n * 100);

export class JournalImbalance extends Error {
  /** Both figures are in base currency, which is the only measure a journal balances in. */
  constructor(readonly debit: number, readonly credit: number) {
    super(
      `Journal tidak seimbang dalam mata uang dasar: debit ${debit.toFixed(2)} ` +
        `dan kredit ${credit.toFixed(2)}. Posting dibatalkan.`
    );
    this.name = "JournalImbalance";
  }
}

/** A line resolved to both measures, ready to write. */
type ResolvedLine = JournalLineInput & { baseDebit: number; baseCredit: number };

/**
 * Every line valued in base, and the two totals that must agree.
 *
 * The arithmetic of a journal, in one place, so the automatic path and the
 * manual one cannot come to different conclusions about what a balanced
 * journal is. It refuses a line carrying value on both sides or on neither, a
 * negative amount, a rate of zero or less, and a line worth nothing once
 * valued.
 *
 * It does **not** check the balance — `postJournal` and `postDraftJournal` do
 * that, and a manual journal being typed is allowed not to balance yet.
 *
 * Refusals throw rather than returning a result: every caller is either inside
 * `prisma.$transaction`, where a bad journal must take the whole posting down,
 * or has already validated its input, where a throw means a bug rather than a
 * user mistake.
 */
function resolveJournalLines(lines: JournalLineInput[]): {
  resolved: ResolvedLine[];
  debit: number;
  credit: number;
} {
  if (!lines.length) {
    throw new Error("Journal tanpa baris tidak dapat diposting.");
  }

  let debit = 0;
  let credit = 0;
  const resolved: ResolvedLine[] = [];

  for (const [i, line] of lines.entries()) {
    if (line.debit < 0 || line.credit < 0) {
      throw new Error(`Baris journal ${i + 1} memuat nominal negatif.`);
    }
    if (!(line.rate > 0)) {
      throw new Error(
        `Baris journal ${i + 1} memuat kurs yang tidak valid (${line.rate}).`
      );
    }
    const onDebit = cents(line.debit) > 0;
    const onCredit = cents(line.credit) > 0;
    if (onDebit === onCredit) {
      throw new Error(
        `Baris journal ${i + 1} harus mengisi tepat satu sisi, debit atau kredit.`
      );
    }

    // The base value lands on the same side the foreign amount did. A caller
    // that knows the exact figure supplies it; everything else multiplies once.
    const base = line.baseAmount ?? roundBase((onDebit ? line.debit : line.credit) * line.rate);
    if (base <= 0) {
      throw new Error(
        `Baris journal ${i + 1} bernilai nol dalam mata uang dasar dan tidak dapat diposting.`
      );
    }
    const baseDebit = onDebit ? base : 0;
    const baseCredit = onCredit ? base : 0;

    resolved.push({ ...line, baseDebit, baseCredit });
    debit += baseDebit;
    credit += baseCredit;
  }

  return { resolved, debit, credit };
}

/** The line row as it is stored, in both measures. */
function lineData(line: ResolvedLine, sequence: number, actorId: number) {
  return {
    sequence_no: sequence,
    account_id: line.accountId,
    partner_id: line.partnerId ?? null,
    // The transaction-currency face of the line: which currency, how much of
    // it, and what it was worth. The General Ledger reads the base columns;
    // this is what lets a reader see that a rupiah figure came from three
    // hundred dollars.
    currency_id: line.currencyId,
    exchange_rate: line.rate,
    trx_amount: line.debit > 0 ? line.debit : line.credit,
    // Base currency. This is what the journal balances in.
    debit_amount: line.baseDebit,
    kredit_amount: line.baseCredit,
    description: line.description,
    created_by: actorId,
  };
}

/**
 * The day the books were written.
 *
 * A journal is never back-dated: it records when the posting happened, not
 * when somebody decided it should have. That is true of a manual journal too —
 * which is why the date is not a field on its form.
 *
 * The single exception is a fiscal year's closing entry, which belongs to the
 * year it closes and says so through `JournalInput.postingDate`. It is the
 * only journal that may name its own date, and only in the `CLS` series.
 */
function postingDateToday(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
}

/**
 * Writes one balanced journal, or writes nothing.
 *
 * Refuses an empty journal, a structurally impossible line, and — the one that
 * matters — any journal whose two sides do not sum equal **in base currency**.
 *
 * Balancing in base rather than in transaction currency is what lets one
 * journal hold two currencies. It is also the only thing that *can* balance
 * once it does — a USD line and an IDR line have no common measure until both
 * are valued.
 */
export async function postJournal(
  tx: Client,
  input: JournalInput
): Promise<{ id: number; journalNo: string }> {
  const { resolved, debit, credit } = resolveJournalLines(input.lines);
  if (cents(debit) !== cents(credit)) throw new JournalImbalance(debit, credit);

  const series = input.series ?? "JRN";
  if (input.postingDate && series !== "CLS") {
    throw new Error(
      "Hanya journal penutup tahun buku yang boleh diberi tanggal posting sendiri."
    );
  }

  const journal = await tx.accJournal.create({
    data: {
      journal_no: await nextJournalNo(tx, series),
      posting_date: input.postingDate ?? postingDateToday(),
      source_doc_type_id: input.sourceDocTypeId ?? null,
      source_doc_id: input.sourceDocId ?? null,
      company_id: input.companyId,
      description: input.description,
      status: "Posted",
      created_by: input.actorId,
    },
    select: { id: true, journal_no: true },
  });

  for (const [i, line] of resolved.entries()) {
    await tx.accJournalLine.create({
      data: { journal_id: journal.id, ...lineData(line, i + 1, input.actorId) },
    });
  }

  await writeJournalAudit(tx, journal.id, "TAMBAH", "create", input.actorId);

  return { id: journal.id, journalNo: journal.journal_no };
}

// ------------------------------------------------------- the manual journal

/**
 * A manual journal while it is still being written.
 *
 * It carries no posting date and no source document: nobody has posted it, and
 * nothing produced it but the person typing. Its lines are validated
 * individually but are **not** required to balance — a journal halfway through
 * being entered does not, and refusing to save it would mean the balance rule
 * was enforced at the wrong moment.
 */
export type DraftJournalInput = {
  companyId: number;
  description: string;
  lines: JournalLineInput[];
  actorId: number;
};

/** `JUR-0001` — its own series, so a manual journal is one on sight. */
export async function createDraftJournal(
  input: DraftJournalInput
): Promise<{ id: number; journalNo: string }> {
  const { resolved } = resolveJournalLines(input.lines);

  return prisma.$transaction(async (tx) => {
    const journal = await tx.accJournal.create({
      data: {
        journal_no: await nextJournalNo(tx, "JUR"),
        posting_date: null,
        company_id: input.companyId,
        description: input.description,
        status: "Draft",
        is_manual: true,
        created_by: input.actorId,
      },
      select: { id: true, journal_no: true },
    });

    for (const [i, line] of resolved.entries()) {
      await tx.accJournalLine.create({
        data: { journal_id: journal.id, ...lineData(line, i + 1, input.actorId) },
      });
    }

    await writeJournalAudit(tx, journal.id, "TAMBAH", "create", input.actorId);
    return { id: journal.id, journalNo: journal.journal_no };
  });
}

/**
 * Replaces a draft's content.
 *
 * A draft's lines are the document's own content rather than history: nothing
 * has been posted from them and no book refers to them, so replacing them
 * wholesale is what "edit" means here. The no-delete rule protects master data
 * and posted records, and a draft journal line is neither — exactly the
 * reasoning `updateTransaction` already uses for a Draft document's lines.
 */
export async function updateDraftJournal(
  id: number,
  input: DraftJournalInput
): Promise<void> {
  const { resolved } = resolveJournalLines(input.lines);

  await prisma.$transaction(async (tx) => {
    await tx.accJournalLine.deleteMany({ where: { journal_id: id } });
    await tx.accJournal.update({
      where: { id },
      data: {
        company_id: input.companyId,
        description: input.description,
        updated_by: input.actorId,
        lines: {
          create: resolved.map((line, i) =>
            lineData(line, i + 1, input.actorId)
          ),
        },
      },
    });
    await writeJournalAudit(tx, id, "UPDATE", "update", input.actorId);
  });
}

/**
 * Post: the moment a manual journal becomes accounting.
 *
 * It runs the same `resolveJournalLines` an automatic posting does and refuses
 * the same imbalance, then stamps the posting date and flips the status — in
 * one transaction, so a journal is never half-posted. Nothing about the lines
 * changes except their resolved base values being rewritten, which is what
 * makes the posted figures the engine's rather than the form's.
 *
 * Returns a refusal rather than throwing, unlike `postJournal`: this one is
 * called by a Server Action on its own, not from inside somebody else's
 * posting, so an unbalanced journal is a user mistake to report and not a
 * system fault to roll back.
 */
export async function postDraftJournal(
  id: number,
  actorId: number
): Promise<
  { ok: true; journalNo: string } | { ok: false; error: string }
> {
  const journal = await prisma.accJournal.findUnique({
    where: { id },
    include: { lines: { orderBy: { sequence_no: "asc" } } },
  });
  if (!journal) return { ok: false, error: "Journal tidak ditemukan." };
  if (journal.status !== "Draft") {
    return {
      ok: false,
      error: "Hanya journal berstatus Draft yang dapat diposting.",
    };
  }
  if (!journal.lines.length) {
    return {
      ok: false,
      error: "Journal tanpa baris tidak dapat diposting.",
    };
  }

  const { resolved, debit, credit } = resolveJournalLines(
    journal.lines.map((l) => ({
      accountId: l.account_id,
      partnerId: l.partner_id,
      currencyId: l.currency_id,
      rate: l.exchange_rate.toNumber(),
      debit: l.debit_amount.toNumber() > 0 ? l.trx_amount.toNumber() : 0,
      credit: l.kredit_amount.toNumber() > 0 ? l.trx_amount.toNumber() : 0,
      description: l.description,
    }))
  );

  if (cents(debit) !== cents(credit)) {
    return { ok: false, error: new JournalImbalance(debit, credit).message };
  }

  await prisma.$transaction(async (tx) => {
    for (const [i, line] of resolved.entries()) {
      await tx.accJournalLine.update({
        where: { id: journal.lines[i].id },
        data: {
          debit_amount: line.baseDebit,
          kredit_amount: line.baseCredit,
          updated_by: actorId,
        },
      });
    }
    await tx.accJournal.update({
      where: { id },
      data: {
        status: "Posted",
        posting_date: postingDateToday(),
        updated_by: actorId,
      },
    });
    await writeJournalAudit(tx, id, "UPDATE", "post", actorId);
  });

  return { ok: true, journalNo: journal.journal_no };
}

/**
 * Retires a draft that should not exist.
 *
 * Cancelled rather than deleted, like every other document in the application:
 * the number and the reason stay behind. A posted journal is never reachable
 * from here — it is final, and a correction is a new journal.
 */
export async function cancelDraftJournal(
  id: number,
  actorId: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const journal = await prisma.accJournal.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!journal) return { ok: false, error: "Journal tidak ditemukan." };
  if (journal.status !== "Draft") {
    return {
      ok: false,
      error: "Hanya journal berstatus Draft yang dapat dibatalkan.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.accJournal.update({
      where: { id },
      data: { status: "Cancelled", updated_by: actorId },
    });
    await writeJournalAudit(tx, id, "UPDATE", "cancel", actorId);
  });

  return { ok: true };
}

/** One line of a journal, as the module that edits it needs to read it back. */
export type DraftJournalLine = {
  accountId: number;
  partnerId: number | null;
  currencyId: number;
  currencyLabel: string;
  rate: number;
  /** In the line's own currency, on whichever side carried it. */
  debit: number;
  credit: number;
  description: string;
};

export type DraftJournal = {
  id: number;
  journalNo: string;
  companyId: number;
  description: string;
  status: string;
  isManual: boolean;
  lines: DraftJournalLine[];
};

/**
 * A journal read back as editable content rather than as a report.
 *
 * `getJournal` answers "what does this journal say" for a reader; this answers
 * "what is in this journal" for the module that may still change it. It lives
 * here because `acc_journal` is this module's table, and a boundary crossed in
 * one direction becomes a boundary crossed in both.
 *
 * Scoped to the Companies the caller may see, so a journal outside that scope
 * reads as **not found** — the same answer one that does not exist gives.
 */
export async function readDraftJournal(
  id: number,
  companyIds: number[]
): Promise<DraftJournal | null> {
  const journal = await prisma.accJournal.findFirst({
    where: { id, company_id: { in: companyIds } },
    include: {
      lines: {
        orderBy: { sequence_no: "asc" },
        include: { currency: { select: { currency_label: true } } },
      },
    },
  });
  if (!journal) return null;

  return {
    id: journal.id,
    journalNo: journal.journal_no,
    companyId: journal.company_id,
    description: journal.description,
    status: journal.status,
    isManual: journal.is_manual,
    lines: journal.lines.map((l) => ({
      accountId: l.account_id,
      partnerId: l.partner_id,
      currencyId: l.currency_id,
      currencyLabel: l.currency.currency_label,
      rate: l.exchange_rate.toNumber(),
      // The stored amounts are base; `trx_amount` is the line's own currency,
      // which is what an editor puts back in the field.
      debit: l.debit_amount.toNumber() > 0 ? l.trx_amount.toNumber() : 0,
      credit: l.kredit_amount.toNumber() > 0 ? l.trx_amount.toNumber() : 0,
      description: l.description,
    })),
  };
}

/** Every write on a journal leaves the step it was, never a bare "Diubah". */
async function writeJournalAudit(
  tx: Client,
  rowId: number,
  action: "TAMBAH" | "UPDATE",
  event: string,
  by: number
) {
  await tx.auditLog.create({
    data: { entity_key: "acc_journal", row_id: rowId, action, event, by },
  });
}

/**
 * Journal numbers for a set of ids — how another module names a journal it
 * holds a reference to, without reading `acc_journal` itself.
 */
/**
 * How many journal lines an account carries — has it been posted to at all?
 *
 * Asked by the Chart of Accounts before an account is given a sub-account,
 * which revokes its posting privilege: an account that has already been posted
 * to may not become a heading, or the postings already made to it would have
 * no leaf accounting for them. It lives here rather than in the caller because
 * `acc_journal_line` is the Journal's table, and a boundary crossed in one
 * direction becomes a boundary crossed in both.
 *
 * Draft lines count. A manual journal waiting to be posted names this account
 * as somewhere money is about to land, and letting a sub-account appear
 * underneath it in the meantime would make that journal unpostable after the
 * fact — the refusal belongs where it can still be acted on.
 */
export async function journalLineCountForAccount(
  accountId: number
): Promise<number> {
  return prisma.accJournalLine.count({
    where: { account_id: accountId, journal: { status: { not: "Cancelled" } } },
  });
}

export async function journalNumbersByIds(
  ids: number[]
): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.accJournal.findMany({
    where: { id: { in: ids } },
    select: { id: true, journal_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.journal_no]));
}

/**
 * `JRN-0001` for a journal a posting produced, `JUR-0001` for one a person
 * typed, `CLS-0001` for a fiscal year's closing entry — independent series in
 * one table, so which kind of journal a number names is readable without
 * opening it.
 *
 * The highest number is looked up **within the series**: ordering by id alone
 * would hand a `JUR` number back when the newest row happened to be a `JRN`.
 */
async function nextJournalNo(
  tx: Client,
  prefix: JournalSeries | "JUR"
): Promise<string> {
  return nextDocumentNumber(prefix, async () => {
    const row = await tx.accJournal.findFirst({
      where: { journal_no: { startsWith: `${prefix}-` } },
      orderBy: { id: "desc" },
      select: { journal_no: true },
    });
    return row?.journal_no ?? null;
  });
}

// ------------------------------------------------------------------ reading

export type JournalLineRow = {
  id: number;
  sequenceNo: number;
  /** Carried so a draft can be read back into the form that edits it. */
  accountId: number;
  accountLabel: string;
  accountName: string;
  partnerId: number | null;
  partnerLabel: string | null;
  currencyId: number;
  /** The line's transaction currency, which need not be the base currency. */
  currencyLabel: string;
  /** Base currency — what the journal balances in. */
  debit: number;
  credit: number;
  /** The transaction-currency amount, on whichever side carried it. */
  trxAmount: number;
  rate: number;
  /** False where the line is already in base currency and states nothing extra. */
  foreign: boolean;
  description: string;
};

export type JournalRow = {
  id: number;
  journalNo: string;
  /** Null while a manual journal is still a draft: nothing has been posted. */
  postingDate: string | null;
  companyLabel: string;
  companyId: number;
  description: string;
  status: string;
  /** Typed by a person rather than produced by a document being posted. */
  isManual: boolean;
  sourceDocLabel: string | null;
  sourceDocId: number | null;
  debit: number;
  credit: number;
  lineCount: number;
};

export type JournalDetail = JournalRow & { lines: JournalLineRow[] };

const totalOf = (lines: { debit_amount: { toNumber(): number }; kredit_amount: { toNumber(): number } }[]) => ({
  debit: lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0),
  credit: lines.reduce((t, l) => t + l.kredit_amount.toNumber(), 0),
});

/** Journals of the Companies a reader may see, newest first. */
export async function listJournals(companyIds: number[]): Promise<JournalRow[]> {
  const rows = await prisma.accJournal.findMany({
    where: { company_id: { in: companyIds } },
    // Drafts have no posting date, so they sort first on `nulls: "first"` —
    // which is right: an unposted journal is the one somebody still has to act
    // on, and a register that buried it under a year of posted entries would
    // hide the only rows that are anybody's to do something about.
    orderBy: [{ posting_date: { sort: "desc", nulls: "first" } }, { id: "desc" }],
    include: {
      company: { select: { company_label: true } },
      source_doc_type: { select: { doc_label: true } },
      lines: { select: { debit_amount: true, kredit_amount: true } },
    },
  });

  return rows.map((j) => ({
    id: j.id,
    journalNo: j.journal_no,
    postingDate: j.posting_date ? j.posting_date.toISOString() : null,
    companyLabel: j.company.company_label,
    companyId: j.company_id,
    description: j.description,
    status: j.status,
    isManual: j.is_manual,
    sourceDocLabel: j.source_doc_type?.doc_label ?? null,
    sourceDocId: j.source_doc_id,
    lineCount: j.lines.length,
    ...totalOf(j.lines),
  }));
}

export async function getJournal(
  id: number,
  companyIds: number[]
): Promise<JournalDetail | null> {
  const j = await prisma.accJournal.findFirst({
    where: { id, company_id: { in: companyIds } },
    include: {
      company: { select: { company_label: true } },
      source_doc_type: { select: { doc_label: true } },
      lines: {
        orderBy: { sequence_no: "asc" },
        include: {
          account: { select: { account_label: true, account_name: true } },
          partner: { select: { partner_label: true } },
          currency: { select: { currency_label: true } },
        },
      },
    },
  });
  if (!j) return null;

  return {
    id: j.id,
    journalNo: j.journal_no,
    postingDate: j.posting_date ? j.posting_date.toISOString() : null,
    companyLabel: j.company.company_label,
    companyId: j.company_id,
    description: j.description,
    status: j.status,
    isManual: j.is_manual,
    sourceDocLabel: j.source_doc_type?.doc_label ?? null,
    sourceDocId: j.source_doc_id,
    lineCount: j.lines.length,
    ...totalOf(j.lines),
    lines: j.lines.map((l) => ({
      id: l.id,
      sequenceNo: l.sequence_no,
      accountId: l.account_id,
      accountLabel: l.account.account_label,
      accountName: l.account.account_name,
      partnerId: l.partner_id,
      partnerLabel: l.partner?.partner_label ?? null,
      currencyId: l.currency_id,
      currencyLabel: l.currency.currency_label,
      debit: l.debit_amount.toNumber(),
      credit: l.kredit_amount.toNumber(),
      trxAmount: l.trx_amount.toNumber(),
      rate: l.exchange_rate.toNumber(),
      foreign: !isBaseCurrency(l.currency.currency_label),
      description: l.description,
    })),
  };
}

/**
 * Every journal whose two sides disagree, in base currency.
 *
 * `postJournal` makes this impossible, which is exactly why it is worth
 * asking: a non-empty answer means something wrote the tables without going
 * through it, and that is a system fault rather than a bookkeeping one. The
 * Trial Balance says so on its own page.
 *
 * Base is the only measure worth asking in. A journal holding a USD line and
 * an IDR line has no transaction-currency total at all, so the question only
 * means anything once both are valued.
 *
 * **Posted only.** A manual journal halfway through being typed does not
 * balance, and that is not a fault — reporting it here would put a system-fault
 * warning on the Trial Balance for every draft anybody had open.
 */
export async function unbalancedJournals(
  companyIds: number[]
): Promise<{ id: number; journalNo: string; debit: number; credit: number }[]> {
  const rows = await prisma.accJournal.findMany({
    where: { company_id: { in: companyIds }, status: "Posted" },
    select: {
      id: true,
      journal_no: true,
      lines: { select: { debit_amount: true, kredit_amount: true } },
    },
  });

  return rows
    .map((j) => ({ id: j.id, journalNo: j.journal_no, ...totalOf(j.lines) }))
    .filter((j) => cents(j.debit) !== cents(j.credit));
}
