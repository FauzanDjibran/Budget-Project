/**
 * The report catalogue — every Report View in the application, declared once.
 *
 * A **Report View** is a screen whose whole purpose is to show a report: it is
 * parameterised, it restates what it was run for, it reconciles its own
 * arithmetic, and it never writes. The convention is recorded in CLAUDE.md §12;
 * this file is its index.
 *
 * Declared in code rather than in a table for the same reason the permission
 * catalogue is: a report is a page somebody wrote, so a row created at runtime
 * would name a report that does not exist. `sys_*` holds no report definitions.
 *
 * Client-safe on purpose — no `server-only` and no database import — so the
 * navigation, the route and the page body all read the same entry.
 */
import type { IconName } from "@/components/icon";
import type { PermissionCode } from "./permissions";

/**
 * Which parameters a report takes.
 *
 * Three sets exist: a Cash & Bank subject plus a date range, several accounts
 * plus a date range, and several Partners plus a date range. A fourth arrives
 * when a report needs different parameters — as an added member here, so the
 * route keeps resolving parameters in one place rather than each report parsing
 * the query string its own way.
 */
export type ReportParams =
  | "cash-bank-period"
  | "account-period"
  | "subledger-period"
  /**
   * A Cash & Bank subject with **no** date range — for a report whose answer is
   * a standing position rather than a period's movement. Rate layers are that:
   * what an account holds right now is what a payment can be made against.
   */
  | "cash-bank";

export type ReportDef = {
  key: string;
  /** URL segment under the module's `report/` namespace. */
  slug: string;
  module: "finance" | "accounting";
  name: string;
  /** Singular subject line shown under the title. */
  desc: string;
  icon: IconName;
  permission: PermissionCode;
  params: ReportParams;
  /** Whether the report can run without a subject chosen. */
  subjectRequired: boolean;
  /**
   * Whether this report reads a subject book. Which book is a **parameter**
   * (`?book=bcat.0002`), not a property of the report: there is one Buku Subjek
   * report and the books come from the Budget Categories, so a new category
   * appears in its toggle without a report, a permission or a menu entry being
   * written for it.
   */
  subledger?: boolean;
};

const FIXED_REPORTS = [
  {
    key: "cash_bank_ledger",
    slug: "cash-bank-ledger",
    module: "finance",
    name: "Buku Kas & Bank",
    desc:
      "Seluruh mutasi satu resource kas atau bank pada rentang tanggal yang dipilih, " +
      "lengkap dengan saldo awal dan saldo akhir.",
    icon: "book",
    permission: "REPORT_CASH_BANK_LEDGER_VIEW",
    params: "cash-bank-period",
    // A book is a book *of* something: without a resource there is nothing to
    // show, so the report asks before it runs.
    subjectRequired: true,
  },
  {
    key: "cash_bank_balance",
    slug: "cash-bank-balance",
    module: "finance",
    name: "Saldo Kas & Bank",
    desc:
      "Saldo awal, total penerimaan, total pengeluaran, dan saldo akhir setiap " +
      "resource kas dan bank pada rentang tanggal yang dipilih.",
    icon: "wallet",
    permission: "REPORT_CASH_BANK_BALANCE_VIEW",
    params: "cash-bank-period",
    // Every resource at once is the useful default; narrowing to one is a
    // filter, not a precondition.
    subjectRequired: false,
  },
  {
    key: "cash_bank_layer",
    slug: "cash-bank-layer",
    module: "finance",
    name: "Posisi Layer Kurs",
    desc:
      "Layer kurs setiap resource mata uang asing — berapa yang tersisa pada " +
      "masing-masing kurs perolehan, dan dari dokumen mana currency itu masuk.",
    icon: "layers",
    permission: "REPORT_CASH_BANK_LAYER_VIEW",
    // No date range: a layer position is what an account holds *now*, which is
    // the figure a payment is made against. "What did it hold in March" is a
    // different question and the Cash Bank Book answers it.
    params: "cash-bank",
    subjectRequired: false,
  },
  {
    key: "general_ledger",
    slug: "general-ledger",
    module: "accounting",
    name: "General Ledger",
    desc:
      "Mutasi setiap account yang dipilih pada rentang tanggal, lengkap dengan saldo " +
      "awal dan saldo akhir — satu tabel per account.",
    icon: "tree",
    permission: "REPORT_GENERAL_LEDGER_VIEW",
    params: "account-period",
    // A ledger is a ledger *of* an account: without one there is nothing to
    // show. Several at once is the point, but zero is not a run.
    subjectRequired: true,
  },
  {
    key: "trial_balance",
    slug: "trial-balance",
    module: "accounting",
    name: "Trial Balance",
    desc:
      "Saldo awal, mutasi debit, mutasi kredit, dan saldo akhir seluruh account yang " +
      "bergerak pada rentang tanggal — per currency, dengan uji keseimbangan.",
    icon: "calc",
    permission: "REPORT_TRIAL_BALANCE_VIEW",
    params: "account-period",
    // Every account at once is the whole idea of a trial balance.
    subjectRequired: false,
  },
] as const satisfies readonly ReportDef[];

/**
 * The subject books — **one** Report View for all of them.
 *
 * This was six near-identical entries generated from a six-entry catalogue, so
 * a seventh book meant a code change, a new permission and a deploy. A book is
 * now a Budget Category that names a Partner, and which book you are reading is
 * a parameter on this one report. Nothing here enumerates them.
 */
const SUBLEDGER_REPORT: ReportDef = {
  key: "subledger",
  slug: "subledger",
  module: "finance",
  name: "Buku Subjek",
  desc: "Riwayat dan posisi setiap Partner pada buku yang dipilih, dalam rentang tanggal yang dipilih.",
  icon: "book",
  permission: "REPORT_SUBLEDGER_VIEW",
  params: "subledger-period",
  // Neither the book nor the Partner is a precondition: the report opens on the
  // first book with every subject in it, which is the useful default.
  subjectRequired: false,
  subledger: true,
};

export const REPORTS: readonly ReportDef[] = [...FIXED_REPORTS, SUBLEDGER_REPORT];

export type ReportKey = (typeof FIXED_REPORTS)[number]["key"];

const BY_SLUG = new Map<string, ReportDef>(REPORTS.map((r) => [r.slug, r]));

export function reportBySlug(slug: string): ReportDef | undefined {
  return BY_SLUG.get(slug);
}

/** `/finance/report/cash-bank-ledger` — the one place a report URL is built. */
export function reportHref(
  slug: string,
  params?: Record<string, string | number | null | undefined>
): string {
  const base = `/${BY_SLUG.get(slug)?.module ?? "finance"}/report/${slug}`;
  if (!params) return base;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }
  const search = query.toString();
  return search ? `${base}?${search}` : base;
}
