"use client";

import { Icon } from "@/components/icon";
import { formatTimestamp } from "@/lib/format";
import { auditEventLabel } from "@/lib/siba/audit-events";

/**
 * A record's own history, at the foot of its form.
 *
 * One component for every form that has one — registry entities, Budget, Cash
 * Bank Transaction, Funding Request, User and Role — because a repeated control
 * is a component (CLAUDE.md §12) and an audit trail that reads differently on
 * six screens is worse than none: a reader who learns to read a Budget's trace
 * should be able to read a Partner's without relearning it.
 *
 * **Newest first.** A history is read backwards — the entry somebody opened the
 * panel for is the most recent one, and putting the oldest at the top would push
 * it below the fold on any record with a long life. Older context is what
 * scrolling down is for.
 *
 * It states only what `audit_log` actually knows: that something happened, which
 * step it was, when, and by whom. It does **not** claim to know what changed,
 * because the table stores no snapshot (§17), and a panel that implied otherwise
 * would be worse than one that says less.
 */

export type HistoryRow = {
  id: number;
  /** ISO — `Date` does not survive the server→client boundary. */
  at: string;
  action: string;
  event: string | null;
  by: string | null;
};

export function RecordHistory({
  entityKey,
  entries,
  total,
}: {
  /** Which vocabulary the events are read in — `bud_budget`, `m_partner`. */
  entityKey: string;
  entries: HistoryRow[];
  /** Rows in the log, which exceeds `entries.length` once the cap bites. */
  total: number;
}) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="hist" size={15} />
        </span>
        <div className="ct">
          <h3>Riwayat</h3>
          <p>Jejak perubahan dan lifecycle pada record ini</p>
        </div>
      </div>

      {entries.length ? (
        <div className="alog">
          {entries.map((row) => {
            const meta = auditEventLabel(entityKey, row.action, row.event);
            return (
              <div className="ae" key={row.id}>
                <span className={`aav ${TONE_CLASS[meta.tone]}`}>
                  <Icon name={meta.icon} size={13} />
                </span>
                <div className="ab">
                  <div className="aact">
                    <span className="aent">{meta.label}</span>
                    <span className="atime">{formatTimestamp(row.at)}</span>
                  </div>
                  <div className="amail">
                    {meta.systemDriven ? (
                      // Nobody decided this — it followed from something else
                      // being posted. Printing the actor plainly would read as
                      // a person having taken the step.
                      <>
                        otomatis
                        {row.by ? (
                          <span className="asys"> · dipicu oleh {row.by}</span>
                        ) : null}
                      </>
                    ) : (
                      row.by ?? "—"
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {total > entries.length && (
            <div className="amore">
              Menampilkan {entries.length} dari {total} aktivitas terakhir.
            </div>
          )}
        </div>
      ) : (
        <div className="empty sm">
          <div className="ic">
            <Icon name="hist" size={20} />
          </div>
          <h4>Belum ada aktivitas</h4>
          <p>Perubahan dan proses pada record ini akan tercatat di sini.</p>
        </div>
      )}
    </div>
  );
}

/**
 * A tone becomes a tint on the marker.
 *
 * `neutral` deliberately maps to nothing: most entries are ordinary edits, and
 * tinting all of them would leave the approval and the cancellation with no way
 * to stand out — which is the whole reason the trace is coloured at all.
 */
const TONE_CLASS: Record<string, string> = {
  danger: "t-bad",
  primary: "t-ok",
  neutral: "",
};
