"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/ui/money-input";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "@/lib/siba/currency";
import type { OpenItemOption } from "@/lib/siba/finance";

/** One chosen item and the amount the user settles against it. */
export type ItemAllocation = { item_id: number; amount: number };

/**
 * Which open items a line settles, and **for how much each** — where the line
 * lowers a subject-book position: a Titipan returned, a Hutang paid, a Piutang
 * collected.
 *
 * **Nothing is distributed by the system.** The user ticks each item and
 * states each amount; ticking fills in what that item still holds, which the
 * user may lower, and that is the only figure the form ever proposes. There is
 * no "spread this total oldest first": which item a payment settles decides the
 * gain or loss it recognises, because every item carries the kurs it was raised
 * at, so the choice and the figure are the user's and are on screen before
 * anything is saved.
 *
 * Where the document is foreign, each ticked item states the FX difference it
 * will recognise at the cash side's kurs, a gain or a loss of its own — two
 * items settled together are never netted into one figure. It is an estimate
 * here; the Post confirmation shows the journal to the rupiah.
 */
export function OpenItemSelect({
  value,
  items,
  currencyLabel,
  direction,
  cashRate,
  invalid,
  onChange,
}: {
  value: ItemAllocation[];
  items: OpenItemOption[];
  currencyLabel: string;
  /** The line's cash direction — it decides which way a kurs gap reads. */
  direction: "In" | "Out";
  /** What one unit of the document's currency costs on the cash side, where known. */
  cashRate: number | null;
  invalid?: boolean;
  onChange: (value: ItemAllocation[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<number, number>>({});
  const foreign = !isBaseCurrency(currencyLabel);

  if (!items.length && !value.length) {
    return <span className="dash">tidak ada open item</span>;
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const chosen = value
    .map((v) => ({ ...v, item: byId.get(v.item_id) }))
    .filter((v): v is ItemAllocation & { item: OpenItemOption } => !!v.item);

  const start = () => {
    setDraft(Object.fromEntries(value.map((v) => [v.item_id, v.amount])));
    setOpen(true);
  };

  const ticked = items.filter((i) => draft[i.id] !== undefined);
  const total = ticked.reduce((t, i) => t + (draft[i.id] || 0), 0);
  const overOf = (i: OpenItemOption) => (draft[i.id] || 0) > i.remaining;
  const blocked = ticked.some((i) => overOf(i) || !(draft[i.id] > 0));

  /** Signed as a gain, from the line's side: released at the item's kurs, paid at the cash's. */
  const fxOf = (i: OpenItemOption) =>
    cashRate == null
      ? null
      : Math.round(
          (draft[i.id] || 0) *
            (direction === "Out" ? i.rate - cashRate : cashRate - i.rate) *
            100
        ) / 100;

  return (
    <>
      <button
        type="button"
        className={`cbx sm${invalid ? " bad" : ""}${open ? " open" : ""}${
          chosen.length ? "" : " ph"
        }`}
        onClick={start}
        title={chosen.map((c) => `${c.item.itemNo} ${formatMoney(c.amount, currencyLabel)}`).join("\n")}
      >
        <span className="v">
          {chosen.length ? (
            <>
              <span className="lab">{chosen[0].item.itemNo}</span>
              {chosen.length > 1 && <span className="mny"> +{chosen.length - 1}</span>}
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
        subtitle="Centang setiap item yang diselesaikan dan nominalnya. Nominal baris adalah jumlah item yang dipilih."
        width={foreign ? 960 : 820}
        onClose={() => setOpen(false)}
        foot={
          <>
            <span className="fnote">
              <b>{ticked.length}</b> item · total{" "}
              <b>{formatMoney(total, currencyLabel)}</b>
            </span>
            <button className="btn" onClick={() => setOpen(false)}>
              Batal
            </button>
            <button
              className="btn primary"
              disabled={blocked}
              title={blocked ? "Nominal setiap item harus lebih dari nol dan tidak melebihi sisanya" : undefined}
              onClick={() => {
                // In the order the items are listed — oldest first — which is
                // display order only: what is settled is what was ticked.
                onChange(
                  ticked.map((i) => ({ item_id: i.id, amount: draft[i.id] || 0 }))
                );
                setOpen(false);
              }}
            >
              <Icon name="check" size={14} /> Terapkan
            </button>
          </>
        }
      >
        <div className="tw boxed">
          <table className="grid pkt2">
            <thead>
              <tr>
                <th className="pkchk" style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    aria-label="Pilih semua"
                    title="Pilih semua, masing-masing sebesar sisanya"
                    checked={items.length > 0 && ticked.length === items.length}
                    onChange={() =>
                      setDraft(
                        ticked.length === items.length
                          ? {}
                          : Object.fromEntries(
                              items.map((i) => [i.id, draft[i.id] ?? i.remaining])
                            )
                      )
                    }
                  />
                </th>
                <th style={{ width: 92 }}>Item</th>
                <th style={{ width: 96 }}>Tanggal</th>
                {foreign && (
                  <th className="num" style={{ width: 110 }}>
                    Kurs
                  </th>
                )}
                <th className="num" style={{ width: 140 }}>
                  Sisa
                </th>
                <th className="num" style={{ width: 164 }}>
                  Diselesaikan
                </th>
                {foreign && (
                  <th className="num" style={{ width: 140 }}>
                    Selisih kurs
                  </th>
                )}
                <th>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const on = draft[i.id] !== undefined;
                const fx = on ? fxOf(i) : null;
                return (
                  <tr key={i.id} className={on ? "on" : "off"}>
                    <td className="pkchk">
                      <input
                        type="checkbox"
                        aria-label={`Pilih ${i.itemNo}`}
                        checked={on}
                        onChange={() =>
                          setDraft((d) => {
                            const next = { ...d };
                            if (on) delete next[i.id];
                            else next[i.id] = i.remaining;
                            return next;
                          })
                        }
                      />
                    </td>
                    <td>
                      <span className="lab">{i.itemNo}</span>
                    </td>
                    <td className="mut">{formatDate(i.date)}</td>
                    {foreign && <td className="num">{formatRate(i.rate)}</td>}
                    <td className="num">
                      <span className="mny">{formatMoney(i.remaining, currencyLabel)}</span>
                    </td>
                    <td className="num">
                      <MoneyInput
                        size="sm"
                        over={on && overOf(i)}
                        disabled={!on}
                        placeholder=""
                        ariaLabel={`Nominal ${i.itemNo}`}
                        value={on && draft[i.id] ? String(draft[i.id]) : ""}
                        onChange={(raw) =>
                          setDraft((d) => ({ ...d, [i.id]: raw ? Number(raw) : 0 }))
                        }
                      />
                    </td>
                    {foreign && (
                      <td className="num">
                        {fx == null || !on ? (
                          <span className="dash">—</span>
                        ) : fx === 0 ? (
                          <span className="mny z">{formatMoney(0, BASE_CURRENCY_LABEL)}</span>
                        ) : (
                          <span className="mstack">
                            <span className={`mny${fx < 0 ? " neg" : ""}`}>
                              {formatMoney(Math.abs(fx), BASE_CURRENCY_LABEL)}
                            </span>
                            <span className={`rz${fx < 0 ? " warnrz" : ""}`}>
                              {fx > 0 ? "laba · kredit" : "rugi · debit"}
                            </span>
                          </span>
                        )}
                      </td>
                    )}
                    <td className="pri wrapok">{i.note ?? <span className="dash">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {foreign && (
          <p className="fnote" style={{ marginTop: 10 }}>
            {cashRate == null
              ? "Selisih kurs tampil setelah kurs dokumen diisi."
              : `Perkiraan pada kurs kas ${formatRate(cashRate)}; setiap item dijurnal sendiri. Angka pastinya tampil pada konfirmasi Post.`}
          </p>
        )}
      </Dialog>
    </>
  );
}
