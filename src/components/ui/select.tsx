"use client";

import { Fragment, useId, useRef, useState } from "react";
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
 * A long list can carry **groups** and ask for a **wider list**. Both are opt-in
 * and neither changes a caller that does not pass them: options arrive already
 * ordered, a header is emitted each time `group` changes, and filtering leaves
 * headers only over the groups that still have options. They exist because a
 * list of combinations — 22 Transaction Purposes, each a direction x category x
 * partner category — is read by its facets, and stating the category once over
 * a run of rows is what gives the label the width to finish its sentence.
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
  /**
   * The heading this option sits under. Options carrying one are expected to
   * arrive already ordered by it — the list emits a header each time the value
   * changes rather than sorting, so the caller keeps control of the order and a
   * group whose every option is filtered out simply never gets a header.
   */
  group?: string;
  disabled?: boolean;
};

const TRIGGER_CLASS = {
  field: "cbx",
  toolbar: "tsel",
  compact: "psel",
  ctx: "ctxsel",
} as const;

/**
 * How wide the list may get. `wide` is for lists whose options are sentences
 * rather than names: the Transaction Purpose list is 22 phrases of up to 46
 * characters, and at the default every one of them was cut off at its last
 * word — which is exactly where it names the Partner Category.
 */
const LIST_MAX_WIDTH = { default: 320, wide: 440 } as const;

/**
 * The options a query leaves, in the order they were given.
 *
 * Every word must match somewhere, rather than the whole query matching as one
 * substring. A list whose options are a combination of facets is searched by
 * naming facets — "pengeluaran cabang" — and under a single-substring test that
 * finds nothing, because no row spells the two in that order. A row is its
 * label, its hint and the group it sits under: all three are on screen, so all
 * three are things a reader will type.
 *
 * Exported and pure so the rule can be driven directly, the way the amount
 * field's parsing is.
 */
export function filterOptions(options: SelectOption[], query: string): SelectOption[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return options;
  return options.filter((o) => {
    const haystack = `${o.label} ${o.hint ?? ""} ${o.group ?? ""}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

export function Select({
  value,
  options,
  onChange,
  variant = "field",
  size = "field",
  /** Always phrased `Pilih <what>…`, the same prompt a Combobox shows. */
  placeholder = "Pilih…",
  /** Marks the control as carrying an active filter (`.set`). */
  set,
  invalid,
  disabled,
  searchable,
  listWidth = "default",
  title,
  ariaLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  variant?: keyof typeof TRIGGER_CLASS;
  /** `sm` sizes the **field** trigger for a line table's 32px row. */
  size?: "field" | "sm";
  placeholder?: string;
  set?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  /** Turns the trigger into a filter box. Defaults on once the list is long. */
  searchable?: boolean;
  listWidth?: keyof typeof LIST_MAX_WIDTH;
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

  const visible = filterOptions(options, query);

  const cls = [
    TRIGGER_CLASS[variant],
    // Only the field trigger has a small size: `sm` is the 32px a line table's
    // row is built for. The toolbar and context triggers are already their own
    // heights and are never put inside a row.
    size === "sm" && variant === "field" ? "sm" : "",
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
        maxWidth={LIST_MAX_WIDTH[listWidth]}
      >
        <div className="l" id={listId} role="listbox">
          {visible.length ? (
            visible.map((o, i) => (
              <Fragment key={o.value}>
                {o.group && o.group !== visible[i - 1]?.group && (
                  <div className="cbgh" role="presentation">
                    {o.group}
                  </div>
                )}
                <div
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
              </Fragment>
            ))
          ) : (
            <div className="cbe">Tidak ada pilihan yang cocok.</div>
          )}
        </div>
      </AnchoredPopup>
    </div>
  );
}
