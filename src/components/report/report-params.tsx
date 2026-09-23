"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import type { RefOption } from "@/lib/siba/records";
import { reportHref } from "@/lib/siba/reports";
import { useReportRun } from "./report-run";

/**
 * The filter for the `cash-bank-period` parameter set: a Cash & Bank subject
 * plus an inclusive date range.
 *
 * **Parameters live in the URL**, which is the part of the Report View
 * convention that matters most here. Running a report is a navigation, so a run
 * can be linked to a colleague, bookmarked, and stepped through with the back
 * button — and the page stays a Server Component that queries the database
 * directly, with no client-side fetching (CLAUDE.md §3).
 *
 * The controls are the application's own `Combobox` and `DateInput`, never a
 * native `<select>` or `<input type="date">` — those are drawn by the operating
 * system in its own locale, and a report whose dates read differently on two
 * machines is a data hazard (§12). Compact, because this sits in the sticky
 * page header and every pixel it takes is a pixel the report does not get.
 *
 * Two rows, in the order they are filled in — the Company and the resource,
 * then the period — with *Tampilkan* in the header's action slot, top right,
 * like Simpan on a form.
 */
export function ReportParams({
  slug,
  resources,
  cashBankId,
  from,
  to,
  subjectRequired,
  subjectLabel,
  allLabel,
  companyId,
  lead,
  dateless = false,
}: {
  slug: string;
  resources: RefOption[];
  cashBankId: number | null;
  from: string;
  to: string;
  /**
   * A report whose answer is a standing position rather than a period's
   * movement takes no date range, and showing an inert one would invite a
   * reader to set it and wonder why nothing changed.
   */
  dateless?: boolean;
  subjectRequired: boolean;
  subjectLabel: string;
  /** Copy for "no subject chosen", where the report allows it. */
  allLabel?: string;
  /** Carried through the URL so switching Company does not lose the run. */
  companyId?: number | null;
  /** The Company picker, first on the first row. */
  lead?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [subject, setSubject] = useState<number | null>(cashBankId);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);

  const invalidRange = !dateless && Boolean(start && end && start > end);
  const missingSubject = subjectRequired && !subject;

  useReportRun(
    () => {
      if (invalidRange || missingSubject) return;
      startTransition(() => {
        router.push(
          reportHref(slug, {
            company: companyId ?? null,
            cashBank: subject,
            ...(dateless ? {} : { from: start, to: end }),
          })
        );
      });
    },
    {
      blocked: invalidRange || missingSubject,
      hint: invalidRange
        ? "Tanggal akhir tidak boleh lebih awal dari tanggal mulai."
        : "Pilih Cash & Bank terlebih dahulu.",
      pending,
    }
  );

  return (
    <>
      <div className="rrow">
        {lead}
        <span className="rl">{subjectLabel}</span>
        <div className="rf wide">
          <Combobox
            value={subject}
            options={resources}
            placeholder={allLabel ?? "Pilih Cash & Bank…"}
            onChange={setSubject}
          />
        </div>
      </div>

      {!dateless && (
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
      )}
    </>
  );
}
