import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatMoney, sumByCurrency, type MoneyTotal } from "@/lib/format";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import {
  PeriodShut,
  checkTransactionDate,
  holdPostingPeriod,
  todayDay,
} from "./fiscal";
import { originate, relieve, roundBase } from "./fx";
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
  type ItemAdjustmentEffect,
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
} from "./subledger";
import { subledgerForCategory, type SubledgerDef } from "./subledger-catalogue";
import { loadSubledgers } from "./subledger-data";
import type { SystemAccountKey } from "./system-accounts";
import { checkSystemAccountValue, systemAccountId } from "./system-account-data";

/**
 * Penyesuaian Open Item: the adjustment document for a Partner's standing
 * position in a subject book. It replaced Debit / Credit Note, whose name was
 * read from the issuer's side and came out opposite to the paper for a note a
 * Partner sent us.
 *
 * **It adjusts a position, not a transaction.** SIBA keeps no invoice to
 * reference, and what needs fixing is the value that stands — the Hutang to
 * Budi, the Piutang on Cabang Medan — so an adjustment names a book, a Partner
 * and a currency, and moves that position. No cash moves: it writes no Cash
 * Bank Book entry, draws on no rate layer and realizes no Budget.
 *
 * **Tambah opens, Kurangi settles.** A Tambah line opens one open item at the
 * kurs the user states (`1` for base currency). A Kurangi line settles the
 * items the user chose, each for the amount the user stated, and relieves each
 * at its own kurs — the same rule every other path that lowers a position
 * keeps (§10 rule 105). Both journal sides carry the same base, so no FX
 * difference can arise.
 *
 * **One rule covers every book.** The effect is handed to the book as a cash
 * direction (`adjustmentDirection`), and the book's own `raises` decides the
 * rest. The Partner line is debited exactly when that direction is money
 * leaving, and the counter side is the Company's Pendapatan Penyesuaian
 * account when it is credited and its Beban Penyesuaian account when it is
 * debited. Which books may be adjusted is the category's
 * `allows_item_adjustment`, not a code list.
 *
 * **Valued when saved, and again at Post.** A draft states the base of every
 * line and item Post would write if it ran now; Post re-values under the
 * position's lock and writes them again, because an item can move while the
 * draft waits.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const day = (d: Date): string => d.toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100);

// --------------------------------------------------------------------- rows

export type ItemAdjustmentRow = {
  id: number;
  adjustment_no: string;
  effect: ItemAdjustmentEffect;
  document_date: string | null;
  posting_date: string | null;
  company_id: number;
  budget_category_id: number;
  partner_id: number;
  currency_id: number;
  exchange_rate: number | null;
  adjustment_amount: number;
  adjustment_base_amount: number;
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

export type ItemAdjustmentLineItemRow = {
  itemId: number;
  itemNo: string;
  date: string;
  rate: number;
  amount: number;
  baseAmount: number;
};

export type ItemAdjustmentLineRow = {
  id: number;
  sequence_no: number;
  description: string;
  amount: number;
  base_amount: number;
  /** The item a posted Tambah line opened. */
  opened_item_no: string | null;
  items: ItemAdjustmentLineItemRow[];
};

type AdjustmentRecord = {
  id: number;
  adjustment_no: string;
  effect: string;
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
  _count?: { lines: number };
  partner: { partner_label: string; partner_name: string };
  budget_category: { category_label: string };
  currency: { currency_label: string };
};

const ROW_INCLUDE = {
  _count: { select: { lines: true } },
  partner: { select: { partner_label: true, partner_name: true } },
  budget_category: { select: { category_label: true } },
  currency: { select: { currency_label: true } },
} as const;

