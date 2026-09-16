"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { transitionTransaction } from "@/app/actions/finance";
import { requestFunding, withdrawFunding } from "@/app/actions/funding";
import { formatDate, formatMoney, formatTotals } from "@/lib/format";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type { CashBookSummary } from "@/lib/siba/cash-bank";
import type {
  FinanceRefs,
  PurposeOption,
  TransactionRow,
  TransactionSummary,
} from "@/lib/siba/finance";
import {
  TRANSACTION_TRANSITIONS,
  TRANSACTION_TYPE_TEXT,
  availableTransactionActions,
  transactionIsEditable,
  type TransactionAbilities,
  type TransactionAction,
} from "@/lib/siba/transaction-workflow";
import { menuButtonClass } from "@/lib/siba/header-actions";
import { CashBalanceDialog } from "@/components/budget/cash-balance-dialog";

/**
 * The Cash Bank Transaction register.
 *
 * `can` mirrors the caller's permissions so the row menu offers only what they
 * may use. It is presentation: `transitionTransaction` re-checks both the
 * permission and whether the transition is legal from the document's current
 * status.
 *
 * Drafts and Posted documents are counted separately in the KPI row because
 * they mean opposite things — a Draft has touched nothing, a Posted one has
 * moved money that cannot be moved back.
 */
