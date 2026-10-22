"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { DocumentHeader } from "@/components/ui/document-header";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { Pager } from "@/components/ui/pager";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { transitionRevaluation } from "@/app/actions/cash-bank-revaluation";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type { RevaluationRow, RevaluationSummary } from "@/lib/siba/cash-bank-revaluation";
import {
  REVALUATION_TRANSITIONS,
  availableRevaluationActions,
  revaluationIsEditable,
  type RevaluationAbilities,
  type RevaluationAction,
} from "@/lib/siba/cash-bank-revaluation-workflow";
import { menuButtonClass } from "@/lib/siba/header-actions";

/**
 * The Revaluasi Kurs register. Each row is one foreign Cash & Bank restated
 * at one kurs; its difference is base currency, so the posted gains and
 * losses may be totalled — they are one measure.
 *
 * `can` mirrors the caller's permissions so the row menu offers only what they
 * may use. It is presentation: `transitionRevaluation` re-checks both.
 */
export function RevaluationList({
  rows,
  summary,
  can,
  initialStatus,
}: {
  rows: RevaluationRow[];
  summary: RevaluationSummary;
  can: RevaluationAbilities;
  initialStatus?: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(initialStatus ?? "");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [menuFor, setMenuFor] = useState<{ row: RevaluationRow; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<{ row: RevaluationRow; action: RevaluationAction } | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    let out = rows.slice();
    if (status) out = out.filter((n) => n.status === status);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((n) =>
        [n.revaluation_no, n.cash_bank_label, n.cash_bank_name, n.currency_label, n.note ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return out;
  }, [rows, status, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pages);
  const from = (current - 1) * perPage;
  const pageRows = filtered.slice(from, from + perPage);

  const activeFilters = (status ? 1 : 0) + (query ? 1 : 0);
  const clearAll = () => {
    setStatus("");
    setQuery("");
    setPage(1);
  };

  const run = async (row: RevaluationRow, action: RevaluationAction) => {
    setBusy(true);
    const result = await transitionRevaluation(row.id, action);
    setBusy(false);
    setConfirm(null);
    if (result.ok) {
      toast(result.message, row.revaluation_no, "ok");
      return;
    }
    toast("Tidak dapat diproses", result.errors._form ?? Object.values(result.errors)[0], "err");
  };

  return (
    <>
      <DocumentHeader
        module="Finance"
        icon="trend"
        title="Revaluasi Kurs"
        sub="Penyesuaian kurs Cash & Bank valas: layer kurs ditutup dan diganti satu layer pada kurs baru."
      >
        {can.create && (
          <Link className="btn primary" href="/finance/revaluasi-kurs/new">
            <Icon name="plus" size={15} /> Buat Revaluasi
          </Link>
        )}
      </DocumentHeader>

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
            <span className="i t-warn">
              <Icon name="clock" size={14} />
            </span>
            <span className="l">Belum Diposting</span>
          </div>
          <div className="v">{summary.draft}</div>
          <div className="d">belum menyentuh layer mana pun</div>
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
            <span className="i t-info">
              <Icon name="check" size={14} />
            </span>
            <span className="l">Sudah Diposting</span>
          </div>
          <div className="v">{summary.posted}</div>
          <div className="d">
            {summary.posted
              ? [
                  summary.gain && `Laba ${formatMoney(summary.gain, BASE_CURRENCY_LABEL)}`,
                  summary.loss && `Rugi ${formatMoney(summary.loss, BASE_CURRENCY_LABEL)}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "tanpa selisih"
              : "belum ada Cash & Bank yang direvaluasi"}
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
            <span className="i t-bad">
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
            placeholder="Cari nomor, Cash & Bank, atau currency…"
            onChange={(v) => {
              setQuery(v);
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
            <b>{filtered.length}</b> dari {rows.length} dokumen
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
                    <th>Cash & Bank</th>
                    <th className="num" style={{ width: 130 }}>
                      Kurs Baru
                    </th>
                    <th className="num" style={{ width: 170 }}>
                      Selisih
                    </th>
                    <th style={{ width: 104 }}>Status</th>
                    <th style={{ width: 88 }} />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((n, i) => {
                    const actions = availableRevaluationActions(n.status, can);
                    const href = `/finance/revaluasi-kurs/${n.id}`;
                    return (
                      <tr key={n.id} onClick={() => router.push(href)}>
                        <td className="no">{from + i + 1}</td>
                        <td>
                          <Link href={href}>
                            <span className="lab">{n.revaluation_no}</span>
                          </Link>
                        </td>
                        <td>
                          {n.accounting_date ? (
                            formatDate(n.accounting_date)
                          ) : (
                            <span className="dash">belum diposting</span>
                          )}
                        </td>
                        <td className="pri">
                          <Link href={href}>
                            <span className="dstack">
                              <span className="d1">
                                {n.cash_bank_label} — {n.cash_bank_name}
                              </span>
                              <span className="d2">
                                {formatMoney(n.foreign_balance, n.currency_label)} · {n.company_label}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="num">
                          <span className="mny">{formatRate(n.exchange_rate)}</span>
                        </td>
                        <td className="num">
                          <Amount value={n.fx_difference} currency={BASE_CURRENCY_LABEL} />
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
                            {can.edit && revaluationIsEditable(n.status) ? (
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
                                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                  setMenuFor({ row: n, x: r.right - 200, y: r.bottom + 5 });
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
              page={current}
              pages={pages}
              total={filtered.length}
              perPage={perPage}
              onPage={setPage}
              onPerPage={(n) => {
                setPerPage(n);
                setPage(1);
              }}
            />
          </>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name={rows.length ? "srch" : "trend"} size={20} />
            </div>
            <h4>{rows.length ? "Tidak ada revaluasi yang cocok" : "Belum ada revaluasi kurs"}</h4>
            <p>
              {rows.length
                ? "Ubah kata kunci atau bersihkan filter yang sedang aktif."
                : "Revaluasi Kurs menyatakan kurs saat ini untuk satu Cash & Bank valas: layer kursnya ditutup dan diganti satu layer pada kurs tersebut."}
            </p>
            <div className="cta">
              {rows.length ? (
                <button className="btn" onClick={clearAll}>
                  Bersihkan filter
                </button>
              ) : (
                can.create && (
                  <Link className="btn primary" href="/finance/revaluasi-kurs/new">
                    <Icon name="plus" size={15} /> Buat Revaluasi
                  </Link>
                )
              )}
            </div>
          </div>
        )}
      </div>

      <p className="foot-note">
        Selisih dalam {BASE_CURRENCY_LABEL}: positif laba revaluasi, negatif rugi revaluasi.
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
          icon={REVALUATION_TRANSITIONS[confirm.action].icon}
          tone={REVALUATION_TRANSITIONS[confirm.action].tone === "danger" ? "danger" : "ok"}
          title={REVALUATION_TRANSITIONS[confirm.action].title}
          subject={`${confirm.row.revaluation_no} – ${confirm.row.cash_bank_label} @ ${formatRate(
            confirm.row.exchange_rate
          )}`}
          body={REVALUATION_TRANSITIONS[confirm.action].body}
          confirmLabel={REVALUATION_TRANSITIONS[confirm.action].confirmLabel}
          confirmTone={
            REVALUATION_TRANSITIONS[confirm.action].tone === "danger" ? "solid-danger" : "primary"
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
  row: RevaluationRow;
  x: number;
  y: number;
  can: RevaluationAbilities;
  onPick: (action: RevaluationAction) => void;
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
        <b>{row.revaluation_no}</b>
        <span>{STATUS_TEXT[row.status] ?? row.status}</span>
      </div>
      <div className="dv" />
      {availableRevaluationActions(row.status, can).map((a) => {
        const t = REVALUATION_TRANSITIONS[a];
        return (
          <button key={a} className={menuButtonClass(t.tone)} onClick={() => onPick(a)}>
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}
