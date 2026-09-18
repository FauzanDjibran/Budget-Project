/**
 * The subledger catalogue — which Budget Categories keep a book of their own.
 *
 * A **subledger** is an operational book whose subject is a **Partner** rather
 * than a cash resource or an account (concept doc §11.3–§11.6, §12). It is an
 * independent append-only historical store, written straight from the Cash Bank
 * Transaction at Post, alongside the Cash Bank Book and the Journal — never
 * derived from journal lines (§13, §14).
 *
 * **A book is a Budget Category, not an entry in a list.** This file used to
 * declare six of them, each with its own key, slug, permission and nav entry, so
 * a seventh category meant a code change, a new permission and a deploy. A
 * category earns a book when its postings name a Partner — that is what gives
 * the book a subject — and `require_partner` already says so. Everything else a
 * book needs is either derived from the category row or stored on it, so a
 * category created through the GUI has a working book the moment it is saved.
 *
 * What is derived, and why it is safe to derive:
 *
 *   - **name** — "Buku Hutang". The category already names itself.
 *   - **nature** — a category that moves both ways holds a *position* that can
 *     be settled to nil; one that moves a single way only accumulates, so its
 *     closing figure is a running total. That is exactly `allows_in &&
 *     allows_out`, and it matched all six hand-written entries.
 *   - **desc** — the subject line, composed from the name.
 *
 * What is stored, because no derivation gets it right:
 *
 *   - **raises** — which cash direction raises the subject's position. Money out
 *     raises a Piutang and lowers a Hutang; nothing else in the row predicts it.
 *   - **icon** and **closingLabel** — presentation. "Sisa hutang" and "Investasi
 *     tertanam" are not something a template produces. Both fall back, so a book
 *     without them still works.
 *
 * Client-safe on purpose — no `server-only`, no database import — so the report
 * route, the filter bar and the book writer all read the same definition. The
 * rows come from `loadSubledgers` in `subledger-data.ts`.
 */
import type { IconName } from "@/components/icon";
import type { Direction } from "./classification";

/**
 * How the closing figure should be read.
 *
 * `position` is an outstanding balance that moves both ways and can be settled
 * to nil — what is still owed, still held, still drawn. `cumulative` only ever
 * grows, because the category has a single direction: the figure is a total to
 * date, not something anyone will pay off.
 */
export type SubledgerNature = "position" | "cumulative";

export type SubledgerDef = {
  /**
   * Stored on every entry, and the one identifier a book has.
   *
   * It is the owning category's **code** (`bcat.0002`), not its label and not
   * its row id. The code because it is system-generated and never edited, so
   * renaming "Hutang" cannot orphan a book — which is precisely what keying on
   * the label used to risk. A string rather than a foreign key because
   * `sub_ledger` is an independent store that must stay liftable: a book that
   * declared a relation to the table classifying it could not be taken out on
   * its own, and would invite being derived from it.
   */
  key: string;
  /**
   * The owning Budget Category's row id — how the rest of the application finds
   * its book, because that is the identifier already at hand everywhere: a
   * Budget carries `category_id`, an account mapping carries
   * `budget_category_id`. The stored `key` stays the code, which is what makes
   * an entry readable without a join.
   */
  categoryId: number;
  /** What the owning category is currently called. Display only. */
  budgetCategory: string;
  name: string;
  icon: IconName;
  /** Which cash direction *raises* the subject's position. */
  raises: Direction;
  nature: SubledgerNature;
  /** What the closing figure is, in one noun phrase. */
  closingLabel: string;
  /** The subject line under the report title. */
  desc: string;
};

/** The shape a Budget Category has to present for a book to be built from it. */
export type BookSource = {
  id: number;
  category_code: string;
  category_label: string;
  category_name: string;
  allows_in: boolean;
  allows_out: boolean;
  require_partner: boolean;
  raises: string | null;
  book_icon: string | null;
  book_closing_label: string | null;
};

const DEFAULT_ICON: IconName = "book";

/**
 * Whether this category keeps a book at all.
 *
 * Two conditions, and both are the category's own statement about itself: it
 * must name a Partner, or the book would have no subject (§10 rule 52), and it
 * must say which way the book runs. A category that names a Partner but has no
 * `raises` is a **setup gap** rather than a category without a book — every
 * screen that lists books simply does not list it yet.
 */
export function keepsBook(row: BookSource): boolean {
  return row.require_partner && (row.raises === "In" || row.raises === "Out");
}

/** Builds the book a category keeps, or null where it keeps none. */
export function bookFor(row: BookSource): SubledgerDef | null {
  if (!keepsBook(row)) return null;

  const name = `Buku ${row.category_label}`;
  // Both ways = a position that can be settled to nil; one way = a total that
  // only accumulates. This matched all six hand-written entries exactly.
  const nature: SubledgerNature =
    row.allows_in && row.allows_out ? "position" : "cumulative";

  return {
    key: row.category_code,
    categoryId: row.id,
    budgetCategory: row.category_label,
    name,
    icon: (row.book_icon as IconName) || DEFAULT_ICON,
    raises: row.raises as Direction,
    nature,
    closingLabel:
      row.book_closing_label?.trim() ||
      (nature === "position" ? `Saldo ${row.category_label}` : `Total ${row.category_label}`),
    desc: `Mutasi dan posisi ${name.toLowerCase()} per Partner, pada rentang tanggal yang dipilih.`,
  };
}

export function booksFrom(rows: BookSource[]): SubledgerDef[] {
  return rows.map(bookFor).filter((b): b is SubledgerDef => b !== null);
}

export function subledgerByKey(
  books: SubledgerDef[],
  key: string | null | undefined
): SubledgerDef | null {
  return key ? books.find((b) => b.key === key) ?? null : null;
}

/**
 * The book a Budget Category's postings land in.
 *
 * Found by the category's **row id**, which is the identifier every caller
 * already holds — a Budget's `category_id`, a mapping's
 * `budget_category_id`. Never by its label: a label is display text the user
 * may rename, and a rename would silently stop the book being written.
 *
 * A Transaction Purpose is **not** a way in here. A Purpose is the control an
 * operator picks on a Cash Bank Transaction; it resolves to a Budget Category,
 * and it is that category — not the Purpose — that owns the book.
 */
export function subledgerForCategory(
  books: SubledgerDef[],
  categoryId: number | null | undefined
): SubledgerDef | null {
  return categoryId == null
    ? null
    : books.find((b) => b.categoryId === categoryId) ?? null;
}

/**
 * Which way a movement runs in this book's own terms.
 *
 * A subject book signs by its own direction, not by the cash direction: money
 * leaving raises a Piutang and lowers a Hutang. This is the one place that sign
 * is decided — the subledger's counterpart to the General Ledger's normal-balance
 * signing (§10 rule 53).
 */
export function subledgerMovement(
  book: SubledgerDef,
  direction: Direction,
  amount: number
): number {
  const size = Math.abs(amount);
  return direction === book.raises ? size : -size;
}
