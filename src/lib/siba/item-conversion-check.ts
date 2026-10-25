import "server-only";

import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/format";
import { layerDateRefusal } from "./cash-bank-layers";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "./currency";
import { todayDay } from "./fiscal";
import { roundBase } from "./fx";
import { subledgerItemsByIds, itemLowestFrom } from "./subledger";
import { subledgerForCategory, type SubledgerDef } from "./subledger-catalogue";
import { loadSubledgers } from "./subledger-data";

const cents = (n: number) => Math.round(n * 100);

/** The rules a Pencairan Open Item header and its lines are held to, before anything is written. */

// ------------------------------------------------------------------- header

export type ConversionHeader = {
  from_cash_bank_id: number | null;
  cash_bank_layer_id: number | null;
  budget_category_id: number | null;
  partner_id: number | null;
  /** When given, a layer acquired after it is refused. */
  accounting_date?: string | null;
};

/** A header that passed every rule — the shape the lines are checked against. */
export type ResolvedConversionHeader = {
  companyId: number;
  fromCashBankId: number;
  currencyId: number;
  currencyLabel: string;
  layerId: number;
  layerRate: number;
  layerRemaining: number;
  book: SubledgerDef;
  partnerId: number;
  partnerCategoryId: number;
  partnerLabel: string;
};

export type ConversionHeaderCheck =
  | ({ ok: true } & ResolvedConversionHeader)
  | { ok: false; errors: Record<string, string> };

/**
 * The header, checked against every rule at once. The form narrows each
 * picker, but a Server Action is reachable directly with any combination of
 * ids — this is what actually enforces it.
 *
 * **The Company is the source's, never picked.** A Partner belongs to one
 * Company and so does the money, so a source and a Partner of different
 * Companies would be the intercompany bridge, which is Funding Request's.
 */
export async function checkConversionHeader(
  header: ConversionHeader,
  companyIds: number[]
): Promise<ConversionHeaderCheck> {
  const errors: Record<string, string> = {};

  if (!header.from_cash_bank_id) {
    return { ok: false, errors: { from_cash_bank_id: "Cash & Bank sumber wajib dipilih." } };
  }
  const source = await prisma.mCashBank.findUnique({
    where: { id: header.from_cash_bank_id },
    select: {
      company_id: true,
      status: true,
      currency_id: true,
      currency: { select: { currency_label: true } },
    },
  });
  if (!source || !companyIds.includes(source.company_id)) {
    return { ok: false, errors: { from_cash_bank_id: "Cash & Bank sumber tidak ditemukan." } };
  }
  const currencyLabel = source.currency.currency_label;
  if (source.status !== "Active") {
    errors.from_cash_bank_id = "Cash & Bank tersebut non-aktif dan tidak dapat dipakai.";
  } else if (isBaseCurrency(currencyLabel)) {
    errors.from_cash_bank_id =
      `Pencairan Open Item menjual valuta asing, jadi Cash & Bank sumber tidak ` +
      `boleh ${BASE_CURRENCY_LABEL}.`;
  }

  let layerRate = 0;
  let layerRemaining = 0;
  if (!header.cash_bank_layer_id) {
    errors.cash_bank_layer_id =
      "Pilih layer kurs yang dipakai. Satu dokumen memakai tepat satu layer.";
  } else {
    const layer = await prisma.cashBankLayer.findUnique({
      where: { id: header.cash_bank_layer_id },
      select: {
        cash_bank_id: true,
        status: true,
        rate: true,
        foreign_remaining: true,
        layer_no: true,
        acquisition_date: true,
      },
    });
    const tooNew = layer && header.accounting_date ? layerDateRefusal(layer, header.accounting_date) : null;
    if (!layer || layer.cash_bank_id !== header.from_cash_bank_id) {
      errors.cash_bank_layer_id =
        "Layer kurs tersebut bukan milik Cash & Bank sumber yang dipilih.";
    } else if (layer.status !== "Open") {
      errors.cash_bank_layer_id = "Layer kurs tersebut sudah habis dan tidak dapat dipakai lagi.";
    } else if (tooNew) {
      errors.cash_bank_layer_id = tooNew;
    } else {
      layerRate = layer.rate.toNumber();
      layerRemaining = layer.foreign_remaining.toNumber();
    }
  }

  let book: SubledgerDef | null = null;
  if (!header.budget_category_id) {
    errors.budget_category_id = "Buku subjek wajib dipilih.";
  } else {
    book = subledgerForCategory(await loadSubledgers(), header.budget_category_id);
    if (!book) errors.budget_category_id = "Budget Category tersebut tidak memiliki buku subjek.";
  }

  let partnerCategoryId = 0;
  let partnerLabel = "";
  if (!header.partner_id) {
    errors.partner_id = "Partner wajib dipilih.";
  } else {
    const partner = await prisma.mPartner.findUnique({
      where: { id: header.partner_id },
      select: { company_id: true, category_id: true, status: true, partner_label: true },
    });
    if (!partner || !companyIds.includes(partner.company_id)) {
      errors.partner_id = "Partner tidak ditemukan.";
    } else if (partner.company_id !== source.company_id) {
      errors.partner_id =
        `Partner ${partner.partner_label} milik Company lain dari Cash & Bank sumber.`;
    } else if (partner.status !== "Active") {
      errors.partner_id = "Partner tersebut non-aktif dan tidak dapat dipakai.";
    } else {
      partnerCategoryId = partner.category_id;
      partnerLabel = partner.partner_label;
    }
  }

  if (Object.keys(errors).length || !book) return { ok: false, errors };

  return {
    ok: true,
    companyId: source.company_id,
    fromCashBankId: header.from_cash_bank_id,
    currencyId: source.currency_id,
    currencyLabel,
    layerId: header.cash_bank_layer_id!,
    layerRate,
    layerRemaining,
    book,
    partnerId: header.partner_id!,
    partnerCategoryId,
    partnerLabel,
  };
}

