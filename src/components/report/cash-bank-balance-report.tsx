import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import type { BalanceReport } from "@/lib/siba/cash-bank";
import { reportHref } from "@/lib/siba/reports";

/**
 * Saldo Kas & Bank — opening, movement and closing for every resource.
 *
 * One section per currency, each totalled on its own. Currencies are never
 * added together: there is no exchange rate in this system, so a single
 * combined figure would be invented rather than reported (CLAUDE.md §12).
 *
 * Every row drills through to that resource's `Buku Kas & Bank` for the same
 * period — a summary figure should always be one click from the rows that
 * produced it, which is what makes a summary checkable rather than merely
 * believable.
 */
export function CashBankBalanceReport({ report }: { report: BalanceReport }) {
  if (!report.groups.length) {
    return (
      <div className="empty" style={{ padding: "34px 20px" }}>
        <div className="ic">
          <Icon name="wallet" size={20} />
        </div>
        <h4>Belum ada resource kas atau bank</h4>
        <p>
          Laporan ini merangkum buku setiap resource. Daftarkan Cash &amp; Bank
          di modul Master terlebih dahulu.
        </p>
      </div>
    );
  }

  return (
    <>
      {report.groups.map((g) => {
        const money = (n: number) => formatMoney(n, g.currencyLabel);
        return (
          <div className="cblock" key={g.currencyId} style={{ marginTop: 14 }}>
            <div className="cbh">
              <b>
                {g.currencyLabel === "IDR"
                  ? "Rupiah (IDR)"
                  : g.currencyLabel}
              </b>
              <span className="cbn">
                {g.rows.length} resource
              </span>
              <span className="cbo2">
                {formatDate(report.range.from)} – {formatDate(report.range.to)}
              </span>
            </div>

            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 38 }}>No</th>
                    <th>Resource</th>
                    <th style={{ width: 84 }}>Tipe</th>
                    <th style={{ width: 92 }}>Company</th>
                    <th className="num" style={{ width: 140 }}>
                      Saldo Awal
                    </th>
                    <th className="num" style={{ width: 140 }}>
                      Penerimaan
                    </th>
                    <th className="num" style={{ width: 140 }}>
                      Pengeluaran
                    </th>
                    <th className="num" style={{ width: 150 }}>
                      Saldo Akhir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr key={r.cashBankId} style={{ cursor: "default" }}>
                      <td className="no">{i + 1}</td>
                      <td className="pri">
                        <Link
                          href={reportHref("cash-bank-ledger", {
                            cashBank: r.cashBankId,
                            from: report.range.from,
                            to: report.range.to,
                          })}
                          title="Buka Buku Kas & Bank untuk periode ini"
                        >
                          <span className="idc">
                            <span className="lab">{r.label}</span>
                            <span className="nm">{r.name}</span>
                          </span>
                        </Link>
                        {!r.active && (
                          <span className="bdg s-bad" style={{ marginLeft: 6 }}>
                            Non Aktif
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`bdg ${r.type === "Bank" ? "t-info" : "t-vio"}`}
                        >
                          {r.type}
                        </span>
                      </td>
                      <td className="mono mut" style={{ fontSize: "11px" }}>
                        {r.companyLabel}
                      </td>
                      <td className="num">
                        <span className={`mny${r.opening ? "" : " z"}`}>
                          {money(r.opening)}
                        </span>
                      </td>
                      <td className="num">
                        <span className={`mny${r.totalIn ? " in" : " z"}`}>
                          {money(r.totalIn)}
                        </span>
                      </td>
                      <td className="num">
                        <span className={`mny${r.totalOut ? "" : " z"}`}>
                          {money(r.totalOut)}
                        </span>
                      </td>
                      <td className="num">
                        <span className={`mny${r.closing ? "" : " z"}`}>
                          {money(r.closing)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="totrow">
                    <td colSpan={4} style={{ textAlign: "right" }}>
                      Total {g.currencyLabel}
                    </td>
                    <td className="num">
                      <span className="mny">{money(g.opening)}</span>
                    </td>
                    <td className="num">
                      <span className="mny in">{money(g.totalIn)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(g.totalOut)}</span>
                    </td>
                    <td className="num">
                      <span className="mny big">{money(g.closing)}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}