function toRow(n: AdjustmentRecord): ItemAdjustmentRow {
  return {
    id: n.id,
    adjustment_no: n.adjustment_no,
    effect: n.effect as ItemAdjustmentEffect,
    document_date: n.document_date ? day(n.document_date) : null,
    posting_date: n.posting_date ? n.posting_date.toISOString() : null,
    company_id: n.company_id,
    budget_category_id: n.budget_category_id,
    partner_id: n.partner_id,
    currency_id: n.currency_id,
    exchange_rate: n.exchange_rate ? n.exchange_rate.toNumber() : null,
    adjustment_amount: n.adjustment_amount.toNumber(),
    adjustment_base_amount: n.adjustment_base_amount.toNumber(),
    reference: n.reference,
    note: n.note,
    status: n.status as ItemAdjustmentStatus,
    line_count: n._count?.lines ?? 0,
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
    include: { items: { orderBy: { sequence_no: "asc" } } },
  });
  const ids = [
    ...lines.flatMap((l) => l.items.map((i) => i.sub_ledger_balance_id)),
    ...lines.map((l) => l.opened_item_id).filter((i): i is number => i != null),
  ];
  const known = new Map((await subledgerItemsByIds(ids)).map((i) => [i.id, i]));
  return lines.map((l) => ({
    id: l.id,
    sequence_no: l.sequence_no,
    description: l.description,
    amount: l.amount.toNumber(),
    base_amount: l.base_amount.toNumber(),
    opened_item_no: l.opened_item_id ? known.get(l.opened_item_id)?.itemNo ?? null : null,
    items: l.items.map((i) => {
      const item = known.get(i.sub_ledger_balance_id);
      return {
        itemId: i.sub_ledger_balance_id,
        itemNo: item?.itemNo ?? "—",
        date: item?.date ?? "",
        rate: item?.rate ?? 0,
        amount: i.amount.toNumber(),
        baseAmount: i.base_amount.toNumber(),
      };
    }),
  }));
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

/** An open item a Kurangi line may settle, with the position it belongs to. */
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
  effect: string;
  budget_category_id: number | null;
  partner_id: number | null;
  currency_id: number | null;
  exchange_rate: number | null;
};

export type ResolvedItemAdjustmentHeader = {
  effect: ItemAdjustmentEffect;
  book: SubledgerDef;
  companyId: number;
  partnerId: number;
  partnerCategoryId: number;
  currencyId: number;
  currencyLabel: string;
  /** The cash direction the position moves like — what the book is handed. */
  direction: "In" | "Out";
  /** The entered rate on a Tambah, null on a Kurangi. */
  rate: number | null;
};

export type ItemAdjustmentHeaderCheck =
  | ({ ok: true } & ResolvedItemAdjustmentHeader)
  | { ok: false; errors: Record<string, string> };

const isEffect = (v: string): v is ItemAdjustmentEffect =>
  v === "Increase" || v === "Decrease";

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

  if (!isEffect(header.effect)) {
    return { ok: false, errors: { effect: "Pilih jenis penyesuaian." } };
  }
  const effect = header.effect;

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

  const base = isBaseCurrency(currency.currency_label);

  // The kurs is an input exactly where the adjustment creates base value: a
  // Tambah in a foreign currency. A Kurangi releases each item at the kurs it
  // was raised at, so a typed rate there would be a second opinion nothing
  // reads — refused rather than silently ignored.
  let rate: number | null = null;
  if (effect === "Increase") {
    if (base) rate = 1;
    else if (header.exchange_rate && header.exchange_rate > 0) rate = header.exchange_rate;
    else {
      return {
        ok: false,
        errors: {
          exchange_rate:
            `Isi kurs — berapa nilai 1 ${currency.currency_label} dalam ` +
            `${BASE_CURRENCY_LABEL} untuk penyesuaian ini.`,
        },
      };
    }
  } else if (header.exchange_rate && !(base && header.exchange_rate === 1)) {
    return {
      ok: false,
      errors: {
        exchange_rate:
          "Kurangi menyelesaikan open item pada kurs masing-masing item, jadi " +
          "tidak memakai kurs baru.",
      },
    };
  }

  return {
    ok: true,
    effect,
    book: book.def,
    companyId: partner.company_id,
    partnerId: header.partner_id,
    partnerCategoryId: partner.category_id,
    currencyId: header.currency_id,
    currencyLabel: currency.currency_label,
    direction: adjustmentDirection(effect, book.def.raises),
    rate,
  };
}

// -------------------------------------------------------------------- lines

export type ItemAdjustmentLineInput = {
  description: string;
  /** Read on a Tambah; on a Kurangi the line is worth its items. */
  amount: number;
  items?: { item_id: number; amount: number }[];
};

export type CheckedAdjustmentLine = {
  description: string;
  amount: number;
  items: { itemId: number; amount: number }[];
};

export type ItemAdjustmentLineCheck =
  | { ok: true; lines: CheckedAdjustmentLine[]; total: number }
  | { ok: false; errors: Record<string, string> };

/**
 * Every line says why it adjusts, and by how much. A Tambah line states its
 * amount; a Kurangi line names the items it settles, each for an amount the
 * user stated, and is worth their sum (§10 rule 105). Nothing is distributed.
 */
