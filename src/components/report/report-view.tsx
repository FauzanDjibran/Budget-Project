import { Icon } from "@/components/icon";
import { formatTimestamp } from "@/lib/format";
import { moduleByKey } from "@/lib/siba/nav";
import type { ReportDef } from "@/lib/siba/reports";
import { ReportRunButton, ReportRunProvider } from "./report-run";

/**
 * The chrome every Report View wears.
 *
 * A Report View is a screen whose job is to *show* a report, and the convention
 * it follows is recorded in CLAUDE.md §12. Three things belong to every one of
 * them, and they live here so no report has to remember them:
 *
 *   1. the page header — module, report name;
 *   2. the **filter**, inside that header. The header is sticky, so the
 *      criteria travel with the page and are on screen wherever the reader has
 *      scrolled to. That is what a restatement underneath the bar used to buy,
 *      at the cost of a slab of vertical space on every run — so the `.critbar`
 *      is gone and the filter itself is the statement of what was run;
 *   3. a **one-sentence** footnote and the run timestamp. One sentence because
 *      each of these had grown to four or five, restating rules the screen
 *      already obeys, so the one clause that changed how a column should be
 *      read was buried in a paragraph nobody finishes.
 *
 * The body is passed in, because report bodies genuinely differ — a ledger is
 * rows over time, a balance is a matrix over subjects. Only what is common is
 * shared; nothing here tries to be a generic report engine.
 *
 * The header carries no `.ph-sub`: the description belongs to the menu entry
 * that led here, and repeating it on a sticky header costs the report a line of
 * viewport on every scroll. What a reader needs in order to *read* the figures
 * is in the footnote, at the foot, where it is read once.
 */
export function ReportView({
  report,
  filter,
  runAt,
  children,
  footnote,
  title,
}: {
  report: ReportDef;
  /** The filter bar — a client component that pushes to the URL. */
  filter: React.ReactNode;
  /** When the figures were read, in ISO. */
  runAt: string;
  children: React.ReactNode;
  footnote?: React.ReactNode;
  /**
   * A statement's own title, at the top of its card. It states the run time
   * itself, so the stamp at the foot is left off rather than said twice.
   */
  title?: React.ReactNode;
}) {
  return (
    <>
      <ReportRunProvider>
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
            {/* Tampilkan is the primary and rightmost, like Simpan on a form;
                export actions, when they are built, go to its left. */}
            <div className="ph-act">
              <ReportRunButton />
            </div>
          </div>
          {filter && <div className="rfil">{filter}</div>}
        </div>
      </ReportRunProvider>

      <div className="card">
        <div className="card-b">
          {title}
          {children}
        </div>
      </div>

      {footnote && <p className="foot-note">{footnote}</p>}
      {!title && <p className="rstamp">Dibuat {formatTimestamp(runAt)}</p>}
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
    <div className="empty sm">
      <div className="ic">
        <Icon name={icon} size={20} />
      </div>
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}
