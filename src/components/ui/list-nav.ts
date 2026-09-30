"use client";

import { useEffect, useState } from "react";

/**
 * The highlighted option of an open dropdown, moved from the keyboard.
 *
 * Every dropdown in the app — `Combobox`, `Select`, and `MultiSelect` through
 * its combobox — shares this, so ↓ / ↑ / Enter behave the same in all of them
 * and a mouse-first form can still be filled without reaching for the mouse.
 *
 * The highlight **starts on the current value** when the list opens (else on
 * the first option that can be picked), goes back to the first match whenever
 * the query changes, skips options that cannot be picked, and stops at the
 * ends rather than wrapping — a wrap from the last row to the first reads as a
 * jump the user did not ask for. Hovering moves it too, so the mouse and the
 * keyboard never point at two different rows.
 *
 * `resetKey` is whatever, when it changes, should put the highlight back on
 * `initial` — the open state and the query.
 */
export function useListNav({
  listRef,
  pickable,
  initial,
  resetKey,
}: {
  /** The list element; the highlighted row is scrolled into view inside it. */
  listRef: React.RefObject<HTMLDivElement | null>;
  /** One entry per visible option: can it be picked? */
  pickable: boolean[];
  /** Where the highlight starts when `resetKey` changes. */
  initial: number;
  resetKey: string;
}) {
  const [active, setActive] = useState(initial);
  const [seenKey, setSeenKey] = useState(resetKey);

  // Adjusting state while rendering, not in an effect: the list must never
  // paint once with the highlight on a row the new query has removed.
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setActive(initial);
  }

  useEffect(() => {
    if (active < 0) return;
    listRef.current
      ?.querySelector(`[data-i="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, resetKey, listRef]);

  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < pickable.length; i += dir) {
      if (pickable[i]) return i;
    }
    return from;
  };

  /**
   * Handles a key while the list is open. Returns true when the key was taken,
   * so the caller does nothing more with it. `inText` is true inside a search
   * box, where Home / End keep moving the text cursor.
   */
  const onKey = (e: React.KeyboardEvent, pick: (i: number) => void, inText: boolean) => {
    const last = pickable.length - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a < 0 ? step(-1, 1) : step(a, 1)));
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a < 0 ? step(last + 1, -1) : step(a, -1)));
      return true;
    }
    if (!inText && e.key === "Home") {
      e.preventDefault();
      setActive(step(-1, 1));
      return true;
    }
    if (!inText && e.key === "End") {
      e.preventDefault();
      setActive(step(last + 1, -1));
      return true;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && pickable[active]) pick(active);
      return true;
    }
    return false;
  };

  /** Spread onto each option: its index, its highlight, and the hover. */
  const optionProps = (i: number) => ({
    "data-i": i,
    onMouseMove: () => {
      if (pickable[i] && active !== i) setActive(i);
    },
  });

  return { active, onKey, optionProps };
}

/** The first pickable index at or after `preferred`'s place, else the first pickable. */
export function startIndex(pickable: boolean[], preferred: number): number {
  if (preferred >= 0 && pickable[preferred]) return preferred;
  return pickable.findIndex(Boolean);
}
