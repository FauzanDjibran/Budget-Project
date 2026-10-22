"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { ExpandAll } from "@/components/ui/expand-all";
import { ReportSummary } from "@/components/report/report-summary";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { isBaseCurrency } from "@/lib/siba/currency";
import type { SubledgerBalanceReport as Report } from "@/lib/siba/subledger";

/**
 * Saldo Buku Subjek — one block per Partner and currency, the shape Buku
 * Subjek and the General Ledger give a subject: the block header names the
 * Partner and the currency and states Saldo Awal, Bertambah, Berkurang and the
 * closing as a summary strip; the block holds the open items that position is
 * made of.
 *
 * Every item that stood or moved in the period is listed, with the kurs it was
 * raised at in a column of its own (a dash on a rupiah item), and its own Saldo
 * Awal, Bertambah, Berkurang and closing in the position's currency — no base
 * value, on the user's instruction — so the
 * items add up to the header in every column — an item settled inside the
 * period is listed at a closing of nil. One level folds: the block, by its
 * header. Blocks open expanded, and Buka / Tutup Semua fold all of them.
 *
 * Nothing is added across currencies: a Partner holding in two currencies has
 * two blocks.
 */
export function SubledgerBalanceReport({ report }: { report: Report }) {
  const keyOf = (r: { partnerId: number; currencyId: number }) =>
    `${r.partnerId}:${r.currencyId}`;
  const rows = report.groups.flatMap((g) => g.rows);
  const [open, setOpen] = useState<Set<string>>(() => new Set(rows.map(keyOf)));

  if (!rows.length) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name="wallet" size={20} />
        </div>
        <h4>Belum ada posisi pada buku ini</h4>
        <p>
          {report.book.name} tidak mencatat posisi apa pun untuk Partner dan
          periode yang dipilih.
        </p>
      </div>
    );
  }

  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // A book that only accumulates — Investasi, Hasil Investasi — keeps its
  // items as a record of where the money went; nothing settles them, so they
  // are not called open items.
  const noun = report.book.nature === "cumulative" ? "rincian" : "open item";

  return (
    <>
      <div className="rhead">
        <span className="count">
          <b>{rows.length}</b> subjek · {formatDate(report.range.from)} –{" "}
          {formatDate(report.range.to)} · {report.book.closingLabel} bertambah saat{" "}
          {report.book.raises === "In" ? "penerimaan uang" : "pengeluaran uang"}
        </span>
        <div className="tspace" />
        {rows.length > 1 && (
          <ExpandAll
            onExpand={() => setOpen(new Set(rows.map(keyOf)))}
            onCollapse={() => setOpen(new Set())}
            allOpen={open.size === rows.length}
            allClosed={open.size === 0}
          />
        )}
      </div>

      {rows.map((r) => {
        const key = keyOf(r);
        const isOpen = open.has(key);
        const money = (n: number) => formatMoney(n, r.currencyLabel);
        const foreign = !isBaseCurrency(r.currencyLabel);
        const figure = (n: number) => (
          <span className={`mny${n ? "" : " z"}${n < 0 ? " neg" : ""}`}>{money(n)}</span>
        );
        return (
          <div className="cblock" key={key}>
            <div
              className="cbh"
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => toggle(key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(key);
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <span className={`chev${isOpen ? " o" : ""}`}>
                <Icon name="chev" size={12} />
              </span>
              <b>{r.label}</b>
              <span className="cbn">
                {r.name} · {r.categoryLabel} · {r.currencyLabel} · {r.items.length}{" "}
                {noun}
                {r.active ? "" : " · non-aktif"}
              </span>
              <ReportSummary
                figures={[
                  { label: "Saldo Awal", value: money(r.opening), zero: !r.opening },
                  { label: "Bertambah", value: money(r.raised), zero: !r.raised },
                  { label: "Berkurang", value: money(r.lowered), zero: !r.lowered },
                  {
                    label: report.book.closingLabel,
                    value: money(r.closing),
                    key: true,
                    negative: r.closing < 0,
                  },
                ]}
              />
            </div>

            {!r.reconciles && (
              <p className="rwarn">
                <Icon name="warn" size={12} />
                Posisi tersimpan tidak sama dengan jumlah seluruh entri buku
                ini. Buku ini bersifat append-only, jadi selisih menandakan
                gangguan sistem — laporkan sebelum angka ini dipakai.
              </p>
            )}

            {isOpen && (
              <div className="tw">
                <table className="grid">
                  <thead>
                    <tr>
                      <th style={{ width: 92 }}>Tanggal</th>
                      <th style={{ width: 106 }}>
                        {noun === "rincian" ? "Rincian" : "Open Item"}
                      </th>
                      <th>Keterangan</th>
                      <th className="num" style={{ width: 96 }}>
                        Kurs
                      </th>
                      <th className="num" style={{ width: 126 }}>
                        Saldo Awal
                      </th>
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
                    {r.items.map((i) => (
                      <tr key={i.id}>
                        <td className="mono mut" style={{ fontSize: "11.5px" }}>
                          {formatDate(i.date)}
                        </td>
                        <td>
                          <span className="lab">{i.itemNo}</span>
                        </td>
                        <td className="pri wrapok">
                          {i.note ?? "—"}
                        </td>
                        <td className="num mono">
                          {foreign ? formatRate(i.rate) : <span className="dash">–</span>}
                        </td>
                        <td className="num">{figure(i.opening)}</td>
                        <td className="num">{figure(i.raised)}</td>
                        <td className="num">{figure(i.lowered)}</td>
                        <td className="num">{figure(i.closing)}</td>
                      </tr>
                    ))}

                    {r.items.length === 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          className="mut"
                          style={{ textAlign: "center" }}
                        >
                          Tidak ada {noun} pada periode ini.
                        </td>
                      </tr>
                    )}
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
