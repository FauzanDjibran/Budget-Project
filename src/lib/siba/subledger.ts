import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { sumByCurrency, type MoneyTotal } from "@/lib/format";
import { nextDocumentNumber } from "./document-number";
import { relieve, roundBase } from "./fx";
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
 * further entry. `sub_ledger_balance` holds the **open items** — one per
 * movement that raised a position, each carrying the rate it was raised at —
 * written in the same database transaction as the entry that moved it, and
 * always recomputable from the entries that name it (`rebuildSubledgerItem`).
 * A position is the sum of its items; nothing stores it.
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
  /**
   * The open item a **lowering** entry settles (`sub_ledger_balance.id`).
   * Required when the entry lowers the position and refused when it raises
   * one: a raise always opens an item of its own.
   */
  itemId?: number | null;
  sourceDocTypeId?: number | null;
  sourceDocId?: number | null;
  note?: string | null;
  actorId: number;
};

/**
 * An open item the posting cannot use — none named, the wrong one, or one
 * that no longer holds what the plan relieved.
 *
 * Thrown rather than returned, because it is raised inside the posting
 * transaction: a lowering that found its item spent by another document must
 * take the whole posting down instead of taking the item below nothing. The
 * caller turns it back into a refusal after the rollback.
 */
export class SubledgerItemUnavailable extends Error {}

const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const startOf = (d: string) => new Date(`${d}T00:00:00Z`);
const cents = (n: number) => Math.round(n * 100);

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

/** Next open item number, `SBI-0001`. */
async function nextItemNo(db: Db): Promise<string> {
  return nextDocumentNumber("SBI", async () => {
    const row = await db.subLedgerBalance.findFirst({
      orderBy: { id: "desc" },
      select: { item_no: true },
    });
    return row?.item_no ?? null;
  });
}

/**
 * Appends one entry and moves the open item it names.
 *
 * **Raising a position opens an item**, at the rate the money moved at, and
 * the entry names it. **Lowering one relieves the item the caller chose**, at
 * that item's own rate and never at an average of the position: the item
 * releases base in proportion to what is left, and a relief to nothing hands
 * back its remaining base exactly. An item cannot go below nothing, so a
 * lowering larger than what its item holds throws — which is what makes a
 * negative position unreachable.
 *
 * Both writes happen inside the caller's transaction, so the book and its
 * items can never disagree. Where the caller already valued the relief
 * (`baseAmount`), an item that has moved since then throws rather than posting
 * a figure the journal does not carry.
 */
