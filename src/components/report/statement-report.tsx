"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ExpandAll } from "@/components/ui/expand-all";
import { Drill } from "./drill";
import { formatMoney, formatPercent } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { reportHref } from "@/lib/siba/reports";
import type { StatementColumn } from "@/lib/siba/statements";
import type { StatementRow } from "@/lib/siba/statement-layout";

const money = (n: number) => formatMoney(n, BASE_CURRENCY_LABEL);

/**
 * A financial statement — the multi-step Laba Rugi or the Neraca.
 *
 * One table whose first column is a tree: a step or an Account Type heads its
 * categories, and a result or total line closes it. With a comparison, three
 * columns join the first — Pembanding, Selisih and Selisih %.
 *
 * **A heading states its total only while it is folded.** Open, its rows are
 * on screen and the figure would only repeat them — the user's rule, to keep
 * the page from filling with numbers. Result and total lines always state
 * theirs.
 *
 * **It drills like the Chart of Accounts tree.** Every heading with rows
 * beneath it has its own chevron. A Partner breakdown is the same mechanism, one level under its
 * account, and starts closed because most readers want the account first.
 * Buka Semua opens everything, Partners included; Tutup Semua closes every
 * heading. Result and total lines never collapse — they are what the tree is
 * read towards.
 *
 * **Every figure drills** (`drillFor`): a posted account's amount into its
 * General Ledger for that column's range, a computed profit line into the Laba
 * Rugi that produced it. The account number keeps its own link to the first
 * column's General Ledger, except on a computed line, whose General Ledger is
 * empty by design.
 */
