"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { Dialog } from "@/components/ui/dialog";
import { KpiTile } from "@/components/ui/kpi-tile";
import { formatDate, formatMoney, sumByCurrency } from "@/lib/format";
import type { FinanceRefs, ReadyBudget } from "@/lib/siba/finance";
import { directionText } from "@/lib/siba/classification";

/**
 * The "Budget Siap Direalisasi" tile — what this menu can still realize, per
 * currency — and its Rincian. A Budget that lowers a position but whose
 * Partner holds no open item cannot be posted yet, so it is marked.
 */
export function ReadyBudgetTile({
  budgets,
  refs,
  direction,
}: {
  budgets: ReadyBudget[];
  refs: FinanceRefs;
  direction: "In" | "Out";
}) {
  const [open, setOpen] = useState(false);
  const label = (list: { id: number; label: string }[], id: number | null) =>
    list.find((x) => x.id === id)?.label ?? "";
  const totals = sumByCurrency(
    budgets.map((b) => ({
      currencyId: b.currency_id,
      currencyLabel: label(refs.currencies, b.currency_id),
      amount: b.outstanding,
    }))
  );
  const blocked = budgets.filter((b) => b.lowers && !b.openItems).length;

  return (
    <>
      <KpiTile
        icon="send"
        tone="t-info"
        label="Budget Siap Direalisasi"
        more="Rincian"
        lines={totals.map((t) => formatMoney(t.amount, t.currencyLabel))}
        detail={
          budgets.length ? (
            <>
              {budgets.length} Budget · tertua {formatDate(budgets[0].budget_date)}
              {blocked > 0 && (
                <span className="neg"> · {blocked} belum bisa direalisasi</span>
              )}
            </>
          ) : (
            "tidak ada Budget yang menunggu"
          )
        }
        onClick={() => setOpen(true)}
      />
      {open && (
        <Dialog
          open
          icon="send"
          tone="brand"
          width={860}
          title="Budget Siap Direalisasi"
          subtitle={`Budget ${directionText(direction)} berstatus Open yang masih bersisa`}
          onClose={() => setOpen(false)}
          foot={
            <button className="btn primary" onClick={() => setOpen(false)}>
              Tutup
            </button>
          }
        >
          {budgets.length ? (
            <div className="tw boxed">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Budget</th>
                    <th style={{ width: 80 }}>Company</th>
                    <th style={{ width: 190 }}>Open Item</th>
                    <th className="num" style={{ width: 170 }}>
                      Sisa
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {budgets.map((b) => {
                    const currency = label(refs.currencies, b.currency_id);
                    const partner = refs.partners.find((p) => p.id === b.partner_id);
                    return (
                      <tr key={b.id} style={{ cursor: "default" }}>
                        <td>
                          <div className="pri">{b.description}</div>
                          <div className="rsub">
                            {b.budget_no} · {formatDate(b.budget_date)} ·{" "}
                            {label(refs.categories, b.category_id)}
                            {partner ? ` · ${partner.name}` : ""}
                          </div>
                        </td>
                        <td className="mut">{label(refs.companies, b.company_id)}</td>
                        <td>
                          {!b.lowers ? (
                            <span className="dash">—</span>
                          ) : b.openItems ? (
                            <span className="mut">
                              {b.openItems} item ·{" "}
                              <Amount value={b.openItemsRemaining} currency={currency} />
                            </span>
                          ) : (
                            <span className="neg">
                              <Icon name="warn" size={11} /> tidak ada open item
                            </span>
                          )}
                        </td>
                        <td className="num">
                          <Amount value={b.outstanding} currency={currency} />
                        </td>
                      </tr>
                    );
                  })}
                  {totals.map((t) => (
                    <tr className="totrow" key={t.currencyId}>
                      <td colSpan={3}>Total {t.currencyLabel}</td>
                      <td className="num">
                        <Amount value={t.amount} currency={t.currencyLabel} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty sm">
              <div className="ic">
                <Icon name="send" size={20} />
              </div>
              <h4>Tidak ada Budget yang menunggu</h4>
              <p>Budget muncul di sini setelah diklasifikasi menjadi Open.</p>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
