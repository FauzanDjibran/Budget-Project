"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { DateInput } from "@/components/ui/date-input";
import type { RefOption } from "@/lib/siba/records";
import { reportHref } from "@/lib/siba/reports";
import { MultiSelect } from "@/components/ui/multi-select";
import { useReportRun } from "./report-run";

/**
 * The filter for every report whose subject is a **set**: several accounts for
 * the `account-period` reports, several Partners for the `subledger-period`
 * ones, plus an inclusive date range.
 *
 * Several, because reading a ledger nearly always means reading a pair — the
 * cash account against whatever it moved against, or two Partners settling with
 * each other — and making that two page loads is what makes checking the books
 * tedious. The chosen subjects go into the URL as `accounts=3,17,42`, so a run
 * of four is still one link.
 *
 * One component rather than one per subject: the two differ in their labels and
 * in the query parameter they write, which is what props are for. A second copy
 * would be the drift `tests/design-system.test.ts` exists to stop.
 *
 * It renders into the sticky page header (`.rfil`), so it is both the control
 * and the statement of what the figures below cover. That is why the controls
 * are compact and why the chosen subjects are chips on a second row rather than
 * a wider picker: the header's height is the report's lost viewport.
 *
 * Two rows, in the order they are filled in — the Company (and, on Buku
 * Subjek, the book) with the subjects, then the period — with *Tampilkan* in
 * the header's action slot, top right, like Simpan on a form.
 */
export function SubjectParams({
  slug,
  subjects,
  selectedIds,
  from,
  to,
  subjectRequired,
  label,
  param,
  addPlaceholder,
  allPlaceholder,
  missingHint,
  companyId,
  extraParams,
  lead,
}: {
  slug: string;
  subjects: RefOption[];
  selectedIds: number[];
  from: string;
  to: string;
  subjectRequired: boolean;
  /** What one subject is called, above the picker. */
  label: string;
  /** The query parameter the ids are written to. */
  param: "accounts" | "partners";
  addPlaceholder: string;
  /** Copy for "no subject chosen", where the report allows it. */
  allPlaceholder: string;
  /** Why the button is disabled while nothing is chosen. */
  missingHint: string;
  /** Carried through the URL so switching Company does not lose the run. */
  companyId?: number | null;
  /**
   * Parameters this report needs carried through that are not the subject or
   * the period — the subject book on Buku Subjek. Without them, pressing
   * *Tampilkan* would rebuild the URL without the book and quietly send the
   * reader back to the first one.
   */
  extraParams?: Record<string, string | number | null | undefined>;
  /** What comes before the subject on the first row — the Company, the book. */
  lead?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [selected, setSelected] = useState<number[]>(selectedIds);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);

  const invalidRange = Boolean(start && end && start > end);
  const missingSubject = subjectRequired && selected.length === 0;

  useReportRun(
    () => {
      if (invalidRange || missingSubject) return;
      startTransition(() => {
        router.push(
          reportHref(slug, {
            company: companyId ?? null,
            ...extraParams,
            [param]: selected.join(","),
            from: start,
            to: end,
          })
        );
      });
    },
    {
      blocked: invalidRange || missingSubject,
      hint: invalidRange
        ? "Tanggal akhir tidak boleh lebih awal dari tanggal mulai."
        : missingHint,
      pending,
    }
  );

  return (
    <>
      <div className="rrow">
        {lead}
        <span className="rl">{label}</span>
        <div className="rf wide">
          <MultiSelect
            value={selected}
            options={subjects}
            placeholder={addPlaceholder}
            emptyPlaceholder={subjectRequired ? addPlaceholder : allPlaceholder}
            removeTitle="Keluarkan dari laporan"
            onChange={setSelected}
          />
        </div>
      </div>

      <div className="rrow">
        <span className="rl">Periode</span>
        <div className="rf date">
          <DateInput value={start} invalid={invalidRange} onChange={setStart} />
        </div>
        <span className="rl">s/d</span>
        <div className="rf date">
          <DateInput value={end} invalid={invalidRange} onChange={setEnd} />
        </div>
        {invalidRange && (
          <span className="err">
            <Icon name="warn" size={11} />
            Tanggal akhir lebih awal dari tanggal mulai.
          </span>
        )}
      </div>
    </>
  );
}
