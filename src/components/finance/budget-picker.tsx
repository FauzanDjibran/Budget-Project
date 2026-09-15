"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/ui/money-input";
import { formatDate, formatMoney } from "@/lib/format";
import type { EligibleBudget } from "@/lib/siba/finance";

/**
 * Choosing which approved Budgets a document realizes.
 *
 * The pool is whatever `listEligibleBudgets` returned for the current header —
 * the same set the Server Action will accept — so the criteria bar at the top
 * is not decoration: it is the reason each row is here. Concept doc §9 lists
 * those criteria, and Budget Date is deliberately not among them.
 *
 * Each row's realization defaults to its full outstanding, because settling a
 * plan in one go is the ordinary case; typing a smaller figure is what makes it
 * a partial realization (§6.5).
 */
export function BudgetPicker({
  pool,
  criteria,
  currencyLabel,
  onAdd,
  onClose,
}: {
  pool: EligibleBudget[];
  criteria: { label: string; value: string; hint?: string }[];
  currencyLabel: string;
  onAdd: (picked: { budget_id: number; amount: number }[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Record<number, number>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (b: EligibleBudget) =>
    setPicked((p) => {
      const next = { ...p };
      if (next[b.id] === undefined) next[b.id] = b.outstanding;
      else delete next[b.id];
      return next;
    });

  const chosen = Object.keys(picked).map(Number);
  const total = chosen.reduce((t, id) => t + (picked[id] || 0), 0);

  return (
    <Dialog
      open
      icon="clip"
      width={1040}
      title="Pilih Budget yang Direalisasikan"
      subtitle="Hanya Budget yang memenuhi seluruh kriteria header dokumen yang ditampilkan."
      onClose={onClose}
      foot={
        <>
          <span className="fnote">
            <b>{chosen.length}</b> budget dipilih · total{" "}
            <b>{formatMoney(total, currencyLabel)}</b>
          </span>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn primary"
            disabled={!chosen.length}
            onClick={() =>
              onAdd(
                chosen
                  .filter((id) => (picked[id] || 0) > 0)
                  .map((id) => ({ budget_id: id, amount: picked[id] }))
              )
            }
          >
            <Icon name="plus" size={14} /> Tambahkan ke Dokumen
          </button>
        </>
      }
    >
      <>
          <div className="critbar">
            {criteria.map((c) => (
              <span className="cr" key={c.label}>
                <i>{c.label}</i>
                {c.value}
                {c.hint && <em>{c.hint}</em>}
              </span>
            ))}
            <span className="cr">
              <i>Status</i>Open · outstanding &gt; 0
            </span>
          </div>

          {pool.length ? (
            <div className="tw">
              <table className="grid pkt2">
                <thead>
                  <tr>
                    <th style={{ width: 34 }} />
                    <th style={{ width: 88 }}>Nomor</th>
                    <th style={{ width: 84 }}>Tanggal</th>
                    <th>Deskripsi</th>
                    <th className="num" style={{ width: 118 }}>
                      Nominal Budget
                    </th>
                    <th className="num" style={{ width: 112 }}>
                      Sudah Real.
                    </th>
                    <th className="num" style={{ width: 138 }}>
                      Outstanding
                    </th>
                    <th className="num" style={{ width: 150 }}>
                      Realisasi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pool.map((b) => {
                    const on = picked[b.id] !== undefined;
                    const value = on ? picked[b.id] : b.outstanding;
                    const over = value > b.outstanding;
                    return (
                      <tr
                        key={b.id}
                        className={on ? "on" : "off"}
                        onClick={() => toggle(b)}
                      >
                        <td className="pkchk">
                          <input type="checkbox" checked={on} readOnly />
                        </td>
                        <td>
                          <span className="lab">{b.budget_no}</span>
                        </td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {formatDate(b.budget_date)}
                        </td>
                        <td className="pri">{b.description}</td>
                        <td className="num">
                          <span className="mny">
                            {formatMoney(b.budget_amount, currencyLabel)}
                          </span>
                        </td>
                        <td className="num">
                          <span className={`mny${b.realized_amount ? "" : " z"}`}>
                            {formatMoney(b.realized_amount, currencyLabel)}
                          </span>
                        </td>
                        <td className="num">
                          <span className="mstack">
                            <span className="mny">
                              {formatMoney(b.outstanding, currencyLabel)}
                            </span>
                            {b.draftAllocated > 0 && (
                              <span
                                className="rz warnrz"
                                title="Sedang dialokasikan dokumen Draft lain — belum mengurangi outstanding"
                              >
                                draft lain{" "}
                                {formatMoney(b.draftAllocated, currencyLabel)}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="num" onClick={(e) => e.stopPropagation()}>
                          <MoneyInput
                            size="sm"
                            over={over}
                            disabled={!on}
                            placeholder=""
                            ariaLabel="Nominal realisasi"
                            value={on && value ? String(value) : ""}
                            onChange={(raw) =>
                              setPicked((p) => ({
                                ...p,
                                [b.id]: raw ? Number(raw) : 0,
                              }))
                            }
                          />
                          {over && <span className="overtag">Over</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty sm" style={{ marginTop: 14 }}>
              <div className="ic">
                <Icon name="srch" size={18} />
              </div>
              <h4>Tidak ada Budget yang memenuhi kriteria</h4>
              <p>
                Budget harus berstatus <b>Disetujui (Open)</b>, cocok dengan
                seluruh kriteria di atas, dan masih menyisakan outstanding.
                Budget yang sudah dipilih pada dokumen ini juga tidak muncul
                lagi.
              </p>
            </div>
          )}
      </>
    </Dialog>
  );
}
