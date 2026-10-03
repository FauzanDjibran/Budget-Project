"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { DocumentHeader } from "@/components/ui/document-header";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { Pager } from "@/components/ui/pager";
import { Amount } from "@/components/ui/amount";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { transitionConversion } from "@/app/actions/item-conversion";
import { formatDate, formatMoney, formatTotals } from "@/lib/format";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type { ConversionRow, ConversionSummary } from "@/lib/siba/item-conversion";
import {
  CONVERSION_TRANSITIONS,
  availableConversionActions,
  conversionIsEditable,
  type ConversionAbilities,
  type ConversionAction,
} from "@/lib/siba/item-conversion-workflow";
import { menuButtonClass } from "@/lib/siba/header-actions";

const LIST_HREF = "/finance/pencairan-open-item";

/**
 * The Pencairan Open Item register.
 *
 * `can` mirrors the caller's permissions so the row menu offers only what they
 * may use. It is presentation: `transitionConversion` re-checks both.
 */
export function ItemConversionList({
  conversions,
  summary,
  can,
  initialStatus,
}: {
  conversions: ConversionRow[];
  summary: ConversionSummary;
  can: ConversionAbilities;
  /** Status the page was opened filtered to, from `?status=`. */
  initialStatus?: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(initialStatus ?? "");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [menuFor, setMenuFor] = useState<{ row: ConversionRow; x: number; y: number } | null>(
    null
  );
  const [confirm, setConfirm] = useState<
    { row: ConversionRow; action: ConversionAction } | null
  >(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    let out = conversions.slice();
    if (status) out = out.filter((c) => c.status === status);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((c) =>
        [c.conversion_no, c.partner_label, c.partner_name, c.book_name, c.source_label, c.note ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return out;
  }, [conversions, status, query]);

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

  const run = async (row: ConversionRow, action: ConversionAction) => {
    setBusy(true);
    const result = await transitionConversion(row.id, action);
    setBusy(false);
    setConfirm(null);
    if (result.ok) {
      toast(result.message, row.conversion_no, "ok");
      return;
    }
    toast("Tidak dapat diproses", result.errors._form ?? Object.values(result.errors)[0], "err");
  };

  const kpi = (s: string) => () => {
    setStatus(s);
    setPage(1);
  };

  return (
    <>
      <DocumentHeader
        module="Finance"
        icon="down"
        title="Pencairan Open Item"
        sub="Valuta asing dijual dan open item Partner dikonversi ke Rupiah pada kurs yang sama, dengan satu selisih pencairan."
      >
        {can.create && (
          <Link className="btn primary" href={`${LIST_HREF}/new`}>
            <Icon name="plus" size={15} /> Buat Pencairan
          </Link>
        )}
      </DocumentHeader>

      <div className="kpis bud">
        <button className="kpi" onClick={kpi("Draft")} style={{ textAlign: "left", font: "inherit" }}>
          <div className="h">
            <span className="i t-warn">
              <Icon name="clock" size={14} />
            </span>
            <span className="l">Belum Diposting</span>
          </div>
          <div className="v">{summary.draft}</div>
          <div className="d">belum menyentuh saldo maupun open item</div>
        </button>

        <button className="kpi wide" onClick={kpi("Posted")} style={{ textAlign: "left", font: "inherit" }}>
          <div className="h">
            <span className="i t-info">
              <Icon name="check" size={14} />
            </span>
            <span className="l">Sudah Diposting</span>
          </div>
          <div className="v">{summary.posted}</div>
          <div className="d">
            {summary.postedTotals.length
              ? `${formatTotals(summary.postedTotals)} dicairkan`
              : "belum ada dana yang dicairkan"}
          </div>
        </button>

        <button className="kpi" onClick={kpi("Cancelled")} style={{ textAlign: "left", font: "inherit" }}>
          <div className="h">
            <span className="i t-bad">
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
            placeholder="Cari nomor dokumen, Partner, buku, atau sumber…"
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
            <b>{filtered.length}</b> dari {conversions.length} dokumen
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
                    <th style={{ width: 150 }}>Sumber</th>
                    <th className="num" style={{ width: 160 }}>
                      Nominal
                    </th>
                    <th style={{ width: 104 }}>Status</th>
                    <th style={{ width: 88 }} />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((c, i) => {
                    const actions = availableConversionActions(c.status, can);
                    const href = `${LIST_HREF}/${c.id}`;
                    return (
                      <tr key={c.id} onClick={() => router.push(href)}>
                        <td className="no">{from + i + 1}</td>
                        <td>
                          <Link href={href}>
                            <span className="lab">{c.conversion_no}</span>
                          </Link>
                        </td>
                        <td>
                          {c.document_date ? (
                            formatDate(c.document_date)
                          ) : (
                            <span className="dash">belum ditentukan</span>
                          )}
                        </td>
                        <td className="pri">
                          <Link href={href}>
                            <span className="dstack">
                              <span className="d1">{c.partner_name}</span>
                              <span className="d2">
                                {c.partner_label} · {c.book_name}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td>
                          <span className="lab">{c.source_label}</span>
                        </td>
                        <td className="num">
                          <Amount value={c.conversion_amount} currency={c.currency_label} />
                        </td>
                        <td>
                          <span className={`bdg ${STATUS_CLASS[c.status] ?? "s-mute"}`}>
                            {STATUS_TEXT[c.status] ?? c.status}
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
                            {can.edit && conversionIsEditable(c.status) ? (
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
                                  setMenuFor({ row: c, x: r.right - 200, y: r.bottom + 5 });
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
              <Icon name={conversions.length ? "srch" : "down"} size={20} />
            </div>
            <h4>{conversions.length ? "Tidak ada dokumen yang cocok" : "Belum ada Pencairan Open Item"}</h4>
            <p>
              {conversions.length
                ? "Ubah kata kunci atau bersihkan filter yang sedang aktif."
                : "Pencairan Open Item menjual valuta asing atas dana Partner dan mengkonversi open item-nya ke Rupiah pada kurs yang sama."}
            </p>
            <div className="cta">
              {conversions.length ? (
                <button className="btn" onClick={clearAll}>
                  Bersihkan filter
                </button>
              ) : (
                can.create && (
                  <Link className="btn primary" href={`${LIST_HREF}/new`}>
                    <Icon name="plus" size={15} /> Buat Pencairan
                  </Link>
                )
              )}
            </div>
          </div>
        )}
      </div>

      <p className="foot-note">
        Satu kurs menilai kedua sisi, sehingga selisih yang tersisa hanyalah jarak
        antara kurs layer kas dan kurs open item — dijurnal sebagai satu baris
        selisih pencairan, bukan revaluasi.
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
          icon={CONVERSION_TRANSITIONS[confirm.action].icon}
          tone={CONVERSION_TRANSITIONS[confirm.action].tone === "danger" ? "danger" : "ok"}
          title={CONVERSION_TRANSITIONS[confirm.action].title}
          subject={`${confirm.row.conversion_no} – ${formatMoney(
            confirm.row.conversion_amount,
            confirm.row.currency_label
          )}`}
          body={CONVERSION_TRANSITIONS[confirm.action].body}
          confirmLabel={CONVERSION_TRANSITIONS[confirm.action].confirmLabel}
          confirmTone={
            CONVERSION_TRANSITIONS[confirm.action].tone === "danger" ? "solid-danger" : "primary"
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
  row: ConversionRow;
  x: number;
  y: number;
  can: ConversionAbilities;
  onPick: (action: ConversionAction) => void;
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

  const actions = availableConversionActions(row.status, can);

  return (
    <div className="menu" ref={ref} style={{ left: Math.max(8, x), top: y }}>
      <div className="hd">
        <b>{row.conversion_no}</b>
        <span>{STATUS_TEXT[row.status] ?? row.status}</span>
      </div>
      <div className="dv" />
      {actions.map((a) => {
        const t = CONVERSION_TRANSITIONS[a];
        return (
          <button key={a} className={menuButtonClass(t.tone)} onClick={() => onPick(a)}>
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}
