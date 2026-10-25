import "server-only";

import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/format";
import { todayDay } from "./fiscal";
import { roundBase } from "./fx";
import { ITEM_ADJUSTMENT_EFFECTS, effectOfChange, type ItemAdjustmentEffect } from "./item-adjustment-workflow";
import { subledgerItemsByIds, type SubledgerItem, itemLowestFrom } from "./subledger";
import { type SubledgerDef } from "./subledger-catalogue";
import { adjustableBooks } from "./item-adjustment-rows";

const cents = (n: number) => Math.round(n * 100);

/** The rules a Penyesuaian Open Item header and its lines are held to, before anything is written. */

// ------------------------------------------------------------------- header

export type ItemAdjustmentHeader = {
  budget_category_id: number | null;
  partner_id: number | null;
  currency_id: number | null;
  exchange_rate: number | null;
};

export type ResolvedItemAdjustmentHeader = {
  book: SubledgerDef;
  companyId: number;
  partnerId: number;
  partnerCategoryId: number;
  currencyId: number;
  currencyLabel: string;
};

export type ItemAdjustmentHeaderCheck =
  | ({ ok: true } & ResolvedItemAdjustmentHeader)
  | { ok: false; errors: Record<string, string> };

/**
 * The header, checked against every rule at once. The form narrows each
 * picker, but a Server Action is reachable directly with any combination of
 * ids — this is what actually enforces it.
 */
export async function checkItemAdjustmentHeader(
  header: ItemAdjustmentHeader,
  companyIds: number[]
): Promise<ItemAdjustmentHeaderCheck> {
  const errors: Record<string, string> = {};

  if (!header.budget_category_id) {
    return { ok: false, errors: { budget_category_id: "Buku subjek wajib dipilih." } };
  }
  const book = (await adjustableBooks()).find(
    (b) => b.def.categoryId === header.budget_category_id
  );
  if (!book) {
    return {
      ok: false,
      errors: {
        budget_category_id:
          "Buku tersebut tidak dapat disesuaikan lewat Penyesuaian Open Item. " +
          "Aktifkan “Boleh Penyesuaian Open Item” pada Budget Category-nya.",
      },
    };
  }

  if (!header.partner_id) {
    return { ok: false, errors: { partner_id: "Partner wajib dipilih." } };
  }
  const partner = await prisma.mPartner.findUnique({
    where: { id: header.partner_id },
    select: { company_id: true, category_id: true, status: true, partner_label: true },
  });
  if (!partner || !companyIds.includes(partner.company_id)) {
    return { ok: false, errors: { partner_id: "Partner tidak ditemukan." } };
  }
  if (partner.status !== "Active") {
    errors.partner_id = "Partner tersebut non-aktif dan tidak dapat disesuaikan.";
  } else if (!book.partnerCategoryIds.includes(partner.category_id)) {
    errors.partner_id =
      `Partner ${partner.partner_label} tidak termasuk Partner Category yang ` +
      `dipakai ${book.def.name}.`;
  }

  if (!header.currency_id) {
    return { ok: false, errors: { ...errors, currency_id: "Currency wajib dipilih." } };
  }
  const currency = await prisma.refCurrency.findUnique({
    where: { id: header.currency_id },
    select: { currency_label: true, status: true },
  });
  if (!currency) {
    errors.currency_id = "Currency tidak ditemukan.";
  } else if (currency.status !== "Active") {
    errors.currency_id = "Currency tersebut non-aktif dan tidak dapat dipakai.";
  }

  if (Object.keys(errors).length || !currency) return { ok: false, errors };

  // Every item moves at the kurs it was raised at, so a typed rate would be a
  // second opinion nothing reads — refused rather than ignored.
  if (header.exchange_rate && header.exchange_rate !== 1) {
    return {
      ok: false,
      errors: {
        exchange_rate:
          "Penyesuaian memakai kurs masing-masing open item, jadi tidak memakai kurs baru.",
      },
    };
  }

  return {
    ok: true,
    book: book.def,
    companyId: partner.company_id,
    partnerId: header.partner_id,
    partnerCategoryId: partner.category_id,
    currencyId: header.currency_id,
    currencyLabel: currency.currency_label,
  };
}

// -------------------------------------------------------------------- lines

export type ItemAdjustmentLineInput = {
  item_id: number | null;
  /** The value the item should now hold; null while it is not typed yet. */
  new_amount: number | null;
  /**
   * What the item held when the draft was saved. Absent on a save — the item
   * is read as it stands — and present at Post, which refuses if the item has
   * moved since.
   */
  balance_before?: number | null;
};

export type CheckedAdjustmentLine = {
  itemId: number;
  itemNo: string;
  effect: ItemAdjustmentEffect;
  balanceBefore: number;
  newAmount: number;
  /** The difference, unsigned. */
  amount: number;
  /** Written by the system, never typed. */
  description: string;
};

export type ItemAdjustmentLineCheck =
  | { ok: true; lines: CheckedAdjustmentLine[]; total: number }
  | { ok: false; errors: Record<string, string> };

