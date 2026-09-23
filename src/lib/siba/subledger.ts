import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { sumByCurrency, type MoneyTotal } from "@/lib/format";
import { nextDocumentNumber } from "./document-number";
import { roundBase } from "./fx";
import type { PeriodRange } from "./period";
import {
  subledgerByKey,
  subledgerMovement,
  type SubledgerDef,
  type SubledgerNature,
} from "./subledger-catalogue";

/**
 * The subledgers — the authoritative record of where each Partner stands.
 *
 * This is the Cash Bank Book again with a different subject. `sub_ledger` is
 * append-only: an entry is never edited and never deleted, because a book that
 * can be rewritten is not evidence of anything, and a mistake is corrected by a
 * further entry. `sub_ledger_balance` is the running position, written in the
 * same database transaction as the entry that moved it, and always
 * recomputable by `rebuildSubledgerBalance`.
 *
 * The books are **independent historical stores** (concept doc §11, §13): they
 * are written straight from the business transaction at Post, alongside the
 * Cash Bank Book and the Journal, and they never read a journal line. Only the
 * General Ledger derives from the journal.
 *
 * A leaf, like every book: it imports the shared kernel and its own catalogue,
 * and nothing else. It is written by callers and never reaches back to them —
 * which is also why an entry carries its source document as the weak
 * `(doc_type_id, doc_id)` pair plus whatever the caller wrote into `note`,
 * rather than resolving a document number out of a module it would then depend
 * on.
 */

/** A Prisma client or an interactive transaction — every write here takes one. */
type Db = Prisma.TransactionClient | typeof prisma;

export type SubledgerEntryType = "Opening" | "Transaction" | "Adjustment";

export type NewSubledgerEntry = {
  /**
   * The book being written. The **definition**, not a key to look up: this
   * module is a leaf that reads no other table, and the books now come from the
   * Budget Categories, so the caller loads them and hands one in.
   */
  book: SubledgerDef;
  partnerId: number;
  currencyId: number;
  /** `YYYY-MM-DD`. */
  date: string;
  type: SubledgerEntryType;
  /** The direction the money moved; the book decides what that does to it. */
  direction: "In" | "Out";
  /** Positive; `direction` and the book's nature carry the sign. */
  amount: number;
  /**
   * **This book's own settlement rate**, converting the subject's currency to
   * base — not necessarily the rate the Cash Bank Book recorded for the same
   * document.
   *
   * An entry that raises a position originates base value at the rate the money
   * moved at. An entry that relieves one releases base at the rate the position
   * was already carried at, which is usually a different number. Keeping each
   * book on its own rate is what lets `base_amount ÷ amount` stay true on every
   * row, so each book is independently re-derivable; the gap between the two
   * rates is the FX difference, and it belongs in the journal.
   *
   * Required, with no default: `1` is correct only for base currency.
   */
  rate: number;
  /**
   * The exact base value, when the caller already knows it — a position
   * relieved to nothing releases its remaining base exactly, which can differ
   * from `amount × rate` by a rounding unit.
   */
  baseAmount?: number;
  sourceDocTypeId?: number | null;
  sourceDocId?: number | null;
  note?: string | null;
  actorId: number;
};

const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const startOf = (d: string) => new Date(`${d}T00:00:00Z`);

/** Next entry number, `SBL-0001`. The format lives in `document-number.ts`. */
async function nextEntryNo(db: Db): Promise<string> {
  return nextDocumentNumber("SBL", async () => {
    const row = await db.subLedger.findFirst({
      orderBy: { id: "desc" },
      select: { entry_no: true },
    });
    return row?.entry_no ?? null;
  });
}

/**
 * Appends one entry and moves the subject's position with it.
 *
 * Both writes happen inside the caller's transaction, so the book and its total
 * can never disagree. An unknown book **throws** rather than returning: this
 * runs inside the posting transaction, and a posting that silently skipped a
 * subject book would leave the Partner's history missing a movement the Cash
 * Bank Book and the Journal both recorded.
 */
