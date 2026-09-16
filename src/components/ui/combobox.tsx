"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { AnchoredPopup } from "@/components/ui/anchored-popup";
import type { RefOption } from "@/lib/siba/records";

/**
 * FK picker: a search field over `CODE – Name` options.
 *
 * Inactive records are hidden, except the one currently selected — otherwise
 * editing an old record would silently drop a still-valid reference. That was
 * an open question in the UI reference doc; this is the answer.
 */
export function Combobox({
  value,
  options,
  placeholder,
  invalid,
  disabled,
  onChange,
}: {
  value: number | null;
  options: RefOption[];
  placeholder: string;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;

  const visible = options.filter((o) => {
    if (!o.active && o.id !== value) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      o.label.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)
    );
  });

  if (disabled) {
    return (
      <div className="cbx" style={{ background: "var(--line-3)", cursor: "not-allowed" }}>
        <span className="v">
          {selected ? (
            <>
              <span className="lab">{selected.label}</span>
              <span className="nm">{selected.name}</span>
            </>
          ) : (
            <span className="ph">—</span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div ref={wrapRef}>
      <button
        type="button"
        className={`cbx${invalid ? " bad" : ""}${open ? " open" : ""}`}
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
      >
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
        {selected && (
          <span
            className="xb"
            title="Kosongkan"
            role="button"
            tabIndex={-1}
            onClick={(e) => {
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
      </button>

      <AnchoredPopup
        anchorRef={wrapRef}
        open={open}
        onDismiss={() => setOpen(false)}
        width="anchor"
        className="cbpop"
      >
        <div className="s">
          <Icon name="srch" size={13} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter pilihan…"
          />
        </div>
        <div className="l">
          {visible.length ? (
            visible.map((o) => (
              <div
                key={o.id}
                className={`cbo${o.id === value ? " sel" : ""}`}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
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
