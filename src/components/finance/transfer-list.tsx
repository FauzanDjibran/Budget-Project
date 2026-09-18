"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { transitionTransfer } from "@/app/actions/transfer";
import { formatDate, formatMoney, formatTotals } from "@/lib/format";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type {
  TransferRefs,
  TransferRow,
  TransferSummary,
} from "@/lib/siba/transfer";
import {
  TRANSFER_PURPOSES,
  transferPurposeLabel,
} from "@/lib/siba/transfer-catalogue";
import {
  TRANSFER_TRANSITIONS,
  availableTransferActions,
  transferIsEditable,
  type TransferAbilities,
  type TransferAction,
} from "@/lib/siba/transfer-workflow";
import { menuButtonClass } from "@/lib/siba/header-actions";

/**
 * The Cash Bank Transfer register.
 *
 * `can` mirrors the caller's permissions so the row menu offers only what they
 * may use. It is presentation: `transitionTransfer` re-checks both the
 * permission and whether the transition is legal from the document's current
 * status.
 *
 * The amount column reads **neutral**, not `+`/`−`: a transfer is not money
 * arriving or leaving the company, it is money in a different pocket. Only the
 * two resources named on the row say which pockets.
 */
export function TransferList({
  transfers,
  refs,
  summary,
  can,
  initialStatus,
}: {
  transfers: TransferRow[];
  refs: TransferRefs;
  summary: TransferSummary;
  can: TransferAbilities;
  /** Status the page was opened filtered to, from `?status=`. */
  initialStatus?: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(initialStatus ?? "");
  const [purpose, setPurpose] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [menuFor, setMenuFor] = useState<
    { row: TransferRow; x: number; y: number } | null
  >(null);
  const [confirm, setConfirm] = useState<
    { row: TransferRow; action: TransferAction } | null
  >(null);
  const [busy, setBusy] = useState(false);

  const currencyOf = useMemo(() => {
    const byId = new Map(refs.currencies.map((c) => [c.id, c.label]));
    return (id: number) => byId.get(id) ?? "IDR";
  }, [refs.currencies]);

  const cashBankOf = useMemo(() => {
    const byId = new Map(refs.cashBanks.map((c) => [c.id, c.label]));
    return (id: number) => byId.get(id) ?? "—";
  }, [refs.cashBanks]);

  const filtered = useMemo(() => {
    let out = transfers.slice();
    if (status) out = out.filter((t) => t.status === status);
    if (purpose) out = out.filter((t) => t.purpose === purpose);

    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((t) =>
        [
          t.transfer_no,
          transferPurposeLabel(t.purpose),
          cashBankOf(t.from_cash_bank_id),
          t.note ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return out;
  }, [transfers, status, purpose, query, cashBankOf]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pages);
  const from = (current - 1) * perPage;
  const pageRows = filtered.slice(from, from + perPage);

  const activeFilters = (status ? 1 : 0) + (purpose ? 1 : 0) + (query ? 1 : 0);
  const clearAll = () => {
    setStatus("");
    setPurpose("");
    setQuery("");
    setPage(1);
  };

  const run = async (row: TransferRow, action: TransferAction) => {
    setBusy(true);
    const result = await transitionTransfer(row.id, action);
    setBusy(false);
    setConfirm(null);
    if (result.ok) {
      toast(result.message, row.transfer_no, "ok");
      router.refresh();
      return;
    }
    toast(
      "Tidak dapat diproses",
      result.errors._form ?? Object.values(result.errors)[0],
      "err"
    );
  };

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <span className="cur">Cash Bank Transfer</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="link" size={16} />
            </span>
            Cash Bank Transfer
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/finance/cash-bank-transfer/new">
                <Icon name="plus" size={15} /> Buat Transfer
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Pemindahan dana antar Cash &amp; Bank milik Company sendiri. Satu
          sumber di header, beberapa tujuan di baris.
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
          <div className="d">belum menyentuh saldo mana pun</div>
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
            {summary.postedTotals.length
              ? `${formatTotals(summary.postedTotals)} dipindahkan`
              : "belum ada dana yang dipindahkan"}
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
          <div className="d">tidak pernah bergerak</div>
        </button>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField
            value={query}
            placeholder="Cari nomor dokumen, purpose, atau sumber…"
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

          <Select
            variant="toolbar"
            value={purpose}
            set={Boolean(purpose)}
            ariaLabel="Filter purpose"
            options={[
              { value: "", label: "Purpose: semua" },
              ...TRANSFER_PURPOSES.map((p) => ({ value: p.key, label: p.label })),
            ]}
            onChange={(v) => {
              setPurpose(v);
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
            <b>{filtered.length}</b> dari {transfers.length} dokumen
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
                    <th>Purpose / Sumber</th>
                    <th style={{ width: 90 }}>Tujuan</th>
                    <th className="num" style={{ width: 160 }}>
                      Nominal
                    </th>
                    <th style={{ width: 104 }}>Status</th>
                    <th style={{ width: 88 }} />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((t, i) => {
                    const currency = currencyOf(t.currency_id);
                    const actions = availableTransferActions(t.status, can);
                    const href = `/finance/cash-bank-transfer/${t.id}`;
                    return (
                      <tr key={t.id} onClick={() => router.push(href)}>
                        <td className="no">{from + i + 1}</td>
                        <td>
                          <Link href={href}>
                            <span className="lab">{t.transfer_no}</span>
                          </Link>
                        </td>
                        <td>
                          {t.document_date ? (
                            formatDate(t.document_date)
                          ) : (
                            <span className="dash">belum diposting</span>
                          )}
                        </td>
                        <td className="pri">
                          <Link href={href}>
                            <span className="dstack">
                              <span className="d1">
                                {transferPurposeLabel(t.purpose)}
                              </span>
                              <span className="d2">
                                dari {cashBankOf(t.from_cash_bank_id)}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td>
                          <span className="bdg t-slate">{t.line_count}</span>
                        </td>
                        <td className="num">
                          <span className="mny">
                            {formatMoney(t.transfer_amount, currency)}
                          </span>
                        </td>
                        <td>
                          <span className={`bdg ${STATUS_CLASS[t.status] ?? "s-mute"}`}>
                            {STATUS_TEXT[t.status] ?? t.status}
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
                            {can.edit && transferIsEditable(t.status) ? (
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
                                  const r = (
                                    e.currentTarget as HTMLElement
                                  ).getBoundingClientRect();
                                  setMenuFor({
                                    row: t,
                                    x: r.right - 200,
                                    y: r.bottom + 5,
                                  });
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
                <button
                  className="pg"
                  disabled={current <= 1}
                  onClick={() => setPage(current - 1)}
                >
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
                <button
                  className="pg"
                  disabled={current >= pages}
                  onClick={() => setPage(pages)}
                >
                  »
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name={transfers.length ? "srch" : "link"} size={20} />
            </div>
            <h4>
              {transfers.length
                ? "Tidak ada dokumen yang cocok"
                : "Belum ada transfer"}
            </h4>
            <p>
              {transfers.length
                ? "Ubah kata kunci atau bersihkan filter yang sedang aktif."
                : "Transfer memindahkan dana antar Cash & Bank milik Company sendiri — termasuk pencairan valuta asing dan pembelian valas."}
            </p>
            <div className="cta">
              {transfers.length ? (
                <button className="btn" onClick={clearAll}>
                  Bersihkan filter
                </button>
              ) : (
                can.create && (
                  <Link className="btn primary" href="/finance/cash-bank-transfer/new">
                    <Icon name="plus" size={15} /> Buat Transfer
                  </Link>
                )
              )}
            </div>
          </div>
        )}
      </div>

      <p className="foot-note">
        Transfer tidak mengubah total kas perusahaan — hanya letaknya, kecuali
        Pencairan, yang mengakui selisih kurs antara kurs perolehan dan kurs jual.
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
          icon={TRANSFER_TRANSITIONS[confirm.action].icon}
          tone={TRANSFER_TRANSITIONS[confirm.action].tone === "danger" ? "danger" : "ok"}
          title={TRANSFER_TRANSITIONS[confirm.action].title}
          subject={`${confirm.row.transfer_no} – ${formatMoney(
            confirm.row.transfer_amount,
            currencyOf(confirm.row.currency_id)
          )}`}
          body={TRANSFER_TRANSITIONS[confirm.action].body}
          confirmLabel={TRANSFER_TRANSITIONS[confirm.action].confirmLabel}
          confirmTone={
            TRANSFER_TRANSITIONS[confirm.action].tone === "danger"
              ? "solid-danger"
              : "primary"
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
  row: TransferRow;
  x: number;
  y: number;
  can: TransferAbilities;
  onPick: (action: TransferAction) => void;
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

  const actions = availableTransferActions(row.status, can);

  return (
    <div className="menu" ref={ref} style={{ left: Math.max(8, x), top: y }}>
      <div className="hd">
        <b>{row.transfer_no}</b>
        <span>{STATUS_TEXT[row.status] ?? row.status}</span>
      </div>
      <div className="dv" />
      {actions.map((a) => {
        const t = TRANSFER_TRANSITIONS[a];
        return (
          <button
            key={a}
            className={menuButtonClass(t.tone)}
            onClick={() => onPick(a)}
          >
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}
