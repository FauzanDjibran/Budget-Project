"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";

/**
 * The application's dropdown.
 *
 * A native `<select>` can be styled shut but not open: the list itself is drawn
 * by the operating system, in the system's own typography and highlight colour,
 * which is why the company picker in the topbar used to drop a blue Windows
 * list over an otherwise finished interface. This renders the list itself,
 * reusing the combobox popup (`.cbpop` / `.cbo`) so every dropdown in the app —
 * FK picker, toolbar filter, form field — behaves and reads the same way.
 *
 * `variant` maps to the trigger class the surrounding layout already expects,
 * so swapping a `<select>` for this changes no spacing:
 *
 *   field    `.cbx`  — form controls, identical to the FK picker beside them
 *   toolbar  `.tsel` — list and filter bars
 *   compact  `.psel` — pagers and dense filter rows
 *   ctx      bare    — the topbar company selector, styled by `.ctx select`
 */

export type SelectOption = {
  value: string;
  label: string;
  /** Secondary text shown after the label in the list. */
  hint?: string;
  disabled?: boolean;
};

const TRIGGER_CLASS = {
  field: "cbx",
  toolbar: "tsel",
  compact: "psel",
  ctx: "ctxsel",
} as const;

export function Select({
  value,
  options,
  onChange,
  variant = "field",
  placeholder = "— pilih —",
  /** Marks the control as carrying an active filter (`.set`). */
  set,
  invalid,
  disabled,
  searchable,
  title,
  ariaLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  variant?: keyof typeof TRIGGER_CLASS;
  placeholder?: string;
  set?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  /** Adds a filter box. Defaults on once the list is long enough to need one. */
  searchable?: boolean;
  title?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const withSearch = searchable ?? options.length > 8;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visible = options.filter((o) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q);
  });

  const cls = [
    TRIGGER_CLASS[variant],
    set ? "set" : "",
    invalid ? "bad" : "",
    open ? "open" : "",
    !selected && variant === "field" ? "ph" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={wrapRef} style={{ position: "relative", display: variant === "field" ? "block" : "inline-block" }}>
      <button
        type="button"
        className={cls}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
      >
        {variant === "field" ? (
          <>
            <span className="v">
              {selected ? (
                <span className="nm">{selected.label}</span>
              ) : (
                <span className="ph">{placeholder}</span>
              )}
            </span>
            <span className="cv">
              <Icon name="expand" size={13} />
            </span>
          </>
        ) : (
          selected?.label ?? placeholder
        )}
      </button>

      {open && (
        <div
          className="cbpop"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: "100%",
            width: "max-content",
            maxWidth: 320,
          }}
        >
          {withSearch && (
            <div className="s">
              <Icon name="srch" size={13} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter pilihan…"
              />
            </div>
          )}
          <div className="l" role="listbox">
            {visible.length ? (
              visible.map((o) => (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  className={`cbo${o.value === value ? " sel" : ""}${o.disabled ? " off" : ""}`}
                  onClick={() => {
                    if (o.disabled) return;
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <span className="nm">{o.label}</span>
                  {o.hint && <span className="lab">{o.hint}</span>}
                  {o.value === value && (
                    <span className="tick">
                      <Icon name="check" size={13} />
                    </span>
                  )}
                </div>
              ))
            ) : (
              <div className="cbe">Tidak ada pilihan yang cocok.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
