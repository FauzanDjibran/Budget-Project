/**
 * Display formatting for dates, numbers and money.
 *
 * **Dates are `dd/mm/yyyy` everywhere** — displays, tables, inputs, filters and
 * reports alike. `formatDate` is the single place that decides that, so the
 * format cannot drift between one screen and the next; nothing else in the
 * application formats a date by hand, and no native `<input type="date">`
 * survives (it renders in the browser's own locale — see `ui/date-input.tsx`).
 *
 * Dates are formatted from their UTC parts. Every date in this system is a
 * calendar date stored at UTC midnight, so reading local parts would shift some
 * of them to the previous day in negative-offset timezones.
 */

/** Month names, used by the calendar and by generated period names. */
export const MONTHS_LONG = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Today as `yyyy-mm-dd` — the wire form every date field carries.
 *
 * Read from UTC parts like every other date here, so the day a form prefills
 * is the same day the database stores.
 */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `2026-09-02` -> `02/09/2026` */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** `2026-09-02 14:05` -> `02/09/2026 • 14:05` */
export function formatTimestamp(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${formatDate(d)} • ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * How long something has been waiting — `Hari ini`, `1 hari`, `12 hari`.
 *
 * Whole days only, counted from UTC midnight to UTC midnight, so a record
 * created late yesterday reads as one day rather than as a fraction that
 * rounds differently depending on when the page is opened. It lives here
 * because it is date arithmetic turned into display text, and nothing outside
 * this module formats either (CLAUDE.md §12).
 */
export function formatAgeDays(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const midnight = (x: Date) =>
    Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const days = Math.floor((midnight(new Date()) - midnight(d)) / 86_400_000);
  if (days <= 0) return "Hari ini";
  return `${formatNumber(days)} hari`;
}

/** `2026-09-02` -> `02/09/2026`, for a date field's editable text. */
export function toDisplayDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * `02/09/2026` -> `2026-09-02`, or `""` when the text is not a real date.
 *
 * The calendar check matters: `31/02/2026` parses arithmetically as 3 March and
 * would silently save a date nobody typed.
 */
export function toIsoDate(display: string | null | undefined): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((display ?? "").trim());
  if (!m) return "";
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  if (month < 1 || month > 12 || day < 1) return "";
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return "";
  return `${yyyy}-${pad2(month)}-${pad2(day)}`;
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

/**
 * An exchange rate: `15.500,00`, `15.500,50`, `15.500,123456`.
 *
 * A rate is not an amount, so it is not `formatMoney` with a different prefix.
 * It is stored `Decimal(18,6)` and every digit of that is meaningful — a
 * journal line valued at 15.500,123456 that reports as 15.500,12 misstates the
 * rate the entry was actually made at. So the decimals shown are the decimals
 * the rate has, floored at two so a whole rate still reads as a price rather
 * than as a count.
 *
 * One function because the alternative was seven call sites each passing their
 * own decimal count, and they had already drifted: every rate in the
 * application rendered at two places except the Cash & Bank master's own
 * acquisition kurs, which rendered at six.
 */
export function formatRate(
  value: number | string | { toString(): string } | null | undefined
): string {
  const n = Number(value ?? 0);
  return n.toLocaleString("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/**
 * What a foreign amount was, beside the base figure it became: `USD 1.000,00 @
 * 16.000,00`.
 *
 * One function because the pair had already drifted — the Journal rendered it
 * with a middot between the two halves and the General Ledger with an `@`, so
 * the same fact read two ways on two screens that link to each other. `@` is
 * the one that says what the second figure *is*: a price, not another item in
 * a list.
 *
 * Only ever called for a line whose currency is not the base one. A base
 * amount at a rate of 1 would be stating itself twice.
 */
export function formatForeignFace(
  amount: number | string | { toString(): string } | null | undefined,
  currencyLabel: string,
  rate: number | string | { toString(): string } | null | undefined
): string {
  return `${formatMoney(amount, currencyLabel)} @ ${formatRate(rate)}`;
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
