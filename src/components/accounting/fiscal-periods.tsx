import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate } from "@/lib/format";
import type { FiscalPeriodRow } from "@/lib/siba/fiscal";
import {
  periodAction,
  type FiscalPeriodAbilities,
  type FiscalPeriodStatus,
  type FiscalYearStatus,
} from "@/lib/siba/fiscal-workflow";
import { FiscalPeriodActionButton } from "./fiscal-period-action";

/**
 * A Fiscal Year's twelve months, shown inside the year that owns them.
 *
 * Fiscal Period has no menu and no form: a calendar month is not something
 * anyone should be able to mistype, so the periods are generated when the year
 * is opened and only read here. Inside an Open year each one is locked and
 * unlocked from its own row; a Locked period refuses postings dated in it. Each
 * row links to its Budget Month.
 */
const STATUS_CLASS: Record<string, string> = {
  Open: "s-ok",
  Locked: "s-warn",
  Closed: "s-mute",
};

const STATUS_TEXT: Record<string, string> = {
  Open: "Open",
  Locked: "Terkunci",
  Closed: "Closed",
};

export function FiscalPeriods({
  periods,
  yearLabel,
  yearStatus,
  can,
}: {
  periods: FiscalPeriodRow[];
  yearLabel: string;
  yearStatus: string;
  can: FiscalPeriodAbilities;
}) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci t-info">
          <Icon name="clock" size={15} />
        </span>
        <div className="ct">
          <h3>Fiscal Period</h3>
          <p>
            {periods.length
              ? `${periods.length} periode bulanan dalam tahun buku ${yearLabel}`
              : `Belum ada periode untuk tahun buku ${yearLabel}`}
          </p>
        </div>
      </div>

      {periods.length ? (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 38 }}>No</th>
                <th style={{ width: 104 }}>Period</th>
                <th>Nama Period</th>
                <th style={{ width: 196 }}>Rentang Tanggal</th>
                <th className="num" style={{ width: 88 }}>
                  Budget
                </th>
                <th style={{ width: 96 }}>Status</th>
                <th style={{ width: 128 }} />
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => {
                const action = periodAction(
                  yearStatus as FiscalYearStatus,
                  p.status as FiscalPeriodStatus,
                  can
                );
                return (
                <tr key={p.id} style={{ cursor: "default" }}>
                  <td className="no">{p.sequence}</td>
                  <td>
                    <span className="lab">{p.label}</span>
                  </td>
                  <td className="pri">{p.name}</td>
                  <td className="mono mut" style={{ fontSize: "11.5px" }}>
                    {formatDate(p.startDate)} – {formatDate(p.endDate)}
                  </td>
                  <td className="num">
                    {p.budgets || <span className="dash">0</span>}
                  </td>
                  <td>
                    <span className={`bdg ${STATUS_CLASS[p.status] ?? "s-mute"}`}>
                      {STATUS_TEXT[p.status] ?? p.status}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {action && (
                      <FiscalPeriodActionButton
                        periodId={p.id}
                        subject={p.name}
                        action={action}
                      />
                    )}
                  </td>
                  <td style={{ textAlign: "right", paddingRight: 9 }}>
                    <Link
                      className="iact"
                      href={`/budget/budget/month/${p.id}`}
                      aria-label={`Buka Budget ${p.name}`}
                      title="Buka Budget Month"
                    >
                      <Icon name="chev" size={15} />
                    </Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty sm">
          <div className="ic">
            <Icon name="clock" size={20} />
          </div>
          <h4>Belum ada Fiscal Period</h4>
          <p>
            {yearStatus === "Open"
              ? "Tahun buku ini sudah Open tetapi belum memiliki periode."
              : "Tekan Aktifkan Tahun Buku di bagian atas halaman. 12 periode bulanan — Januari sampai Desember — dibuat otomatis saat itu juga."}
          </p>
        </div>
      )}

      <p className="foot-note" style={{ padding: "0 16px 14px" }}>
        Periode terkunci menolak posting bertanggal di dalamnya; tahun buku
        hanya dapat ditutup setelah seluruh periodenya terkunci.
      </p>
    </div>
  );
}