export function TransactionList({
  transactions,
  refs,
  purposes,
  summary,
  cash,
  can,
  initialStatus,
}: {
  transactions: TransactionRow[];
  refs: FinanceRefs;
  purposes: PurposeOption[];
  summary: TransactionSummary;
  cash: CashBookSummary;
  can: TransactionAbilities;
  /** Status the page was opened filtered to, from `?status=` — see the route. */
  initialStatus?: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(initialStatus ?? "");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [menuFor, setMenuFor] = useState<
    { row: TransactionRow; x: number; y: number } | null
  >(null);
  const [confirm, setConfirm] = useState<
    { row: TransactionRow; action: TransactionAction } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [showCash, setShowCash] = useState(false);

  const purposeLabelOf = useMemo(() => {
    const byKey = new Map(purposes.map((p) => [p.key, p.label]));
    return (key: string) => byKey.get(key) ?? key;
  }, [purposes]);

  const currencyOf = useMemo(() => {
    const byId = new Map(refs.currencies.map((c) => [c.id, c.label]));
    return (id: number) => byId.get(id) ?? "IDR";
  }, [refs.currencies]);

  const cashBankOf = useMemo(() => {
    const byId = new Map(refs.cashBanks.map((c) => [c.id, c.label]));
    return (id: number | null) => (id == null ? "—" : byId.get(id) ?? "—");
  }, [refs.cashBanks]);

  /**
   * The anak funds nothing itself, so its documents offer Ajukan Dana where the
   * induk's offer Post. Decided per row, because the register shows both.
   */
  const fundedOf = useMemo(() => {
    const parent = new Map(refs.companies.map((c) => [c.id, c.isParent]));
    return (companyId: number) => parent.get(companyId) === false;
  }, [refs.companies]);

  const filtered = useMemo(() => {
    let out = transactions.slice();
    if (status) out = out.filter((t) => t.status === status);
    if (type) out = out.filter((t) => t.transaction_type === type);

    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((t) =>
        [t.transaction_no, purposeLabelOf(t.purpose), t.note ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return out;
  }, [transactions, status, type, query, purposeLabelOf]);

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

  const run = async (row: TransactionRow, action: TransactionAction) => {
    setBusy(true);
    // Submitting opens a Funding Request and withdrawing a Pending document
    // closes one, so both go through the module that owns that state.
    const result =
      action === "submit"
        ? await requestFunding(row.id)
        : action === "cancel" && row.status === "Pending"
          ? await withdrawFunding(row.id)
          : await transitionTransaction(row.id, action);
    setBusy(false);
    setConfirm(null);
    if (result.ok) {
      toast(result.message, row.transaction_no, "ok");
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
          <span className="cur">Cash Bank Transaction</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="wallet2" size={16} />
            </span>
            Cash Bank Transaction
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/finance/cash-bank-transaction/new">
                <Icon name="plus" size={15} /> Buat Dokumen
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Layer eksekusi. Satu dokumen kas/bank dapat merealisasikan beberapa
          Budget yang sudah disetujui.
        </p>
      </div>

      <div className="kpis bud">
        <button
          className="kpi wide"
          onClick={() => setShowCash(true)}
          style={{ textAlign: "left", font: "inherit" }}
        >
          <div className="h">
            <span
              className="i"
              style={{ background: "var(--ok-bg)", color: "var(--ok)" }}
            >
              <Icon name="wallet2" size={14} />
            </span>
            <span className="l">Saldo Kas &amp; Bank</span>
            <span className="more">
              Rincian <Icon name="chev" size={11} />
            </span>
          </div>
          <div className="v">
            {cash.byCurrency.length
              ? formatMoney(
                  cash.byCurrency[0].balance,
                  cash.byCurrency[0].currencyLabel
                )
              : "—"}
          </div>
          <div className="d">
            {cash.resources} resource aktif
            {cash.byCurrency.length > 1 && (
              <>
                {" · "}
                {cash.byCurrency
                  .slice(1)
                  .map((c) => formatMoney(c.balance, c.currencyLabel))
                  .join(" · ")}
              </>
            )}
          </div>
        </button>

        <button
          className="kpi"
          onClick={() => {
            setStatus("Draft");
            setPage(1);
          }}
          style={{ textAlign: "left", font: "inherit" }}
        >
          <div className="h">
            <span
              className="i"
              style={{ background: "var(--warn-bg)", color: "var(--warn)" }}
            >
              <Icon name="clock" size={14} />
            </span>
            <span className="l">Belum Diposting</span>
          </div>
          <div className="v">{summary.draft}</div>
          <div className="d">
            {formatTotals(summary.draftTotals)} · belum menyentuh Budget maupun
            saldo
          </div>
        </button>

        <button
          className="kpi"
          onClick={() => {
            setStatus("Posted");
            setPage(1);
          }}
          style={{ textAlign: "left", font: "inherit" }}
        >
          <div className="h">
            <span
              className="i"
              style={{ background: "var(--info-bg)", color: "var(--info)" }}
            >
              <Icon name="check" size={14} />
            </span>
            <span className="l">Sudah Diposting</span>
          </div>
          <div className="v">{summary.posted}</div>
          <div className="d">
            + {formatTotals(summary.inTotals)} masuk · −{" "}
            {formatTotals(summary.outTotals)} keluar
          </div>
        </button>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField
            value={query}
            placeholder="Cari nomor dokumen, purpose, atau catatan…"
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
              ...["Draft", "Pending", "Posted", "Cancelled"].map((s) => ({
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
            value={type}
            set={Boolean(type)}
            ariaLabel="Filter arah"
            options={[
              { value: "", label: "Arah: semua" },
              { value: "In", label: "Penerimaan" },
              { value: "Out", label: "Pengeluaran" },
            ]}
            onChange={(v) => {
              setType(v);
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
            <b>{filtered.length}</b> dari {transactions.length} dokumen
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
                    <th>Purpose / Cash &amp; Bank</th>
                    <th style={{ width: 90 }}>Budget</th>
                    <th className="num" style={{ width: 160 }}>
                      Nominal
                    </th>
                    <th style={{ width: 104 }}>Status</th>
                    <th style={{ width: 88 }} />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((t, i) => {
                    const inn = t.transaction_type === "In";
                    const currency = currencyOf(t.currency_id);
                    const actions = availableTransactionActions(t.status, can, {
                      funded: fundedOf(t.company_id),
                    });
                    const href = `/finance/cash-bank-transaction/${t.id}`;
                    return (
                      <tr key={t.id} onClick={() => router.push(href)}>
                        <td className="no">{from + i + 1}</td>
                        <td>
                          <Link href={href}>
                            <span className="lab">{t.transaction_no}</span>
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
                                {purposeLabelOf(t.purpose)}
                              </span>
                              <span className="d2">
                                {t.cash_bank_id
                                  ? cashBankOf(t.cash_bank_id)
                                  : "Melalui Funding Request"}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td>
                          <span className="bdg t-slate">{t.line_count}</span>
                        </td>
                        <td className="num">
                          <span
                            className={`mny ${inn ? "in" : "out"}`}
                            title={TRANSACTION_TYPE_TEXT[t.transaction_type]}
                          >
                            {inn ? "+ " : "− "}
                            {formatMoney(t.transaction_amount, currency)}
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
                            {can.edit && transactionIsEditable(t.status) ? (
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
              <Icon name={transactions.length ? "srch" : "wallet2"} size={20} />
            </div>
            <h4>
              {transactions.length
                ? "Tidak ada dokumen yang cocok"
                : "Belum ada dokumen kas/bank"}
            </h4>
            <p>
              {transactions.length
                ? "Ubah kata kunci atau bersihkan filter yang sedang aktif."
                : "Dokumen kas/bank merealisasikan Budget yang sudah disetujui. Mulai dengan memilih Transaction Purpose."}
            </p>
            <div className="cta">
              {transactions.length ? (
                <button className="btn" onClick={clearAll}>
                  Bersihkan filter
                </button>
              ) : (
                can.create && (
                  <Link
                    className="btn primary"
                    href="/finance/cash-bank-transaction/new"
                  >
                    <Icon name="plus" size={15} /> Buat Dokumen
                  </Link>
                )
              )}
            </div>
          </div>
        )}
      </div>

      <p className="foot-note">
        Tanggal Dokumen dicatat saat dokumen diposting — dokumen Draft belum
        punya tanggal karena belum berdampak ke kas/bank. Realisasi juga tidak
        melihat Tanggal Budget: selisih keduanya adalah bahan laporan realisasi
        lebih awal atau terlambat, bukan penghalang eligibility.
      </p>

      {menuFor && (
        <RowMenu
          row={menuFor.row}
          x={menuFor.x}
          y={menuFor.y}
          can={can}
          funded={fundedOf(menuFor.row.company_id)}
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
          icon={TRANSACTION_TRANSITIONS[confirm.action].icon}
          tone={TRANSACTION_TRANSITIONS[confirm.action].tone === "danger" ? "danger" : "ok"}
          title={TRANSACTION_TRANSITIONS[confirm.action].title}
          subject={`${confirm.row.transaction_no} – ${formatMoney(
            confirm.row.transaction_amount,
            currencyOf(confirm.row.currency_id)
          )}`}
          body={TRANSACTION_TRANSITIONS[confirm.action].body}
          confirmLabel={TRANSACTION_TRANSITIONS[confirm.action].confirmLabel}
          confirmTone={
            TRANSACTION_TRANSITIONS[confirm.action].tone === "danger"
              ? "solid-danger"
              : "primary"
          }
          busy={busy}
          onConfirm={() => run(confirm.row, confirm.action)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {showCash && (
        <CashBalanceDialog cash={cash} onClose={() => setShowCash(false)} />
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
  funded,
  onPick,
  onClose,
}: {
  row: TransactionRow;
  x: number;
  y: number;
  can: TransactionAbilities;
  funded: boolean;
  onPick: (action: TransactionAction) => void;
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

  const actions = availableTransactionActions(row.status, can, { funded });

  return (
    <div className="menu" ref={ref} style={{ left: Math.max(8, x), top: y }}>
      <div className="hd">
        <b>{row.transaction_no}</b>
        <span>{STATUS_TEXT[row.status] ?? row.status}</span>
      </div>
      <div className="dv" />
      {actions.map((a) => {
        const t = TRANSACTION_TRANSITIONS[a];
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
