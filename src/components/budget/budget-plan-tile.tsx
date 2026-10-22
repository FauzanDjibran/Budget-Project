"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { Dialog } from "@/components/ui/dialog";
import { KpiTile } from "@/components/ui/kpi-tile";
import { formatMoney, sumByCurrency } from "@/lib/format";
import type { BudgetRow } from "@/lib/siba/budget";
import { directionText } from "@/lib/siba/classification";

/**
 * "Rencana Pengeluaran" / "Rencana Penerimaan" — the nominal of the Budgets
 * on the selected tab, one line per currency, and its Rincian by Budget
 * Category. The label names the tab, so a figure is never read as the whole
 * plan when it is one stage of it.
 */
export function BudgetPlanTile({
  budgets,
  direction,
  tabLabel,
  showRemaining,
  currencyOf,
  categoryOf,
}: {
  /** This direction's Budgets on the selected tab. */
  budgets: BudgetRow[];
  direction: "In" | "Out";
  tabLabel: string;
  /** On Open, what is still to be realized is the figure being worked down. */
  showRemaining: boolean;
  currencyOf: (id: number) => string;
  categoryOf: (id: number | null) => { label: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const title = `Rencana ${directionText(direction)}`;
  const money = (b: BudgetRow, amount: number) => ({
    currencyId: b.currency_id,
    currencyLabel: currencyOf(b.currency_id),
    amount,
  });
  const totals = sumByCurrency(budgets.map((b) => money(b, b.budget_amount)));
  const remaining = sumByCurrency(
    budgets.map((b) => money(b, Math.max(0, b.budget_amount - b.realized_amount)))
  );

  // One row per Budget Category × currency, in category order.
  const groups = new Map<string, { label: string; currency: string; count: number; amount: number; left: number }>();
  for (const b of budgets) {
    const label = categoryOf(b.category_id)?.label ?? "Belum diklasifikasi";
    const currency = currencyOf(b.currency_id);
    const key = `${label}|${currency}`;
    const g = groups.get(key) ?? { label, currency, count: 0, amount: 0, left: 0 };
    g.count += 1;
    g.amount += b.budget_amount;
    g.left += Math.max(0, b.budget_amount - b.realized_amount);
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort(
    (a, b) => a.label.localeCompare(b.label, "id") || a.currency.localeCompare(b.currency)
  );

  return (
    <>
      <KpiTile
        icon={direction === "Out" ? "out" : "down"}
        tone={direction === "Out" ? "t-warn" : "t-ok"}
        label={`${title} · ${tabLabel}`}
        more="Rincian"
        lines={totals.map((t) => formatMoney(t.amount, t.currencyLabel))}
        detail={
          showRemaining && budgets.length
            ? `${budgets.length} Budget · sisa ${remaining.map((t) => formatMoney(t.amount, t.currencyLabel)).join(" · ") || "—"}`
            : `${budgets.length} Budget`
        }
        onClick={() => setOpen(true)}
      />
      {open && (
        <Dialog
          open
          icon={direction === "Out" ? "out" : "down"}
          tone="brand"
          width={720}
          title={title}
          subtitle={`Budget ${directionText(direction)} pada tab ${tabLabel}, per Budget Category`}
          onClose={() => setOpen(false)}
          foot={
            <button className="btn primary" onClick={() => setOpen(false)}>
              Tutup
            </button>
          }
        >
          {rows.length ? (
            <div className="tw boxed">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Budget Category</th>
                    <th className="num" style={{ width: 80 }}>
                      Budget
                    </th>
                    <th className="num" style={{ width: 170 }}>
                      Nominal
                    </th>
                    {showRemaining && (
                      <th className="num" style={{ width: 170 }}>
                        Sisa
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.label}|${r.currency}`} style={{ cursor: "default" }}>
                      <td className="pri">{r.label}</td>
                      <td className="num mut">{r.count}</td>
                      <td className="num">
                        <Amount value={r.amount} currency={r.currency} />
                      </td>
                      {showRemaining && (
                        <td className="num">
                          <Amount value={r.left} currency={r.currency} />
                        </td>
                      )}
                    </tr>
                  ))}
                  {totals.map((t) => (
                    <tr className="totrow" key={t.currencyId}>
                      <td colSpan={2}>Total {t.currencyLabel}</td>
                      <td className="num">
                        <Amount value={t.amount} currency={t.currencyLabel} />
                      </td>
                      {showRemaining && (
                        <td className="num">
                          <Amount
                            value={remaining.find((x) => x.currencyId === t.currencyId)?.amount ?? 0}
                            currency={t.currencyLabel}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty sm">
              <div className="ic">
                <Icon name="clip" size={20} />
              </div>
              <h4>Tidak ada Budget {directionText(direction)}</h4>
              <p>Tidak ada Budget {directionText(direction)} pada tab {tabLabel}.</p>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
