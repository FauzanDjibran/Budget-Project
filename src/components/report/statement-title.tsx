import { Fragment } from "react";
import { formatDate, formatTimestamp } from "@/lib/format";
import type { StatementColumn } from "@/lib/siba/statements";

/**
 * What a statement is, stated on the statement itself.
 *
 * A figure that leaves the screen — a screenshot in a chat, a page on a desk —
 * no longer has the filter beside it, so the output names itself: the report,
 * the Company by its label, the mode, each column's dates, and when it was
 * produced. Two compact lines at the top of the card and nothing more, because
 * the sticky header above it (filter included) keeps the space it has.
 *
 * It replaces the run stamp at the foot for these reports rather than adding a
 * second one: the time the figures were read is stated once, here.
 */
export function StatementTitle({
  name,
  companyLabel,
  mode,
  columns,
  runAt,
  position,
}: {
  name: string;
  companyLabel: string;
  /** "s.d. Periode ini", "Periode ini" — or, for a Neraca, "Posisi". */
  mode: string;
  columns: StatementColumn[];
  runAt: string;
  /** A Neraca: each column is a position per its last day, not a range. */
  position?: boolean;
}) {
  return (
    <div className="rtitle">
      <div className="rt1">
        <b>{name}</b>
        <span>{companyLabel}</span>
        <span>{mode}</span>
      </div>
      <div className="rt2">
        {columns.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="sep">dibanding</span>}
            <span>
              {c.periodName} ·{" "}
              {position
                ? `per ${formatDate(c.range.to)}`
                : `${formatDate(c.range.from)} – ${formatDate(c.range.to)}`}
            </span>
          </Fragment>
        ))}
        <span className="when">Dibuat {formatTimestamp(runAt)}</span>
      </div>
    </div>
  );
}
