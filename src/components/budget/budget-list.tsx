"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { transitionBudget } from "@/app/actions/budget";
import { formatDate, formatMoney, formatTotals } from "@/lib/format";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type {
  BudgetMapping,
  BudgetRefs,
  BudgetRow,
  BudgetSummary,
} from "@/lib/siba/budget";
import type { CashBookSummary } from "@/lib/siba/cash-bank";
import {
  BUDGET_TRANSITIONS,
  BUDGET_TYPE_TEXT,
  availableActions,
  budgetIsEditable,
  type BudgetAbilities,
  type BudgetAction,
} from "@/lib/siba/budget-workflow";
import { ApproveDialog } from "./approve-dialog";
import { CashBalanceDialog } from "./cash-balance-dialog";
import { ReportPicker } from "./report-picker";

/**
 * The budget list for one month, or for every month.
 *
 * `can` mirrors the caller's permissions so the row menu offers only what they
 * may use. It is presentation: `transitionBudget` re-checks both the permission
 * and whether the transition is legal from the budget's current status.
 */
export function BudgetList({
  budgets,
  refs,
  mappings,
  summary,
  cash,
  month,
  can,
}: {
  budgets: BudgetRow[];
  refs: BudgetRefs;
  mappings: BudgetMapping[];
  summary: BudgetSummary;
  cash: CashBookSummary;
  /** null when the page is showing every month at once. */
  month: { id: number; label: string; name: string } | null;
  can: BudgetAbilities;
}) {
  const router = useRouter();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [company, setCompany] = useState("");
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" }>({
    field: "budget_date",
    dir: "desc",
  });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const [menuFor, setMenuFor] = useState<{ row: BudgetRow; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<{ row: BudgetRow; action: BudgetAction } | null>(null);
  const [approving, setApproving] = useState<BudgetRow | null>(null);
  const [approveErrors, setApproveErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showCash, setShowCash] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const companyOf = useMemo(() => {
    const byId = new Map(refs.companies.map((c) => [c.id, c]));
    return (id: number) => byId.get(id) ?? null;
  }, [refs.companies]);

  const currencyOf = useMemo(() => {
    const byId = new Map(refs.currencies.map((c) => [c.id, c.label]));
    return (id: number) => byId.get(id) ?? "IDR";
  }, [refs.currencies]);

  const categoryOf = useMemo(() => {
    const byId = new Map(refs.categories.map((c) => [c.id, c]));
    return (id: number | null) => (id == null ? null : byId.get(id) ?? null);
  }, [refs.categories]);

  const filtered = useMemo(() => {
    let out = budgets.slice();
    if (status) out = out.filter((b) => b.status === status);
    if (type) out = out.filter((b) => b.budget_type === type);
    if (company) out = out.filter((b) => String(b.company_id) === company);

    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((b) =>
        [
          b.budget_no,
          b.description,
          formatDate(b.budget_date),
          companyOf(b.company_id)?.name ?? "",
          categoryOf(b.category_id)?.label ?? "",
          STATUS_TEXT[b.status] ?? b.status,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    const dir = sort.dir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      switch (sort.field) {
        case "budget_amount":
          return (a.budget_amount - b.budget_amount) * dir;
        case "description":
          return a.description.localeCompare(b.description, "id") * dir;
        case "category_id":
          return (
            (categoryOf(a.category_id)?.label ?? "").localeCompare(
              categoryOf(b.category_id)?.label ?? "",
              "id"
            ) * dir
          );
        case "status":
          return a.status.localeCompare(b.status) * dir;
        case "budget_no":
          return a.budget_no.localeCompare(b.budget_no, "id", { numeric: true }) * dir;
        default:
          return (
            a.budget_date.localeCompare(b.budget_date) * dir ||
            (a.id - b.id) * dir
          );
      }
    });
    return out;
  }, [budgets, status, type, company, query, sort, companyOf, categoryOf]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pages);
  const from = (current - 1) * perPage;
  const pageRows = filtered.slice(from, from + perPage);

  const activeFilters =
    (status ? 1 : 0) + (type ? 1 : 0) + (company ? 1 : 0) + (query ? 1 : 0);
  const clearAll = () => {
    setStatus("");
    setType("");
    setCompany("");
    setQuery("");
    setPage(1);
  };

  const submitted = budgets.filter((b) => b.status === "Submitted");

  // ------------------------------------------------------------- transitions

  const run = async (
    row: BudgetRow,
    action: BudgetAction,
    classification?: { category_id: string | null; partner_id: string | null }
  ) => {
    setBusy(true);
    const result = await transitionBudget(row.id, action, classification);
    setBusy(false);
    if (result.ok) {
      setConfirm(null);
      setApproving(null);
      setApproveErrors({});
      toast(result.message, `${row.budget_no} · ${row.description}`, "ok");
      router.refresh();
      return;
    }
    if (action === "approve") {
      setApproveErrors(result.errors);
      return;
    }
    setConfirm(null);
    toast(
      "Tidak dapat diproses",
      result.errors._form ?? Object.values(result.errors)[0],
      "err"
    );
  };

  const openAction = (row: BudgetRow, action: BudgetAction) => {
    setMenuFor(null);
    if (action === "approve") {
      setApproveErrors({});
      setApproving(row);
    } else {
      setConfirm({ row, action });
    }
  };

  // ------------------------------------------------------------------ render

  const newHref = month
    ? `/budget/budget/new?month=${month.id}`
    : "/budget/budget/new";
  const backHref = month ? `/budget/budget/month/${month.id}` : "/budget/budget/month/all";

  const sortHead = (field: string, label: string, extra?: string, width?: number) => (
    <th
      className={`srt${sort.field === field ? " act" : ""}${extra ? ` ${extra}` : ""}`}
      style={width ? { width } : undefined}
      onClick={() =>
        setSort((s) =>
          s.field === field
            ? { field, dir: s.dir === "asc" ? "desc" : "asc" }
            : { field, dir: "asc" }
        )
      }
      title={`Urutkan ${label}`}
    >
      {label}
      <span className="ar">
        {sort.field === field ? (sort.dir === "asc" ? "▲" : "▼") : "▲"}
      </span>
    </th>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <Link href="/dashboard">Budget</Link>
          <span>/</span>
          <Link href="/budget/budget">Budget Month</Link>
          <span>/</span>
          <span className="cur">{month ? month.name : "Semua Bulan"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            {month ? month.name : "Semua Bulan"}
            {month && <span className="lab lg">{month.label}</span>}
          </h1>
          <div className="ph-act">
            <button className="btn" onClick={() => setShowReport(true)}>
              <Icon name="print" size={15} /> Laporan Pengajuan
              {submitted.length > 0 && (
                <span className="bdg s-info" style={{ marginLeft: 2 }}>
                  {submitted.length}
                </span>
              )}
            </button>
            {can.create && (
              <Link className="btn primary" href={newHref}>
                <Icon name="plus" size={15} /> Tambah Budget
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Layer planning. Budget menyediakan rencana nominal dan klasifikasi
          bisnis; realisasinya terjadi di modul Finance.
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
              ? formatMoney(cash.byCurrency[0].balance, cash.byCurrency[0].currencyLabel)
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
            setStatus("Submitted");
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
            <span className="l">Belum Disetujui</span>
          </div>
          <div className="v">{summary.notApproved}</div>
          <div className="d">
            {formatTotals(summary.notApprovedTotals)} · {summary.draft} draft,{" "}
            {summary.submitted} diajukan
          </div>
        </button>

        <button
          className="kpi"
          onClick={() => {
            setStatus("Open");
            setPage(1);
          }}
          style={{ textAlign: "left", font: "inherit" }}
        >
          <div className="h">
            <span
              className="i"
              style={{ background: "var(--info-bg)", color: "var(--info)" }}
            >
              <Icon name="send" size={14} />
            </span>
            <span className="l">Belum Direalisasi</span>
          </div>
          <div className="v">{summary.unrealized}</div>
          <div className="d">
            {formatTotals(summary.unrealizedTotals)} sisa dari budget disetujui
          </div>
        </button>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className={`srch${query ? " has" : ""}`}>
            <Icon name="srch" size={14} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Cari nomor atau deskripsi budget…"
              autoComplete="off"
            />
            <button className="x" onClick={() => setQuery("")} aria-label="Bersihkan">
              <Icon name="block" size={13} />
            </button>
          </div>

          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            ariaLabel="Filter status"
            options={[
              { value: "", label: "Status: semua" },
              ...["Draft", "Submitted", "Rejected", "Open", "Closed", "Cancelled"].map(
                (s) => ({ value: s, label: STATUS_TEXT[s] ?? s })
              ),
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
            ariaLabel="Filter tipe"
            options={[
              { value: "", label: "Tipe: semua" },
              { value: "In", label: "Penerimaan" },
              { value: "Out", label: "Pengeluaran" },
            ]}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
          />

          <Select
            variant="toolbar"
            value={company}
            set={Boolean(company)}
            ariaLabel="Filter Company"
            options={[
              { value: "", label: "Company: semua" },
              ...refs.companies.map((c) => ({
                value: String(c.id),
                label: c.label,
                hint: c.name,
              })),
            ]}
            onChange={(v) => {
              setCompany(v);
              setPage(1);
            }}
          />

          {month && (
            <span className="mchip">
              <Icon name="cal" size={12} /> {month.name}
              <Link href="/budget/budget/month/all" title="Tampilkan semua bulan">
                <Icon name="block" size={11} />
              </Link>
            </span>
          )}

          {activeFilters > 0 && (
            <button className="btn sm ghost" onClick={clearAll}>
              Bersihkan filter ({activeFilters})
            </button>
          )}

          <div className="tspace" />
          <span className="count">
            <b>{filtered.length}</b> dari {budgets.length} budget
          </span>
        </div>

        {filtered.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 38 }}>No</th>
                    {sortHead("budget_no", "Nomor", undefined, 100)}
                    {sortHead("budget_date", "Tanggal", undefined, 104)}
                    {sortHead("description", "Deskripsi / Company")}
                    {sortHead("category_id", "Category", undefined, 116)}
                    {sortHead("budget_amount", "Nominal / Realisasi", "num", 170)}
                    {sortHead("status", "Status", undefined, 104)}
                    <th style={{ width: 88 }} />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((b, i) => {
                    const category = categoryOf(b.category_id);
                    const currency = currencyOf(b.currency_id);
                    const inn = b.budget_type === "In";
                    const over = b.realized_amount > b.budget_amount;
                    const actions = availableActions(b.status, can);
                    return (
                      <tr
                        key={b.id}
                        onClick={() => router.push(`/budget/budget/${b.id}`)}
                      >
                        <td className="no">{from + i + 1}</td>
                        <td>
                          <Link href={`/budget/budget/${b.id}`}>
                            <span className="lab">{b.budget_no}</span>
                          </Link>
                        </td>
                        <td>{formatDate(b.budget_date)}</td>
                        <td className="pri">
                          <Link href={`/budget/budget/${b.id}`}>
                            <span className="dstack">
                              <span className="d1">{b.description}</span>
                              <span className="d2">
                                {companyOf(b.company_id)?.label ?? "—"}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td>
                          {category ? (
                            <span className="lab">{category.label}</span>
                          ) : (
                            <span className="dash">—</span>
                          )}
                        </td>
                        <td className="num">
                          <span className="mstack">
                            <span
                              className={`mny ${inn ? "in" : "out"}`}
                              title={BUDGET_TYPE_TEXT[b.budget_type]}
                            >
                              {inn ? "+ " : "− "}
                              {formatMoney(b.budget_amount, currency)}
                            </span>
                            <span
                              className={`rz${b.realized_amount ? "" : " z"}${over ? " warnrz" : ""}`}
                            >
                              real. {formatMoney(b.realized_amount, currency)}
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className={`bdg ${STATUS_CLASS[b.status] ?? "s-mute"}`}>
                            {STATUS_TEXT[b.status] ?? b.status}
                          </span>
                        </td>
                        <td className="acts">
                          <span className="ract">
                            <Link
                              className="iact"
                              href={`/budget/budget/${b.id}`}
                              title="Lihat detail"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Icon name="eye" size={15} />
                            </Link>
                            {can.edit && budgetIsEditable(b.status) ? (
                              <Link
                                className="iact"
                                href={`/budget/budget/${b.id}/edit`}
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
                                  setMenuFor({ row: b, x: r.right - 200, y: r.bottom + 5 });
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
              <Icon name={budgets.length ? "srch" : "clip"} size={20} />
            </div>
            <h4>
              {budgets.length
                ? "Tidak ada budget yang cocok"
                : month
                  ? `Belum ada budget di ${month.name}`
                  : "Belum ada budget"}
            </h4>
            <p>
              {budgets.length
                ? "Ubah kata kunci atau bersihkan filter yang sedang aktif."
                : "Budget yang dibuat akan dikelompokkan otomatis ke bulan sesuai Tanggal Budget."}
            </p>
            <div className="cta">
              {budgets.length ? (
                <button className="btn" onClick={clearAll}>
                  Bersihkan filter
                </button>
              ) : (
                can.create && (
                  <Link className="btn primary" href={newHref}>
                    <Icon name="plus" size={15} /> Tambah Budget
                  </Link>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {menuFor && (
        <RowMenu
          row={menuFor.row}
          x={menuFor.x}
          y={menuFor.y}
          can={can}
          onPick={(action) => openAction(menuFor.row, action)}
          onClose={() => setMenuFor(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          open
          icon={BUDGET_TRANSITIONS[confirm.action].icon}
          tone={BUDGET_TRANSITIONS[confirm.action].danger ? "danger" : "brand"}
          title={BUDGET_TRANSITIONS[confirm.action].title}
          subject={`${confirm.row.budget_no} – ${confirm.row.description}`}
          body={BUDGET_TRANSITIONS[confirm.action].body}
          confirmLabel={BUDGET_TRANSITIONS[confirm.action].confirmLabel}
          confirmTone={
            BUDGET_TRANSITIONS[confirm.action].danger ? "solid-danger" : "primary"
          }
          busy={busy}
          onConfirm={() => run(confirm.row, confirm.action)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {approving && (
        <ApproveDialog
          budget={approving}
          refs={refs}
          mappings={mappings}
          errors={approveErrors}
          busy={busy}
          onConfirm={(categoryId, partnerId) =>
            run(approving, "approve", {
              category_id: categoryId,
              partner_id: partnerId,
            })
          }
          onCancel={() => {
            setApproving(null);
            setApproveErrors({});
          }}
        />
      )}

      {showCash && (
        <CashBalanceDialog cash={cash} onClose={() => setShowCash(false)} />
      )}

      {showReport && (
        <ReportPicker
          budgets={submitted}
          refs={refs}
          cash={cash}
          periodName={month?.name ?? null}
          onClose={() => setShowReport(false)}
        />
      )}

      {/* Keeps `backHref` meaningful for screen readers on the empty state. */}
      <p className="foot-note">
        Budget dikelompokkan ke bulan berdasarkan Tanggal Budget.{" "}
        <Link href={backHref}>Lihat bulan ini</Link> atau{" "}
        <Link href="/budget/budget">kembali ke daftar bulan</Link>.
      </p>
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
  row: BudgetRow;
  x: number;
  y: number;
  can: BudgetAbilities;
  onPick: (action: BudgetAction) => void;
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
    // `capture` so the click that opened another row's menu still closes this.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const actions = availableActions(row.status, can);

  return (
    <div className="menu" ref={ref} style={{ left: Math.max(8, x), top: y }}>
      <div className="hd">
        <b>{row.budget_no}</b>
        <span>{STATUS_TEXT[row.status] ?? row.status}</span>
      </div>
      <div className="dv" />
      {actions.map((a) => {
        const t = BUDGET_TRANSITIONS[a];
        return (
          <button
            key={a}
            className={t.danger ? "dg" : undefined}
            onClick={() => onPick(a)}
          >
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}
