/**
 * The subledger catalogue — which Budget Categories keep a book of their own.
 *
 * A **subledger** is an operational book whose subject is a **Partner** rather
 * than a cash resource or an account (concept doc §11.3–§11.6, §12). It is an
 * independent append-only historical store, written straight from the Cash Bank
 * Transaction at Post, alongside the Cash Bank Book and the Journal — never
 * derived from journal lines (§13, §14).
 *
 * A category earns a book when its postings name a Partner: that is what gives
 * the book a subject. Of the eight Budget Categories in `rules.ts`, six do —
 * the four the concept doc names (Titipan, Hutang, Piutang, Prive) plus
 * Investasi and Hasil Investasi, which carry a Cabang and would otherwise move
 * a Partner with no subject history to show for it, failing the coherence test
 * of §23. Asset and Biaya take no Partner and therefore keep no book.
 *
 * Declared in code, for the same reason the permission catalogue and the 22
 * Purposes are: a book is a branch in the code and a screen somebody wrote, so
 * a row created at runtime would name a book that does not exist.
 *
 * Client-safe on purpose — no `server-only`, no database import — so the
 * report route, the filter bar and the book writer all read the same entry.
 */
import type { IconName } from "@/components/icon";
import type { PermissionCode } from "./permissions";
import type { Direction } from "./rules";

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
  /** Stored on every entry. Stable: the book is keyed on this, not on a row id. */
  key: string;
  /** The `sys_budget_category` label whose postings land here. */
  budgetCategory: string;
  name: string;
  /** URL segment under the module's `report/` namespace. */
  slug: string;
  icon: IconName;
  permission: PermissionCode;
  /** Which cash direction *raises* the subject's position. */
  raises: Direction;
  nature: SubledgerNature;
  /** What the closing figure is, in one noun phrase. */
  closingLabel: string;
  /** The subject line under the report title. */
  desc: string;
};

export const SUBLEDGERS = [
  {
    key: "titipan",
    budgetCategory: "Titipan",
    name: "Buku Titipan",
    slug: "titipan-ledger",
    icon: "wallet",
    permission: "REPORT_TITIPAN_LEDGER_VIEW",
    // A liability: money received is money held for someone, so In raises it.
    raises: "In",
    nature: "position",
    closingLabel: "Titipan dipegang",
    desc:
      "Riwayat titipan setiap Partner pada rentang tanggal — dana yang diterima, " +
      "dikembalikan, dan yang masih dipegang.",
  },
  {
    key: "hutang",
    budgetCategory: "Hutang",
    name: "Buku Hutang",
    slug: "hutang-ledger",
    icon: "coin",
    permission: "REPORT_HUTANG_LEDGER_VIEW",
    // A liability: receiving a loan raises the obligation, paying lowers it.
    raises: "In",
    nature: "position",
    closingLabel: "Sisa hutang",
    desc:
      "Riwayat hutang kepada setiap Partner pada rentang tanggal — penerimaan " +
      "pinjaman, pembayaran, dan sisa kewajiban.",
  },
  {
    key: "piutang",
    budgetCategory: "Piutang",
    name: "Buku Piutang",
    slug: "piutang-ledger",
    icon: "clip",
    permission: "REPORT_PIUTANG_LEDGER_VIEW",
    // An asset: money lent out raises the claim, repayment lowers it.
    raises: "Out",
    nature: "position",
    closingLabel: "Sisa piutang",
    desc:
      "Riwayat piutang kepada setiap Partner pada rentang tanggal — pemberian " +
      "pinjaman, pelunasan, dan sisa tagihan.",
  },
  {
    key: "prive",
    budgetCategory: "Prive",
    name: "Buku Prive",
    slug: "prive-ledger",
    icon: "user",
    permission: "REPORT_PRIVE_LEDGER_VIEW",
    // Contra-equity: a drawing raises it, a repayment by the owner lowers it.
    raises: "Out",
    nature: "position",
    closingLabel: "Prive berjalan",
    desc:
      "Riwayat prive setiap Stakeholder pada rentang tanggal — pengambilan, " +
      "pengembalian, dan saldo berjalan.",
  },
  {
    key: "investasi",
    budgetCategory: "Investasi",
    name: "Buku Investasi",
    slug: "investasi-ledger",
    icon: "layers",
    permission: "REPORT_INVESTASI_LEDGER_VIEW",
    // An asset, but one-way today: `rules.ts` gives Investasi no In direction,
    // so nothing lowers it. Divestment would be a new Purpose, not a new book.
    raises: "Out",
    nature: "cumulative",
    closingLabel: "Investasi tertanam",
    desc:
      "Riwayat penyertaan dana ke setiap Cabang pada rentang tanggal, dan total " +
      "yang sudah tertanam.",
  },
  {
    key: "hasil-investasi",
    budgetCategory: "Hasil Investasi",
    name: "Buku Hasil Investasi",
    slug: "hasil-investasi-ledger",
    icon: "thumb",
    permission: "REPORT_HASIL_INVESTASI_LEDGER_VIEW",
    // Income, In only: a flow, so the closing figure is a total to date.
    raises: "In",
    nature: "cumulative",
    closingLabel: "Hasil diterima",
    desc:
      "Riwayat hasil investasi yang diterima dari setiap Cabang pada rentang " +
      "tanggal, dan total penerimaannya.",
  },
] as const satisfies readonly SubledgerDef[];

export type SubledgerKey = (typeof SUBLEDGERS)[number]["key"];

const BY_KEY = new Map<string, SubledgerDef>(SUBLEDGERS.map((s) => [s.key, s]));
const BY_CATEGORY = new Map<string, SubledgerDef>(
  SUBLEDGERS.map((s) => [s.budgetCategory, s])
);
const BY_SLUG = new Map<string, SubledgerDef>(SUBLEDGERS.map((s) => [s.slug, s]));

export function subledgerByKey(key: string | null | undefined): SubledgerDef | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

/** The book a Budget Category posts into, or null where it keeps none. */
export function subledgerForCategory(
  categoryLabel: string | null | undefined
): SubledgerDef | null {
  return categoryLabel ? BY_CATEGORY.get(categoryLabel) ?? null : null;
}

export function subledgerBySlug(slug: string): SubledgerDef | null {
  return BY_SLUG.get(slug) ?? null;
}

/**
 * The signed movement one entry makes on its subject's position.
 *
 * The sign follows the **book's** own direction, not the cash direction: money
 * leaving the company raises a Piutang and lowers a Hutang, so a book that
 * simply mirrored the cash flow would report every balance backwards. This is
 * the subledger's counterpart to the General Ledger's normal-balance signing.
 */
export function subledgerMovement(
  book: SubledgerDef,
  direction: Direction,
  amount: number
): number {
  const size = Math.abs(amount);
  return direction === book.raises ? size : -size;
}
