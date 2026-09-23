import "server-only";

import { prisma } from "@/lib/prisma";
import type { ReportableFiscalYear } from "./fiscal";
import { statementMovements } from "./ledger";
import type { PeriodRange } from "./period";
import {
  buildProfitLoss,
  columnRange,
  type StatementAccount,
  type StatementMode,
  type StatementPartner,
  type StatementRow,
} from "./statement-layout";

/**
 * The financial statements — Laba Rugi now, Neraca next.
 *
 * Composed rather than queried: the figures come from `ledger.ts`, the one
 * module allowed to read journal lines, and this file reads only master data —
 * the chart of accounts the rows are laid out on and the Partners a breakdown
 * names. The layout itself is `statement-layout.ts`, pure, so the rules that
 * decide which figure lands on which row are tested without a database.
 *
 * Every statement runs for one Company, like every Report View: a chart of
 * accounts belongs to one, and there is no joint report.
 */

/** One column of a statement: a fiscal year, a period in it, and its range. */
export type StatementColumn = {
  yearId: number;
  yearName: string;
  periodId: number;
  periodName: string;
  range: PeriodRange;
};

/** A year and period the reader picked, resolved against the calendar. */
export function resolveColumn(
  years: ReportableFiscalYear[],
  yearId: number | null,
  periodId: number | null,
  mode: StatementMode
): StatementColumn | null {
  const year = years.find((y) => y.id === yearId);
  const period = year?.periods.find((p) => p.id === periodId);
  if (!year || !period) return null;
  return {
    yearId: year.id,
    yearName: year.name,
    periodId: period.id,
    periodName: period.name,
    range: columnRange(year, period, mode),
  };
}

export type ProfitLossReport = {
  columns: StatementColumn[];
  rows: StatementRow[];
  /** Laba Bersih per column. */
  result: number[];
  unplaced: string[];
};

/**
 * The multi-step Laba Rugi for one Company, over one or two columns.
 *
 * Each column is its own range sum and leaves out **its own year's** closing
 * journal, so a comparison against a closed year reads that year's result
 * rather than the nil a close leaves behind.
 */
export async function profitLossReport(
  companyId: number,
  columns: StatementColumn[]
): Promise<ProfitLossReport> {
  const [accounts, movements] = await Promise.all([
    profitLossChart(companyId),
    Promise.all(
      columns.map((c) =>
        statementMovements(companyId, c.range, {
          section: "ProfitLoss",
          excludeClosingOf: c.yearId,
        })
      )
    ),
  ]);

  const partnerIds = [
    ...new Set(movements.flat().flatMap((m) => (m.partnerId ? [m.partnerId] : []))),
  ];
  const partners = await partnerNames(partnerIds);

  const built = buildProfitLoss(accounts, movements, partners);
  return { columns, rows: built.rows, result: built.result, unplaced: built.unplaced };
}

/**
 * Every Laba Rugi account in one Company's chart, inactive ones included.
 *
 * Inactive stay in because a report covers history: an account retired in June
 * still carried January's figures. Rows that did not move are dropped by the
 * layout, so an old account costs nothing on a period it was silent in.
 */
async function profitLossChart(companyId: number): Promise<StatementAccount[]> {
  const rows = await prisma.accAccount.findMany({
    where: {
      company_id: companyId,
      account_subcategory: {
        account_category: { account_type: { section: "ProfitLoss" } },
      },
    },
    select: {
      id: true,
      account_label: true,
      account_name: true,
      parent_account: true,
      account_subcategory: {
        select: {
          id: true,
          subcategory_label: true,
          subcategory_name: true,
          account_category: {
            select: { id: true, category_label: true, category_name: true, pl_group: true },
          },
        },
      },
    },
  });

  return rows.map((a) => {
    const sub = a.account_subcategory;
    const cat = sub.account_category;
    return {
      id: a.id,
      label: a.account_label,
      name: a.account_name,
      parentId: a.parent_account,
      subcategory: { id: sub.id, label: sub.subcategory_label, name: sub.subcategory_name },
      category: {
        id: cat.id,
        label: cat.category_label,
        name: cat.category_name,
        step: cat.pl_group,
      },
    };
  });
}

async function partnerNames(ids: number[]): Promise<Map<number, StatementPartner>> {
  if (!ids.length) return new Map();
  const rows = await prisma.mPartner.findMany({
    where: { id: { in: ids } },
    select: { id: true, partner_label: true, partner_name: true },
  });
  return new Map(
    rows.map((p) => [p.id, { id: p.id, label: p.partner_label, name: p.partner_name }])
  );
}
