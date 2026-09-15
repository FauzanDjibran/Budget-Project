"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import type { BudgetRefs, BudgetRow } from "@/lib/siba/budget";
import type { CashBookSummary } from "@/lib/siba/cash-bank";

/**
 * Laporan Pengajuan — the picker that decides which Submitted budgets go into
 * a submission report, with an opening -> closing recap per currency.
 *
 * The opening balance comes from the Cash Bank Book, so the recap reflects what
 * the resources actually hold. Each currency is recapped on its own line and
 * never combined, since there is no exchange rate to combine them with.
 *
 * **The XLSX export is deliberately not built.** The picker is here so the
 * feature is visible and its selection behaviour can be exercised; the download
 * button is inert and says so. Writing the spreadsheet is its own piece of work.
 */
const money = formatMoney;

export function ReportPicker({
  budgets,
  refs,
  cash,
  periodName,
  onClose,
}: {
  /** Already narrowed to Submitted budgets in the current month scope. */
  budgets: BudgetRow[];
  refs: BudgetRefs;
  cash: CashBookSummary;
  periodName: string | null;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(budgets.map((b) => [b.id, true]))
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const currencyLabel = useMemo(() => {
    const byId = new Map(refs.currencies.map((c) => [c.id, c.label]));
    return (id: number) => byId.get(id) ?? "IDR";
  }, [refs.currencies]);

  const companyLabel = useMemo(() => {
    const byId = new Map(refs.companies.map((c) => [c.id, c.label]));
    return (id: number) => byId.get(id) ?? "—";
  }, [refs.companies]);

  /** Every currency that appears in the report — budgets or cash resources. */
  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const b of budgets) set.add(currencyLabel(b.currency_id));
    for (const c of cash.byCurrency) set.add(c.currencyLabel);
    return [...set].sort((a, b) =>
      a === "IDR" ? -1 : b === "IDR" ? 1 : a.localeCompare(b)
    );
  }, [budgets, cash.byCurrency, currencyLabel]);

  const chosen = budgets.filter((b) => selected[b.id]);
  const allOn = budgets.length > 0 && chosen.length === budgets.length;

  const recapOf = (cur: string) => {
    const opening =
      cash.byCurrency.find((c) => c.currencyLabel === cur)?.balance ?? 0;
    const mine = chosen.filter((b) => currencyLabel(b.currency_id) === cur);
    const inn = mine
      .filter((b) => b.budget_type === "In")
      .reduce((t, b) => t + b.budget_amount, 0);
    const out = mine
      .filter((b) => b.budget_type === "Out")
      .reduce((t, b) => t + b.budget_amount, 0);
    return { opening, inn, out, closing: opening + inn - out };
  };

  const setAll = (on: boolean) =>
    setSelected(Object.fromEntries(budgets.map((b) => [b.id, on])));

  const setCurrency = (cur: string, on: boolean) =>
    setSelected((s) => {
      const next = { ...s };
      for (const b of budgets) {
        if (currencyLabel(b.currency_id) === cur) next[b.id] = on;
      }
      return next;
    });

  return (
    <div
      className="ovl"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal modal-flex"
        role="dialog"
        aria-modal="true"
        style={{ width: "min(900px, 94vw)" }}
      >
        <div className="rp-head">
          <span
            className="mi"
            style={{
              margin: 0,
              width: 34,
              height: 34,
              background: "var(--brand-50)",
              color: "var(--brand)",
            }}
          >
            <Icon name="print" size={16} />
          </span>
          <div className="t">
            <h3>Laporan Pengajuan Budget</h3>
            <p>
              Tandai budget berstatus Diajukan yang masuk ke laporan
              {periodName ? ` · ${periodName}` : ""}
            </p>
          </div>
          {budgets.length > 0 && (
            <label className="allbox">
              <input
                type="checkbox"
                checked={allOn}
                onChange={(e) => setAll(e.target.checked)}
              />
              <span>Tandai semua</span>
            </label>
          )}
        </div>

        <div className="rp-body">
          {budgets.length ? (
            <>
              <div className="rp-sec">Ringkasan Laporan</div>
              <div className="rcp-stick">
                <table className="rcp">
                  <thead>
                    <tr>
                      <th />
                      <th className="num">Opening Balance</th>
                      <th className="num">
                        Total In<span>Penerimaan</span>
                      </th>
                      <th className="num">
                        Total Out<span>Pengeluaran</span>
                      </th>
                      <th className="num">Closing Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currencies.map((cur) => {
                      const k = recapOf(cur);
                      return (
                        <tr key={cur}>
                          <td className="lb">Total Budget ({cur})</td>
                          <td className="num">{money(k.opening, cur)}</td>
                          <td className={`num${k.inn ? " pos" : " z"}`}>
                            {money(k.inn, cur)}
                          </td>
                          <td className={`num${k.out ? " neg" : " z"}`}>
                            {money(k.out, cur)}
                          </td>
                          <td className="num tot">{money(k.closing, cur)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="help" style={{ margin: "8px 2px 0" }}>
                <Icon name="wallet2" size={11} /> Opening Balance diambil dari Cash
                Bank Book, yaitu saldo seluruh resource aktif pada currency
                tersebut. Setiap currency direkap terpisah.
              </p>

              <div className="rp-sec">Isi Laporan per Currency</div>
              {currencies.map((cur) => {
                const mine = budgets
                  .filter((b) => currencyLabel(b.currency_id) === cur)
                  .sort((a, b) => a.budget_date.localeCompare(b.budget_date));
                const on = mine.filter((b) => selected[b.id]).length;
                const k = recapOf(cur);
                return (
                  <div className="cblock" key={cur}>
                    <div className="cbh">
                      <label className="cbx2">
                        <input
                          type="checkbox"
                          checked={mine.length > 0 && on === mine.length}
                          disabled={mine.length === 0}
                          onChange={(e) => setCurrency(cur, e.target.checked)}
                        />
                      </label>
                      <b>Budget — {cur === "IDR" ? "Rupiah (IDR)" : cur}</b>
                      <span className="cbn">
                        {on} / {mine.length} dipilih
                      </span>
                      <span className="cbo2">
                        Opening {money(k.opening, cur)}
                      </span>
                    </div>

                    {mine.length ? (
                      <table className="grid pkt">
                        <thead>
                          <tr>
                            <th style={{ width: 38 }} />
                            <th style={{ width: 100 }}>Nomor</th>
                            <th style={{ width: 110 }}>Tanggal</th>
                            <th>Deskripsi</th>
                            <th style={{ width: 88 }}>Company</th>
                            <th className="num" style={{ width: 118 }}>
                              Penerimaan
                            </th>
                            <th className="num" style={{ width: 118 }}>
                              Pengeluaran
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {mine.map((b) => {
                            const on = Boolean(selected[b.id]);
                            const out = b.budget_type === "Out";
                            return (
                              <tr
                                key={b.id}
                                className={on ? "on" : "off"}
                                onClick={() =>
                                  setSelected((s) => ({ ...s, [b.id]: !s[b.id] }))
                                }
                              >
                                <td>
                                  <label
                                    className="cbx2"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={on}
                                      onChange={(e) =>
                                        setSelected((s) => ({
                                          ...s,
                                          [b.id]: e.target.checked,
                                        }))
                                      }
                                    />
                                  </label>
                                </td>
                                <td>
                                  <span className="lab">{b.budget_no}</span>
                                </td>
                                <td className="mono" style={{ fontSize: "11.5px" }}>
                                  {formatDate(b.budget_date)}
                                </td>
                                <td className="pri wrapok">{b.description}</td>
                                <td
                                  className="mono mut"
                                  style={{ fontSize: "11px" }}
                                >
                                  {companyLabel(b.company_id)}
                                </td>
                                <td className="num">
                                  {!out ? (
                                    <span className="mny in">
                                      {money(b.budget_amount, cur)}
                                    </span>
                                  ) : (
                                    <span className="dash">–</span>
                                  )}
                                </td>
                                <td className="num">
                                  {out ? (
                                    <span className="mny">
                                      {money(b.budget_amount, cur)}
                                    </span>
                                  ) : (
                                    <span className="dash">–</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="ptot">
                            <td colSpan={5}>Total dipilih</td>
                            <td className="num">{money(k.inn, cur)}</td>
                            <td className="num">{money(k.out, cur)}</td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <div className="cbnone">
                        Tidak ada budget {cur} berstatus Diajukan. Bagian ini
                        tetap muncul di laporan dengan catatan penjelas.
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="empty" style={{ padding: "30px 12px" }}>
              <div className="ic">
                <Icon name="print" size={20} />
              </div>
              <h4>Tidak ada budget yang diajukan</h4>
              <p>
                Hanya budget berstatus Diajukan yang dapat dimasukkan ke laporan
                pengajuan.
              </p>
            </div>
          )}
        </div>

        <div className="mf rp-foot">
          <span className="fnote">
            <b>{chosen.length}</b> dari {budgets.length} budget ditandai
            {budgets.length > 0 && " · Ringkasan, lalu satu bagian per currency"}
          </span>
          <button className="btn" onClick={onClose}>
            Tutup
          </button>
          <button
            className="btn primary"
            disabled
            title="Ekspor XLSX belum tersedia."
          >
            <Icon name="down" size={14} /> Unduh XLSX
            {chosen.length > 0 && ` (${chosen.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
