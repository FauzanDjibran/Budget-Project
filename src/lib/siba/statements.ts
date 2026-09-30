import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { carriedYearsBefore, type ReportableFiscalYear } from "./fiscal";
import { roundBase } from "./fx";
import {
  statementBalances,
  statementMovements,
  trialBalanceReport,
  type TrialBalanceReport as TrialBalanceFigures,
  type OpeningProvenance,
  type StatementMovement,
} from "./ledger";
import type { PeriodRange } from "./period";
import { neracaAccountsFor } from "./system-account-data";
import {
  buildBalanceSheet,
  buildProfitLoss,
  buildTrialBalance,
  columnRange,
  type StatementAccount,
  type StatementMode,
  type StatementPartner,
  type StatementRow,
  type TrailingLine,
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
      /** The unclosed years the Neraca prints a line for, oldest first. */
      carried: { name: string }[];
      /**
       * Columns whose profit from before the year is not wholly accounted for
       * by the unclosed years — a closed year that was not emptied, or a line
       * dated outside every fiscal year.
       */
      unattributed: number[];
    }
  | { ok: false; missing: string[] };

/** The label a year's own line carries on the Neraca. */
export function carriedYearLineName(yearLabel: string): string {
  return `Laba/Rugi ${yearLabel}`;
}

/**
 * The Neraca for one Company, at the end of each column's period.
 *
 * Every balance-sheet account stands at its **cumulative** balance, opened
 * from the snapshot on or before the column's year start and carried forward
 * from there. Equity then needs the profit nothing has posted into it yet:
 *
 *   - **Tahun Berjalan** — the Laba Rugi lines dated from the year's first day
 *     to the column's last, leaving out the year's own closing journal, placed
 *     on the account System Default names. It is the same range sum as the Laba
 *     Rugi's s.d. Periode ini, by construction.
 *   - **one line per unclosed year** — every earlier year this Company has not
 *     closed, each stating that year's whole result, printed directly beneath
 *     Laba/Rugi Tahun Sebelumnya. A year stays on its own line until its close
 *     moves the result into Tahun Sebelumnya, so a reader sees each year apart
 *     rather than one figure blending several.
 *
 * Nothing is posted and nothing is estimated: every figure is a sum of lines
 * that were posted, and the Neraca balances because every journal does. The
 * year lines together equal the whole Laba Rugi before the year; whatever they
 * do not account for is added on a line of its own and named, never dropped.
 *
 * Refused, by name, when the accounts to place them on are not set — the
 * user's rule. Tahun Sebelumnya is asked for only when there are year lines to
 * anchor beneath it.
 */
export async function balanceSheetReport(
  company: { id: number; isParent: boolean },
  columns: StatementColumn[],
  years: ReportableFiscalYear[]
): Promise<BalanceSheetReport> {
  const latestStart = columns.map((c) => c.range.from).sort().at(-1)!;
  const result = (pairs: StatementMovement[]) =>
    roundBase(pairs.reduce((s, p) => s + p.credit - p.debit, 0));

  // A year's result is the same whichever column asks, so it is summed once.
  // Its own range, with nothing left out: an unclosed year has no closing
  // journal to leave out.
  const carried = await Promise.all(
    (await carriedYearsBefore(company.id, latestStart)).map(async (y) => ({
      ...y,
      result: result(
        await statementMovements(
          company.id,
          { from: y.startDate, to: y.endDate },
          { section: "ProfitLoss" }
        )
      ),
    }))
  );

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
      // Only the years before this column's own year are carried by it.
      const lines = carried.map((y) => (y.startDate < yearStart ? y.result : 0));
      const priorTotal = result(prior.pairs);
      return {
        balances,
        current: result(current),
        lines,
        residue: roundBase(priorTotal - lines.reduce((s, v) => s + v, 0)),
      };
    })
  );

  const shown = carried.filter((y) => columns.some((c) => y.startDate < c.range.from));
  const hasResidue = figures.some((f) => Math.round(f.residue * 100) !== 0);
  const accounts = await neracaAccountsFor(company.isParent, shown.length > 0 || hasResidue);
  if (!accounts.ok) return accounts;

  const placed = new Map<number, number[]>();
  placed.set(accounts.currentId, figures.map((f) => f.current));

  const trailing = new Map<number, TrailingLine[]>();
  if (accounts.accumulatedId) {
    const lines: TrailingLine[] = shown.map((y) => {
      const i = carried.indexOf(y);
      const last = years.find((fy) => fy.id === y.id)?.periods.at(-1);
      return {
        key: `y${y.id}`,
        name: carriedYearLineName(y.label),
        values: figures.map((f) => f.lines[i]),
        ...(last ? { profitLoss: { yearId: y.id, periodId: last.id } } : {}),
      };
    });
    if (hasResidue) {
      lines.push({
        key: "yrest",
        name: "Laba/Rugi lain yang belum dipindahkan",
        values: figures.map((f) => f.residue),
      });
    }
    trailing.set(accounts.accumulatedId, lines);
  }

  const chart = await typedChart({
    company_id: company.id,
    account_subcategory: { account_category: { account_type: { section: "BalanceSheet" } } },
  });
  const pairs = figures.map((f) => f.balances.pairs);
  const partnerIds = [...new Set(pairs.flat().flatMap((p) => (p.partnerId ? [p.partnerId] : [])))];
  const built = buildBalanceSheet(chart, pairs, await partnerNames(partnerIds), placed, trailing);

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
    carried: shown.map((y) => ({ name: y.name })),
    unattributed: figures.flatMap((f, i) => (Math.round(f.residue * 100) !== 0 ? [i] : [])),
  };
}

