"use client";

import { useState } from "react";
import { loadCashBankEntries } from "@/app/actions/book-entries";
import { Icon } from "@/components/icon";
import { LazyRows, useLazyEntries } from "@/components/report/lazy-entries";
import { ReportSummary } from "@/components/report/report-summary";
import { ExpandAll } from "@/components/ui/expand-all";
import { formatDate, formatMoney } from "@/lib/format";
import { entryKindText } from "@/lib/siba/document-links";
import type { LedgerEntryRow, LedgerReport } from "@/lib/siba/cash-bank";
import type { BookCursor } from "@/lib/siba/register-query";
import type { PeriodRange } from "@/lib/siba/period";

/**
 * Buku Kas & Bank — every movement of one or more resources across a period,
 * one block per resource, the way the General Ledger stacks its accounts.
 *
 * Each block opens **rolled up**: its header states the resource, its currency,
 * and the book's own arithmetic — opening + masuk − keluar = saldo akhir — and
 * the entries are one click away. Every figure is in the resource's own
 * currency and says so; nothing is totalled across resources, because a USD
 * account and a rupiah one do not add up to anything.
 *
 * Read the way a book is read: oldest first, opening balance carried in at the
 * top, closing balance struck at the bottom. That the totals must add up is
 * why **there is no entry-type filter**: dropping `Penyesuaian` rows would
 * leave a page whose figures no longer reconcile. What the entry was — Uang
 * Masuk, Transfer Keluar, Revaluasi Kurs — sits under its document number.
 */

