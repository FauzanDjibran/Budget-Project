"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import type { LayerOption } from "@/lib/siba/cash-bank-layers";

/**
 * Which rate layer a payment draws on.
 *
 * **A layer is chosen, not a rate.** With three layers at 15.000, "the 15.000"
 * names none of them — so every layer is identified by the acquisition that
 * created it, and the date, the kurs, what is left and where it came from are
 * all attributes of that event.
 *
 * Four attributes do not fit on the one line a dropdown option gets. Written
 * out as `28/01/2026 · 16.000,00 · sisa USD 1.200,00 · CBT-0012` they ran past
 * the width of the field and truncated, so the reader was comparing the halves
 * of four strings that all began the same way — which is precisely the
 * comparison the whole feature exists to make. So the choice is made in a
 * panel, where each attribute is a column and the layers line up under one
 * another, and the field afterwards carries **only the kurs**: once the layer
 * is picked, the rate is the one thing the document goes on to use.
 *
 * Oldest first, because that is how a treasury reads a stack. The ordering is
 * **display only** — nothing is consumed unless the user picks it, which is the
 * whole point of the feature and the reason there is no "use the oldest"
 * shortcut that commits on its own.
 *
 * An exhausted layer is never in this list. It stays on the layer report,
 * because it is part of how the account reached the position it is in, but it
 * has nothing left to spend.
 */
export function KursSelect({
  value,
  layers,
  currencyLabel,
  invalid,
  disabled,
  onChange,
}: {
  value: number | null;
  layers: LayerOption[];
  currencyLabel: string;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!layers.length) {
    return (
      <div className="ro nil">
        Resource ini belum memegang {currencyLabel}. Layer terbentuk saat saldo
        awal diisi atau saat currency masuk.
      </div>
    );
  }

  const selected = layers.find((l) => l.id === value) ?? null;

  return (
    <>
      <button
        type="button"
        className={`cbx${invalid ? " bad" : ""}${open ? " open" : ""}${
          disabled ? " dis" : ""
        }${selected ? "" : " ph"}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span className="v">
          {selected ? (
            <span className="mny">{formatRate(selected.rate)}</span>
          ) : (
            <span className="ph">Pilih layer kurs…</span>
          )}
        </span>
        {selected && (
          <span
            className="xb"
            title="Kosongkan"
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
          >
            <Icon name="block" size={12} />
          </span>
        )}
        <span className="cv">
          <Icon name="layers" size={13} />
        </span>
      </button>

      <Dialog
        open={open}
        icon="layers"
        title="Pilih Layer Kurs"
        subtitle={`Satu transaksi memakai tepat satu layer, dan nominalnya dibatasi sisa layer yang dipilih.`}
        width={720}
        onClose={() => setOpen(false)}
      >
        {/* The same picker table a Budget selection uses, so a row that can be
            chosen looks the same wherever one is offered. */}
        <div className="tw boxed">
          <table className="grid pkt2">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Tanggal</th>
                <th className="num" style={{ width: 130 }}>
                  Kurs
                </th>
                <th className="num" style={{ width: 160 }}>
                  Sisa
                </th>
                <th>Sumber</th>
              </tr>
            </thead>
            <tbody>
              {layers.map((l) => (
                <tr
                  key={l.id}
                  className={l.id === value ? "on" : ""}
                  onClick={() => {
                    onChange(l.id);
                    setOpen(false);
                  }}
                >
                  <td className="mut">{formatDate(l.date)}</td>
                  <td className="num">{formatRate(l.rate)}</td>
                  <td className="num">
                    {formatMoney(l.foreignRemaining, currencyLabel)}
                  </td>
                  {/* The one column that can be long, and the one that may
                      wrap: what brought the currency in is a sentence. */}
                  <td className="pri wrapok">
                    {l.note ?? <span className="dash">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Dialog>
    </>
  );
}
