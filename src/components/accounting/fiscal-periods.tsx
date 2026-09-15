import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate } from "@/lib/format";
import type { FiscalPeriodRow } from "@/lib/siba/fiscal";

/**
 * A Fiscal Year's twelve months, shown inside the year that owns them.
 *
 * Fiscal Period has no menu and no form: a calendar month is not something
 * anyone should be able to mistype, so the periods are generated when the year
 * is opened and only read here. Each row links to its Budget Month, which is
 * the one place a period is actually worked with.
 */
const STATUS_CLASS: Record<string, string> = {
  Draft: "s-warn",
  Open: "s-ok",
  Closed: "s-mute",
};

export function FiscalPeriods({
  periods,
  yearLabel,
  yearStatus,
}: {
  periods: FiscalPeriodRow[];
  yearLabel: string;
  yearStatus: string;
}) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci" style={{ background: "var(--info-bg)", color: "var(--info)" }}>
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
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
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
                      {p.status}
                    </span>
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
              ))}
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
        Periode dibuat otomatis dan tidak dapat ditambah, diubah, atau dihapus
        satu per satu. Satu periode selalu tepat satu bulan kalender.
      </p>
    </div>
  );
}
