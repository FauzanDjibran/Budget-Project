"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { ReportSummary } from "@/components/report/report-summary";
import { formatDate, formatMoney } from "@/lib/format";
import type { SubledgerReport as Report } from "@/lib/siba/subledger";

/**
 * One ledger table per subject, stacked — the General Ledger's shape with a
 * Partner in place of an account.
 *
 * Each subject opens **rolled up**: its header alone states the opening
 * position, what raised it, what lowered it, and where it now stands, as a
 * labelled strip so the four figures read at a glance. The entries that
 * produced them are one click away, so a book of twelve Partners is a page you
 * can scan rather than a thousand rows you have to scroll past.
 *
 * The two movement columns are **Bertambah / Berkurang** rather than Debit /
 * Kredit: a subledger records a business subject's position, not an accounting
 * entry (concept doc §14), and which cash direction raises that position
 * differs per book — money leaving the company raises a Piutang and lowers a
 * Hutang. The book's own header says which way it works, so the reader never
 * has to infer it from a row.
 *
 * Nothing is totalled across subjects, and nothing across currencies: two
 * Partners' positions do not add up to anything a reader would act on, and
 * converting between currencies would need a rate this system does not have.
 */
export function SubledgerReport({ report }: { report: Report }) {
  // Collapsed keys rather than open ones: a subject added to the URL should
  // arrive in the same state as the rest, not remembered as closed.
  const [open, setOpen] = useState<Set<string>>(new Set());

  const keyOf = (s: { partnerId: number; currencyId: number }) =>
    `${s.partnerId}:${s.currencyId}`;

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (report.subjects.length === 0) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name={report.book.icon} size={20} />
        </div>
        <h4>Belum ada mutasi pada buku ini</h4>
        <p>
          {report.book.name} belum mencatat apa pun untuk Partner dan periode
          yang dipilih. Buku ini terisi saat Cash Bank Transaction dengan
          Category {report.book.budgetCategory} diposting.
        </p>
      </div>
    );
  }

  const allOpen = open.size === report.subjects.length;
  const setAll = (o: boolean) =>
    setOpen(o ? new Set(report.subjects.map(keyOf)) : new Set());

  const raisesLabel =
    report.book.raises === "In" ? "penerimaan uang" : "pengeluaran uang";

  return (
    <>
      <div className="rhead">
        <span className="count">
          <b>{report.subjects.length}</b> subjek · {formatDate(report.range.from)} –{" "}
          {formatDate(report.range.to)} · {report.book.closingLabel} bertambah saat{" "}
          {raisesLabel}
        </span>
        <div className="tspace" />
        {report.subjects.length > 1 && (
          <button className="btn sm" onClick={() => setAll(!allOpen)}>
            <Icon name={allOpen ? "collapse" : "expand"} size={13} />
            {allOpen ? "Tutup Semua" : "Buka Semua"}
          </button>
        )}
      </div>

      {report.subjects.map((s) => {
        const key = keyOf(s);
        const isOpen = open.has(key);
        const money = (n: number) => formatMoney(n, s.currencyLabel);
        return (
          <div className="cblock" key={key}>
            <div
              className="cbh"
              onClick={() => toggle(key)}
              style={{ cursor: "pointer" }}
            >
              <span className={`chev${isOpen ? " o" : ""}`}>
                <Icon name="chev" size={12} />
              </span>
              <b>{s.label}</b>
              <span className="cbn">
                {s.name} · {s.categoryLabel} · {s.currencyLabel} ·{" "}
                {s.entries.length} mutasi
                {s.active ? "" : " · non-aktif"}
              </span>
              <ReportSummary
                figures={[
                  { label: "Saldo Awal", value: money(s.opening), zero: !s.opening },
                  { label: "Bertambah", value: money(s.raised), zero: !s.raised },
                  { label: "Berkurang", value: money(s.lowered), zero: !s.lowered },
                  {
                    label: report.book.closingLabel,
                    value: money(s.closing),
                    key: true,
                    negative: s.closing < 0,
                  },
                ]}
              />
            </div>

            {!s.reconciles && (
              <p className="rwarn">
                <Icon name="warn" size={12} />
                Saldo tercatat pada entri terakhir tidak sama dengan hasil
                perhitungan periode ini. Buku ini bersifat append-only, jadi
                selisih menandakan gangguan sistem — laporkan sebelum angka ini
                dipakai.
              </p>
            )}

            {isOpen && (
              <div className="tw">
                <table className="grid">
                  <thead>
                    <tr>
                      <th style={{ width: 92 }}>Tanggal</th>
                      <th style={{ width: 106 }}>Entri</th>
                      <th>Keterangan</th>
                      <th className="num" style={{ width: 126 }}>
                        Bertambah
                      </th>
                      <th className="num" style={{ width: 126 }}>
                        Berkurang
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
                      <td className="num">{money(s.opening)}</td>
                    </tr>

                    {s.entries.map((e) => (
                      <tr key={e.id}>
                        <td className="mono mut" style={{ fontSize: "11.5px" }}>
                          {formatDate(e.date)}
                        </td>
                        <td>
                          <span className="lab">{e.entryNo}</span>
                        </td>
                        <td className="pri wrapok">
                          {e.note ?? "—"}
                          {e.type !== "Transaction" && (
                            <span className="rsub">{e.type}</span>
                          )}
                        </td>
                        <td className="num">
                          {e.movement > 0 ? (
                            money(e.movement)
                          ) : (
                            <span className="dash">–</span>
                          )}
                        </td>
                        <td className="num">
                          {e.movement < 0 ? (
                            money(-e.movement)
                          ) : (
                            <span className="dash">–</span>
                          )}
                        </td>
                        <td className="num">{money(e.balanceAfter)}</td>
                      </tr>
                    ))}

                    {s.entries.length === 0 && (
                      <tr>
                        <td colSpan={6} className="mut" style={{ textAlign: "center" }}>
                          Tidak ada mutasi pada periode ini. Saldo akhir sama
                          dengan saldo awal.
                        </td>
                      </tr>
                    )}

                    <tr className="totrow">
                      <td colSpan={3}>
                        {report.book.closingLabel} per {formatDate(report.range.to)}
                      </td>
                      <td className="num">{money(s.raised)}</td>
                      <td className="num">{money(s.lowered)}</td>
                      <td className="num">
                        <b>{money(s.closing)}</b>
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
