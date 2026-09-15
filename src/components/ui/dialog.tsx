"use client";

import { useEffect } from "react";
import { Icon, type IconName } from "@/components/icon";

export type DialogTone = "ok" | "bad" | "brand" | "warn";

/**
 * The panel dialog: a wide, left-aligned sheet with a fixed header, a body that
 * scrolls, and a fixed footer.
 *
 * `ConfirmDialog` is the other shape — small, centred, one question. Everything
 * else that opens over the page uses this, and uses it whole: before it existed
 * the four panel dialogs in the application each drew their own header out of
 * inline styles, so their icons were 34px in two of them and 38px in the other
 * two, two had a close button and two did not, and the title sat at a different
 * height in each. A user who learns one dialog should recognise the next.
 *
 * Escape closes, and so does a click on the backdrop — never a click inside,
 * which is why the backdrop listens on `mousedown` against its own target: a
 * selection dragged out of the body used to dismiss the dialog.
 */
export function Dialog({
  open,
  icon,
  tone = "brand",
  title,
  subtitle,
  width,
  headExtra,
  foot,
  onClose,
  children,
}: {
  open: boolean;
  icon: IconName;
  tone?: DialogTone;
  title: string;
  subtitle?: string;
  /** Maximum width in px; the dialog still shrinks on a narrow viewport. */
  width: number;
  /** A control belonging to the header, e.g. "tandai semua". */
  headExtra?: React.ReactNode;
  /** The fixed footer. Omitted when the dialog has nothing to conclude. */
  foot?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ovl"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal modal-flex"
        role="dialog"
        aria-modal="true"
        style={{ width: `min(${width}px, 95vw)` }}
      >
        <div className="rp-head">
          <span className={`mi sm t-${tone}`}>
            <Icon name={icon} size={16} />
          </span>
          <div className="t">
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {headExtra}
          <button className="btn ico" onClick={onClose} title="Tutup">
            <Icon name="block" size={15} />
          </button>
        </div>

        <div className="rp-body">{children}</div>

        {foot && <div className="rp-foot">{foot}</div>}
      </div>
    </div>
  );
}