export async function recordSubledgerEntry(db: Db, entry: NewSubledgerEntry) {
  const book = entry.book;
  const amount = Math.abs(entry.amount);
  if (!(amount > 0)) {
    throw new Error("Nominal entri buku pembantu harus lebih besar dari nol.");
  }
  const movement = subledgerMovement(book, entry.direction, amount);
  const key = {
    book: book.key,
    partner_id: entry.partnerId,
    currency_id: entry.currencyId,
  };

  if (movement > 0) {
    if (entry.itemId) {
      throw new SubledgerItemUnavailable(
        "Entri yang menaikkan posisi membuka open item baru, bukan menyelesaikan yang lama."
      );
    }
    if (!(entry.rate > 0)) {
      throw new Error(
        `Kurs entri buku pembantu harus lebih besar dari nol (diterima ${entry.rate}).`
      );
    }
    const base = entry.baseAmount ?? roundBase(amount * entry.rate);
    const item = await db.subLedgerBalance.create({
      data: {
        item_no: await nextItemNo(db),
        ...key,
        opened_date: asDate(entry.date),
        rate: entry.rate,
        original: amount,
        base_original: base,
        balance: amount,
        base_balance: base,
        status: "Open",
        entry_count: 1,
        source_doc_type_id: entry.sourceDocTypeId ?? null,
        source_doc_id: entry.sourceDocId ?? null,
        note: entry.note ?? null,
      },
    });
    const created = await db.subLedger.create({
      data: {
        entry_no: await nextEntryNo(db),
        ...key,
        balance_id: item.id,
        entry_date: asDate(entry.date),
        entry_type: entry.type,
        direction: entry.direction,
        amount,
        movement,
        balance_after: amount,
        rate: entry.rate,
        base_amount: base,
        base_movement: base,
        base_balance_after: base,
        source_doc_type_id: entry.sourceDocTypeId ?? null,
        source_doc_id: entry.sourceDocId ?? null,
        note: entry.note ?? null,
        created_by: entry.actorId,
      },
    });
    await db.subLedgerBalance.update({
      where: { id: item.id },
      data: { last_entry_id: created.id, last_entry_date: created.entry_date },
    });
    return created;
  }

  if (!entry.itemId) {
    throw new SubledgerItemUnavailable(
      "Pilih open item yang diselesaikan. Entri yang menurunkan posisi selalu menunjuk satu open item."
    );
  }
  const item = await db.subLedgerBalance.findUnique({ where: { id: entry.itemId } });
  if (
    !item ||
    item.book !== key.book ||
    item.partner_id !== key.partner_id ||
    item.currency_id !== key.currency_id
  ) {
    throw new SubledgerItemUnavailable(
      "Open item yang dipilih bukan milik buku, Partner, dan currency baris ini."
    );
  }
  const remaining = item.balance.toNumber();
  if (item.status !== "Open" || cents(amount) > cents(remaining)) {
    throw new SubledgerItemUnavailable(
      `Open item ${item.item_no} tinggal ${remaining}, tidak cukup untuk ${amount}. ` +
        "Posisi tidak boleh di bawah nol — pilih item lain atau kurangi nominalnya."
    );
  }
  // Equal to the cent is the whole item, so the exact remaining is released
  // rather than a float a hair above it that `relieve` would refuse.
  const relief = relieve(
    { foreign: remaining, base: item.base_balance.toNumber() },
    cents(amount) === cents(remaining) ? remaining : amount
  );
  if (entry.baseAmount != null && roundBase(entry.baseAmount) !== relief.base) {
    throw new SubledgerItemUnavailable(
      `Open item ${item.item_no} berubah sejak dokumen divaluasi. Ulangi Post.`
    );
  }
  const after = relief.remaining;
  const created = await db.subLedger.create({
    data: {
      entry_no: await nextEntryNo(db),
      ...key,
      balance_id: item.id,
      entry_date: asDate(entry.date),
      entry_type: entry.type,
      direction: entry.direction,
      amount,
      movement,
      balance_after: after.foreign,
      // The item's own rate: relief keeps `base ÷ foreign` on it.
      rate: item.rate,
      base_amount: relief.base,
      base_movement: -relief.base,
      base_balance_after: after.base,
      source_doc_type_id: entry.sourceDocTypeId ?? null,
      source_doc_id: entry.sourceDocId ?? null,
      note: entry.note ?? null,
      created_by: entry.actorId,
    },
  });
  await db.subLedgerBalance.update({
    where: { id: item.id },
    data: {
      balance: after.foreign,
      base_balance: after.base,
      status: relief.exhausted ? "Cleared" : "Open",
      entry_count: item.entry_count + 1,
      last_entry_id: created.id,
      last_entry_date: created.entry_date,
    },
  });
  return created;
}

/**
 * Recomputes one open item from the entries that name it.
 *
 * The item is mutable and the book is not, so this is what proves they still
 * agree — and what repairs the item if anything ever wrote it on its own.
 */
export async function rebuildSubledgerItem(
  itemId: number
): Promise<{ balance: number; baseBalance: number }> {
  const entries = await prisma.subLedger.findMany({
    where: { balance_id: itemId },
    orderBy: { id: "asc" },
    select: { id: true, movement: true, base_movement: true, entry_date: true },
  });
  const balance = entries.reduce((t, e) => t + e.movement.toNumber(), 0);
  const baseBalance = roundBase(
    entries.reduce((t, e) => t + e.base_movement.toNumber(), 0)
  );
  const last = entries.at(-1) ?? null;
  await prisma.subLedgerBalance.update({
    where: { id: itemId },
    data: {
      balance,
      base_balance: baseBalance,
      status: cents(balance) === 0 ? "Cleared" : "Open",
      entry_count: entries.length,
      last_entry_id: last?.id ?? null,
      last_entry_date: last?.entry_date ?? null,
    },
  });
  return { balance, baseBalance };
}

