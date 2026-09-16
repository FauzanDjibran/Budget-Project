"use client";

import { useId, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { AnchoredPopup } from "@/components/ui/anchored-popup";

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
 * **Where it is searchable, the control itself is the search box**, exactly as
 * the FK picker is: opening turns the trigger into a text input in place rather
 * than growing a second bar inside the popup that the user then has to travel
 * to. A list short enough not to need filtering keeps a plain trigger, because
 * an input that filters nothing is a control that does nothing.
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
  /** Always phrased `Pilih <what>…`, the same prompt a Combobox shows. */
  placeholder = "Pilih…",
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
  /** Turns the trigger into a filter box. Defaults on once the list is long. */
  searchable?: boolean;
  title?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? null;
  const withSearch = searchable ?? options.length > 8;
  const searching = open && withSearch && !disabled;

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
    disabled ? "dis" : "",
    !selected && variant === "field" ? "ph" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
  };

  const toggle = (e: React.MouseEvent) => {
    if (disabled) return;
    // The popup ignores clicks on its own anchor, so closing again happens
    // here — but a click into the search input is a click in the field.
    if (open && (e.target as HTMLElement).tagName === "INPUT") return;
    e.preventDefault();
    setOpen((o) => !o);
    setQuery("");
  };

  const triggerBody = searching ? (
    <input
      className="cbq"
      autoFocus
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder={selected?.label ?? placeholder}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const first = visible.find((o) => !o.disabled);
        if (first) pick(first.value);
      }}
    />
  ) : variant === "field" ? (
    <span className="v">
      {selected ? (
        <span className="nm">{selected.label}</span>
      ) : (
        <span className="ph">{placeholder}</span>
      )}
    </span>
  ) : (
    <span className="tv">{selected?.label ?? placeholder}</span>
  );

  return (
    <div ref={wrapRef} style={{ display: variant === "field" ? "block" : "inline-block" }}>
      {/* A `<div>` rather than a `<button>`: a button may not contain the input
          the search turns it into, and a trigger that changed element type
          between its two states would lose focus mid-gesture. */}
      <div
        role="combobox"
        className={cls}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-disabled={disabled || undefined}
        tabIndex={disabled || searching ? -1 : 0}
        onMouseDown={toggle}
        onKeyDown={(e) => {
          if (open || disabled) return;
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setQuery("");
          }
        }}
      >
        {triggerBody}
        {variant === "field" && (
          <span className="cv">
            <Icon name="expand" size={13} />
          </span>
        )}
      </div>

      <AnchoredPopup
        anchorRef={wrapRef}
        open={open && !disabled}
        onDismiss={() => {
          setOpen(false);
          setQuery("");
        }}
        className="cbpop"
        maxWidth={320}
      >
        <div className="l" id={listId} role="listbox">
          {visible.length ? (
            visible.map((o) => (
              <div
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={`cbo${o.value === value ? " sel" : ""}${o.disabled ? " off" : ""}`}
                onClick={() => {
                  if (o.disabled) return;
                  pick(o.value);
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
      </AnchoredPopup>
    </div>
  );
}
