import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The Cash Bank Book — the authoritative record of what is in each cash and
 * bank resource.
 *
 * `cash_bank_ledger` is append-only: an entry is never edited and never
 * deleted, because a book that can be rewritten is not evidence of anything. A
 * mistake is corrected by a further entry. `cash_bank_balance` is the running
 * total, written in the same database transaction as the entry that moved it,
 * so a balance read costs one row rather than a scan — and can always be
 * recomputed from the ledger by `rebuildCashBankBalance`.
 *
 * The book is independent by design: it is never a view over journal lines.
 * When the posting engine arrives it calls `recordCashBankEntry` alongside the
 * journal, rather than deriving one from the other.
 */

/** A Prisma client or an interactive transaction — every write here takes one. */
type Db = Prisma.TransactionClient | typeof prisma;

export type CashBankEntryType = "Opening" | "Transaction" | "Adjustment";

export type NewEntry = {
  cashBankId: number;
  /** `YYYY-MM-DD`. */
  date: string;
  type: CashBankEntryType;
  direction: "In" | "Out";
  /** Positive; `direction` carries the sign. */
  amount: number;
  sourceDocTypeId?: number | null;
  sourceDocId?: number | null;
  note?: string | null;
  actorId: number;
};

const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

/** Next book entry number, `CBL-0001`. Documents are numbered `PREFIX-0000`. */
async function nextEntryNo(db: Db): Promise<string> {
  const last = await db.cashBankLedger.findFirst({
    orderBy: { id: "desc" },
    select: { entry_no: true },
  });
  const n = last ? Number(last.entry_no.split("-")[1]) : 0;
  return `CBL-${String((Number.isFinite(n) ? n : 0) + 1).padStart(4, "0")}`;
}

/**
 * Appends one entry and moves the balance with it.
 *
 * Both writes happen inside the caller's transaction, so the book and its total
 * can never disagree: either the entry and the new balance are both there, or
 * neither is.
 */
export async function recordCashBankEntry(db: Db, entry: NewEntry) {
  const amount = Math.abs(entry.amount);
  const movement = entry.direction === "In" ? amount : -amount;

  const current = await db.cashBankBalance.findUnique({
    where: { cash_bank_id: entry.cashBankId },
    select: { balance: true, entry_count: true },
  });
  const before = current ? current.balance.toNumber() : 0;
  const after = before + movement;

  const created = await db.cashBankLedger.create({
    data: {
      entry_no: await nextEntryNo(db),
      cash_bank_id: entry.cashBankId,
      entry_date: asDate(entry.date),
      entry_type: entry.type,
      direction: entry.direction,
      amount,
      movement,
      balance_after: after,
      source_doc_type_id: entry.sourceDocTypeId ?? null,
      source_doc_id: entry.sourceDocId ?? null,
      note: entry.note ?? null,
      created_by: entry.actorId,
    },
  });

  await db.cashBankBalance.upsert({
    where: { cash_bank_id: entry.cashBankId },
    create: {
      cash_bank_id: entry.cashBankId,
      balance: after,
      entry_count: 1,
      last_entry_id: created.id,
      last_entry_date: created.entry_date,
    },
    update: {
      balance: after,
      entry_count: (current?.entry_count ?? 0) + 1,
      last_entry_id: created.id,
      last_entry_date: created.entry_date,
    },
  });

  return created;
}

/**
 * Opens the book for a newly registered resource.
 *
 * A resource always gets a balance row, even at zero, so every Cash & Bank has
 * a book from the moment it exists. A non-zero starting figure is written as an
 * `Opening` entry — it is a movement like any other, and appears in the book
 * rather than sitting in a column nobody can explain.
 */
export async function openCashBankBook(
  db: Db,
  options: { cashBankId: number; openingBalance: number; date: string; actorId: number }
) {
  if (!options.openingBalance) {
    await db.cashBankBalance.create({
      data: { cash_bank_id: options.cashBankId, balance: 0, entry_count: 0 },
    });
    return;
  }

  await recordCashBankEntry(db, {
    cashBankId: options.cashBankId,
    date: options.date,
    type: "Opening",
    direction: options.openingBalance < 0 ? "Out" : "In",
    amount: Math.abs(options.openingBalance),
    note: "Saldo awal saat resource didaftarkan.",
    actorId: options.actorId,
  });
}

/**
 * Recomputes one resource's balance from its entries.
 *
 * The materialised total is a convenience; the ledger is the truth. This is
 * what proves the two agree, and what repairs the total if anything ever writes
 * the balance row on its own.
 */
