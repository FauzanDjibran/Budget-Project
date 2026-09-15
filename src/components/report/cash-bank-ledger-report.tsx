import Link from "next/link";
import { Icon } from "@/components/icon";
import { ReportSummary } from "@/components/report/report-summary";
import { formatDate, formatMoney } from "@/lib/format";
import type { LedgerReport } from "@/lib/siba/cash-bank";

/**
 * Buku Kas & Bank — every movement of one resource across a period.
 *
 * Read the way a book is read: oldest first, opening balance carried in at the
 * top, closing balance struck at the bottom, and a running balance in the last
 * column that the rows above it actually produce.
 *
 * The block header states the report's own arithmetic — opening + masuk −
 * keluar = saldo akhir — as the same labelled strip the General Ledger uses, so
 * the two books read as one screen type. It replaces the separate recap table
 * that used to sit above the rows: a four-figure summary does not need a table
 * of its own, and that table was a second header competing with this one.
 *
 * That the totals must add up is also why **there is no entry-type filter**:
 * dropping `Penyesuaian` rows would leave a page whose figures no longer
 * reconcile, which is worse than a page with a marker to scan. The type is
 * shown where it is not the ordinary case — an opening entry or an adjustment
 * carries a badge, a plain transaction carries none.
 */
const TYPE_TEXT: Record<string, string> = {
  Opening: "Saldo Awal",
  Adjustment: "Penyesuaian",
};

const TYPE_CLASS: Record<string, string> = {
  Opening: "t-slate",
  Adjustment: "t-vio",
};

export function CashBankLedgerReport({ report }: { report: LedgerReport }) {
  const cur = report.resource.currencyLabel;
  const money = (n: number) => formatMoney(n, cur);

  return (
    <>
      <div className="cblock">
        <div className="cbh">
          <b>{report.resource.label}</b>
          <span className="cbn">
            {report.resource.name} · {report.resource.companyLabel} ·{" "}
            {report.entries.length} mutasi
          </span>
          <ReportSummary
            figures={[
              {
                label: "Saldo Awal",
                value: money(report.opening),
                zero: !report.opening,
              },
              {
                label: "Penerimaan",
                value: money(report.totalIn),
                zero: !report.totalIn,
              },
              {
                label: "Pengeluaran",
                value: money(report.totalOut),
                zero: !report.totalOut,
              },
              {
                label: "Saldo Akhir",
                value: money(report.closing),
                key: true,
                negative: report.closing < 0,
              },
            ]}
          />
        </div>

        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 92 }}>Tanggal</th>
                <th style={{ width: 116 }}>Entri</th>
                <th>Keterangan</th>
                <th className="num" style={{ width: 126 }}>
                  Masuk
                </th>
                <th className="num" style={{ width: 126 }}>
                  Keluar
                </th>
                <th className="num" style={{ width: 134 }}>
                  Saldo
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="totrow">
                <td colSpan={3}>
                  Saldo awal per {formatDate(report.range.from)}
                </td>
                <td className="num mut">—</td>
                <td className="num mut">—</td>
                <td className="num">{money(report.opening)}</td>
              </tr>

              {report.entries.map((e) => {
                const inn = e.direction === "In";
                const linked =
                  e.sourceDocNo &&
                  e.sourceDocTable === "fin_cash_bank_transaction";
                return (
                  <tr key={e.id} style={{ cursor: "default" }}>
                    <td className="mono mut" style={{ fontSize: "11.5px" }}>
                      {formatDate(e.date)}
                    </td>
                    <td>
                      <span className="lab">{e.entryNo}</span>
                      {linked && (
                        <Link
                          className="rsub"
                          href={`/finance/cash-bank-transaction/${e.sourceDocId}`}
                          title="Buka dokumen sumber"
                        >
                          {e.sourceDocNo}
                        </Link>
                      )}
                    </td>
                    <td className="pri wrapok">
                      {TYPE_TEXT[e.type] && (
                        <span
                          className={`bdg ${TYPE_CLASS[e.type]}`}
                          style={{ marginRight: 6 }}
                        >
                          {TYPE_TEXT[e.type]}
                        </span>
                      )}
                      {e.note ?? <span className="dash">—</span>}
                    </td>
                    <td className="num">
                      {inn ? (
                        <span className="mny in">{money(e.amount)}</span>
                      ) : (
                        <span className="dash">–</span>
                      )}
                    </td>
                    <td className="num">
                      {!inn ? (
                        <span className="mny">{money(e.amount)}</span>
                      ) : (
                        <span className="dash">–</span>
                      )}
                    </td>
                    <td className="num">
                      <span className={`mny${e.balanceAfter ? "" : " z"}`}>
                        {money(e.balanceAfter)}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {report.entries.length === 0 && (
                // Not an empty state: no movement is a real answer, and the
                // opening and closing figures are the report. This says so.
                <tr>
                  <td colSpan={6} className="mut" style={{ textAlign: "center" }}>
                    Tidak ada mutasi pada rentang tanggal ini. Saldo akhir sama
                    dengan saldo awal.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="totrow">
                <td colSpan={3}>
                  Saldo akhir per {formatDate(report.range.to)}
                </td>
                <td className="num">
                  <span className="mny in">{money(report.totalIn)}</span>
                </td>
                <td className="num">
                  <span className="mny">{money(report.totalOut)}</span>
                </td>
                <td className="num">
                  <b>{money(report.closing)}</b>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {!report.reconciles && (
        <div className="nbox warn slim">
          <span className="ni">
            <Icon name="warn" size={14} />
          </span>
          <div>
            <b>Saldo berjalan tidak cocok dengan jumlah mutasi.</b>
            <p>
              Saldo tersimpan pada entri terakhir berbeda dari hasil penjumlahan
              mutasi. Laporan tetap ditampilkan apa adanya; selisih ini perlu
              diperiksa sebelum angkanya dipakai.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
