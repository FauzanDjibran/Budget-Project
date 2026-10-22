"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { Dialog } from "@/components/ui/dialog";
import { KpiTile } from "@/components/ui/kpi-tile";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import type { LayerReport } from "@/lib/siba/cash-bank-layers";

/**
 * The "Posisi Layer Kurs" tile — foreign currency held and its open layers,
 * one line per currency — and its Rincian, every open layer beside the Cash &
 * Bank it sits in. Read on the screens where a layer is chosen.
 */
export function LayerPositionTile({ report }: { report: LayerReport }) {
  const [open, setOpen] = useState(false);
  const currencies = byCurrency(report);
  const broken = report.blocks.filter((b) => !b.reconciles).length;
  return (
    <>
      <KpiTile
        icon="layers"
        tone="t-vio"
        label="Posisi Layer Kurs"
        more="Rincian"
        lines={currencies.map(
          (c) => `${formatMoney(c.foreign, c.currencyLabel)} · ${c.layers.length} layer`
        )}
        detail={
          broken ? (
            <span className="neg">{broken} resource tidak cocok dengan buku</span>
          ) : (
            `${report.resources} resource valas`
          )
        }
        onClick={() => setOpen(true)}
      />
      {open && (
        <Dialog
          open
          icon="layers"
          tone="brand"
          width={760}
          title="Posisi Layer Kurs"
          subtitle="Layer terbuka per currency, terlama lebih dulu"
          onClose={() => setOpen(false)}
          foot={
            <button className="btn primary" onClick={() => setOpen(false)}>
              Tutup
            </button>
          }
        >
          {currencies.length ? (
            <div className="tw boxed">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Cash &amp; Bank</th>
                    <th style={{ width: 104 }}>Tanggal</th>
                    <th className="num" style={{ width: 120 }}>
                      Kurs
                    </th>
                    <th className="num" style={{ width: 170 }}>
                      Sisa
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {currencies.map((c) => (
                    <CurrencyRows key={c.currencyLabel} group={c} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty sm">
              <div className="ic">
                <Icon name="layers" size={20} />
              </div>
              <h4>Belum ada layer terbuka</h4>
              <p>Layer terbentuk saat valas masuk ke Cash &amp; Bank valas.</p>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

type Group = ReturnType<typeof byCurrency>[number];

function CurrencyRows({ group }: { group: Group }) {
  return (
    <>
      {group.layers.map((l) => (
        <tr key={l.id} style={{ cursor: "default" }}>
          <td>
            <span className="idc">
              <span className="lab">{l.cashBankLabel}</span>
              <span className="nm">{l.cashBankName}</span>
            </span>
            {!l.reconciles && (
              <span className="lwarn">
                <Icon name="warn" size={11} /> tidak cocok dengan buku
              </span>
            )}
          </td>
          <td className="mut">{formatDate(l.date)}</td>
          <td className="num">{formatRate(l.rate)}</td>
          <td className="num">
            <Amount value={l.foreignRemaining} currency={group.currencyLabel} />
          </td>
        </tr>
      ))}
      <tr className="totrow">
        <td colSpan={3}>
          Total {group.currencyLabel} · {group.layers.length} layer
        </td>
        <td className="num">
          <Amount value={group.foreign} currency={group.currencyLabel} />
        </td>
      </tr>
    </>
  );
}

/** Open layers grouped per currency — never added across currencies. */
function byCurrency(report: LayerReport) {
  const groups = new Map<
    string,
    {
      currencyLabel: string;
      foreign: number;
      layers: (LayerReport["blocks"][number]["layers"][number] & {
        cashBankLabel: string;
        cashBankName: string;
        reconciles: boolean;
      })[];
    }
  >();
  for (const b of report.blocks) {
    const g = groups.get(b.currencyLabel) ?? {
      currencyLabel: b.currencyLabel,
      foreign: 0,
      layers: [],
    };
    for (const l of b.layers) {
      if (l.status !== "Open" || l.foreignRemaining <= 0) continue;
      g.foreign += l.foreignRemaining;
      g.layers.push({
        ...l,
        cashBankLabel: b.label,
        cashBankName: b.name,
        reconciles: b.reconciles,
      });
    }
    groups.set(b.currencyLabel, g);
  }
  return [...groups.values()]
    .filter((g) => g.layers.length)
    .map((g) => ({
      ...g,
      layers: g.layers.sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq),
    }))
    .sort((a, b) => a.currencyLabel.localeCompare(b.currencyLabel));
}
