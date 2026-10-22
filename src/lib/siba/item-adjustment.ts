import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatDate, formatMoney, sumByCurrency, type MoneyTotal } from "@/lib/format";
import { isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import {
  PeriodShut,
  checkTransactionDate,
  holdPostingPeriod,
  todayDay,
} from "./fiscal";
import { relieve, roundBase } from "./fx";
import {
  describeJournalLines,
  postJournal,
  type JournalLineInput,
  type JournalPreviewLine,
} from "./journal";
import {
  ITEM_ADJUSTMENT_EFFECTS,
  ITEM_ADJUSTMENT_SERIES,
  adjustmentDirection,
  adjustmentKind,
  effectOfChange,
  type ItemAdjustmentEffect,
  type ItemAdjustmentKind,
  type ItemAdjustmentStatus,
} from "./item-adjustment-workflow";
import {
  SubledgerItemUnavailable,
  lockSubledgerPosition,
  openSubledgerItemsFor,
  recordSubledgerEntry,
  subledgerItem,
  subledgerItemsByIds,
  subledgerPositionsFor,
  type SubledgerItem,
  itemLowestFrom,
} from "./subledger";
import { subledgerForCategory, type SubledgerDef } from "./subledger-catalogue";
import { loadSubledgers } from "./subledger-data";
import type { SystemAccountKey } from "./system-accounts";
import { checkSystemAccountValue, systemAccountId } from "./system-account-data";

/**
 * Penyesuaian Open Item: the adjustment document for a Partner's existing open
 * items in a subject book — what mainstream ERP calls a Debit Note and a
 * Credit Note issued against an invoice, kept under SIBA's own name.
 *
 * **It changes an item that exists, never creates one.** Every line names one
 * open item and the value it should now hold: a Piutang item of 10m typed as
 * 8m is lowered by 2m (a Pengurangan, like a Credit Note), typed as 12m it is
 * raised by 2m (a Penambahan, like a Debit Note). The difference is never
 * typed and the direction never chosen — both are read off the item, the way
 * Business Central's Adjust Inventory posts the gap to a typed New Inventory.
 * The change is a new ledger line on that same item. One document may raise
 * some items and lower others. SIBA keeps no invoice, so the item is what the
 * document references. No cash moves: it writes no Cash Bank Book entry,
 * draws on no rate layer and realizes no Budget.
 *
 * **A new value is typed against a balance, and Post holds it to that
 * balance.** The draft records what each item held when it was saved; Post
 * refuses when an item holds anything else, because the same new value would
 * then move it by a difference nobody saw — possibly the other way.
 *
 * **Each item moves at its own kurs.** A Penambahan raises an item by
 * `difference × its kurs`; a Pengurangan releases what that part is carried
 * at, and taking an item to nil hands back exactly what it holds. Both journal
 * sides carry the same base, so no FX difference can arise and no kurs is
 * typed.
 *
 * **One rule covers every book.** Each line's effect is handed to the book as
 * a cash direction (`adjustmentDirection`), and the book's own `raises`
 * decides the rest. The Partner line is debited exactly when that direction is
 * money leaving, and its counter line is the Company's Pendapatan Penyesuaian
 * account when credited and its Beban Penyesuaian account when debited. Which
 * books may be adjusted is the category's `allows_item_adjustment`, not a
 * code list.
 *
 * **Valued when saved, and again at Post.** A draft states the base of every
 * line Post would write if it ran now; Post re-values under the position's
 * lock and writes them again.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const day = (d: Date): string => d.toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100);

// --------------------------------------------------------------------- rows

export type ItemAdjustmentRow = {
  id: number;
  adjustment_no: string;
  /** What the lines do together — null on a document with no line. */
  kind: ItemAdjustmentKind | null;
  document_date: string | null;
  posting_date: string | null;
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
  document_date: Date | null;
  posting_date: Date | null;
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
    document_date: n.document_date ? day(n.document_date) : null,
    posting_date: n.posting_date ? n.posting_date.toISOString() : null,
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
async function adjustableBooks(): Promise<
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
            "sehingga tidak dapat disesuaikan dengan tanggal dokumen sebelumnya.",
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
              "Posisi tidak boleh di bawah nol pada hari mana pun — ubah tanggal dokumen.",
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

const movedSince = (item: SubledgerItem, currencyLabel: string, before: number) =>
  `Open item ${item.itemNo} berubah sejak dokumen disimpan: nilainya ` +
  `${formatMoney(before, currencyLabel)} saat itu, sekarang ` +
  `${formatMoney(item.remaining, currencyLabel)}. Ubah dokumen dan periksa Nilai Baru-nya.`;

/** Raised less lowered — the document's net change, signed. */
const netChange = (lines: { effect: ItemAdjustmentEffect; amount: number }[]) =>
  roundBase(lines.reduce((t, l) => t + (l.effect === "Increase" ? l.amount : -l.amount), 0));

// ---------------------------------------------------------------- valuation

export type ValuedAdjustmentLine = CheckedAdjustmentLine & { base: number };

/**
 * What every line is worth in base, by the kernel the posting runs, and only
 * while every item still holds what the line was stated against.
 *
 * Every item moves at **its own** kurs. A Penambahan raises an item by
 * `difference × its kurs`, so the item's rate never changes. A Pengurangan
 * releases what that part is carried at, and taking an item to nil hands back
 * exactly the base it holds.
 */
export async function valueItemAdjustment(
  header: ResolvedItemAdjustmentHeader,
  lines: CheckedAdjustmentLine[],
  db: Db = prisma
): Promise<ValuedAdjustmentLine[]> {
  const out: ValuedAdjustmentLine[] = [];
  for (const l of lines) {
    const item = await subledgerItem(l.itemId, db);
    if (!item || item.status !== "Open") {
      throw new SubledgerItemUnavailable(
        `Open item ${l.itemNo} sudah selesai sejak dokumen disimpan. Ubah dokumen dan pilih ulang.`
      );
    }
    if (cents(item.remaining) !== cents(l.balanceBefore)) {
      throw new SubledgerItemUnavailable(movedSince(item, header.currencyLabel, l.balanceBefore));
    }
    const base =
      l.effect === "Increase"
        ? roundBase(l.amount * item.rate)
        : relieve(
            { foreign: item.remaining, base: item.baseRemaining },
            cents(l.amount) === cents(item.remaining) ? item.remaining : l.amount
          ).base;
    out.push({ ...l, base });
  }
  return out;
}

/** The net change in base, signed the way `netChange` signs the amount. */
const netBase = (lines: ValuedAdjustmentLine[]) =>
  roundBase(lines.reduce((t, l) => t + (l.effect === "Increase" ? l.base : -l.base), 0));

// ------------------------------------------------------------------ posting

export type ItemAdjustmentPostingResult =
  | { ok: true; baseAmount: number; journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/** Carries a dry run's journal out of the transaction it rolls back. */
class AdjustmentDryRun extends Error {
  constructor(readonly lines: JournalLineInput[]) {
    super("Pratinjau penyesuaian");
    this.name = "AdjustmentDryRun";
  }
}

/**
 * The counter account by the side it takes: credited it is income, debited an
 * expense.
 */
const COUNTER = {
  credit: { key: "adjustment_income", name: "Pendapatan Penyesuaian" },
  debit: { key: "adjustment_expense", name: "Beban Penyesuaian" },
} as const satisfies Record<string, { key: SystemAccountKey; name: string }>;

/**
 * Post: the actual boundary, and one database transaction.
 *
 * Everything that can be decided without the position is decided first — the
 * period, the book, the Partner, the accounts the lines need — so an ordinary
 * refusal comes back without a transaction ever opening. Inside it the
 * position is locked, every item re-read and held to the balance its line was
 * stated against, and then the subject-book entries, the journal and the
 * document's own figures are written together. Either all of it happened or
 * none of it did.
 *
 * Lives here rather than inside the Server Action so the rule is testable: the
 * action resolves a caller and then calls this, and the suite calls the same
 * function.
 */
export async function applyItemAdjustment(
  adjustmentId: number,
  actorId: number,
  /**
   * Run the whole posting and roll it back once the journal is known — what
   * the Post confirmation shows. The items are read under the position's lock
   * inside the transaction, so a rolled-back run values them exactly as Post
   * will.
   */
  dryRun = false
): Promise<ItemAdjustmentPostingResult> {
  const doc = await prisma.finItemAdjustment.findUnique({
    where: { id: adjustmentId },
    include: {
      lines: { orderBy: { sequence_no: "asc" } },
      company: { select: { is_parent: true } },
    },
  });

  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Draft") {
    return { ok: false, errors: { _form: "Hanya dokumen berstatus Draft yang dapat diposting." } };
  }
  if (!doc.lines.length) {
    return { ok: false, errors: { _form: "Tambahkan minimal satu baris sebelum dokumen diposting." } };
  }
  if (doc.lines.some((l) => l.balance_before == null || l.new_amount == null)) {
    return {
      ok: false,
      errors: { _form: "Dokumen disimpan dengan cara lama. Ubah dokumen dan isi Nilai Baru setiap baris." },
    };
  }

  // The day this belongs to in the books — chosen on the draft, possibly
  // earlier than today, and re-checked here because a year can close in
  // between.
  const dated = await checkTransactionDate(doc.document_date ?? todayDay(), [doc.company_id]);
  if (!dated.ok) return { ok: false, errors: { _form: dated.message } };
  const date = dated.date;

  // Re-checked rather than trusted from when the draft was saved: the book may
  // have lost its flag, the Partner may have been deactivated or moved out of
  // the categories the book admits, and an item may have moved since.
  const header = await checkItemAdjustmentHeader(
    {
      budget_category_id: doc.budget_category_id,
      partner_id: doc.partner_id,
      currency_id: doc.currency_id,
      exchange_rate: doc.exchange_rate?.toNumber() ?? null,
    },
    [doc.company_id]
  );
  if (!header.ok) return { ok: false, errors: { _form: Object.values(header.errors)[0] } };
  const checked = await checkItemAdjustmentLines(
    header,
    doc.lines.map((l) => ({
      item_id: l.sub_ledger_balance_id,
      new_amount: l.new_amount!.toNumber(),
      balance_before: l.balance_before!.toNumber(),
    })),
    date
  );
  if (!checked.ok) return { ok: false, errors: { _form: Object.values(checked.errors)[0] } };

  // The Partner's side: the account its position is mapped to, exactly as a
  // cash posting resolves it — Company × Budget Category × Partner Category.
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
          "Partner Category Partner ini. Lengkapi mapping di Accounting sebelum " +
          "dokumen diposting.",
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

  // Each line's direction, and from it which side its Partner line takes.
  const directionOf = (effect: ItemAdjustmentEffect) =>
    adjustmentDirection(effect, header.book.raises);
  const partnerDebits = (effect: ItemAdjustmentEffect) => directionOf(effect) === "Out";

  // The counter side: Pendapatan or Beban Penyesuaian, by the side it takes —
  // only the ones a line actually needs, never guessed and never a fallback.
  const counterIds = new Map<"credit" | "debit", number>();
  for (const side of ["credit", "debit"] as const) {
    if (!checked.lines.some((l) => partnerDebits(l.effect) === (side === "credit"))) continue;
    const { key, name } = COUNTER[side];
    const id = await systemAccountId(doc.company.is_parent, key);
    const refusal = id ? await checkSystemAccountValue(doc.company_id, key, id) : "belum diatur";
    if (!id || refusal) {
      return {
        ok: false,
        errors: {
          _form:
            `Account ${name} untuk Company ini ${
              id ? `tidak dapat dipakai: ${refusal}` : "belum diatur"
            }. Lengkapi di Accounting › Mapping Account System sebelum dokumen diposting.`,
        },
      };
    }
    counterIds.set(side, id);
  }

  const docTypeId = await itemAdjustmentDocTypeId();
  let baseAmount = 0;

  try {
    await prisma.$transaction(async (tx) => {
      // The year this is dated in, held against a close and re-asked under
      // the hold — taken before the position, the order every writer uses.
      await holdPostingPeriod(tx, [doc.company_id], date);

      // Held until the transaction ends. A second document on the same
      // position waits here, and its read below sees what this one left.
      await lockSubledgerPosition(tx, header.book.categoryId, doc.partner_id, doc.currency_id);
      const valued = await valueItemAdjustment(header, checked.lines, tx);
      baseAmount = netBase(valued);

      // One entry per line, naming its item — a new ledger line on the same
      // item, raising it or lowering it at its own kurs.
      for (const l of valued) {
        await recordSubledgerEntry(tx, {
          book: header.book,
          partnerId: doc.partner_id,
          currencyId: doc.currency_id,
          date,
          type: "Adjustment",
          direction: directionOf(l.effect),
          amount: l.amount,
          rate: l.base / l.amount,
          baseAmount: l.base,
          itemId: l.itemId,
          sourceDocTypeId: docTypeId,
          sourceDocId: doc.id,
          note: `${doc.adjustment_no} — ${l.description}`,
          actorId,
        });
      }

      // Per line, the Partner line and its counter line, each reading the
      // line's own description so the General Ledger reads back to it. Same
      // currency, same base on both sides — there is no second valuation to
      // disagree with. Debits first.
      const journal: JournalLineInput[] = [];
      for (const l of valued) {
        const debit = partnerDebits(l.effect);
        const shared = {
          currencyId: doc.currency_id,
          rate: l.base / l.amount,
          baseAmount: l.base,
          description: `${doc.adjustment_no} — ${l.description}`,
        };
        const partnerLine: JournalLineInput = {
          ...shared,
          accountId: partnerAccount.id,
          partnerId: doc.partner_id,
          debit: debit ? l.amount : 0,
          credit: debit ? 0 : l.amount,
        };
        const counterLine: JournalLineInput = {
          ...shared,
          accountId: counterIds.get(debit ? "credit" : "debit")!,
          debit: debit ? 0 : l.amount,
          credit: debit ? l.amount : 0,
        };
        journal.push(...(debit ? [partnerLine, counterLine] : [counterLine, partnerLine]));
      }
      if (dryRun) throw new AdjustmentDryRun(journal);

      await postJournal(tx, {
        companyId: doc.company_id,
        postingDate: new Date(`${date}T00:00:00Z`),
        description: `${doc.adjustment_no} — Penyesuaian Open Item`,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        lines: journal,
        actorId,
      });

      await writeValuation(tx, doc.lines, valued, actorId);
      await tx.finItemAdjustment.update({
        where: { id: doc.id },
        data: {
          status: "Posted",
          document_date: new Date(`${date}T00:00:00Z`),
          posting_date: new Date(),
          adjustment_amount: netChange(valued),
          adjustment_base_amount: baseAmount,
          updated_by: actorId,
        },
      });
    });
  } catch (error) {
    if (error instanceof AdjustmentDryRun) return { ok: true, baseAmount, journal: error.lines };
    if (error instanceof PeriodShut || error instanceof SubledgerItemUnavailable) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }

  return { ok: true, baseAmount };
}

/**
 * Each line's base, as a valuation found them — written when a draft is
 * saved, so it states what Post will write, and again by Post.
 */
async function writeValuation(
  db: Db,
  lines: { id: number }[],
  valued: ValuedAdjustmentLine[],
  actorId: number
): Promise<void> {
  for (const [n, line] of lines.entries()) {
    await db.finItemAdjustmentLine.update({
      where: { id: line.id },
      data: { base_amount: valued[n].base, updated_by: actorId },
    });
  }
}

// ------------------------------------------------------------------ summary

export type ItemAdjustmentSummary = {
  draft: number;
  posted: number;
  cancelled: number;
  /** Posted value per currency — amounts are never added across currencies. */
  increaseTotals: MoneyTotal[];
  decreaseTotals: MoneyTotal[];
};

export function summariseItemAdjustments(rows: ItemAdjustmentRow[]): ItemAdjustmentSummary {
  const posted = rows.filter((r) => r.status === "Posted");
  const totals = (pick: (r: ItemAdjustmentRow) => number) =>
    sumByCurrency(
      posted
        .filter((r) => pick(r) > 0)
        .map((r) => ({
          currencyId: r.currency_id,
          currencyLabel: r.currency_label,
          amount: pick(r),
        }))
    );
  return {
    draft: rows.filter((r) => r.status === "Draft").length,
    posted: posted.length,
    cancelled: rows.filter((r) => r.status === "Cancelled").length,
    increaseTotals: totals((r) => r.increase_amount),
    decreaseTotals: totals((r) => r.decrease_amount),
  };
}

/** The journal Post would write for this document, or its refusal. Writes nothing. */
export async function previewItemAdjustment(
  adjustmentId: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const result = await applyItemAdjustment(adjustmentId, 0, true);
  if (!result.ok) return result;
  return { ok: true, lines: await describeJournalLines(result.journal ?? []) };
}

/**
 * A draft's figures, written inside its own save: what every line is worth
 * now, as Post would value it.
 */
export async function valueItemAdjustmentDraft(
  db: Db,
  adjustmentId: number,
  header: ResolvedItemAdjustmentHeader,
  lines: CheckedAdjustmentLine[],
  actorId: number
): Promise<void> {
  const valued = await valueItemAdjustment(header, lines, db);
  const written = await db.finItemAdjustmentLine.findMany({
    where: { adjustment_id: adjustmentId },
    orderBy: { sequence_no: "asc" },
    select: { id: true },
  });
  await writeValuation(db, written, valued, actorId);
  await db.finItemAdjustment.update({
    where: { id: adjustmentId },
    data: { adjustment_base_amount: netBase(valued) },
  });
}

/** The rows a checked set of lines is saved as. */
export function adjustmentLineData(lines: CheckedAdjustmentLine[], actorId: number) {
  return lines.map((l, i) => ({
    sequence_no: i + 1,
    description: l.description,
    sub_ledger_balance_id: l.itemId,
    effect: l.effect,
    balance_before: l.balanceBefore,
    new_amount: l.newAmount,
    amount: l.amount,
    created_by: actorId,
  }));
}
