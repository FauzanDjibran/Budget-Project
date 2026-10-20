import "server-only";

import { prisma } from "@/lib/prisma";
import { formatDate, formatNumber } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { openLayer } from "./cash-bank-layers";
import { roundBase } from "./fx";
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

export type CashBankEntryType = "Opening" | "Transaction" | "Adjustment" | "Revaluation";

export type NewEntry = {
  cashBankId: number;
  /** `YYYY-MM-DD`. */
  date: string;
  type: CashBankEntryType;
  direction: "In" | "Out";
  /**
   * Positive; `direction` carries the sign. Nil only on a `Revaluation`,
   * where no currency moves and `baseAmount` is the whole movement.
   */
  amount: number;
  /**
   * The kurs this movement is valued at, converting the resource's own
   * currency to base. Required, and deliberately so: there is no sensible
   * default. `1` is correct only when the resource holds base currency, and
   * defaulting to it for a foreign resource would silently record that a
   * dollar is a rupiah.
   */
  rate: number;
  /**
   * The exact base value, when the caller already knows it.
   *
   * A layer drawn to nothing releases its remaining base *exactly* rather than
   * as a recomputed product, so the figure can differ from `amount × rate` by a
   * rounding unit. The caller passes what it actually released; everything else
   * lets this module multiply.
   */
  baseAmount?: number;
  sourceDocTypeId?: number | null;
  sourceDocId?: number | null;
  note?: string | null;
  actorId: number;
};

const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

/**
 * A movement refused because the resource does not hold enough to make it.
 *
 * Thrown rather than returned, like `JournalImbalance`: every caller is inside
 * the posting transaction, and an overdrawn resource has to take the whole
 * posting down rather than be reported and skipped.
 */
export class InsufficientFunds extends Error {
  constructor(
    readonly cashBankId: number,
    readonly balance: number,
    readonly requested: number,
    /** Where the balance would go below nothing — `dd/mm/yyyy`, or `bulan mm/yyyy`. */
    readonly at: string
  ) {
    super(
      `Saldo Cash & Bank tidak mencukupi pada ${at}: tersedia ${formatNumber(balance)}, dibutuhkan ${formatNumber(requested)}. ` +
        "Transaksi dibatalkan."
    );
    this.name = "InsufficientFunds";
  }
}

const monthOf = (d: string) => asDate(`${d.slice(0, 7)}-01`);
const addMonths = (p: Date, n: number) =>
  new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth() + n, 1));
const cents = (n: number) => Math.round(n * 100);

/**
 * Holds these resources until the transaction ends, in id order so two
 * documents touching the same pair (a transfer A→B beside one B→A) cannot wait
 * on each other. `recordCashBankEntry` takes the same lock for its own
 * resource; a document writing several takes them all first with this. Taken
 * after the period and subject-book locks, never before.
 */
export async function lockCashBanks(db: Db, ids: number[]): Promise<void> {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    const key = `cash_bank:${id}`;
    await db.$queryRaw`SELECT 1 AS held FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS lock`;
  }
}

/**
 * Extends the resource's chain of months to cover `period`: back to it with
 * nothing in them when it is before the first, or forward carrying the last
 * closing when it is after the latest. The chain stays unbroken, so every month
 * from the first entry's to the latest's has a row.
 */
async function ensurePeriod(db: Db, cashBankId: number, period: Date) {
  const [first, last] = await Promise.all([
    db.cashBankPeriod.findFirst({ where: { cash_bank_id: cashBankId }, orderBy: { period: "asc" } }),
    db.cashBankPeriod.findFirst({ where: { cash_bank_id: cashBankId }, orderBy: { period: "desc" } }),
  ]);
  const months = (from: Date, until: Date) => {
    const out: Date[] = [];
    for (let p = from; p < until; p = addMonths(p, 1)) out.push(p);
    return out;
  };
  if (!first || !last) {
    await db.cashBankPeriod.create({ data: { cash_bank_id: cashBankId, period } });
  } else if (period < first.period) {
    await db.cashBankPeriod.createMany({
      data: months(period, first.period).map((p) => ({ cash_bank_id: cashBankId, period: p })),
    });
  } else if (period > last.period) {
    const carried = {
      opening: last.closing,
      closing: last.closing,
      min_balance: last.closing,
      base_opening: last.base_closing,
      base_closing: last.base_closing,
    };
    await db.cashBankPeriod.createMany({
      data: months(addMonths(last.period, 1), addMonths(period, 1)).map((p) => ({
        cash_bank_id: cashBankId,
        period: p,
        ...carried,
      })),
    });
  }
}

