/**
 * Display formatting for dates, numbers and money.
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

/** One currency's share of a figure. Totals are kept per currency, never summed. */
export type MoneyTotal = {
  currencyId: number;
  currencyLabel: string;
  amount: number;
};

/**
 * `Rp 45.000.000 · USD 3.500,00`.
 *
 * Amounts in different currencies are listed side by side rather than added
 * together: converting them would need an exchange rate, and the system has no
 * authoritative source for one. A single combined figure would be a guess
 * presented as a fact.
 */
export function formatTotals(totals: MoneyTotal[], empty = "—"): string {
  if (!totals.length) return empty;
  return totals
    .map((t) => formatMoney(t.amount, t.currencyLabel))
    .join(" · ");
}

/** Groups amounts by currency, dropping currencies that contribute nothing. */
export function sumByCurrency(
  rows: { currencyId: number; currencyLabel: string; amount: number }[]
): MoneyTotal[] {
  const by = new Map<number, MoneyTotal>();
  for (const r of rows) {
    const acc = by.get(r.currencyId) ?? {
      currencyId: r.currencyId,
      currencyLabel: r.currencyLabel,
      amount: 0,
    };
    acc.amount += r.amount;
    by.set(r.currencyId, acc);
  }
  return [...by.values()]
    .filter((t) => t.amount !== 0)
    .sort((a, b) => a.currencyLabel.localeCompare(b.currencyLabel));
}
