"use client";

import { useEffect } from "react";
import { Icon } from "@/components/icon";
import { formatMoney, formatNumber } from "@/lib/format";
import { RATES } from "@/lib/siba/rules";
import type { CashPlaceholder } from "@/lib/siba/budget";

/**
 * The breakdown behind the "Saldo Kas & Bank" card.
 *
 * Every figure here is a PLACEHOLDER read from `m_cash_bank.balance`, the
 * mock-only column CLAUDE.md §9 slates for deletion. The real balance is
 * derived from the Cash Bank Ledger, which arrives in V2. The dialog says so
 * plainly rather than presenting a number that looks authoritative — do not
 * remove that notice while the source is still the mock column.
 */
export function CashPlaceholderDialog({
  cash,
  onClose,
}: {
  cash: CashPlaceholder;
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
        style={{ width: "min(640px, 100%)" }}
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
                background: "var(--warn-bg)",
                color: "var(--warn)",
              }}
            >
              <Icon name="wallet2" size={18} />
            </span>
            <div>
              <h3 style={{ margin: 0, textAlign: "left" }}>
                Saldo Kas &amp; Bank{" "}
                <span className="bdg s-warn">Sementara</span>
              </h3>
              <p style={{ textAlign: "left", marginTop: 2 }}>
                Angka perkiraan per currency, belum berasal dari ledger
              </p>
            </div>
          </div>

          {cash.byCurrency.length ? (
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
                    <th>Currency</th>
                    <th className="num" style={{ width: 170 }}>
                      Saldo
                    </th>
                    <th className="num" style={{ width: 170 }}>
                      Setara IDR
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cash.byCurrency.map((c) => (
                    <tr key={c.currencyLabel} style={{ cursor: "default" }}>
                      <td className="pri">
                        <span className="lab">{c.currencyLabel}</span>
                      </td>
                      <td className="num">
                        <span className="mny">
                          {formatMoney(c.amount, c.currencyLabel)}
                        </span>
                      </td>
                      <td className="num">
                        <span className="mny">Rp {formatNumber(c.base)}</span>
                      </td>
                    </tr>
                  ))}
                  <tr className="totrow">
                    <td colSpan={2}>Total setara IDR</td>
                    <td className="num">
                      <span className="mny">Rp {formatNumber(cash.totalBase)}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ textAlign: "left" }}>
              Belum ada resource Kas &amp; Bank yang aktif.
            </p>
          )}

          <div className="apmap warn" style={{ marginTop: 12 }}>
            <Icon name="warn" size={13} /> Angka ini masih diambil dari kolom
            saldo pada master Cash &amp; Bank dan belum mencerminkan transaksi
            apa pun. Saldo sebenarnya akan dihitung dari Cash Bank Ledger.
          </div>

          <p
            style={{
              textAlign: "left",
              marginTop: 11,
              fontSize: 11,
              color: "var(--muted-2)",
            }}
          >
            Kurs konversi sementara: USD 1 = Rp {formatNumber(RATES.USD)} · SGD 1
            = Rp {formatNumber(RATES.SGD)}
          </p>

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
