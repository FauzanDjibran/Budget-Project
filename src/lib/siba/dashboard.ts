import "server-only";

import { prisma } from "@/lib/prisma";
import { budgetMonths, listBudgets, type BudgetRow } from "./budget";
import { cashBookSummary, type CashBookSummary } from "./cash-bank";
import { layerReport, type LayerReport } from "./cash-bank-layers";
import { reportableFiscalYears } from "./fiscal";
import { accountPositions, type AccountPosition } from "./ledger";
import { reportHref } from "./reports";
import { profitLossReport, resolveColumn } from "./statements";
import { subledgerPositions, type SubledgerPosition } from "./subledger";
import { loadSubledgers } from "./subledger-data";
import { intercompanyBridge } from "./system-account-data";

/**
 * The dashboard's data, composed from what each module says about its own
 * records.
 *
 * This file names no other module's table. Every figure below is asked for by
 * calling the module that owns it — which is what lets the dashboard summarise
 * the whole application without becoming the one place that knows everything
 * about all of it. Company, Currency and Budget Category are master data.
 *
 * It is a **leaf**: it depends on every module and nothing depends on it, so
 * it can be deleted without disturbing anything (CLAUDE.md §3).
 *
 * Two sections: today's position, which no period moves, and the chosen
 * month — its Budgets and each Company's Laba Rugi to date. Draft records, of
 * a Budget or of a document, appear nowhere.
 */

/** A Budget the month's plan counts: committed, never Draft, refused or withdrawn. */
const PLANNED = new Set(["Submitted", "Approved", "Open", "Closed"]);

// -------------------------------------------------------------------- shape

export type IntercompanyPosition = {
  ok: boolean;
  /** Missing Mapping Account System names, when the bridge is not fully set. */
  missing: string[];
  sides: AccountPosition[];
};

export type CompanyProfitLoss = {
  companyId: number;
  companyLabel: string;
  companyName: string;
  /** Null when the Company's calendar holds no period for the month. */
  column: { yearName: string; periodName: string; href: string } | null;
  /** The multi-step statement's step and result lines. */
  lines: { key: string; name: string; result: boolean; value: number }[];
  net: number;
};

export type DashboardMonth = {
  periodId: number;
  name: string;
  startDate: string;
  endDate: string;
  current: boolean;
};

export type DashboardData = {
  months: DashboardMonth[];
  month: DashboardMonth | null;
  cash: CashBookSummary;
  layers: LayerReport;
  intercompany: IntercompanyPosition;
  profitLoss: CompanyProfitLoss[];
  /** The month's committed Budgets, which the plan tiles read as the Budget page does. */
  budgets: BudgetRow[];
  currencies: { id: number; label: string }[];
  categories: { id: number; label: string }[];
  books: SubledgerPosition[];
};

// --------------------------------------------------------------------- read

export async function dashboardData(
  companyIds: number[],
  periodId: number | null = null
): Promise<DashboardData> {
  const [months, cash, layers, books, bridge, currencies, categories] = await Promise.all([
    budgetMonths(companyIds),
    cashBookSummary(companyIds),
    layerReport(companyIds),
    loadSubledgers().then((defs) => subledgerPositions(defs, companyIds)),
    intercompanyBridge(),
    prisma.refCurrency.findMany({ select: { id: true, currency_label: true } }),
    prisma.sysBudgetCategory.findMany({ select: { id: true, category_label: true } }),
  ]);

  const monthList: DashboardMonth[] = months.map((m) => ({
    periodId: m.periodId,
    name: m.name,
    startDate: m.startDate,
    endDate: m.endDate,
    current: m.current,
  }));
  const month =
    monthList.find((m) => m.periodId === periodId) ??
    monthList.find((m) => m.current) ??
    monthList[0] ??
    null;

  const bridgeIds = bridge.ok
    ? [
        bridge.induk.arAccountId,
        bridge.induk.apAccountId,
        bridge.anak.arAccountId,
        bridge.anak.apAccountId,
      ]
    : [];
  // In the order asked for — induk AR, induk AP, anak AR, anak AP — which the
  // tile reads by position.
  const sides = (await accountPositions(bridgeIds)).sort(
    (a, b) => bridgeIds.indexOf(a.id) - bridgeIds.indexOf(b.id)
  );

  const [budgets, profitLoss] = await Promise.all([
    month && companyIds.length ? listBudgets(month, companyIds) : [],
    month ? companyProfitLoss(companyIds, month.startDate) : [],
  ]);

  return {
    months: monthList,
    month,
    cash,
    layers,
    intercompany: { ok: bridge.ok, missing: bridge.ok ? [] : bridge.missing, sides },
    profitLoss,
    budgets: budgets.filter((b) => PLANNED.has(b.status)),
    currencies: currencies.map((c) => ({ id: c.id, label: c.currency_label })),
    categories: categories.map((c) => ({ id: c.id, label: c.category_label })),
    books: books.filter((b) => b.subjects > 0),
  };
}

/**
 * Each Company's Laba Rugi from its year's first day to the end of the month,
 * read through the report itself so the tile and the report cannot disagree.
 * Each Company keeps its own calendar, so the month is resolved per Company.
 */
async function companyProfitLoss(
  companyIds: number[],
  monthStart: string
): Promise<CompanyProfitLoss[]> {
  const companies = await prisma.sysCompany.findMany({
    where: { id: { in: companyIds } },
    orderBy: [{ is_parent: "desc" }, { id: "asc" }],
    select: { id: true, company_label: true, company_name: true },
  });

  return Promise.all(
    companies.map(async (c) => {
      const base = {
        companyId: c.id,
        companyLabel: c.company_label,
        companyName: c.company_name,
      };
      const years = await reportableFiscalYears(c.id);
      const year = years.find((y) =>
        y.periods.some((p) => p.startDate <= monthStart && monthStart <= p.endDate)
      );
      const period = year?.periods.find(
        (p) => p.startDate <= monthStart && monthStart <= p.endDate
      );
      const column = year && period ? resolveColumn(years, year.id, period.id, "ytd") : null;
      if (!year || !period || !column) {
        return { ...base, column: null, lines: [], net: 0 };
      }

      const report = await profitLossReport(c.id, [column]);
      return {
        ...base,
        column: {
          yearName: year.name,
          periodName: period.name,
          href: reportHref("profit-loss", {
            company: c.id,
            year: year.id,
            period: period.id,
            mode: "ytd",
          }),
        },
        lines: report.rows
          .filter((r) => r.depth === 0 && (r.kind === "step" || r.kind === "subtotal"))
          .map((r) => ({
            key: r.key,
            name: r.name,
            result: r.kind === "subtotal",
            value: r.values[0] ?? 0,
          })),
        net: report.result[0] ?? 0,
      };
    })
  );
}
