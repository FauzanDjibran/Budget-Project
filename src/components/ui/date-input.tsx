"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { MONTHS_LONG, formatDate, toDisplayDate, toIsoDate } from "@/lib/format";

/**
 * The application's date field, in `dd/mm/yyyy`.
 *
 * A native `<input type="date">` renders in the *browser's* locale, so the same
 * form showed `mm/dd/yyyy` to one user and `dd/mm/yyyy` to another, and its
 * picker is drawn by the operating system. This types and displays `dd/mm/yyyy`
 * for everyone and draws its own calendar from the design system.
 *
 * The value crossing in and out stays ISO (`yyyy-mm-dd`) — that is what the
 * Server Actions parse and what the database stores. Only the display is
 * Indonesian.
 */
export function DateInput({
  value,
  onChange,
  invalid,
  disabled,
  placeholder = "dd/mm/yyyy",
}: {
  /** `yyyy-mm-dd`, or empty. */
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  /**
   * What is in the box while it is being typed in, and `null` the rest of the
   * time. Holding the draft separately is what lets the field follow `value`
   * when something else changes it — a dependent field resetting, a date picked
   * from the calendar — without an effect trying to sync two copies of the same
   * thing.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? toDisplayDate(value);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  /** The month the calendar is showing — the selected date, else today. */
  const [cursor, setCursor] = useState(() => monthOf(value));

  /** Opening re-centres the calendar on whatever is currently selected. */
  const show = () => {
    if (open) return;
    setCursor(monthOf(value));
    setOpen(true);
  };

  const toggle = () => {
    if (open) setOpen(false);
    else show();
  };

  const commit = (raw: string) => {
    const iso = toIsoDate(raw);
    if (iso) {
      setDraft(null);
      if (iso !== value) onChange(iso);
      return;
    }
    if (raw.trim() === "") {
      setDraft(null);
      if (value !== "") onChange("");
      return;
    }
    // Text that is not a date at all is left in the box rather than silently
    // discarded, so the typo is visible and correctable.
    setDraft(raw);
  };

  return (
    <div ref={wrapRef} className="dtf">
      <input
        className={`inp dti${invalid ? " bad" : ""}`}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="off"
        // The calendar is the point of the field, so reaching the field opens
        // it. Typing still works over the top: the calendar sits below the box
        // and follows what is typed rather than competing with it.
        onFocus={show}
        onClick={show}
        onChange={(e) => setDraft(mask(e.target.value))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(text);
            setOpen(false);
          }
        }}
      />
      <button
        type="button"
        className="dtb"
        title="Pilih tanggal"
        aria-label="Pilih tanggal"
        disabled={disabled}
        onClick={toggle}
      >
        <Icon name="cal" size={14} />
      </button>

      {open && !disabled && (
        <Calendar
          cursor={cursor}
          selected={value}
          onCursor={setCursor}
          onPick={(iso) => {
            setDraft(null);
            onChange(iso);
            setOpen(false);
          }}
          onClear={() => {
            setDraft(null);
            onChange("");
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Day-of-week headings, Monday first — the Indonesian convention. */
const DOW = ["Sn", "Sl", "Rb", "Km", "Jm", "Sb", "Mg"];

function Calendar({
  cursor,
  selected,
  onCursor,
  onPick,
  onClear,
}: {
  cursor: { year: number; month: number };
  selected: string;
  onCursor: (c: { year: number; month: number }) => void;
  onPick: (iso: string) => void;
  onClear: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const days = useMemo(() => {
    const first = new Date(Date.UTC(cursor.year, cursor.month, 1));
    // getUTCDay() is Sunday-first; shift so Monday starts the row.
    const lead = (first.getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
    const cells: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= count; d += 1) {
      cells.push(new Date(Date.UTC(cursor.year, cursor.month, d)).toISOString().slice(0, 10));
    }
    return cells;
  }, [cursor]);

  const shift = (months: number) => {
    const d = new Date(Date.UTC(cursor.year, cursor.month + months, 1));
    onCursor({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
  };

  return (
    <div className="cbpop cal">
      <div className="cal-h">
        <button type="button" className="pg" title="Tahun sebelumnya" onClick={() => shift(-12)}>
          «
        </button>
        <button type="button" className="pg" title="Bulan sebelumnya" onClick={() => shift(-1)}>
          ‹
        </button>
        <span className="cal-t">
          {MONTHS_LONG[cursor.month]} {cursor.year}
        </span>
        <button type="button" className="pg" title="Bulan berikutnya" onClick={() => shift(1)}>
          ›
        </button>
        <button type="button" className="pg" title="Tahun berikutnya" onClick={() => shift(12)}>
          »
        </button>
      </div>

      <div className="cal-g">
        {DOW.map((d) => (
          <span className="cal-d" key={d}>
            {d}
          </span>
        ))}
        {days.map((iso, i) =>
          iso ? (
            <button
              type="button"
              key={iso}
              className={`cal-c${iso === selected ? " sel" : ""}${iso === today ? " now" : ""}`}
              onClick={() => onPick(iso)}
            >
              {Number(iso.slice(8, 10))}
            </button>
          ) : (
            <span key={`pad-${i}`} />
          )
        )}
      </div>

      <div className="cal-f">
        <button type="button" className="btn sm ghost" onClick={() => onPick(today)}>
          Hari ini · {formatDate(today)}
        </button>
        {selected && (
          <button type="button" className="btn sm ghost" onClick={onClear}>
            Kosongkan
          </button>
        )}
      </div>
    </div>
  );
}

function monthOf(iso: string): { year: number; month: number } {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : new Date();
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

/** Keeps typing on the `dd/mm/yyyy` rails: digits only, slashes inserted. */
function mask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(
    (p) => p !== ""
  );
  return parts.join("/");
}
