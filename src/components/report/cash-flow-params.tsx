"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { reportHref } from "@/lib/siba/reports";
import type { FiscalYearChoice } from "./fiscal-period-params";
import { useReportRun } from "./report-run";

/**
 * The filter of the Laporan Arus Kas, in the order it is filled in:
 *
 *   Company · Mata Uang
 *   Tahun Buku · Periode awal · Periode akhir
 *
 * One currency per run, because money in two currencies is never added; each
 * period from the first to the last is a column. Both periods wait for their
 * year, and changing the year clears them.
 */
export function CashFlowParams({
  slug,
  companyId,
  lead,
  currencies,
  years,
  currencyId,
  yearId,
  fromId,
  toId,
}: {
  slug: string;
  companyId: number;
  lead?: React.ReactNode;
  currencies: { id: number; label: string; name: string }[];
  years: FiscalYearChoice[];
  currencyId: number | null;
  yearId: number | null;
  fromId: number | null;
  toId: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [currency, setCurrency] = useState(currencyId);
  const [year, setYear] = useState(yearId);
  const [from, setFrom] = useState(fromId);
  const [to, setTo] = useState(toId);

  const periods = years.find((y) => y.id === year)?.periods ?? [];
  const order = (id: number | null) => periods.findIndex((p) => p.id === id);
  const blocked = !currency || !year || !from || !to || order(from) > order(to);

  useReportRun(
    () => {
      if (blocked) return;
      startTransition(() => {
        router.push(reportHref(slug, { company: companyId, currency, year, from, to }));
      });
    },
    {
      blocked,
      hint:
        from && to && order(from) > order(to)
          ? "Periode awal harus sebelum periode akhir."
          : "Pilih mata uang, tahun buku, dan periode terlebih dahulu.",
      pending,
    }
  );

  const periodOptions = periods.map((p) => ({ value: String(p.id), label: p.name }));
  const waiting = year ? null : "Pilih Tahun Buku dulu…";

  return (
    <>
      <div className="rrow">
        {lead}
        <span className="rl">Mata Uang</span>
        <div className="rf">
          <Select
            variant="toolbar"
            value={currency ? String(currency) : ""}
            onChange={(v) => setCurrency(Number(v))}
            options={currencies.map((c) => ({ value: String(c.id), label: c.label, hint: c.name }))}
            placeholder="Pilih Mata Uang…"
            ariaLabel="Mata Uang"
          />
        </div>
      </div>
      <div className="rrow">
        <span className="rl">Tahun Buku</span>
        <div className="rf">
          <Select
            variant="toolbar"
            value={year ? String(year) : ""}
            onChange={(v) => {
              setYear(Number(v));
              setFrom(null);
              setTo(null);
            }}
            options={years.map((y) => ({ value: String(y.id), label: y.name }))}
            placeholder="Pilih Tahun Buku…"
            ariaLabel="Tahun Buku"
          />
        </div>
        <span className="rl">Periode</span>
        <div className="rf">
          <Select
            variant="toolbar"
            value={from ? String(from) : ""}
            onChange={(v) => setFrom(Number(v))}
            options={periodOptions}
            placeholder="Pilih Periode awal…"
            waitingFor={waiting}
            searchable={false}
            ariaLabel="Periode awal"
          />
        </div>
        <span className="rl">s.d.</span>
        <div className="rf">
          <Select
            variant="toolbar"
            value={to ? String(to) : ""}
            onChange={(v) => setTo(Number(v))}
            options={periodOptions}
            placeholder="Pilih Periode akhir…"
            waitingFor={waiting}
            searchable={false}
            ariaLabel="Periode akhir"
          />
        </div>
      </div>
    </>
  );
}
