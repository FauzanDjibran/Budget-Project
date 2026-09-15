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
 * The four figures are the columns, so this is the one report whose block
 * header carries no summary strip: the totals belong in the footer row, lined
 * up under the columns they total. A strip repeating them above would be the
 * same numbers twice.
 *
 * Type and Company travel under the resource name rather than in columns of
 * their own. Two fixed columns to print one short word each is exactly what
 * pushed the money columns off the right-hand edge.
 *
 * Every row drills through to that resource's `Buku Kas & Bank` for the same
 * period — a summary figure should always be one click from the rows that
 * produced it, which is what makes a summary checkable rather than merely
 * believable.
 */
export function CashBankBalanceReport({ report }: { report: BalanceReport }) {
  if (!report.groups.length) {
    return (
      <div className="empty sm">
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
      <div className="rhead">
        <span className="count">
          <b>{report.resources}</b> resource · {formatDate(report.range.from)} –{" "}
          {formatDate(report.range.to)}
        </span>
      </div>

      {report.groups.map((g) => {
        const money = (n: number) => formatMoney(n, g.currencyLabel);
        return (
          <div className="cblock" key={g.currencyId}>
            <div className="cbh">
              <b>{g.currencyLabel}</b>
              <span className="cbn">{g.rows.length} resource</span>
            </div>

            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th className="num" style={{ width: 130 }}>
                      Saldo Awal
                    </th>
                    <th className="num" style={{ width: 130 }}>
                      Penerimaan
                    </th>
                    <th className="num" style={{ width: 130 }}>
                      Pengeluaran
                    </th>
                    <th className="num" style={{ width: 140 }}>
                      Saldo Akhir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.cashBankId} style={{ cursor: "default" }}>
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
                            {!r.active && (
                              <span className="bdg s-bad">Non Aktif</span>
                            )}
                          </span>
                        </Link>
                        <span className="rsub">
                          {r.type} · {r.companyLabel}
                        </span>
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
                    <td style={{ textAlign: "right" }}>
                      Total {g.currencyLabel}
                    </td>
                    <td className="num">{money(g.opening)}</td>
                    <td className="num">{money(g.totalIn)}</td>
                    <td className="num">{money(g.totalOut)}</td>
                    <td className="num">
                      <b>{money(g.closing)}</b>
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
