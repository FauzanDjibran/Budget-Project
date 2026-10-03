import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatMoney, formatRate, sumByCurrency, type MoneyTotal } from "@/lib/format";
import { InsufficientFunds, recordCashBankEntry } from "./cash-bank";
import {
  LayerNotAvailable,
  drawFromLayer,
  openLayersFor,
  type LayerOption,
} from "./cash-bank-layers";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import {
  PeriodShut,
  checkTransactionDate,
  holdPostingPeriod,
  todayDay,
} from "./fiscal";
import { relieve, roundBase, type Balance } from "./fx";
import { valueConversionLine } from "./item-conversion-valuation";
import type { ConversionStatus } from "./item-conversion-workflow";
import {
  describeJournalLines,
  postJournal,
  type JournalLineInput,
  type JournalPreviewLine,
} from "./journal";
import {
  SubledgerItemUnavailable,
  lockSubledgerPosition,
  openSubledgerItemsFor,
  recordSubledgerEntry,
  subledgerItem,
  subledgerItemsByIds,
} from "./subledger";
import { subledgerForCategory, type SubledgerDef } from "./subledger-catalogue";
import { loadSubledgers } from "./subledger-data";
import { systemAccountId } from "./system-account-data";

/**
 * Pencairan Open Item: foreign currency sold out of the Company's own Cash &
 * Bank, and one Partner's open items in that currency converted to base
 * currency **at the same kurs**, in one document.
 *
 * The case it exists for: a stakeholder's dollar Titipan is cashed into rupiah.
 * The Company sells dollars at the bank, and from that moment owes the
 * stakeholder rupiah instead. Done as two documents — a Pencairan and a
 * revaluation — each leg would recognise its own difference against two
 * different rates. Done here, one kurs values both legs, so the only
 * difference left is the gap between what the cash and the items were each
 * carried at, and it is journalled as **one** Selisih Kurs line: a difference
 * of the sale, never a revaluation of the Titipan.
 *
 * ## Shape
 *
 * The header names the foreign source, its one layer, one book and one
 * Partner. Each line names a base-currency destination, the kurs the bank
 * paid, and the Partner's items it converts; the line is worth exactly what
 * its items add up to, because the money being sold is the Partner's and a
 * line never mixes it with the Company's own. Post, in one transaction:
 *
 *   1. draws the source layer, line by line, and writes one Cash Bank Book
 *      entry out of the source and one into each destination;
 *   2. releases each foreign item at its own kurs (`Conversion` entries);
 *   3. opens one base-currency item per line, in the same book, for exactly
 *      what the bank paid;
 *   4. writes one balanced journal — the cash legs, a release line per item,
 *      a line per new item, and one Selisih Kurs line for the document.
 *
 * Which side each Partner line takes follows the book's own `raises`, so one
 * document serves every book: a Titipan's release is a debit, a Piutang's a
 * credit (`item-conversion-valuation.ts`).
 *
 * Its own module rather than a fourth Transfer purpose: a transfer names no
 * Partner and writes no subject book (CLAUDE.md §10 rule 84). It reaches the
 * books only through the functions they export, and nothing imports it.
 */

const day = (d: Date): string => d.toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100);

export const CONVERSION_LABEL = "Pencairan Open Item";

// --------------------------------------------------------------------- rows

