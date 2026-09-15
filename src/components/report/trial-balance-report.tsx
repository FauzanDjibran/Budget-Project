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
 * One table per currency, never summed together: there is no exchange-rate
 * source in this system (CLAUDE.md §12). Each currency balances on its own,
 * because every journal is written in one currency and every journal balances.
 *
 * A server component: it only reads, and the account number links through to
 * that account's General Ledger for the same period — the drill-through the
 * Report View convention asks for.
 */
export function TrialBalanceReport({ report }: { report: Report }) {
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

  return (
    <>
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

      {report.groups.map((g) => (
        <div className="cblock" key={g.currencyLabel}>
          <div className="cbh">
            <b>{g.currencyLabel}</b>
            <span className="cbn">{g.rows.length} account</span>
            <span className="cbo2">
              {g.balanced
                ? "Debit = Kredit · seimbang"
                : "TIDAK SEIMBANG — periksa journal"}
            </span>
          </div>

          <div className="tw">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 132 }}>Account</th>
                  <th>Nama Account</th>
                  <th style={{ width: 84 }}>Normal</th>
                  <th className="num" style={{ width: 150 }}>
                    Saldo Awal
                  </th>
                  <th className="num" style={{ width: 150 }}>
                    Mutasi Debit
                  </th>
                  <th className="num" style={{ width: 150 }}>
                    Mutasi Kredit
                  </th>
                  <th className="num" style={{ width: 160 }}>
                    Saldo Akhir
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        className="lab"
                        href={reportHref("general-ledger", {
                          accounts: r.id,
                          from: report.range.from,
                          to: report.range.to,
                        })}
                        title="Buka General Ledger account ini"
                      >
                        {r.label}
                      </Link>
                    </td>
                    <td className="pri">{r.name}</td>
                    <td className="mut">{r.normalBalance}</td>
                    <td className="num">
                      {formatMoney(r.opening, g.currencyLabel)}
                    </td>
                    <td className="num">
                      {r.debit ? formatMoney(r.debit, g.currencyLabel) : "—"}
                    </td>
                    <td className="num">
                      {r.credit ? formatMoney(r.credit, g.currencyLabel) : "—"}
                    </td>
                    <td className="num">
                      {formatMoney(r.closing, g.currencyLabel)}
                    </td>
                  </tr>
                ))}

                <tr className="totrow">
                  <td colSpan={4}>Total mutasi periode</td>
                  <td className="num">
                    {formatMoney(g.totalDebit, g.currencyLabel)}
                  </td>
                  <td className="num">
                    {formatMoney(g.totalCredit, g.currencyLabel)}
                  </td>
                  <td className="num">
                    {g.balanced ? "Seimbang" : "Selisih!"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {!g.balanced && (
            <div className="cbnone">
              Selisih debit dan kredit sebesar{" "}
              {formatMoney(
                Math.abs(g.totalDebit - g.totalCredit),
                g.currencyLabel
              )}
              . Setiap journal wajib seimbang, jadi selisih di sini menandakan
              masalah sistem — bukan kesalahan input.
            </div>
          )}
        </div>
      ))}
    </>
  );
}
