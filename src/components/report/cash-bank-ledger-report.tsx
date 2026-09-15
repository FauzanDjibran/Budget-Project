import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import type { LedgerReport } from "@/lib/siba/cash-bank";

/**
 * Buku Kas & Bank — every movement of one resource across a period.
 *
 * Read the way a book is read: oldest first, opening balance carried in at the
 * top, closing balance struck at the bottom, and a running balance in the last
 * column that the rows above it actually produce.
 *
 * The recap strip states the report's own arithmetic — opening + masuk − keluar
 * = saldo akhir — so the figures can be checked without leaving the page. That
 * is also why **there is no entry-type filter**: dropping `Penyesuaian` rows
 * would leave a page whose totals no longer add up, which is worse than a page
 * with a column to scan.
 */
const TYPE_TEXT: Record<string, string> = {
  Opening: "Saldo Awal",
  Transaction: "Transaksi",
  Adjustment: "Penyesuaian",
};

const TYPE_CLASS: Record<string, string> = {
  Opening: "t-slate",
  Transaction: "t-info",
  Adjustment: "t-vio",
};

export function CashBankLedgerReport({ report }: { report: LedgerReport }) {
  const cur = report.resource.currencyLabel;
  const money = (n: number) => formatMoney(n, cur);

  return (
    <>
      <div className="rp-sec">Ringkasan Periode</div>
      <table className="rcp">
        <thead>
          <tr>
            <th>Resource</th>
            <th className="num">Saldo Awal</th>
            <th className="num">
              Penerimaan<span>Masuk</span>
            </th>
            <th className="num">
              Pengeluaran<span>Keluar</span>
            </th>
            <th className="num">Saldo Akhir</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="lb">
              {report.resource.label} — {report.resource.name}
            </td>
            <td className="num">{money(report.opening)}</td>
            <td className={`num${report.totalIn ? " pos" : " z"}`}>
              {money(report.totalIn)}
            </td>
            <td className={`num${report.totalOut ? " neg" : " z"}`}>
              {money(report.totalOut)}
            </td>
            <td className="num tot">{money(report.closing)}</td>
          </tr>
        </tbody>
      </table>

      {!report.reconciles && (
        <div className="nbox warn slim" style={{ marginTop: 10 }}>
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

      <div className="rp-sec">Mutasi</div>
      <div className="tw">
        <table className="grid">
          <thead>
            <tr>
              <th style={{ width: 38 }}>No</th>
              <th style={{ width: 104 }}>Nomor Entri</th>
              <th style={{ width: 104 }}>Tanggal</th>
              <th style={{ width: 108 }}>Jenis</th>
              <th style={{ width: 110 }}>Referensi</th>
              <th>Keterangan</th>
              <th className="num" style={{ width: 132 }}>
                Masuk
              </th>
              <th className="num" style={{ width: 132 }}>
                Keluar
              </th>
              <th className="num" style={{ width: 140 }}>
                Saldo
              </th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ cursor: "default" }}>
              <td className="no" />
              <td colSpan={5} className="mut">
                Saldo awal per {formatDate(report.range.from)}
              </td>
              <td className="num">
                <span className="dash">–</span>
              </td>
              <td className="num">
                <span className="dash">–</span>
              </td>
              <td className="num">
                <span className={`mny${report.opening ? "" : " z"}`}>
                  {money(report.opening)}
                </span>
              </td>
            </tr>

            {report.entries.map((e, i) => {
              const inn = e.direction === "In";
              return (
                <tr key={e.id} style={{ cursor: "default" }}>
                  <td className="no">{i + 1}</td>
                  <td>
                    <span className="lab">{e.entryNo}</span>
                  </td>
                  <td className="mono mut" style={{ fontSize: "11.5px" }}>
                    {formatDate(e.date)}
                  </td>
                  <td>
                    <span className={`bdg ${TYPE_CLASS[e.type] ?? "t-slate"}`}>
                      {TYPE_TEXT[e.type] ?? e.type}
                    </span>
                  </td>
                  <td>
                    {e.sourceDocNo && e.sourceDocTable === "fin_cash_bank_transaction" ? (
                      <Link href={`/finance/cash-bank-transaction/${e.sourceDocId}`}>
                        <span className="lab">{e.sourceDocNo}</span>
                      </Link>
                    ) : (
                      <span className="dash">—</span>
                    )}
                  </td>
                  <td className="mut wrapok">
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
          </tbody>
          <tfoot>
            <tr className="totrow">
              <td colSpan={6} style={{ textAlign: "right" }}>
                Saldo akhir per {formatDate(report.range.to)}
              </td>
              <td className="num">
                <span className="mny in">{money(report.totalIn)}</span>
              </td>
              <td className="num">
                <span className="mny">{money(report.totalOut)}</span>
              </td>
              <td className="num">
                <span className="mny big">{money(report.closing)}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {report.entries.length === 0 && (
        // Not an empty state: no movement is a real answer, and the opening and
        // closing figures above are the report. This only says so in words.
        <div className="cbnone" style={{ marginTop: 10, borderRadius: "var(--r)" }}>
          Tidak ada mutasi pada rentang tanggal ini. Saldo akhir sama dengan
          saldo awal.
        </div>
      )}
    </>
  );
}
