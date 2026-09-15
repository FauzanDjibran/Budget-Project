"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { SearchField } from "@/components/ui/search-field";
import { formatDate } from "@/lib/format";
import type { BudgetMonth } from "@/lib/siba/budget";

/**
 * Budget Month — the module's first page.
 *
 * A month is a Fiscal Period and nothing else: it has no table, no status of
 * its own, and no lifecycle. Every number in this table is rolled up live from
 * the budgets whose `budget_date` falls inside the period, which is why a
 * budget changes month simply by having its date changed.
 *
 * Periods with no budgets are listed too — the month you have planned nothing
 * for is the one worth noticing.
 *
 * The table says what a container can say: when the month runs, and how many
 * budgets are in it. Amounts and statuses belong to the budgets and are read
 * inside the month, where they can be acted on.
 */
export function BudgetMonthList({ months }: { months: BudgetMonth[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return months;
    return months.filter((m) =>
      `${m.label} ${m.name}`.toLowerCase().includes(q)
    );
  }, [months, query]);

  const withData = rows.filter((m) => m.count > 0).length;

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <Link href="/dashboard">Budget</Link>
          <span>/</span>
          <span className="cur">Budget Month</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            Budget
          </h1>
          <div className="ph-act">
            <Link className="btn" href="/budget/budget/month/all">
              <Icon name="layers" size={15} /> Semua Bulan
            </Link>
          </div>
        </div>
        <p className="ph-sub">
          Perencanaan kebutuhan dana. Pilih bulan untuk membuka daftar Budget di
          dalamnya.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Cari periode…"
          />
          <div className="tspace" />
          <span className="count">
            <b>{withData}</b> bulan berisi budget
          </span>
        </div>

        {rows.length ? (
          <div className="tw">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 38 }}>No</th>
                  <th style={{ width: 104 }}>Bulan</th>
                  <th>Nama Period</th>
                  <th style={{ width: 196 }}>Rentang Tanggal</th>
                  <th className="num" style={{ width: 96 }}>
                    Budget
                  </th>
                  <th style={{ width: 96 }}>Period</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((m, i) => (
                  <MonthRow
                    key={m.periodId}
                    month={m}
                    index={i + 1}
                    onOpen={() => router.push(`/budget/budget/month/${m.periodId}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name="srch" size={20} />
            </div>
            <h4>Tidak ada periode yang cocok</h4>
            <p>Ubah kata kunci pencarian untuk menemukan bulan yang dicari.</p>
          </div>
        )}
      </div>

      <p className="foot-note">
        Bulan mengikuti Fiscal Period dan tidak memiliki data tersendiri — hanya
        mengelompokkan Budget berdasarkan Tanggal Budget.
      </p>
    </>
  );
}

function MonthRow({
  month,
  index,
  onOpen,
}: {
  month: BudgetMonth;
  index: number;
  /** The whole row opens the month — the chevron is a hint, not the only way. */
  onOpen: () => void;
}) {
  const href = `/budget/budget/month/${month.periodId}`;
  return (
    <tr className={month.current ? "nowrow" : undefined} onClick={onOpen}>
      <td className="no">{index}</td>
      <td>
        <Link href={href}>
          <span className="lab">{month.label}</span>
        </Link>
      </td>
      <td className="pri">
        <Link href={href}>{month.name}</Link>
        {month.current && (
          <>
            {" "}
            <span className="bdg t-acc">Bulan Berjalan</span>
          </>
        )}
      </td>
      <td className="mono mut" style={{ fontSize: "11.5px" }}>
        {formatDate(month.startDate)} – {formatDate(month.endDate)}
      </td>
      <td className="num">
        {month.count || <span className="dash">0</span>}
      </td>
      <td>
        <span className={`bdg ${PERIOD_CLASS[month.status] ?? "s-mute"}`}>
          {month.status}
        </span>
      </td>
      <td style={{ textAlign: "right", paddingRight: 9 }}>
        <Link className="iact" href={href} aria-label={`Buka ${month.name}`}>
          <Icon name="chev" size={15} />
        </Link>
      </td>
    </tr>
  );
}

const PERIOD_CLASS: Record<string, string> = {
  Draft: "s-warn",
  Open: "s-ok",
  Closed: "s-mute",
};
