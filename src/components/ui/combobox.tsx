"use client";

import { useId, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { AnchoredPopup } from "@/components/ui/anchored-popup";
import type { RefOption } from "@/lib/siba/records";

/**
 * FK picker: a search field over `CODE – Name` options.
 *
 * **The control itself is the search box.** The popup used to carry one of its
 * own, which meant the field a user had just clicked was not the field they had
 * to type into: the cursor sat in the box below, and reaching it was a second
 * movement for a mouse-first operator. Opening now turns the control into a
 * text input in place — same box, same height, same position — so clicking and
 * typing are one gesture and no second bar appears anywhere.
 *
 * Enter picks the first remaining option, which is what a filter narrowed to
 * one is for. Escape closes; `AnchoredPopup` takes it in the capture phase, so
 * one press closes this and not the dialog around it.
 *
 * Inactive records are hidden, except the one currently selected — otherwise
 * editing an old record would silently drop a still-valid reference. That was
 * an open question in the UI reference doc; this is the answer.
 */
export function Combobox({
  value,
  options,
  placeholder,
  size = "field",
  invalid,
  disabled,
  waitingFor,
  onChange,
}: {
  value: number | null;
  options: RefOption[];
  placeholder: string;
  /**
   * `sm` is the 32px a line table's row is built for, the same height
   * `MoneyInput size="sm"` takes. It is still a field: a picker inside a row
   * must not become the toolbar pill, which is uppercase and only as wide as
   * its own text.
   */
  size?: "field" | "sm";
  invalid?: boolean;
  disabled?: boolean;
  /**
   * What has to be chosen before this field can be — `Pilih Company dulu…`.
   *
   * Not the same as `disabled`, and drawn differently on purpose: disabled
   * means never, this means not yet. A picker whose prerequisite is unanswered
   * used to open onto an empty list reading "Tidak ada pilihan yang cocok",
   * which says the options do not exist when in fact the question that decides
   * them has not been asked. The field is still there, still in its place and
   * still explaining itself — it simply will not collect an answer out of
   * order. The same shape the segment input's "menunggu induk" prefix uses.
   */
  waitingFor?: string | null;
  onChange: (value: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.id === value) ?? null;

  const visible = options.filter((o) => {
    if (!o.active && o.id !== value) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      o.label.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)
    );
  });

  if (disabled || waitingFor) {
    return (
      <div
        className={`cbx${size === "sm" ? " sm" : ""} dis${waitingFor ? " wait" : ""}`}
        title={waitingFor ?? undefined}
      >
        <span className="v">
          {selected ? (
            <>
              <span className="lab">{selected.label}</span>
              <span className="nm">{selected.name}</span>
            </>
          ) : (
            <span className="ph">{waitingFor ?? "—"}</span>
          )}
        </span>
      </div>
    );
  }

  const pick = (id: number) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={wrapRef}>
      <div
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        tabIndex={open ? -1 : 0}
        className={`cbx${size === "sm" ? " sm" : ""}${invalid ? " bad" : ""}${open ? " open" : ""}`}
        onMouseDown={(e) => {
          // The popup ignores clicks on its own anchor, so closing again has to
          // happen here — but a click *into* the search input is a click in
          // the field, not on the trigger, and must leave it open.
          if (open) {
            if ((e.target as HTMLElement).tagName === "INPUT") return;
            e.preventDefault();
            setOpen(false);
            setQuery("");
            return;
          }
          e.preventDefault();
          setOpen(true);
          setQuery("");
        }}
        onKeyDown={(e) => {
          if (open) return;
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setQuery("");
          }
        }}
      >
        {open ? (
          <input
            className="cbq"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // The value that is already set, as the prompt: the field still
            // says what it holds while it is being searched in.
            placeholder={
              selected ? `${selected.label} – ${selected.name}` : placeholder
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (visible.length) pick(visible[0].id);
              }
            }}
          />
        ) : (
          <span className="v">
            {selected ? (
              <>
                <span className="lab">{selected.label}</span>
                <span className="nm">{selected.name}</span>
              </>
            ) : (
              <span className="ph">{placeholder}</span>
            )}
          </span>
        )}
        {selected && !open && (
          <span
            className="xb"
            title="Kosongkan"
            role="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange(null);
            }}
          >
            <Icon name="block" size={12} />
          </span>
        )}
        <span className="cv">
          <Icon name="expand" size={13} />
        </span>
      </div>

      <AnchoredPopup
        anchorRef={wrapRef}
        open={open}
        onDismiss={() => {
          setOpen(false);
          setQuery("");
        }}
        width="anchor"
        className="cbpop"
      >
        <div className="l" id={listId} role="listbox">
          {visible.length ? (
            visible.map((o) => (
              <div
                key={o.id}
                className={`cbo${o.id === value ? " sel" : ""}`}
                onClick={() => pick(o.id)}
              >
                <span className="lab">{o.label}</span>
                <span className="nm">{o.name}</span>
                {o.id === value && (
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
