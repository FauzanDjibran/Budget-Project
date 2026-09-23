import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { MONTHS_LONG, formatDate } from "@/lib/format";
import {
  openLimitRefusal,
  type OpenYearSummary,
} from "./fiscal-workflow";

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
 *
 * The calendar is also what says whether a book may be written into at all.
 * `checkPostingPeriod` at the foot of this file is that question, and every
 * posting path in the application asks it before it writes anything.
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

// ------------------------------------------------------------------- the lock

/**
 * The years standing Open right now, oldest first.
 *
 * The calendar is global — one set of years shared by both Companies — so this
 * is not scoped to one. Which Company has finished with a year is a separate
 * record (`acc_fiscal_closing`), because "the anak has closed 2026 and the
 * induk has not" is a fact about a Company and not about the calendar.
 */
export async function openFiscalYears(db: Db = prisma): Promise<OpenYearSummary[]> {
  const rows = await db.accFiscalYear.findMany({
    where: { status: "Open" },
    orderBy: { start_date: "asc" },
    select: { id: true, year_label: true, year_name: true },
  });
  return rows.map((r) => ({ id: r.id, label: r.year_label, name: r.year_name }));
}

/**
 * Whether one more year may be activated — the max-two-Open rule.
 *
 * Asked by the Server Action before it moves a year to Open, and testable on
 * its own because the counting rule it delegates to is pure
 * (`openLimitRefusal`). The year being activated is excluded from the count:
 * re-activating a year that is somehow already Open is the transition table's
 * refusal to make, not this one's.
 */
export async function checkYearOpenable(
  id: number,
  db: Db = prisma
): Promise<{ ok: true } | { ok: false; message: string }> {
  const open = (await openFiscalYears(db)).filter((y) => y.id !== id);
  const refusal = openLimitRefusal(open);
  return refusal ? { ok: false, message: refusal } : { ok: true };
}

export type PostingPeriodCheck =
  | { ok: true; fiscalYearId: number }
  | { ok: false; message: string };

/** A `Date`, or a `YYYY-MM-DD` day, as the UTC midnight the calendar stores. */
function asDay(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(`${value.toISOString().slice(0, 10)}T00:00:00Z`);
  }
  return new Date(`${value.slice(0, 10)}T00:00:00Z`);
}

/**
 * May this Company write into the books on this date?
 *
 * Two questions, in order: the **year** containing the date must be Open, and
 * this Company must not already have closed it. The year carries the date
 * range, so it is the year that is queried and not the period — a period's own
 * status says nothing the year's does not, and a date outside every year
 * belongs to no period either.
 *
 * `Draft` means *not yet*: a year whose twelve periods have not been generated
 * cannot group what is posted into it. `Closed` means *never again*, and it is
 * per Company (`acc_fiscal_closing`), because the induk can finish 2026 while
 * the anak is still working in it.
 *
 * A date inside **no** year is refused as well. That is the same rule read
 * plainly rather than a separate one — a posting that belongs to no fiscal year
 * cannot be closed out, carried forward, or found again by anyone reconciling a
 * year end. It also means a fresh installation must open its calendar before it
 * can post, which is what the dashboard's setup card has always said to do.
 *
 * Every posting path asks this before it writes anything, and the refusal is
 * returned rather than thrown: it is a refusal the user can act on, not a fault.
 */