export function StatementReport({
  columns,
  rows,
  companyId,
}: {
  columns: StatementColumn[];
  rows: StatementRow[];
  companyId: number;
}) {
  // Every row with something indented beneath it can fold.
  const foldable = useMemo(() => {
    const keys = new Set<string>();
    rows.forEach((r, i) => {
      const next = rows[i + 1];
      if (r.kind !== "subtotal" && next && next.depth > r.depth) keys.add(r.key);
    });
    return keys;
  }, [rows]);

  const partnerHeads = useMemo(
    () => rows.filter((r) => r.hasPartners).map((r) => r.key),
    [rows]
  );

  const [closed, setClosed] = useState<Set<string>>(() => new Set(partnerHeads));

  const toggle = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // A row shows unless some heading above it, at a shallower depth, is closed.
  const visible: StatementRow[] = [];
  let hiddenBelow: number | null = null;
  for (const r of rows) {
    if (hiddenBelow !== null && r.depth > hiddenBelow) continue;
    hiddenBelow = null;
    visible.push(r);
    if (foldable.has(r.key) && closed.has(r.key)) hiddenBelow = r.depth;
  }

  const comparing = columns.length > 1;
  const main = columns[0];
  const allOpen = closed.size === 0;

  return (
    <>
      <div className="rhead">
        <div className="tspace" />
        <ExpandAll
          onExpand={() => setClosed(new Set())}
          onCollapse={() => setClosed(new Set(foldable))}
          allOpen={allOpen}
        />
      </div>

      <div className="tw">
        <table className="grid stm">
          <thead>
            <tr>
              <th>Account</th>
              {columns.map((c, i) => (
                <th key={i} className="num" style={{ width: 150 }}>
                  {i === 0 ? c.periodName : `Pembanding · ${c.periodName}`}
                </th>
              ))}
              {comparing && (
                <>
                  <th className="num" style={{ width: 140 }}>
                    Selisih
                  </th>
                  <th className="num" style={{ width: 84 }}>
                    Selisih %
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const canFold = foldable.has(r.key);
              const isOpen = !closed.has(r.key);
              return (
                <tr key={r.key} className={ROW_CLASS[r.kind]}>
                  <td className={`stn d${Math.min(r.depth, 6)}`}>
                    <div className="stc">
                      {canFold ? (
                        <button
                          className="tgl"
                          onClick={() => toggle(r.key)}
                          title={
                            r.hasPartners
                              ? isOpen
                                ? "Tutup rincian Partner"
                                : "Buka rincian Partner"
                              : isOpen
                                ? "Tutup"
                                : "Buka"
                          }
                        >
                          <span className={`chev${isOpen ? " o" : ""}`}>
                            <Icon name="chev" size={11} />
                          </span>
                        </button>
                      ) : (
                        <span className="tgl" />
                      )}
                      {/* A computed line's account is never posted to, so its
                          General Ledger is empty — a link there would mislead. */}
                      {r.kind === "account" && r.accountId && !r.computed ? (
                        <Link
                          className="lab"
                          href={reportHref("general-ledger", {
                            company: companyId,
                            accounts: r.accountId,
                            from: main.range.from,
                            to: main.range.to,
                          })}
                          title="Buka General Ledger account ini"
                        >
                          {r.code}
                        </Link>
                      ) : (
                        r.code && <span className="cd">{r.code}</span>
                      )}
                      <span className="nm">{r.name}</span>
                      {r.computed && (
                        <span
                          className="bdg t-slate"
                          title="Dihitung dari journal Laba Rugi, tidak pernah diposting ke account ini"
                        >
                          dihitung
                        </span>
                      )}
                    </div>
                  </td>
                  {r.values.length === 0 || (canFold && isOpen) ? (
                    // An open heading's rows are on screen, so its total would
                    // only repeat them — it is stated once the heading is
                    // folded. A Neraca section's heading has none at all: its
                    // total is its own closing line. Blank, because a dash
                    // would read as "nil".
                    <td colSpan={columns.length + (comparing ? 2 : 0)} />
                  ) : (
                    <>
                      {r.values.map((v, i) => {
                        const drill = drillFor(r, columns[i], companyId);
                        const figure = <Figure value={v} strong={r.kind === "subtotal"} />;
                        return (
                          <td key={i} className="num">
                            {drill ? (
                              <Drill href={drill.href} title={drill.title}>
                                {figure}
                              </Drill>
                            ) : (
                              figure
                            )}
                          </td>
                        );
                      })}
                      {comparing && <Difference current={r.values[0]} base={r.values[1]} />}
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * Where one figure opens, or null where there is nothing beneath it.
 *
 * A posted account's figure — or a Partner's share of it — opens that
 * account's General Ledger over **this column's** range, so a comparison
 * column drills into its own year. A computed profit line opens the Laba Rugi
 * that produced it: Tahun Berjalan the column's own year to date, an unclosed
 * year its whole result. Headings and totals do not drill; their rows do.
 */
function drillFor(
  r: StatementRow,
  column: StatementColumn,
  companyId: number
): { href: string; title: string } | null {
  if (r.profitLoss) {
    const target =
      r.profitLoss === "column"
        ? { yearId: column.yearId, periodId: column.periodId }
        : r.profitLoss;
    return {
      href: reportHref("profit-loss", {
        company: companyId,
        year: target.yearId,
        period: target.periodId,
        mode: "ytd",
      }),
      title: "Buka Laba Rugi yang menghasilkan angka ini",
    };
  }
  if (r.computed) return null;

  const accountId =
    r.kind === "account" ? r.accountId : r.kind === "partner" ? Number(r.partnerOf?.slice(1)) : null;
  if (!accountId) return null;
  return {
    href: reportHref("general-ledger", {
      company: companyId,
      accounts: accountId,
      from: column.range.from,
      to: column.range.to,
    }),
    title: `Buka General Ledger account ini, ${column.periodName}`,
  };
}

const ROW_CLASS: Record<StatementRow["kind"], string> = {
  step: "st-step",
  category: "st-cat",
  subcategory: "st-sub",
  account: "st-acc",
  partner: "st-par",
  subtotal: "totrow st-res",
};

function Figure({ value, strong }: { value: number; strong?: boolean }) {
  if (Math.round(value * 100) === 0) return <span className="dash">–</span>;
  const text = money(value);
  return <span className={`mny${value < 0 ? " neg" : ""}`}>{strong ? <b>{text}</b> : text}</span>;
}

function Difference({ current, base }: { current: number; base: number }) {
  const change = Math.round((current - base) * 100) / 100;
  const pct = formatPercent(change, base);
  return (
    <>
      <td className="num">
        <Figure value={change} />
      </td>
      <td className="num">
        {pct && change !== 0 ? (
          <span className={`mny${change < 0 ? " neg" : ""}`}>{pct}</span>
        ) : (
          <span className="dash">–</span>
        )}
      </td>
    </>
  );
}