/**
 * Recomputes every open item of one subject, and returns the position they
 * add up to.
 */
export async function rebuildSubledgerBalance(
  book: string,
  partnerId: number,
  currencyId: number
): Promise<{ balance: number; baseBalance: number }> {
  const items = await prisma.subLedgerBalance.findMany({
    where: { book, partner_id: partnerId, currency_id: currencyId },
    select: { id: true },
  });
  let balance = 0;
  let baseBalance = 0;
  for (const item of items) {
    const rebuilt = await rebuildSubledgerItem(item.id);
    balance += rebuilt.balance;
    baseBalance += rebuilt.baseBalance;
  }
  return { balance, baseBalance: roundBase(baseBalance) };
}

// ------------------------------------------------------------------ reports
//
// One Report View per book, all served by the reader below. The property every
// one of them holds is `opening + naik - turun = closing`, per subject and per
// currency — the same arithmetic `rebuildSubledgerBalance` uses, so the report
// derives its own figures rather than trusting the stored total.
//
// **There is no running balance.** An entry may be dated before entries already
// written (a backdated posting), so the `balance_after` stored on each row is
// the position at the moment of writing, not at the entry's date, and printing
// it beside date-ordered rows would show figures no row above produced. The
// report reads in date order and states opening and closing only; the current
// position is `sub_ledger_balance`'s, and `reconciles` checks the book against
// it.

export type SubledgerEntryRow = {
  id: number;
  entryNo: string;
  date: string;
  type: string;
  direction: string;
  amount: number;
  /** Signed in the book's direction: positive raises the position. */
  movement: number;
  /** This book's own settlement rate for the entry. */
  rate: number;
  baseAmount: number;
  baseMovement: number;
  /** The open item the entry opened or settled. */
  itemNo: string;
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
  /** By date, oldest first — a book reads forward through the period. */
  entries: SubledgerEntryRow[];
  /**
   * False when the subject's whole book, summed, disagrees with its
   * materialised position in `sub_ledger_balance` — on either measure. A
   * statement about the book rather than the period: once entries may be
   * backdated there is no running balance for a period-bound check to lean on.
   */
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
      // Date first: a backdated entry has a later id than the entries it
      // precedes, and a book is read in the order things happened.
      orderBy: [{ entry_date: "asc" }, { id: "asc" }],
      include: { item: { select: { item_no: true } } },
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
      rate: e.rate.toNumber(),
      baseAmount: e.base_amount.toNumber(),
      baseMovement,
      itemNo: e.item.item_no,
      note: e.note,
      sourceDocId: e.source_doc_id,
    });
  }

  if (acc.size === 0) return { book, range, subjects: [] };

  const keys = [...acc.values()].map((a) => ({
    partner_id: a.partnerId,
    currency_id: a.currencyId,
  }));
  const [partners, currencies, wholeBook, stored] = await Promise.all([
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
    prisma.subLedger.groupBy({
      by: ["partner_id", "currency_id"],
      where: { book: book.key, OR: keys },
      _sum: { movement: true, base_movement: true },
    }),
    // The position is the sum of its open items.
    prisma.subLedgerBalance.groupBy({
      by: ["partner_id", "currency_id"],
      where: { book: book.key, OR: keys },
      _sum: { balance: true, base_balance: true },
    }),
  ]);
  const pair = (p: number, c: number) => `${p}:${c}`;
  const summedOf = new Map(
    wholeBook.map((w) => [
      pair(w.partner_id, w.currency_id),
      {
        cents: Math.round((w._sum.movement?.toNumber() ?? 0) * 100),
        base: roundBase(w._sum.base_movement?.toNumber() ?? 0),
      },
    ])
  );
  const storedOf = new Map(
    stored.map((r) => [
      pair(r.partner_id, r.currency_id),
      {
        cents: Math.round((r._sum.balance?.toNumber() ?? 0) * 100),
        base: roundBase(r._sum.base_balance?.toNumber() ?? 0),
      },
    ])
  );
  const partnerOf = new Map(partners.map((p) => [p.id, p]));
  const currencyOf = new Map(currencies.map((c) => [c.id, c.currency_label]));

  const subjects: SubledgerSubject[] = [];
  for (const a of acc.values()) {
    const partner = partnerOf.get(a.partnerId);
    if (!partner) continue;
    const closing = a.opening + a.raised - a.lowered;
    const baseClosing = roundBase(a.baseOpening + a.baseRaised - a.baseLowered);
    const summed = summedOf.get(pair(a.partnerId, a.currencyId));
    const held = storedOf.get(pair(a.partnerId, a.currencyId));
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
      reconciles:
        !!summed &&
        !!held &&
        summed.cents === held.cents &&
        summed.base === held.base,
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
  // One row per subject: a position is the sum of its open items.
  const grouped = companyIds.length
    ? await prisma.subLedgerBalance.groupBy({
        by: ["book", "partner_id", "currency_id"],
        where: { partner: { company_id: { in: companyIds } } },
        _sum: { balance: true },
      })
    : [];
  const currencies = grouped.length
    ? await prisma.refCurrency.findMany({ select: { id: true, currency_label: true } })
    : [];
  const labelOf = new Map(currencies.map((c) => [c.id, c.currency_label]));
  const balances = grouped.map((g) => ({
    book: g.book,
    currency_id: g.currency_id,
    currency: { currency_label: labelOf.get(g.currency_id) ?? "" },
    balance: g._sum.balance ?? { toNumber: () => 0 },
  }));

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
  const row = await db.subLedgerBalance.aggregate({
    where: { book, partner_id: partnerId, currency_id: currencyId },
    _sum: { balance: true, base_balance: true },
  });
  return {
    foreign: row._sum.balance?.toNumber() ?? 0,
    base: roundBase(row._sum.base_balance?.toNumber() ?? 0),
  };
}

