"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { transitionDncn } from "@/app/actions/dncn";
import { formatDate, formatMoney, formatTotals } from "@/lib/format";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type { DncnRow, DncnSummary } from "@/lib/siba/dncn";
import {
  DNCN_TRANSITIONS,
  DNCN_TYPES,
  availableDncnActions,
  dncnIsEditable,
  type DncnAbilities,
  type DncnAction,
  type DncnType,
} from "@/lib/siba/dncn-workflow";
import { menuButtonClass } from "@/lib/siba/header-actions";

/**
 * The Debit / Credit Note register — both types in one list, told apart by
 * their number series and a type filter.
 *
 * `can` mirrors the caller's permissions so the row menu offers only what they
 * may use. It is presentation: `transitionDncn` re-checks both the permission
 * and whether the transition is legal from the note's current status.
 */
export function DncnList({
  notes,
  summary,
  can,
  initialStatus,
}: {
  notes: DncnRow[];
  summary: DncnSummary;
  can: DncnAbilities;
  initialStatus?: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(initialStatus ?? "");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [menuFor, setMenuFor] = useState<{ row: DncnRow; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<{ row: DncnRow; action: DncnAction } | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    let out = notes.slice();
    if (status) out = out.filter((n) => n.status === status);
    if (type) out = out.filter((n) => n.note_type === type);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((n) =>
        [n.note_no, n.book_name, n.partner_label, n.partner_name, n.reference ?? "", n.note ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return out;
  }, [notes, status, type, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pages);
  const from = (current - 1) * perPage;
  const pageRows = filtered.slice(from, from + perPage);

  const activeFilters = (status ? 1 : 0) + (type ? 1 : 0) + (query ? 1 : 0);
  const clearAll = () => {
    setStatus("");
    setType("");
    setQuery("");
    setPage(1);
  };

  const run = async (row: DncnRow, action: DncnAction) => {
    setBusy(true);
    const result = await transitionDncn(row.id, action);
    setBusy(false);
    setConfirm(null);
    if (result.ok) {
      toast(result.message, row.note_no, "ok");
      router.refresh();
      return;
    }
    toast("Tidak dapat diproses", result.errors._form ?? Object.values(result.errors)[0], "err");
  };

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <span className="cur">Debit / Credit Note</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="pen" size={16} />
            </span>
            Debit / Credit Note
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/finance/debit-credit-note/new">
                <Icon name="plus" size={15} /> Buat Nota
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Penyesuaian nilai posisi Partner pada buku subjek, tanpa perpindahan uang.
        </p>
      </div>

      <div className="kpis bud">
        <button
          className="kpi"
          onClick={() => {
            setStatus("Draft");
            setPage(1);
          }}
          style={{ textAlign: "left", font: "inherit" }}
        >
          <div className="h">
            <span className="i" style={{ background: "var(--warn-bg)", color: "var(--warn)" }}>
              <Icon name="clock" size={14} />
            </span>
            <span className="l">Belum Diposting</span>
          </div>
          <div className="v">{summary.draft}</div>
          <div className="d">belum menyentuh posisi mana pun</div>
        </button>

        <button
          className="kpi wide"
          onClick={() => {
            setStatus("Posted");
            setPage(1);
          }}
          style={{ textAlign: "left", font: "inherit" }}
        >
          <div className="h">
            <span className="i" style={{ background: "var(--info-bg)", color: "var(--info)" }}>
              <Icon name="check" size={14} />
            </span>
            <span className="l">Sudah Diposting</span>
          </div>
          <div className="v">{summary.posted}</div>
          <div className="d">
            {summary.posted
              ? [
                  summary.debitTotals.length && `DN ${formatTotals(summary.debitTotals)}`,
                  summary.creditTotals.length && `CN ${formatTotals(summary.creditTotals)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "belum ada posisi yang disesuaikan"}
          </div>
        </button>

        <button
          className="kpi"
          onClick={() => {
            setStatus("Cancelled");
            setPage(1);
          }}
          style={{ textAlign: "left", font: "inherit" }}
        >
          <div className="h">
            <span className="i" style={{ background: "var(--bad-bg)", color: "var(--bad)" }}>
              <Icon name="block" size={14} />
            </span>
            <span className="l">Dibatalkan</span>
          </div>
          <div className="v">{summary.cancelled}</div>
          <div className="d">tidak pernah diposting</div>
        </button>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField
            value={query}
            placeholder="Cari nomor nota, buku, Partner, atau referensi…"
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
          />

          <Select
            variant="toolbar"
            value={type}
            set={Boolean(type)}
            ariaLabel="Filter jenis nota"
            options={[
              { value: "", label: "Jenis: semua" },
              ...(Object.keys(DNCN_TYPES) as DncnType[]).map((t) => ({
                value: t,
                label: DNCN_TYPES[t].label,
              })),
            ]}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
          />

          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            ariaLabel="Filter status"
            options={[
              { value: "", label: "Status: semua" },
              ...["Draft", "Posted", "Cancelled"].map((s) => ({
                value: s,
                label: STATUS_TEXT[s] ?? s,
              })),
            ]}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          />

          {activeFilters > 0 && (
            <button className="btn sm ghost" onClick={clearAll}>
              Bersihkan filter ({activeFilters})
            </button>
          )}

          <div className="tspace" />
          <span className="count">
            <b>{filtered.length}</b> dari {notes.length} nota
          </span>
        </div>

        {filtered.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 38 }}>No</th>
                    <th style={{ width: 100 }}>Nomor</th>
                    <th style={{ width: 104 }}>Tanggal</th>
                    <th>Partner / Buku</th>
                    <th className="num" style={{ width: 170 }}>
                      Nominal
                    </th>
                    <th style={{ width: 104 }}>Status</th>
                    <th style={{ width: 88 }} />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((n, i) => {
                    const actions = availableDncnActions(n.status, can);
                    const href = `/finance/debit-credit-note/${n.id}`;
                    return (
                      <tr key={n.id} onClick={() => router.push(href)}>
                        <td className="no">{from + i + 1}</td>
                        <td>
                          <Link href={href}>
                            <span className="lab">{n.note_no}</span>
                          </Link>
                        </td>
                        <td>
                          {n.document_date ? (
                            formatDate(n.document_date)
                          ) : (
                            <span className="dash">belum diposting</span>
                          )}
                        </td>
                        <td className="pri">
                          <Link href={href}>
                            <span className="dstack">
                              <span className="d1">
                                {n.partner_label} — {n.partner_name}
                              </span>
                              <span className="d2">
                                {DNCN_TYPES[n.note_type].label} · {n.book_name}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="num">
                          <span className="mny">{formatMoney(n.note_amount, n.currency_label)}</span>
                        </td>
                        <td>
                          <span className={`bdg ${STATUS_CLASS[n.status] ?? "s-mute"}`}>
                            {STATUS_TEXT[n.status] ?? n.status}
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
                            {can.edit && dncnIsEditable(n.status) ? (
                              <Link
                                className="iact"
                                href={`${href}/edit`}
                                title="Ubah"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Icon name="pen" size={15} />
                              </Link>
                            ) : (
                              <span style={{ width: 24, display: "inline-block" }} />
                            )}
                            {actions.length > 0 ? (
                              <button
                                className="iact kb"
                                title="Aksi lain"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                  setMenuFor({ row: n, x: r.right - 200, y: r.bottom + 5 });
                                }}
                              >
                                <Icon name="hist" size={15} />
                              </button>
                            ) : (
                              <span style={{ width: 24, display: "inline-block" }} />
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pager">
              <span className="inf">
                Halaman <b>{current}</b> dari <b>{pages}</b> ({filtered.length} total)
              </span>
              <Select
                variant="compact"
                value={String(perPage)}
                ariaLabel="Baris per halaman"
                options={[10, 25, 50, 100].map((n) => ({
                  value: String(n),
                  label: `Tampil ${n}`,
                }))}
                onChange={(v) => {
                  setPerPage(Number(v));
                  setPage(1);
                }}
              />
              <div className="pgs">
                <button className="pg" disabled={current <= 1} onClick={() => setPage(1)}>
                  «
                </button>
                <button className="pg" disabled={current <= 1} onClick={() => setPage(current - 1)}>
                  ‹
                </button>
                <span className="pg act">{current}</span>
                <button
                  className="pg"
                  disabled={current >= pages}
                  onClick={() => setPage(current + 1)}
                >
                  ›
                </button>
                <button className="pg" disabled={current >= pages} onClick={() => setPage(pages)}>
                  »
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name={notes.length ? "srch" : "pen"} size={20} />
            </div>
            <h4>{notes.length ? "Tidak ada nota yang cocok" : "Belum ada nota"}</h4>
            <p>
              {notes.length
                ? "Ubah kata kunci atau bersihkan filter yang sedang aktif."
                : "Debit / Credit Note menyesuaikan nilai hutang, piutang atau titipan seorang Partner tanpa perpindahan uang."}
            </p>
            <div className="cta">
              {notes.length ? (
                <button className="btn" onClick={clearAll}>
                  Bersihkan filter
                </button>
              ) : (
                can.create && (
                  <Link className="btn primary" href="/finance/debit-credit-note/new">
                    <Icon name="plus" size={15} /> Buat Nota
                  </Link>
                )
              )}
            </div>
          </div>
        )}
      </div>

      <p className="foot-note">
        Debit Note mendebit account Partner, Credit Note mengkreditnya — apakah posisi
        naik atau turun ditentukan oleh buku subjeknya.
      </p>

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
          icon={DNCN_TRANSITIONS[confirm.action].icon}
          tone={DNCN_TRANSITIONS[confirm.action].tone === "danger" ? "danger" : "ok"}
          title={DNCN_TRANSITIONS[confirm.action].title}
          subject={`${confirm.row.note_no} – ${formatMoney(
            confirm.row.note_amount,
            confirm.row.currency_label
          )}`}
          body={DNCN_TRANSITIONS[confirm.action].body}
          confirmLabel={DNCN_TRANSITIONS[confirm.action].confirmLabel}
          confirmTone={
            DNCN_TRANSITIONS[confirm.action].tone === "danger" ? "solid-danger" : "primary"
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
  row: DncnRow;
  x: number;
  y: number;
  can: DncnAbilities;
  onPick: (action: DncnAction) => void;
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
        <b>{row.note_no}</b>
        <span>{STATUS_TEXT[row.status] ?? row.status}</span>
      </div>
      <div className="dv" />
      {availableDncnActions(row.status, can).map((a) => {
        const t = DNCN_TRANSITIONS[a];
        return (
          <button key={a} className={menuButtonClass(t.tone)} onClick={() => onPick(a)}>
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}
