"use client";

import { Fragment, useState } from "react";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { ExpandAll } from "@/components/ui/expand-all";
import type { CashFlowCategory, CashFlowGroup, CashFlowReport as Report } from "@/lib/siba/cash-flow-run";

/**
 * The Laporan Arus Kas: PSAK 207's direct method, one currency, one column per
 * period and a Jumlah. Saldo Awal on top, then per group its gross receipts,
 * its gross payments in brackets and its Arus Kas Neto; then the net change
 * and Saldo Akhir. Group → Budget Category → Partner, or keterangan where the
 * entries name no Partner. Drawn on the statements' table (`grid stm`) and
 * folded the way they fold: a closed group or category states its own figure,
 * an open one leaves it to the rows below.
 */
export function CashFlowReport({ report }: { report: Report }) {
  const groupKey = (g: CashFlowGroup) => `g:${g.id ?? "none"}`;
  const categoryKeys = report.groups.flatMap((g) =>
    [...g.receipts.map((c) => `${groupKey(g)}:in:${c.key}`), ...g.payments.map((c) => `${groupKey(g)}:out:${c.key}`)]
  );
  // Categories start folded, so the first read is the groups and their categories.
  const [open, setOpen] = useState<Set<string>>(new Set(report.groups.map(groupKey)));
  const toggle = (k: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const everything = [...report.groups.map(groupKey), ...categoryKeys];

  const cur = report.currencyLabel;
  const n = report.columns.length;
  const total = (v: number[]) => [...v, v.reduce((t, x) => t + x, 0)];
  const sum = (cats: CashFlowCategory[]) => report.columns.map((_, i) => cats.reduce((t, c) => t + c.values[i], 0));
  const net = report.columns.map(
    (_, i) => report.groups.reduce((t, g) => t + sum([...g.receipts, ...g.payments])[i], 0) + report.registered[i]
  );

  const name = (text: string, depth: number, fold?: { isOpen: boolean; onToggle: () => void }) => (
    <td className={`stn d${depth}`}>
      <div className="stc">
        {fold ? (
          <button type="button" className="tgl" onClick={fold.onToggle} title={fold.isOpen ? "Tutup" : "Buka"}>
            <span className={`chev${fold.isOpen ? " o" : ""}`}>
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
  const blank = <td colSpan={n + 1} />;

  const side = (g: CashFlowGroup, dir: "in" | "out", title: string, cats: CashFlowCategory[]) =>
    cats.length > 0 && (
      <>
        <tr className="st-sub">
          {name(title, 1)}
          {blank}
        </tr>
        {cats.map((c) => {
          const k = `${groupKey(g)}:${dir}:${c.key}`;
          const isOpen = open.has(k);
          return (
            <Fragment key={k}>
              <tr>
                {name(c.name, 2, { isOpen, onToggle: () => toggle(k) })}
                {isOpen ? blank : figures(total(c.values))}
              </tr>
              {isOpen && c.children.map((leaf) => (
                <Fragment key={leaf.key}>{line(leaf.name, total(leaf.values), "st-par", 3)}</Fragment>
              ))}
            </Fragment>
          );
        })}
        {line(`Jumlah ${title}`, total(sum(cats)), "st-sub", 1)}
      </>
    );

  return (
    <>
      <div className="rhead">
        <span className="count">
          <b>{report.resources}</b> Cash &amp; Bank {cur} · {n} periode
        </span>
        <ExpandAll
          onExpand={() => setOpen(new Set(everything))}
          onCollapse={() => setOpen(new Set())}
          allOpen={open.size === everything.length}
          allClosed={open.size === 0}
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
              const isOpen = open.has(k);
              const groupNet = total(sum([...g.receipts, ...g.payments]));
              return (
                <Fragment key={k}>
                  <tr className="st-step">
                    {name(`Arus Kas dari Aktivitas ${g.name}`, 0, { isOpen, onToggle: () => toggle(k) })}
                    {isOpen ? blank : figures(groupNet)}
                  </tr>
                  {isOpen && (
                    <>
                      {side(g, "in", "Penerimaan", g.receipts)}
                      {side(g, "out", "Pengeluaran", g.payments)}
                      {line(`Arus Kas Neto dari Aktivitas ${g.name}`, groupNet, "st-cat", 0)}
                    </>
                  )}
                </Fragment>
              );
            })}

            {report.registered.some((v) => v !== 0) &&
              line("Saldo awal rekening baru", total(report.registered), "", 0)}
            {line("Kenaikan (Penurunan) Neto Kas & Bank", total(net), "st-res", 0)}
            {line(`Saldo Akhir Kas & Bank (${cur})`, [...report.closing, report.closing[n - 1] ?? 0], "st-res", 0)}
          </tbody>
        </table>
      </div>
    </>
  );
}