export async function checkPostingPeriod(
  companyId: number,
  date: Date | string,
  db: Db = prisma
): Promise<PostingPeriodCheck> {
  const day = asDay(date);

  const year = await db.accFiscalYear.findFirst({
    where: { start_date: { lte: day }, end_date: { gte: day } },
    select: { id: true, year_name: true, status: true },
  });
  if (!year) {
    return {
      ok: false,
      message:
        `Tanggal ${formatDate(day)} tidak berada dalam tahun buku manapun. ` +
        "Buat dan aktifkan tahun buku yang memuatnya sebelum memposting.",
    };
  }
  if (year.status === "Draft") {
    return {
      ok: false,
      message:
        `${year.year_name} masih berstatus Draft. Aktifkan tahun buku ` +
        "tersebut sebelum memposting ke dalamnya.",
    };
  }
  if (year.status === "Closed") {
    return {
      ok: false,
      message:
        `${year.year_name} sudah ditutup. Tidak ada transaksi baru yang ` +
        "dapat dibuat di dalamnya.",
    };
  }

  const closing = await db.accFiscalClosing.findUnique({
    where: {
      fiscal_year_id_company_id: { fiscal_year_id: year.id, company_id: companyId },
    },
    select: { status: true },
  });
  if (closing?.status === "Closed") {
    const company = await db.sysCompany.findUnique({
      where: { id: companyId },
      select: { company_label: true },
    });
    return {
      ok: false,
      message:
        `Company ${company?.company_label ?? companyId} sudah menutup ` +
        `${year.year_name}. Tidak ada transaksi baru yang dapat dibuat di dalamnya.`,
    };
  }

  return { ok: true, fiscalYearId: year.id };
}

// ---------------------------------------------------------------- closing

/** A fiscal year as the closing workspace needs to name and bound it. */
export type FiscalYearForClosing = {
  id: number;
  label: string;
  name: string;
  status: string;
  /** UTC midnight, the two days a close is bounded by. */
  startDate: Date;
  endDate: Date;
};

