"use client";

import { Icon } from "@/components/icon";
import { ExpandAll } from "@/components/ui/expand-all";
import { formatDate, formatMoney } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { reportHref } from "@/lib/siba/reports";
import type { TrialBalanceStatement } from "@/lib/siba/statements";
import { Drill } from "./drill";
import { Figure, ROW_CLASS, StatementNameCell, useStatementFold } from "./statement-report";

const HEADERS = ["Saldo Awal", "Mutasi Debit", "Mutasi Kredit", "Saldo Akhir"];

/**
 * The Trial Balance, on the chart's own tree — Account Type → Category →
 * Kelompok → Account — so it reads like the Neraca and the Laba Rugi beside it.
 *
 * The check it exists for is the foot: total Mutasi Debit equals total Mutasi
 * Kredit. That is a consequence rather than a hope — `postJournal` refuses a
 * journal whose sides disagree — so a difference means something wrote the
 * tables without going through it, and the page says so above the table. The
 * balanced case is not labelled; equal totals are visible in the columns.
 *
 * Saldo Awal and Saldo Akhir have no total: they are signed by each type's
 * side, and sides that oppose add to nothing. A heading states its figures
 * only while it is folded, the statements' rule. Every account figure opens
 * that account's General Ledger for the same range.
 */
export function TrialBalanceReport({
  report,
  companyId,
}: {
  report: TrialBalanceStatement;
  /** Carried into the General Ledger link: a chart belongs to one Company. */
  companyId: number;
}) {
  const { visible, foldable, closed, toggle, expandAll, collapseAll, allOpen } =
    useStatementFold(report.rows);

  if (!report.rows.length) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name="calc" size={20} />
        </div>
        <h4>Tidak ada account yang bergerak pada periode ini</h4>
        <p>
          Belum ada saldo maupun mutasi sampai {formatDate(report.range.to)}. Centang
          Tampilkan account tanpa saldo untuk melihat seluruh account.
        </p>
      </div>
    );
  }

  const money = (n: number) => formatMoney(n, BASE_CURRENCY_LABEL);
  const gl = (accountId: number) =>
    reportHref("general-ledger", {
      company: companyId,
      accounts: accountId,
      from: report.range.from,
      to: report.range.to,
    });

  return (
    <>
      <div className="rhead">
        <div className="tspace" />
        <ExpandAll onExpand={expandAll} onCollapse={collapseAll} allOpen={allOpen} />
      </div>

      <div className="tw">
        <table className="grid stm">
          <thead>
            <tr>
              <th>Account</th>
              {HEADERS.map((h) => (
                <th key={h} className="num" style={{ width: 150 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const canFold = foldable.has(r.key);
              const isOpen = !closed.has(r.key);
              const href = r.kind === "account" && r.accountId ? gl(r.accountId) : null;
              return (
                <tr key={r.key} className={ROW_CLASS[r.kind]}>
                  <StatementNameCell
                    row={r}
                    canFold={canFold}
                    isOpen={isOpen}
                    onToggle={() => toggle(r.key)}
                    href={href}
                  />
                  {canFold && isOpen ? (
                    // Open, its rows are on screen; blank rather than a dash,
                    // which would read as nil.
                    <td colSpan={HEADERS.length} />
                  ) : (
                    r.values.map((v, i) => (
                      <td key={i} className="num">
                        {href ? (
                          <Drill href={href} title="Buka General Ledger account ini">
                            <Figure value={v} />
                          </Drill>
                        ) : (
                          <Figure value={v} />
                        )}
                      </td>
                    ))
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="totrow">
              <td style={{ textAlign: "right" }}>Total mutasi periode</td>
              <td className="num" />
              <td className="num">{money(report.totalDebit)}</td>
              <td className="num">{money(report.totalCredit)}</td>
              <td className="num" />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
