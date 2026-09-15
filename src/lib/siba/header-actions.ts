/**
 * Where a button sits in a page header, decided once.
 *
 * `.ph-act` is the one place an action may live (CLAUDE.md §8, §12), so the
 * order of the buttons inside it is the order of every action in the
 * application. Left to right: what undoes or refuses, then what is merely
 * another step, then the one thing the screen is chiefly for.
 *
 *     [ Tolak ] [ Batalkan ]   …   [ Setujui ]
 *       danger    danger              primary
 *
 * Why this module exists. The three lifecycle headers each mapped their
 * module's `availableActions()` straight into the header, and that order —
 * submit, approve, reject, cancel — was written for the *vertical* row menu,
 * where safe-first and danger-last is right. Reused horizontally it put the
 * approve button on the left of the reject button on one screen and on the
 * right of it on the next, so the same click landed on a different word
 * depending which status the record happened to be in. Nothing was broken;
 * the buttons simply moved around under the user's cursor.
 *
 * The vertical menus keep their own order, which is the opposite arrangement
 * and the correct one there. Only `.ph-act` is ordered by this module.
 *
 * Ordering happens in the markup rather than through CSS `order`, deliberately:
 * `order` moves a button on screen without moving it in the document, so the
 * tab order would stop matching what a keyboard user is looking at.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */

/**
 * What a header button does to the record, which is what decides both where it
 * sits and how it is drawn. `neutral` is everything that neither destroys nor
 * completes: Ubah, Batal, Reset Password, Buka Semua.
 */
export type ActionTone = "danger" | "neutral" | "primary";

const WEIGHT: Record<ActionTone, number> = {
  danger: 0,
  neutral: 1,
  primary: 2,
};

/**
 * Header order: danger, then neutral, then primary. Stable, so two buttons of
 * the same tone keep the order their module declared them in — `Tolak` before
 * `Batalkan` because the transition table says so, not because of a sort.
 */
export function orderForHeader<T>(
  items: readonly T[],
  toneOf: (item: T) => ActionTone
): T[] {
  return items
    .map((item, i) => ({ item, i, w: WEIGHT[toneOf(item)] }))
    .sort((a, b) => a.w - b.w || a.i - b.i)
    .map((x) => x.item);
}

/** How a header button is drawn. One primary per header — the rightmost one. */
export function headerButtonClass(tone: ActionTone): string {
  return tone === "danger" ? "btn danger" : tone === "primary" ? "btn primary" : "btn";
}

/** How the same action is drawn inside a vertical row menu. */
export function menuButtonClass(tone: ActionTone): string | undefined {
  return tone === "danger" ? "dg" : undefined;
}
