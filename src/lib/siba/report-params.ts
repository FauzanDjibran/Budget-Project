import type { PeriodRange } from "./period";

/**
 * How an Accounting Report View reads its URL — shared by the page and its
 * Unduh XLSX route, so the file is the run on screen.
 */

/** Defaults to the current month to date, like every other Report View. */
export function resolveRange(from?: string, to?: string): PeriodRange {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
  );

  const start = isDate(from) ? from : iso(monthStart);
  const end = isDate(to) ? to : iso(today);
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

function isDate(value: string | undefined): value is string {
  return Boolean(
    value &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

/**
 * `accounts=3,17,42` — the subject of an `account-period` report.
 *
 * Duplicates are dropped and anything unparseable is ignored rather than
 * refused: a hand-edited URL should still answer with the accounts it does
 * name. Whether the reader may see them is decided by the query, which is
 * limited to the Companies their permissions open.
 */
export function parseIds(raw?: string): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}