export async function checkItemAdjustmentLines(
  header: ResolvedItemAdjustmentHeader,
  lines: ItemAdjustmentLineInput[]
): Promise<ItemAdjustmentLineCheck> {
  const decrease = header.effect === "Decrease";
  const wanted = lines
    .map((l) => ({
      description: l.description.trim(),
      amount: decrease
        ? roundBase((l.items ?? []).reduce((t, i) => t + (i.amount || 0), 0))
        : l.amount,
      items: decrease
        ? (l.items ?? [])
            .filter((i) => i.item_id)
            .map((i) => ({ itemId: i.item_id, amount: i.amount || 0 }))
        : [],
    }))
    .filter((l) => l.description || l.amount || l.items.length);

  if (!wanted.length) {
    return { ok: false, errors: { _lines: "Penyesuaian harus memiliki minimal satu baris." } };
  }
  if (wanted.some((l) => !l.description)) {
    return { ok: false, errors: { _lines: "Setiap baris wajib menyebut alasan penyesuaiannya." } };
  }
  if (!decrease) {
    if (lines.some((l) => l.items?.length)) {
      return {
        ok: false,
        errors: { _lines: "Tambah membuka open item baru, jadi tidak memilih open item." },
      };
    }
    if (wanted.some((l) => !(l.amount > 0))) {
      return { ok: false, errors: { _lines: "Nominal setiap baris harus lebih dari nol." } };
    }
  } else {
    if (wanted.some((l) => !l.items.length)) {
      return {
        ok: false,
        errors: { _lines: "Setiap baris Kurangi wajib memilih open item yang diselesaikan." },
      };
    }
    if (wanted.some((l) => l.items.some((i) => !(i.amount > 0)))) {
      return { ok: false, errors: { _lines: "Nominal setiap open item harus lebih dari nol." } };
    }
    if (wanted.some((l) => new Set(l.items.map((i) => i.itemId)).size !== l.items.length)) {
      return { ok: false, errors: { _lines: "Satu open item hanya boleh dipilih sekali per baris." } };
    }
    const refusal = await itemRefusal(header, wanted);
    if (refusal) return { ok: false, errors: { _lines: refusal } };
  }

  return {
    ok: true,
    lines: wanted,
    total: roundBase(wanted.reduce((t, l) => t + l.amount, 0)),
  };
}

/**
 * Whether every chosen item belongs to this position, is still open, and holds
 * what the whole document takes from it.
 */
async function itemRefusal(
  header: ResolvedItemAdjustmentHeader,
  lines: CheckedAdjustmentLine[]
): Promise<string | null> {
  const taken = new Map<number, number>();
  for (const l of lines) {
    for (const i of l.items) taken.set(i.itemId, (taken.get(i.itemId) ?? 0) + i.amount);
  }
  const items = new Map((await subledgerItemsByIds([...taken.keys()])).map((i) => [i.id, i]));
  for (const [id, amount] of taken) {
    const item = items.get(id);
    if (
      !item ||
      item.bookId !== header.book.categoryId ||
      item.partnerId !== header.partnerId ||
      item.currencyId !== header.currencyId
    ) {
      return "Open item yang dipilih bukan milik buku, Partner, dan currency dokumen ini.";
    }
    if (item.status !== "Open" || cents(amount) > cents(item.remaining)) {
      return (
        `Open item ${item.itemNo} tinggal ${formatMoney(item.remaining, header.currencyLabel)}, ` +
        `tidak cukup untuk ${formatMoney(amount, header.currencyLabel)}. Posisi tidak ` +
        "boleh di bawah nol — kurangi nominalnya atau pilih item lain."
      );
    }
  }
  return null;
}

// ---------------------------------------------------------------- valuation

export type ValuedAdjustmentLine = CheckedAdjustmentLine & {
  base: number;
  /** One per chosen item on a Kurangi, in the user's order. */
  itemBases: number[];
};

/**
 * What every line and item is worth in base, by the kernel the posting runs.
 *
 * A Tambah line originates value at the entered kurs. A Kurangi item releases
 * what it is carried at, the item drawn down line by line, so two lines taking
 * one item value the second against what the first left — which is what the
 * book will hold when its entry is written.
 */
