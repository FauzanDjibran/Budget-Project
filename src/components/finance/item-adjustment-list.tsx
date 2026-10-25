"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { DocumentHeader } from "@/components/ui/document-header";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { Pager } from "@/components/ui/pager";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { transitionItemAdjustment } from "@/app/actions/item-adjustment";
import { formatDate, formatMoney, formatTotals } from "@/lib/format";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type { ItemAdjustmentSummary } from "@/lib/siba/item-adjustment";
import type { ItemAdjustmentRow } from "@/lib/siba/item-adjustment-rows";
import {
  ITEM_ADJUSTMENT_TRANSITIONS,
  ITEM_ADJUSTMENT_KINDS,
  availableItemAdjustmentActions,
  itemAdjustmentIsEditable,
  type ItemAdjustmentAbilities,
  type ItemAdjustmentAction,
  type ItemAdjustmentKind,
} from "@/lib/siba/item-adjustment-workflow";
import { menuButtonClass } from "@/lib/siba/header-actions";

/**
 * The Penyesuaian Open Item register. A document may raise some items and
 * lower others, so its kind — Penambahan, Pengurangan or Campuran — is read
 * off its lines and offered as a filter.
 *
 * `can` mirrors the caller's permissions so the row menu offers only what they
 * may use. It is presentation: `transitionItemAdjustment` re-checks both the
 * permission and whether the transition is legal from the current status.
 */
export function ItemAdjustmentList({
  rows,
  summary,
  can,
  initialStatus,
}: {
  rows: ItemAdjustmentRow[];
  summary: ItemAdjustmentSummary;
  can: ItemAdjustmentAbilities;
  initialStatus?: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(initialStatus ?? "");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [menuFor, setMenuFor] = useState<{ row: ItemAdjustmentRow; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<{ row: ItemAdjustmentRow; action: ItemAdjustmentAction } | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    let out = rows.slice();
    if (status) out = out.filter((n) => n.status === status);
    if (type) out = out.filter((n) => n.kind === type);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((n) =>
        [n.adjustment_no, n.book_name, n.partner_label, n.partner_name, n.reference ?? "", n.note ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return out;
  }, [rows, status, type, query]);

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

  const run = async (row: ItemAdjustmentRow, action: ItemAdjustmentAction) => {
    setBusy(true);
    const result = await transitionItemAdjustment(row.id, action);
    setBusy(false);
    setConfirm(null);
    if (result.ok) {
      toast(result.message, row.adjustment_no, "ok");
      return;
    }
    toast("Tidak dapat diproses", result.errors._form ?? Object.values(result.errors)[0], "err");
  };

  return (
    <>
      <DocumentHeader
        module="Finance"
        icon="pen"
        title="Penyesuaian Open Item"
        sub="Penyesuaian nilai posisi Partner pada buku subjek, tanpa perpindahan uang."
      >
        {can.create && (
          <Link className="btn primary" href="/finance/penyesuaian-open-item/new">
            <Icon name="plus" size={15} /> Buat Penyesuaian
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
            <span className="i t-info">
              <Icon name="check" size={14} />
            </span>
            <span className="l">Sudah Diposting</span>
          </div>
          <div className="v">{summary.posted}</div>
          <div className="d">
            {summary.posted
              ? [
                  summary.increaseTotals.length && `Penambahan ${formatTotals(summary.increaseTotals)}`,
                  summary.decreaseTotals.length && `Pengurangan ${formatTotals(summary.decreaseTotals)}`,
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
            placeholder="Cari nomor, buku, Partner, atau referensi…"
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
          />

          <Select
            variant="toolbar"
            value={type}
            set={Boolean(type)}
            ariaLabel="Filter jenis penyesuaian"
            options={[
              { value: "", label: "Jenis: semua" },
              ...(Object.keys(ITEM_ADJUSTMENT_KINDS) as ItemAdjustmentKind[]).map((t) => ({
                value: t,
                label: ITEM_ADJUSTMENT_KINDS[t],
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
                    <th>Partner / Buku</th>
                    <th className="num" style={{ width: 170 }}>
                      Selisih Bersih
                    </th>
                    <th style={{ width: 104 }}>Status</th>
                    <th style={{ width: 88 }} />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((n, i) => {
                    const actions = availableItemAdjustmentActions(n.status, can);
                    const href = `/finance/penyesuaian-open-item/${n.id}`;
                    return (
                      <tr key={n.id} onClick={() => router.push(href)}>
                        <td className="no">{from + i + 1}</td>
                        <td>
                          <Link href={href}>
                            <span className="lab">{n.adjustment_no}</span>
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
                                {n.partner_label} — {n.partner_name}
                              </span>
                              <span className="d2">
                                {n.kind ? `${ITEM_ADJUSTMENT_KINDS[n.kind]} · ` : ""}
                                {n.book_name}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="num">
                          <span className="mny">{formatMoney(n.adjustment_amount, n.currency_label)}</span>
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
                            {can.edit && itemAdjustmentIsEditable(n.status) ? (
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
              <Icon name={rows.length ? "srch" : "pen"} size={20} />
            </div>
            <h4>{rows.length ? "Tidak ada penyesuaian yang cocok" : "Belum ada penyesuaian"}</h4>
            <p>
              {rows.length
                ? "Ubah kata kunci atau bersihkan filter yang sedang aktif."
                : "Penyesuaian Open Item menambah atau mengurangi hutang, piutang atau titipan seorang Partner tanpa perpindahan uang."}
            </p>
            <div className="cta">
              {rows.length ? (
                <button className="btn" onClick={clearAll}>
                  Bersihkan filter
                </button>
              ) : (
                can.create && (
                  <Link className="btn primary" href="/finance/penyesuaian-open-item/new">
                    <Icon name="plus" size={15} /> Buat Penyesuaian
                  </Link>
                )
              )}
            </div>
          </div>
        )}
      </div>

      <p className="foot-note">
        Selisih Bersih adalah total penambahan dikurangi total pengurangan; setiap open item
        bergerak pada kursnya sendiri.
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
          icon={ITEM_ADJUSTMENT_TRANSITIONS[confirm.action].icon}
          tone={ITEM_ADJUSTMENT_TRANSITIONS[confirm.action].tone === "danger" ? "danger" : "ok"}
          title={ITEM_ADJUSTMENT_TRANSITIONS[confirm.action].title}
          subject={`${confirm.row.adjustment_no} – ${formatMoney(
            confirm.row.adjustment_amount,
            confirm.row.currency_label
          )}`}
          body={ITEM_ADJUSTMENT_TRANSITIONS[confirm.action].body}
          confirmLabel={ITEM_ADJUSTMENT_TRANSITIONS[confirm.action].confirmLabel}
          confirmTone={
            ITEM_ADJUSTMENT_TRANSITIONS[confirm.action].tone === "danger" ? "solid-danger" : "primary"
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
  row: ItemAdjustmentRow;
  x: number;
  y: number;
  can: ItemAdjustmentAbilities;
  onPick: (action: ItemAdjustmentAction) => void;
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
        <b>{row.adjustment_no}</b>
        <span>{STATUS_TEXT[row.status] ?? row.status}</span>
      </div>
      <div className="dv" />
      {availableItemAdjustmentActions(row.status, can).map((a) => {
        const t = ITEM_ADJUSTMENT_TRANSITIONS[a];
        return (
          <button key={a} className={menuButtonClass(t.tone)} onClick={() => onPick(a)}>
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}
