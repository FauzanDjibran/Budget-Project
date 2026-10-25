import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { openLayersFor, type LayerOption } from "./cash-bank-layers";
import { isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import type { ConversionStatus } from "./item-conversion-workflow";
import { openSubledgerItemsFor, subledgerItemsByIds } from "./subledger";
import { loadSubledgers } from "./subledger-data";

const day = (d: Date): string => d.toISOString().slice(0, 10);

/** Reads of Pencairan Open Item: the register rows, a document and its lines, its number, and the options its form picks from. */

// --------------------------------------------------------------------- rows

export type ConversionRow = {
  id: number;
  conversion_no: string;
  accounting_date: string | null;
  posted_at: string | null;
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
    accounting_date: c.accounting_date ? day(c.accounting_date) : null,
    posted_at: c.posted_at ? c.posted_at.toISOString() : null,
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
  /** The book's Budget Category id. */
  bookId: number;
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
      bookId: i.bookId,
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

