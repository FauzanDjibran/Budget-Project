"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reportHref } from "@/lib/siba/reports";
import { INVALID_RANGE_HINT, PeriodRow, invalidRange } from "./period-row";
import { useReportRun } from "./report-run";

/**
 * The Trial Balance's filter: the Company, whether silent accounts are listed,
 * and a date range.
 *
 * No account picker. A trial balance is a check that the whole book balances,
 * so every account is in it by definition; the only choice is whether an
 * account with nothing on it takes a row. The range is free rather than a
 * fiscal period, because this is a working check read against the General
 * Ledger it drills into, not a statement.
 */
export function TrialBalanceParams({
  slug,
  companyId,
  lead,
  from,
  to,
  includeAll,
}: {
  slug: string;
  companyId: number;
  /** The Company picker, first on the first row. */
  lead?: React.ReactNode;
  from: string;
  to: string;
  includeAll: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [all, setAll] = useState(includeAll);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const invalid = invalidRange(start, end);

  useReportRun(
    () => {
      if (invalid) return;
      startTransition(() => {
        router.push(
          reportHref(slug, { company: companyId, all: all ? 1 : null, from: start, to: end })
        );
      });
    },
    { blocked: invalid, hint: INVALID_RANGE_HINT, pending }
  );

  return (
    <>
      <div className="rrow">
        {lead}
        <label className="chk sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          <span>
            <span className="ct">Tampilkan account tanpa saldo</span>
          </span>
        </label>
      </div>

      <PeriodRow start={start} end={end} onStart={setStart} onEnd={setEnd} />
    </>
  );
}
