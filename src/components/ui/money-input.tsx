"use client";

import { formatNumber } from "@/lib/format";

/**
 * The application's numeric field — every amount, and every kurs.
 *
 * Every number a user types goes through this, for the same reason every date
 * goes through `DateInput`: a native `<input type="number">` is drawn by the
 * operating system — its spinner is the OS's, it left-aligns the figure, and it
 * cannot show a thousands separator. Before this existed the same amount read
 * three ways on three screens: `231411` with OS spinners on Cash & Bank's
 * opening balance, `3243222` right-aligned on Budget, and `3.243.222` grouped
 * on a Cash Bank Transaction line. An accountant checking a figure reads the
 * grouping, so the grouping is not decoration.
 *
 * The value crossing in and out is a plain unformatted numeric string with a
 * `.` decimal point — what a Server Action parses — and the separators live
 * only in what is displayed. Thousands are grouped **as the figure is typed**,
 * so a number never has to be finished before it can be read.
 *
 * ## One convention, Indonesian, in both directions
 *
 * **`.` groups thousands and `,` separates decimals.** On screen and on the
 * keyboard: a `.` the user types is a thousands separator, which the field is
 * already inserting, so it is simply dropped. A decimal is reached by typing
 * `,` and nothing else. That is what makes grouping-as-you-type possible on a
 * field that also takes decimals — there is exactly one meaning per key, so
 * re-reading what is on screen can never turn `16.000` growing a digit into
 * `1,6000`, which is how typing `16000` once ended up storing `1.6`.
 *
 * ## `decimals`, and why a kurs is not a second control
 *
 * An amount carries none (rupiah) and a kurs carries six, and that is the only
 * difference between them. A rate was briefly given a control of its own on the
 * reasoning that "a rate is not an amount" — which is true of what it *means*
 * and false of how it is typed, and the separate control promptly diverged: it
 * stopped grouping while focused, so the two fields sitting side by side on the
 * Cash & Bank form behaved differently. One control, one behaviour.
 */
export function MoneyInput({
  value,
  onChange,
  currencyLabel,
  labelWidth = "code",
  size = "field",
  decimals = 0,
  invalid,
  over,
  disabled,
  placeholder = "0",
  ariaLabel,
}: {
  /** Unformatted with a `.` decimal point, e.g. `"3243222"` or `"15500.25"`. */
  value: string;
  onChange: (value: string) => void;
  /** Shown inside the box on the left. Omitted where a column already says it. */
  currencyLabel?: string;
  /**
   * How much room that label needs. `code` is a currency (`IDR`); `pair` is a
   * conversion (`USD → IDR`), which is three times as wide and would otherwise
   * be run into by a long figure, since the figure is right-aligned.
   */
  labelWidth?: "code" | "pair";
  size?: "field" | "sm";
  /** How many decimal places the field accepts. `0` — the default — is digits only. */
  decimals?: number;
  invalid?: boolean;
  /** The one state an amount carries: it exceeds what it is settling. */
  over?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const wrap = [
    "mwrap",
    size === "sm" ? "sm" : "",
    currencyLabel ? (labelWidth === "pair" ? "pair" : "") : "nocur",
    over ? "over" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={wrap}>
      {currencyLabel && <span className="cur">{currencyLabel}</span>}
      <input
        className={`inp mfield${invalid ? " bad" : ""}${over ? " over" : ""}`}
        value={displayAmount(value, decimals)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        aria-label={ariaLabel}
        onChange={(e) => onChange(parseAmount(e.target.value, decimals))}
      />
    </span>
  );
}

/**
 * What the user typed, reduced to a storable number.
 *
 * `.` always groups and is dropped — including one the user typed, because the
 * field inserts its own and a second meaning for the same character is what
 * made the kurs box unusable. `,` is the decimal separator; a second one is
 * ignored rather than allowed to make a second number.
 */
export function parseAmount(input: string, decimals = 0): string {
  const raw = (input ?? "").replace(/\./g, "");
  if (decimals <= 0) return onlyDigits(raw);

  const at = raw.indexOf(",");
  if (at < 0) return onlyDigits(raw);

  // The trailing `.` of `"16000."` is kept deliberately: the user has pressed
  // the decimal key and not yet typed a digit, and dropping it would delete the
  // keystroke under their cursor.
  return `${onlyDigits(raw.slice(0, at))}.${onlyDigits(raw.slice(at + 1)).slice(0, decimals)}`;
}

/** `15500.5` -> `15.500,5`. Trailing zeros are never invented. */
export function displayAmount(value: string, decimals = 0): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";

  if (decimals <= 0) {
    const digits = onlyDigits(raw);
    return digits ? formatNumber(Number(digits)) : "";
  }

  const at = raw.indexOf(".");
  const whole = onlyDigits(at < 0 ? raw : raw.slice(0, at));
  const grouped = whole ? formatNumber(Number(whole)) : "";
  if (at < 0) return grouped;
  return `${grouped},${onlyDigits(raw.slice(at + 1)).slice(0, decimals)}`;
}

const onlyDigits = (s: string) => s.replace(/[^0-9]/g, "");
