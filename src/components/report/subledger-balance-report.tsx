"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ExpandAll } from "@/components/ui/expand-all";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "@/lib/siba/currency";
import { reportHref } from "@/lib/siba/reports";
import type { SubledgerBalanceReport as Report } from "@/lib/siba/subledger";

/**
 * Saldo Buku Subjek — the summary half of the subject-book pair, drawn the way
 * Saldo Kas & Bank is: one section per currency, one row per Partner with its
 * opening, what raised and lowered it, and its closing, totalled per currency.
 *
 * Each Partner row folds open onto the **open items its closing is made of**,
 * as they stood on the period's last day, each at the kurs it was raised at —
 * which is the question the old Posisi Open Item answered on its own page,
 * with no way to see how the position got there. The Partner's name opens its
 * Buku Subjek for the same book and period: a summary figure should be one
 * click from the entries that produced it.
 *
 * The tree reuses the statements' fold (`table.grid.stm`), so the chevron,
 * the indentation and Buka / Tutup Semua read as they do on the Laba Rugi.
 */
export function SubledgerBalanceReport({
  report,
  companyId,
}: {
  report: Report;
  companyId: number;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const keyOf = (r: { partnerId: number; currencyId: number }) =>
    `${r.partnerId}:${r.currencyId}`;

  const rows = report.groups.flatMap((g) => g.rows);
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

  const foldable = rows.filter((r) => r.items.length > 0);
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const bookHref = (partnerId: number) =>
    reportHref("subledger", {
      company: companyId,
      book: report.book.key,
      partners: partnerId,
      from: report.range.from,
      to: report.range.to,
    });

  return (
    <>
      <div className="rhead">
        <span className="count">
          <b>{rows.length}</b> Partner · {formatDate(report.range.from)} –{" "}
          {formatDate(report.range.to)} · {report.book.closingLabel} bertambah saat{" "}
          {report.book.raises === "In" ? "penerimaan uang" : "pengeluaran uang"}
        </span>
        <div className="tspace" />
        {foldable.length > 0 && (
          <ExpandAll
            onExpand={() => setOpen(new Set(foldable.map(keyOf)))}
            onCollapse={() => setOpen(new Set())}
            allOpen={open.size === foldable.length}
            allClosed={open.size === 0}
          />
        )}
      </div>

      {report.groups.map((g) => {
        const money = (n: number) => formatMoney(n, g.currencyLabel);
        const foreign = !isBaseCurrency(g.currencyLabel);
        const base = (n: number) => formatMoney(n, BASE_CURRENCY_LABEL);
        return (
          <div className="cblock" key={g.currencyId}>
            <div className="cbh">
              <b>{g.currencyLabel}</b>
              <span className="cbn">{g.rows.length} Partner</span>
            </div>

            <div className="tw">
              <table className="grid stm" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th>Partner</th>
                    <th className="num" style={{ width: 140 }}>
                      Saldo Awal
                    </th>
                    <th className="num" style={{ width: 140 }}>
                      Bertambah
                    </th>
                    <th className="num" style={{ width: 140 }}>
                      Berkurang
                    </th>
                    <th className="num" style={{ width: 172 }}>
                      {report.book.closingLabel}
                    </th>
                    {foreign && (
                      <th className="num" style={{ width: 150 }}>
                        Nilai {BASE_CURRENCY_LABEL}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => {
                    const k = keyOf(r);
                    const isOpen = open.has(k);
                    return (
                      <PartnerRows
                        key={k}
                        isOpen={isOpen}
                        onToggle={() => toggle(k)}
                        row={r}
                        href={bookHref(r.partnerId)}
                        foreign={foreign}
                        money={money}
                        base={base}
                      />
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="totrow">
                    <td style={{ textAlign: "right" }}>Total {g.currencyLabel}</td>
                    <td className="num">{money(g.opening)}</td>
                    <td className="num">{money(g.raised)}</td>
                    <td className="num">{money(g.lowered)}</td>
                    <td className="num">
                      <b>{money(g.closing)}</b>
                    </td>
                    {foreign && (
                      <td className="num">
                        <b>{base(g.baseClosing)}</b>
                      </td>
                    )}
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

function PartnerRows({
  row: r,
  isOpen,
  onToggle,
  href,
  foreign,
  money,
  base,
}: {
  row: Report["groups"][number]["rows"][number];
  isOpen: boolean;
  onToggle: () => void;
  href: string;
  foreign: boolean;
  money: (n: number) => string;
  base: (n: number) => string;
}) {
  const figure = (n: number, strong = false) => (
    <span className={`mny${n ? "" : " z"}${n < 0 ? " neg" : ""}`}>
      {strong ? <b>{money(n)}</b> : money(n)}
    </span>
  );
  return (
    <>
      <tr>
        <td className="stn">
          <div className="stc">
            {r.items.length ? (
              <button
                className="tgl"
                onClick={onToggle}
                title={isOpen ? "Tutup open item" : "Buka open item"}
              >
                <span className={`chev${isOpen ? " o" : ""}`}>
                  <Icon name="chev" size={11} />
                </span>
              </button>
            ) : (
              <span className="tgl" />
            )}
            <Link className="lab" href={href} title="Buka Buku Subjek Partner ini">
              {r.label}
            </Link>
            <span className="nm">{r.name}</span>
            {!r.active && <span className="bdg s-bad">Non Aktif</span>}
            {!r.reconciles && (
              <span
                className="bdg s-warn"
                title="Posisi tersimpan tidak sama dengan jumlah entri buku — gangguan sistem"
              >
                selisih
              </span>
            )}
            {r.items.length > 0 && (
              <span className="cd">{r.items.length} open item</span>
            )}
          </div>
        </td>
        <td className="num">{figure(r.opening)}</td>
        <td className="num">{figure(r.raised)}</td>
        <td className="num">{figure(r.lowered)}</td>
        <td className="num">{figure(r.closing, true)}</td>
        {foreign && (
          <td className="num">
            <span className={`mny${r.baseClosing ? "" : " z"}`}>
              {base(r.baseClosing)}
            </span>
          </td>
        )}
      </tr>
      {isOpen &&
        r.items.map((i) => (
          <tr key={i.id} className="st-par">
            <td className="stn d2">
              <div className="stc">
                <span className="cd">{i.itemNo}</span>
                <span className="cd">{formatDate(i.date)}</span>
                {foreign && <span className="cd">@ {formatRate(i.rate)}</span>}
                <span className="nm">{i.note ?? "—"}</span>
              </div>
            </td>
            <td className="num" colSpan={3}>
              <span className="mny z">awal {money(i.original)}</span>
            </td>
            <td className="num">
              <span className="mny">{money(i.remaining)}</span>
            </td>
            {foreign && (
              <td className="num">
                <span className="mny">{base(i.baseRemaining)}</span>
              </td>
            )}
          </tr>
        ))}
    </>
  );
}