// -------------------------------------------------------------------- lines

export type ConversionItemAllocation = { item_id: number; amount: number };

export type ConversionLineInput = {
  to_cash_bank_id: number;
  exchange_rate: number | null;
  items: ConversionItemAllocation[];
};

export type ResolvedConversionLine = {
  toCashBankId: number;
  rate: number;
  /** The sum of the items — the line has no amount of its own. */
  amount: number;
  items: { itemId: number; amount: number }[];
};

export type ConversionLineCheck =
  | { ok: true; lines: ResolvedConversionLine[]; total: number }
  | { ok: false; errors: Record<string, string> };

const lineRefusal = (message: string): ConversionLineCheck => ({
  ok: false,
  errors: { _lines: message },
});

/**
 * The lines, checked against the header that admits them.
 *
 * Each destination is a base-currency Cash & Bank of the same Company, named
 * once. Each line names at least one item, and **its amount is what its items
 * add up to** — the Partner's money is what is sold, so a line never carries
 * any of the Company's own. Every item must be this book's, this Partner's,
 * in the document's currency, still open, and not converted for more than it
 * holds across the whole document.
 */
export async function checkConversionLines(
  header: ResolvedConversionHeader,
  lines: ConversionLineInput[],
  /** The document's date — an item may not go below nothing from it on. */
  date: string = todayDay()
): Promise<ConversionLineCheck> {
  const wanted = lines.filter((l) => l.to_cash_bank_id > 0);
  if (!wanted.length) {
    return lineRefusal("Dokumen harus memiliki minimal satu Cash & Bank tujuan.");
  }

  const seen = new Set<number>();
  for (const l of wanted) {
    if (seen.has(l.to_cash_bank_id)) {
      return lineRefusal(
        "Satu Cash & Bank hanya boleh muncul sekali sebagai tujuan. Gabungkan open item-nya ke satu baris."
      );
    }
    seen.add(l.to_cash_bank_id);
    if (!(l.exchange_rate && l.exchange_rate > 0)) {
      return lineRefusal(
        `Isi kurs setiap baris — berapa nilai 1 ${header.currencyLabel} dalam ` +
          `${BASE_CURRENCY_LABEL} pada pencairan ini.`
      );
    }
    if (!l.items.length) {
      return lineRefusal(
        "Setiap baris harus memilih open item yang dikonversi. Nominal baris adalah jumlah item-nya."
      );
    }
    const ids = new Set<number>();
    for (const a of l.items) {
      if (ids.has(a.item_id)) {
        return lineRefusal("Satu open item hanya boleh dipilih sekali dalam satu baris.");
      }
      ids.add(a.item_id);
      if (!(a.amount > 0)) {
        return lineRefusal("Nominal setiap open item harus lebih dari nol.");
      }
    }
  }

  const resources = await prisma.mCashBank.findMany({
    where: { id: { in: wanted.map((l) => l.to_cash_bank_id) } },
    select: {
      id: true,
      company_id: true,
      status: true,
      cash_bank_label: true,
      currency: { select: { currency_label: true } },
    },
  });
  const byId = new Map(resources.map((r) => [r.id, r]));

  const itemIds = [...new Set(wanted.flatMap((l) => l.items.map((i) => i.item_id)))];
  const items = new Map((await subledgerItemsByIds(itemIds)).map((i) => [i.id, i]));
  const used = new Map<number, number>();

  const resolved: ResolvedConversionLine[] = [];
  for (const l of wanted) {
    const to = byId.get(l.to_cash_bank_id);
    if (!to) return lineRefusal("Cash & Bank tujuan tidak ditemukan.");
    if (to.company_id !== header.companyId) {
      return lineRefusal(
        `${to.cash_bank_label} milik Company lain. Pencairan berlangsung di dalam satu Company.`
      );
    }
    if (to.status !== "Active") {
      return lineRefusal(`${to.cash_bank_label} non-aktif dan tidak dapat menerima dana.`);
    }
    if (!isBaseCurrency(to.currency.currency_label)) {
      return lineRefusal(
        `Hasil pencairan diterima dalam ${BASE_CURRENCY_LABEL}, jadi Cash & Bank ` +
          `tujuan harus ${BASE_CURRENCY_LABEL}, bukan ${to.currency.currency_label}.`
      );
    }

    for (const a of l.items) {
      const item = items.get(a.item_id);
      if (
        !item ||
        item.bookId !== header.book.categoryId ||
        item.partnerId !== header.partnerId ||
        item.currencyId !== header.currencyId
      ) {
        return lineRefusal(
          `Open item yang dipilih bukan milik ${header.book.name}, Partner ` +
            `${header.partnerLabel}, dan ${header.currencyLabel}.`
        );
      }
      if (item.status !== "Open") {
        return lineRefusal(`Open item ${item.itemNo} sudah selesai dan tidak dapat dikonversi.`);
      }
      const total = roundBase((used.get(item.id) ?? 0) + a.amount);
      if (cents(total) > cents(item.remaining)) {
        return lineRefusal(
          `Open item ${item.itemNo} tinggal ${formatMoney(item.remaining, header.currencyLabel)}, ` +
            `tidak cukup untuk ${formatMoney(total, header.currencyLabel)} pada dokumen ini.`
        );
      }
      const lowest = await itemLowestFrom(item.id, date);
      if (cents(total) > cents(lowest.balance)) {
        return lineRefusal(
          `Open item ${item.itemNo} tinggal ${formatMoney(lowest.balance, header.currencyLabel)} ` +
            `pada ${lowest.at}, tidak cukup untuk ${formatMoney(total, header.currencyLabel)}. ` +
            "Posisi tidak boleh di bawah nol pada hari mana pun — ubah tanggal akuntansi."
        );
      }
      used.set(item.id, total);
    }

    resolved.push({
      toCashBankId: to.id,
      rate: l.exchange_rate!,
      amount: roundBase(l.items.reduce((t, a) => t + a.amount, 0)),
      items: l.items.map((a) => ({ itemId: a.item_id, amount: a.amount })),
    });
  }

  const total = roundBase(resolved.reduce((t, l) => t + l.amount, 0));
  if (cents(total) > cents(header.layerRemaining)) {
    return lineRefusal(
      `Total ${formatMoney(total, header.currencyLabel)} melebihi sisa layer ` +
        `${formatMoney(header.layerRemaining, header.currencyLabel)}. Satu dokumen ` +
        "memakai tepat satu layer — kurangi item, pilih layer lain, atau pecah dokumen."
    );
  }

  return { ok: true, lines: resolved, total };
}