/**
 * Checks a movement dated `date` against the balance on every day from then
 * to now, and returns the month's new lowest point (null for a nil movement).
 * Reads one month of entries and one aggregate over the later months — never
 * the book from its start — and writes nothing, so a preview asks the very
 * check a posting does.
 *
 * Within the month the entry is placed last on its day, as the reports order
 * it. Every later month shifts by the whole movement, so its lowest point does
 * too: `min_balance + movement ≥ 0` over them is the whole check.
 */
async function checkMovement(
  db: Db,
  cashBankId: number,
  date: string,
  movement: number
): Promise<number | null> {
  const period = monthOf(date);
  const row = await db.cashBankPeriod.findUnique({
    where: { cash_bank_id_period: { cash_bank_id: cashBankId, period } },
    select: { opening: true },
  });
  // A month outside the chain holds no entries: before the first it opens at
  // nil, after the last at the last closing.
  const opening = row
    ? row.opening.toNumber()
    : ((
        await db.cashBankPeriod.findFirst({
          where: { cash_bank_id: cashBankId, period: { lt: period } },
          orderBy: { period: "desc" },
          select: { closing: true },
        })
      )?.closing.toNumber() ?? 0);

  if (movement === 0) return null;
  const day = asDate(date);
  const entries = await db.cashBankLedger.findMany({
    where: { cash_bank_id: cashBankId, entry_date: { gte: period, lt: addMonths(period, 1) } },
    orderBy: [{ entry_date: "asc" }, { id: "asc" }],
    select: { entry_date: true, movement: true },
  });
  const m = cents(movement);
  let run = cents(opening);
  let min = run;
  // The lowest the balance stood, before this movement, from its day on.
  let lowest: { at: Date; balance: number } | null = null;
  const pass = (at: Date) => {
    if (!lowest || run < lowest.balance) lowest = { at, balance: run };
    min = Math.min(min, run + m);
  };
  let placed = false;
  for (const e of entries) {
    if (!placed && e.entry_date > day) {
      placed = true;
      pass(day);
    }
    run += cents(e.movement.toNumber());
    if (placed) pass(e.entry_date);
    else min = Math.min(min, run);
  }
  if (!placed) pass(day);

  if (m < 0) {
    const found = lowest as { at: Date; balance: number } | null;
    if (found && found.balance + m < 0) {
      throw new InsufficientFunds(cashBankId, found.balance / 100, -movement, formatDate(found.at));
    }
    const later = await db.cashBankPeriod.findFirst({
      where: { cash_bank_id: cashBankId, period: { gt: period } },
      orderBy: [{ min_balance: "asc" }, { period: "asc" }],
      select: { period: true, min_balance: true },
    });
    if (later && cents(later.min_balance.toNumber()) + m < 0) {
      throw new InsufficientFunds(
        cashBankId,
        later.min_balance.toNumber(),
        -movement,
        `bulan ${formatDate(later.period).slice(3)}`
      );
    }
  }
  return min / 100;
}

/**
 * Would paying `amount` out of this resource on `date` take it below nothing on
 * any day since? The posting's own check, asked without a lock or a write, so a
 * Post confirmation can say so before it is pressed. Only an early warning:
 * `recordCashBankEntry` asks again under the lock.
 */
export async function cashBankShortfall(
  cashBankId: number,
  date: string,
  amount: number
): Promise<InsufficientFunds | null> {
  try {
    await checkMovement(prisma, cashBankId, date, -amount);
    return null;
  } catch (error) {
    if (error instanceof InsufficientFunds) return error;
    throw error;
  }
}