export async function rebuildCashBankBalance(cashBankId: number): Promise<number> {
  const entries = await prisma.cashBankLedger.findMany({
    where: { cash_bank_id: cashBankId },
    orderBy: { id: "asc" },
    select: { id: true, movement: true, entry_date: true },
  });
  const balance = entries.reduce((t, e) => t + e.movement.toNumber(), 0);
  const last = entries.at(-1) ?? null;

  await prisma.cashBankBalance.upsert({
    where: { cash_bank_id: cashBankId },
    create: {
      cash_bank_id: cashBankId,
      balance,
      entry_count: entries.length,
      last_entry_id: last?.id ?? null,
      last_entry_date: last?.entry_date ?? null,
    },
    update: {
      balance,
      entry_count: entries.length,
      last_entry_id: last?.id ?? null,
      last_entry_date: last?.entry_date ?? null,
    },
  });
  return balance;
}

// ------------------------------------------------------------------- reads

export type CashBankBalanceRow = {
  cashBankId: number;
  label: string;
  name: string;
  companyId: number;
  companyLabel: string;
  currencyId: number;
  currencyLabel: string;
  type: string;
  active: boolean;
  balance: number;
  entries: number;
  lastEntryDate: string | null;
};

export type CashBookSummary = {
  /** Active resources only — an inactive resource is not spendable capacity. */
  resources: number;
  byCurrency: { currencyId: number; currencyLabel: string; balance: number; resources: number }[];
  rows: CashBankBalanceRow[];
};

/**
 * Every active resource's balance, grouped by currency.
 *
 * Balances are reported per currency and never summed across them: converting
 * would need an exchange rate, and there is no authoritative source for one
 * yet. A single fabricated total is worse than four honest ones.
 */
export async function cashBookSummary(): Promise<CashBookSummary> {
  const resources = await prisma.mCashBank.findMany({
    where: { status: "Active" },
    orderBy: [{ company_id: "asc" }, { id: "asc" }],
    select: {
      id: true,
      cash_bank_label: true,
      cash_bank_name: true,
      cash_bank_type: true,
      company_id: true,
      status: true,
      company: { select: { company_label: true } },
      currency: { select: { id: true, currency_label: true } },
      book_balance: { select: { balance: true, entry_count: true, last_entry_date: true } },
    },
  });

  const rows: CashBankBalanceRow[] = resources.map((r) => ({
    cashBankId: r.id,
    label: r.cash_bank_label,
    name: r.cash_bank_name,
    companyId: r.company_id,
    companyLabel: r.company.company_label,
    currencyId: r.currency.id,
    currencyLabel: r.currency.currency_label,
    type: r.cash_bank_type,
    active: r.status === "Active",
    balance: r.book_balance?.balance.toNumber() ?? 0,
    entries: r.book_balance?.entry_count ?? 0,
    lastEntryDate: r.book_balance?.last_entry_date
      ? r.book_balance.last_entry_date.toISOString().slice(0, 10)
      : null,
  }));

  const byCurrency = new Map<
    number,
    { currencyId: number; currencyLabel: string; balance: number; resources: number }
  >();
  for (const r of rows) {
    const acc = byCurrency.get(r.currencyId) ?? {
      currencyId: r.currencyId,
      currencyLabel: r.currencyLabel,
      balance: 0,
      resources: 0,
    };
    acc.balance += r.balance;
    acc.resources += 1;
    byCurrency.set(r.currencyId, acc);
  }

  return {
    resources: rows.length,
    byCurrency: [...byCurrency.values()].sort((a, b) =>
      a.currencyLabel.localeCompare(b.currencyLabel)
    ),
    rows,
  };
}

/** Balance per resource id, for list columns. */
export async function cashBankBalanceMap(): Promise<Map<number, number>> {
  const rows = await prisma.cashBankBalance.findMany({
    select: { cash_bank_id: true, balance: true },
  });
  return new Map(rows.map((r) => [r.cash_bank_id, r.balance.toNumber()]));
}

export type LedgerEntryRow = {
  id: number;
  entryNo: string;
  date: string;
  type: string;
  direction: string;
  amount: number;
  movement: number;
  balanceAfter: number;
  note: string | null;
};

/** One resource's book, newest first. */
export async function cashBankLedger(
  cashBankId: number,
  take = 50
): Promise<LedgerEntryRow[]> {
  const rows = await prisma.cashBankLedger.findMany({
    where: { cash_bank_id: cashBankId },
    orderBy: { id: "desc" },
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    entryNo: r.entry_no,
    date: r.entry_date.toISOString().slice(0, 10),
    type: r.entry_type,
    direction: r.direction,
    amount: r.amount.toNumber(),
    movement: r.movement.toNumber(),
    balanceAfter: r.balance_after.toNumber(),
    note: r.note,
  }));
}