/** What a line says about itself, in the ledger and the journal. */
export function describeAdjustmentLine(
  effect: ItemAdjustmentEffect,
  amount: number,
  currencyLabel: string,
  itemNo: string
): string {
  return `${ITEM_ADJUSTMENT_EFFECTS[effect].label} ${formatMoney(amount, currencyLabel)} atas ${itemNo}`;
}

/**
 * Every line names one open item of this position and the value it should now
 * hold. The difference against what the item holds decides the line: more is
 * a Penambahan, less a Pengurangan, nil is refused — a line that moves
 * nothing is a mistake, not an adjustment. A new value may be nil, which
 * clears the item, and never below it, so no position can go below zero.
 */
export async function checkItemAdjustmentLines(
  header: ResolvedItemAdjustmentHeader,
  lines: ItemAdjustmentLineInput[],
  /** The document's date — an item may not go below nothing from it on. */
  date: string = todayDay()
): Promise<ItemAdjustmentLineCheck> {
  const wanted = lines.filter((l) => l.item_id || l.new_amount != null);

  if (!wanted.length) {
    return { ok: false, errors: { _lines: "Penyesuaian harus memiliki minimal satu baris." } };
  }
  if (wanted.some((l) => !l.item_id)) {
    return { ok: false, errors: { _lines: "Setiap baris wajib memilih open item yang disesuaikan." } };
  }
  if (wanted.some((l) => l.new_amount == null || !Number.isFinite(l.new_amount))) {
    return { ok: false, errors: { _lines: "Setiap baris wajib mengisi Nilai Baru open item-nya." } };
  }
  if (wanted.some((l) => l.new_amount! < 0)) {
    return { ok: false, errors: { _lines: "Nilai Baru tidak boleh di bawah nol." } };
  }
  const ids = wanted.map((l) => l.item_id!);
  if (new Set(ids).size !== ids.length) {
    return { ok: false, errors: { _lines: "Satu open item hanya boleh disesuaikan sekali per dokumen." } };
  }

  const items = new Map((await subledgerItemsByIds(ids)).map((i) => [i.id, i]));
  const out: CheckedAdjustmentLine[] = [];
  for (const l of wanted) {
    const item = items.get(l.item_id!);
    if (
      !item ||
      item.bookId !== header.book.categoryId ||
      item.partnerId !== header.partnerId ||
      item.currencyId !== header.currencyId
    ) {
      return {
        ok: false,
        errors: { _lines: "Open item yang dipilih bukan milik buku, Partner, dan currency dokumen ini." },
      };
    }
    if (item.status !== "Open") {
      return {
        ok: false,
        errors: { _lines: `Open item ${item.itemNo} sudah selesai dan tidak dapat disesuaikan.` },
      };
    }
    if (l.balance_before != null && cents(l.balance_before) !== cents(item.remaining)) {
      return { ok: false, errors: { _lines: movedSince(item, header.currencyLabel, l.balance_before) } };
    }
    const newAmount = roundBase(l.new_amount!);
    const effect = effectOfChange(item.remaining, newAmount);
    if (!effect) {
      return {
        ok: false,
        errors: {
          _lines:
            `Nilai Baru ${item.itemNo} sama dengan nilainya sekarang ` +
            `(${formatMoney(item.remaining, header.currencyLabel)}), jadi tidak ada yang disesuaikan.`,
        },
      };
    }
    if (date < item.date) {
      return {
        ok: false,
        errors: {
          _lines:
            `Open item ${item.itemNo} baru dibuka pada ${formatDate(item.date)}, ` +
            "sehingga tidak dapat disesuaikan dengan tanggal akuntansi sebelumnya.",
        },
      };
    }
    const amount = roundBase(Math.abs(newAmount - item.remaining));
    if (effect === "Decrease") {
      const lowest = await itemLowestFrom(item.id, date);
      if (cents(amount) > cents(lowest.balance)) {
        return {
          ok: false,
          errors: {
            _lines:
              `Open item ${item.itemNo} tinggal ${formatMoney(lowest.balance, header.currencyLabel)} ` +
              `pada ${lowest.at}, tidak cukup untuk dikurangi ${formatMoney(amount, header.currencyLabel)}. ` +
              "Posisi tidak boleh di bawah nol pada hari mana pun — ubah tanggal akuntansi.",
          },
        };
      }
    }
    out.push({
      itemId: item.id,
      itemNo: item.itemNo,
      effect,
      balanceBefore: item.remaining,
      newAmount,
      amount,
      description: describeAdjustmentLine(effect, amount, header.currencyLabel, item.itemNo),
    });
  }

  return { ok: true, lines: out, total: netChange(out) };
}

export const movedSince = (item: SubledgerItem, currencyLabel: string, before: number) =>
  `Open item ${item.itemNo} berubah sejak dokumen disimpan: nilainya ` +
  `${formatMoney(before, currencyLabel)} saat itu, sekarang ` +
  `${formatMoney(item.remaining, currencyLabel)}. Ubah dokumen dan periksa Nilai Baru-nya.`;

/** Raised less lowered — the document's net change, signed. */
export const netChange = (lines: { effect: ItemAdjustmentEffect; amount: number }[]) =>
  roundBase(lines.reduce((t, l) => t + (l.effect === "Increase" ? l.amount : -l.amount), 0));

