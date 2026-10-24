import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatDate } from "@/lib/format";
import { nextDocumentNumber } from "./document-number";
import { relieve, roundBase } from "./fx";
import { subledgerMovement, type SubledgerDef } from "./subledger-catalogue";

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

export type SubledgerEntryType =
  | "Opening"
  | "Transaction"
  | "Adjustment"
  | "Conversion"
  | "Reclass";

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
   * The open item the entry moves (`sub_ledger_balance.id`). Required when
   * the entry lowers the position. On a raise it is optional: named, that open
   * item grows at its own kurs (a Penambahan); left out, the raise opens an
   * item of its own.
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
const cents = (n: number) => Math.round(n * 100);

/**
 * The least an open item holds on any day from `date` to now — what a movement
 * dated `date` may take from it, since a backdated lowering lowers every later
 * day too. Before it opened an item holds nothing, so an item cannot be settled
 * by a document dated before it (§10 rule 106). The movement is placed last on
 * its day, as the reports order it. An item has few entries, so they are read
 * whole rather than kept in a period chain like the Cash Bank Book's.
 */
export async function itemLowestFrom(
  itemId: number,
  date: string,
  db: Db = prisma
): Promise<{ balance: number; at: string }> {
  const entries = await db.subLedger.findMany({
    where: { balance_id: itemId },
    orderBy: [{ accounting_date: "asc" }, { id: "asc" }],
    select: { accounting_date: true, movement: true },
  });
  const day = asDate(date);
  let run = 0;
  let lowest: { run: number; at: Date } | null = null;
  for (const e of entries) {
    if (!lowest && e.accounting_date > day) lowest = { run, at: day };
    run += cents(e.movement.toNumber());
    if (lowest && run < lowest.run) lowest = { run, at: e.accounting_date };
  }
  lowest ??= { run, at: day };
  return { balance: lowest.run / 100, at: formatDate(lowest.at) };
}

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
 * the entry names it — unless the caller names an open item to raise, which a
 * Penyesuaian Open Item's Penambahan does: that item grows at its own kurs. **Lowering one relieves the item the caller chose**, at
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
    budget_category_id: book.categoryId,
    partner_id: entry.partnerId,
    currency_id: entry.currencyId,
  };

  if (movement > 0 && entry.itemId) {
    return raiseItem(db, entry, key, movement, amount);
  }

  if (movement > 0) {
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
        accounting_date: asDate(entry.date),
        entry_type: entry.type,
        movement,
        rate: entry.rate,
        base_movement: base,
        source_doc_type_id: entry.sourceDocTypeId ?? null,
        source_doc_id: entry.sourceDocId ?? null,
        note: entry.note ?? null,
        created_by: entry.actorId,
      },
    });
    await db.subLedgerBalance.update({
      where: { id: item.id },
      data: { last_entry_id: created.id, last_entry_date: created.accounting_date },
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
    item.budget_category_id !== key.budget_category_id ||
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
  const lowest = await itemLowestFrom(item.id, entry.date, db);
  if (cents(amount) > cents(lowest.balance)) {
    throw new SubledgerItemUnavailable(
      `Open item ${item.item_no} tinggal ${lowest.balance} pada ${lowest.at}, tidak cukup untuk ${amount}. ` +
        "Posisi tidak boleh di bawah nol pada hari mana pun — ubah tanggal akuntansi atau kurangi nominalnya."
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
      accounting_date: asDate(entry.date),
      entry_type: entry.type,
      movement,
      // The item's own rate: relief keeps `base ÷ foreign` on it.
      rate: item.rate,
      base_movement: -relief.base,
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
      last_entry_date: created.accounting_date,
    },
  });
  return created;
}

/**
 * Raises an open item the caller named — a Penyesuaian Open Item's Penambahan,
 * the one path that grows an item rather than opening a new one. The item is
 * raised at **its own** kurs, so its `base ÷ foreign` stays its rate and no
 * second rate enters it. Only an item still Open may be raised.
 */