export async function recordSubledgerEntry(db: Db, entry: NewSubledgerEntry) {
  const book = entry.book;

  if (!(entry.rate > 0)) {
    throw new Error(
      `Kurs entri buku pembantu harus lebih besar dari nol (diterima ${entry.rate}).`
    );
  }

  const amount = Math.abs(entry.amount);
  const base = entry.baseAmount ?? roundBase(amount * entry.rate);
  const movement = subledgerMovement(book, entry.direction, amount);
  // The base figure is signed the same way the foreign one is: whichever way
  // the book's own nature sends the position, both measures follow it together.
  const baseMovement = movement < 0 ? -base : base;
  const key = {
    book: book.key,
    partner_id: entry.partnerId,
    currency_id: entry.currencyId,
  };

  const current = await db.subLedgerBalance.findUnique({
    where: { book_partner_id_currency_id: key },
    select: { balance: true, base_balance: true, entry_count: true },
  });
  const after = (current ? current.balance.toNumber() : 0) + movement;
  const afterBase = roundBase(
    (current ? current.base_balance.toNumber() : 0) + baseMovement
  );

  const created = await db.subLedger.create({
    data: {
      entry_no: await nextEntryNo(db),
      ...key,
      entry_date: asDate(entry.date),
      entry_type: entry.type,
      direction: entry.direction,
      amount,
      movement,
      balance_after: after,
      rate: entry.rate,
      base_amount: base,
      base_movement: baseMovement,
      base_balance_after: afterBase,
      source_doc_type_id: entry.sourceDocTypeId ?? null,
      source_doc_id: entry.sourceDocId ?? null,
      note: entry.note ?? null,
      created_by: entry.actorId,
    },
  });

  await db.subLedgerBalance.upsert({
    where: { book_partner_id_currency_id: key },
    create: {
      ...key,
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
 * Recomputes one subject's position from its entries.
 *
 * The materialised total is a convenience; the book is the truth. This is what
 * proves the two agree, and what repairs the total if anything ever writes the
 * balance row on its own.
 */
export async function rebuildSubledgerBalance(
  book: string,
  partnerId: number,
  currencyId: number
): Promise<{ balance: number; baseBalance: number }> {
  const key = { book, partner_id: partnerId, currency_id: currencyId };
  const entries = await prisma.subLedger.findMany({
    where: key,
    orderBy: { id: "asc" },
    select: { id: true, movement: true, base_movement: true, entry_date: true },
  });
  const balance = entries.reduce((t, e) => t + e.movement.toNumber(), 0);
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

  await prisma.subLedgerBalance.upsert({
    where: { book_partner_id_currency_id: key },
    create: { ...key, ...row },
    update: row,
  });
  return { balance, baseBalance };
}

// ------------------------------------------------------------------ reports
//
// One Report View per book, all served by the reader below. The property every
// one of them holds is `opening + naik - turun = closing`, per subject and per
// currency — the same arithmetic `rebuildSubledgerBalance` uses, so the report
// derives its own figures rather than trusting the stored total, and
// `reconciles` reports whether the two agree.

export type SubledgerEntryRow = {
  id: number;
  entryNo: string;
  date: string;
  type: string;
  direction: string;
  amount: number;
  /** Signed in the book's direction: positive raises the position. */
  movement: number;
  balanceAfter: number;
  /** This book's own settlement rate for the entry. */
  rate: number;
  baseAmount: number;
  baseMovement: number;
  baseBalanceAfter: number;
  note: string | null;
  sourceDocId: number | null;
};

export type SubledgerSubject = {
  partnerId: number;
  label: string;
  name: string;
  categoryLabel: string;
  companyLabel: string;
  active: boolean;
  currencyId: number;
  currencyLabel: string;
  opening: number;
  raised: number;
  lowered: number;
  closing: number;
  baseOpening: number;
  baseRaised: number;
  baseLowered: number;
  baseClosing: number;
  /**
   * What the subject's position is carried at — `baseClosing ÷ closing`, or
   * null where the position is nil.
   *
   * Derived on read and never stored. This is the figure a later relief
   * releases at, and therefore the reason an FX difference can arise at all.
   * It is an effective rate and will generally equal no rate anyone
   * transacted at, so it is shown and never used as an input.
   */
  carryingRate: number | null;
  /** Oldest first — a book reads forward through the period. */
  entries: SubledgerEntryRow[];
  /** False when the stored running balance and the summed movements disagree. */
  reconciles: boolean;
};

export type SubledgerReport = {
  book: SubledgerDef;
  range: PeriodRange;
  /** One block per Partner and currency, never blended across currencies. */
  subjects: SubledgerSubject[];
};

/**
 * One book over a period, one block per subject.
 *
 * A subject is a **(Partner, currency)** pair rather than a Partner alone:
 * amounts are never converted (§12), so a Partner who owes in two currencies
 * holds two positions and neither is a component of a single figure.
 *
 * Subjects come from the book itself — a Partner with no entry in or before the
 * period has no position to report, and inventing a zero row for every Partner
 * in the master would bury the ones that moved. Entries dated exactly `from` or
 * exactly `to` are inside the period; anything earlier folds into the opening.
 */
export async function subledgerReport(
  books: SubledgerDef[],
  bookKey: string,
  range: PeriodRange,
  options: { partnerIds?: number[]; companyIds: number[] }
): Promise<SubledgerReport | null> {
  const book = subledgerByKey(books, bookKey);
  if (!book) return null;

  const partnerWhere = {
    company_id: { in: options.companyIds },
    ...(options.partnerIds?.length ? { id: { in: options.partnerIds } } : {}),
  };
  const scope = { book: book.key, partner: partnerWhere };

  const [before, within] = await Promise.all([
    prisma.subLedger.groupBy({
      by: ["partner_id", "currency_id"],
      where: { ...scope, entry_date: { lt: startOf(range.from) } },
      _sum: { movement: true, base_movement: true },
    }),
    prisma.subLedger.findMany({
      where: {
        ...scope,
        entry_date: { gte: startOf(range.from), lte: startOf(range.to) },
      },
      orderBy: { id: "asc" },
    }),
  ]);

  type Acc = {
    partnerId: number;
    currencyId: number;
    opening: number;
    raised: number;
    lowered: number;
    baseOpening: number;
    baseRaised: number;
    baseLowered: number;
    entries: SubledgerEntryRow[];
  };
  const acc = new Map<string, Acc>();
  const reach = (partnerId: number, currencyId: number): Acc => {
    const k = `${partnerId}:${currencyId}`;
    let found = acc.get(k);
    if (!found) {
      found = {
        partnerId,
        currencyId,
        opening: 0,
        raised: 0,
        lowered: 0,
        baseOpening: 0,
        baseRaised: 0,
        baseLowered: 0,
        entries: [],
      };
      acc.set(k, found);
    }
    return found;
  };

  for (const b of before) {
    const subject = reach(b.partner_id, b.currency_id);
    subject.opening = b._sum.movement?.toNumber() ?? 0;
    subject.baseOpening = b._sum.base_movement?.toNumber() ?? 0;
  }
  for (const e of within) {
    const subject = reach(e.partner_id, e.currency_id);
    const movement = e.movement.toNumber();
    const baseMovement = e.base_movement.toNumber();
    if (movement >= 0) {
      subject.raised += movement;
      subject.baseRaised += baseMovement;
    } else {
      subject.lowered += -movement;
      subject.baseLowered += -baseMovement;
    }
    subject.entries.push({
      id: e.id,
      entryNo: e.entry_no,
      date: e.entry_date.toISOString().slice(0, 10),
      type: e.entry_type,
      direction: e.direction,
      amount: e.amount.toNumber(),
      movement,
      balanceAfter: e.balance_after.toNumber(),
      rate: e.rate.toNumber(),
      baseAmount: e.base_amount.toNumber(),
      baseMovement,
      baseBalanceAfter: e.base_balance_after.toNumber(),
      note: e.note,
      sourceDocId: e.source_doc_id,
    });
  }

  if (acc.size === 0) return { book, range, subjects: [] };

  const [partners, currencies] = await Promise.all([
    prisma.mPartner.findMany({
      where: { id: { in: [...new Set([...acc.values()].map((a) => a.partnerId))] } },
      select: {
        id: true,
        partner_label: true,
        partner_name: true,
        status: true,
        company: { select: { company_label: true } },
        category: { select: { category_label: true } },
      },
    }),
    prisma.refCurrency.findMany({ select: { id: true, currency_label: true } }),
  ]);
  const partnerOf = new Map(partners.map((p) => [p.id, p]));
  const currencyOf = new Map(currencies.map((c) => [c.id, c.currency_label]));

  const subjects: SubledgerSubject[] = [];
  for (const a of acc.values()) {
    const partner = partnerOf.get(a.partnerId);
    if (!partner) continue;
    const closing = a.opening + a.raised - a.lowered;
    const baseClosing = roundBase(a.baseOpening + a.baseRaised - a.baseLowered);
    const last = a.entries.at(-1);
    subjects.push({
      partnerId: a.partnerId,
      label: partner.partner_label,
      name: partner.partner_name,
      categoryLabel: partner.category.category_label,
      companyLabel: partner.company.company_label,
      active: partner.status === "Active",
      currencyId: a.currencyId,
      currencyLabel: currencyOf.get(a.currencyId) ?? "",
      opening: a.opening,
      raised: a.raised,
      lowered: a.lowered,
      closing,
      baseOpening: roundBase(a.baseOpening),
      baseRaised: roundBase(a.baseRaised),
      baseLowered: roundBase(a.baseLowered),
      baseClosing,
      // Null at a nil position rather than zero: a subject holding nothing has
      // no rate, and a number here would invite being used as one.
      carryingRate: closing === 0 ? null : baseClosing / closing,
      entries: a.entries,
      reconciles: last
        ? last.balanceAfter === closing && last.baseBalanceAfter === baseClosing
        : true,
    });
  }

  subjects.sort(
    (x, y) =>
      x.label.localeCompare(y.label) || x.currencyLabel.localeCompare(y.currencyLabel)
  );
  return { book, range, subjects };
}

/**
 * Every Partner that has ever moved in one book, for its filter bar.
 *
 * Read from the book rather than from the Partner master on purpose: a book's
 * filter should offer the subjects it actually holds, not every Partner whose
 * category might one day post here.
 */
export async function subledgerSubjects(
  books: SubledgerDef[],
  bookKey: string,
  companyIds: number[]
): Promise<{ id: number; label: string; name: string; active: boolean }[]> {
  const book = subledgerByKey(books, bookKey);
  if (!book) return [];

  const rows = await prisma.subLedgerBalance.findMany({
    where: { book: book.key, partner: { company_id: { in: companyIds } } },
    select: {
      partner: {
        select: {
          id: true,
          partner_label: true,
          partner_name: true,
          status: true,
          category: { select: { category_label: true } },
        },
      },
    },
  });

  const seen = new Map<
    number,
    { id: number; label: string; name: string; active: boolean }
  >();
  for (const { partner } of rows) {
    if (seen.has(partner.id)) continue;
    seen.set(partner.id, {
      id: partner.id,
      label: partner.partner_label,
      name:
        `${partner.partner_name} - ${partner.category.category_label}` +
        (partner.status === "Active" ? "" : " - non-aktif"),
      // Always selectable: a report about last quarter is exactly when a
      // Partner deactivated since still matters. The name says so instead.
      active: true,
    });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * How many entries each book holds.
 *
 * Counts rather than balances: a total across subjects would have to cross
 * currencies, and the books never do that.
 */
export async function subledgerEntryCounts(
  books: SubledgerDef[]
): Promise<Map<string, number>> {
  const rows = await prisma.subLedger.groupBy({ by: ["book"], _count: { _all: true } });
  const counts = new Map<string, number>(books.map((s) => [s.key, 0]));
  for (const r of rows) counts.set(r.book, r._count._all);
  return counts;
}

/**
 * What each book adds up to, per currency.
 *
 * One figure per book per currency, never one figure per book: a Partner owing
 * in two currencies holds two positions and nothing converts between them
 * (CLAUDE.md §10 rule 56). Subjects whose position has settled to nil are
 * dropped, so a book reports only where something is still standing.
 *
 * Scoped by Company through the Partner, which is what a subject *is* — the
 * book itself stores no company, because the Partner it names already belongs
 * to one.
 */
export type SubledgerPosition = {
  key: string;
  name: string;
  icon: SubledgerDef["icon"];
  nature: SubledgerNature;
  closingLabel: string;
  /** How many subjects still stand in this book. */
  subjects: number;
  totals: MoneyTotal[];
};

export async function subledgerPositions(
  books: SubledgerDef[],
  companyIds: number[]
): Promise<SubledgerPosition[]> {
  const balances = companyIds.length
    ? await prisma.subLedgerBalance.findMany({
        where: { partner: { company_id: { in: companyIds } } },
        select: {
          book: true,
          balance: true,
          currency_id: true,
          currency: { select: { currency_label: true } },
        },
      })
    : [];

  return books.map((def) => {
    const mine = balances.filter(
      (b) => b.book === def.key && b.balance.toNumber() !== 0
    );
    return {
      key: def.key,
      name: def.name,
      icon: def.icon,
      nature: def.nature,
      closingLabel: def.closingLabel,
      subjects: mine.length,
      totals: sumByCurrency(
        mine.map((b) => ({
          currencyId: b.currency_id,
          currencyLabel: b.currency.currency_label,
          amount: b.balance.toNumber(),
        }))
      ),
    };
  });
}

/**
 * One subject's standing position, on both measures.
 *
 * What a settlement needs before it can decide whether it is relieving
 * something or creating it: a position holding base value releases at its own
 * carrying rate, and one holding nothing is originated by the movement itself
 * (core concept §5.3). The discriminator is the base value, never the Purpose.
 *
 * Exported because Finance must not read `sub_ledger_balance` itself — the book
 * owns its tables, and a caller reaching into them is what the module boundary
 * exists to stop.
 */
export async function subledgerPosition(
  book: string,
  partnerId: number,
  currencyId: number,
  db: Db = prisma
): Promise<{ foreign: number; base: number }> {
  const row = await db.subLedgerBalance.findUnique({
    where: {
      book_partner_id_currency_id: {
        book,
        partner_id: partnerId,
        currency_id: currencyId,
      },
    },
    select: { balance: true, base_balance: true },
  });
  return {
    foreign: row?.balance.toNumber() ?? 0,
    base: row?.base_balance.toNumber() ?? 0,
  };
}

/**
 * Holds one subject's position for the rest of the caller's transaction.
 *
 * A writer that decides something *from* the position — a note refusing to
 * take it below zero — reads it, checks it and then writes; two of them
 * running at once would each read the same figure and both pass. Taking this
 * first makes the second wait until the first has committed, so its read sees
 * the position the first one left.
 *
 * An advisory lock rather than `SELECT … FOR UPDATE` on `sub_ledger_balance`,
 * because the row does not exist until a subject's first entry: a row lock on
 * a position still at nothing would lock nothing, and creating an empty row
 * just to lock it would put a position with no entries into every reader.
 * Keyed on the position's own identity, released when the transaction ends,
 * and parameterised — no value is interpolated into the SQL text.
 *
 * Only a writer that takes it is serialised by it. A cash posting does not
 * (yet), so it still reads the position the way it always has.
 */
export async function lockSubledgerPosition(
  db: Prisma.TransactionClient,
  book: string,
  partnerId: number,
  currencyId: number
): Promise<void> {
  const key = `sub_ledger_balance:${book}:${partnerId}:${currencyId}`;
  await db.$queryRaw`SELECT 1 AS held FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS lock`;
}

/**
 * Every standing position among these books and Partners, on both measures —
 * `subledgerPosition` for a whole picker at once, in one query. Positions at
 * nothing on both measures are left out.
 */
export async function subledgerPositionsFor(
  books: string[],
  partnerIds: number[]
): Promise<
  { book: string; partnerId: number; currencyId: number; foreign: number; base: number }[]
> {
  if (!books.length || !partnerIds.length) return [];
  const rows = await prisma.subLedgerBalance.findMany({
    where: { book: { in: books }, partner_id: { in: partnerIds } },
    select: {
      book: true,
      partner_id: true,
      currency_id: true,
      balance: true,
      base_balance: true,
    },
  });
  return rows
    .map((r) => ({
      book: r.book,
      partnerId: r.partner_id,
      currencyId: r.currency_id,
      foreign: r.balance.toNumber(),
      base: r.base_balance.toNumber(),
    }))
    .filter((r) => r.foreign !== 0 || r.base !== 0);
}
