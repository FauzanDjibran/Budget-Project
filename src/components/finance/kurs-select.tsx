"use client";

import { Select } from "@/components/ui/select";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import type { LayerOption } from "@/lib/siba/cash-bank-layers";

/**
 * Which rate layer a payment draws on.
 *
 * **A layer is chosen, not a rate.** With three layers at 15.000, "the 15.000"
 * names none of them — so every option is identified by the acquisition that
 * created it, with the kurs and what is left shown as attributes of that event.
 * That is also why this is a single `Select` rather than a checklist with a
 * running total: one transaction draws on exactly one layer, and the document
 * is capped at what that layer still holds.
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
  if (!layers.length) {
    return (
      <div className="ro nil">
        Resource ini belum memegang {currencyLabel}. Layer terbentuk saat saldo
        awal diisi atau saat currency masuk.
      </div>
    );
  }

  return (
    <Select
      value={value == null ? "" : String(value)}
      variant="field"
      placeholder="Pilih layer kurs…"
      invalid={invalid}
      disabled={disabled}
      options={layers.map((l) => ({
        value: String(l.id),
        // Date and source first — that is what names the layer. The kurs and
        // the remainder follow, because they are what the choice turns on.
        label:
          `${formatDate(l.date)} · ${formatNumber(l.rate, 2)} · sisa ` +
          `${formatMoney(l.foreignRemaining, currencyLabel)}` +
          (l.note ? ` · ${l.note}` : ""),
      }))}
      onChange={(v) => onChange(v ? Number(v) : null)}
    />
  );
}
