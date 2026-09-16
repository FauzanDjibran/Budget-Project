"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The popup every dropdown in the application hangs off its trigger.
 *
 * It exists because a popup drawn *inside* the control belongs to whatever is
 * scrolling around it. In a panel dialog the control sits in `.rp-body`, which
 * is `overflow-y:auto` — so an absolutely positioned list was clipped at the
 * body's edge and the only way to reach the options below the fold was to
 * scroll the whole dialog, which moved the field, the header and the summary
 * card along with them. The list has its own scroll; the sheet behind it should
 * not have to move at all.
 *
 * So the popup is rendered into `document.body` and positioned in viewport
 * coordinates from the trigger's own rect: nothing can clip it. It opens
 * downwards, flips above when there is more room there, and clamps its height
 * to the space it actually has, so the list scrolls internally instead of
 * running off the screen.
 *
 * Dismissal lives here too — a click outside both the trigger and the popup,
 * or Escape. Escape is taken in the **capture** phase and stopped, because a
 * dropdown inside a dialog would otherwise close the dialog as well: one key
 * press, one thing closed, the innermost.
 */

/** Gap between the trigger and the popup. */
const GAP = 4;
/** Smallest gap kept between the popup and the edge of the viewport. */
const EDGE = 8;
/** Below this there is no point opening on a side at all — flip instead. */
const MIN_HEIGHT = 140;

type Box = {
  left: number;
  top?: number;
  bottom?: number;
  width?: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
};

export function AnchoredPopup({
  anchorRef,
  open,
  onDismiss,
  /**
   * `anchor` matches the trigger exactly (the FK picker), `auto` grows to its
   * content from the trigger's width (the Select), `none` keeps whatever width
   * the class already gives it (the calendar).
   */
  width = "auto",
  /** Ceiling on the popup's height; the space available can lower it. */
  maxHeight = 300,
  /** Ceiling on its width; the room to the right of the trigger can lower it. */
  maxWidth,
  className,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onDismiss: () => void;
  width?: "anchor" | "auto" | "none";
  maxHeight?: number;
  maxWidth?: number;
  className: string;
  children: React.ReactNode;
}) {
  // Mounted only while open, so every popup starts from an unmeasured state
  // rather than from where the last one happened to sit.
  if (!open) return null;
  return (
    <Popup
      anchorRef={anchorRef}
      onDismiss={onDismiss}
      width={width}
      maxHeight={maxHeight}
      maxWidth={maxWidth}
      className={className}
    >
      {children}
    </Popup>
  );
}

function Popup({
  anchorRef,
  onDismiss,
  width,
  maxHeight,
  maxWidth,
  className,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onDismiss: () => void;
  width: "anchor" | "auto" | "none";
  maxHeight: number;
  maxWidth?: number;
  className: string;
  children: React.ReactNode;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  /**
   * The popup's height with nothing constraining it, measured on the first
   * pass — while `box` is null the element carries no `max-height`, so this is
   * the only moment the natural height is readable. Later passes must reuse it:
   * measuring a constrained popup would report the constraint back, and the
   * side it opened on would flap as the page scrolled.
   */
  const natural = useRef(0);

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current;
      const pop = popRef.current;
      if (!anchor || !pop) return;

      if (!natural.current) natural.current = pop.scrollHeight;

      const r = anchor.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const want = Math.min(maxHeight, natural.current || maxHeight);

      const below = vh - r.bottom - GAP - EDGE;
      const above = r.top - GAP - EDGE;
      const up = below < want && above > below;
      const space = Math.max(MIN_HEIGHT, up ? above : below);

      const left = Math.max(EDGE, Math.min(r.left, vw - EDGE - Math.max(r.width, 160)));

      setBox({
        left,
        top: up ? undefined : r.bottom + GAP,
        bottom: up ? vh - r.top + GAP : undefined,
        width: width === "anchor" ? r.width : undefined,
        minWidth: width === "none" ? 0 : r.width,
        maxWidth: Math.min(maxWidth ?? Infinity, vw - left - EDGE),
        maxHeight: Math.min(maxHeight, space),
      });
    };

    place();
    // Capture, so a scroll inside a dialog body — or any other scrolling
    // ancestor — moves the popup with its trigger instead of leaving it behind.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchorRef, width, maxHeight, maxWidth]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onDismiss();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onDismiss, anchorRef]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={popRef}
      className={className}
      style={
        box
          ? {
              left: box.left,
              top: box.top,
              bottom: box.bottom,
              width: box.width,
              minWidth: box.minWidth || undefined,
              maxWidth: width === "none" && maxWidth === undefined ? undefined : box.maxWidth,
              maxHeight: box.maxHeight,
            }
          : // The first pass exists only to be measured.
            { left: 0, top: 0, visibility: "hidden" }
      }
    >
      {children}
    </div>,
    document.body
  );
}
