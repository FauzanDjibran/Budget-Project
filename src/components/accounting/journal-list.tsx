"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DocumentHeader } from "@/components/ui/document-header";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { CompanyFilter, NoCompanyAccess } from "@/components/master/company-filter";
import { transitionJournal } from "@/app/actions/journal";
import { formatDate } from "@/lib/format";
import type { Company } from "@/lib/siba/company-access";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import { menuButtonClass } from "@/lib/siba/header-actions";
import type { JournalRow } from "@/lib/siba/journal";
import {
  JOURNAL_TRANSITIONS,
  availableJournalActions,
  journalIsEditable,
  type JournalAbilities,
  type JournalAction,
  type JournalStatus,
} from "@/lib/siba/journal-workflow";

const STATUSES: JournalStatus[] = ["Draft", "Posted", "Cancelled"];

/**
 * The Journal register — every journal, however it came to exist.
 *
 * Most are written by a document being posted and are `Posted` the moment they
 * exist; they are never edited, deleted or reversed. A **manual** journal is
 * the other kind: typed here, saved as a Draft, and posted through the same
 * engine. Drafts sort to the top, because they are the only rows anybody still
 * has something to do about.
 *
 * Laid out like every other document register: a `No` column, the `Status:`
 * and `Sumber:` facets in the toolbar, the count on the right, and the row's
 * actions in fixed icon columns. One Company at a time, named by the picker —
 * each Company keeps its own books, so a register holding both would read as
 * duplicated rows.
 *
 * Each row states both sides. They are always equal on a posted journal —
 * `postJournal` refuses one whose debits and credits differ — so a row where
 * they are not says so under the figure rather than quietly showing two
 * numbers. A draft may differ; it is not in the books yet.
 */