/** `checkMovement`, then moves the month chain with it. Throws before writing. */
async function movePeriods(
  db: Db,
  cashBankId: number,
  date: string,
  movement: number,
  baseMovement: number
) {
  const newMin = await checkMovement(db, cashBankId, date, movement);
  const period = monthOf(date);
  await ensurePeriod(db, cashBankId, period);

  const inSide = movement > 0;
  await db.cashBankPeriod.update({
    where: { cash_bank_id_period: { cash_bank_id: cashBankId, period } },
    data: {
      ...(inSide
        ? { total_in: { increment: movement }, base_total_in: { increment: baseMovement } }
        : { total_out: { increment: -movement }, base_total_out: { increment: -baseMovement } }),
      closing: { increment: movement },
      base_closing: { increment: baseMovement },
      ...(newMin === null ? {} : { min_balance: newMin }),
    },
  });
  await db.cashBankPeriod.updateMany({
    where: { cash_bank_id: cashBankId, period: { gt: period } },
    data: {
      opening: { increment: movement },
      closing: { increment: movement },
      min_balance: { increment: movement },
      base_opening: { increment: baseMovement },
      base_closing: { increment: baseMovement },
    },
  });
}

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
  if (!(entry.rate > 0)) {
    throw new Error(
      `Kurs entri Cash Bank Book harus lebih besar dari nol (diterima ${entry.rate}).`
    );
  }

  const amount = Math.abs(entry.amount);
  // A revaluation restates base and moves no currency.
  if (
    entry.type === "Revaluation" &&
    (amount !== 0 || !(entry.baseAmount && entry.baseAmount > 0))
  ) {
    throw new Error("Entri revaluasi hanya menggerakkan nilai base, dan harus menggerakkannya.");
  }
  const base = entry.baseAmount ?? roundBase(amount * entry.rate);
  const sign = entry.direction === "In" ? 1 : -1;
  // `|| 0` keeps a revaluation's nil movement from being stored as -0.
  const movement = sign * amount || 0;
  const baseMovement = sign * base;

  // Held until the transaction ends: the check below reads the month chain and
  // writes it, and two postings on one resource must not both pass on one read.
  await lockCashBanks(db, [entry.cashBankId]);

  // A resource cannot hold less than nothing — on the entry's own date or on
  // any day after it, since a backdated payment lowers every later balance.
  // Throws before anything is written.
  await movePeriods(db, entry.cashBankId, entry.date, movement, baseMovement);

  const current = await db.cashBankBalance.findUnique({
    where: { cash_bank_id: entry.cashBankId },
    select: { balance: true, base_balance: true, entry_count: true },
  });
  const before = current ? current.balance.toNumber() : 0;
  const beforeBase = current ? current.base_balance.toNumber() : 0;
  const after = before + movement;
  const afterBase = roundBase(beforeBase + baseMovement);

  const created = await db.cashBankLedger.create({
    data: {
      entry_no: await nextEntryNo(db),
      cash_bank_id: entry.cashBankId,
      entry_date: asDate(entry.date),
      entry_type: entry.type,
      movement,
      balance_after: after,
      rate: entry.rate,
      base_movement: baseMovement,
      base_balance_after: afterBase,
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
      base_balance: afterBase,
      entry_count: 1,
      last_entry_id: created.id,
      last_entry_date: created.entry_date,
    },
    update: {
      balance: after,
      base_balance: afterBase,
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
  options: {
    cashBankId: number;
    openingBalance: number;
    /** The kurs the opening figure is valued at. `1` for a base-currency resource. */
    rate: number;
    date: string;
    actorId: number;
    /**
     * Whether this resource holds a foreign currency, and therefore keeps rate
     * layers. A non-zero opening balance on one opens its **first layer** at
     * the same kurs as its first book entry — the currency it starts with was
     * acquired at some price, and that price is what a later payment releases.
     *
     * Passed in rather than looked up: the book is a leaf and does not read the
     * master's currency to decide how to behave.
     */
    layered?: boolean;
  }
) {
  // A resource cannot start out owing money. The figure used to accept a
  // negative and write it as an `Out`, which was the one way to reach exactly
  // the state `recordCashBankEntry` now refuses to create.
  if (options.openingBalance < 0) {
    throw new Error(
      "Saldo awal Cash & Bank tidak boleh negatif — sebuah resource tidak dapat " +
        "dibuka dengan saldo minus."
    );
  }

  if (!options.openingBalance) {
    await db.cashBankBalance.create({
      data: {
        cash_bank_id: options.cashBankId,
        balance: 0,
        base_balance: 0,
        entry_count: 0,
      },
    });
    return;
  }

  await recordCashBankEntry(db, {
    cashBankId: options.cashBankId,
    date: options.date,
    type: "Opening",
    direction: "In",
    amount: options.openingBalance,
    rate: options.rate,
    note: "Saldo awal saat resource didaftarkan.",
    actorId: options.actorId,
  });

  // The book entry says the resource holds it; the layer says what it cost.
  // Both, or the account's balance and its layers would disagree from the
  // moment it was registered — which is the one thing `reconcileLayers` exists
  // to catch and the one thing nothing would ever repair.
  if (options.layered) {
    await openLayer(db, {
      cashBankId: options.cashBankId,
      date: options.date,
      rate: options.rate,
      foreign: options.openingBalance,
      note: "Saldo awal saat resource didaftarkan.",
      actorId: options.actorId,
    });
  }
}

/**
 * Recomputes one resource's balance from its entries.
 *
 * The materialised total is a convenience; the ledger is the truth. This is
 * what proves the two agree, and what repairs the total if anything ever writes
 * the balance row on its own.
 */
export async function rebuildCashBankBalance(
  cashBankId: number
): Promise<{ balance: number; baseBalance: number }> {
  const entries = await prisma.cashBankLedger.findMany({
    where: { cash_bank_id: cashBankId },
    orderBy: { id: "asc" },
    select: {
      id: true,
      movement: true,
      base_movement: true,
      entry_date: true,
    },
  });
  const balance = entries.reduce((t, e) => t + e.movement.toNumber(), 0);
  // Both measures rebuild the same way, from their own signed column. That is
  // what makes them equally checkable: neither is derived from the other, and
  // neither is derived from a rate applied after the fact.
  const baseBalance = roundBase(
    entries.reduce((t, e) => t + e.base_movement.toNumber(), 0)
  );
  const last = entries.at(-1) ?? null;

  const row = {
    balance,
    base_balance: baseBalance,
    entry_count: entries.length,
    last_entry_id: last?.id ?? null,
    last_entry_date: last?.entry_date ?? null,
  };

  await prisma.cashBankBalance.upsert({
    where: { cash_bank_id: cashBankId },
    create: { cash_bank_id: cashBankId, ...row },
    update: row,
  });
  return { balance, baseBalance };
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
  /** The same balance in base currency. */
  baseBalance: number;
  entries: number;
  lastEntryDate: string | null;
};

export type CashBookSummary = {
  /** Active resources only — an inactive resource is not spendable capacity. */
  resources: number;
  byCurrency: {
    currencyId: number;
    currencyLabel: string;
    balance: number;
    baseBalance: number;
    resources: number;
  }[];
  rows: CashBankBalanceRow[];
  /**
   * Every currency added together, in base.
   *
   * This is the one figure that could not exist before: with no rate there was
   * nothing to add USD to IDR with, so a total spanning currencies had to be a
   * list. Now that every entry carries what it was worth when it moved, the
   * sum is a real historical figure rather than a conversion invented at read
   * time. `byCurrency` stays, because what a resource actually holds is still
   * the figure somebody spends.
   */
  totalBase: number;
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
      book_balance: {
        select: {
          balance: true,
          base_balance: true,
          entry_count: true,
          last_entry_date: true,
        },
      },
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
    baseBalance: r.book_balance?.base_balance.toNumber() ?? 0,
    entries: r.book_balance?.entry_count ?? 0,
    lastEntryDate: r.book_balance?.last_entry_date
      ? r.book_balance.last_entry_date.toISOString().slice(0, 10)
      : null,
  }));

  const byCurrency = new Map<number, CashBookSummary["byCurrency"][number]>();
  for (const r of rows) {
    const acc = byCurrency.get(r.currencyId) ?? {
      currencyId: r.currencyId,
      currencyLabel: r.currencyLabel,
      balance: 0,
      baseBalance: 0,
      resources: 0,
    };
    acc.balance += r.balance;
    acc.baseBalance += r.baseBalance;
    acc.resources += 1;
    byCurrency.set(r.currencyId, acc);
  }

  return {
    resources: rows.length,
    byCurrency: [...byCurrency.values()].sort((a, b) =>
      a.currencyLabel.localeCompare(b.currencyLabel)
    ),
    rows,
    totalBase: roundBase(rows.reduce((t, r) => t + r.baseBalance, 0)),
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
// read from `cash_bank_period` plus the month's entries before the period
// (`openingsAt`), so a report never sums the book from its first entry; the
// month chain is itself re-derivable from the entries.

/** An inclusive calendar range, `YYYY-MM-DD` at both ends. */
// `PeriodRange` now lives in `./period` — the General Ledger and both report
// routes need the shape and none of them should import the Cash Bank Book for
// it. Not re-exported here on purpose: a re-export would keep the old path
// working and the boundary would quietly stay crossed.

const startOf = (d: string) => new Date(`${d}T00:00:00Z`);

/**
 * Each resource's balance at the start of `from`, on both measures: its month
 * row's opening (or the closing of the latest month before, when nothing has
 * moved since) plus the entries from the first of the month up to `from`. A
 * resource with no month on or before it held nothing then.
 */
async function openingsAt(
  ids: number[],
  from: string
): Promise<Map<number, { opening: number; baseOpening: number }>> {
  const month = monthOf(from);
  const [rows, partial] = await Promise.all([
    prisma.cashBankPeriod.findMany({
      where: { cash_bank_id: { in: ids }, period: { lte: month } },
      orderBy: [{ cash_bank_id: "asc" }, { period: "desc" }],
      distinct: ["cash_bank_id"],
    }),
    prisma.cashBankLedger.groupBy({
      by: ["cash_bank_id"],
      where: { cash_bank_id: { in: ids }, entry_date: { gte: month, lt: startOf(from) } },
      _sum: { movement: true, base_movement: true },
    }),
  ]);
  const out = new Map<number, { opening: number; baseOpening: number }>();
  for (const r of rows) {
    const current = r.period.getTime() === month.getTime();
    out.set(r.cash_bank_id, {
      opening: (current ? r.opening : r.closing).toNumber(),
      baseOpening: (current ? r.base_opening : r.base_closing).toNumber(),
    });
  }
  for (const p of partial) {
    const o = out.get(p.cash_bank_id) ?? { opening: 0, baseOpening: 0 };
    o.opening += p._sum.movement?.toNumber() ?? 0;
    o.baseOpening = roundBase(o.baseOpening + (p._sum.base_movement?.toNumber() ?? 0));
    out.set(p.cash_bank_id, o);
  }
  return out;
}

export type LedgerEntryRow = {
  id: number;
  entryNo: string;
  date: string;
  type: string;
  /** Signed: positive money in, negative money out. */
  movement: number;
  /** The kurs this entry moved at — this book's own, not another book's. */
  rate: number;
  baseMovement: number;
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
  /** The same four figures in base currency. Both measures reconcile. */
  baseOpening: number;
  baseTotalIn: number;
  baseTotalOut: number;
  baseClosing: number;
  /** By date, oldest first — a book reads forward through the period. */
  entries: LedgerEntryRow[];
  /**
   * False when the resource's whole book, summed, disagrees with its
   * materialised balance in `cash_bank_balance` — **on either measure**. A
   * book that reconciles in its own currency but not in base has had a rate
   * written that its entries do not support, which is exactly the failure the
   * second measure exists to catch. It is a statement about the book rather
   * than the period: once entries may be backdated there is no running
   * balance for a period-bound check to lean on.
   */
  reconciles: boolean;
};

/**
 * One resource's book over a period.
 *
 * Entries are ordered by date, oldest first, which is how a book is read.
 * **There is no running balance.** An entry may be dated before entries
 * already written — a backdated posting — so the `balance_after` stored on
 * each row is the balance at the moment of writing, not at the entry's date,
 * and printing it beside date-ordered rows would show figures no row above
 * produced. Opening and closing are derived from movements; the current
 * balance is `cash_bank_balance`'s, and `reconciles` checks the book against
 * it.
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

  const [before, rows, wholeBook, stored] = await Promise.all([
    openingsAt([cashBankId], range.from).then((m) => m.get(cashBankId)),
    prisma.cashBankLedger.findMany({
      where: {
        cash_bank_id: cashBankId,
        entry_date: { gte: startOf(range.from), lte: startOf(range.to) },
      },
      // Date first: a backdated entry has a later id than the entries it
      // precedes, and a book is read in the order things happened.
      orderBy: [{ entry_date: "asc" }, { id: "asc" }],
      include: { source_doc_type: { select: { doc_table: true } } },
    }),
    prisma.cashBankLedger.aggregate({
      where: { cash_bank_id: cashBankId },
      _sum: { movement: true, base_movement: true },
    }),
    prisma.cashBankBalance.findUnique({
      where: { cash_bank_id: cashBankId },
      select: { balance: true, base_balance: true },
    }),
  ]);

  const opening = before?.opening ?? 0;
  const baseOpening = roundBase(before?.baseOpening ?? 0);
  let totalIn = 0;
  let totalOut = 0;
  let baseTotalIn = 0;
  let baseTotalOut = 0;
  for (const r of rows) {
    const movement = r.movement.toNumber();
    const base = r.base_movement.toNumber();
    if (movement > 0) {
      totalIn += movement;
      baseTotalIn += base;
    } else {
      totalOut -= movement;
      baseTotalOut -= base;
    }
  }
  const closing = opening + totalIn - totalOut;
  const baseClosing = roundBase(baseOpening + baseTotalIn - baseTotalOut);

  const docNumbers = await sourceDocumentNumbers(rows);

  const entries: LedgerEntryRow[] = rows.map((r) => ({
    id: r.id,
    entryNo: r.entry_no,
    date: r.entry_date.toISOString().slice(0, 10),
    type: r.entry_type,
    movement: r.movement.toNumber(),
    rate: r.rate.toNumber(),
    baseMovement: r.base_movement.toNumber(),
    note: r.note,
    sourceDocTable: r.source_doc_type?.doc_table ?? null,
    sourceDocId: r.source_doc_id,
    sourceDocNo: r.source_doc_id ? docNumbers.get(r.source_doc_id) ?? null : null,
  }));

  const cents = (n: number) => Math.round(n * 100);
  const reconciles =
    !!stored &&
    cents(wholeBook._sum.movement?.toNumber() ?? 0) === cents(stored.balance.toNumber()) &&
    roundBase(wholeBook._sum.base_movement?.toNumber() ?? 0) ===
      stored.base_balance.toNumber();

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
    baseOpening,
    baseTotalIn,
    baseTotalOut,
    baseClosing,
    entries,
    reconciles,
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
  baseOpening: number;
  baseTotalIn: number;
  baseTotalOut: number;
  baseClosing: number;
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
  baseOpening: number;
  baseTotalIn: number;
  baseTotalOut: number;
  baseClosing: number;
};

export type BalanceReport = {
  range: PeriodRange;
  groups: BalanceReportGroup[];
  resources: number;
  /**
   * Every currency group's base figures added together.
   *
   * Grouping per currency stays, because what a resource holds is the figure
   * somebody spends. The base total is what the grouping could never give:
   * one figure for the whole report, built from what each movement was
   * actually worth rather than from a rate applied at read time.
   */
  baseOpening: number;
  baseTotalIn: number;
  baseTotalOut: number;
  baseClosing: number;
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
  if (!resources.length) {
    return {
      range,
      groups: [],
      resources: 0,
      baseOpening: 0,
      baseTotalIn: 0,
      baseTotalOut: 0,
      baseClosing: 0,
    };
  }

  const ids = resources.map((r) => r.id);

  // Grouped queries rather than one per resource: opening is everything
  // before the period, and the period itself is split by the movement's sign.
  const inPeriod = {
    cash_bank_id: { in: ids },
    entry_date: { gte: startOf(range.from), lte: startOf(range.to) },
  };
  const [openings, incoming, outgoing] = await Promise.all([
    openingsAt(ids, range.from),
    prisma.cashBankLedger.groupBy({
      by: ["cash_bank_id"],
      where: { ...inPeriod, movement: { gt: 0 } },
      _sum: { movement: true, base_movement: true },
    }),
    prisma.cashBankLedger.groupBy({
      by: ["cash_bank_id"],
      // A revaluation moves nil currency and is counted here, as the Buku Kas &
      // Bank counts it; left out, its base would vanish from the closing.
      where: { ...inPeriod, movement: { lte: 0 } },
      _sum: { movement: true, base_movement: true },
    }),
  ]);

  const openingOf = new Map([...openings].map(([id, o]) => [id, o.opening]));
  const baseOpeningOf = new Map([...openings].map(([id, o]) => [id, o.baseOpening]));
  const inOf = new Map<number, number>();
  const outOf = new Map<number, number>();
  const baseInOf = new Map<number, number>();
  const baseOutOf = new Map<number, number>();
  for (const m of incoming) {
    inOf.set(m.cash_bank_id, m._sum.movement?.toNumber() ?? 0);
    baseInOf.set(m.cash_bank_id, m._sum.base_movement?.toNumber() ?? 0);
  }
  // Summed negative; a report states money out as a positive figure.
  for (const m of outgoing) {
    outOf.set(m.cash_bank_id, -(m._sum.movement?.toNumber() ?? 0));
    baseOutOf.set(m.cash_bank_id, -(m._sum.base_movement?.toNumber() ?? 0));
  }

  const groups = new Map<number, BalanceReportGroup>();
  let counted = 0;

  for (const r of resources) {
    const opening = openingOf.get(r.id) ?? 0;
    const totalIn = inOf.get(r.id) ?? 0;
    const totalOut = outOf.get(r.id) ?? 0;
    const baseOpening = baseOpeningOf.get(r.id) ?? 0;
    const baseTotalIn = baseInOf.get(r.id) ?? 0;
    const baseTotalOut = baseOutOf.get(r.id) ?? 0;
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
      baseOpening: 0,
      baseTotalIn: 0,
      baseTotalOut: 0,
      baseClosing: 0,
    };
    const closing = opening + totalIn - totalOut;
    const baseClosing = roundBase(baseOpening + baseTotalIn - baseTotalOut);
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
      baseOpening,
      baseTotalIn,
      baseTotalOut,
      baseClosing,
      moved,
    });
    group.opening += opening;
    group.totalIn += totalIn;
    group.totalOut += totalOut;
    group.closing += closing;
    group.baseOpening += baseOpening;
    group.baseTotalIn += baseTotalIn;
    group.baseTotalOut += baseTotalOut;
    group.baseClosing += baseClosing;
    groups.set(r.currency.id, group);
    counted += 1;
  }

  const all = [...groups.values()];
  return {
    range,
    resources: counted,
    groups: all.sort((a, b) => a.currencyLabel.localeCompare(b.currencyLabel)),
    baseOpening: roundBase(all.reduce((t, g) => t + g.baseOpening, 0)),
    baseTotalIn: roundBase(all.reduce((t, g) => t + g.baseTotalIn, 0)),
    baseTotalOut: roundBase(all.reduce((t, g) => t + g.baseTotalOut, 0)),
    baseClosing: roundBase(all.reduce((t, g) => t + g.baseClosing, 0)),
  };
}

/** One resource's headline figures, for the Cash & Bank master detail. */
export async function cashBankBookSummary(cashBankId: number): Promise<{
  balance: number;
  baseBalance: number;
  entries: number;
  lastEntryDate: string | null;
}> {
  const row = await prisma.cashBankBalance.findUnique({
    where: { cash_bank_id: cashBankId },
    select: {
      balance: true,
      base_balance: true,
      entry_count: true,
      last_entry_date: true,
    },
  });
  return {
    balance: row?.balance.toNumber() ?? 0,
    baseBalance: row?.base_balance.toNumber() ?? 0,
    entries: row?.entry_count ?? 0,
    lastEntryDate: row?.last_entry_date
      ? row.last_entry_date.toISOString().slice(0, 10)
      : null,
  };
}
