import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import type { PeriodRange } from "./period";

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

/** Next book entry number, `CBL-0001`. The format lives in `document-number.ts`. */
async function nextEntryNo(db: Db): Promise<string> {
  return nextDocumentNumber("CBL", async () => {
    const row = await db.cashBankLedger.findFirst({
      orderBy: { id: "desc" },
      select: { entry_no: true },
    });
    return row?.entry_no ?? null;
  });
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
 *
 * `companyIds` is the reader's scope, handed in by the page exactly as the
 * report readers take it (CLAUDE.md §12) — a resource belongs to a Company,
 * and a summary that read every resource in the database would state the
 * anak's cash to someone holding only induk access. An empty scope therefore
 * summarises nothing rather than everything.
 */
export async function cashBookSummary(
  companyIds: number[]
): Promise<CashBookSummary> {
  const resources = await prisma.mCashBank.findMany({
    where: { status: "Active", company_id: { in: companyIds } },
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

// ------------------------------------------------------------------ reports
//
// The two Report Views over this book — `Buku Kas & Bank` (every movement of one
// resource in a period) and `Saldo Kas & Bank` (opening, in, out and closing for
// every resource). Both live here because this module owns the book: a balance
// is read through the Cash Bank Book or not at all (CLAUDE.md §9, §12).
//
// The property both must hold is `opening + in - out === closing`. Opening is
// therefore computed the same way `rebuildCashBankBalance` computes a balance —
// by summing `movement` over everything before the period — rather than by
// trusting a stored figure, so the report's own arithmetic is checkable.

/** An inclusive calendar range, `YYYY-MM-DD` at both ends. */
// `PeriodRange` now lives in `./period` — the General Ledger and both report
// routes need the shape and none of them should import the Cash Bank Book for
// it. Not re-exported here on purpose: a re-export would keep the old path
// working and the boundary would quietly stay crossed.

const startOf = (d: string) => new Date(`${d}T00:00:00Z`);

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
  /** The document that caused the movement, for drill-through. Null for an opening. */
  sourceDocTable: string | null;
  sourceDocId: number | null;
  sourceDocNo: string | null;
};

export type LedgerReport = {
  resource: {
    id: number;
    label: string;
    name: string;
    type: string;
    active: boolean;
    companyLabel: string;
    currencyLabel: string;
  };
  range: PeriodRange;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  /** Oldest first — a book reads forward through the period. */
  entries: LedgerEntryRow[];
  /** False when the stored running balance and the summed movements disagree. */
  reconciles: boolean;
};

/**
 * One resource's book over a period.
 *
 * Entries are ordered oldest first, which is how a book is read: the running
 * balance in the last column only means something if the rows above it are what
 * produced it. The balance shown per row is the **stored** `balance_after` —
 * the fact recorded when the entry was written — while the report's own opening
 * and closing are derived from movements, and `reconciles` reports whether the
 * two agree.
 *
 * Entries dated exactly `from` or exactly `to` are inside the period; anything
 * earlier is folded into the opening balance rather than listed.
 *
 * `companyIds` is the reader's Company scope, taken as an argument rather than
 * resolved here (CLAUDE.md §12): a resource outside it reads as **not found**,
 * which is the same answer a resource that does not exist gives. A report must
 * not be a way around the Company permissions the rest of the application
 * enforces.
 */
export async function cashBankLedgerReport(
  cashBankId: number,
  range: PeriodRange,
  companyIds: number[]
): Promise<LedgerReport | null> {
  const resource = await prisma.mCashBank.findFirst({
    where: { id: cashBankId, company_id: { in: companyIds } },
    select: {
      id: true,
      cash_bank_label: true,
      cash_bank_name: true,
      cash_bank_type: true,
      status: true,
      company: { select: { company_label: true } },
      currency: { select: { currency_label: true } },
    },
  });
  if (!resource) return null;

  const [before, rows] = await Promise.all([
    prisma.cashBankLedger.aggregate({
      where: { cash_bank_id: cashBankId, entry_date: { lt: startOf(range.from) } },
      _sum: { movement: true },
    }),
    prisma.cashBankLedger.findMany({
      where: {
        cash_bank_id: cashBankId,
        entry_date: { gte: startOf(range.from), lte: startOf(range.to) },
      },
      orderBy: { id: "asc" },
      include: { source_doc_type: { select: { doc_table: true } } },
    }),
  ]);

  const opening = before._sum.movement?.toNumber() ?? 0;
  let totalIn = 0;
  let totalOut = 0;
  for (const r of rows) {
    if (r.direction === "In") totalIn += r.amount.toNumber();
    else totalOut += r.amount.toNumber();
  }
  const closing = opening + totalIn - totalOut;

  const docNumbers = await sourceDocumentNumbers(rows);

  const entries: LedgerEntryRow[] = rows.map((r) => ({
    id: r.id,
    entryNo: r.entry_no,
    date: r.entry_date.toISOString().slice(0, 10),
    type: r.entry_type,
    direction: r.direction,
    amount: r.amount.toNumber(),
    movement: r.movement.toNumber(),
    balanceAfter: r.balance_after.toNumber(),
    note: r.note,
    sourceDocTable: r.source_doc_type?.doc_table ?? null,
    sourceDocId: r.source_doc_id,
    sourceDocNo: r.source_doc_id ? docNumbers.get(r.source_doc_id) ?? null : null,
  }));

  const last = entries.at(-1);
  return {
    resource: {
      id: resource.id,
      label: resource.cash_bank_label,
      name: resource.cash_bank_name,
      type: resource.cash_bank_type,
      active: resource.status === "Active",
      companyLabel: resource.company.company_label,
      currencyLabel: resource.currency.currency_label,
    },
    range,
    opening,
    totalIn,
    totalOut,
    closing,
    entries,
    reconciles: last ? last.balanceAfter === closing : true,
  };
}

/**
 * Document numbers for the entries that name one, so a row can say which
 * document moved the money rather than only that something did.
 *
 * Only Cash Bank Transactions reach the book today; an entry pointing at any
 * other document type keeps its reference and simply shows no number.
 */
async function sourceDocumentNumbers(
  rows: { source_doc_id: number | null; source_doc_type: { doc_table: string } | null }[]
): Promise<Map<number, string>> {
  const ids = rows
    .filter((r) => r.source_doc_type?.doc_table === "fin_cash_bank_transaction")
    .map((r) => r.source_doc_id)
    .filter((id): id is number => id !== null);
  if (!ids.length) return new Map();

  const docs = await prisma.finCashBankTransaction.findMany({
    where: { id: { in: ids } },
    select: { id: true, transaction_no: true },
  });
  return new Map(docs.map((d) => [d.id, d.transaction_no]));
}

export type BalanceReportRow = {
  cashBankId: number;
  label: string;
  name: string;
  type: string;
  active: boolean;
  companyLabel: string;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  /** Whether anything at all happened to this resource inside the period. */
  moved: boolean;
};

export type BalanceReportGroup = {
  currencyId: number;
  currencyLabel: string;
  rows: BalanceReportRow[];
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
};

export type BalanceReport = {
  range: PeriodRange;
  groups: BalanceReportGroup[];
  resources: number;
};

/**
 * Opening, movement and closing for every resource over a period.
 *
 * Grouped per currency and totalled per currency only: adding a USD balance to
 * an IDR one would need an exchange rate the system does not have, so it is
 * never done (CLAUDE.md §12).
 *
 * **Inactive resources are included when they moved.** A resource deactivated
 * during the period still held and moved money inside it, and leaving it out
 * would produce a report that does not reconcile against the ledger it claims
 * to summarise. `cashBookSummary` still excludes them, because that answers a
 * different question — what is spendable now.
 *
 * Scoped to the Companies the reader may see, for the same reason the ledger
 * above is: a report is read-only, not exempt.
 */
export async function cashBankBalanceReport(
  range: PeriodRange,
  companyIds: number[],
  cashBankId?: number | null
): Promise<BalanceReport> {
  const resources = await prisma.mCashBank.findMany({
    where: {
      company_id: { in: companyIds },
      ...(cashBankId ? { id: cashBankId } : {}),
    },
    orderBy: [{ company_id: "asc" }, { cash_bank_label: "asc" }],
    select: {
      id: true,
      cash_bank_label: true,
      cash_bank_name: true,
      cash_bank_type: true,
      status: true,
      company: { select: { company_label: true } },
      currency: { select: { id: true, currency_label: true } },
    },
  });
  if (!resources.length) return { range, groups: [], resources: 0 };

  const ids = resources.map((r) => r.id);

  // Two grouped queries rather than one per resource: opening is everything
  // before the period, movement is the period itself split by direction.
  const [openings, movements] = await Promise.all([
    prisma.cashBankLedger.groupBy({
      by: ["cash_bank_id"],
      where: { cash_bank_id: { in: ids }, entry_date: { lt: startOf(range.from) } },
      _sum: { movement: true },
    }),
    prisma.cashBankLedger.groupBy({
      by: ["cash_bank_id", "direction"],
      where: {
        cash_bank_id: { in: ids },
        entry_date: { gte: startOf(range.from), lte: startOf(range.to) },
      },
      _sum: { amount: true },
    }),
  ]);

  const openingOf = new Map(
    openings.map((o) => [o.cash_bank_id, o._sum.movement?.toNumber() ?? 0])
  );
  const inOf = new Map<number, number>();
  const outOf = new Map<number, number>();
  for (const m of movements) {
    const target = m.direction === "In" ? inOf : outOf;
    target.set(m.cash_bank_id, m._sum.amount?.toNumber() ?? 0);
  }

  const groups = new Map<number, BalanceReportGroup>();
  let counted = 0;

  for (const r of resources) {
    const opening = openingOf.get(r.id) ?? 0;
    const totalIn = inOf.get(r.id) ?? 0;
    const totalOut = outOf.get(r.id) ?? 0;
    const moved = totalIn !== 0 || totalOut !== 0;

    // An inactive resource earns its row only by having something to report.
    if (r.status !== "Active" && !moved && opening === 0) continue;

    const group = groups.get(r.currency.id) ?? {
      currencyId: r.currency.id,
      currencyLabel: r.currency.currency_label,
      rows: [],
      opening: 0,
      totalIn: 0,
      totalOut: 0,
      closing: 0,
    };
    const closing = opening + totalIn - totalOut;
    group.rows.push({
      cashBankId: r.id,
      label: r.cash_bank_label,
      name: r.cash_bank_name,
      type: r.cash_bank_type,
      active: r.status === "Active",
      companyLabel: r.company.company_label,
      opening,
      totalIn,
      totalOut,
      closing,
      moved,
    });
    group.opening += opening;
    group.totalIn += totalIn;
    group.totalOut += totalOut;
    group.closing += closing;
    groups.set(r.currency.id, group);
    counted += 1;
  }

  return {
    range,
    resources: counted,
    groups: [...groups.values()].sort((a, b) =>
      a.currencyLabel.localeCompare(b.currencyLabel)
    ),
  };
}

/** One resource's headline figures, for the Cash & Bank master detail. */
export async function cashBankBookSummary(
  cashBankId: number
): Promise<{ balance: number; entries: number; lastEntryDate: string | null }> {
  const row = await prisma.cashBankBalance.findUnique({
    where: { cash_bank_id: cashBankId },
    select: { balance: true, entry_count: true, last_entry_date: true },
  });
  return {
    balance: row?.balance.toNumber() ?? 0,
    entries: row?.entry_count ?? 0,
    lastEntryDate: row?.last_entry_date
      ? row.last_entry_date.toISOString().slice(0, 10)
      : null,
  };
}
