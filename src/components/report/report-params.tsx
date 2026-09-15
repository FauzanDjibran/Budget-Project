"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import type { RefOption } from "@/lib/siba/records";
import { reportHref } from "@/lib/siba/reports";

/**
 * The parameter bar for the `cash-bank-period` parameter set: a Cash & Bank
 * subject plus an inclusive date range.
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
 * machines is a data hazard (§12).
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
}: {
  slug: string;
  resources: RefOption[];
  cashBankId: number | null;
  from: string;
  to: string;
  subjectRequired: boolean;
  subjectLabel: string;
  /** Copy for "no subject chosen", where the report allows it. */
  allLabel?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [subject, setSubject] = useState<number | null>(cashBankId);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);

  const invalidRange = Boolean(start && end && start > end);
  const missingSubject = subjectRequired && !subject;

  const run = () => {
    if (invalidRange || missingSubject) return;
    startTransition(() => {
      router.push(
        reportHref(slug, { cashBank: subject, from: start, to: end })
      );
    });
  };

  return (
    <>
      <span className="count" style={{ marginRight: 2 }}>
        {subjectLabel}
      </span>

      <div style={{ minWidth: 250, flex: "0 1 300px" }}>
        <Combobox
          value={subject}
          options={resources}
          placeholder={allLabel ?? "Pilih Cash & Bank…"}
          onChange={setSubject}
        />
      </div>

      <span className="count">Periode</span>

      <div style={{ width: 138 }}>
        <DateInput value={start} invalid={invalidRange} onChange={setStart} />
      </div>
      <span className="count">s/d</span>
      <div style={{ width: 138 }}>
        <DateInput value={end} invalid={invalidRange} onChange={setEnd} />
      </div>

      <button
        className="btn primary sm"
        onClick={run}
        disabled={pending || invalidRange || missingSubject}
        title={
          invalidRange
            ? "Tanggal akhir tidak boleh lebih awal dari tanggal mulai."
            : missingSubject
              ? "Pilih Cash & Bank terlebih dahulu."
              : undefined
        }
      >
        <Icon name="srch" size={14} /> Tampilkan
      </button>

      {invalidRange && (
        <span className="err" style={{ marginLeft: 2 }}>
          <Icon name="warn" size={11} />
          Tanggal akhir lebih awal dari tanggal mulai.
        </span>
      )}

      <div className="tspace" />
    </>
  );
}
