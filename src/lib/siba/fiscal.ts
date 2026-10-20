import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { MONTHS_LONG, formatDate } from "@/lib/format";
import {
  FISCAL_PERIOD_TRANSITIONS,
  activationRefusal,
  type FiscalPeriodAction,
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
 * Each Company keeps its own calendar: its own years, each with its own twelve
 * periods, activated, locked and closed without waiting on the other Company.
 * Budget Month still reads one month across both (`budget.ts`), because a
 * Budget transcends Company.
 *
 * The calendar is also what says whether a book may be written into at all.
 * `checkPostingPeriod` is that question — a posting's date must fall in an
 * **Open period** of its Company's own calendar — and every posting path in the
 * application asks it before it writes anything.
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
  const owner = await db.accFiscalYear.findUniqueOrThrow({
    where: { id: options.fiscalYearId },
    select: { company_id: true },
  });

  const start = await nextPeriodCodeNumber(db);
  const { year } = options;

  await db.accFiscalPeriod.createMany({
    data: MONTHS_LONG.map((monthName, i) => ({
      period_code: `fprd.${String(start + i).padStart(4, "0")}`,
      fiscal_year_id: options.fiscalYearId,
      company_id: owner.company_id,
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
      company_id: periods[0].company_id,
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

/** One Company's years standing Open right now, oldest first. */
export async function openFiscalYears(
  companyId: number,
  db: Db = prisma
): Promise<OpenYearSummary[]> {
  const rows = await db.accFiscalYear.findMany({
    where: { company_id: companyId, status: "Open" },
    orderBy: { start_date: "asc" },
    select: { id: true, year_label: true, year_name: true },
  });
  return rows.map((r) => ({ id: r.id, label: r.year_label, name: r.year_name }));
}

/**
 * Whether a year may be activated — never behind a close.
 *
 * There is no limit on how many years stand Open. What is refused is a year
 * older than one its Company has already closed, because that close froze the
 * Opening Balance every later report stands on (`activationRefusal`). The other
 * Company's calendar is its own and never stands in the way.
 */
export async function checkYearOpenable(
  id: number,
  db: Db = prisma
): Promise<{ ok: true } | { ok: false; message: string }> {
  const year = await db.accFiscalYear.findUnique({
    where: { id },
    select: { year_label: true, start_date: true, company_id: true },
  });
  if (!year) return { ok: false, message: "Tahun buku tidak ditemukan." };

  const later = await db.accFiscalClosing.findMany({
    where: {
      status: "Closed",
      fiscal_year: { company_id: year.company_id, start_date: { gt: year.start_date } },
    },
    select: {
      company: { select: { company_label: true } },
      fiscal_year: { select: { year_label: true, year_name: true } },
    },
  });
  const refusal = activationRefusal(
    year.year_label,
    later.map((c) => ({
      yearLabel: c.fiscal_year.year_label,
      yearName: c.fiscal_year.year_name,
      companyLabel: c.company.company_label,
    }))
  );
  return refusal ? { ok: false, message: refusal } : { ok: true };
}

/** The Open years one Company has not closed yet, oldest first. */
export async function unclosedYearsFor(
  companyId: number,
  db: Db = prisma
): Promise<OpenYearSummary[]> {
  const rows = await db.accFiscalYear.findMany({
    where: {
      company_id: companyId,
      status: "Open",
      closings: { none: { company_id: companyId, status: "Closed" } },
    },
    orderBy: { start_date: "asc" },
    select: { id: true, year_label: true, year_name: true },
  });
  return rows.map((r) => ({ id: r.id, label: r.year_label, name: r.year_name }));
}

export type PostingPeriodCheck =
  | { ok: true; fiscalYearId: number; fiscalPeriodId: number }
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
 * The date must fall in an **Open period** of this Company's own calendar. In
 * order: the Company has a year containing the date, that year is Open and not
 * closed, and the period containing the date is Open — not Locked, not Closed.
 *
 * `Draft` means *not yet*: a year whose twelve periods have not been generated
 * cannot group what is posted into it. A `Locked` period refuses until it is
 * unlocked; `Closed` means *never again*.
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
    where: { company_id: companyId, start_date: { lte: day }, end_date: { gte: day } },
    select: { id: true, year_name: true, status: true, company: { select: { company_label: true } } },
  });
  if (!year) {
    const company = await db.sysCompany.findUnique({
      where: { id: companyId },
      select: { company_label: true },
    });
    return {
      ok: false,
      message:
        `Tanggal ${formatDate(day)} tidak berada dalam tahun buku ${company?.company_label ?? ""} manapun. ` +
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
    return {
      ok: false,
      message:
        `Company ${year.company.company_label} sudah menutup ` +
        `${year.year_name}. Tidak ada transaksi baru yang dapat dibuat di dalamnya.`,
    };
  }

  const period = await db.accFiscalPeriod.findUnique({
    where: {
      company_id_start_date: {
        company_id: companyId,
        start_date: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)),
      },
    },
    select: { id: true, period_name: true, status: true },
  });
  if (!period) {
    return {
      ok: false,
      message: `${year.year_name} ${year.company.company_label} tidak memiliki periode untuk ${formatDate(day)}.`,
    };
  }
  if (period.status !== "Open") {
    return {
      ok: false,
      message:
        period.status === "Locked"
          ? `Periode ${period.period_name} ${year.company.company_label} sedang dikunci. ` +
            "Buka kunci periode itu di Fiscal Year sebelum memposting ke dalamnya."
          : `Periode ${period.period_name} ${year.company.company_label} sudah ditutup.`,
    };
  }

  return { ok: true, fiscalYearId: year.id, fiscalPeriodId: period.id };
}

/**
 * A posting refused, from inside its transaction, because the period it is
 * dated in has shut since it was checked. Thrown rather than returned so it
 * rolls back whatever the transaction already wrote; every posting path
 * catches it and reports `message` like any other refusal.
 */
export class PeriodShut extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeriodShut";
  }
}