// ---------------------------------------------------------------- open items

export type SubledgerItem = {
  id: number;
  itemNo: string;
  book: string;
  partnerId: number;
  currencyId: number;
  /** `YYYY-MM-DD` — when the item was raised. */
  date: string;
  /** The rate the item was raised at, and the rate it relieves at. */
  rate: number;
  original: number;
  baseOriginal: number;
  remaining: number;
  baseRemaining: number;
  status: "Open" | "Cleared";
  /** The words it was raised under — the Budget's own description. */
  note: string | null;
  sourceDocTypeId: number | null;
  sourceDocId: number | null;
};

type ItemRecord = {
  id: number;
  item_no: string;
  book: string;
  partner_id: number;
  currency_id: number;
  opened_date: Date;
  rate: { toNumber(): number };
  original: { toNumber(): number };
  base_original: { toNumber(): number };
  balance: { toNumber(): number };
  base_balance: { toNumber(): number };
  status: string;
  note: string | null;
  source_doc_type_id: number | null;
  source_doc_id: number | null;
};

const toItem = (r: ItemRecord): SubledgerItem => ({
  id: r.id,
  itemNo: r.item_no,
  book: r.book,
  partnerId: r.partner_id,
  currencyId: r.currency_id,
  date: r.opened_date.toISOString().slice(0, 10),
  rate: r.rate.toNumber(),
  original: r.original.toNumber(),
  baseOriginal: r.base_original.toNumber(),
  remaining: r.balance.toNumber(),
  baseRemaining: r.base_balance.toNumber(),
  status: r.status as "Open" | "Cleared",
  note: r.note,
  sourceDocTypeId: r.source_doc_type_id,
  sourceDocId: r.source_doc_id,
});

/** One open item, or null. */
export async function subledgerItem(
  id: number,
  db: Db = prisma
): Promise<SubledgerItem | null> {
  const row = await db.subLedgerBalance.findUnique({ where: { id } });
  return row ? toItem(row) : null;
}

