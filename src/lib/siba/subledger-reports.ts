import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { sumByCurrency, type MoneyTotal } from "@/lib/format";
import { roundBase } from "./fx";
import type { PeriodRange } from "./period";
import { subledgerById, type SubledgerDef, type SubledgerNature } from "./subledger-catalogue";

// ------------------------------------------------------------------ reports
//
// One Report View per book, all served by the reader below. The property every
// one of them holds is `opening + naik - turun = closing`, per subject and per
// currency — the same arithmetic `rebuildSubledgerBalance` uses, so the report
// derives its own figures rather than trusting the stored total.
//
// **There is no running balance.** An entry may be dated before entries already
// written (a backdated posting), so a balance kept per row would follow the
// order of writing, not of dates, and the book stores none. The report reads in date order and states opening and closing only; the current
// position is `sub_ledger_balance`'s, and `reconciles` checks the book against
// it.

export type SubledgerEntryRow = {
  id: number;
  entryNo: string;
  date: string;
  type: string;
  /** Signed in the book's direction: positive raises the position. */
  movement: number;
  /** This book's own settlement rate for the entry. */
  rate: number;
  baseMovement: number;
  /** The open item the entry opened or settled. */
  itemId: number;
  itemNo: string;
  note: string | null;
  sourceDocTable: string | null;
  sourceDocId: number | null;
  /** Filled in by `attachDocumentNumbers`: a book cannot name another module's table. */
  sourceDocNo: string | null;
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

type Db = Prisma.TransactionClient | typeof prisma;
const startOf = (d: string) => new Date(`${d}T00:00:00Z`);
const cents = (n: number) => Math.round(n * 100);

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
  bookId: number | string,
  range: PeriodRange,
  options: { partnerIds?: number[]; companyIds: number[] }
): Promise<SubledgerReport | null> {
  const book = subledgerById(books, bookId);
  if (!book) return null;

  const partnerWhere = {
    company_id: { in: options.companyIds },
    ...(options.partnerIds?.length ? { id: { in: options.partnerIds } } : {}),
  };
  const scope = { budget_category_id: book.categoryId, partner: partnerWhere };

  const [before, within] = await Promise.all([
    prisma.subLedger.groupBy({
      by: ["partner_id", "currency_id"],
      where: { ...scope, accounting_date: { lt: startOf(range.from) } },
      _sum: { movement: true, base_movement: true },
    }),
    prisma.subLedger.findMany({
      where: {
        ...scope,
        accounting_date: { gte: startOf(range.from), lte: startOf(range.to) },
      },
      // Date first: a backdated entry has a later id than the entries it
      // precedes, and a book is read in the order things happened.
      orderBy: [{ accounting_date: "asc" }, { id: "asc" }],
      include: {
        item: { select: { item_no: true } },
        source_doc_type: { select: { doc_table: true } },
      },
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
      date: e.accounting_date.toISOString().slice(0, 10),
      type: e.entry_type,
      movement,
      rate: e.rate.toNumber(),
      baseMovement,
      itemId: e.balance_id,
      itemNo: e.item.item_no,
      note: e.note,
      sourceDocTable: e.source_doc_type?.doc_table ?? null,
      sourceDocId: e.source_doc_id,
      sourceDocNo: null,
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
      where: { budget_category_id: book.categoryId, OR: keys },
      _sum: { movement: true, base_movement: true },
    }),
    // The position is the sum of its open items.
    prisma.subLedgerBalance.groupBy({
      by: ["partner_id", "currency_id"],
      where: { budget_category_id: book.categoryId, OR: keys },
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
  bookId: number | string,
  companyIds: number[]
): Promise<{ id: number; label: string; name: string; active: boolean }[]> {
  const book = subledgerById(books, bookId);
  if (!book) return [];

  const rows = await prisma.subLedgerBalance.findMany({
    where: { budget_category_id: book.categoryId, partner: { company_id: { in: companyIds } } },
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
): Promise<Map<number, number>> {
  const rows = await prisma.subLedger.groupBy({
    by: ["budget_category_id"],
    _count: { _all: true },
  });
  const counts = new Map<number, number>(books.map((s) => [s.categoryId, 0]));
  for (const r of rows) counts.set(r.budget_category_id, r._count._all);
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
  /** The book's Budget Category id. */
  bookId: number;
  name: string;
  icon: SubledgerDef["icon"];
  nature: SubledgerNature;
  closingLabel: string;
  /** How many subjects still stand in this book. */
  subjects: number;
  totals: MoneyTotal[];
  /** Each standing subject, largest first within its currency. */
  partners: {
    partnerId: number;
    partnerLabel: string;
    partnerName: string;
    currencyLabel: string;
    balance: number;
    openItems: number;
    /** `YYYY-MM-DD` — when its oldest open item was raised. */
    oldest: string;
  }[];
};

export async function subledgerPositions(
  books: SubledgerDef[],
  companyIds: number[]
): Promise<SubledgerPosition[]> {
  // One row per subject: a position is the sum of its open items.
  const grouped = companyIds.length
    ? await prisma.subLedgerBalance.groupBy({
        by: ["budget_category_id", "partner_id", "currency_id"],
        // A cleared item holds nil, so only open ones move the sum — and the
        // oldest date then names an item still waiting.
        where: { status: "Open", partner: { company_id: { in: companyIds } } },
        _sum: { balance: true },
        _count: { id: true },
        _min: { opened_date: true },
      })
    : [];
  const [currencies, partnerRows] = grouped.length
    ? await Promise.all([
        prisma.refCurrency.findMany({ select: { id: true, currency_label: true } }),
        prisma.mPartner.findMany({
          where: { id: { in: [...new Set(grouped.map((g) => g.partner_id))] } },
          select: { id: true, partner_label: true, partner_name: true },
        }),
      ])
    : [[], []];
  const labelOf = new Map(currencies.map((c) => [c.id, c.currency_label]));
  const partnerOf = new Map(partnerRows.map((p) => [p.id, p]));
  const balances = grouped.map((g) => ({
    bookId: g.budget_category_id,
    partnerId: g.partner_id,
    currency_id: g.currency_id,
    currency: { currency_label: labelOf.get(g.currency_id) ?? "" },
    balance: g._sum.balance ?? { toNumber: () => 0 },
    openItems: g._count.id,
    oldest: g._min.opened_date?.toISOString().slice(0, 10) ?? "",
  }));

  return books.map((def) => {
    const mine = balances.filter(
      (b) => b.bookId === def.categoryId && b.balance.toNumber() !== 0
    );
    return {
      bookId: def.categoryId,
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
      partners: mine
        .map((b) => ({
          partnerId: b.partnerId,
          partnerLabel: partnerOf.get(b.partnerId)?.partner_label ?? "",
          partnerName: partnerOf.get(b.partnerId)?.partner_name ?? "",
          currencyLabel: b.currency.currency_label,
          balance: b.balance.toNumber(),
          openItems: b.openItems,
          oldest: b.oldest,
        }))
        .sort(
          (a, b) =>
            a.currencyLabel.localeCompare(b.currencyLabel) || b.balance - a.balance
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
  bookId: number,
  partnerId: number,
  currencyId: number,
  db: Db = prisma
): Promise<{ foreign: number; base: number }> {
  const row = await db.subLedgerBalance.aggregate({
    where: { budget_category_id: bookId, partner_id: partnerId, currency_id: currencyId },
    _sum: { balance: true, base_balance: true },
  });
  return {
    foreign: row._sum.balance?.toNumber() ?? 0,
    base: roundBase(row._sum.base_balance?.toNumber() ?? 0),
  };
}

/** One open item over a report's period — the Saldo Buku Subjek's detail row. */
export type SubledgerItemPeriod = {
  id: number;
  itemNo: string;
  /** `YYYY-MM-DD` — when the item was raised. */
  date: string;
  rate: number;
  original: number;
  /** What the entries dated before the period left on the item. */
  opening: number;
  raised: number;
  lowered: number;
  /** `opening + raised − lowered`: what remains on the period's last day. */
  closing: number;
  baseClosing: number;
  note: string | null;
};

/** One Partner and currency in the Saldo Buku Subjek. */
export type SubledgerBalanceRow = Omit<SubledgerSubject, "entries"> & {
  /**
   * Every item that stood or moved in the period, oldest first. Their four
   * figures add up to the row's own, column by column — an item settled
   * inside the period is listed at a closing of nil, because its Berkurang is
   * part of the row's.
   */
  items: SubledgerItemPeriod[];
};

export type SubledgerBalanceGroup = {
  currencyId: number;
  currencyLabel: string;
  rows: SubledgerBalanceRow[];
  opening: number;
  raised: number;
  lowered: number;
  closing: number;
  baseClosing: number;
};

export type SubledgerBalanceReport = {
  book: SubledgerDef;
  range: PeriodRange;
  /** One group per currency, never added across currencies. */
  groups: SubledgerBalanceGroup[];
};

/**
 * Saldo Buku Subjek — every Partner's position in one book over a period, and
 * the open items it is made of.
 *
 * The Partner figures are the Buku Subjek's own (`subledgerReport`), so the
 * two reports cannot disagree about a Partner. Each item is the same entries
 * regrouped by the item they name: its opening is what the entries before the
 * period left on it, its movements are the period's entries that name it. The
 * items therefore add up to their Partner in **every** column by
 * construction, not only in the closing one.
 *
 * A Partner whose position was nil throughout the period and did not move is
 * left out, and so is an item: listing every one that ever held something
 * would bury the ones that do.
 *
 * Totals are per currency. Adding two Partners' Hutang is meaningful — it is
 * what the control account in the General Ledger should hold — while adding
 * USD to rupiah at face value is not.
 */
export async function subledgerBalanceReport(
  books: SubledgerDef[],
  bookId: number | string,
  range: PeriodRange,
  options: { partnerIds?: number[]; companyIds: number[] }
): Promise<SubledgerBalanceReport | null> {
  const ledger = await subledgerReport(books, bookId, range, options);
  if (!ledger) return null;
  const { book } = ledger;

  const subjects = ledger.subjects.filter(
    (s) => s.opening !== 0 || s.entries.length > 0 || s.closing !== 0
  );
  if (!subjects.length) return { book, range, groups: [] };

  type Acc = {
    opening: number;
    baseOpening: number;
    raised: number;
    lowered: number;
    baseMoved: number;
  };
  const acc = new Map<number, Acc>();
  const reach = (id: number): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = { opening: 0, baseOpening: 0, raised: 0, lowered: 0, baseMoved: 0 };
      acc.set(id, a);
    }
    return a;
  };

  const before = await prisma.subLedger.groupBy({
    by: ["balance_id"],
    where: {
      budget_category_id: book.categoryId,
      accounting_date: { lt: startOf(range.from) },
      OR: subjects.map((s) => ({ partner_id: s.partnerId, currency_id: s.currencyId })),
    },
    _sum: { movement: true, base_movement: true },
  });
  for (const b of before) {
    const opening = b._sum?.movement?.toNumber() ?? 0;
    if (cents(opening) === 0) continue;
    const a = reach(b.balance_id);
    a.opening = opening;
    a.baseOpening = b._sum?.base_movement?.toNumber() ?? 0;
  }
  // Signed exactly as `subledgerReport` signs its subjects, so the two sums
  // cannot part company.
  for (const s of subjects) {
    for (const e of s.entries) {
      const a = reach(e.itemId);
      if (e.movement >= 0) a.raised += e.movement;
      else a.lowered += -e.movement;
      a.baseMoved += e.baseMovement;
    }
  }

  const records = acc.size
    ? await prisma.subLedgerBalance.findMany({
        where: { id: { in: [...acc.keys()] } },
        orderBy: [{ opened_date: "asc" }, { id: "asc" }],
      })
    : [];

  const itemsOf = new Map<string, SubledgerItemPeriod[]>();
  for (const r of records) {
    const a = acc.get(r.id)!;
    const k = `${r.partner_id}:${r.currency_id}`;
    itemsOf.set(k, [
      ...(itemsOf.get(k) ?? []),
      {
        id: r.id,
        itemNo: r.item_no,
        date: r.opened_date.toISOString().slice(0, 10),
        rate: r.rate.toNumber(),
        original: r.original.toNumber(),
        opening: a.opening,
        raised: a.raised,
        lowered: a.lowered,
        closing: a.opening + a.raised - a.lowered,
        baseClosing: roundBase(a.baseOpening + a.baseMoved),
        note: r.note,
      },
    ]);
  }

  const groups = new Map<number, SubledgerBalanceGroup>();
  for (const s of subjects) {
    const { entries: _entries, ...rest } = s;
    void _entries;
    let g = groups.get(s.currencyId);
    if (!g) {
      g = {
        currencyId: s.currencyId,
        currencyLabel: s.currencyLabel,
        rows: [],
        opening: 0,
        raised: 0,
        lowered: 0,
        closing: 0,
        baseClosing: 0,
      };
      groups.set(s.currencyId, g);
    }
    g.rows.push({ ...rest, items: itemsOf.get(`${s.partnerId}:${s.currencyId}`) ?? [] });
    g.opening += s.opening;
    g.raised += s.raised;
    g.lowered += s.lowered;
    g.closing += s.closing;
    g.baseClosing = roundBase(g.baseClosing + s.baseClosing);
  }

  return {
    book,
    range,
    groups: [...groups.values()].sort((a, b) =>
      a.currencyLabel.localeCompare(b.currencyLabel)
    ),
  };
}

