"use client";

import { useEffect } from "react";
import { Icon, type IconName } from "@/components/icon";

/**
 * Centred confirm dialog, matching the mockup: tinted icon, a subject chip
 * naming the exact record, and body copy that states the consequence rather
 * than just asking "are you sure?".
 */
export function ConfirmDialog({
  open,
  icon,
  tone,
  title,
  subject,
  body,
  confirmLabel,
  confirmTone = "primary",
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  icon: IconName;
  tone: "danger" | "ok" | "brand";
  title: string;
  subject?: string;
  body: string;
  confirmLabel: string;
  confirmTone?: "primary" | "solid-danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra input the confirmation itself needs, e.g. a replacement password. */
  children?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const tones = {
    danger: { background: "var(--bad-bg)", color: "var(--bad)" },
    ok: { background: "var(--ok-bg)", color: "var(--ok)" },
    brand: { background: "var(--brand-50)", color: "var(--brand)" },
  }[tone];

  return (
    <div
      className="ovl"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <div className="mi" style={tones}>
          <Icon name={icon} size={21} />
        </div>
        <h3>{title}</h3>
        {subject && <div className="subj">{subject}</div>}
        <p>{body}</p>
        {children && <div className="mbody">{children}</div>}
        <div className="mf">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Batal
          </button>
          <button
            className={`btn ${confirmTone}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Memproses…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
