"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps the keyboard inside an open dialog, and gives focus back on close.
 *
 * Without it, opening a dialog left focus on the button that opened it, behind
 * the backdrop: Tab walked the page underneath, and Enter could press a header
 * button nobody could see. Focus goes to the first control inside, Tab and
 * Shift+Tab wrap at the dialog's edges, and closing returns focus to wherever
 * it was before.
 */
export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const box = ref.current;
    if (!box) return;
    const before = document.activeElement as HTMLElement | null;

    const focusables = () =>
      [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null
      );

    // A control inside that took focus itself (an autofocused input) keeps it.
    if (!box.contains(document.activeElement)) {
      (focusables()[0] ?? box).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !box.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !box.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (before && document.contains(before)) before.focus();
    };
  }, [open, ref]);
}