export type ConversionRow = {
  id: number;
  conversion_no: string;
  document_date: string | null;
  posting_date: string | null;
  company_id: number;
  from_cash_bank_id: number;
  currency_id: number;
  cash_bank_layer_id: number;
  budget_category_id: number;
  partner_id: number;
  conversion_amount: number;
  conversion_base_amount: number;
  fx_difference: number;
  note: string | null;
  status: ConversionStatus;
  line_count: number;
  /**
   * What the document names, read back through its own relations rather than
   * out of the pickers: a posted document keeps naming a Partner deactivated
   * since, and a book whose category was retired.
   */
  partner_label: string;
  partner_name: string;
  book_name: string;
  currency_label: string;
  source_label: string;
  source_name: string;
  created_by: number;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type ConversionLineItemRow = {
  id: number;
  item_id: number;
  item_no: string;
  item_date: string | null;
  item_rate: number | null;
  item_note: string | null;
  amount: number;
  settlement_base_amount: number;
  converted_base_amount: number;
  fx_difference: number;
};

export type ConversionLineRow = {
  id: number;
  sequence_no: number;
  to_cash_bank_id: number;
  amount: number;
  exchange_rate: number;
  out_base_amount: number;
  in_amount: number;
  opened_item_no: string | null;
  cash_fx_difference: number;
  item_fx_difference: number;
  items: ConversionLineItemRow[];
};

const ROW_INCLUDE = {
  _count: { select: { lines: true } },
  partner: { select: { partner_label: true, partner_name: true } },
  budget_category: { select: { category_label: true } },
  currency: { select: { currency_label: true } },
  from_cash_bank: { select: { cash_bank_label: true, cash_bank_name: true } },
} as const;

type ConversionRecord = Prisma.FinItemConversionGetPayload<{ include: typeof ROW_INCLUDE }>;

function toRow(c: ConversionRecord): ConversionRow {
  return {
    id: c.id,
    conversion_no: c.conversion_no,
    document_date: c.document_date ? day(c.document_date) : null,
    posting_date: c.posting_date ? c.posting_date.toISOString() : null,
    company_id: c.company_id,
    from_cash_bank_id: c.from_cash_bank_id,
    currency_id: c.currency_id,
    cash_bank_layer_id: c.cash_bank_layer_id,
    budget_category_id: c.budget_category_id,
    partner_id: c.partner_id,
    conversion_amount: c.conversion_amount.toNumber(),
    conversion_base_amount: c.conversion_base_amount.toNumber(),
    fx_difference: c.fx_difference.toNumber(),
    note: c.note,
    status: c.status as ConversionStatus,
    line_count: c._count.lines,
    partner_label: c.partner.partner_label,
    partner_name: c.partner.partner_name,
    book_name: `Buku ${c.budget_category.category_label}`,
    currency_label: c.currency.currency_label,
    source_label: c.from_cash_bank.cash_bank_label,
    source_name: c.from_cash_bank.cash_bank_name,
    created_by: c.created_by,
    updated_by: c.updated_by,
    created_at: c.created_at.toISOString(),
    updated_at: c.updated_at.toISOString(),
  };
}

export async function listConversions(companyIds: number[]): Promise<ConversionRow[]> {
  const rows = await prisma.finItemConversion.findMany({
    where: { company_id: { in: companyIds } },
    orderBy: [{ id: "desc" }],
    include: ROW_INCLUDE,
  });
  return rows.map(toRow);
}

export async function getConversion(id: number): Promise<ConversionRow | null> {
  const row = await prisma.finItemConversion.findUnique({
    where: { id },
    include: ROW_INCLUDE,
  });
  return row ? toRow(row) : null;
}

/**
 * A document's lines, each with the items it names. Items are read through the
 * subject-book module — which owns them — so a posted line keeps naming an item
 * it has since cleared.
 */
export async function conversionLines(conversionId: number): Promise<ConversionLineRow[]> {
  const lines = await prisma.finItemConversionLine.findMany({
    where: { conversion_id: conversionId },
    orderBy: { sequence_no: "asc" },
    include: { items: { orderBy: { sequence_no: "asc" } } },
  });
  const ids = lines.flatMap((l) => [
    ...l.items.map((i) => i.sub_ledger_balance_id),
    ...(l.opened_item_id ? [l.opened_item_id] : []),
  ]);
  const items = new Map((await subledgerItemsByIds(ids)).map((i) => [i.id, i]));

  return lines.map((l) => ({
    id: l.id,
    sequence_no: l.sequence_no,
    to_cash_bank_id: l.to_cash_bank_id,
    amount: l.amount.toNumber(),
    exchange_rate: l.exchange_rate.toNumber(),
    out_base_amount: l.out_base_amount.toNumber(),
    in_amount: l.in_amount.toNumber(),
    opened_item_no: l.opened_item_id ? items.get(l.opened_item_id)?.itemNo ?? null : null,
    cash_fx_difference: l.cash_fx_difference.toNumber(),
    item_fx_difference: l.item_fx_difference.toNumber(),
    items: l.items.map((i) => {
      const item = items.get(i.sub_ledger_balance_id);
      return {
        id: i.id,
        item_id: i.sub_ledger_balance_id,
        item_no: item?.itemNo ?? `#${i.sub_ledger_balance_id}`,
        item_date: item?.date ?? null,
        item_rate: item?.rate ?? null,
        item_note: item?.note ?? null,
        amount: i.amount.toNumber(),
        settlement_base_amount: i.settlement_base_amount.toNumber(),
        converted_base_amount: i.converted_base_amount.toNumber(),
        fx_difference: i.fx_difference.toNumber(),
      };
    }),
  }));
}

// ----------------------------------------------------------------- doc type

export async function conversionDocTypeId(): Promise<number> {
  const row = await prisma.sysDocType.findFirstOrThrow({
    where: { doc_table: "fin_item_conversion" },
    select: { id: true },
  });
  return row.id;
}

/**
 * Document numbers for a set of ids — how another module names a document it
 * holds a reference to, without reading `fin_item_conversion` itself.
 */
export async function conversionNumbersByIds(
  ids: number[]
): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.finItemConversion.findMany({
    where: { id: { in: ids } },
    select: { id: true, conversion_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.conversion_no]));
}

