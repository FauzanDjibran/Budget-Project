/**
 * The chart of accounts is one numbering scheme, top to bottom.
 *
 * A code is a dotted path of segments, and every level continues its parent's
 * code rather than starting a new one:
 *
 *     1          Account Type          AKTIVA
 *     1.1        Account Category      AKTIVA LANCAR
 *     1.1.1      Account Subcategory   KAS / SETARA KAS
 *     1.1.1.2    Account               BANK
 *     1.1.1.2.1  Account               BANK BCA IDR
 *
 * The first three levels are the seeded skeleton and are always exactly one,
 * two and three segments. Everything below is an account, and an account may
 * nest under another account without limit.
 *
 * Only the last segment is ever typed: the rest is inherited from whatever the
 * new row hangs under, so a code cannot be written that contradicts its own
 * lineage. `1.1.1.10` and `1.1.2.10` are different codes and may both exist;
 * two `1.1.1.10` within one Company may not.
 *
 * Client-safe: no database import, so the form and the Server Action read the
 * same rules.
 */

/** A segment is 1–999. Wide enough for any real ledger, narrow enough to read. */
export const SEGMENT_MIN = 1;
export const SEGMENT_MAX = 999;

/** How many segments each level of the skeleton carries. */
export const TYPE_DEPTH = 1;
export const CATEGORY_DEPTH = 2;
export const SUBCATEGORY_DEPTH = 3;

/** The shallowest an account can be: one segment below a subcategory. */
export const ACCOUNT_MIN_DEPTH = SUBCATEGORY_DEPTH + 1;

export const SEGMENT_RANGE_TEXT = `${SEGMENT_MIN}–${SEGMENT_MAX}`;

/**
 * The segments of a code, or null if it is not a code at all. Leading zeroes
 * are rejected rather than trimmed: `1.1.1.01` and `1.1.1.1` must not be two
 * spellings of one account.
 */
export function codeSegments(code: string): number[] | null {
  const parts = String(code ?? "").split(".");
  if (parts.length === 0) return null;
  const out: number[] = [];
  for (const part of parts) {
    if (!/^[1-9][0-9]{0,2}$/.test(part)) return null;
    out.push(Number(part));
  }
  return out;
}

export function isAccountCode(code: string): boolean {
  return codeSegments(code) !== null;
}

/** Segment count, or 0 when the string is not a code. */
export function codeDepth(code: string): number {
  return codeSegments(code)?.length ?? 0;
}

/** The code one level up, or null at the top. */
export function parentCode(code: string): string | null {
  const parts = String(code ?? "").split(".");
  return parts.length > 1 ? parts.slice(0, -1).join(".") : null;
}

/** True when `code` is `ancestor` itself or sits anywhere beneath it. */
export function isUnder(code: string, ancestor: string): boolean {
  return code === ancestor || code.startsWith(`${ancestor}.`);
}

/**
 * A typed segment, or null when it is not a whole number in range.
 *
 * Deliberately the same shape `codeSegments` accepts, leading zeroes included:
 * reading `007` as 7 would let one account be typed two ways, and the point of
 * the scheme is that a code has exactly one spelling.
 */
export function parseSegment(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  if (!/^[1-9][0-9]{0,2}$/.test(text)) return null;
  const n = Number(text);
  return n >= SEGMENT_MIN && n <= SEGMENT_MAX ? n : null;
}

/** `1.1.1` + `2` -> `1.1.1.2`. */
export function joinCode(prefix: string, segment: number): string {
  return `${prefix}.${segment}`;
}

/**
 * Orders codes the way a chart of accounts reads — segment by segment, as
 * numbers. String ordering would put `1.1.10` before `1.1.2`.
 */
export function compareCodes(a: string, b: string): number {
  const left = a.split(".");
  const right = b.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = Number(left[i] ?? -1);
    const y = Number(right[i] ?? -1);
    if (x !== y) return x - y;
  }
  return 0;
}
