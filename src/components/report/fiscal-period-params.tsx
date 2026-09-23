"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Select } from "@/components/ui/select";
import { reportHref } from "@/lib/siba/reports";
import { STATEMENT_MODES, type StatementMode } from "@/lib/siba/statement-layout";

export type FiscalYearChoice = {
  id: number;
  name: string;
  periods: { id: number; name: string }[];
};

type Pick = { yearId: number | null; periodId: number | null };

/**
 * The filter for the `fiscal-period` parameter set: a fiscal year and a period
 * in it, the Periode ini / s.d. Periode ini mode, and optionally a second year
 * and period to compare against.
 *
 * A statement is always read from a period's viewpoint, so there is no date
 * range here — the period *is* the range, and the mode says whether it starts
 * on the period's first day or the year's. The mode is shown as a control of
 * its own, never implied, because the same figure reads very differently as a
 * month and as a year to date.
 *
 * Periode waits for its Tahun Buku (`Pilih Tahun Buku dulu…`), which is the
 * one prerequisite in the bar; changing the year clears the period, because a
 * period belongs to exactly one year. Parameters live in the URL like every
 * Report View, so a run is linkable and back-button-able.
 */
export function FiscalPeriodParams({
  slug,
  companyId,
  years,
  main,
  compare,
  mode,
  showMode,
}: {
  slug: string;
  companyId: number;
  years: FiscalYearChoice[];
  main: Pick;
  compare: Pick | null;
  mode: StatementMode;
  /** The Neraca is a position at one date, so it takes no mode. */
  showMode: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [first, setFirst] = useState<Pick>(main);
  const [comparing, setComparing] = useState(Boolean(compare));
  const [second, setSecond] = useState<Pick>(compare ?? { yearId: null, periodId: null });
  const [currentMode, setMode] = useState<StatementMode>(mode);

  const incomplete = (p: Pick) => !p.yearId || !p.periodId;
  const blocked = incomplete(first) || (comparing && incomplete(second));

  const run = () => {
    if (blocked) return;
    startTransition(() => {
      router.push(
        reportHref(slug, {
          company: companyId,
          year: first.yearId,
          period: first.periodId,
          ...(showMode ? { mode: currentMode } : {}),
          ...(comparing ? { cmpYear: second.yearId, cmpPeriod: second.periodId } : {}),
        })
      );
    });
  };

  return (
    <>
      <PeriodPick years={years} value={first} onChange={setFirst} label="Tahun Buku" />

      {showMode && (
        <>
          <span className="rsep" />
          <Select
            variant="toolbar"
            value={currentMode}
            onChange={(v) => setMode(v as StatementMode)}
            options={STATEMENT_MODES}
            ariaLabel="Rentang"
            title="Periode ini: hanya periode terpilih. s.d. Periode ini: dari awal tahun buku."
          />
        </>
      )}

      <span className="rsep" />
      <label className="chk sm">
        <input
          type="checkbox"
          checked={comparing}
          onChange={(e) => setComparing(e.target.checked)}
        />
        <span>
          <span className="ct">Bandingkan</span>
        </span>
      </label>

      {comparing && (
        <PeriodPick years={years} value={second} onChange={setSecond} label="Pembanding" />
      )}

      <button
        className="btn primary sm"
        onClick={run}
        disabled={pending || blocked}
        title={blocked ? "Pilih tahun buku dan periode terlebih dahulu." : undefined}
      >
        <Icon name="srch" size={13} /> Tampilkan
      </button>
    </>
  );
}

function PeriodPick({
  years,
  value,
  onChange,
  label,
}: {
  years: FiscalYearChoice[];
  value: Pick;
  onChange: (next: Pick) => void;
  label: string;
}) {
  const year = years.find((y) => y.id === value.yearId) ?? null;
  return (
    <>
      <span className="rl">{label}</span>
      <div className="rf">
        <Select
          variant="toolbar"
          value={value.yearId ? String(value.yearId) : ""}
          onChange={(v) => onChange({ yearId: Number(v), periodId: null })}
          options={years.map((y) => ({ value: String(y.id), label: y.name }))}
          placeholder="Pilih Tahun Buku…"
          ariaLabel={label}
        />
      </div>
      <div className="rf">
        <Select
          variant="toolbar"
          value={value.periodId ? String(value.periodId) : ""}
          onChange={(v) => onChange({ yearId: value.yearId, periodId: Number(v) })}
          options={(year?.periods ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
          placeholder="Pilih Periode…"
          waitingFor={year ? null : "Pilih Tahun Buku dulu…"}
          searchable={false}
          ariaLabel={`${label} — Periode`}
        />
      </div>
    </>
  );
}