/**
 * Holds one Company's fiscal year for the rest of the caller's transaction.
 *
 * A close and a posting into the year it closes must not interleave. With
 * backdating allowed, a posting can land in a year at any moment up to its
 * close, and both sides decide something from what they read: the close
 * computes the journal that empties profit and loss, a posting checks the
 * year is still open. Without a lock, a posting that checked before the close
 * committed could write into the closed year afterwards, and a posting landing
 * between the close's preview and its write would leave profit and loss in the
 * snapshot. Every posting path and the close take this first, so whichever
 * comes second waits and then reads what the first committed.
 *
 * An advisory lock, keyed on the pair and released when the transaction ends —
 * the same shape as `lockSubledgerPosition`. Parameterised; nothing is
 * interpolated into the SQL text.
 */
export async function lockFiscalPeriod(
  tx: Prisma.TransactionClient,
  fiscalYearId: number,
  companyId: number
): Promise<void> {
  const key = `acc_fiscal_closing:${fiscalYearId}:${companyId}`;
  await tx.$queryRaw`SELECT 1 AS held FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS lock`;
}

/**
 * Locks the year `date` falls in for each Company, then asks the period
 * question again under the lock — inside the posting's own transaction.
 *
 * `checkTransactionDate` before the transaction gives the refusal early and
 * cheaply; this is what makes it true at the moment of writing. Companies are
 * locked in id order, so a funded posting (two Companies) and a close (one)
 * can never wait on each other in a circle.
 */
export async function holdPostingPeriod(
  tx: Prisma.TransactionClient,
  companyIds: number[],
  date: string
): Promise<void> {
  const day = asDay(date);
  for (const companyId of [...new Set(companyIds)].sort((a, b) => a - b)) {
    const year = await tx.accFiscalYear.findFirst({
      where: { company_id: companyId, start_date: { lte: day }, end_date: { gte: day } },
      select: { id: true },
    });
    if (year) await lockFiscalPeriod(tx, year.id, companyId);
    const period = await checkPostingPeriod(companyId, date, tx);
    if (!period.ok) throw new PeriodShut(period.message);
  }
}

/** Today, as the `YYYY-MM-DD` UTC day every stored date is. */
export function todayDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export type TransactionDateCheck =
  | { ok: true; date: string }
  | { ok: false; message: string };

/**
 * May a document be dated this day?
 *
 * A document's date is the day it belongs to in the books, and it may be any
 * day **up to today** — backdating is allowed, dating ahead is not: a posting
 * dated tomorrow would claim something happened that has not yet. The rest is
 * the period lock, asked of **every** Company the posting writes into, which is
 * one for an ordinary document and both for a funded one: a date inside a year
 * one of them has closed cannot be written, whichever it is.
 *
 * Asked when a draft is saved, so the refusal arrives while the date can still
 * be changed, and again at Post, because a year can close in between. The
 * date is returned in its canonical `YYYY-MM-DD` form.
 */