/** Next document number, `POI-0001`. */
export async function nextConversionNo(): Promise<string> {
  return nextDocumentNumber("POI", async () => {
    const row = await prisma.finItemConversion.findFirst({
      orderBy: { id: "desc" },
      select: { conversion_no: true },
    });
    return row?.conversion_no ?? null;
  });
}

// --------------------------------------------------------------------- refs

export type ConversionCashBankOption = {
  id: number;
  label: string;
  name: string;
  companyId: number;
  currencyId: number;
  currencyLabel: string;
  isBase: boolean;
  active: boolean;
  layers: LayerOption[];
};

export type ConversionBookOption = {
  categoryId: number;
  key: string;
  name: string;
  /** Which cash direction raises the position — decides every side. */
  raises: "In" | "Out";
};

export type ConversionPartnerOption = {
  id: number;
  label: string;
  name: string;
  companyId: number;
  active: boolean;
};

/** One foreign open item a line may convert. */
export type ConversionItemOption = {
  id: number;
  itemNo: string;
  book: string;
  partnerId: number;
  currencyId: number;
  date: string;
  rate: number;
  remaining: number;
  baseRemaining: number;
  note: string | null;
};

export type ConversionRefs = {
  cashBanks: ConversionCashBankOption[];
  books: ConversionBookOption[];
  partners: ConversionPartnerOption[];
  /** Every foreign item still open for a Partner in scope. */
  items: ConversionItemOption[];
};

/**
 * Everything the form picks from, in one read.
 *
 * Every book is offered — whatever keeps a book may be converted, on the
 * user's rule. Only foreign open items travel: a base-currency item has
 * nothing to convert into.
 */
