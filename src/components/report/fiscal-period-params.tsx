"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { reportHref } from "@/lib/siba/reports";
import { STATEMENT_MODES, type StatementMode } from "@/lib/siba/statement-layout";
import { useReportRun } from "./report-run";

export type FiscalYearChoice = {
  id: number;
  name: string;
  periods: { id: number; name: string }[];
};

type Pick = { yearId: number | null; periodId: number | null };

/**
 * The filter for the `fiscal-period` parameter set, in the order it is filled
 * in:
 *
 *   Company · Tipe Laporan
 *   Tahun Buku · Periode · ☐ Bandingkan
 *   Pembanding · Periode                      (only once Bandingkan is ticked)
 *
 * A statement is always read from a period's viewpoint, so there is no date
 * range — the period *is* the range, and the Tipe Laporan says whether it
 * starts on the period's first day or the year's. The Neraca takes no Tipe: it
 * is a position at the period's end.
 *
 * Periode waits for its Tahun Buku (`Pilih Tahun Buku dulu…`); changing the
 * year clears the period, because a period belongs to one year. Pembanding is
 * hidden rather than waiting while Bandingkan is off — it is an option the
 * reader takes, not a prerequisite of anything. *Tampilkan* is in the header's
 * action slot, top right, like Simpan on a form.
 */
export function FiscalPeriodParams({
  slug,
  companyId,
  lead,
  years,
  main,
  compare,
  mode,
  showMode,
}: {
  slug: string;
  companyId: number;
  /** The Company picker, first on the first row. */
  lead?: React.ReactNode;
  years: FiscalYearChoice[];
  main: Pick;
  compare: Pick | null;
  mode: StatementMode;
  /** The Neraca is a position at one date, so it takes no Tipe Laporan. */
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

  useReportRun(
    () => {
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
    },
    {
      blocked,
      hint: comparing && incomplete(second)
        ? "Pilih tahun buku dan periode pembanding terlebih dahulu."
        : "Pilih tahun buku dan periode terlebih dahulu.",
      pending,
    }
  );

  return (
    <>
      {(lead || showMode) && (
        <div className="rrow">
          {lead}
          {showMode && (
            <>
              <span className="rl">Tipe Laporan</span>
              <div className="rf">
                <Select
                  variant="toolbar"
                  value={currentMode}
                  onChange={(v) => setMode(v as StatementMode)}
                  options={STATEMENT_MODES}
                  ariaLabel="Tipe Laporan"
                  title="Periode ini: hanya periode terpilih. s.d. Periode ini: dari awal tahun buku."
                />
              </div>
            </>
          )}
        </div>
      )}

      <div className="rrow">
        <PeriodPick years={years} value={first} onChange={setFirst} label="Tahun Buku" />
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
      </div>

      {comparing && (
        <div className="rrow">
          <PeriodPick years={years} value={second} onChange={setSecond} label="Pembanding" />
        </div>
      )}
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
