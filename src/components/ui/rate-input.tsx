"use client";

import { MoneyInput } from "./money-input";

/**
 * The kurs field.
 *
 * **It is `MoneyInput`.** A rate is a number typed into a box, exactly as an
 * amount is, and the two sit side by side on the Cash & Bank form — Saldo Awal
 * beside Kurs Perolehan — so a reader learns one behaviour or notices that
 * there are two. This file exists for the two things that genuinely differ:
 * six decimal places rather than none, and a label naming the **pair** the rate
 * converts (`USD → IDR`) rather than a single currency.
 *
 * It briefly was a control of its own, on the reasoning that a rate is not an
 * amount. That is true of what a rate *means* — a ratio rather than a quantity,
 * and one that must never be re-derived (CLAUDE.md §12) — and it says nothing
 * about how the figure is entered. The separate implementation diverged within
 * a day: it stopped grouping while focused, so the same keystroke produced a
 * grouped figure in one field and an ungrouped one in the next.
 *
 * The pair label is wider than a currency code, so the box reserves more room
 * for it — `.mwrap.pair` rather than the amount field's 48px.
 */
export function RateInput({
  value,
  onChange,
  /** The pair this rate converts, shown inside the box: `USD → IDR`. */
  pairLabel,
  invalid,
  disabled,
  placeholder = "0",
  ariaLabel,
}: {
  /** Unformatted with a `.` decimal point, e.g. `"15500.5"` or `""`. */
  value: string;
  onChange: (value: string) => void;
  pairLabel?: string;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <MoneyInput
      value={value}
      onChange={onChange}
      currencyLabel={pairLabel}
      labelWidth="pair"
      decimals={RATE_DECIMALS}
      invalid={invalid}
      disabled={disabled}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
    />
  );
}

/** What `Decimal(18, 6)` holds, and therefore what the field accepts. */
export const RATE_DECIMALS = 6;