export async function conversionRefs(companyIds: number[]): Promise<ConversionRefs> {
  const [cashBanks, books, partners] = await Promise.all([
    prisma.mCashBank.findMany({
      where: { company_id: { in: companyIds } },
      orderBy: [{ cash_bank_label: "asc" }],
      select: {
        id: true,
        cash_bank_label: true,
        cash_bank_name: true,
        company_id: true,
        currency_id: true,
        status: true,
        currency: { select: { currency_label: true } },
      },
    }),
    loadSubledgers(),
    prisma.mPartner.findMany({
      where: { company_id: { in: companyIds } },
      orderBy: [{ partner_label: "asc" }],
      select: {
        id: true,
        partner_label: true,
        partner_name: true,
        company_id: true,
        status: true,
      },
    }),
  ]);

  const foreignCurrencyIds = [
    ...new Set(
      cashBanks
        .filter((c) => !isBaseCurrency(c.currency.currency_label))
        .map((c) => c.currency_id)
    ),
  ];
  const [layers, items] = await Promise.all([
    openLayersFor(cashBanks.map((c) => c.id)),
    openSubledgerItemsFor(
      partners.map((p) => p.id),
      foreignCurrencyIds
    ),
  ]);

  return {
    cashBanks: cashBanks.map((c) => ({
      id: c.id,
      label: c.cash_bank_label,
      name: c.cash_bank_name,
      companyId: c.company_id,
      currencyId: c.currency_id,
      currencyLabel: c.currency.currency_label,
      isBase: isBaseCurrency(c.currency.currency_label),
      active: c.status === "Active",
      layers: layers.get(c.id) ?? [],
    })),
    books: books.map((b) => ({
      categoryId: b.categoryId,
      key: b.key,
      name: b.name,
      raises: b.raises,
    })),
    partners: partners.map((p) => ({
      id: p.id,
      label: p.partner_label,
      name: p.partner_name,
      companyId: p.company_id,
      active: p.status === "Active",
    })),
    items: items.map((i) => ({
      id: i.id,
      itemNo: i.itemNo,
      book: i.book,
      partnerId: i.partnerId,
      currencyId: i.currencyId,
      date: i.date,
      rate: i.rate,
      remaining: i.remaining,
      baseRemaining: i.baseRemaining,
      note: i.note,
    })),
  };
}

// ------------------------------------------------------------------- header

export type ConversionHeader = {
  from_cash_bank_id: number | null;
  cash_bank_layer_id: number | null;
  budget_category_id: number | null;
  partner_id: number | null;
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
      select: { cash_bank_id: true, status: true, rate: true, foreign_remaining: true },
    });
    if (!layer || layer.cash_bank_id !== header.from_cash_bank_id) {
      errors.cash_bank_layer_id =
        "Layer kurs tersebut bukan milik Cash & Bank sumber yang dipilih.";
    } else if (layer.status !== "Open") {
      errors.cash_bank_layer_id = "Layer kurs tersebut sudah habis dan tidak dapat dipakai lagi.";
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
  lines: ConversionLineInput[]
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
        item.book !== header.book.key ||
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

// ------------------------------------------------------------------ posting

export type ConversionPostingResult =
  | { ok: true; fxDifference: number; journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/** A refusal raised inside the posting transaction, converted back after the rollback. */
class ConversionRefused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("Pencairan Open Item ditolak");
    this.name = "ConversionRefused";
  }
}

/** Carries a dry run's journal out of the transaction it rolls back. */
class ConversionDryRun extends Error {
  constructor(readonly lines: JournalLineInput[]) {
    super("Pratinjau Pencairan Open Item");
    this.name = "ConversionDryRun";
  }
}

type PlannedItem = {
  rowId: number;
  itemId: number;
  itemNo: string;
  amount: number;
  /** The item's own kurs, which its release is valued at. */
  rate: number;
  releasedBase: number;
  share: number;
  fx: number;
};

type PlannedLine = {
  rowId: number;
  toCashBankId: number;
  toLabel: string;
  toAccountId: number;
  toCurrencyId: number;
  amount: number;
  rate: number;
  outBase: number;
  inAmount: number;
  cashFx: number;
  itemFx: number;
  items: PlannedItem[];
};

/**
 * Post: the actual boundary, and one database transaction.
 *
 * Everything that can be decided without a write is decided first — the date,
 * the header, the mapped account — so an ordinary refusal comes back without a
 * transaction opening. Inside it the period is held, the Partner's foreign
 * position is locked, the layer is drawn and the items are re-read under the
 * lock; then the books, the journal and the document's own figures are written
 * together. Either all of it happened or none of it did.
 *
 * Lives here rather than inside the Server Action so the rule is testable.
 */
