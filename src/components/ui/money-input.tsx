"use client";

import { formatNumber } from "@/lib/format";

/**
 * The application's amount field.
 *
 * Every amount a user types goes through this, for the same reason every date
 * goes through `DateInput`: a native `<input type="number">` is drawn by the
 * operating system — its spinner is the OS's, it left-aligns the figure, and it
 * cannot show a thousands separator. Before this existed the same amount read
 * three ways on three screens: `231411` with OS spinners on Cash & Bank's
 * opening balance, `3243222` right-aligned on Budget, and `3.243.222` grouped
 * on a Cash Bank Transaction line. An accountant checking a figure reads the
 * grouping, so the grouping is not decoration.
 *
 * The value crossing in and out is a plain unformatted numeric string — what a
 * Server Action parses — and the separators live only in what is displayed.
 * Digits are the only thing the field accepts, which is also what keeps the
 * two forms in step: a separator typed by hand cannot desync the two.
 */
export function MoneyInput({
  value,
  onChange,
  currencyLabel,
  size = "field",
  invalid,
  over,
  disabled,
  placeholder = "0",
  ariaLabel,
}: {
  /** Unformatted, e.g. `"3243222"` or `""`. */
  value: string;
  onChange: (value: string) => void;
  /** Shown inside the box on the left. Omitted where a column already says it. */
  currencyLabel?: string;
  size?: "field" | "sm";
  invalid?: boolean;
  /** The one state an amount carries: it exceeds what it is settling. */
  over?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const digits = (value ?? "").replace(/[^0-9]/g, "");

  const wrap = [
    "mwrap",
    size === "sm" ? "sm" : "",
    currencyLabel ? "" : "nocur",
    over ? "over" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={wrap}>
      {currencyLabel && <span className="cur">{currencyLabel}</span>}
      <input
        className={`inp mfield${invalid ? " bad" : ""}${over ? " over" : ""}`}
        value={digits ? formatNumber(Number(digits)) : ""}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="off"
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
      />
    </span>
  );
}
