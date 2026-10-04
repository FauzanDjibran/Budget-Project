"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { ExpandAll } from "@/components/ui/expand-all";
import { ReportSummary } from "@/components/report/report-summary";
import { Drill } from "@/components/report/drill";
import { Amount } from "@/components/ui/amount";
import { PartnerCell } from "@/components/ui/partner-cell";
import { formatAccounting, formatDate, formatForeignFace } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import type { GeneralLedgerReport as Report } from "@/lib/siba/ledger";

/**
 * One ledger table per account, stacked.
 *
 * Each account opens **rolled up**: its header alone states opening balance,
 * movement on each side, and closing balance — as a labelled strip, so the four
 * figures can be read at a glance rather than parsed out of a sentence. The
 * entries that produced them are one click away, so a report of eight accounts
 * is a page you can scan rather than a thousand rows you have to scroll past.
 *
 * Nothing is totalled across accounts. Accounts of different natures do not add
 * up to anything — that sum is the Trial Balance's job, and it does it per
 * currency and per side.
 *
 * The entry table carries no Company column — the Company is fixed for the run
 * and stated in the filter — but it does carry a **Partner** column, on the
 * user's instruction: the point of reading a line on a Partner-bearing account
 * is knowing whose it is, and that is a column's worth of fact, not a footnote
 * under the description. It shows what the journal line recorded, a dash where
 * it recorded none, and a warning where the line breaks its account's rule.
 */