export async function valueItemAdjustment(
  header: ResolvedItemAdjustmentHeader,
  lines: CheckedAdjustmentLine[],
  db: Db = prisma
): Promise<ValuedAdjustmentLine[]> {
  if (header.effect === "Increase") {
    return lines.map((l) => ({ ...l, base: originate(l.amount, header.rate!).base, itemBases: [] }));
  }
  const ids = [...new Set(lines.flatMap((l) => l.items.map((i) => i.itemId)))];
  const held = new Map<number, { foreign: number; base: number }>();
  for (const id of ids) {
    const item = await subledgerItem(id, db);
    if (item) held.set(id, { foreign: item.remaining, base: item.baseRemaining });
  }
  return lines.map((l) => {
    const itemBases = l.items.map((i) => {
      const h = held.get(i.itemId);
      if (!h || cents(i.amount) > cents(h.foreign)) {
        throw new SubledgerItemUnavailable(
          "Open item yang dipilih berubah sejak dokumen disimpan. Ubah dokumen dan periksa nominalnya."
        );
      }
      const relief = relieve(h, cents(i.amount) === cents(h.foreign) ? h.foreign : i.amount);
      held.set(i.itemId, relief.remaining);
      return relief.base;
    });
    return { ...l, base: roundBase(itemBases.reduce((t, b) => t + b, 0)), itemBases };
  });
}

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
const COUNTER_KEY = {
  credit: "adjustment_income",
  debit: "adjustment_expense",
} as const satisfies Record<string, SystemAccountKey>;

/**
 * Post: the actual boundary, and one database transaction.
 *
 * Everything that can be decided without the position is decided first — the
 * period, the book, the Partner, both accounts — so an ordinary refusal comes
 * back without a transaction ever opening. Inside it the position is locked,
 * every chosen item re-read and valued, and then the subject-book entries, the
 * journal and the document's own figures are written together. Either all of
 * it happened or none of it did.
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
      lines: {
        orderBy: { sequence_no: "asc" },
        include: { items: { orderBy: { sequence_no: "asc" } } },
      },
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

  // The day this belongs to in the books — chosen on the draft, possibly
  // earlier than today, and re-checked here because a year can close in
  // between.
  const dated = await checkTransactionDate(doc.document_date ?? todayDay(), [doc.company_id]);
  if (!dated.ok) return { ok: false, errors: { _form: dated.message } };
  const date = dated.date;

  // Re-checked rather than trusted from when the draft was saved: the book may
  // have lost its flag, the Partner may have been deactivated or moved out of
  // the categories the book admits, and an item may have been settled since.
  const header = await checkItemAdjustmentHeader(
    {
      effect: doc.effect,
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
      description: l.description,
      amount: l.amount.toNumber(),
      items: l.items.map((i) => ({ item_id: i.sub_ledger_balance_id, amount: i.amount.toNumber() })),
    }))
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

  // The counter side: Pendapatan or Beban Penyesuaian, by the side it takes.
  // Never guessed and never a fallback — refused by name while unset.
  const partnerDebit = header.direction === "Out";
  const counterKey = partnerDebit ? COUNTER_KEY.credit : COUNTER_KEY.debit;
  const counterName = partnerDebit ? "Pendapatan Penyesuaian" : "Beban Penyesuaian";
  const counterAccountId = await systemAccountId(doc.company.is_parent, counterKey);
  const counterRefusal = counterAccountId
    ? await checkSystemAccountValue(doc.company_id, counterKey, counterAccountId)
    : "belum diatur";
  if (!counterAccountId || counterRefusal) {
    return {
      ok: false,
      errors: {
        _form:
          `Account ${counterName} untuk Company ini ${
            counterAccountId ? `tidak dapat dipakai: ${counterRefusal}` : "belum diatur"
          }. Lengkapi di Accounting › Mapping Account System sebelum dokumen diposting.`,
      },
    };
  }

  const docTypeId = await itemAdjustmentDocTypeId();
  const label = `${doc.adjustment_no} — ${ITEM_ADJUSTMENT_EFFECTS[header.effect].label}`;
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
      baseAmount = roundBase(valued.reduce((t, l) => t + l.base, 0));

      const opened: (number | null)[] = [];
      for (const l of valued) {
        if (header.effect === "Increase") {
          const entry = await recordSubledgerEntry(tx, {
            book: header.book,
            partnerId: doc.partner_id,
            currencyId: doc.currency_id,
            date,
            type: "Adjustment",
            direction: header.direction,
            amount: l.amount,
            rate: header.rate!,
            baseAmount: l.base,
            sourceDocTypeId: docTypeId,
            sourceDocId: doc.id,
            note: `${label} — ${l.description}`,
            actorId,
          });
          opened.push(entry.balance_id);
        } else {
          for (const [k, i] of l.items.entries()) {
            await recordSubledgerEntry(tx, {
              book: header.book,
              partnerId: doc.partner_id,
              currencyId: doc.currency_id,
              date,
              type: "Adjustment",
              direction: header.direction,
              amount: i.amount,
              rate: l.itemBases[k] / i.amount,
              baseAmount: l.itemBases[k],
              itemId: i.itemId,
              sourceDocTypeId: docTypeId,
              sourceDocId: doc.id,
              note: `${label} — ${l.description}`,
              actorId,
            });
          }
          opened.push(null);
        }
      }

      // Per line, the Partner line and its counter line, each reading the
      // line's reason so the General Ledger reads back to it. Same currency,
      // same base on both sides — there is no second valuation to disagree
      // with. Debits first.
      const partnerLines: JournalLineInput[] = valued.map((l) => ({
        accountId: partnerAccount.id,
        partnerId: doc.partner_id,
        currencyId: doc.currency_id,
        rate: l.base / l.amount,
        debit: partnerDebit ? l.amount : 0,
        credit: partnerDebit ? 0 : l.amount,
        baseAmount: l.base,
        description: `${doc.adjustment_no} — ${l.description}`,
      }));
      const counterLines: JournalLineInput[] = valued.map((l) => ({
        accountId: counterAccountId,
        currencyId: doc.currency_id,
        rate: l.base / l.amount,
        debit: partnerDebit ? 0 : l.amount,
        credit: partnerDebit ? l.amount : 0,
        baseAmount: l.base,
        description: `${doc.adjustment_no} — ${l.description}`,
      }));
      const ordered = partnerDebit
        ? [...partnerLines, ...counterLines]
        : [...counterLines, ...partnerLines];
      if (dryRun) throw new AdjustmentDryRun(ordered);

      await postJournal(tx, {
        companyId: doc.company_id,
        postingDate: new Date(`${date}T00:00:00Z`),
        description: label,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        lines: ordered,
        actorId,
      });

      await writeValuation(tx, doc.lines, valued, actorId, opened);
      await tx.finItemAdjustment.update({
        where: { id: doc.id },
        data: {
          status: "Posted",
          document_date: new Date(`${date}T00:00:00Z`),
          posting_date: new Date(),
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
 * Each line's and each item's base, as a valuation found them — written when
 * a draft is saved, so it states what Post will write, and again by Post.
 */
