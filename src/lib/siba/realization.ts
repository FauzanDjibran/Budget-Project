/**
 * The two Realisasi Budget menus, stated once.
 *
 * A realization is one table (`fin_cash_bank_transaction`) and two menus: which
 * menu a document is opened from fixes its direction, and the direction decides
 * its route, its number series and every heading it carries. Nothing here reads
 * the database, so the pages, the form and the Server Action share one answer.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { Direction } from "./classification";

export type RealizationKind = {
  direction: Direction;
  /** Route segment under `/finance`. */
  slug: string;
  /** Menu name and page heading. */
  title: string;
  /** Number series — `RBM-0001` for money in, `RBK-0001` for money out. */
  prefix: string;
};

export const REALIZATIONS: Record<Direction, RealizationKind> = {
  In: {
    direction: "In",
    slug: "realisasi-penerimaan",
    title: "Realisasi Penerimaan",
    prefix: "RBM",
  },
  Out: {
    direction: "Out",
    slug: "realisasi-pengeluaran",
    title: "Realisasi Pengeluaran",
    prefix: "RBK",
  },
};

export function realizationOf(direction: string): RealizationKind {
  return REALIZATIONS[direction === "In" ? "In" : "Out"];
}

/** The list, or one document, of the menu a direction belongs to. */
export function realizationHref(direction: string, id?: number | string): string {
  const base = `/finance/${realizationOf(direction).slug}`;
  return id == null ? base : `${base}/${id}`;
}
