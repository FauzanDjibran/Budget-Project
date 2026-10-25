import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { roundBase } from "./fx";
import { ITEM_ADJUSTMENT_SERIES, adjustmentKind, type ItemAdjustmentEffect, type ItemAdjustmentKind, type ItemAdjustmentStatus } from "./item-adjustment-workflow";
import { openSubledgerItemsFor, subledgerItemsByIds, subledgerPositionsFor, type SubledgerItem } from "./subledger";
import { subledgerForCategory, type SubledgerDef } from "./subledger-catalogue";
import { loadSubledgers } from "./subledger-data";

const day = (d: Date): string => d.toISOString().slice(0, 10);

type Db = Prisma.TransactionClient | typeof prisma;

/** Reads of Penyesuaian Open Item: the register rows, a document and its lines, its number, and the options its form picks from. */

// --------------------------------------------------------------------- rows

export type ItemAdjustmentRow = {
  id: number;
  adjustment_no: string;
  /** What the lines do together — null on a document with no line. */
  kind: ItemAdjustmentKind | null;
  accounting_date: string | null;
  posted_at: string | null;
  company_id: number;
  budget_category_id: number;
  partner_id: number;
  currency_id: number;
  exchange_rate: number | null;
  /** The net change, raised less lowered; negative when it lowers on balance. */
  adjustment_amount: number;
  adjustment_base_amount: number;
  /** What the lines raise, and what they lower — both unsigned. */
  increase_amount: number;
  decrease_amount: number;
  reference: string | null;
  note: string | null;
  status: ItemAdjustmentStatus;
  line_count: number;
  /**
   * What the document names, read back through its own relations rather than
   * out of the pickers: a posted one keeps naming a Partner deactivated since,
   * and a book whose flag has since been turned off.
   */
  partner_label: string;
  partner_name: string;
  book_name: string;
  currency_label: string;
  created_by: number;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type ItemAdjustmentLineRow = {
  id: number;
  sequence_no: number;
  description: string;
  effect: ItemAdjustmentEffect;
  /** Null only on documents posted while a raise opened a new item. */
  itemId: number | null;
  itemNo: string;
  itemDate: string;
  rate: number;
  /** Null on documents posted before a line was stated as a new value. */
  balance_before: number | null;
  new_amount: number | null;
  /** The difference, unsigned; `effect` says which way. */
  amount: number;
  base_amount: number;
};

type AdjustmentRecord = {
  id: number;
  adjustment_no: string;
  accounting_date: Date | null;
  posted_at: Date | null;
  company_id: number;
  budget_category_id: number;
  partner_id: number;
  currency_id: number;
  exchange_rate: { toNumber(): number } | null;
  adjustment_amount: { toNumber(): number };
  adjustment_base_amount: { toNumber(): number };
  reference: string | null;
  note: string | null;
  status: string;
  created_by: number;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
  lines: { effect: string; amount: { toNumber(): number } }[];
  partner: { partner_label: string; partner_name: string };
  budget_category: { category_label: string };
  currency: { currency_label: string };
};

const ROW_INCLUDE = {
  lines: { select: { effect: true, amount: true } },
  partner: { select: { partner_label: true, partner_name: true } },
  budget_category: { select: { category_label: true } },
  currency: { select: { currency_label: true } },
} as const;

function toRow(n: AdjustmentRecord): ItemAdjustmentRow {
  const by = (effect: ItemAdjustmentEffect) =>
    roundBase(n.lines.filter((l) => l.effect === effect).reduce((t, l) => t + l.amount.toNumber(), 0));
  return {
    id: n.id,
    adjustment_no: n.adjustment_no,
    kind: adjustmentKind(n.lines.map((l) => l.effect as ItemAdjustmentEffect)),
    accounting_date: n.accounting_date ? day(n.accounting_date) : null,
    posted_at: n.posted_at ? n.posted_at.toISOString() : null,
    company_id: n.company_id,
    budget_category_id: n.budget_category_id,
    partner_id: n.partner_id,
    currency_id: n.currency_id,
    exchange_rate: n.exchange_rate ? n.exchange_rate.toNumber() : null,
    adjustment_amount: n.adjustment_amount.toNumber(),
    adjustment_base_amount: n.adjustment_base_amount.toNumber(),
    increase_amount: by("Increase"),
    decrease_amount: by("Decrease"),
    reference: n.reference,
    note: n.note,
    status: n.status as ItemAdjustmentStatus,
    line_count: n.lines.length,
    partner_label: n.partner.partner_label,
    partner_name: n.partner.partner_name,
    book_name: `Buku ${n.budget_category.category_label}`,
    currency_label: n.currency.currency_label,
    created_by: n.created_by,
    updated_by: n.updated_by,
    created_at: n.created_at.toISOString(),
    updated_at: n.updated_at.toISOString(),
  };
}

export async function listItemAdjustments(companyIds: number[]): Promise<ItemAdjustmentRow[]> {
  const rows = await prisma.finItemAdjustment.findMany({
    where: { company_id: { in: companyIds } },
    orderBy: [{ id: "desc" }],
    include: ROW_INCLUDE,
  });
  return rows.map(toRow);
}

export async function getItemAdjustment(id: number): Promise<ItemAdjustmentRow | null> {
  const row = await prisma.finItemAdjustment.findUnique({
    where: { id },
    include: ROW_INCLUDE,
  });
  return row ? toRow(row) : null;
}

export async function itemAdjustmentLines(adjustmentId: number): Promise<ItemAdjustmentLineRow[]> {
  const lines = await prisma.finItemAdjustmentLine.findMany({
    where: { adjustment_id: adjustmentId },
    orderBy: { sequence_no: "asc" },
  });
  const ids = lines.flatMap((l) => (l.sub_ledger_balance_id ? [l.sub_ledger_balance_id] : []));
  const known = new Map((await subledgerItemsByIds(ids)).map((i) => [i.id, i]));
  return lines.map((l) => {
    const item = l.sub_ledger_balance_id ? known.get(l.sub_ledger_balance_id) : undefined;
    return {
      id: l.id,
      sequence_no: l.sequence_no,
      description: l.description,
      effect: l.effect as ItemAdjustmentEffect,
      itemId: l.sub_ledger_balance_id,
      itemNo: item?.itemNo ?? "—",
      itemDate: item?.date ?? "",
      rate: item?.rate ?? 0,
      balance_before: l.balance_before?.toNumber() ?? null,
      new_amount: l.new_amount?.toNumber() ?? null,
      amount: l.amount.toNumber(),
      base_amount: l.base_amount.toNumber(),
    };
  });
}

// ----------------------------------------------------------------- doc type

export async function itemAdjustmentDocTypeId(): Promise<number> {
  const row = await prisma.sysDocType.findFirstOrThrow({
    where: { doc_table: "fin_item_adjustment" },
    select: { id: true },
  });
  return row.id;
}

/**
 * Document numbers for a set of ids — how another module names an adjustment
 * it holds a reference to, without reading `fin_item_adjustment` itself.
 */
export async function itemAdjustmentNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.finItemAdjustment.findMany({
    where: { id: { in: ids } },
    select: { id: true, adjustment_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.adjustment_no]));
}