export async function fiscalYearForClosing(
  id: number,
  db: Db = prisma
): Promise<FiscalYearForClosing | null> {
  const row = await db.accFiscalYear.findUnique({
    where: { id },
    select: {
      id: true,
      year_label: true,
      year_name: true,
      status: true,
      start_date: true,
      end_date: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    label: row.year_label,
    name: row.year_name,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

/**
 * The year that follows this one, whatever state it is in.
 *
 * Found by its start date rather than by adding one to a label, because the
 * label is a string somebody typed and the dates are what the calendar
 * actually spans. It is the **nearest** year starting after this one ends: a
 * calendar with a gap in it has exactly one candidate, and this is it — there
 * is nowhere else a snapshot could sensibly go. `Draft` counts: a close needs
 * somewhere to put the snapshot it produces, and a Draft year is somewhere —
 * activating it later generates
 * its twelve periods exactly as it does today. A fiscal year is chosen by a
 * person (CLAUDE.md §12), so a missing one is **refused**, never created.
 */
export async function fiscalYearAfter(
  year: FiscalYearForClosing,
  db: Db = prisma
): Promise<FiscalYearForClosing | null> {
  const row = await db.accFiscalYear.findFirst({
    where: { start_date: { gt: year.endDate } },
    orderBy: { start_date: "asc" },
    select: {
      id: true,
      year_label: true,
      year_name: true,
      status: true,
      start_date: true,
      end_date: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    label: row.year_label,
    name: row.year_name,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

/** One Company's closing state for one year, and who shut it. */
export type FiscalClosingState = {
  status: "Open" | "Closed";
  closedAt: Date | null;
  closedBy: number | null;
  closingJournalId: number | null;
  openingBalanceId: number | null;
};

/**
 * Has this Company finished with this year?
 *
 * A year with no row at all is Open for that Company: the row is written when
 * the year is closed, and its absence is the honest answer rather than a
 * missing fact. `checkPostingPeriod` reads the same table the same way.
 */
export async function fiscalClosingState(
  fiscalYearId: number,
  companyId: number,
  db: Db = prisma
): Promise<FiscalClosingState> {
  const row = await db.accFiscalClosing.findUnique({
    where: {
      fiscal_year_id_company_id: { fiscal_year_id: fiscalYearId, company_id: companyId },
    },
    select: {
      status: true,
      closed_at: true,
      closed_by: true,
      closing_journal_id: true,
      opening_balance_id: true,
    },
  });
  if (!row) {
    return {
      status: "Open",
      closedAt: null,
      closedBy: null,
      closingJournalId: null,
      openingBalanceId: null,
    };
  }
  return {
    status: row.status,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    closingJournalId: row.closing_journal_id,
    openingBalanceId: row.opening_balance_id,
  };
}

/**
 * Shuts one Company's year, and rolls the year itself when it is the last.
 *
 * Written here rather than in `closing.ts` because `acc_fiscal_closing` and
 * `acc_fiscal_year` are this module's tables — the closing process decides
 * *whether* a year may be shut and what that produces, and the calendar
 * records that it has been.
 *
 * Takes a transaction: the row, the year's rollup and the documents the close
 * produced are one act, and a Company recorded as closed without the journal
 * that closed it would be a year nobody could reconcile.
 *
 * **`AccFiscalYear.status` is a rollup**, not a fact anybody sets: the year
 * reads Closed once *every* Company has closed it, written in the same
 * transaction as the last Company's close. Until then the year is still Open
 * and the other Company goes on posting into it, which is the whole reason
 * closing is per Company in the first place.
 */
export async function recordFiscalClosing(
  tx: Prisma.TransactionClient,
  options: {
    fiscalYearId: number;
    companyId: number;
    closingJournalId: number | null;
    openingBalanceId: number | null;
    actorId: number;
  }
): Promise<{ yearClosed: boolean }> {
  const { fiscalYearId, companyId, actorId } = options;

  const row = await tx.accFiscalClosing.upsert({
    where: {
      fiscal_year_id_company_id: { fiscal_year_id: fiscalYearId, company_id: companyId },
    },
    update: {
      status: "Closed",
      closed_at: new Date(),
      closed_by: actorId,
      closing_journal_id: options.closingJournalId,
      opening_balance_id: options.openingBalanceId,
      updated_by: actorId,
    },
    create: {
      fiscal_year_id: fiscalYearId,
      company_id: companyId,
      status: "Closed",
      closed_at: new Date(),
      closed_by: actorId,
      closing_journal_id: options.closingJournalId,
      opening_balance_id: options.openingBalanceId,
      created_by: actorId,
    },
    select: { id: true },
  });

  await tx.auditLog.create({
    data: {
      entity_key: "acc_fiscal_closing",
      row_id: row.id,
      action: "UPDATE",
      event: "close",
      by: actorId,
    },
  });

  const companies = await tx.sysCompany.count();
  const closed = await tx.accFiscalClosing.count({
    where: { fiscal_year_id: fiscalYearId, status: "Closed" },
  });
  const yearClosed = closed >= companies;

  if (yearClosed) {
    await tx.accFiscalYear.update({
      where: { id: fiscalYearId },
      data: { status: "Closed", updated_by: actorId },
    });
    await tx.auditLog.create({
      data: {
        entity_key: "acc_fiscal_year",
        row_id: fiscalYearId,
        action: "UPDATE",
        event: "close",
        by: actorId,
      },
    });
  }

  return { yearClosed };
}

/**
 * How a closing row names itself in an audit panel: `ABHC · 2026`.
 *
 * A closing row's identity is the pair it is about, and neither half alone
 * says which record it is — the calendar is shared, so "2026" names a year
 * both Companies close separately.
 */
export async function fiscalClosingLabels(
  ids: number[]
): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.accFiscalClosing.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      company: { select: { company_label: true } },
      fiscal_year: { select: { year_label: true } },
    },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      `${r.company.company_label} · ${r.fiscal_year.year_label}`,
    ])
  );
}

/** The years one Company has already closed, for a screen that must still name them. */
export async function closedFiscalYearsFor(
  companyId: number
): Promise<OpenYearSummary[]> {
  const rows = await prisma.accFiscalClosing.findMany({
    where: { company_id: companyId, status: "Closed" },
    select: {
      fiscal_year: { select: { id: true, year_label: true, year_name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.fiscal_year.id,
    label: r.fiscal_year.year_label,
    name: r.fiscal_year.year_name,
  }));
}
