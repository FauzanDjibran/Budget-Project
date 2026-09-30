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
import { QueueTabs } from "@/components/ui/queue-tabs";
import { SelectAll, SelectionCount, useSelection } from "@/components/ui/selection";
import { useToast } from "@/components/ui/toast";
import { transitionBudgets } from "@/app/actions/budget";
import { formatDate, formatMoney, formatTotals, sumByCurrency } from "@/lib/format";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type { BudgetRefs, BudgetRow, BudgetSummary } from "@/lib/siba/budget";
import type { CashBookSummary } from "@/lib/siba/cash-bank";
import {
  BUDGET_TRANSITIONS,
  BUDGET_TYPE_TEXT,
  availableActions,
  budgetIsEditable,
  commonActions,
  type BudgetAbilities,
  type BudgetAction,
} from "@/lib/siba/budget-workflow";
import {
  headerButtonClass,
  menuButtonClass,
  orderForHeader,
} from "@/lib/siba/header-actions";
import { CashBalanceDialog } from "./cash-balance-dialog";
import { ReportPicker } from "./report-picker";

/**
 * Pengajuan Budget — the Budget register, and where a plan is made, submitted,
 * approved or rejected.
 *
 * The tabs are statuses. Inside one tab every row allows the same transitions,
 * so ticking rows and pressing one header button moves them all — the bulk
 * action this screen exists for. A bulk action is all-or-nothing: if one row
 * is refused, none is moved and the refusal names it.
 *
 * Classification is not done here. An approved Budget waits in Klasifikasi
 * Budget, a separate workstation for whoever assigns Category and Partner.
 *
 * `can` mirrors the caller's permissions so only usable actions are offered.
 * It is presentation: `transitionBudgets` re-checks both the permission and
 * whether every row may take the transition.
 */

/** The tabs, in lifecycle order. `""` is every status. */
const TABS: { value: string; label: string }[] = [
  { value: "Draft", label: "Draft" },
  { value: "Submitted", label: "Diajukan" },
  { value: "Approved", label: "Disetujui" },
  { value: "Open", label: "Open" },
  { value: "", label: "Semua" },
];

