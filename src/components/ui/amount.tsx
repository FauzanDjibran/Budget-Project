import { formatMoney } from "@/lib/format";
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
 */
export function Amount({
  value,
  currency = BASE_CURRENCY_LABEL,
  nil = "figure",
  big,
}: {
  value: number;
  currency?: string;
  nil?: "dash" | "figure";
  /** A total: larger, in the brand colour. */
  big?: boolean;
}) {
  if (nil === "dash" && Math.round(value * 100) === 0) {
    return <span className="dash">—</span>;
  }
  return (
    <span className={`mny${big ? " big" : ""}`}>{formatMoney(value, currency)}</span>
  );
}
