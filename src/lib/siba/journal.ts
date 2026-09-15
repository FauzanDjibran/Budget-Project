import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";

/**
 * The accounting journal.
 *
 * A journal is *produced by* a posting, never drafted towards one: nothing here
 * creates a journal outside the database transaction that posts the business
 * document, and nothing anywhere updates or deletes one. A correction is a new
 * journal, exactly as a corrected document is a new document (concept doc §15).
 *
 * **The balance is enforced here and nowhere else.** `postJournal` refuses to
 * write a journal whose debits and credits differ, and because it is always
 * called inside the posting transaction, a refusal rolls the whole posting
 * back. That is the whole guarantee: if every journal balances, every sum of
 * journals balances, and a trial balance that does not is a system fault
 * rather than a data-entry one.
 *
 * Only the General Ledger reads these lines. The Cash Bank Book — and the
 * subject ledgers when they land — are written alongside the journal in the
 * same transaction and never derived from it (§2.5, §11.7).
 */

type Client = typeof prisma | Prisma.TransactionClient;

/** One side of one entry. Exactly one of `debit` / `credit` is non-zero. */
export type JournalLineInput = {
  accountId: number;
  partnerId?: number | null;
  currencyId: number;
  debit: number;
  credit: number;
  description: string;
};

export type JournalInput = {
  companyId: number;
  description: string;
  sourceDocTypeId?: number | null;
  sourceDocId?: number | null;
  lines: JournalLineInput[];
  actorId: number;
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
  constructor(readonly debit: number, readonly credit: number) {
    super(
      `Journal tidak seimbang: debit ${debit.toFixed(2)} dan kredit ${credit.toFixed(2)}. ` +
        "Posting dibatalkan."
    );
    this.name = "JournalImbalance";
  }
}

/**
 * Writes one balanced journal, or writes nothing.
 *
 * Refuses an empty journal, a line carrying value on both sides or on neither,
 * a negative amount, and — the one that matters — any journal whose two sides
 * do not sum equal. Every refusal throws rather than returning a result,
 * because the caller is inside `prisma.$transaction`: an unbalanced journal
 * must take the posting down with it, not be reported and skipped.
 */
export async function postJournal(
  tx: Client,
  input: JournalInput
): Promise<{ id: number; journalNo: string }> {
  if (!input.lines.length) {
    throw new Error("Journal tanpa baris tidak dapat diposting.");
  }

  let debit = 0;
  let credit = 0;
  for (const [i, line] of input.lines.entries()) {
    if (line.debit < 0 || line.credit < 0) {
      throw new Error(`Baris journal ${i + 1} memuat nominal negatif.`);
    }
    const onDebit = cents(line.debit) > 0;
    const onCredit = cents(line.credit) > 0;
    if (onDebit === onCredit) {
      throw new Error(
        `Baris journal ${i + 1} harus mengisi tepat satu sisi, debit atau kredit.`
      );
    }
    debit += line.debit;
    credit += line.credit;
  }

  if (cents(debit) !== cents(credit)) throw new JournalImbalance(debit, credit);

  // The posting date is the day the books were written. A journal is never
  // back-dated — it records when the posting happened, not when somebody
  // decided it should have.
  const today = new Date().toISOString().slice(0, 10);

  const journal = await tx.accJournal.create({
    data: {
      journal_no: await nextJournalNo(tx),
      posting_date: new Date(`${today}T00:00:00Z`),
      source_doc_type_id: input.sourceDocTypeId ?? null,
      source_doc_id: input.sourceDocId ?? null,
      company_id: input.companyId,
      description: input.description,
      status: "Posted",
      created_by: input.actorId,
    },
    select: { id: true, journal_no: true },
  });

  for (const [i, line] of input.lines.entries()) {
    await tx.accJournalLine.create({
      data: {
        journal_id: journal.id,
        sequence_no: i + 1,
        account_id: line.accountId,
        partner_id: line.partnerId ?? null,
        currency_id: line.currencyId,
        // The identity until a real rate source exists (CLAUDE.md §12).
        exchange_rate: 1,
        debit_amount: line.debit,
        kredit_amount: line.credit,
        trx_amount: line.debit > 0 ? line.debit : line.credit,
        description: line.description,
        created_by: input.actorId,
      },
    });
  }

  await tx.auditLog.create({
    data: {
      entity_key: "acc_journal",
      row_id: journal.id,
      action: "TAMBAH",
      by: input.actorId,
    },
  });

  return { id: journal.id, journalNo: journal.journal_no };
}

/**
 * Journal numbers for a set of ids — how another module names a journal it
 * holds a reference to, without reading `acc_journal` itself.
 */
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

/** `JRN-0001` — the document-number form, not a `<prefix>.<4 digits>` code. */
async function nextJournalNo(tx: Client): Promise<string> {
  return nextDocumentNumber("JRN", async () => {
    const row = await tx.accJournal.findFirst({
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
  accountLabel: string;
  accountName: string;
  partnerLabel: string | null;
  currencyLabel: string;
  debit: number;
  credit: number;
  description: string;
};

export type JournalRow = {
  id: number;
  journalNo: string;
  postingDate: string;
  companyLabel: string;
  description: string;
  status: string;
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
    orderBy: [{ posting_date: "desc" }, { id: "desc" }],
    include: {
      company: { select: { company_label: true } },
      source_doc_type: { select: { doc_label: true } },
      lines: { select: { debit_amount: true, kredit_amount: true } },
    },
  });

  return rows.map((j) => ({
    id: j.id,
    journalNo: j.journal_no,
    postingDate: j.posting_date.toISOString(),
    companyLabel: j.company.company_label,
    description: j.description,
    status: j.status,
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
    postingDate: j.posting_date.toISOString(),
    companyLabel: j.company.company_label,
    description: j.description,
    status: j.status,
    sourceDocLabel: j.source_doc_type?.doc_label ?? null,
    sourceDocId: j.source_doc_id,
    lineCount: j.lines.length,
    ...totalOf(j.lines),
    lines: j.lines.map((l) => ({
      id: l.id,
      sequenceNo: l.sequence_no,
      accountLabel: l.account.account_label,
      accountName: l.account.account_name,
      partnerLabel: l.partner?.partner_label ?? null,
      currencyLabel: l.currency.currency_label,
      debit: l.debit_amount.toNumber(),
      credit: l.kredit_amount.toNumber(),
      description: l.description,
    })),
  };
}

/**
 * Every journal whose two sides disagree.
 *
 * `postJournal` makes this impossible, which is exactly why it is worth
 * asking: a non-empty answer means something wrote the tables without going
 * through it, and that is a system fault rather than a bookkeeping one. The
 * Trial Balance says so on its own page.
 */
export async function unbalancedJournals(
  companyIds: number[]
): Promise<{ id: number; journalNo: string; debit: number; credit: number }[]> {
  const rows = await prisma.accJournal.findMany({
    where: { company_id: { in: companyIds } },
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