export function BudgetList({
  budgets,
  refs,
  months,
  summary,
  cash,
  month,
  can,
  initialStatus,
}: {
  budgets: BudgetRow[];
  refs: BudgetRefs;
  /** Every Budget Month, for the month filter. */
  months: { id: number; label: string; name: string }[];
  summary: BudgetSummary;
  cash: CashBookSummary;
  /** null when the page is showing every month at once. */
  month: { id: number; label: string; name: string } | null;
  can: BudgetAbilities;
  /** Tab the page was opened on, from `?status=` — see the route. */
  initialStatus?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  // Classification is Klasifikasi Budget's work, never this register's —
  // an approved row here offers nothing to whoever may classify it.
  const listCan = useMemo(() => ({ ...can, classify: false }), [can]);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(
    TABS.some((t) => t.value === initialStatus) ? initialStatus! : ""
  );
  const [type, setType] = useState("");
  const [company, setCompany] = useState("");
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" }>({
    field: "budget_date",
    dir: "desc",
  });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const [menuFor, setMenuFor] = useState<{ row: BudgetRow; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<{ ids: number[]; action: BudgetAction } | null>(null);
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

  // Every filter but the tab, so each tab's count answers "how many here,
  // given what I have narrowed to" rather than a number the list never shows.
  const narrowed = useMemo(() => {
    let out = budgets;
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
    return out;
  }, [budgets, type, company, query, companyOf, categoryOf]);

  const filtered = useMemo(() => {
    const out = status ? narrowed.filter((b) => b.status === status) : narrowed.slice();
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
  }, [narrowed, status, sort, categoryOf]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pages);
  const from = (current - 1) * perPage;
  const pageRows = filtered.slice(from, from + perPage);

  const tabs = TABS.map((t) => ({
    ...t,
    count: t.value ? narrowed.filter((b) => b.status === t.value).length : narrowed.length,
  }));

  const activeFilters = (type ? 1 : 0) + (company ? 1 : 0) + (query ? 1 : 0);
  const clearAll = () => {
    setType("");
    setCompany("");
    setQuery("");
    setPage(1);
  };

  const submitted = budgets.filter((b) => b.status === "Submitted");

  // ---------------------------------------------------------------- selection

  // A row is selectable only when this user may move it somehow; a row that
  // offers nothing keeps an empty checkbox cell.
  const actionable = (b: BudgetRow) => availableActions(b.status, listCan).length > 0;
  const selectable = useMemo(
    () => filtered.filter(actionable).map((b) => b.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, listCan]
  );
  const selection = useSelection(selectable);
  const pageSelectable = pageRows.filter(actionable).map((b) => b.id);

  const selected = useMemo(() => {
    const ids = new Set(selection.ids);
    return budgets.filter((b) => ids.has(b.id));
  }, [budgets, selection.ids]);
  const bulk = commonActions(
    selected.map((b) => b.status),
    listCan
  );

  // ------------------------------------------------------------- transitions

  const run = async (ids: number[], action: BudgetAction) => {
    setBusy(true);
    const result = await transitionBudgets(ids, action);
    setBusy(false);
    setConfirm(null);
    if (result.ok) {
      const one = budgets.find((b) => b.id === ids[0]);
      toast(
        result.message,
        result.count === 1 && one
          ? `${one.budget_no} · ${one.description}`
          : `${result.count} Budget`,
        "ok"
      );
      selection.clear();
      router.refresh();
      return;
    }
    toast(
      "Tidak dapat diproses",
      result.errors._form ?? Object.values(result.errors)[0],
      "err"
    );
  };

  const openAction = (row: BudgetRow, action: BudgetAction) => {
    setMenuFor(null);
    setConfirm({ ids: [row.id], action });
  };

  const confirmSubject = (ids: number[]) => {
    const rows = budgets.filter((b) => ids.includes(b.id));
    if (rows.length === 1) return `${rows[0].budget_no} – ${rows[0].description}`;
    const totals = sumByCurrency(
      rows.map((b) => ({
        currencyId: b.currency_id,
        currencyLabel: currencyOf(b.currency_id),
        amount: b.budget_amount,
      }))
    );
    return `${rows.length} Budget · ${formatTotals(totals)}`;
  };

  // ------------------------------------------------------------------ render

  const newHref = month
    ? `/budget/budget/new?month=${month.id}`
    : "/budget/budget/new";

  const goMonth = (id: string) => {
    const tab = status ? `?status=${status}` : "";
    router.push(id ? `/budget/budget/month/${id}${tab}` : `/budget/budget${tab}`);
  };

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
      <DocumentHeader
        module="Budget"
        icon="clip"
        title="Pengajuan Budget"
        tags={month && <span className="lab lg">{month.name}</span>}
        sub="Layer planning. Budget menyediakan rencana nominal; klasifikasinya ditetapkan di Klasifikasi Budget dan realisasinya terjadi di modul Finance."
      >
        {selection.ids.length > 0 ? (
          <>
            <SelectionCount count={selection.ids.length} onClear={selection.clear} />
            {bulk.length ? (
              orderForHeader(bulk, (a) => BUDGET_TRANSITIONS[a].tone).map((a) => {
                const t = BUDGET_TRANSITIONS[a];
                return (
                  <button
                    key={a}
                    className={headerButtonClass(t.tone)}
                    disabled={busy}
                    onClick={() => setConfirm({ ids: selection.ids, action: a })}
                  >
                    <Icon name={t.icon} size={15} /> {t.label}
                  </button>
                );
              })
            ) : (
              <span className="lockchip">
                <Icon name="lock" size={13} /> Tidak ada aksi yang berlaku untuk semua pilihan
              </span>
            )}
          </>
        ) : (
          <>
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
          </>
        )}
      </DocumentHeader>

      <div className="kpis bud">
        <button
          className="kpi wide"
          onClick={() => setShowCash(true)}
          style={{ textAlign: "left", font: "inherit" }}
        >
          <div className="h">
            <span className="i t-ok">
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
            <span className="i t-warn">
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
            <span className="i t-info">
              <Icon name="send" size={14} />
            </span>
            <span className="l">Belum Direalisasi</span>
          </div>
          <div className="v">{summary.unrealized}</div>
          <div className="d">
            {formatTotals(summary.unrealizedTotals)} sisa dari budget terklasifikasi
          </div>
        </button>
      </div>

      <div className="card">
        <QueueTabs
          tabs={tabs}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />

        <div className="toolbar">
          <SearchField
            value={query}
            placeholder="Cari nomor atau deskripsi budget…"
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
          />

          <Select
            variant="toolbar"
            value={month ? String(month.id) : ""}
            set={Boolean(month)}
            ariaLabel="Filter bulan"
            options={[
              { value: "", label: "Bulan: semua" },
              ...months.map((m) => ({
                value: String(m.id),
                label: m.name,
                hint: m.label,
              })),
            ]}
            onChange={goMonth}
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
                    <th className="selchk">
                      <SelectAll
                        many={pageSelectable}
                        has={selection.has}
                        onToggle={() => selection.toggleMany(pageSelectable)}
                      />
                    </th>
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
                    const actions = availableActions(b.status, listCan);
                    const on = selection.has(b.id);
                    return (
                      <tr
                        key={b.id}
                        className={on ? "sel" : undefined}
                        onClick={() => router.push(`/budget/budget/${b.id}`)}
                      >
                        <td className="selchk" onClick={(e) => e.stopPropagation()}>
                          {actions.length > 0 && (
                            <input
                              type="checkbox"
                              aria-label={`Pilih ${b.budget_no}`}
                              checked={on}
                              onChange={() => selection.toggle(b.id)}
                            />
                          )}
                        </td>
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
                                  setMenuFor({ row: b, x: r.right - 200, y: r.bottom + 5 });
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
              <Icon name={budgets.length ? "srch" : "clip"} size={20} />
            </div>
            <h4>
              {narrowed.length
                ? `Tidak ada budget berstatus ${TABS.find((t) => t.value === status)?.label ?? ""}`
                : budgets.length
                  ? "Tidak ada budget yang cocok"
                  : month
                    ? `Belum ada budget di ${month.name}`
                    : "Belum ada budget"}
            </h4>
            <p>
              {narrowed.length
                ? "Pilih tab lain untuk melihat budget pada status berbeda."
                : budgets.length
                  ? "Ubah kata kunci atau bersihkan filter yang sedang aktif."
                  : "Budget yang dibuat akan dikelompokkan otomatis ke bulan sesuai Tanggal Budget."}
            </p>
            <div className="cta">
              {narrowed.length ? null : budgets.length ? (
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
          can={listCan}
          onPick={(action) => openAction(menuFor.row, action)}
          onClose={() => setMenuFor(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          open
          icon={BUDGET_TRANSITIONS[confirm.action].icon}
          tone={BUDGET_TRANSITIONS[confirm.action].tone === "danger" ? "danger" : "brand"}
          title={BUDGET_TRANSITIONS[confirm.action].title}
          subject={confirmSubject(confirm.ids)}
          body={BUDGET_TRANSITIONS[confirm.action].body}
          confirmLabel={BUDGET_TRANSITIONS[confirm.action].confirmLabel}
          confirmTone={
            BUDGET_TRANSITIONS[confirm.action].tone === "danger" ? "solid-danger" : "primary"
          }
          busy={busy}
          onConfirm={() => run(confirm.ids, confirm.action)}
          onCancel={() => setConfirm(null)}
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

      <p className="foot-note">
        Centang beberapa budget pada satu tab untuk mengajukan, menyetujui, menolak atau
        membatalkannya sekaligus — semua diproses, atau tidak satu pun.
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
