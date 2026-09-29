import { formatAccounting, formatMoney } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";

/**
 * A money figure printed in a table or a total — mono, grouped, with its
 * currency. The one way a document screen prints an amount, because the
 * Journal had drifted to the sans-serif body font while every other document
 * printed its figures in `.mny`.
 *
 * `nil` decides what a zero reads as: a dash where a column is one side of a
 * pair (a debit line has no kredit), or the figure itself where a nil is an
 * answer somebody checks.
 *
 * `ledger` prints it the accountant's way — a negative in parentheses rather
 * than a minus, and still with its currency, like every other amount in the
 * application. The Journal and the General Ledger print every figure so.
 */
export function Amount({
  value,
  currency = BASE_CURRENCY_LABEL,
  nil = "figure",
  big,
  ledger,
}: {
  value: number;
  currency?: string;
  nil?: "dash" | "figure";
  /** A total: larger, in the brand colour. */
  big?: boolean;
  /** A negative in parentheses: `(Rp 1.500.000)`. */
  ledger?: boolean;
}) {
  if (nil === "dash" && Math.round(value * 100) === 0) {
    return <span className="dash">—</span>;
  }
  return (
    <span className={`mny${big ? " big" : ""}`}>
      {ledger ? formatAccounting(value, currency) : formatMoney(value, currency)}
    </span>
  );
}