export async function checkTransactionDate(
  raw: string | Date | null | undefined,
  companyIds: number[],
  db: Db = prisma
): Promise<TransactionDateCheck> {
  const text =
    raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const parsed = m ? new Date(`${text}T00:00:00Z`) : null;
  if (!m || !parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    return { ok: false, message: "Tanggal transaksi wajib diisi dengan tanggal yang valid." };
  }
  if (text > todayDay()) {
    return {
      ok: false,
      message: `Tanggal ${formatDate(text)} belum terjadi. Transaksi tidak boleh bertanggal di masa depan.`,
    };
  }
  for (const companyId of [...new Set(companyIds)]) {
    const period = await checkPostingPeriod(companyId, text, db);
    if (!period.ok) return { ok: false, message: period.message };
  }
  return { ok: true, date: text };
}

// ---------------------------------------------------------------- closing

/** A fiscal year as the closing workspace needs to name and bound it. */
export type FiscalYearForClosing = {
  id: number;
  companyId: number;
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
      company_id: true,
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
    companyId: row.company_id,
    label: row.year_label,
    name: row.year_name,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

/**
 * The year that follows this one in its Company's calendar, whatever state it is in.
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
    where: { company_id: year.companyId, start_date: { gt: year.endDate } },
    orderBy: { start_date: "asc" },
    select: {
      id: true,
      company_id: true,
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
    companyId: row.company_id,
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
 * Shuts one Company's year, and every period in it.
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
 * A year belongs to one Company, so its close is the year's: the year and its
 * twelve periods read Closed in the same transaction, for good.
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

  await tx.accFiscalYear.update({
    where: { id: fiscalYearId },
    data: { status: "Closed", updated_by: actorId },
  });
  await tx.accFiscalPeriod.updateMany({
    where: { fiscal_year_id: fiscalYearId },
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

  return { yearClosed: true };
}

/**
 * How a closing row names itself in an audit panel: `ABHC · 2026`.
 *
 * A closing row's identity is the pair it is about: "2026" alone names a year
 * each Company keeps.
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

/** A year a Company is carrying unclosed, with the range its result sums over. */
export type CarriedYear = OpenYearSummary & { startDate: string; endDate: string };

/**
 * Every year this Company has not closed that begins before `before`, oldest
 * first — the years a Neraca dated after them carries as one line each.
 *
 * While a year is unclosed its result has not been moved into Laba/Rugi Tahun
 * Sebelumnya, so every later Neraca has to state it on a line of its own. Asked
 * of the calendar rather than of the journal: whether a year is still owed a
 * close is a fact recorded in `acc_fiscal_closing`, not inferred from whether
 * anything happened to be posted in it.
 */
export async function carriedYearsBefore(
  companyId: number,
  before: string,
  db: Db = prisma
): Promise<CarriedYear[]> {
  const rows = await db.accFiscalYear.findMany({
    where: {
      company_id: companyId,
      status: "Open",
      start_date: { lt: new Date(`${before}T00:00:00Z`) },
      closings: { none: { company_id: companyId, status: "Closed" } },
    },
    orderBy: { start_date: "asc" },
    select: { id: true, year_label: true, year_name: true, start_date: true, end_date: true },
  });
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return rows.map((r) => ({
    id: r.id,
    label: r.year_label,
    name: r.year_name,
    startDate: day(r.start_date),
    endDate: day(r.end_date),
  }));
}

/**
 * Whether this Company carries any unclosed year behind a newer Open one —
 * which is when its current Neraca prints year lines at all.
 */
export async function isCarryingUnclosedYear(companyId: number, db: Db = prisma): Promise<boolean> {
  return (await unclosedYearsFor(companyId, db)).length > 1;
}

/** A fiscal year a statement may be run for, with its twelve periods. */
export type ReportableFiscalYear = {
  id: number;
  label: string;
  name: string;
  status: string;
  /** `YYYY-MM-DD`. */
  startDate: string;
  endDate: string;
  periods: { id: number; sequence: number; name: string; startDate: string; endDate: string }[];
};

/**
 * Every year of one Company's a financial statement can be run for, newest first.
 *
 * Open and Closed only. A Draft year has no periods yet — they are generated
 * when it is activated — so there is no period to pick and nothing could have
 * been posted into it.
 */
export async function reportableFiscalYears(companyId: number): Promise<ReportableFiscalYear[]> {
  const rows = await prisma.accFiscalYear.findMany({
    where: { company_id: companyId, status: { in: ["Open", "Closed"] } },
    orderBy: { start_date: "desc" },
    select: {
      id: true,
      year_label: true,
      year_name: true,
      status: true,
      start_date: true,
      end_date: true,
      periods: {
        orderBy: { sequence_no: "asc" },
        select: {
          id: true,
          sequence_no: true,
          period_name: true,
          start_date: true,
          end_date: true,
        },
      },
    },
  });
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return rows.map((y) => ({
    id: y.id,
    label: y.year_label,
    name: y.year_name,
    status: y.status,
    startDate: day(y.start_date),
    endDate: day(y.end_date),
    periods: y.periods.map((p) => ({
      id: p.id,
      sequence: p.sequence_no,
      name: p.period_name,
      startDate: day(p.start_date),
      endDate: day(p.end_date),
    })),
  }));
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

/**
 * Locks or unlocks one period, for the Companies the caller may act for.
 *
 * Takes the same `(year, Company)` advisory lock every posting holds, so a
 * backdated posting into the period either lands before the lock or finds it
 * Locked — never between. The status guard in the `where` refuses a period
 * someone else has just moved.
 */
export async function changeFiscalPeriodStatus(
  periodId: number,
  action: FiscalPeriodAction,
  actorId: number,
  companyIds: number[]
): Promise<{ ok: true; periodName: string } | { ok: false; message: string }> {
  const transition = FISCAL_PERIOD_TRANSITIONS[action];
  const period = await prisma.accFiscalPeriod.findUnique({
    where: { id: periodId },
    select: {
      id: true,
      company_id: true,
      period_name: true,
      status: true,
      fiscal_year: { select: { id: true, year_name: true, status: true } },
    },
  });
  if (!period || !companyIds.includes(period.company_id)) {
    return { ok: false, message: "Periode tidak ditemukan." };
  }
  if (period.fiscal_year.status !== "Open") {
    return {
      ok: false,
      message: `${period.fiscal_year.year_name} berstatus ${period.fiscal_year.status}; periodenya tidak dapat diubah.`,
    };
  }
  if (period.status !== transition.from) {
    return {
      ok: false,
      message: `Periode ${period.period_name} berstatus ${period.status}, tidak dapat di${transition.label.toLowerCase()}.`,
    };
  }

  const moved = await prisma.$transaction(async (tx) => {
    await lockFiscalPeriod(tx, period.fiscal_year.id, period.company_id);
    const { count } = await tx.accFiscalPeriod.updateMany({
      where: { id: periodId, status: transition.from },
      data: { status: transition.to, updated_by: actorId },
    });
    if (count) {
      await tx.auditLog.create({
        data: { entity_key: "acc_fiscal_period", row_id: periodId, action: "UPDATE", event: action, by: actorId },
      });
    }
    return count;
  });
  if (!moved) return { ok: false, message: `Periode ${period.period_name} baru saja diubah pengguna lain.` };
  return { ok: true, periodName: period.period_name };
}

/** A year's periods, and those not Locked yet in calendar order — what stands between it and its close. */
export async function unlockedPeriods(
  fiscalYearId: number,
  db: Db = prisma
): Promise<{ total: number; unlocked: string[] }> {
  const rows = await db.accFiscalPeriod.findMany({
    where: { fiscal_year_id: fiscalYearId },
    orderBy: { sequence_no: "asc" },
    select: { period_name: true, status: true },
  });
  return {
    total: rows.length,
    unlocked: rows.filter((r) => r.status !== "Locked").map((r) => r.period_name),
  };
}

/** How a period names itself in an audit panel: `ABHC · Mei 2026`. */
export async function fiscalPeriodLabels(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.accFiscalPeriod.findMany({
    where: { id: { in: ids } },
    select: { id: true, period_name: true, company: { select: { company_label: true } } },
  });
  return new Map(rows.map((r) => [r.id, `${r.company.company_label} · ${r.period_name}`]));
}
