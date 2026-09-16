"use client";

import { formatNumber } from "@/lib/format";

/**
 * The application's exchange-rate field.
 *
 * A separate control from `MoneyInput`, and not merely a variant of it. A rate
 * is not an amount: it is a ratio between two currencies, it carries six
 * decimals where money carries two, and it is read as a price rather than as a
 * balance. Handing it the money control would say the two are the same kind of
 * figure, and the first person to type `15.500,50` into a field that silently
 * dropped the decimals would find out otherwise.
 *
 * What it shares with `MoneyInput` is the reason both exist: a native `<input
 * type="number">` is drawn by the operating system, so its spinner, its
 * alignment and its decimal separator are the OS's rather than the
 * application's. Neither control is ever a native one.
 *
 * The value crossing in and out is a plain unformatted numeric string with a
 * `.` decimal point — what a Server Action parses. What is *displayed* uses
 * Indonesian convention: `.` groups thousands and `,` separates decimals, so
 * `15500.5` shows as `15.500,5`. The user types either separator and the field
 * reads it the same way, because insisting on one of them is a trap when both
 * appear on the same keyboard.
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
    <span className={`mwrap${pairLabel ? "" : " nocur"}`}>
      {pairLabel && <span className="cur">{pairLabel}</span>}
      <input
        className={`inp mfield${invalid ? " bad" : ""}`}
        value={displayRate(value)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        onChange={(e) => onChange(parseRate(e.target.value))}
      />
    </span>
  );
}

/**
 * What the user typed, reduced to a storable rate.
 *
 * Digits, one decimal point, at most six places — the precision the column
 * holds. Group separators are dropped rather than refused: somebody pasting
 * `15.500,25` means fifteen and a half thousand, and a field that turned that
 * into `15,50025` would be worse than one that ignored the keystroke.
 */
export function parseRate(input: string): string {
  const raw = (input ?? "").trim();
  if (!raw) return "";

  // Whichever separator appears last is the decimal point; everything else
  // groups. `15.500,25` and `15,500.25` therefore both read as 15500.25.
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  const decimalAt = Math.max(lastComma, lastDot);

  let whole = raw;
  let fraction = "";
  if (decimalAt >= 0) {
    // A separator followed by exactly three digits, with no other separator
    // after it, is a thousands group rather than a decimal point — `15.500` is
    // fifteen thousand five hundred, not fifteen and a half.
    const tail = raw.slice(decimalAt + 1);
    const groups = (raw.match(/[.,]/g) ?? []).length;
    const isGrouping = /^\d{3}$/.test(tail) && groups === 1;
    if (!isGrouping) {
      whole = raw.slice(0, decimalAt);
      fraction = tail;
    }
  }

  const w = whole.replace(/[^0-9]/g, "");
  const f = fraction.replace(/[^0-9]/g, "").slice(0, 6);
  if (!w && !f) return "";
  return f ? `${w || "0"}.${f}` : w;
}

/** `15500.5` -> `15.500,5`. Trailing zeros are not invented. */
function displayRate(value: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const [whole, fraction] = raw.split(".");
  const grouped = whole ? formatNumber(Number(whole)) : "0";
  return fraction ? `${grouped},${fraction}` : grouped;
}