export async function applyConversion(
  conversionId: number,
  actorId: number,
  /**
   * Run the whole posting and roll it back once the journal is known — what
   * the Post confirmation shows. The layer and the items are valued under the
   * transaction's own reads, so a rolled-back run values them exactly as Post.
   */
  dryRun = false
): Promise<ConversionPostingResult> {
  const doc = await prisma.finItemConversion.findUnique({
    where: { id: conversionId },
    include: {
      lines: {
        orderBy: { sequence_no: "asc" },
        include: {
          items: { orderBy: { sequence_no: "asc" } },
          to_cash_bank: {
            select: { cash_bank_label: true, account_id: true, currency_id: true },
          },
        },
      },
      from_cash_bank: { select: { cash_bank_label: true, account_id: true } },
      company: { select: { is_parent: true } },
    },
  });

  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Draft") {
    return { ok: false, errors: { _form: "Hanya dokumen berstatus Draft yang dapat diposting." } };
  }
  if (!doc.lines.length) {
    return {
      ok: false,
      errors: { _form: "Tambahkan minimal satu Cash & Bank tujuan sebelum dokumen diposting." },
    };
  }

  const dated = await checkTransactionDate(doc.document_date ?? todayDay(), [doc.company_id]);
  if (!dated.ok) return { ok: false, errors: { _form: dated.message } };
  const date = dated.date;

  // Re-checked rather than trusted from the save: the layer may have been
  // spent, the Partner deactivated, the book's category retired.
  const header = await checkConversionHeader(
    {
      from_cash_bank_id: doc.from_cash_bank_id,
      cash_bank_layer_id: doc.cash_bank_layer_id,
      budget_category_id: doc.budget_category_id,
      partner_id: doc.partner_id,
    },
    [doc.company_id]
  );
  if (!header.ok) return { ok: false, errors: { _form: Object.values(header.errors)[0] } };
  const lineCheck = await checkConversionLines(
    header,
    doc.lines.map((l) => ({
      to_cash_bank_id: l.to_cash_bank_id,
      exchange_rate: l.exchange_rate.toNumber(),
      items: l.items.map((i) => ({ item_id: i.sub_ledger_balance_id, amount: i.amount.toNumber() })),
    }))
  );
  if (!lineCheck.ok) return { ok: false, errors: { _form: lineCheck.errors._lines } };

  // The Partner's account, exactly as a cash posting resolves it — Company ×
  // Budget Category × Partner Category. One account for both currencies.
  const mapping = await prisma.accBudgetCategoryAccount.findFirst({
    where: {
      company_id: doc.company_id,
      budget_category_id: doc.budget_category_id,
      partner_category_id: header.partnerCategoryId,
    },
    select: {
      account: {
        select: { id: true, company_id: true, is_active: true, is_postable: true, account_label: true },
      },
    },
  });
  if (!mapping) {
    return {
      ok: false,
      errors: {
        _form:
          `Belum ada Mapping Budget ke Account untuk ${header.book.name} dan ` +
          `Partner Category ${header.partnerLabel}. Lengkapi mapping di Accounting ` +
          "sebelum dokumen diposting.",
      },
    };
  }
  const partnerAccount = mapping.account;
  if (
    partnerAccount.company_id !== doc.company_id ||
    !partnerAccount.is_active ||
    !partnerAccount.is_postable
  ) {
    return {
      ok: false,
      errors: {
        _form:
          `Account ${partnerAccount.account_label} yang dipetakan untuk posisi ini ` +
          "tidak aktif atau bukan account postable.",
      },
    };
  }

  const base = await prisma.refCurrency.findFirst({
    where: { currency_label: BASE_CURRENCY_LABEL },
    select: { id: true },
  });
  if (!base) {
    throw new Error(`Currency dasar ${BASE_CURRENCY_LABEL} tidak ada pada master. Jalankan db:seed.`);
  }

  const book = header.book;
  const raisesOnIn = book.raises === "In";
  // Releasing moves the position the way money leaving would for a book money
  // arriving raises, and the mirror for the other kind.
  const releaseDirection = raisesOnIn ? "Out" : "In";
  const docTypeId = await conversionDocTypeId();
  const label = `${doc.conversion_no} — ${CONVERSION_LABEL}`;
  let fxDifference = 0;

  try {
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, [doc.company_id], date);
      // Held until the transaction ends: a second document converting or
      // settling this Partner's foreign items waits here, and reads what this
      // one left.
      await lockSubledgerPosition(tx, book.key, doc.partner_id, doc.currency_id);

      // The items as they stand under the lock, tracked across lines so an
      // item split between two lines relieves its second part from what the
      // first left — exactly as `recordSubledgerEntry` will.
      const itemState = new Map<number, { itemNo: string; rate: number; balance: Balance }>();
      for (const l of doc.lines) {
        for (const i of l.items) {
          if (itemState.has(i.sub_ledger_balance_id)) continue;
          const item = await subledgerItem(i.sub_ledger_balance_id, tx);
          if (!item || item.status !== "Open") {
            throw new ConversionRefused({
              _form: `Open item ${item?.itemNo ?? ""} sudah selesai sejak dokumen disimpan.`,
            });
          }
          itemState.set(item.id, {
            itemNo: item.itemNo,
            rate: item.rate,
            balance: { foreign: item.remaining, base: item.baseRemaining },
          });
        }
      }

      const planned: PlannedLine[] = [];
      let sourceAmount = 0;
      let sourceBase = 0;
      let sourceRate = header.layerRate;

      for (const l of doc.lines) {
        const amount = l.amount.toNumber();
        const rate = l.exchange_rate.toNumber();
        const drawn = await drawFromLayer(tx, {
          layerId: doc.cash_bank_layer_id,
          cashBankId: doc.from_cash_bank_id,
          foreign: amount,
          actorId,
        });
        sourceRate = drawn.rate;

        const released = l.items.map((i) => {
          const state = itemState.get(i.sub_ledger_balance_id)!;
          const want = i.amount.toNumber();
          if (cents(want) > cents(state.balance.foreign)) {
            throw new ConversionRefused({
              _form:
                `Open item ${state.itemNo} tinggal ${formatMoney(state.balance.foreign, header.currencyLabel)}, ` +
                `tidak cukup untuk ${formatMoney(want, header.currencyLabel)}.`,
            });
          }
          const relief = relieve(
            state.balance,
            cents(want) === cents(state.balance.foreign) ? state.balance.foreign : want
          );
          state.balance = relief.remaining;
          return { row: i, state, amount: want, base: relief.base };
        });

        const valued = valueConversionLine({
          amount,
          rate,
          layerReleasedBase: drawn.base,
          layerRate: drawn.rate,
          raisesOnIn,
          items: released.map((r) => ({ amount: r.amount, releasedBase: r.base })),
        });

        sourceAmount = roundBase(sourceAmount + amount);
        sourceBase = roundBase(sourceBase + valued.outBase);

        planned.push({
          rowId: l.id,
          toCashBankId: l.to_cash_bank_id,
          toLabel: l.to_cash_bank.cash_bank_label,
          toAccountId: l.to_cash_bank.account_id,
          toCurrencyId: l.to_cash_bank.currency_id,
          amount,
          rate,
          outBase: valued.outBase,
          inAmount: valued.inAmount,
          cashFx: valued.cashFx,
          itemFx: valued.itemFxTotal,
          items: released.map((r, k) => ({
            rowId: r.row.id,
            itemId: r.row.sub_ledger_balance_id,
            itemNo: r.state.itemNo,
            amount: r.amount,
            rate: r.state.rate,
            releasedBase: r.base,
            share: valued.shares[k],
            fx: valued.itemFx[k],
          })),
        });
      }

      fxDifference = roundBase(
        planned.reduce((t, l) => t + l.cashFx + l.itemFx, 0)
      );

      // A difference has to land somewhere named, and is resolved only when
      // one actually arises.
      let fxAccountId: number | null = null;
      if (fxDifference !== 0) {
        fxAccountId = await systemAccountId(doc.company.is_parent, "fx");
        if (!fxAccountId) {
          throw new ConversionRefused({
            _form:
              "Selisih kurs muncul pada dokumen ini, tetapi Account Selisih Kurs " +
              "belum diatur untuk Company ini. Lengkapi di Accounting › Mapping " +
              "Account System sebelum dokumen diposting.",
          });
        }
      }

      // The journal, in the order a reader checks it: the cash legs, then the
      // Partner legs, then the one difference.
      const entries: JournalLineInput[] = [
        {
          accountId: doc.from_cash_bank.account_id,
          currencyId: doc.currency_id,
          rate: sourceRate,
          debit: 0,
          credit: sourceAmount,
          baseAmount: sourceBase,
          description: `${doc.conversion_no} — ${doc.from_cash_bank.cash_bank_label}`,
        },
        ...planned.map((l) => ({
          accountId: l.toAccountId,
          currencyId: l.toCurrencyId,
          rate: 1,
          debit: l.inAmount,
          credit: 0,
          baseAmount: l.inAmount,
          description: `${CONVERSION_LABEL} — ${l.toLabel}`,
        })),
      ];
      for (const l of planned) {
        for (const i of l.items) {
          entries.push({
            accountId: partnerAccount.id,
            partnerId: doc.partner_id,
            currencyId: doc.currency_id,
            rate: i.rate,
            debit: raisesOnIn ? i.amount : 0,
            credit: raisesOnIn ? 0 : i.amount,
            baseAmount: i.releasedBase,
            description: `${doc.conversion_no} — ${i.itemNo} dikonversi`,
          });
        }
        entries.push({
          accountId: partnerAccount.id,
          partnerId: doc.partner_id,
          currencyId: base.id,
          rate: 1,
          debit: raisesOnIn ? 0 : l.inAmount,
          credit: raisesOnIn ? l.inAmount : 0,
          baseAmount: l.inAmount,
          description: `${doc.conversion_no} — konversi ke ${BASE_CURRENCY_LABEL} @ ${formatRate(l.rate)}`,
        });
      }
      if (fxDifference !== 0 && fxAccountId) {
        const gain = fxDifference > 0;
        entries.push({
          accountId: fxAccountId,
          currencyId: base.id,
          rate: 1,
          debit: gain ? 0 : Math.abs(fxDifference),
          credit: gain ? Math.abs(fxDifference) : 0,
          description: `Selisih pencairan — ${doc.conversion_no}`,
        });
      }

      if (dryRun) throw new ConversionDryRun(entries);

      // The source gives up once, however many destinations there are.
      await recordCashBankEntry(tx, {
        cashBankId: doc.from_cash_bank_id,
        date,
        type: "Transaction",
        direction: "Out",
        amount: sourceAmount,
        rate: sourceRate,
        baseAmount: sourceBase,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        note: `${label} · ${header.partnerLabel}`,
        actorId,
      });

      for (const l of planned) {
        await recordCashBankEntry(tx, {
          cashBankId: l.toCashBankId,
          date,
          type: "Transaction",
          direction: "In",
          amount: l.inAmount,
          rate: 1,
          baseAmount: l.inAmount,
          sourceDocTypeId: docTypeId,
          sourceDocId: doc.id,
          note: `${label} · ${header.partnerLabel}`,
          actorId,
        });

        // Each foreign item released at its own kurs. `baseAmount` is passed
        // so an item another writer moved since the plan valued it throws
        // rather than posting a figure the journal does not carry.
        for (const i of l.items) {
          await recordSubledgerEntry(tx, {
            book,
            partnerId: doc.partner_id,
            currencyId: doc.currency_id,
            date,
            type: "Conversion",
            direction: releaseDirection,
            amount: i.amount,
            rate: i.rate,
            baseAmount: i.releasedBase,
            itemId: i.itemId,
            sourceDocTypeId: docTypeId,
            sourceDocId: doc.id,
            note: label,
            actorId,
          });
          await tx.finItemConversionLineItem.update({
            where: { id: i.rowId },
            data: {
              settlement_base_amount: i.releasedBase,
              converted_base_amount: i.share,
              fx_difference: i.fx,
              updated_by: actorId,
            },
          });
        }

        // What the line's sale produced is what the Partner's position now
        // is, in base currency: one new item, at a kurs of 1, named after
        // what it came from.
        const opened = await recordSubledgerEntry(tx, {
          book,
          partnerId: doc.partner_id,
          currencyId: base.id,
          date,
          type: "Conversion",
          direction: book.raises,
          amount: l.inAmount,
          rate: 1,
          baseAmount: l.inAmount,
          sourceDocTypeId: docTypeId,
          sourceDocId: doc.id,
          note:
            `${doc.conversion_no} — konversi ${l.items.map((i) => i.itemNo).join(", ")} ` +
            `(${formatMoney(l.amount, header.currencyLabel)} @ ${formatRate(l.rate)})`,
          actorId,
        });

        await tx.finItemConversionLine.update({
          where: { id: l.rowId },
          data: {
            out_base_amount: l.outBase,
            in_amount: l.inAmount,
            opened_item_id: opened.balance_id,
            cash_fx_difference: l.cashFx,
            item_fx_difference: l.itemFx,
            updated_by: actorId,
          },
        });
      }

      // The Journal is written alongside the books, never from them, and
      // throws unless it balances — which takes the whole posting down.
      await postJournal(tx, {
        companyId: doc.company_id,
        postingDate: new Date(`${date}T00:00:00Z`),
        description: `${label} · ${header.partnerLabel}`,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        lines: entries,
        actorId,
      });

      await tx.finItemConversion.update({
        where: { id: doc.id },
        data: {
          status: "Posted",
          document_date: new Date(`${date}T00:00:00Z`),
          posting_date: new Date(),
          conversion_base_amount: sourceBase,
          fx_difference: fxDifference,
          updated_by: actorId,
        },
      });
    });
  } catch (error) {
    if (error instanceof ConversionDryRun) return { ok: true, fxDifference, journal: error.lines };
    if (error instanceof ConversionRefused) return { ok: false, errors: error.errors };
    if (
      error instanceof PeriodShut ||
      error instanceof InsufficientFunds ||
      error instanceof LayerNotAvailable ||
      error instanceof SubledgerItemUnavailable
    ) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }

  return { ok: true, fxDifference };
}

/** The journal Post would write for this document, or its refusal. Writes nothing. */
export async function previewConversion(
  conversionId: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const result = await applyConversion(conversionId, 0, true);
  if (!result.ok) return result;
  return { ok: true, lines: await describeJournalLines(result.journal ?? []) };
}

// ------------------------------------------------------------------ summary

export type ConversionSummary = {
  draft: number;
  posted: number;
  cancelled: number;
  /** Posted value, per currency — never added across currencies. */
  postedTotals: MoneyTotal[];
};

export function summariseConversions(rows: ConversionRow[]): ConversionSummary {
  const posted = rows.filter((r) => r.status === "Posted");
  return {
    draft: rows.filter((r) => r.status === "Draft").length,
    posted: posted.length,
    cancelled: rows.filter((r) => r.status === "Cancelled").length,
    postedTotals: sumByCurrency(
      posted.map((r) => ({
        currencyId: r.currency_id,
        currencyLabel: r.currency_label,
        amount: r.conversion_amount,
      }))
    ),
  };
}