export function CashBankLedgerReport({
  books,
  range,
}: {
  books: LedgerReport[];
  range: PeriodRange;
}) {
  // Open keys rather than closed ones: a resource added to the URL arrives
  // folded like the rest, as the General Ledger's accounts do.
  const [open, setOpen] = useState<Set<number>>(new Set());

  // The entries are fetched when a block is opened, a page at a time.
  const lazy = useLazyEntries<LedgerEntryRow, BookCursor, number>((id, cursor) =>
    loadCashBankEntries(id, range.from, range.to, cursor)
  );
  const loadedOf = (b: LedgerReport) => lazy.get(b.resource.id, b.entries);
  const loadMore = (b: LedgerReport) => lazy.more(b.resource.id, b.entries);

  const toggle = (b: LedgerReport) => {
    const id = b.resource.id;
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!open.has(id) && b.entryCount > 0 && !loadedOf(b)) void loadMore(b);
  };

  // A hand-edited URL can name resources of another Company, or none at all.
  if (books.length === 0) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name="book" size={20} />
        </div>
        <h4>Cash & Bank tidak ditemukan</h4>
        <p>
          Cash & Bank yang diminta tidak ada pada Company ini. Pilih ulang Cash
          & Bank di atas.
        </p>
      </div>
    );
  }

  const unreconciled = books.filter((b) => !b.reconciles);

  return (
    <>
      {unreconciled.length > 0 && (
        <div className="nbox warn slim" style={{ margin: "0 0 12px" }}>
          <Icon name="warn" size={14} />
          <div>
            <b>Saldo tersimpan tidak cocok dengan jumlah mutasi.</b>
            <p>
              Saldo yang tersimpan berbeda dari hasil penjumlahan seluruh
              mutasinya pada {unreconciled.map((b) => b.resource.label).join(", ")}.
              Laporan tetap ditampilkan apa adanya; selisih ini perlu diperiksa
              sebelum angkanya dipakai.
            </p>
          </div>
        </div>
      )}

      {books.length > 1 && (
        <div className="rhead">
          <span className="count">
            <b>{books.length}</b> Cash & Bank · {formatDate(range.from)} –{" "}
            {formatDate(range.to)}
          </span>
          <div className="tspace" />
          <ExpandAll
            onExpand={() => {
              setOpen(new Set(books.map((b) => b.resource.id)));
              for (const b of books) if (b.entryCount > 0 && !loadedOf(b)) void loadMore(b);
            }}
            onCollapse={() => setOpen(new Set())}
            allOpen={open.size === books.length}
            allClosed={open.size === 0}
          />
        </div>
      )}

      {books.map((book) => {
        const res = book.resource;
        const isOpen = open.has(res.id);
        const have = loadedOf(book);
        const rows = have?.entries ?? [];
        const money = (n: number) => formatMoney(n, res.currencyLabel);
        return (
          <div className="cblock" key={res.id}>
            <div
              className="cbh"
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => toggle(book)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(book);
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <span className={`chev${isOpen ? " o" : ""}`}>
                <Icon name="chev" size={12} />
              </span>
              <b>{res.label}</b>
              <span className="bdg t-slate">{res.currencyLabel}</span>
              <span className="cbn">
                {res.name} · {book.entryCount} mutasi
                {!res.active && " · nonaktif"}
              </span>
              <ReportSummary
                figures={[
                  { label: "Saldo Awal", value: money(book.opening), zero: !book.opening },
                  { label: "Masuk", value: money(book.totalIn), zero: !book.totalIn },
                  { label: "Keluar", value: money(book.totalOut), zero: !book.totalOut },
                  {
                    label: "Saldo Akhir",
                    value: money(book.closing),
                    key: true,
                    negative: book.closing < 0,
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
                      <th style={{ width: 116 }}>Dokumen</th>
                      <th>Keterangan</th>
                      <th className="num" style={{ width: 140 }}>
                        Masuk
                      </th>
                      <th className="num" style={{ width: 140 }}>
                        Keluar
                      </th>
                      <th className="num" style={{ width: 148 }}>
                        Saldo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="totrow">
                      <td colSpan={3}>Saldo awal per {formatDate(range.from)}</td>
                      <td className="num mut">—</td>
                      <td className="num mut">—</td>
                      <td className="num">{money(book.opening)}</td>
                    </tr>

                    {rows.map((e) => {
                      // A revaluation moves no currency, only its base value,
                      // so neither column carries it.
                      const restated = e.type === "Revaluation";
                      const kind = entryKindText(e.type, e.sourceDocTable, e.movement);
                      return (
                        <tr key={e.id} style={{ cursor: "default" }}>
                          <td className="mono mut" style={{ fontSize: "11.5px" }}>
                            {formatDate(e.date)}
                          </td>
                          <td>
                            {e.sourceDocNo ? (
                              <span className="lab">{e.sourceDocNo}</span>
                            ) : (
                              !kind && <span className="dash">—</span>
                            )}
                            {kind && <span className="rsub">{kind}</span>}
                          </td>
                          <td className="pri wrapok">
                            {e.note ?? <span className="dash">—</span>}
                          </td>
                          <td className="num">
                            {e.movement > 0 ? (
                              <span className="mny in">{money(e.movement)}</span>
                            ) : (
                              <span className="dash">–</span>
                            )}
                          </td>
                          <td className="num">
                            {e.movement < 0 && !restated ? (
                              <span className="mny">{money(-e.movement)}</span>
                            ) : (
                              <span className="dash">–</span>
                            )}
                          </td>
                          {/* No running balance: an entry may be backdated in
                              among entries written before it, so only the
                              period's opening and closing are stated. */}
                          <td className="num" />
                        </tr>
                      );
                    })}

                    {book.entryCount === 0 && (
                      // Not an empty state: no movement is a real answer.
                      <tr>
                        <td colSpan={6} className="mut" style={{ textAlign: "center" }}>
                          Tidak ada mutasi pada rentang tanggal ini. Saldo akhir
                          sama dengan saldo awal.
                        </td>
                      </tr>
                    )}

                    <LazyRows
                      colSpan={6}
                      total={book.entryCount}
                      have={have}
                      onMore={() => void loadMore(book)}
                    />

                    <tr className="totrow">
                      <td colSpan={3}>Saldo akhir per {formatDate(range.to)}</td>
                      <td className="num">
                        <span className="mny in">{money(book.totalIn)}</span>
                      </td>
                      <td className="num">
                        <span className="mny">{money(book.totalOut)}</span>
                      </td>
                      <td className="num">
                        <b>{money(book.closing)}</b>
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
