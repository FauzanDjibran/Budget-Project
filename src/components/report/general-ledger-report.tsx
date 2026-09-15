"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import type { GeneralLedgerReport as Report } from "@/lib/siba/ledger";

/**
 * One ledger table per account, stacked.
 *
 * Each account opens **rolled up**: its header alone states opening balance,
 * movement on each side, and closing balance, which is what a reader checking
 * the books needs first. The entries that produced those figures are one click
 * away, so a report of eight accounts is a page you can scan rather than a
 * thousand rows you have to scroll past.
 *
 * Nothing is totalled across accounts. Accounts of different natures do not add
 * up to anything — that sum is the Trial Balance's job, and it does it per
 * currency and per side.
 *
 * Every class here already exists in the design system: a Report View
 * introduces no new CSS (CLAUDE.md §12).
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

  const allOpen = open.size === report.accounts.length;
  const setAll = (o: boolean) =>
    setOpen(o ? new Set(report.accounts.map((a) => a.id)) : new Set());

  return (
    <>
      {report.accounts.length > 1 && (
        <div className="toolbar" style={{ borderTop: 0 }}>
          <span className="count">
            <b>{report.accounts.length}</b> account
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
                {a.name} · {a.companyLabel} · {a.normalBalance}
              </span>
              <span className="cbo2">
                Awal {formatMoney(a.opening, a.currencyLabel)} · D{" "}
                {formatMoney(a.debit, a.currencyLabel)} · K{" "}
                {formatMoney(a.credit, a.currencyLabel)} · Akhir{" "}
                {formatMoney(a.closing, a.currencyLabel)}
              </span>
            </div>

            {isOpen && (
              <div className="tw">
                <table className="grid">
                  <thead>
                    <tr>
                      <th style={{ width: 104 }}>Tanggal</th>
                      <th style={{ width: 116 }}>Journal</th>
                      <th>Keterangan</th>
                      <th style={{ width: 120 }}>Partner</th>
                      <th className="num" style={{ width: 140 }}>
                        Debit
                      </th>
                      <th className="num" style={{ width: 140 }}>
                        Kredit
                      </th>
                      <th className="num" style={{ width: 150 }}>
                        Saldo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="totrow">
                      <td colSpan={4}>
                        Saldo awal per {formatDate(report.range.from)}
                      </td>
                      <td className="num mut">—</td>
                      <td className="num mut">—</td>
                      <td className="num">
                        {formatMoney(a.opening, a.currencyLabel)}
                      </td>
                    </tr>

                    {a.entries.map((e, i) => (
                      <tr key={`${e.journalId}-${i}`}>
                        <td>{formatDate(e.date)}</td>
                        <td>
                          <Link
                            className="lab"
                            href={`/accounting/journal/${e.journalId}`}
                          >
                            {e.journalNo}
                          </Link>
                        </td>
                        <td className="pri">{e.description}</td>
                        <td className="mut">{e.partnerLabel ?? "—"}</td>
                        <td className="num">
                          {e.debit ? formatMoney(e.debit, a.currencyLabel) : "—"}
                        </td>
                        <td className="num">
                          {e.credit ? formatMoney(e.credit, a.currencyLabel) : "—"}
                        </td>
                        <td className="num">
                          {formatMoney(e.balance, a.currencyLabel)}
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
                      <td className="num">{formatMoney(a.debit, a.currencyLabel)}</td>
                      <td className="num">{formatMoney(a.credit, a.currencyLabel)}</td>
                      <td className="num">
                        <b>{formatMoney(a.closing, a.currencyLabel)}</b>
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
