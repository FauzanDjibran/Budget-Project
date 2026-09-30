"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { isBaseCurrency } from "@/lib/siba/currency";
import type { OpenItemOption } from "@/lib/siba/finance";

/**
 * Which open item a line settles, where the line lowers a subject-book
 * position — a Titipan returned, a Hutang paid, a Piutang collected.
 *
 * **An item is chosen, never averaged.** Two receipts from one Partner stay two
 * items, each at the kurs it was raised at, and the one a return settles
 * decides the gain or loss the line recognises. So the choice is the user's,
 * made in a panel where the items line up by date, kurs and what is left, the
 * same way `KursSelect` offers a rate layer. Oldest first is display order
 * only — nothing is settled without being picked.
 *
 * In rupiah every item's kurs is 1, so the column is dropped and the item is
 * told apart by its date and its description.
 */
export function OpenItemSelect({
  value,
  items,
  currencyLabel,
  invalid,
  onChange,
}: {
  value: number | null;
  items: OpenItemOption[];
  currencyLabel: string;
  invalid?: boolean;
  onChange: (value: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const foreign = !isBaseCurrency(currencyLabel);

  if (!items.length) {
    return <span className="dash">tidak ada open item</span>;
  }

  const selected = items.find((i) => i.id === value) ?? null;

  return (
    <>
      <button
        type="button"
        className={`cbx sm${invalid ? " bad" : ""}${open ? " open" : ""}${
          selected ? "" : " ph"
        }`}
        onClick={() => setOpen(true)}
      >
        <span className="v">
          {selected ? (
            <>
              <span className="lab">{selected.itemNo}</span>{" "}
              <span className="mny">
                {foreign ? formatRate(selected.rate) : formatDate(selected.date)}
              </span>
            </>
          ) : (
            <span className="ph">Pilih open item…</span>
          )}
        </span>
        <span className="cv">
          <Icon name="layers" size={13} />
        </span>
      </button>

      <Dialog
        open={open}
        icon="layers"
        title="Pilih Open Item"
        subtitle="Baris ini menyelesaikan satu open item, dan nominalnya dibatasi sisa item yang dipilih."
        width={760}
        onClose={() => setOpen(false)}
      >
        <div className="tw boxed">
          <table className="grid pkt2">
            <thead>
              <tr>
                <th style={{ width: 96 }}>Item</th>
                <th style={{ width: 104 }}>Tanggal</th>
                {foreign && (
                  <th className="num" style={{ width: 120 }}>
                    Kurs
                  </th>
                )}
                <th className="num" style={{ width: 160 }}>
                  Sisa
                </th>
                <th>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr
                  key={i.id}
                  className={i.id === value ? "on" : ""}
                  onClick={() => {
                    onChange(i.id);
                    setOpen(false);
                  }}
                >
                  <td>
                    <span className="lab">{i.itemNo}</span>
                  </td>
                  <td className="mut">{formatDate(i.date)}</td>
                  {foreign && <td className="num">{formatRate(i.rate)}</td>}
                  <td className="num">{formatMoney(i.remaining, currencyLabel)}</td>
                  <td className="pri wrapok">
                    {i.note ?? <span className="dash">—</span>}
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
