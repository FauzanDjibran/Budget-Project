"use client";

import type { TransferLineValuation } from "@/lib/siba/transfer-valuation";
import type { TransferPurpose } from "@/lib/siba/transfer-catalogue";
import type { Dispatch, SetStateAction } from "react";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { MoneyInput } from "@/components/ui/money-input";
import { RateInput } from "@/components/ui/rate-input";
import { formatMoney, formatRate } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import type { TransferLineRow, TransferRefs } from "@/lib/siba/transfer";
import { ReportSummary } from "@/components/report/report-summary";


/** A destination while the document is being edited. */
export type DraftLine = {
  key: number;
  to_cash_bank_id: number | null;
  amount: number;
  rate: string;
};

export function TransferLinesCard({
  editing,
  lines,
  refs,
  draftLines,
  setDraftLines,
  newKey,
  errors,
  setDirty,
  purpose,
  currencyLabel,
  drawsLayer,
  headerReady,
  destinationWaitingFor,
  destinationOptions,
  preview,
  rupiahOf,
  showSummary,
  sourceLabel,
  summaryWaitingFor,
  available,
  used,
  left,
  fxTotal,
  amountHeading,
  rupiahHeading,
  footTotal,
}: {
  editing: boolean;
  lines: TransferLineRow[];
  refs: TransferRefs;
  draftLines: DraftLine[];
  setDraftLines: Dispatch<SetStateAction<DraftLine[]>>;
  newKey: () => number;
  errors: Record<string, string>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  purpose: TransferPurpose | null;
  currencyLabel: string;
  drawsLayer: boolean;
  headerReady: boolean;
  destinationWaitingFor: string | null;
  destinationOptions: (chosen: number | null) => { id: number; label: string; name: string; active: boolean }[];
  preview: { valued: TransferLineValuation | null; over: boolean }[];
  rupiahOf: (amount: number, rate: string | number, written?: number) => number;
  showSummary: boolean;
  sourceLabel: string;
  summaryWaitingFor: string | null;
  available: number;
  used: number;
  left: number;
  fxTotal: number;
  amountHeading: string;
  rupiahHeading: string;
  footTotal: { label: string; value: number; currency: string; underRupiah: boolean } | null;
}) {
  return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="wallet" size={15} />
              </span>
              <div className="ct">
                <h3>Tujuan</h3>
                <p>
                  Satu transfer dapat membagi dana ke beberapa Cash &amp; Bank
                  sekaligus.
                </p>
              </div>
              {editing ? (
                <button
                  className="btn sm primary"
                  disabled={!headerReady}
                  title={destinationWaitingFor ?? undefined}
                  onClick={() => {
                    setDraftLines((rows) => [
                      ...rows,
                      { key: newKey(), to_cash_bank_id: null, amount: 0, rate: "" },
                    ]);
                    setDirty(true);
                  }}
                >
                  <Icon name="plus" size={14} /> Tambah Tujuan
                </button>
              ) : (
                <span className="hint">{lines.length} tujuan</span>
              )}
            </div>

            {showSummary && (
              <div className="lsum">
                {summaryWaitingFor ? (
                  <span className="wait">{summaryWaitingFor}</span>
                ) : (
                  <ReportSummary
                    figures={[
                      {
                        label: "Saldo Saat Ini",
                        value: formatMoney(available, sourceLabel),
                      },
                      {
                        label: "Total Digunakan",
                        value: formatMoney(used, sourceLabel),
                      },
                      left < 0
                        ? {
                            label: "Kekurangan",
                            value: formatMoney(-left, sourceLabel),
                            key: true,
                            negative: true,
                          }
                        : {
                            label: "Sisa",
                            value: formatMoney(left, sourceLabel),
                            key: true,
                          },
                    ]}
                  />
                )}
              </div>
            )}

            {errors._lines && (
              <div className="nbox bad slim">
                <span className="ni">
                  <Icon name="warn" size={14} />
                </span>
                <div>
                  <b>{errors._lines}</b>
                </div>
              </div>
            )}

            {(editing ? draftLines.length : lines.length) ? (
              <div className="tw">
                <table
                  className="grid ltab"
                  style={{ minWidth: purpose?.entersRate ? 860 : 640 }}
                >
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>No</th>
                      <th>Cash &amp; Bank Tujuan</th>
                      <th className="num" style={{ width: 170 }}>
                        {amountHeading} ({currencyLabel})
                      </th>
                      {purpose?.entersRate && (
                        <>
                          <th className="num" style={{ width: 150 }}>
                            Kurs ({currencyLabel} → {BASE_CURRENCY_LABEL})
                          </th>
                          <th className="num" style={{ width: 180 }}>
                            {rupiahHeading}
                          </th>
                        </>
                      )}
                      {editing && <th style={{ width: 44 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {editing
                      ? draftLines.map((l, i) => {
                          const p = preview[i];
                          return (
                            <tr key={l.key} className={p?.over ? "overrow" : undefined}>
                              <td className="no">{i + 1}</td>
                              <td className="pri">
                                <Combobox
                                  size="sm"
                                  value={l.to_cash_bank_id}
                                  options={destinationOptions(l.to_cash_bank_id)}
                                  placeholder="Pilih Cash & Bank…"
                                  waitingFor={destinationWaitingFor}
                                  onChange={(v) => {
                                    setDraftLines((rows) =>
                                      rows.map((r) =>
                                        r.key === l.key
                                          ? { ...r, to_cash_bank_id: v }
                                          : r
                                      )
                                    );
                                    setDirty(true);
                                  }}
                                />
                              </td>
                              <td className="num">
                                <MoneyInput
                                  size="sm"
                                  over={p?.over}
                                  ariaLabel="Nominal"
                                  value={l.amount ? String(l.amount) : ""}
                                  onChange={(raw) => {
                                    setDraftLines((rows) =>
                                      rows.map((r) =>
                                        r.key === l.key
                                          ? { ...r, amount: raw ? Number(raw) : 0 }
                                          : r
                                      )
                                    );
                                    setDirty(true);
                                  }}
                                />
                                {p?.over && (
                                  <span className="overtag">
                                    {drawsLayer ? "Melebihi sisa layer" : "Melebihi saldo"}
                                  </span>
                                )}
                              </td>
                              {purpose?.entersRate && (
                                <td className="num">
                                  <RateInput
                                    size="sm"
                                    value={l.rate}
                                    // The pair is stated once, in the column
                                    // header. Inside a 150px cell the label
                                    // and a six-decimal rate do not both fit,
                                    // and what gets truncated is the figure
                                    // the operator has to check.
                                    ariaLabel="Kurs"
                                    onChange={(v) => {
                                      setDraftLines((rows) =>
                                        rows.map((r) =>
                                          r.key === l.key ? { ...r, rate: v } : r
                                        )
                                      );
                                      setDirty(true);
                                    }}
                                  />
                                </td>
                              )}
                              {purpose?.entersRate && (
                                <td className="num">
                                  <span className="mny">
                                    {l.amount && Number(l.rate)
                                      ? formatMoney(
                                          rupiahOf(l.amount, l.rate),
                                          BASE_CURRENCY_LABEL
                                        )
                                      : "—"}
                                  </span>
                                  {p?.valued && p.valued.fxDifference !== 0 && (
                                    <span className="rsub">
                                      selisih kurs{" "}
                                      {formatMoney(
                                        p.valued.fxDifference,
                                        BASE_CURRENCY_LABEL
                                      )}
                                    </span>
                                  )}
                                </td>
                              )}
                              <td className="acts">
                                <button
                                  className="iact del"
                                  title="Keluarkan dari dokumen"
                                  onClick={() => {
                                    setDraftLines((rows) =>
                                      rows.filter((r) => r.key !== l.key)
                                    );
                                    setDirty(true);
                                  }}
                                >
                                  <Icon name="trash" size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      : lines.map((l, i) => {
                          const destination = refs.cashBanks.find(
                            (c) => c.id === l.to_cash_bank_id
                          );
                          return (
                            <tr key={l.id}>
                              <td className="no">{i + 1}</td>
                              <td className="pri">
                                <span className="dstack">
                                  <span className="d1">
                                    {destination?.label ?? "—"}
                                  </span>
                                  <span className="d2">
                                    {destination?.name ?? ""}
                                  </span>
                                </span>
                              </td>
                              <td className="num">
                                <span className="mny">
                                  {formatMoney(l.amount, currencyLabel)}
                                </span>
                              </td>
                              {purpose?.entersRate && (
                                <>
                                  <td className="num">
                                    <span className="mny">
                                      {formatRate(l.exchange_rate)}
                                    </span>
                                  </td>
                                  <td className="num">
                                    <span className="mny">
                                      {formatMoney(
                                        rupiahOf(
                                          l.amount,
                                          l.exchange_rate,
                                          purpose.key === "Pencairan"
                                            ? l.in_amount
                                            : l.out_amount
                                        ),
                                        BASE_CURRENCY_LABEL
                                      )}
                                    </span>
                                    {l.fx_difference !== 0 && (
                                      <span className="rsub">
                                        selisih kurs{" "}
                                        {formatMoney(
                                          l.fx_difference,
                                          BASE_CURRENCY_LABEL
                                        )}
                                      </span>
                                    )}
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                  </tbody>
                  {/* Only the totals the summary above does not state: what
                      the source gives up is there, so a Transfer has no
                      footer at all. */}
                  {footTotal && (
                    <tfoot>
                      {/* Each total stands under its own column: rupiah
                          received under Rupiah Diterima, currency bought under
                          Valas Dibeli. */}
                      <tr className="totrow">
                        <td
                          colSpan={footTotal.underRupiah ? 4 : 2}
                          style={{ textAlign: "right" }}
                        >
                          {footTotal.label}
                        </td>
                        <td className="num">
                          <span className="mny big">
                            {formatMoney(footTotal.value, footTotal.currency)}
                          </span>
                        </td>
                        {!footTotal.underRupiah && <td colSpan={2} />}
                        {editing && <td />}
                      </tr>
                      {/* A row of its own rather than a `.rsub` under the
                          total: `.rsub` is scoped to `tbody td`, so in a
                          footer it runs inline into the figure beside it —
                          and a realized gain is a figure in its own right. */}
                      {fxTotal !== 0 && (
                        <tr className="totrow">
                          <td colSpan={4} style={{ textAlign: "right" }}>
                            {fxTotal > 0 ? "Laba Selisih Kurs" : "Rugi Selisih Kurs"}
                          </td>
                          <td className="num">
                            <span className="mny">
                              {formatMoney(fxTotal, BASE_CURRENCY_LABEL)}
                            </span>
                          </td>
                          {editing && <td />}
                        </tr>
                      )}
                    </tfoot>
                  )}
                </table>
              </div>
            ) : (
              <div className="empty sm">
                <div className="ic">
                  <Icon name="wallet" size={18} />
                </div>
                <h4>Belum ada tujuan</h4>
                <p>
                  {headerReady
                    ? "Tambahkan Cash & Bank yang menerima dananya."
                    : "Lengkapi Purpose dan Cash & Bank sumber terlebih dahulu."}
                </p>
              </div>
            )}
          </div>
  );
}
