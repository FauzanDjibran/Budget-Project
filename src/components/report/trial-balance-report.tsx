import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import { reportHref } from "@/lib/siba/reports";
import type { TrialBalanceReport as Report } from "@/lib/siba/ledger";

/**
 * Every account that moved, with its opening, its two sides and its closing.
 *
 * The check a trial balance exists for is the last row: total debits equal
 * total credits. Here it is a consequence rather than a hope — `postJournal`
 * refuses a journal whose sides disagree — so a mismatch means something wrote
 * the tables without going through it. The report says which of the two it is
 * looking at, because "out of balance" and "somebody bypassed the posting
 * path" call for very different responses.
 *
 * **Balance is stated only when it is broken.** A report that announced
 * "seimbang" on the block header, again in the total row, and again in the
 * criteria strip said nothing three times: equal totals are already visible in
 * the two columns above, and the expected case needs no label. A difference —
 * the one case a reader must act on — gets a chip and a sentence.
 *
 * One table per currency, never summed together: there is no exchange-rate
 * source in this system (CLAUDE.md §12). Each currency balances on its own,
 * because every journal is written in one currency and every journal balances.
 *
 * A server component: it only reads, and the account number links through to
 * that account's General Ledger for the same period — the drill-through the
 * Report View convention asks for.
 */
export function TrialBalanceReport({
  report,
  companyId,
}: {
  report: Report;
  /** Carried into the General Ledger link: a chart of accounts belongs to one
      Company, so a drill-through that dropped it would land on whichever
      Company the reader happens to default to. */
  companyId: number;
}) {
  if (!report.groups.length) {
    return (
      <div className="empty">
        <div className="ic">
          <Icon name="calc" size={20} />
        </div>
        <h4>Belum ada journal pada periode ini</h4>
        <p>
          Trial Balance dibentuk dari Journal Line. Journal dibuat otomatis saat
          dokumen Finance diposting — belum ada yang diposting sampai{" "}
          {formatDate(report.range.to)}.
        </p>
      </div>
    );
  }

  const accounts = report.groups.reduce((t, g) => t + g.rows.length, 0);

  return (
    <>
      <div className="rhead">
        <span className="count">
          <b>{accounts}</b> account · {formatDate(report.range.from)} –{" "}
          {formatDate(report.range.to)}
        </span>
      </div>

      {report.unbalanced.length > 0 && (
        <div className="nbox warn" style={{ marginBottom: 12 }}>
          <Icon name="warn" size={14} />
          <div>
            <b>{report.unbalanced.length} journal tidak seimbang.</b> Ini tidak
            dapat terjadi melalui posting biasa — setiap journal ditolak bila
            debit dan kreditnya tidak sama. Artinya ada yang menulis tabel
            journal di luar aplikasi. Journal:{" "}
            {report.unbalanced.map((j) => j.journalNo).join(", ")}.
          </div>
        </div>
      )}

      {report.groups.map((g) => {
        const money = (n: number) => formatMoney(n, g.currencyLabel);
        return (
          <div className="cblock" key={g.currencyLabel}>
            <div className="cbh">
              <b>{g.currencyLabel}</b>
              <span className="cbn">{g.rows.length} account</span>
              {!g.balanced && (
                <span className="rwarn">
                  <Icon name="warn" size={11} />
                  Debit ≠ Kredit
                </span>
              )}
            </div>

            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="num" style={{ width: 130 }}>
                      Saldo Awal
                    </th>
                    <th className="num" style={{ width: 130 }}>
                      Mutasi Debit
                    </th>
                    <th className="num" style={{ width: 130 }}>
                      Mutasi Kredit
                    </th>
                    <th className="num" style={{ width: 140 }}>
                      Saldo Akhir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="pri">
                        <span className="idc">
                          <Link
                            className="lab"
                            href={reportHref("general-ledger", {
                              company: companyId,
                              accounts: r.id,
                              from: report.range.from,
                              to: report.range.to,
                            })}
                            title="Buka General Ledger account ini"
                          >
                            {r.label}
                          </Link>
                          <span className="nm">{r.name}</span>
                          <span
                            className="nb"
                            title={`Normal balance ${r.normalBalance}`}
                          >
                            {r.normalBalance === "Debit" ? "D" : "K"}
                          </span>
                        </span>
                      </td>
                      <td className="num">
                        <span className={`mny${r.opening ? "" : " z"}`}>
                          {money(r.opening)}
                        </span>
                      </td>
                      <td className="num">
                        {r.debit ? (
                          <span className="mny">{money(r.debit)}</span>
                        ) : (
                          <span className="dash">–</span>
                        )}
                      </td>
                      <td className="num">
                        {r.credit ? (
                          <span className="mny">{money(r.credit)}</span>
                        ) : (
                          <span className="dash">–</span>
                        )}
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
                    <td style={{ textAlign: "right" }}>Total mutasi periode</td>
                    <td className="num mut">—</td>
                    <td className="num">{money(g.totalDebit)}</td>
                    <td className="num">{money(g.totalCredit)}</td>
                    {/* Closing balances of accounts with opposite natures do
                        not add to anything, so there is no total to print here.
                        The cell speaks only when the two sides disagree. */}
                    <td className="num">
                      {g.balanced ? (
                        <span className="dash">—</span>
                      ) : (
                        <span className="mny" style={{ color: "var(--bad)" }}>
                          Selisih {money(Math.abs(g.totalDebit - g.totalCredit))}
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {!g.balanced && (
              <div className="cbnone">
                Selisih debit dan kredit sebesar{" "}
                {money(Math.abs(g.totalDebit - g.totalCredit))}. Setiap journal
                wajib seimbang, jadi selisih di sini menandakan masalah sistem —
                bukan kesalahan input.
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