export function GeneralLedgerReport({ report }: { report: Report }) {
  // Collapsed keys rather than open ones: an account added to the URL should
  // arrive in the same state as the rest, not remembered as closed.
  const [open, setOpen] = useState<Set<number>>(new Set());

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A hand-edited URL can name accounts belonging to another Company, or none
  // at all. Saying so beats a blank card, which reads as "no data".
  if (report.accounts.length === 0) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name="tree" size={20} />
        </div>
        <h4>Account tidak ditemukan</h4>
        <p>
          Account yang diminta tidak ada pada bagan akun Company ini. Setiap
          Company menomori bagan akunnya sendiri — pilih ulang account di atas.
        </p>
      </div>
    );
  }

  // A line breaking its account's Partner rule is a system fault, and the
  // accounts start folded — so the fault is counted up here, where it is seen
  // before any account is opened.
  const mismatchesOf = (a: Report["accounts"][number]) =>
    a.entries.filter((e) => e.partnerMismatch).length;
  const faulty = report.accounts.filter((a) => mismatchesOf(a) > 0);
  const faultyLines = faulty.reduce((t, a) => t + mismatchesOf(a), 0);

  const allOpen = open.size === report.accounts.length;
  const setAll = (o: boolean) =>
    setOpen(o ? new Set(report.accounts.map((a) => a.id)) : new Set());

  return (
    <>
      {faultyLines > 0 && (
        <div className="nbox warn slim" style={{ margin: "0 0 12px" }}>
          <Icon name="warn" size={14} />
          <div>
            <b>{faultyLines} baris journal tidak sesuai aturan Partner account-nya.</b>
            <p>
              Hanya account yang mewajibkan Partner yang boleh mencatat Partner, dan
              setiap barisnya wajib mencatatnya — selisih ini menandakan masalah
              sistem: {faulty.map((a) => a.label).join(", ")}.
            </p>
          </div>
        </div>
      )}

      {report.accounts.length > 1 && (
        <div className="rhead">
          <span className="count">
            <b>{report.accounts.length}</b> account ·{" "}
            {formatDate(report.range.from)} – {formatDate(report.range.to)}
          </span>
          <div className="tspace" />
          <ExpandAll
            onExpand={() => setAll(true)}
            onCollapse={() => setAll(false)}
            allOpen={allOpen}
            allClosed={open.size === 0}
          />
        </div>
      )}

      {report.accounts.map((a) => {
        const isOpen = open.has(a.id);
        // Every figure here is base currency, a negative in parentheses. The
        // transaction-currency face lives beside the description.
        const money = (n: number) => formatAccounting(n, BASE_CURRENCY_LABEL);
        return (
          <div className="cblock" key={a.id}>
            <div
              className="cbh"
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => toggle(a.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(a.id);
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <span className={`chev${isOpen ? " o" : ""}`}>
                <Icon name="chev" size={12} />
              </span>
              <b>{a.label}</b>
              <span className="cbn">
                {a.name} · {a.normalBalance} · {a.entries.length} mutasi
                {a.foreignCurrencies.length > 0 &&
                  ` · sumber ${a.foreignCurrencies.join(", ")}`}
              </span>
              {mismatchesOf(a) > 0 && (
                <span className="rwarn">
                  <Icon name="warn" size={11} />
                  {mismatchesOf(a)} baris Partner tidak sesuai
                </span>
              )}
              <ReportSummary
                figures={[
                  { label: "Saldo Awal", value: money(a.opening), zero: !a.opening },
                  { label: "Debit", value: money(a.debit), zero: !a.debit },
                  { label: "Kredit", value: money(a.credit), zero: !a.credit },
                  {
                    label: "Saldo Akhir",
                    value: money(a.closing),
                    key: true,
                    negative: a.closing < 0,
                  },
                ]}
              />
            </div>

            {isOpen && (
              <div className="tw">
                <table className="grid">
                  <thead>
                    <tr>
                      <th style={{ width: 92 }}>Tanggal</th>
                      <th style={{ width: 106 }}>Journal</th>
                      <th style={{ width: 220 }}>Partner</th>
                      <th>Keterangan</th>
                      <th className="num" style={{ width: 126 }}>
                        Debit
                      </th>
                      <th className="num" style={{ width: 126 }}>
                        Kredit
                      </th>
                      <th className="num" style={{ width: 134 }}>
                        Saldo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="totrow">
                      <td colSpan={4}>
                        Saldo awal per {formatDate(report.range.from)}
                      </td>
                      <td className="num">
                        <Amount value={0} nil="dash" ledger />
                      </td>
                      <td className="num">
                        <Amount value={0} nil="dash" ledger />
                      </td>
                      <td className="num">
                        <Amount value={a.opening} ledger />
                      </td>
                    </tr>

                    {a.entries.map((e, i) => (
                      <tr key={`${e.journalId}-${i}`}>
                        <td className="mono mut" style={{ fontSize: "11.5px" }}>
                          {formatDate(e.date)}
                        </td>
                        <td>
                          <Drill
                            href={`/accounting/journal/${e.journalId}`}
                            title="Buka journal ini"
                          >
                            <span className="lab">{e.journalNo}</span>
                          </Drill>
                        </td>
                        <td>
                          <PartnerCell
                            label={e.partnerLabel}
                            name={e.partnerName}
                            mismatch={e.partnerMismatch}
                          />
                        </td>
                        <td className="pri wrapok">
                          {e.description}
                          {/* What the rupiah figure beside it came from. Only
                              where the two differ — an IDR line would just be
                              stating itself twice. */}
                          {e.trxCurrencyLabel && (
                            <span className="rsub">
                              {formatForeignFace(e.trxAmount ?? 0, e.trxCurrencyLabel, e.rate ?? 0)}
                            </span>
                          )}
                        </td>
                        <td className="num">
                          <Amount value={e.debit} nil="dash" ledger />
                        </td>
                        <td className="num">
                          <Amount value={e.credit} nil="dash" ledger />
                        </td>
                        <td className="num">
                          <Amount value={e.balance} ledger />
                        </td>
                      </tr>
                    ))}

                    {a.entries.length === 0 && (
                      <tr>
                        <td colSpan={7} className="mut" style={{ textAlign: "center" }}>
                          Tidak ada mutasi pada periode ini. Saldo akhir sama
                          dengan saldo awal.
                        </td>
                      </tr>
                    )}

                    <tr className="totrow">
                      <td colSpan={4}>
                        Saldo akhir per {formatDate(report.range.to)}
                      </td>
                      <td className="num">
                        <Amount value={a.debit} ledger />
                      </td>
                      <td className="num">
                        <Amount value={a.credit} ledger />
                      </td>
                      <td className="num">
                        <b>
                          <Amount value={a.closing} ledger />
                        </b>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
