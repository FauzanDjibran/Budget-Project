"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ReportSummary } from "@/components/report/report-summary";
import { formatDate, formatMoney } from "@/lib/format";
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
 * The entry table carries no Company column and no separate Partner column: the
 * Company is fixed for the whole run and stated in the filter, and a partner
 * belongs with the line it describes. Both were columns whose width the
 * description then had to give up, which is what pushed the table into a
 * horizontal scroll.
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
      <div className="empty" style={{ padding: "34px 20px" }}>
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

  const allOpen = open.size === report.accounts.length;
  const setAll = (o: boolean) =>
    setOpen(o ? new Set(report.accounts.map((a) => a.id)) : new Set());

  return (
    <>
      {report.accounts.length > 1 && (
        <div className="rhead">
          <span className="count">
            <b>{report.accounts.length}</b> account ·{" "}
            {formatDate(report.range.from)} – {formatDate(report.range.to)}
          </span>
          <div className="tspace" />
          <button className="btn sm" onClick={() => setAll(!allOpen)}>
            <Icon name={allOpen ? "collapse" : "expand"} size={13} />
            {allOpen ? "Tutup Semua" : "Buka Semua"}
          </button>
        </div>
      )}

      {report.accounts.map((a) => {
        const isOpen = open.has(a.id);
        const money = (n: number) => formatMoney(n, a.currencyLabel);
        return (
          <div className="cblock" key={a.id}>
            <div
              className="cbh"
              onClick={() => toggle(a.id)}
              style={{ cursor: "pointer" }}
            >
              <span className={`chev${isOpen ? " o" : ""}`}>
                <Icon name="chev" size={12} />
              </span>
              <b>{a.label}</b>
              <span className="cbn">
                {a.name} · {a.normalBalance} · {a.entries.length} mutasi
              </span>
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
                      <td colSpan={3}>
                        Saldo awal per {formatDate(report.range.from)}
                      </td>
                      <td className="num mut">—</td>
                      <td className="num mut">—</td>
                      <td className="num">{money(a.opening)}</td>
                    </tr>

                    {a.entries.map((e, i) => (
                      <tr key={`${e.journalId}-${i}`}>
                        <td className="mono mut" style={{ fontSize: "11.5px" }}>
                          {formatDate(e.date)}
                        </td>
                        <td>
                          <Link
                            className="lab"
                            href={`/accounting/journal/${e.journalId}`}
                          >
                            {e.journalNo}
                          </Link>
                        </td>
                        <td className="pri wrapok">
                          {e.description}
                          {e.partnerLabel && (
                            <span className="rsub">{e.partnerLabel}</span>
                          )}
                        </td>
                        <td className="num">
                          {e.debit ? money(e.debit) : <span className="dash">–</span>}
                        </td>
                        <td className="num">
                          {e.credit ? money(e.credit) : <span className="dash">–</span>}
                        </td>
                        <td className="num">{money(e.balance)}</td>
                      </tr>
                    ))}

                    {a.entries.length === 0 && (
                      <tr>
                        <td colSpan={6} className="mut" style={{ textAlign: "center" }}>
                          Tidak ada mutasi pada periode ini. Saldo akhir sama
                          dengan saldo awal.
                        </td>
                      </tr>
                    )}

                    <tr className="totrow">
                      <td colSpan={3}>
                        Saldo akhir per {formatDate(report.range.to)}
                      </td>
                      <td className="num">{money(a.debit)}</td>
                      <td className="num">{money(a.credit)}</td>
                      <td className="num">
                        <b>{money(a.closing)}</b>
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
