"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { reportHref } from "@/lib/siba/reports";
import type { StatementColumn } from "@/lib/siba/statements";
import type { StatementRow } from "@/lib/siba/statement-layout";

const money = (n: number) => formatMoney(n, BASE_CURRENCY_LABEL);

/** How deep the tree is drawn. Partners stay behind each account's own arrow. */
type Detail = "category" | "subcategory" | "account";

const DETAIL_OPTIONS: { value: Detail; label: string }[] = [
  { value: "category", label: "Rincian: Kategori" },
  { value: "subcategory", label: "Rincian: Kelompok" },
  { value: "account", label: "Rincian: Account" },
];

const HIDDEN_AT: Record<Detail, StatementRow["kind"][]> = {
  category: ["subcategory", "account", "partner"],
  subcategory: ["account", "partner"],
  account: [],
};

/**
 * A financial statement — the multi-step Laba Rugi or the Neraca.
 *
 * One table: a step or an Account Type heads its categories, a result or total
 * line closes it, and each heading carries the total of what sits beneath it
 * (a Neraca section's heading carries none, because its total line follows). With a comparison, three columns join the
 * first — Pembanding, Selisih and Selisih % — and each column header states its
 * own date range, so a screenshot says which figures it is.
 *
 * An account whose figure is split by Partner carries an arrow and opens its
 * Partners in place; an account number links to its General Ledger for the
 * first column's range. Read-only, like every Report View.
 */
export function StatementReport({
  columns,
  rows,
  companyId,
  position = false,
}: {
  columns: StatementColumn[];
  rows: StatementRow[];
  companyId: number;
  /** A Neraca: each column is a position per its last day, not a range. */
  position?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Detail>("account");

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const comparing = columns.length > 1;
  const withPartners = rows.filter((r) => r.hasPartners).map((r) => r.key);
  const allOpen = withPartners.length > 0 && withPartners.every((k) => open.has(k));
  const main = columns[0];

  const visible = rows.filter(
    (r) =>
      !HIDDEN_AT[detail].includes(r.kind) && (!r.partnerOf || open.has(r.partnerOf))
  );

  return (
    <>
      {/* The period and range of each column are in its own header, so this
          bar carries only the controls — stating them twice would say nothing. */}
      <div className="rhead">
        <div className="tspace" />
        <Select
          variant="toolbar"
          value={detail}
          onChange={(v) => setDetail(v as Detail)}
          options={DETAIL_OPTIONS}
          ariaLabel="Tingkat rincian"
        />
        {detail === "account" && withPartners.length > 0 && (
          <button
            className="btn sm"
            onClick={() => setOpen(allOpen ? new Set() : new Set(withPartners))}
          >
            <Icon name={allOpen ? "collapse" : "expand"} size={13} />
            {allOpen ? "Tutup Rincian Partner" : "Buka Rincian Partner"}
          </button>
        )}
      </div>

      <div className="tw">
        <table className="grid stm">
          <thead>
            <tr>
              <th>Account</th>
              {columns.map((c, i) => (
                <th key={i} className="num" style={{ width: 150 }}>
                  {i === 0 ? c.periodName : `Pembanding · ${c.periodName}`}
                  <span className="rsub">
                    {position
                      ? `per ${formatDate(c.range.to)}`
                      : `${formatDate(c.range.from)} – ${formatDate(c.range.to)}`}
                  </span>
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
              const isOpen = open.has(r.key);
              return (
                <tr key={r.key} className={ROW_CLASS[r.kind]}>
                  <td className={`stn d${Math.min(r.depth, 6)}`}>
                    <div className="stc">
                      {r.kind === "account" && r.hasPartners ? (
                        <button
                          className="tgl"
                          onClick={() => toggle(r.key)}
                          title={isOpen ? "Tutup rincian Partner" : "Buka rincian Partner"}
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
                  {r.values.length === 0 ? (
                    // A heading whose total is its own closing line: nothing to
                    // state here, and a dash would read as "nil".
                    <td colSpan={columns.length + (comparing ? 2 : 0)} />
                  ) : (
                    <>
                      {r.values.map((v, i) => (
                        <td key={i} className="num">
                          <Figure value={v} strong={r.kind === "subtotal"} />
                        </td>
                      ))}
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