async function writeValuation(
  db: Db,
  lines: { id: number; items: { id: number }[] }[],
  valued: ValuedAdjustmentLine[],
  actorId: number,
  opened?: (number | null)[]
): Promise<void> {
  for (const [n, line] of lines.entries()) {
    await db.finItemAdjustmentLine.update({
      where: { id: line.id },
      data: {
        base_amount: valued[n].base,
        ...(opened ? { opened_item_id: opened[n] } : {}),
        updated_by: actorId,
      },
    });
    for (const [k, item] of line.items.entries()) {
      await db.finItemAdjustmentLineItem.update({
        where: { id: item.id },
        data: { base_amount: valued[n].itemBases[k], updated_by: actorId },
      });
    }
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
  const totals = (effect: ItemAdjustmentEffect) =>
    sumByCurrency(
      posted
        .filter((r) => r.effect === effect)
        .map((r) => ({
          currencyId: r.currency_id,
          currencyLabel: r.currency_label,
          amount: r.adjustment_amount,
        }))
    );
  return {
    draft: rows.filter((r) => r.status === "Draft").length,
    posted: posted.length,
    cancelled: rows.filter((r) => r.status === "Cancelled").length,
    increaseTotals: totals("Increase"),
    decreaseTotals: totals("Decrease"),
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
 * A draft's figures, written inside its own save: what every line and item is
 * worth now, as Post would value it.
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
    select: { id: true, items: { orderBy: { sequence_no: "asc" }, select: { id: true } } },
  });
  await writeValuation(db, written, valued, actorId);
  await db.finItemAdjustment.update({
    where: { id: adjustmentId },
    data: { adjustment_base_amount: roundBase(valued.reduce((t, l) => t + l.base, 0)) },
  });
}