/**
 * Next number, `PYO-0001`. Documents posted as Debit / Credit Notes keep their
 * `DN-` / `CN-` numbers in the same table, so the highest is read within the
 * series rather than across the table.
 */
export async function nextItemAdjustmentNo(db: Db = prisma): Promise<string> {
  return nextDocumentNumber(ITEM_ADJUSTMENT_SERIES, async () => {
    const row = await db.finItemAdjustment.findFirst({
      where: { adjustment_no: { startsWith: `${ITEM_ADJUSTMENT_SERIES}-` } },
      orderBy: { id: "desc" },
      select: { adjustment_no: true },
    });
    return row?.adjustment_no ?? null;
  });
}

// --------------------------------------------------------------------- refs

export type ItemAdjustmentBookOption = {
  categoryId: number;
  label: string;
  name: string;
  /** Which cash direction raises the position — how the form previews a line. */
  raises: "In" | "Out";
  /** The Partner Categories this book admits, so the Partner picker can narrow. */
  partnerCategoryIds: number[];
};

export type ItemAdjustmentPartnerOption = {
  id: number;
  label: string;
  name: string;
  companyId: number;
  categoryId: number;
};

export type ItemAdjustmentPositionOption = {
  bookId: number;
  partnerId: number;
  currencyId: number;
  foreign: number;
  base: number;
};