async function raiseItem(
  db: Db,
  entry: NewSubledgerEntry,
  key: { budget_category_id: number; partner_id: number; currency_id: number },
  movement: number,
  amount: number
) {
  const item = await db.subLedgerBalance.findUnique({ where: { id: entry.itemId! } });
  if (
    !item ||
    item.budget_category_id !== key.budget_category_id ||
    item.partner_id !== key.partner_id ||
    item.currency_id !== key.currency_id
  ) {
    throw new SubledgerItemUnavailable(
      "Open item yang dipilih bukan milik buku, Partner, dan currency baris ini."
    );
  }
  if (item.status !== "Open") {
    throw new SubledgerItemUnavailable(
      `Open item ${item.item_no} sudah selesai dan tidak dapat ditambah.`
    );
  }
  // An item holds nothing before it opened, raised or lowered (§10 rule 106).
  if (asDate(entry.date) < item.opened_date) {
    throw new SubledgerItemUnavailable(
      `Open item ${item.item_no} baru dibuka pada ${formatDate(item.opened_date)}, ` +
        "tidak dapat ditambah dengan tanggal sebelumnya."
    );
  }
  const base = roundBase(amount * item.rate.toNumber());
  if (entry.baseAmount != null && roundBase(entry.baseAmount) !== base) {
    throw new SubledgerItemUnavailable(
      `Open item ${item.item_no} berubah sejak dokumen divaluasi. Ulangi Post.`
    );
  }
  const after = {
    foreign: item.balance.toNumber() + amount,
    base: roundBase(item.base_balance.toNumber() + base),
  };
  const created = await db.subLedger.create({
    data: {
      entry_no: await nextEntryNo(db),
      ...key,
      balance_id: item.id,
      accounting_date: asDate(entry.date),
      entry_type: entry.type,
      movement,
      rate: item.rate,
      base_movement: base,
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
      entry_count: item.entry_count + 1,
      last_entry_id: created.id,
      last_entry_date: created.accounting_date,
    },
  });
  return created;
}

/**
 * Whether a book has any entry at all. Once it does, the way it runs
 * (`raises`) is fixed: an entry stores only its signed movement, and the cash
 * direction behind it is read back from that sign and `raises` — flipping
 * `raises` would turn every entry already written around.
 */
export async function bookHasEntries(budgetCategoryId: number): Promise<boolean> {
  const row = await prisma.subLedger.findFirst({
    where: { budget_category_id: budgetCategoryId },
    select: { id: true },
  });
  return row != null;
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
    select: { id: true, movement: true, base_movement: true, accounting_date: true },
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
      last_entry_date: last?.accounting_date ?? null,
    },
  });
  return { balance, baseBalance };
}

/**
 * Recomputes every open item of one subject, and returns the position they
 * add up to.
 */
export async function rebuildSubledgerBalance(
  bookId: number,
  partnerId: number,
  currencyId: number
): Promise<{ balance: number; baseBalance: number }> {
  const items = await prisma.subLedgerBalance.findMany({
    where: { budget_category_id: bookId, partner_id: partnerId, currency_id: currencyId },
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

// ---------------------------------------------------------------- open items

export type SubledgerItem = {
  id: number;
  itemNo: string;
  /** The book's Budget Category id. */
  bookId: number;
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
  budget_category_id: number;
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
  bookId: r.budget_category_id,
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
  subjects: { bookId: number; partnerId: number; currencyId: number }[]
): Promise<SubledgerItem[]> {
  if (!subjects.length) return [];
  const rows = await prisma.subLedgerBalance.findMany({
    where: {
      status: "Open",
      OR: subjects.map((s) => ({
        budget_category_id: s.bookId,
        partner_id: s.partnerId,
        currency_id: s.currencyId,
      })),
    },
    orderBy: [{ opened_date: "asc" }, { id: "asc" }],
  });
  return rows.map(toItem);
}

/**
 * Every item still open for these Partners in these currencies, across every
 * book, oldest first — what a form offering a choice of book and Partner reads
 * in one query rather than one per combination.
 */
export async function openSubledgerItemsFor(
  partnerIds: number[],
  currencyIds: number[]
): Promise<SubledgerItem[]> {
  if (!partnerIds.length || !currencyIds.length) return [];
  const rows = await prisma.subLedgerBalance.findMany({
    where: {
      status: "Open",
      partner_id: { in: partnerIds },
      currency_id: { in: currencyIds },
    },
    orderBy: [{ opened_date: "asc" }, { id: "asc" }],
  });
  return rows.map(toItem);
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
  bookId: number,
  partnerId: number,
  currencyId: number
): Promise<void> {
  const key = `sub_ledger_balance:${bookId}:${partnerId}:${currencyId}`;
  await db.$queryRaw`SELECT 1 AS held FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS lock`;
}

/**
 * Every standing position among these books and Partners, on both measures —
 * `subledgerPosition` for a whole picker at once, in one query. Positions at
 * nothing on both measures are left out.
 */
export async function subledgerPositionsFor(
  bookIds: number[],
  partnerIds: number[]
): Promise<
  { bookId: number; partnerId: number; currencyId: number; foreign: number; base: number }[]
> {
  if (!bookIds.length || !partnerIds.length) return [];
  const rows = await prisma.subLedgerBalance.groupBy({
    by: ["budget_category_id", "partner_id", "currency_id"],
    where: { budget_category_id: { in: bookIds }, partner_id: { in: partnerIds } },
    _sum: { balance: true, base_balance: true },
  });
  return rows
    .map((r) => ({
      bookId: r.budget_category_id,
      partnerId: r.partner_id,
      currencyId: r.currency_id,
      foreign: r._sum.balance?.toNumber() ?? 0,
      base: roundBase(r._sum.base_balance?.toNumber() ?? 0),
    }))
    .filter((r) => r.foreign !== 0 || r.base !== 0);
}