/** Several items by id, whatever their status — what a posted line names. */
export async function subledgerItemsByIds(ids: number[]): Promise<SubledgerItem[]> {
  if (!ids.length) return [];
  const rows = await prisma.subLedgerBalance.findMany({ where: { id: { in: ids } } });
  return rows.map(toItem);
}

/**
 * The items still open for these subjects, oldest first — what a line that
 * lowers a position may choose from.
 *
 * Oldest first is display order only. Nothing is ever settled without being
 * chosen: which item a return settles decides the gain or loss it recognises.
 */
export async function openSubledgerItems(
  subjects: { book: string; partnerId: number; currencyId: number }[]
): Promise<SubledgerItem[]> {
  if (!subjects.length) return [];
  const rows = await prisma.subLedgerBalance.findMany({
    where: {
      status: "Open",
      OR: subjects.map((s) => ({
        book: s.book,
        partner_id: s.partnerId,
        currency_id: s.currencyId,
      })),
    },
    orderBy: [{ opened_date: "asc" }, { id: "asc" }],
  });
  return rows.map(toItem);
}

export type SubledgerItemRow = SubledgerItem & {
  partnerLabel: string;
  partnerName: string;
  currencyLabel: string;
  /** False when the item disagrees with the entries that name it. */
  reconciles: boolean;
};

/**
 * Every item of one book, for the open-item report: the Company's scope, the
 * Partners asked for, and whether cleared items are included.
 */
export async function subledgerItemReport(
  books: SubledgerDef[],
  bookKey: string,
  options: { companyIds: number[]; partnerIds?: number[]; includeCleared?: boolean }
): Promise<{ book: SubledgerDef; items: SubledgerItemRow[] } | null> {
  const book = subledgerByKey(books, bookKey);
  if (!book) return null;
  const rows = await prisma.subLedgerBalance.findMany({
    where: {
      book: book.key,
      ...(options.includeCleared ? {} : { status: "Open" as const }),
      partner: {
        company_id: { in: options.companyIds },
        ...(options.partnerIds?.length ? { id: { in: options.partnerIds } } : {}),
      },
    },
    include: {
      partner: { select: { partner_label: true, partner_name: true } },
      currency: { select: { currency_label: true } },
    },
    orderBy: [{ opened_date: "asc" }, { id: "asc" }],
  });
  const sums = rows.length
    ? await prisma.subLedger.groupBy({
        by: ["balance_id"],
        where: { balance_id: { in: rows.map((r) => r.id) } },
        _sum: { movement: true, base_movement: true },
      })
    : [];
  const sumOf = new Map(sums.map((s) => [s.balance_id, s._sum]));
  const items = rows.map((r) => {
    const s = sumOf.get(r.id);
    return {
      ...toItem(r),
      partnerLabel: r.partner.partner_label,
      partnerName: r.partner.partner_name,
      currencyLabel: r.currency.currency_label,
      reconciles:
        !!s &&
        cents(s.movement?.toNumber() ?? 0) === cents(r.balance.toNumber()) &&
        roundBase(s.base_movement?.toNumber() ?? 0) === roundBase(r.base_balance.toNumber()),
    };
  });
  items.sort(
    (a, b) =>
      a.partnerLabel.localeCompare(b.partnerLabel) ||
      a.currencyLabel.localeCompare(b.currencyLabel) ||
      a.date.localeCompare(b.date) ||
      a.id - b.id
  );
  return { book, items };
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
 * Only a writer that takes it is serialised by it. A realization posting takes
 * it for every position it lowers, so two documents settling the same open item
 * cannot both pass the check against one remaining figure.
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
  const rows = await prisma.subLedgerBalance.groupBy({
    by: ["book", "partner_id", "currency_id"],
    where: { book: { in: books }, partner_id: { in: partnerIds } },
    _sum: { balance: true, base_balance: true },
  });
  return rows
    .map((r) => ({
      book: r.book,
      partnerId: r.partner_id,
      currencyId: r.currency_id,
      foreign: r._sum.balance?.toNumber() ?? 0,
      base: roundBase(r._sum.base_balance?.toNumber() ?? 0),
    }))
    .filter((r) => r.foreign !== 0 || r.base !== 0);
}