/** An open item a line may adjust, with the position it belongs to. */
export type ItemAdjustmentItemOption = {
  id: number;
  itemNo: string;
  date: string;
  rate: number;
  remaining: number;
  baseRemaining: number;
  note: string | null;
  bookId: number;
  partnerId: number;
  currencyId: number;
};

export type ItemAdjustmentRefs = {
  books: ItemAdjustmentBookOption[];
  partners: ItemAdjustmentPartnerOption[];
  currencies: { id: number; label: string; name: string; isBase: boolean }[];
  companies: { id: number; label: string; name: string }[];
  /** Every standing position the pickers can reach, so the form can show it. */
  positions: ItemAdjustmentPositionOption[];
  /** Every item still open among them, oldest first. */
  items: ItemAdjustmentItemOption[];
};

/**
 * The books an adjustment may touch: categories that keep a subject book
 * **and** carry `allows_item_adjustment`. Both, because the flag alone says
 * nothing once a category has stopped keeping a book.
 */
export async function adjustableBooks(): Promise<
  { def: SubledgerDef; partnerCategoryIds: number[] }[]
> {
  const [books, flagged] = await Promise.all([
    loadSubledgers(),
    prisma.sysBudgetCategory.findMany({
      where: { allows_item_adjustment: true, status: "Active" },
      select: {
        id: true,
        partner_categories: {
          where: { status: "Active", partner_category: { status: "Active" } },
          select: { partner_category_id: true },
        },
      },
    }),
  ]);
  const out: { def: SubledgerDef; partnerCategoryIds: number[] }[] = [];
  for (const f of flagged) {
    const def = subledgerForCategory(books, f.id);
    if (def) {
      out.push({
        def,
        partnerCategoryIds: f.partner_categories.map((p) => p.partner_category_id),
      });
    }
  }
  return out;
}

const itemOption = (i: SubledgerItem): ItemAdjustmentItemOption => ({
  id: i.id,
  itemNo: i.itemNo,
  date: i.date,
  rate: i.rate,
  remaining: i.remaining,
  baseRemaining: i.baseRemaining,
  note: i.note,
  bookId: i.bookId,
  partnerId: i.partnerId,
  currencyId: i.currencyId,
});

/**
 * Everything the form picks from, in one read. Active records only: a Partner
 * is deactivated once everything about it is finished, so an adjustment —
 * which exists to finish something — never needs an inactive one.
 */
export async function itemAdjustmentRefs(companyIds: number[]): Promise<ItemAdjustmentRefs> {
  const [books, partners, currencies, companies] = await Promise.all([
    adjustableBooks(),
    prisma.mPartner.findMany({
      where: { company_id: { in: companyIds }, status: "Active" },
      orderBy: [{ partner_label: "asc" }],
      select: {
        id: true,
        partner_label: true,
        partner_name: true,
        company_id: true,
        category_id: true,
      },
    }),
    prisma.refCurrency.findMany({
      where: { status: "Active" },
      orderBy: [{ currency_label: "asc" }],
      select: { id: true, currency_label: true, currency_name: true },
    }),
    prisma.sysCompany.findMany({
      where: { id: { in: companyIds } },
      orderBy: [{ id: "asc" }],
      select: { id: true, company_label: true, company_name: true },
    }),
  ]);

  const bookIds = new Set(books.map((b) => b.def.categoryId));
  const [positions, items] = await Promise.all([
    subledgerPositionsFor([...bookIds], partners.map((p) => p.id)),
    openSubledgerItemsFor(
      partners.map((p) => p.id),
      currencies.map((c) => c.id)
    ),
  ]);

  return {
    books: books.map((b) => ({
      categoryId: b.def.categoryId,
      label: b.def.budgetCategory,
      name: b.def.name,
      raises: b.def.raises,
      partnerCategoryIds: b.partnerCategoryIds,
    })),
    partners: partners.map((p) => ({
      id: p.id,
      label: p.partner_label,
      name: p.partner_name,
      companyId: p.company_id,
      categoryId: p.category_id,
    })),
    currencies: currencies.map((c) => ({
      id: c.id,
      label: c.currency_label,
      name: c.currency_name,
      isBase: isBaseCurrency(c.currency_label),
    })),
    companies: companies.map((c) => ({
      id: c.id,
      label: c.company_label,
      name: c.company_name,
    })),
    positions,
    items: items.filter((i) => bookIds.has(i.bookId)).map(itemOption),
  };
}

