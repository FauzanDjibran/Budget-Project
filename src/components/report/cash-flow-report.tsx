"use client";

import { Fragment, useState } from "react";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { ExpandAll } from "@/components/ui/expand-all";
import type { CashFlowGroup, CashFlowReport as Report, CashFlowRow } from "@/lib/siba/cash-bank";

/**
 * The Laporan Arus Kas: PSAK 207's direct method, one currency, one column per
 * period and a Jumlah. Saldo Awal on top, then per group its gross receipts,
 * its gross payments in brackets and its Arus Kas Neto; then the net change
 * and Saldo Akhir. Drawn on the statements' table (`grid stm`) and folded the
 * way they fold: a group closes to its Arus Kas Neto, and the Partner is the
 * smallest detail.
 */
export function CashFlowReport({ report }: { report: Report }) {
  const groupKey = (g: CashFlowGroup) => String(g.id ?? "none");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setClosed((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const cur = report.currencyLabel;
  const n = report.columns.length;
  const sum = (rows: CashFlowRow[]) => report.columns.map((_, i) => rows.reduce((t, r) => t + r.values[i], 0));
  const withTotal = (v: number[]) => [...v, v.reduce((t, x) => t + x, 0)];
  const net = report.columns.map(
    (_, i) => report.groups.reduce((t, g) => t + sum([...g.receipts, ...g.payments])[i], 0) + report.registered[i]
  );

  const name = (text: string, depth: number, fold?: { open: boolean; onToggle: () => void }) => (
    <td className={`stn d${depth}`}>
      <div className="stc">
        {fold ? (
          <button type="button" className="tgl" onClick={fold.onToggle} title={fold.open ? "Tutup" : "Buka"}>
            <span className={`chev${fold.open ? " o" : ""}`}>
              <Icon name="chev" size={11} />
            </span>
          </button>
        ) : (
          <span className="tgl" />
        )}
        <span className="nm">{text}</span>
      </div>
    </td>
  );
  const figures = (values: number[]) =>
    values.map((v, i) => (
      <td className="num" key={i}>
        <Amount value={v} currency={cur} ledger nil="dash" />
      </td>
    ));
  const line = (text: string, values: number[], cls: string, depth: number) => (
    <tr className={cls}>
      {name(text, depth)}
      {figures(values)}
    </tr>
  );
  const blankFigures = <td colSpan={n + 1} />;

  return (
    <>
      <div className="rhead">
        <span className="count">
          <b>{report.resources}</b> Cash &amp; Bank {cur} · {n} periode
        </span>
        <ExpandAll
          onExpand={() => setClosed(new Set())}
          onCollapse={() => setClosed(new Set(report.groups.map(groupKey)))}
          allOpen={closed.size === 0}
          allClosed={closed.size === report.groups.length}
        />
      </div>

      <div className="tw">
        <table className="grid stm">
          <thead>
            <tr>
              <th>Keterangan</th>
              {report.columns.map((c) => (
                <th className="num" key={c.from}>
                  {c.label}
                </th>
              ))}
              <th className="num">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {line(`Saldo Awal Kas & Bank (${cur})`, [...report.opening, report.opening[0] ?? 0], "st-res", 0)}

            {report.groups.map((g) => {
              const k = groupKey(g);
              const open = !closed.has(k);
              const groupNet = withTotal(sum([...g.receipts, ...g.payments]));
              const side = (title: string, rows: CashFlowRow[]) =>
                rows.length > 0 && (
                  <>
                    <tr className="st-sub">
                      {name(title, 1)}
                      {blankFigures}
                    </tr>
                    {rows.map((r) => (
                      <Fragment key={r.key}>{line(r.name, withTotal(r.values), "", 2)}</Fragment>
                    ))}
                    {line(`Jumlah ${title}`, withTotal(sum(rows)), "st-sub", 1)}
                  </>
                );
              return (
                <Fragment key={k}>
                  <tr className="st-step">
                    {name(`Arus Kas dari Aktivitas ${g.name}`, 0, { open, onToggle: () => toggle(k) })}
                    {open ? blankFigures : figures(groupNet)}
                  </tr>
                  {open && (
                    <>
                      {side("Penerimaan", g.receipts)}
                      {side("Pengeluaran", g.payments)}
                      {line(`Arus Kas Neto dari Aktivitas ${g.name}`, groupNet, "st-cat", 0)}
                    </>
                  )}
                </Fragment>
              );
            })}

            {report.registered.some((v) => v !== 0) &&
              line("Saldo awal rekening baru", withTotal(report.registered), "", 0)}
            {line("Kenaikan (Penurunan) Neto Kas & Bank", withTotal(net), "st-res", 0)}
            {line(`Saldo Akhir Kas & Bank (${cur})`, [...report.closing, report.closing[n - 1] ?? 0], "st-res", 0)}
          </tbody>
        </table>
      </div>
    </>
  );
}
