import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { MONTHS_LONG } from "@/lib/format";

/**
 * The fiscal calendar.
 *
 * A Fiscal Year is chosen, not composed: pick 2028 and the name, the start date
 * and the end date all follow. A Fiscal Period is never authored at all — it has
 * no menu and no form, because a calendar month is not something anyone should
 * be able to get wrong. Opening a year generates its twelve months in one go,
 * and they are read from inside the year that owns them.
 *
 * Budget Month reads these periods (CLAUDE.md §10, rule 20), so a period whose
 * range did not line up with a real month would silently strand budgets between
 * two months or in none.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The four-digit year a Fiscal Year is for, or null if the label is not one. */
export function parseYear(label: string | null | undefined): number | null {
  const m = /^(\d{4})$/.exec((label ?? "").trim());
  return m ? Number(m[1]) : null;
}

/** Everything a Fiscal Year's other columns are: name, 01/01, and 31/12. */
export function fiscalYearShape(year: number) {
  return {
    year_name: `Tahun Buku ${year}`,
    start_date: new Date(Date.UTC(year, 0, 1)),
    end_date: new Date(Date.UTC(year, 11, 31)),
  };
}

/**
 * Creates the year's twelve months, once.
 *
 * Called whenever a Fiscal Year is saved as Open. It is deliberately idempotent
 * on the count rather than on the contents: a year that already has periods is
 * left exactly as it is, so re-opening a year after it was closed never
 * duplicates a month or rewrites one that has already been posted into.
 *
 * Returns how many periods it created — zero when the year already had them.
 */
export async function ensureFiscalPeriods(
  db: Db,
  options: { fiscalYearId: number; year: number; actorId: number }
): Promise<number> {
  const existing = await db.accFiscalPeriod.count({
    where: { fiscal_year_id: options.fiscalYearId },
  });
  if (existing > 0) return 0;

  const start = await nextPeriodCodeNumber(db);
  const { year } = options;

  await db.accFiscalPeriod.createMany({
    data: MONTHS_LONG.map((monthName, i) => ({
      period_code: `fprd.${String(start + i).padStart(4, "0")}`,
      fiscal_year_id: options.fiscalYearId,
      sequence_no: i + 1,
      period_label: `${year}-${pad2(i + 1)}`,
      period_name: `${monthName} ${year}`,
      start_date: new Date(Date.UTC(year, i, 1)),
      // Day 0 of the next month is the last day of this one, which is what
      // keeps February right in a leap year without a special case.
      end_date: new Date(Date.UTC(year, i + 1, 0)),
      status: "Open" as const,
      created_by: options.actorId,
      updated_by: null,
    })),
  });

  return MONTHS_LONG.length;
}

async function nextPeriodCodeNumber(db: Db): Promise<number> {
  const rows = await db.accFiscalPeriod.findMany({ select: { period_code: true } });
  let max = 0;
  for (const r of rows) {
    const n = Number(r.period_code.split(".")[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export type FiscalPeriodRow = {
  id: number;
  code: string;
  sequence: number;
  label: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  /** Budgets whose date falls inside this period. */
  budgets: number;
};

/**
 * One year's periods, in calendar order, with the budgets each one holds.
 *
 * This is the only way to see a Fiscal Period: they are shown inside the year
 * that owns them and nowhere else.
 */
export async function fiscalYearPeriods(fiscalYearId: number): Promise<FiscalPeriodRow[]> {
  const periods = await prisma.accFiscalPeriod.findMany({
    where: { fiscal_year_id: fiscalYearId },
    orderBy: { sequence_no: "asc" },
  });
  if (!periods.length) return [];

  const budgets = await prisma.budBudget.findMany({
    where: {
      budget_date: {
        gte: periods[0].start_date,
        lte: periods[periods.length - 1].end_date,
      },
    },
    select: { budget_date: true },
  });

  const day = (d: Date) => d.toISOString().slice(0, 10);

  return periods.map((p) => {
    const from = day(p.start_date);
    const to = day(p.end_date);
    return {
      id: p.id,
      code: p.period_code,
      sequence: p.sequence_no,
      label: p.period_label,
      name: p.period_name,
      startDate: from,
      endDate: to,
      status: p.status,
      budgets: budgets.filter((b) => {
        const d = day(b.budget_date);
        return d >= from && d <= to;
      }).length,
    };
  });
}
