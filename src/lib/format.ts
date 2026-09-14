/**
 * Display formatting, ported from the mockup's utility block so dates, numbers
 * and money render identically to the prototype.
 *
 * Dates are formatted from their UTC parts. Every date in this system is a
 * calendar date stored at UTC midnight, so reading local parts would shift some
 * of them to the previous day in negative-offset timezones.
 */

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `2026-09-02` -> `02 Sep 2026` */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${pad2(d.getUTCDate())} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `2026-09-02 14:05` -> `02 Sep 2026 • 14:05` */
export function formatTimestamp(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${formatDate(d)} • ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function formatNumber(
  value: number | string | { toString(): string } | null | undefined,
  decimals = 0
): string {
  const n = Number(value ?? 0);
  return n.toLocaleString("id-ID", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** IDR renders as `Rp 1.250.000` with no decimals; other currencies keep two. */
export function formatMoney(
  value: number | string | { toString(): string } | null | undefined,
  currencyLabel = "IDR"
): string {
  const prefix = currencyLabel === "IDR" ? "Rp " : `${currencyLabel} `;
  return prefix + formatNumber(value, currencyLabel === "IDR" ? 0 : 2);
}
