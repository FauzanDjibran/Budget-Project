"use client";

import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
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
  return (
    <Dialog
      open
      icon="wallet2"
      tone="ok"
      width={720}
      title="Saldo Kas & Bank"
      subtitle="Saldo per resource menurut Cash Bank Book"
      onClose={onClose}
      foot={
        <button className="btn primary" onClick={onClose}>
          Tutup
        </button>
      }
    >
      {cash.rows.length ? (
        <>
          <div className="tw boxed">
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
            <p className="foot-note">
              Saldo dijumlahkan per currency dan tidak digabungkan menjadi
              satu angka — konversi memerlukan kurs yang belum tersedia.
            </p>
          )}
        </>
      ) : (
        <div className="empty sm">
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

    </Dialog>
  );
}
