"use client";

import { useCallback, useMemo, useState } from "react";
import { Icon } from "@/components/icon";

/**
 * Row selection for a register's checkbox column.
 *
 * The selection is kept by id and trimmed to what `selectable` still contains,
 * so a row that leaves the list — moved by the action just taken, filtered
 * away — never lingers as an invisible part of the next bulk action.
 */
export function useSelection(selectable: number[]) {
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const allowed = useMemo(() => new Set(selectable), [selectable]);
  const ids = useMemo(
    () => [...picked].filter((id) => allowed.has(id)),
    [picked, allowed]
  );

  const has = useCallback((id: number) => picked.has(id) && allowed.has(id), [picked, allowed]);

  const toggle = useCallback((id: number) => {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Selects every id given, or clears them all when every one is already on. */
  const toggleMany = useCallback(
    (many: number[]) => {
      setPicked((p) => {
        const next = new Set(p);
        const all = many.length > 0 && many.every((id) => next.has(id));
        for (const id of many) {
          if (all) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    },
    []
  );

  const clear = useCallback(() => setPicked(new Set()), []);

  return { ids, has, toggle, toggleMany, clear };
}

/** The state of a header checkbox over `many`: all, some, or none selected. */
export function SelectAll({
  many,
  has,
  onToggle,
  label = "Pilih semua di halaman ini",
}: {
  many: number[];
  has: (id: number) => boolean;
  onToggle: () => void;
  label?: string;
}) {
  const on = many.filter(has).length;
  return (
    <input
      type="checkbox"
      aria-label={label}
      title={label}
      disabled={!many.length}
      checked={many.length > 0 && on === many.length}
      ref={(el) => {
        if (el) el.indeterminate = on > 0 && on < many.length;
      }}
      onChange={onToggle}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** "3 dipilih ×" — the selection, stated in `.ph-act` beside what it enables. */
export function SelectionCount({
  count,
  onClear,
}: {
  count: number;
  onClear: () => void;
}) {
  return (
    <span className="selcount">
      {count} dipilih
      <button type="button" title="Batalkan pilihan" onClick={onClear}>
        <Icon name="block" size={12} />
      </button>
    </span>
  );
}