/**
 * Accounts of one Company's chart with their type's side — every balance-sheet
 * account for the Neraca, every account for the Trial Balance.
 */
async function typedChart(
  where: Prisma.AccAccountWhereInput
): Promise<(StatementAccount & { active: boolean })[]> {
  const rows = await prisma.accAccount.findMany({
    where,
    select: {
      id: true,
      is_active: true,
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
      active: a.is_active,
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

export type TrialBalanceStatement = {
  range: PeriodRange;
  /** Saldo Awal, Mutasi Debit, Mutasi Kredit, Saldo Akhir per row. */
  rows: StatementRow[];
  /** Whether accounts without a figure were asked for. */
  includeAll: boolean;
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  unbalanced: TrialBalanceFigures["unbalanced"];
  openingFrom: OpeningProvenance | null;
  unplaced: string[];
};

/**
 * The Trial Balance laid out on the chart, like the Neraca and the Laba Rugi.
 *
 * The figures are `trialBalanceReport`'s, unchanged — the closing checklist
 * reads the same function, so the check a reader makes here is the one the
 * close makes. This adds only where each figure sits.
 *
 * With `includeAll`, every active account is listed, silent or not; an inactive
 * account appears only when it carries a figure, since a retired account with
 * nothing on it has nothing to check.
 */
export async function trialBalanceStatement(
  companyId: number,
  range: PeriodRange,
  includeAll: boolean
): Promise<TrialBalanceStatement> {
  const [report, chart] = await Promise.all([
    trialBalanceReport(range, [companyId]),
    typedChart({ company_id: companyId }),
  ]);

  const figures = report.rows.map((r) => ({
    accountId: r.id,
    // The flat report signs by the account's own normal balance; the tree
    // re-signs by the type's, so it takes the raw net.
    opening: r.normalBalance === "Kredit" ? -r.opening : r.opening,
    debit: r.debit,
    credit: r.credit,
  }));

  const byId = new Map(chart.map((a) => [a.id, a]));
  const keep = new Set<number>(
    includeAll ? chart.filter((a) => a.active).map((a) => a.id) : []
  );
  for (const f of figures) keep.add(f.accountId);
  // A kept account's parents stay too, or it would lose its place in the tree.
  for (const id of [...keep]) {
    let parent = byId.get(id)?.parentId ?? null;
    while (parent !== null && !keep.has(parent)) {
      keep.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
  }

  const built = buildTrialBalance(
    chart.filter((a) => keep.has(a.id)),
    figures,
    includeAll
  );

  return {
    range,
    rows: built.rows,
    includeAll,
    totalDebit: report.totalDebit,
    totalCredit: report.totalCredit,
    balanced: report.balanced,
    unbalanced: report.unbalanced,
    openingFrom: report.openingFrom,
    unplaced: built.unplaced,
  };
}

/** `YYYY-MM-DD`, one day earlier. */
function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
