import { Icon } from "@/components/icon";
import { formatTimestamp } from "@/lib/format";
import { moduleByKey } from "@/lib/siba/nav";
import type { ReportDef } from "@/lib/siba/reports";

/**
 * The chrome every Report View wears.
 *
 * A Report View is a screen whose job is to *show* a report, and the convention
 * it follows is recorded in CLAUDE.md §12. Four things belong to every one of
 * them, and they live here so no report has to remember them:
 *
 *   1. the page header — module, report name, what the report answers;
 *   2. the **parameter bar**, where the user says what to run it for;
 *   3. the **parameter restatement** — a `.critbar` repeating the subject, the
 *      period and when the report was produced. This is what separates a report
 *      from a list: a page of figures with no statement of what it covers
 *      cannot be checked by anybody who did not run it;
 *   4. a footnote explaining how to read the numbers.
 *
 * The body is passed in, because report bodies genuinely differ — a ledger is
 * rows over time, a balance is a matrix over subjects. Only what is common is
 * shared; nothing here tries to be a generic report engine.
 *
 * Every class used is one the design system already has. A Report View
 * introduces no new styling.
 */
export function ReportView({
  report,
  params,
  criteria,
  runAt,
  children,
  footnote,
}: {
  report: ReportDef;
  /** The parameter bar — a client component that pushes to the URL. */
  params: React.ReactNode;
  /** What this run covers, restated on the output. */
  criteria: { label: string; value: string; hint?: string }[];
  /** When the figures were read, in ISO. */
  runAt: string;
  children: React.ReactNode;
  footnote?: React.ReactNode;
}) {
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>{moduleByKey(report.module)?.name ?? report.module}</span>
          <span>/</span>
          <span>Laporan</span>
          <span>/</span>
          <span className="cur">{report.name}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={report.icon} size={16} />
            </span>
            {report.name}
            <span className="bdg t-slate">Laporan</span>
          </h1>
          {/* Export actions land here when they are built — the slot exists so
              adding one later changes no layout. */}
          <div className="ph-act" />
        </div>
        <p className="ph-sub">{report.desc}</p>
      </div>

      <div className="card">
        <div className="toolbar">{params}</div>

        <div className="card-b">
          <div className="critbar">
            {criteria.map((c) => (
              <span className="cr" key={c.label}>
                <i>{c.label}</i>
                {c.value}
                {c.hint && <em>{c.hint}</em>}
              </span>
            ))}
            <span className="cr">
              <i>Dibuat</i>
              {formatTimestamp(runAt)}
            </span>
          </div>

          {children}
        </div>
      </div>

      {footnote && <p className="foot-note">{footnote}</p>}
    </>
  );
}

/**
 * What a Report View shows before it has been told what to report on.
 *
 * Deliberately distinct from "there is nothing to show": a report with no
 * subject has not run, while a period with no movement is a real answer and
 * still shows its opening and closing figures.
 */
export function ReportNeedsSubject({
  icon,
  title,
  body,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  title: string;
  body: string;
}) {
  return (
    <div className="empty" style={{ padding: "34px 20px" }}>
      <div className="ic">
        <Icon name={icon} size={20} />
      </div>
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}
