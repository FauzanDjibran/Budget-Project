"use client";

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "@/components/icon";
import { MoneyInput } from "@/components/ui/money-input";
import { OpenItemSelect, type ItemAllocation } from "./open-item-select";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { ReportSummary } from "@/components/report/report-summary";
import type { EligibleBudget } from "@/lib/siba/finance";
import type { TransactionLineRow, TransactionRow } from "@/lib/siba/finance-rows";
import { type RealizationLineDetail } from "./realization-line-detail";
import type { LayerOption } from "@/lib/siba/cash-bank-layers";

/** A line while the document is being edited — before it is a database row. */
export type DraftLine = {
  budget_id: number;
  budget_no: string;
  budget_date: string;
  description: string;
  category_id: number | null;
  partner_id: number | null;
  outstanding: number;
  amount: number;
  /**
   * The open items a line lowering a subject-book position settles, each for
   * the amount the user chose. Such a line is worth what they add up to.
   */
  items: ItemAllocation[];
};

/** The lines card of a Realisasi: the Budgets it settles, the source summary and the totals. */
export function TransactionLinesCard({
  editing,
  direction,
  transaction,
  lines,
  draftLines,
  setDraftLines,
  dropped,
  errors,
  setDirty,
  setPicking,
  setDetail,
  funded,
  currencyLabel,
  headerReady,
  budgetWaitingFor,
  total,
  inn,
  poolById,
  cashRate,
  rows,
  showSummary,
  resourceLabel,
  crossesToBase,
  chosenLayer,
  summaryWaitingFor,
  startBalance,
  moved,
  endBalance,
  pastBalance,
  showItems,
}: {
  editing: boolean;
  direction: "In" | "Out";
  transaction: TransactionRow | null;
  lines: TransactionLineRow[];
  draftLines: DraftLine[];
  setDraftLines: Dispatch<SetStateAction<DraftLine[]>>;
  dropped: number;
  errors: Record<string, string>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setPicking: Dispatch<SetStateAction<boolean>>;
  setDetail: Dispatch<SetStateAction<RealizationLineDetail | null>>;
  funded: boolean;
  currencyLabel: string;
  headerReady: boolean;
  budgetWaitingFor: string | null;
  total: number;
  inn: boolean;
  poolById: Map<number, EligibleBudget>;
  cashRate: number | null;
  rows: RealizationLineDetail[];
  showSummary: boolean;
  resourceLabel: string;
  crossesToBase: boolean;
  chosenLayer: LayerOption | null;
  summaryWaitingFor: string | null;
  startBalance: number;
  moved: number;
  endBalance: number;
  pastBalance: Set<number>;
  showItems: boolean;
}) {
  return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="clip" size={15} />
              </span>
              <div className="ct">
                <h3>Budget yang Direalisasikan</h3>
                <p>
                  Budget dari Category dan Partner mana pun, selama memenuhi
                  kriteria header. Setiap Budget menjadi entri buku dan baris
                  journal tersendiri.
                </p>
              </div>
              {editing ? (
                <button
                  className="btn sm primary"
                  disabled={!headerReady}
                  title={budgetWaitingFor ?? undefined}
                  onClick={() => setPicking(true)}
                >
                  <Icon name="plus" size={14} /> Tambah Budget
                </button>
              ) : (
                <span className="hint">{lines.length} budget</span>
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
                        value: formatMoney(startBalance, resourceLabel),
                      },
                      {
                        label: inn ? "Total Diterima" : "Total Digunakan",
                        value: formatMoney(moved, resourceLabel),
                      },
                      inn
                        ? {
                            label: "Saldo Baru",
                            value: formatMoney(endBalance, resourceLabel),
                            key: true,
                          }
                        : endBalance < 0
                          ? {
                              label: "Kekurangan",
                              value: formatMoney(-endBalance, resourceLabel),
                              key: true,
                              negative: true,
                            }
                          : {
                              label: "Sisa",
                              value: formatMoney(endBalance, resourceLabel),
                              key: true,
                            },
                    ]}
                  />
                )}
              </div>
            )}

            {editing && dropped > 0 && (
              <div className="nbox warn slim">
                <span className="ni">
                  <Icon name="warn" size={14} />
                </span>
                <div>
                  <b>{dropped} baris dikeluarkan otomatis.</b>
                  <p>
                    Budget tersebut tidak lagi memenuhi kriteria header yang
                    baru.
                  </p>
                </div>
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

            {rows.length ? (
              <div className="tw">
                <table className="grid ltab" style={{ minWidth: showItems ? 860 : 680 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>No</th>
                      <th>Budget</th>
                      {showItems && <th style={{ width: 180 }}>Open Item</th>}
                      <th className="num" style={{ width: 150 }}>
                        Outstanding
                      </th>
                      <th className="num" style={{ width: 164 }}>
                        Realisasi
                      </th>
                      <th style={{ width: editing ? 64 : 40 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const over = r.amount > r.outstanding;
                      const full = !over && r.amount > 0 && r.amount >= r.outstanding;
                      return (
                        <tr key={r.budgetId} className={over ? "overrow" : undefined}>
                          <td className="no">{i + 1}</td>
                          <td className="pri">
                            <span className="dstack">
                              <span className="d1">{r.description}</span>
                              <span className="d2 tx">
                                <span className="mono">{r.budgetNo}</span> ·{" "}
                                {r.category}
                                {r.partner ? ` · ${r.partner}` : ""}
                                {!r.account && (
                                  <span
                                    className="lwarn"
                                    title="Account belum dipetakan — Post akan ditolak"
                                  >
                                    <Icon name="warn" size={11} /> belum dipetakan
                                  </span>
                                )}
                              </span>
                            </span>
                          </td>
                          {showItems && (
                            <td>
                              {r.itemRole === "lowers" ? (
                                editing ? (
                                  <OpenItemSelect
                                    value={
                                      draftLines.find((x) => x.budget_id === r.budgetId)
                                        ?.items ?? []
                                    }
                                    items={poolById.get(r.budgetId)?.items ?? []}
                                    currencyLabel={currencyLabel}
                                    direction={direction}
                                    cashRate={cashRate}
                                    invalid={Boolean(errors._lines) && !r.items.length}
                                    onChange={(v) => {
                                      // The line is worth what its items add up to.
                                      const sum =
                                        Math.round(v.reduce((t, a) => t + a.amount, 0) * 100) / 100;
                                      setDraftLines((ls) =>
                                        ls.map((x) =>
                                          x.budget_id === r.budgetId
                                            ? { ...x, items: v, amount: v.length ? sum : x.amount }
                                            : x
                                        )
                                      );
                                      setDirty(true);
                                    }}
                                  />
                                ) : r.items.length ? (
                                  <span className="dstack">
                                    <span className="d1">
                                      <span className="lab">{r.items[0].item.itemNo}</span>
                                      {r.items.length > 1 && (
                                        <span className="mny"> +{r.items.length - 1}</span>
                                      )}
                                    </span>
                                    <span className="d2">
                                      {r.items.length > 1
                                        ? `${r.items.length} item`
                                        : currencyLabel === BASE_CURRENCY_LABEL
                                          ? formatDate(r.items[0].item.date)
                                          : `kurs ${formatRate(r.items[0].item.rate)}`}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="dash">—</span>
                                )
                              ) : r.itemRole === "opens" ? (
                                <span className="mut">item baru saat Post</span>
                              ) : (
                                <span className="dash">—</span>
                              )}
                            </td>
                          )}
                          <td className="num">
                            <span className="mstack">
                              <span className={`mny${r.outstanding ? "" : " z"}`}>
                                {formatMoney(r.outstanding, currencyLabel)}
                              </span>
                              {over ? (
                                <span className="rz warnrz">
                                  over {formatMoney(r.amount - r.outstanding, currencyLabel)}
                                </span>
                              ) : full ? (
                                <span className="rz">menutup budget</span>
                              ) : null}
                            </span>
                          </td>
                          <td className="num">
                            {editing && r.itemRole !== "lowers" ? (
                              <MoneyInput
                                size="sm"
                                over={over}
                                ariaLabel="Nominal realisasi"
                                value={r.amount ? String(r.amount) : ""}
                                onChange={(raw) => {
                                  setDraftLines((ls) =>
                                    ls.map((x) =>
                                      x.budget_id === r.budgetId
                                        ? { ...x, amount: raw ? Number(raw) : 0 }
                                        : x
                                    )
                                  );
                                  setDirty(true);
                                }}
                              />
                            ) : (
                              <span className={`mny${over ? " over" : ""}`}>
                                {formatMoney(r.amount, currencyLabel)}
                              </span>
                            )}
                            {pastBalance.has(r.budgetId) && (
                              <span className="overtag">
                                {chosenLayer ? "Melebihi sisa layer" : "Melebihi saldo"}
                              </span>
                            )}
                          </td>
                          <td className="acts">
                            <span className="ract">
                              <button
                                className="iact"
                                title="Rincian Budget"
                                onClick={() => setDetail(r)}
                              >
                                <Icon name="eye" size={14} />
                              </button>
                              {editing && (
                                <button
                                  className="iact del"
                                  title="Keluarkan dari dokumen"
                                  onClick={() => {
                                    setDraftLines((ls) =>
                                      ls.filter((x) => x.budget_id !== r.budgetId)
                                    );
                                    setDirty(true);
                                  }}
                                >
                                  <Icon name="trash" size={14} />
                                </button>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* The total in the document's currency, where the summary
                      above does not already state it: a posted or funded
                      document has no summary, and a foreign document paid
                      from a rupiah account states its rupiah there. */}
                  {(!showSummary || crossesToBase || summaryWaitingFor) && (
                    <tfoot>
                      <tr className="totrow">
                        <td colSpan={showItems ? 4 : 3} style={{ textAlign: "right" }}>
                          Total Realisasi
                        </td>
                        <td className="num">
                          <span className="mny big">
                            {formatMoney(total, currencyLabel)}
                          </span>
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            ) : (
              <div className="empty sm">
                <div className="ic">
                  <Icon name="clip" size={18} />
                </div>
                <h4>
                  {editing
                    ? (budgetWaitingFor ?? "Belum ada Budget dipilih")
                    : "Dokumen tanpa Budget"}
                </h4>
                <p>
                  {editing
                    ? headerReady
                      ? "Tekan Tambah Budget untuk melihat Budget yang memenuhi kriteria header dokumen ini."
                      : "Budget yang dapat direalisasikan ditentukan oleh header dokumen."
                    : "Tidak ada line pada dokumen ini."}
                </p>
              </div>
            )}

            {funded && total > 0 && (
              <div className="cardfoot">
                <div className="impact">
                  <div className="ttl">Dampak Transaksi</div>
                  <div className="ir">
                    <span>Arah kas</span>
                    <b>{inn ? "Penerimaan" : "Pengeluaran"}</b>
                  </div>
                  <div className="ir">
                    <span>Sumber dana</span>
                    <b>Kas induk melalui Funding Request</b>
                  </div>
                  <div className="ir">
                    <span>
                      {transaction?.status === "Posted"
                        ? `Posisi terhadap induk`
                        : "Saat funding dikonfirmasi"}
                    </span>
                    <b>
                      {inn ? "Piutang kepada induk" : "Hutang kepada induk"}{" "}
                      {formatMoney(total, currencyLabel)}
                    </b>
                  </div>
                </div>
              </div>
            )}
          </div>
  );
}
