"use client";

import { useEffect } from "react";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import type { CashBookSummary } from "@/lib/siba/cash-bank";

/**
 * The breakdown behind the "Saldo Kas & Bank" card.
 *
 * Every figure comes from the Cash Bank Book — `cash_bank_balance`, kept in
 * step with `cash_bank_ledger` — so it is the resource's actual balance, not an
 * estimate. Balances are reported per currency and never added across them:
 * combining them would need an exchange rate the system has no source for.
 */
export function CashBalanceDialog({
  cash,
  onClose,
}: {
  cash: CashBookSummary;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="ovl"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        style={{ width: "min(720px, 100%)" }}
      >
        <div style={{ textAlign: "left" }}>
          <div
            style={{
              display: "flex",
              gap: 11,
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            <span
              className="mi"
              style={{
                margin: 0,
                width: 38,
                height: 38,
                background: "var(--ok-bg)",
                color: "var(--ok)",
              }}
            >
              <Icon name="wallet2" size={18} />
            </span>
            <div>
              <h3 style={{ margin: 0, textAlign: "left" }}>Saldo Kas &amp; Bank</h3>
              <p style={{ textAlign: "left", marginTop: 2 }}>
                Saldo per resource menurut Cash Bank Book
              </p>
            </div>
          </div>

          {cash.rows.length ? (
            <>
              <div
                className="tw"
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r)",
                  overflow: "hidden",
                }}
              >
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Resource</th>
                      <th style={{ width: 110 }}>Company</th>
                      <th style={{ width: 132 }}>Entri Terakhir</th>
                      <th className="num" style={{ width: 176 }}>
                        Saldo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cash.rows.map((r) => (
                      <tr key={r.cashBankId} style={{ cursor: "default" }}>
                        <td>
                          <span className="idc">
                            <span className="lab">{r.label}</span>
                            <span className="nm">{r.name}</span>
                          </span>
                        </td>
                        <td className="mut">{r.companyLabel}</td>
                        <td className="mut" style={{ fontSize: "11.5px" }}>
                          {r.lastEntryDate ? (
                            formatDate(r.lastEntryDate)
                          ) : (
                            <span className="dash">belum ada entri</span>
                          )}
                        </td>
                        <td className="num">
                          <span className={`mny${r.balance ? "" : " z"}`}>
                            {formatMoney(r.balance, r.currencyLabel)}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {cash.byCurrency.map((c) => (
                      <tr className="totrow" key={c.currencyId}>
                        <td colSpan={3}>
                          Total {c.currencyLabel} · {c.resources} resource
                        </td>
                        <td className="num">
                          <span className="mny">
                            {formatMoney(c.balance, c.currencyLabel)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {cash.byCurrency.length > 1 && (
                <p
                  style={{
                    textAlign: "left",
                    marginTop: 11,
                    fontSize: 11,
                    color: "var(--muted-2)",
                  }}
                >
                  Saldo dijumlahkan per currency dan tidak digabungkan menjadi
                  satu angka — konversi memerlukan kurs yang belum tersedia.
                </p>
              )}
            </>
          ) : (
            <div className="empty" style={{ padding: "30px 20px" }}>
              <div className="ic">
                <Icon name="wallet2" size={20} />
              </div>
              <h4>Belum ada resource Kas &amp; Bank</h4>
              <p>
                Daftarkan resource pada Master · Cash &amp; Bank, lengkap dengan
                saldo awalnya, agar saldo mulai tercatat di sini.
              </p>
            </div>
          )}

          <div className="mf">
            <button className="btn primary" onClick={onClose}>
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
