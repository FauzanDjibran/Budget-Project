"use client";

import { Icon } from "@/components/icon";
import { DateInput } from "@/components/ui/date-input";

/**
 * The date-range row of a report filter — *Periode · dari · s/d · sampai* —
 * with the one refusal a range has. Every filter on a free range draws it
 * through here, so the range reads and refuses the same on every report.
 */
export function PeriodRow({
  start,
  end,
  onStart,
  onEnd,
}: {
  start: string;
  end: string;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
}) {
  const invalid = invalidRange(start, end);
  return (
    <div className="rrow">
      <span className="rl">Periode</span>
      <div className="rf date">
        <DateInput value={start} invalid={invalid} onChange={onStart} ariaLabel="Periode dari" />
      </div>
      <span className="rl">s/d</span>
      <div className="rf date">
        <DateInput value={end} invalid={invalid} onChange={onEnd} ariaLabel="Periode sampai" />
      </div>
      {invalid && (
        <span className="err">
          <Icon name="warn" size={11} />
          Tanggal akhir lebih awal dari tanggal mulai.
        </span>
      )}
    </div>
  );
}

export function invalidRange(start: string, end: string): boolean {
  return Boolean(start && end && start > end);
}

export const INVALID_RANGE_HINT = "Tanggal akhir tidak boleh lebih awal dari tanggal mulai.";
