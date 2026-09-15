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
 * One set exists today: a Cash & Bank subject plus a date range. A second set
 * arrives when a report needs different parameters — as an added member here,
 * so the route keeps resolving parameters in one place rather than each report
 * parsing the query string its own way.
 */
export type ReportParams = "cash-bank-period";

export type ReportDef = {
  key: string;
  /** URL segment under the module's `report/` namespace. */
  slug: string;
  module: "finance";
  name: string;
  /** Singular subject line shown under the title. */
  desc: string;
  icon: IconName;
  permission: PermissionCode;
  params: ReportParams;
  /** Whether the report can run without a subject chosen. */
  subjectRequired: boolean;
};

export const REPORTS = [
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
] as const satisfies readonly ReportDef[];

export type ReportKey = (typeof REPORTS)[number]["key"];

const BY_SLUG = new Map<string, ReportDef>(REPORTS.map((r) => [r.slug, r]));

export function reportBySlug(slug: string): ReportDef | undefined {
  return BY_SLUG.get(slug);
}

/** `/finance/report/cash-bank-ledger` — the one place a report URL is built. */
export function reportHref(
  slug: string,
  params?: Record<string, string | number | null | undefined>
): string {
  const base = `/finance/report/${slug}`;
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
