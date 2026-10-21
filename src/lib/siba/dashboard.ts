import "server-only";

import { prisma } from "@/lib/prisma";
import { type MoneyTotal } from "@/lib/format";
import {
  approvedCommitments,
  awaitingClassificationCommitments,
  budgetMonths,
  realizationOutcomes,
  submittedCommitments,
  type CommitmentQueue,
  type CommitmentRow,
  type RealizationOutcomeRow,
} from "./budget";
import { cashBookSummary, type CashBookSummary } from "./cash-bank";
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
 * about all of it.
 *
 * It is a **leaf**: it depends on every module and nothing depends on it, so
 * it can be deleted without disturbing anything (CLAUDE.md §3).
 *
 * ## The one rule the queues are built on
 *
 * Every rupiah of committed money sits in **exactly one** Budget stage —
 * waiting for approval, waiting for classification, or waiting to be realized
 * — and the three together are the whole of what has been committed but has
 * not reached a book. Money a `Pending` document holds is still unrealized
 * (`realized_amount` is written only at Post), so it stays inside the third
 * stage and is marked there, never counted as a stage of its own.
 *
 * Draft records — of a Budget or of a document — appear nowhere.
 */

// ------------------------------------------------------------------- stages

export type StageKey = "approval" | "classification" | "execution";

export type StageRow = CommitmentRow & {
  href: string;
};

export type FunnelStage = {
  key: StageKey;
  name: string;
  href: string;
  count: number;
  totals: MoneyTotal[];
  inTotals: MoneyTotal[];
  outTotals: MoneyTotal[];
  /** Oldest first. */
  rows: StageRow[];
};

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
  intercompany: IntercompanyPosition;
  profitLoss: CompanyProfitLoss[];
  stages: FunnelStage[];
  plan: RealizationOutcomeRow[];
  books: SubledgerPosition[];
};

// --------------------------------------------------------------------- read

export async function dashboardData(
  companyIds: number[],
  periodId: number | null = null
): Promise<DashboardData> {
  const [months, submitted, awaiting, approved, cash, books, bridge] =
    await Promise.all([
      budgetMonths(companyIds),
      submittedCommitments(companyIds),
      awaitingClassificationCommitments(companyIds),
      approvedCommitments(companyIds),
      cashBookSummary(companyIds),
      loadSubledgers().then((defs) => subledgerPositions(defs, companyIds)),
      intercompanyBridge(),
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

  const stage = (
    key: StageKey,
    name: string,
    href: string,
    queue: CommitmentQueue
  ): FunnelStage => ({
    key,
    name,
    href,
    count: queue.count,
    totals: queue.totals,
    inTotals: queue.inTotals,
    outTotals: queue.outTotals,
    rows: queue.rows.map((r) => ({ ...r, href: `/budget/budget/${r.id}` })),
  });

  const stages = [
    stage("approval", "Menunggu Persetujuan", "/budget/budget/month/all?status=Submitted", submitted),
    stage("classification", "Menunggu Klasifikasi", "/budget/klasifikasi", awaiting),
    stage("execution", "Menunggu Direalisasi", "/budget/budget/month/all?status=Open", approved),
  ];

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

  const [plan, profitLoss] = await Promise.all([
    month ? realizationOutcomes(companyIds, month.startDate, month.endDate) : [],
    month ? companyProfitLoss(companyIds, month.startDate) : [],
  ]);

  return {
    months: monthList,
    month,
    cash,
    intercompany: { ok: bridge.ok, missing: bridge.ok ? [] : bridge.missing, sides },
    profitLoss,
    stages,
    plan,
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