export function JournalList({
  journals,
  companies,
  companyId,
  can,
}: {
  journals: JournalRow[];
  /** The Companies this reader may choose between. */
  companies: Company[];
  /** The one being shown, or null when the reader may see none. */
  companyId: number | null;
  can: JournalAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [origin, setOrigin] = useState("");
  const [menuFor, setMenuFor] = useState<{ row: JournalRow; x: number; y: number } | null>(
    null
  );
  const [confirm, setConfirm] = useState<{ row: JournalRow; action: JournalAction } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      journals.filter(
        (j) =>
          (!status || j.status === status) &&
          (!origin || (origin === "manual") === j.isManual) &&
          (!q ||
            j.journalNo.toLowerCase().includes(q) ||
            j.description.toLowerCase().includes(q))
      ),
    [journals, q, status, origin]
  );

  const activeFilters = [status, origin].filter(Boolean).length;
  const clearAll = () => {
    setQuery("");
    setStatus("");
    setOrigin("");
  };

  const cents = (n: number) => Math.round(n * 100);
  const paging = usePaging(rows, `${q}|${status}|${origin}`);

  const run = async (row: JournalRow, action: JournalAction) => {
    setBusy(true);
    const result = await transitionJournal(row.id, action);
    setBusy(false);
    setConfirm(null);
    if (!result.ok) {
      toast("Tidak dapat diproses", result.errors._form, "err");
      return;
    }
    toast(result.message, row.journalNo, "ok");
    router.refresh();
  };

  return (
    <>
      <DocumentHeader
        module="Accounting"
        icon="book"
        title="Journal"
        sub="Journal dari posting dokumen bersifat final; journal manual disimpan sebagai Draft dan masuk buku besar saat diposting."
      >
        {can.create && (
          <Link className="btn primary" href="/accounting/journal/new">
            <Icon name="plus" size={15} /> Journal Manual
          </Link>
        )}
      </DocumentHeader>

      {/* No Company open to this reader means nothing to filter or search, so
          the card carries the refusal alone rather than an empty table that
          would read as "belum ada journal". */}
      {companyId == null ? (
        <div className="card">
          <NoCompanyAccess what="Journal" />
        </div>
      ) : (
        <div className="card">
          <div className="toolbar">
            <CompanyFilter options={companies} selectedId={companyId} />
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Cari nomor journal atau keterangan…"
            />
            <Select
              variant="toolbar"
              value={status}
              set={Boolean(status)}
              ariaLabel="Filter status"
              options={[
                { value: "", label: "Status: semua" },
                ...STATUSES.map((s) => ({ value: s, label: STATUS_TEXT[s] ?? s })),
              ]}
              onChange={setStatus}
            />
            <Select
              variant="toolbar"
              value={origin}
              set={Boolean(origin)}
              ariaLabel="Filter sumber"
              options={[
                { value: "", label: "Sumber: semua" },
                { value: "manual", label: "Manual" },
                { value: "auto", label: "Otomatis" },
              ]}
              onChange={setOrigin}
            />
            {activeFilters > 0 && (
              <button className="btn sm ghost" onClick={clearAll}>
                Bersihkan filter ({activeFilters})
              </button>
            )}
            <div className="tspace" />
            <span className="count">
              <b>{rows.length}</b> dari {journals.length} journal
            </span>
          </div>

          {rows.length ? (
            <>
              <div className="tw">
                <table className="grid">
                  <thead>
                    <tr>
                      <th style={{ width: 38 }}>No</th>
                      <th style={{ width: 110 }}>Nomor</th>
                      <th style={{ width: 104 }}>Tanggal</th>
                      <th>Keterangan</th>
                      <th style={{ width: 150 }}>Sumber</th>
                      <th className="num" style={{ width: 56 }}>
                        Baris
                      </th>
                      <th className="num" style={{ width: 150 }}>
                        Debit
                      </th>
                      <th className="num" style={{ width: 150 }}>
                        Kredit
                      </th>
                      <th style={{ width: 104 }}>Status</th>
                      <th style={{ width: 88 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {paging.pageRows.map((j, i) => {
                      const href = `/accounting/journal/${j.id}`;
                      const actions = j.isManual
                        ? availableJournalActions(j.status as JournalStatus, can)
                        : [];
                      const editable =
                        j.isManual && can.edit && journalIsEditable(j.status as JournalStatus);
                      const broken = cents(j.debit) !== cents(j.credit) && j.status === "Posted";
                      return (
                        <tr key={j.id} onClick={() => router.push(href)}>
                          <td className="no">{paging.start + i + 1}</td>
                          <td>
                            <Link href={href}>
                              <span className="lab">{j.journalNo}</span>
                            </Link>
                          </td>
                          <td>
                            {j.postingDate ? (
                              formatDate(j.postingDate)
                            ) : (
                              <span className="dash">—</span>
                            )}
                          </td>
                          <td className="pri">{j.description}</td>
                          {/* A manual journal has no source document — it is the
                              source. Saying so in the same column keeps the two
                              kinds readable without a column of its own. */}
                          <td className="mut">
                            {j.sourceDocLabel ?? (j.isManual ? "Manual" : "—")}
                          </td>
                          <td className="num">{j.lineCount}</td>
                          <td className="num">
                            <Amount value={j.debit} ledger />
                          </td>
                          <td className="num">
                            <Amount value={j.credit} ledger />
                            {broken && <span className="overtag">tidak seimbang</span>}
                          </td>
                          <td>
                            <span className={`bdg ${STATUS_CLASS[j.status] ?? "s-mute"}`}>
                              {STATUS_TEXT[j.status] ?? j.status}
                            </span>
                          </td>
                          <td className="acts">
                            <span className="ract">
                              <Link
                                className="iact"
                                href={href}
                                title="Lihat detail"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Icon name="eye" size={15} />
                              </Link>
                              {editable ? (
                                <Link
                                  className="iact"
                                  href={`${href}/edit`}
                                  title="Ubah"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Icon name="pen" size={15} />
                                </Link>
                              ) : (
                                <span className="sp" />
                              )}
                              {actions.length > 0 ? (
                                <button
                                  className="iact kb"
                                  title="Aksi lain"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const r = (
                                      e.currentTarget as HTMLElement
                                    ).getBoundingClientRect();
                                    setMenuFor({ row: j, x: r.right - 200, y: r.bottom + 5 });
                                  }}
                                >
                                  <Icon name="more" size={15} />
                                </button>
                              ) : (
                                <span className="sp" />
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager
                page={paging.page}
                pages={paging.pages}
                total={paging.total}
                perPage={paging.perPage}
                onPage={paging.setPage}
                onPerPage={paging.setPerPage}
              />
            </>
          ) : (
            <div className="empty">
              <div className="ic">
                <Icon name={journals.length ? "srch" : "book"} size={20} />
              </div>
              <h4>{journals.length ? "Tidak ada journal yang cocok" : "Belum ada journal"}</h4>
              <p>
                {journals.length
                  ? "Ubah kata kunci atau bersihkan filter yang sedang aktif."
                  : "Journal terbentuk otomatis saat dokumen Finance diposting, atau dibuat sendiri sebagai Journal Manual."}
              </p>
              <div className="cta">
                {journals.length ? (
                  <button className="btn" onClick={clearAll}>
                    Bersihkan filter
                  </button>
                ) : (
                  can.create && (
                    <Link className="btn primary" href="/accounting/journal/new">
                      <Icon name="plus" size={15} /> Journal Manual
                    </Link>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {menuFor && (
        <RowMenu
          row={menuFor.row}
          x={menuFor.x}
          y={menuFor.y}
          can={can}
          onPick={(action) => {
            setMenuFor(null);
            setConfirm({ row: menuFor.row, action });
          }}
          onClose={() => setMenuFor(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          open
          icon={JOURNAL_TRANSITIONS[confirm.action].icon}
          tone={JOURNAL_TRANSITIONS[confirm.action].tone === "danger" ? "danger" : "ok"}
          title={JOURNAL_TRANSITIONS[confirm.action].title}
          subject={confirm.row.journalNo}
          body={JOURNAL_TRANSITIONS[confirm.action].body}
          confirmLabel={JOURNAL_TRANSITIONS[confirm.action].confirmLabel}
          confirmTone={
            JOURNAL_TRANSITIONS[confirm.action].tone === "danger" ? "solid-danger" : "primary"
          }
          busy={busy}
          onConfirm={() => run(confirm.row, confirm.action)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

/** The row action menu — a fixed popup anchored to the trigger. */
function RowMenu({
  row,
  x,
  y,
  can,
  onPick,
  onClose,
}: {
  row: JournalRow;
  x: number;
  y: number;
  can: JournalAbilities;
  onPick: (action: JournalAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="menu" ref={ref} style={{ left: Math.max(8, x), top: y }}>
      <div className="hd">
        <b>{row.journalNo}</b>
        <span>{STATUS_TEXT[row.status] ?? row.status}</span>
      </div>
      <div className="dv" />
      {availableJournalActions(row.status as JournalStatus, can).map((a) => {
        const t = JOURNAL_TRANSITIONS[a];
        return (
          <button key={a} className={menuButtonClass(t.tone)} onClick={() => onPick(a)}>
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}
