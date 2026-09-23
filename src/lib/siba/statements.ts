import "server-only";

import { prisma } from "@/lib/prisma";
import type { ReportableFiscalYear } from "./fiscal";
import { roundBase } from "./fx";
import {
  statementBalances,
  statementMovements,
  type OpeningProvenance,
  type StatementMovement,
} from "./ledger";
import type { PeriodRange } from "./period";
import { neracaAccountsFor } from "./system-settings";
import {
  buildBalanceSheet,
  buildProfitLoss,
  columnRange,
  type StatementAccount,
  type StatementMode,
  type StatementPartner,
  type StatementRow,
} from "./statement-layout";

/**
 * The financial statements — the Laba Rugi and the Neraca.
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

// ------------------------------------------------------------------ neraca

export type BalanceSheetReport =
  | {
      ok: true;
      columns: StatementColumn[];
      rows: StatementRow[];
      debitTotal: number[];
      creditTotal: number[];
      unplaced: string[];
      /** The snapshot each column opened from, where there was one. */
      openingFrom: (OpeningProvenance | null)[];
      /** Computed-line accounts that nonetheless carry postings, by name. */
      postedOnComputed: string[];
      /**
       * Columns whose profit from before the year is not nil although no
       * earlier year is still open — a closed year that was not emptied.
       */
      unclosedWithoutYear: number[];
    }
  | { ok: false; missing: string[] };

/**
 * The Neraca for one Company, at the end of each column's period.
 *
 * Every balance-sheet account stands at its **cumulative** balance, opened
 * from the snapshot on or before the column's year start and carried forward
 * from there. Equity then needs the profit nothing has posted into it yet, and
 * that is split at the year's first day into two computed figures, each placed
 * on the account System Default names:
 *
 *   - **Tahun Berjalan** — the Laba Rugi lines dated from the year's first day
 *     to the column's last, leaving out the year's own closing journal. It is
 *     the same range sum as the Laba Rugi's s.d. Periode ini, by construction.
 *   - **Tahun Lalu Belum Ditutup** — every Laba Rugi line dated before the
 *     year that no close has emptied. Nil once the previous year is closed;
 *     the previous year's result while it is not.
 *
 * Nothing is posted and nothing is estimated: both figures are sums of lines
 * that were posted, and the Neraca balances because every journal does.
 *
 * Refused, by name, when the accounts to place them on are not set — the
 * user's rule. Belum Ditutup is asked for only when some column has a figure
 * for it.
 */
export async function balanceSheetReport(
  company: { id: number; isParent: boolean },
  columns: StatementColumn[],
  /** The first day of the year this Company is still carrying unclosed, if any. */
  carriedYearStart: string | null
): Promise<BalanceSheetReport> {
  const figures = await Promise.all(
    columns.map(async (c) => {
      const yearStart = c.range.from;
      const [balances, current, prior] = await Promise.all([
        statementBalances(company.id, {
          section: "BalanceSheet",
          openingOn: yearStart,
          to: c.range.to,
          excludeClosingOf: c.yearId,
        }),
        statementMovements(company.id, c.range, {
          section: "ProfitLoss",
          excludeClosingOf: c.yearId,
        }),
        statementBalances(company.id, {
          section: "ProfitLoss",
          openingOn: yearStart,
          to: dayBefore(yearStart),
        }),
      ]);
      const result = (pairs: StatementMovement[]) =>
        roundBase(pairs.reduce((s, p) => s + p.credit - p.debit, 0));
      return {
        balances,
        current: result(current),
        prior: result(prior.pairs),
        carrying: carriedYearStart !== null && carriedYearStart < yearStart,
      };
    })
  );

  const needsUnclosed = figures.some((f) => f.carrying || Math.round(f.prior * 100) !== 0);
  const accounts = await neracaAccountsFor(company.isParent, needsUnclosed);
  if (!accounts.ok) return accounts;

  const placed = new Map<number, number[]>();
  placed.set(accounts.currentId, figures.map((f) => f.current));
  if (accounts.unclosedId) {
    const unclosed = figures.map((f) => f.prior);
    placed.set(
      accounts.unclosedId,
      accounts.unclosedId === accounts.currentId
        ? unclosed.map((v, i) => roundBase(v + figures[i].current))
        : unclosed
    );
  }

  const chart = await balanceSheetChart(company.id);
  const pairs = figures.map((f) => f.balances.pairs);
  const partnerIds = [...new Set(pairs.flat().flatMap((p) => (p.partnerId ? [p.partnerId] : [])))];
  const built = buildBalanceSheet(chart, pairs, await partnerNames(partnerIds), placed);

  // A computed line's account is a control account nothing may post to, so a
  // balance on it was written some other way. It is added in rather than
  // dropped — the Neraca would not balance otherwise — and named.
  const postedOnComputed = chart
    .filter((a) => placed.has(a.id))
    .filter((a) =>
      pairs.some((col) =>
        col.some((p) => p.accountId === a.id && Math.round((p.debit - p.credit) * 100) !== 0)
      )
    )
    .map((a) => `${a.label} ${a.name}`);

  return {
    ok: true,
    columns,
    rows: built.rows,
    debitTotal: built.debitTotal,
    creditTotal: built.creditTotal,
    unplaced: built.unplaced,
    openingFrom: figures.map((f) => f.balances.openingFrom),
    postedOnComputed,
    unclosedWithoutYear: figures.flatMap((f, i) =>
      !f.carrying && Math.round(f.prior * 100) !== 0 ? [i] : []
    ),
  };
}

/** Every balance-sheet account in one Company's chart, with its type's side. */
async function balanceSheetChart(companyId: number): Promise<StatementAccount[]> {
  const rows = await prisma.accAccount.findMany({
    where: {
      company_id: companyId,
      account_subcategory: {
        account_category: { account_type: { section: "BalanceSheet" } },
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
            select: {
              id: true,
              category_label: true,
              category_name: true,
              account_type: {
                select: { id: true, type_label: true, type_name: true, normal_balance: true },
              },
            },
          },
        },
      },
    },
  });

  return rows.map((a) => {
    const sub = a.account_subcategory;
    const cat = sub.account_category;
    const type = cat.account_type;
    return {
      id: a.id,
      label: a.account_label,
      name: a.account_name,
      parentId: a.parent_account,
      subcategory: { id: sub.id, label: sub.subcategory_label, name: sub.subcategory_name },
      category: { id: cat.id, label: cat.category_label, name: cat.category_name, step: null },
      type: {
        id: type.id,
        label: type.type_label,
        name: type.type_name,
        credit: type.normal_balance === "Kredit",
      },
    };
  });
}

/** `YYYY-MM-DD`, one day earlier. */
function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
