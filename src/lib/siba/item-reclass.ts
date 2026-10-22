import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatMoney, sumByCurrency, type MoneyTotal } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "./currency";
import { directionText } from "./classification";
import { loadClassification } from "./classification-data";
import { nextDocumentNumber } from "./document-number";
import { PeriodShut, checkTransactionDate, holdPostingPeriod, todayDay } from "./fiscal";
import { relieve, roundBase, type Balance } from "./fx";
import {
  reclassEffect,
  sourceIsDebit,
  sourceReleaseDirection,
  targetDirection,
  valueReclassLine,
  type ReclassEffect,
} from "./item-reclass-valuation";
import type { ReclassStatus } from "./item-reclass-workflow";
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
  itemLowestFrom,
} from "./subledger";
import { subledgerForCategory, type SubledgerDef } from "./subledger-catalogue";
import { loadSubledgers } from "./subledger-data";
import { systemAccountId } from "./system-account-data";

/**
 * Reklasifikasi Open Item: value moved out of one subject-book position and
 * into another — another book, another Partner, or both — with no cash moving.
 *
 * The case it exists for: money arrived or left before anybody knew what it
 * was for. It was realized into a *Belum Teridentifikasi* holding book, each
 * receipt on its own open item, and once its place is known this document
 * moves it there. The mechanism is any book to any book, because a category
 * that names a Partner is all a book is — on the user's rule, nothing marks a
 * category as one that may be reclassified.
 *
 * ## Shape
 *
 * The header names the **source** position: one book, one Partner, one
 * currency. Each line names a **target** book and Partner, and the source
 * items it takes, each for an amount the user states. The target is posted as
 * if the original movement had been classified into it (see
 * `item-reclass-valuation.ts`): a target running the same way opens one item
 * per source item at that item's kurs and base; one running the other way has
 * its own items settled, chosen by the user, each with its own difference.
 *
 * It reclassifies items in the books and **never a Budget**: a Budget's
 * classification is final (§10 rule 26), so the plan keeps saying what it said
 * and the item carries where the money went.
 *
 * It reaches the books only through the functions they export, and nothing
 * imports it.
 */

const day = (d: Date): string => d.toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100);

export const RECLASS_LABEL = "Reklasifikasi Open Item";

// --------------------------------------------------------------------- rows

export type ReclassRow = {
  id: number;
  reclass_no: string;
  accounting_date: string | null;
  posted_at: string | null;
  company_id: number;
  budget_category_id: number;
  partner_id: number;
  currency_id: number;
  reclass_amount: number;
  reclass_base_amount: number;
  fx_difference: number;
  note: string | null;
  status: ReclassStatus;
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
  /** The target books, in line order, without repeats — for the register. */
  target_books: string[];
  created_by: number;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type ReclassItemRow = {
  id: number;
  item_id: number;
  item_no: string;
  item_date: string | null;
  item_rate: number | null;
  item_note: string | null;
  amount: number;
};

export type ReclassSourceRow = ReclassItemRow & {
  released_base_amount: number;
  opened_item_id: number | null;
  opened_item_no: string | null;
};

export type ReclassTargetRow = ReclassItemRow & {
  allocated_base_amount: number;
  settlement_base_amount: number;
  fx_difference: number;
};

export type ReclassLineRow = {
  id: number;
  sequence_no: number;
  target_budget_category_id: number;
  target_partner_id: number;
  target_book_name: string;
  target_partner_label: string;
  target_partner_name: string;
  description: string | null;
  amount: number;
  released_base_amount: number;
  fx_difference: number;
  sources: ReclassSourceRow[];
  targets: ReclassTargetRow[];
};

const ROW_INCLUDE = {
  _count: { select: { lines: true } },
  partner: { select: { partner_label: true, partner_name: true } },
  budget_category: { select: { category_label: true } },
  currency: { select: { currency_label: true } },
  lines: {
    orderBy: { sequence_no: "asc" },
    select: { target_category: { select: { category_label: true } } },
  },
} as const;

type ReclassRecord = Prisma.FinItemReclassGetPayload<{ include: typeof ROW_INCLUDE }>;

function toRow(r: ReclassRecord): ReclassRow {
  return {
    id: r.id,
    reclass_no: r.reclass_no,
    accounting_date: r.accounting_date ? day(r.accounting_date) : null,
    posted_at: r.posted_at ? r.posted_at.toISOString() : null,
    company_id: r.company_id,
    budget_category_id: r.budget_category_id,
    partner_id: r.partner_id,
    currency_id: r.currency_id,
    reclass_amount: r.reclass_amount.toNumber(),
    reclass_base_amount: r.reclass_base_amount.toNumber(),
    fx_difference: r.fx_difference.toNumber(),
    note: r.note,
    status: r.status as ReclassStatus,
    line_count: r._count.lines,
    partner_label: r.partner.partner_label,
    partner_name: r.partner.partner_name,
    book_name: `Buku ${r.budget_category.category_label}`,
    currency_label: r.currency.currency_label,
    target_books: [
      ...new Set(r.lines.map((l) => `Buku ${l.target_category.category_label}`)),
    ],
    created_by: r.created_by,
    updated_by: r.updated_by,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export async function listReclasses(companyIds: number[]): Promise<ReclassRow[]> {
  const rows = await prisma.finItemReclass.findMany({
    where: { company_id: { in: companyIds } },
    orderBy: [{ id: "desc" }],
    include: ROW_INCLUDE,
  });
  return rows.map(toRow);
}

export async function getReclass(id: number): Promise<ReclassRow | null> {
  const row = await prisma.finItemReclass.findUnique({ where: { id }, include: ROW_INCLUDE });
  return row ? toRow(row) : null;
}

/**
 * A document's lines, each with the items it names. Items are read through the
 * subject-book module — which owns them — so a posted line keeps naming an item
 * it has since cleared.
 */
export async function reclassLines(reclassId: number): Promise<ReclassLineRow[]> {
  const lines = await prisma.finItemReclassLine.findMany({
    where: { reclass_id: reclassId },
    orderBy: { sequence_no: "asc" },
    include: {
      sources: { orderBy: { sequence_no: "asc" } },
      targets: { orderBy: { sequence_no: "asc" } },
      target_category: { select: { category_label: true } },
      target_partner: { select: { partner_label: true, partner_name: true } },
    },
  });
  const ids = lines.flatMap((l) => [
    ...l.sources.map((s) => s.sub_ledger_balance_id),
    ...l.sources.flatMap((s) => (s.opened_item_id ? [s.opened_item_id] : [])),
    ...l.targets.map((t) => t.sub_ledger_balance_id),
  ]);
  const items = new Map((await subledgerItemsByIds(ids)).map((i) => [i.id, i]));
  const itemRow = (rowId: number, itemId: number, amount: number): ReclassItemRow => {
    const item = items.get(itemId);
    return {
      id: rowId,
      item_id: itemId,
      item_no: item?.itemNo ?? `#${itemId}`,
      item_date: item?.date ?? null,
      item_rate: item?.rate ?? null,
      item_note: item?.note ?? null,
      amount,
    };
  };

  return lines.map((l) => ({
    id: l.id,
    sequence_no: l.sequence_no,
    target_budget_category_id: l.target_budget_category_id,
    target_partner_id: l.target_partner_id,
    target_book_name: `Buku ${l.target_category.category_label}`,
    target_partner_label: l.target_partner.partner_label,
    target_partner_name: l.target_partner.partner_name,
    description: l.description,
    amount: l.amount.toNumber(),
    released_base_amount: l.released_base_amount.toNumber(),
    fx_difference: l.fx_difference.toNumber(),
    sources: l.sources.map((s) => ({
      ...itemRow(s.id, s.sub_ledger_balance_id, s.amount.toNumber()),
      released_base_amount: s.released_base_amount.toNumber(),
      opened_item_id: s.opened_item_id,
      opened_item_no: s.opened_item_id ? items.get(s.opened_item_id)?.itemNo ?? null : null,
    })),
    targets: l.targets.map((t) => ({
      ...itemRow(t.id, t.sub_ledger_balance_id, t.amount.toNumber()),
      allocated_base_amount: t.allocated_base_amount.toNumber(),
      settlement_base_amount: t.settlement_base_amount.toNumber(),
      fx_difference: t.fx_difference.toNumber(),
    })),
  }));
}

// ----------------------------------------------------------------- doc type

export async function reclassDocTypeId(): Promise<number> {
  const row = await prisma.sysDocType.findFirstOrThrow({
    where: { doc_table: "fin_item_reclass" },
    select: { id: true },
  });
  return row.id;
}

/**
 * Document numbers for a set of ids — how another module names a document it
 * holds a reference to, without reading `fin_item_reclass` itself.
 */
export async function reclassNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.finItemReclass.findMany({
    where: { id: { in: ids } },
    select: { id: true, reclass_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.reclass_no]));
}

/** Next document number, `RKL-0001`. */
export async function nextReclassNo(): Promise<string> {
  return nextDocumentNumber("RKL", async () => {
    const row = await prisma.finItemReclass.findFirst({
      orderBy: { id: "desc" },
      select: { reclass_no: true },
    });
    return row?.reclass_no ?? null;
  });
}

// --------------------------------------------------------------------- refs

export type ReclassBookOption = {
  categoryId: number;
  name: string;
  /** Which cash direction raises the position — decides every side. */
  raises: "In" | "Out";
  /** Which cash directions the category allows — what it may be a target for. */
  allowsIn: boolean;
  allowsOut: boolean;
  /** Labels of the Partner Categories it admits. */
  partnerCategories: string[];
};

export type ReclassPartnerOption = {
  id: number;
  label: string;
  name: string;
  companyId: number;
  categoryLabel: string;
  active: boolean;
};

export type ReclassCurrencyOption = { id: number; label: string };

/** One open item a line may take from the source, or settle on the target. */
export type ReclassItemOption = {
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

export type ReclassRefs = {
  books: ReclassBookOption[];
  partners: ReclassPartnerOption[];
  currencies: ReclassCurrencyOption[];
  /** Every item still open for a Partner in scope, in every currency. */
  items: ReclassItemOption[];
};

/**
 * Everything the form picks from, in one read. Every book is offered as both
 * source and target: a category that names a Partner is all a book is.
 */
export async function reclassRefs(companyIds: number[]): Promise<ReclassRefs> {
  const [books, catalogue, partners, currencies] = await Promise.all([
    loadSubledgers(),
    loadClassification(),
    prisma.mPartner.findMany({
      where: { company_id: { in: companyIds } },
      orderBy: [{ partner_label: "asc" }],
      select: {
        id: true,
        partner_label: true,
        partner_name: true,
        company_id: true,
        status: true,
        category: { select: { category_label: true } },
      },
    }),
    prisma.refCurrency.findMany({
      orderBy: [{ currency_label: "asc" }],
      select: { id: true, currency_label: true },
    }),
  ]);
  const items = await openSubledgerItemsFor(
    partners.map((p) => p.id),
    currencies.map((c) => c.id)
  );
  const rules = new Map(catalogue.map((r) => [r.id, r]));

  return {
    books: books.map((b) => {
      const rule = rules.get(b.categoryId);
      return {
        categoryId: b.categoryId,
        name: b.name,
        raises: b.raises,
        allowsIn: rule?.allowsIn ?? false,
        allowsOut: rule?.allowsOut ?? false,
        partnerCategories: rule?.partnerCategories ?? [],
      };
    }),
    partners: partners.map((p) => ({
      id: p.id,
      label: p.partner_label,
      name: p.partner_name,
      companyId: p.company_id,
      categoryLabel: p.category.category_label,
      active: p.status === "Active",
    })),
    currencies: currencies.map((c) => ({ id: c.id, label: c.currency_label })),
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

// ------------------------------------------------------------------- header

export type ReclassHeader = {
  budget_category_id: number | null;
  partner_id: number | null;
  currency_id: number | null;
};

/** A header that passed every rule — the shape the lines are checked against. */
export type ResolvedReclassHeader = {
  companyId: number;
  book: SubledgerDef;
  partnerId: number;
  partnerCategoryId: number;
  partnerLabel: string;
  currencyId: number;
  currencyLabel: string;
};

export type ReclassHeaderCheck =
  | ({ ok: true } & ResolvedReclassHeader)
  | { ok: false; errors: Record<string, string> };

/**
 * The source position, checked against every rule at once. The form narrows
 * each picker, but a Server Action is reachable directly with any combination
 * of ids — this is what actually enforces it.
 *
 * **The Company is the source Partner's, never picked.** A Partner belongs to
 * one Company and so does every position it holds.
 */
export async function checkReclassHeader(
  header: ReclassHeader,
  companyIds: number[]
): Promise<ReclassHeaderCheck> {
  const errors: Record<string, string> = {};

  let book: SubledgerDef | null = null;
  if (!header.budget_category_id) {
    errors.budget_category_id = "Buku sumber wajib dipilih.";
  } else {
    book = subledgerForCategory(await loadSubledgers(), header.budget_category_id);
    if (!book) errors.budget_category_id = "Budget Category tersebut tidak memiliki buku subjek.";
  }

  let companyId = 0;
  let partnerCategoryId = 0;
  let partnerLabel = "";
  if (!header.partner_id) {
    errors.partner_id = "Partner sumber wajib dipilih.";
  } else {
    const partner = await prisma.mPartner.findUnique({
      where: { id: header.partner_id },
      select: { company_id: true, category_id: true, status: true, partner_label: true },
    });
    if (!partner || !companyIds.includes(partner.company_id)) {
      errors.partner_id = "Partner tidak ditemukan.";
    } else if (partner.status !== "Active") {
      errors.partner_id = "Partner tersebut non-aktif dan tidak dapat dipakai.";
    } else {
      companyId = partner.company_id;
      partnerCategoryId = partner.category_id;
      partnerLabel = partner.partner_label;
    }
  }

  let currencyLabel = "";
  if (!header.currency_id) {
    errors.currency_id = "Currency wajib dipilih.";
  } else {
    const currency = await prisma.refCurrency.findUnique({
      where: { id: header.currency_id },
      select: { currency_label: true },
    });
    if (!currency) errors.currency_id = "Currency tidak ditemukan.";
    else currencyLabel = currency.currency_label;
  }

  if (Object.keys(errors).length || !book) return { ok: false, errors };

  return {
    ok: true,
    companyId,
    book,
    partnerId: header.partner_id!,
    partnerCategoryId,
    partnerLabel,
    currencyId: header.currency_id!,
    currencyLabel,
  };
}

// -------------------------------------------------------------------- lines

export type ReclassItemAllocation = { item_id: number; amount: number };

export type ReclassLineInput = {
  target_budget_category_id: number;
  target_partner_id: number;
  description: string | null;
  sources: ReclassItemAllocation[];
  targets: ReclassItemAllocation[];
};

export type ResolvedReclassLine = {
  targetBook: SubledgerDef;
  targetPartnerId: number;
  targetPartnerCategoryId: number;
  targetPartnerLabel: string;
  effect: ReclassEffect;
  description: string | null;
  /** The sum of the source items — the line has no amount of its own. */
  amount: number;
  sources: { itemId: number; amount: number }[];
  /** Empty where the target opens items. */
  targets: { itemId: number; amount: number }[];
};

export type ReclassLineCheck =
  | { ok: true; lines: ResolvedReclassLine[]; total: number }
  | { ok: false; errors: Record<string, string> };

const lineRefusal = (message: string): ReclassLineCheck => ({
  ok: false,
  errors: { _lines: message },
});

/** One allocation list: at least one, no item twice, every amount above nil. */
function allocationRefusal(
  allocations: ReclassItemAllocation[],
  what: string
): string | null {
  const seen = new Set<number>();
  for (const a of allocations) {
    if (seen.has(a.item_id)) return `Satu open item ${what} hanya boleh dipilih sekali dalam satu baris.`;
    seen.add(a.item_id);
    if (!(a.amount > 0)) return `Nominal setiap open item ${what} harus lebih dari nol.`;
  }
  return null;
}

/**
 * The lines, checked against the source position.
 *
 * Each target must keep a book, allow the direction that raised the source,
 * and name an active Partner of the same Company that the target category
 * admits — and it may not be the source position itself. Each line takes at
 * least one source item, and is worth exactly what they add up to. Where the
 * target runs the other way, the line names the target items it settles, and
 * they add up to the same figure. Every item must be the right position's,
 * still open, and not taken for more than it holds across the whole document.
 */
export async function checkReclassLines(
  header: ResolvedReclassHeader,
  lines: ReclassLineInput[],
  /** The document's date — an item may not go below nothing from it on. */
  date: string = todayDay()
): Promise<ReclassLineCheck> {
  const wanted = lines.filter((l) => l.target_budget_category_id > 0 || l.sources.length);
  if (!wanted.length) return lineRefusal("Dokumen harus memiliki minimal satu baris tujuan.");

  const [books, catalogue] = await Promise.all([loadSubledgers(), loadClassification()]);
  const rules = new Map(catalogue.map((r) => [r.id, r]));

  const partnerIds = [...new Set(wanted.map((l) => l.target_partner_id).filter((id) => id > 0))];
  const partners = new Map(
    (
      await prisma.mPartner.findMany({
        where: { id: { in: partnerIds } },
        select: {
          id: true,
          company_id: true,
          category_id: true,
          status: true,
          partner_label: true,
          category: { select: { category_label: true } },
        },
      })
    ).map((p) => [p.id, p])
  );

  const itemIds = [
    ...new Set(wanted.flatMap((l) => [...l.sources, ...l.targets].map((a) => a.item_id))),
  ];
  const items = new Map((await subledgerItemsByIds(itemIds)).map((i) => [i.id, i]));
  const lowestOf = new Map(
    await Promise.all([...items.keys()].map(async (id) => [id, await itemLowestFrom(id, date)] as const))
  );
  const used = new Map<number, number>();
  const raisedIn = directionText(header.book.raises).toLowerCase();

  const take = (itemId: number, amount: number): string | null => {
    const item = items.get(itemId)!;
    const total = roundBase((used.get(itemId) ?? 0) + amount);
    if (cents(total) > cents(item.remaining)) {
      return (
        `Open item ${item.itemNo} tinggal ${formatMoney(item.remaining, header.currencyLabel)}, ` +
        `tidak cukup untuk ${formatMoney(total, header.currencyLabel)} pada dokumen ini.`
      );
    }
    const lowest = lowestOf.get(itemId)!;
    if (cents(total) > cents(lowest.balance)) {
      return (
        `Open item ${item.itemNo} tinggal ${formatMoney(lowest.balance, header.currencyLabel)} ` +
        `pada ${lowest.at}, tidak cukup untuk ${formatMoney(total, header.currencyLabel)}. ` +
        "Posisi tidak boleh di bawah nol pada hari mana pun — ubah tanggal akuntansi."
      );
    }
    used.set(itemId, total);
    return null;
  };

  const resolved: ResolvedReclassLine[] = [];
  for (const [n, l] of wanted.entries()) {
    const row = `Baris ${n + 1}: `;
    const targetBook = subledgerForCategory(books, l.target_budget_category_id);
    if (!targetBook) return lineRefusal(`${row}buku tujuan wajib dipilih dari kategori yang memiliki buku subjek.`);
    const rule = rules.get(targetBook.categoryId);
    const allows = header.book.raises === "In" ? rule?.allowsIn : rule?.allowsOut;
    if (!allows) {
      return lineRefusal(
        `${row}${targetBook.name} tidak menerima arah ${raisedIn}, padahal open item ` +
          `${header.book.name} lahir dari ${raisedIn}. Pilih buku tujuan lain.`
      );
    }

    const partner = partners.get(l.target_partner_id);
    if (!partner) return lineRefusal(`${row}Partner tujuan wajib dipilih.`);
    if (partner.company_id !== header.companyId) {
      return lineRefusal(
        `${row}Partner ${partner.partner_label} milik Company lain. Reklasifikasi berlangsung di dalam satu Company.`
      );
    }
    if (partner.status !== "Active") {
      return lineRefusal(`${row}Partner ${partner.partner_label} non-aktif dan tidak dapat dipakai.`);
    }
    if (!rule?.partnerCategories.includes(partner.category.category_label)) {
      return lineRefusal(
        `${row}${targetBook.name} tidak menerima Partner Category ` +
          `${partner.category.category_label} milik ${partner.partner_label}.`
      );
    }
    if (targetBook.categoryId === header.book.categoryId && partner.id === header.partnerId) {
      return lineRefusal(
        `${row}tujuan sama dengan posisi sumber. Pilih buku atau Partner lain.`
      );
    }

    if (!l.sources.length) return lineRefusal(`${row}pilih open item sumber yang dipindahkan.`);
    const sourceRefusal = allocationRefusal(l.sources, "sumber");
    if (sourceRefusal) return lineRefusal(row + sourceRefusal);
    for (const a of l.sources) {
      const item = items.get(a.item_id);
      if (
        !item ||
        item.bookId !== header.book.categoryId ||
        item.partnerId !== header.partnerId ||
        item.currencyId !== header.currencyId
      ) {
        return lineRefusal(
          `${row}open item sumber bukan milik ${header.book.name}, Partner ` +
            `${header.partnerLabel}, dan ${header.currencyLabel}.`
        );
      }
      if (item.status !== "Open") {
        return lineRefusal(`${row}open item ${item.itemNo} sudah selesai dan tidak dapat dipindahkan.`);
      }
      const over = take(a.item_id, a.amount);
      if (over) return lineRefusal(row + over);
    }
    const amount = roundBase(l.sources.reduce((t, a) => t + a.amount, 0));

    const effect = reclassEffect(header.book.raises, targetBook.raises);
    if (effect === "open" && l.targets.length) {
      return lineRefusal(
        `${row}${targetBook.name} bertambah oleh arah ini, jadi open item baru ` +
          "dibuka — tidak ada open item tujuan yang diselesaikan."
      );
    }
    if (effect === "settle") {
      if (!l.targets.length) {
        return lineRefusal(
          `${row}${targetBook.name} berkurang oleh arah ini. Pilih open item ` +
            `${partner.partner_label} yang diselesaikan.`
        );
      }
      const targetRefusal = allocationRefusal(l.targets, "tujuan");
      if (targetRefusal) return lineRefusal(row + targetRefusal);
      for (const a of l.targets) {
        const item = items.get(a.item_id);
        if (
          !item ||
          item.bookId !== targetBook.categoryId ||
          item.partnerId !== partner.id ||
          item.currencyId !== header.currencyId
        ) {
          return lineRefusal(
            `${row}open item tujuan bukan milik ${targetBook.name}, Partner ` +
              `${partner.partner_label}, dan ${header.currencyLabel}.`
          );
        }
        if (item.status !== "Open") {
          return lineRefusal(`${row}open item ${item.itemNo} sudah selesai dan tidak dapat diselesaikan.`);
        }
        const over = take(a.item_id, a.amount);
        if (over) return lineRefusal(row + over);
      }
      const settled = roundBase(l.targets.reduce((t, a) => t + a.amount, 0));
      if (cents(settled) !== cents(amount)) {
        return lineRefusal(
          `${row}open item tujuan berjumlah ${formatMoney(settled, header.currencyLabel)}, ` +
            `harus sama dengan sumbernya ${formatMoney(amount, header.currencyLabel)}.`
        );
      }
    }

    resolved.push({
      targetBook,
      targetPartnerId: partner.id,
      targetPartnerCategoryId: partner.category_id,
      targetPartnerLabel: partner.partner_label,
      effect,
      description: l.description?.trim() || null,
      amount,
      sources: l.sources.map((a) => ({ itemId: a.item_id, amount: a.amount })),
      targets: effect === "settle" ? l.targets.map((a) => ({ itemId: a.item_id, amount: a.amount })) : [],
    });
  }

  const total = roundBase(resolved.reduce((t, l) => t + l.amount, 0));
  return { ok: true, lines: resolved, total };
}

// ------------------------------------------------------------------ posting

export type ReclassPostingResult =
  | { ok: true; fxDifference: number; journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/** A refusal raised inside the posting transaction, converted back after the rollback. */
class ReclassRefused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("Reklasifikasi Open Item ditolak");
    this.name = "ReclassRefused";
  }
}

/** Carries a dry run's journal out of the transaction it rolls back. */
class ReclassDryRun extends Error {
  constructor(readonly lines: JournalLineInput[]) {
    super("Pratinjau Reklasifikasi Open Item");
    this.name = "ReclassDryRun";
  }
}

/**
 * The account a position posts to — Company × Budget Category × the Partner's
 * Partner Category, exactly as a cash posting resolves it. A refusal names the
 * book, because the user has to go and map it.
 */
async function mappedAccount(
  companyId: number,
  book: SubledgerDef,
  partnerCategoryId: number,
  partnerLabel: string
): Promise<{ ok: true; accountId: number } | { ok: false; message: string }> {
  const mapping = await prisma.accBudgetCategoryAccount.findFirst({
    where: {
      company_id: companyId,
      budget_category_id: book.categoryId,
      partner_category_id: partnerCategoryId,
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
      message:
        `Belum ada Mapping Budget ke Account untuk ${book.name} dan Partner Category ` +
        `${partnerLabel}. Lengkapi mapping di Accounting sebelum dokumen diposting.`,
    };
  }
  const account = mapping.account;
  if (account.company_id !== companyId || !account.is_active || !account.is_postable) {
    return {
      ok: false,
      message:
        `Account ${account.account_label} yang dipetakan untuk ${book.name} tidak ` +
        "aktif atau bukan account postable.",
    };
  }
  return { ok: true, accountId: account.id };
}

type ItemState = { itemNo: string; rate: number; note: string | null; balance: Balance };

type PlannedSource = {
  rowId: number;
  itemId: number;
  itemNo: string;
  note: string | null;
  amount: number;
  rate: number;
  releasedBase: number;
};

type PlannedTarget = {
  rowId: number;
  itemId: number;
  itemNo: string;
  amount: number;
  rate: number;
  settledBase: number;
  share: number;
  fx: number;
};

type PlannedLine = {
  rowId: number;
  targetBook: SubledgerDef;
  targetPartnerId: number;
  targetPartnerLabel: string;
  targetAccountId: number;
  effect: ReclassEffect;
  description: string | null;
  releasedBase: number;
  fxTotal: number;
  sources: PlannedSource[];
  targets: PlannedTarget[];
};

/**
 * Post: the actual boundary, and one database transaction.
 *
 * Everything that can be decided without a write is decided first — the date,
 * the header, the lines, the mapped accounts — so an ordinary refusal comes
 * back without a transaction opening. Inside it the period is held, every
 * position the document lowers is locked in one order, and every item is
 * re-read under the lock; then the books, the journal and the document's own
 * figures are written together. Either all of it happened or none of it did.
 *
 * Lives here rather than inside the Server Action so the rule is testable.
 */
export async function applyReclass(
  reclassId: number,
  actorId: number,
  /**
   * Run the whole posting and roll it back once the journal is known — what
   * the Post confirmation shows. The items are valued under the transaction's
   * own reads, so a rolled-back run values them exactly as Post.
   */
  dryRun = false
): Promise<ReclassPostingResult> {
  const doc = await prisma.finItemReclass.findUnique({
    where: { id: reclassId },
    include: {
      lines: {
        orderBy: { sequence_no: "asc" },
        include: {
          sources: { orderBy: { sequence_no: "asc" } },
          targets: { orderBy: { sequence_no: "asc" } },
        },
      },
      company: { select: { is_parent: true } },
    },
  });

  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Draft") {
    return { ok: false, errors: { _form: "Hanya dokumen berstatus Draft yang dapat diposting." } };
  }
  if (!doc.lines.length) {
    return { ok: false, errors: { _form: "Tambahkan minimal satu baris tujuan sebelum dokumen diposting." } };
  }

  const dated = await checkTransactionDate(doc.accounting_date ?? todayDay(), [doc.company_id]);
  if (!dated.ok) return { ok: false, errors: { _form: dated.message } };
  const date = dated.date;

  // Re-checked rather than trusted from the save: a Partner may have been
  // deactivated, a category retired, an item settled by another document.
  const header = await checkReclassHeader(
    {
      budget_category_id: doc.budget_category_id,
      partner_id: doc.partner_id,
      currency_id: doc.currency_id,
    },
    [doc.company_id]
  );
  if (!header.ok) return { ok: false, errors: { _form: Object.values(header.errors)[0] } };
  const lineCheck = await checkReclassLines(
    header,
    doc.lines.map((l) => ({
      target_budget_category_id: l.target_budget_category_id,
      target_partner_id: l.target_partner_id,
      description: l.description,
      sources: l.sources.map((s) => ({ item_id: s.sub_ledger_balance_id, amount: s.amount.toNumber() })),
      targets: l.targets.map((t) => ({ item_id: t.sub_ledger_balance_id, amount: t.amount.toNumber() })),
    })),
    date
  );
  if (!lineCheck.ok) return { ok: false, errors: { _form: lineCheck.errors._lines } };

  const sourceAccount = await mappedAccount(
    doc.company_id,
    header.book,
    header.partnerCategoryId,
    header.partnerLabel
  );
  if (!sourceAccount.ok) return { ok: false, errors: { _form: sourceAccount.message } };
  const targetAccounts: number[] = [];
  for (const l of lineCheck.lines) {
    const account = await mappedAccount(
      doc.company_id,
      l.targetBook,
      l.targetPartnerCategoryId,
      l.targetPartnerLabel
    );
    if (!account.ok) return { ok: false, errors: { _form: account.message } };
    targetAccounts.push(account.accountId);
  }

  const base = await prisma.refCurrency.findFirst({
    where: { currency_label: BASE_CURRENCY_LABEL },
    select: { id: true },
  });
  if (!base) {
    throw new Error(`Currency dasar ${BASE_CURRENCY_LABEL} tidak ada pada master. Jalankan db:seed.`);
  }

  const source = header.book;
  const docTypeId = await reclassDocTypeId();
  const label = `${doc.reclass_no} — ${RECLASS_LABEL}`;
  const sourceDebit = sourceIsDebit(source.raises);
  let fxDifference = 0;

  // Every position the document lowers: the source, and each target whose
  // items it settles. Sorted, so two documents touching the same pair of
  // positions always take their locks in the same order.
  const lowered = new Map<string, { bookId: number; partnerId: number }>();
  lowered.set(`${source.categoryId}:${doc.partner_id}`, {
    bookId: source.categoryId,
    partnerId: doc.partner_id,
  });
  for (const l of lineCheck.lines) {
    if (l.effect === "settle") {
      lowered.set(`${l.targetBook.categoryId}:${l.targetPartnerId}`, {
        bookId: l.targetBook.categoryId,
        partnerId: l.targetPartnerId,
      });
    }
  }
  const locks = [...lowered.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, p]) => p);

  try {
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, [doc.company_id], date);
      for (const p of locks) {
        await lockSubledgerPosition(tx, p.bookId, p.partnerId, doc.currency_id);
      }

      // Every item as it stands under the locks, tracked across lines so an
      // item split between two lines relieves its second part from what the
      // first left — exactly as `recordSubledgerEntry` will.
      const state = new Map<number, ItemState>();
      const read = async (itemId: number): Promise<ItemState> => {
        const known = state.get(itemId);
        if (known) return known;
        const item = await subledgerItem(itemId, tx);
        if (!item || item.status !== "Open") {
          throw new ReclassRefused({
            _form: `Open item ${item?.itemNo ?? ""} sudah selesai sejak dokumen disimpan.`,
          });
        }
        const fresh = {
          itemNo: item.itemNo,
          rate: item.rate,
          note: item.note,
          balance: { foreign: item.remaining, base: item.baseRemaining },
        };
        state.set(itemId, fresh);
        return fresh;
      };
      const release = (s: ItemState, want: number): number => {
        if (cents(want) > cents(s.balance.foreign)) {
          throw new ReclassRefused({
            _form:
              `Open item ${s.itemNo} tinggal ${formatMoney(s.balance.foreign, header.currencyLabel)}, ` +
              `tidak cukup untuk ${formatMoney(want, header.currencyLabel)}.`,
          });
        }
        const relief = relieve(
          s.balance,
          cents(want) === cents(s.balance.foreign) ? s.balance.foreign : want
        );
        s.balance = relief.remaining;
        return relief.base;
      };

      const planned: PlannedLine[] = [];
      for (const [k, l] of doc.lines.entries()) {
        const resolved = lineCheck.lines[k];
        const sources: PlannedSource[] = [];
        for (const s of l.sources) {
          const st = await read(s.sub_ledger_balance_id);
          const amount = s.amount.toNumber();
          sources.push({
            rowId: s.id,
            itemId: s.sub_ledger_balance_id,
            itemNo: st.itemNo,
            note: st.note,
            amount,
            rate: st.rate,
            releasedBase: release(st, amount),
          });
        }
        const settled: { rowId: number; itemId: number; itemNo: string; amount: number; rate: number; base: number }[] = [];
        if (resolved.effect === "settle") {
          for (const t of l.targets) {
            const st = await read(t.sub_ledger_balance_id);
            const amount = t.amount.toNumber();
            settled.push({
              rowId: t.id,
              itemId: t.sub_ledger_balance_id,
              itemNo: st.itemNo,
              amount,
              rate: st.rate,
              base: release(st, amount),
            });
          }
        }
        const valued = valueReclassLine({
          sourceRaises: source.raises,
          effect: resolved.effect,
          amount: l.amount.toNumber(),
          sourceReleased: sources.map((s) => s.releasedBase),
          targets: settled.map((t) => ({ amount: t.amount, releasedBase: t.base })),
        });
        planned.push({
          rowId: l.id,
          targetBook: resolved.targetBook,
          targetPartnerId: resolved.targetPartnerId,
          targetPartnerLabel: resolved.targetPartnerLabel,
          targetAccountId: targetAccounts[k],
          effect: resolved.effect,
          description: resolved.description,
          releasedBase: valued.releasedBase,
          fxTotal: valued.fxTotal,
          sources,
          targets: settled.map((t, i) => ({
            rowId: t.rowId,
            itemId: t.itemId,
            itemNo: t.itemNo,
            amount: t.amount,
            rate: t.rate,
            settledBase: t.base,
            share: valued.shares[i],
            fx: valued.fx[i],
          })),
        });
      }

      fxDifference = roundBase(planned.reduce((t, l) => t + l.fxTotal, 0));
      const anyFx = planned.some((l) => l.targets.some((t) => t.fx !== 0));

      // A difference has to land somewhere named, and is resolved only when
      // one actually arises.
      let fxAccountId: number | null = null;
      if (anyFx) {
        fxAccountId = await systemAccountId(doc.company.is_parent, "fx");
        if (!fxAccountId) {
          throw new ReclassRefused({
            _form:
              "Selisih kurs muncul pada dokumen ini, tetapi Account Selisih Kurs " +
              "belum diatur untuk Company ini. Lengkapi di Accounting › Mapping " +
              "Account System sebelum dokumen diposting.",
          });
        }
      }

      // The journal, line by line: each source item released, then where it
      // went — the items it opened, or the items it settled and each one's
      // own difference. Never netted (§10 rule 107).
      const side = (debit: boolean, amount: number) =>
        debit ? { debit: amount, credit: 0 } : { debit: 0, credit: amount };
      const entries: JournalLineInput[] = [];
      for (const l of planned) {
        const where = `${l.targetBook.name} · ${l.targetPartnerLabel}`;
        for (const s of l.sources) {
          entries.push({
            accountId: sourceAccount.accountId,
            partnerId: doc.partner_id,
            currencyId: doc.currency_id,
            rate: s.rate,
            ...side(sourceDebit, s.amount),
            baseAmount: s.releasedBase,
            description: `${doc.reclass_no} — ${s.itemNo} dipindahkan ke ${where}`,
          });
          if (l.effect === "open") {
            entries.push({
              accountId: l.targetAccountId,
              partnerId: l.targetPartnerId,
              currencyId: doc.currency_id,
              rate: s.rate,
              ...side(!sourceDebit, s.amount),
              baseAmount: s.releasedBase,
              description: `${doc.reclass_no} — dari ${s.itemNo} (${source.name} · ${header.partnerLabel})`,
            });
          }
        }
        for (const t of l.targets) {
          entries.push({
            accountId: l.targetAccountId,
            partnerId: l.targetPartnerId,
            currencyId: doc.currency_id,
            rate: t.rate,
            ...side(!sourceDebit, t.amount),
            baseAmount: t.settledBase,
            description: `${doc.reclass_no} — ${t.itemNo} diselesaikan`,
          });
          if (t.fx !== 0 && fxAccountId) {
            entries.push({
              accountId: fxAccountId,
              currencyId: base.id,
              rate: 1,
              ...side(t.fx < 0, Math.abs(t.fx)),
              description: `Selisih kurs ${t.itemNo} — ${doc.reclass_no}`,
            });
          }
        }
      }

      if (dryRun) throw new ReclassDryRun(entries);

      for (const l of planned) {
        const why = (fallback: string | null) =>
          l.description ?? fallback ?? RECLASS_LABEL;
        for (const s of l.sources) {
          // Released at its own kurs. `baseAmount` is passed so an item that
          // another writer moved since the plan valued it throws rather than
          // posting a figure the journal does not carry.
          await recordSubledgerEntry(tx, {
            book: source,
            partnerId: doc.partner_id,
            currencyId: doc.currency_id,
            date,
            type: "Reclass",
            direction: sourceReleaseDirection(source.raises),
            amount: s.amount,
            rate: s.rate,
            baseAmount: s.releasedBase,
            itemId: s.itemId,
            sourceDocTypeId: docTypeId,
            sourceDocId: doc.id,
            note: `${label} → ${l.targetBook.name} · ${l.targetPartnerLabel}`,
            actorId,
          });

          let openedId: number | null = null;
          if (l.effect === "open") {
            // The item it became: same kurs, same base, so the value is
            // carried rather than recomputed and no difference can arise.
            const opened = await recordSubledgerEntry(tx, {
              book: l.targetBook,
              partnerId: l.targetPartnerId,
              currencyId: doc.currency_id,
              date,
              type: "Reclass",
              direction: targetDirection(source.raises),
              amount: s.amount,
              rate: s.rate,
              baseAmount: s.releasedBase,
              sourceDocTypeId: docTypeId,
              sourceDocId: doc.id,
              note: `${why(s.note)} (${doc.reclass_no} dari ${s.itemNo})`,
              actorId,
            });
            openedId = opened.balance_id;
          }
          await tx.finItemReclassLineSource.update({
            where: { id: s.rowId },
            data: { released_base_amount: s.releasedBase, opened_item_id: openedId, updated_by: actorId },
          });
        }

        for (const t of l.targets) {
          await recordSubledgerEntry(tx, {
            book: l.targetBook,
            partnerId: l.targetPartnerId,
            currencyId: doc.currency_id,
            date,
            type: "Reclass",
            direction: targetDirection(source.raises),
            amount: t.amount,
            rate: t.rate,
            baseAmount: t.settledBase,
            itemId: t.itemId,
            sourceDocTypeId: docTypeId,
            sourceDocId: doc.id,
            note: `${label} ← ${source.name} · ${header.partnerLabel}`,
            actorId,
          });
          await tx.finItemReclassLineTarget.update({
            where: { id: t.rowId },
            data: {
              allocated_base_amount: t.share,
              settlement_base_amount: t.settledBase,
              fx_difference: t.fx,
              updated_by: actorId,
            },
          });
        }

        await tx.finItemReclassLine.update({
          where: { id: l.rowId },
          data: { released_base_amount: l.releasedBase, fx_difference: l.fxTotal, updated_by: actorId },
        });
      }

      // The Journal is written alongside the books, never from them, and
      // throws unless it balances — which takes the whole posting down.
      await postJournal(tx, {
        companyId: doc.company_id,
        accountingDate: new Date(`${date}T00:00:00Z`),
        description: `${label} · ${source.name} · ${header.partnerLabel}`,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        lines: entries,
        actorId,
      });

      await tx.finItemReclass.update({
        where: { id: doc.id },
        data: {
          status: "Posted",
          accounting_date: new Date(`${date}T00:00:00Z`),
          posted_at: new Date(),
          reclass_base_amount: roundBase(planned.reduce((t, l) => t + l.releasedBase, 0)),
          fx_difference: fxDifference,
          updated_by: actorId,
        },
      });
    });
  } catch (error) {
    if (error instanceof ReclassDryRun) return { ok: true, fxDifference, journal: error.lines };
    if (error instanceof ReclassRefused) return { ok: false, errors: error.errors };
    if (error instanceof PeriodShut || error instanceof SubledgerItemUnavailable) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }

  return { ok: true, fxDifference };
}

/** The journal Post would write for this document, or its refusal. Writes nothing. */
export async function previewReclass(
  reclassId: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const result = await applyReclass(reclassId, 0, true);
  if (!result.ok) return result;
  return { ok: true, lines: await describeJournalLines(result.journal ?? []) };
}

// -------------------------------------------------------------------- trail

/** One posted move of an item: where its value went, and by which document. */
export type ReclassMove = {
  itemId: number;
  reclassId: number;
  reclassNo: string;
  date: string | null;
  amount: number;
  targetBook: string;
  targetPartnerLabel: string;
  targetPartnerName: string;
  /** The item it became, where the target opened one. */
  openedItemNo: string | null;
};

/**
 * Where these items' value went, by posted reclassification — the clearing
 * link read forwards. A Budget whose money was held follows it from here to the
 * book it ended up in. One step only: an item moved again is the next item's
 * own trail.
 */
export async function reclassTrail(itemIds: number[]): Promise<ReclassMove[]> {
  if (!itemIds.length) return [];
  const rows = await prisma.finItemReclassLineSource.findMany({
    where: { sub_ledger_balance_id: { in: itemIds }, line: { reclass: { status: "Posted" } } },
    orderBy: { id: "asc" },
    include: {
      line: {
        select: {
          target_category: { select: { category_label: true } },
          target_partner: { select: { partner_label: true, partner_name: true } },
          reclass: { select: { id: true, reclass_no: true, accounting_date: true } },
        },
      },
    },
  });
  const opened = new Map(
    (await subledgerItemsByIds(rows.flatMap((r) => (r.opened_item_id ? [r.opened_item_id] : [])))).map(
      (i) => [i.id, i.itemNo]
    )
  );
  return rows.map((r) => ({
    itemId: r.sub_ledger_balance_id,
    reclassId: r.line.reclass.id,
    reclassNo: r.line.reclass.reclass_no,
    date: r.line.reclass.accounting_date ? day(r.line.reclass.accounting_date) : null,
    amount: r.amount.toNumber(),
    targetBook: `Buku ${r.line.target_category.category_label}`,
    targetPartnerLabel: r.line.target_partner.partner_label,
    targetPartnerName: r.line.target_partner.partner_name,
    openedItemNo: r.opened_item_id ? opened.get(r.opened_item_id) ?? null : null,
  }));
}

// ------------------------------------------------------------------ summary

export type ReclassSummary = {
  draft: number;
  posted: number;
  cancelled: number;
  /** Posted value, per currency — never added across currencies. */
  postedTotals: MoneyTotal[];
};

export function summariseReclasses(rows: ReclassRow[]): ReclassSummary {
  const posted = rows.filter((r) => r.status === "Posted");
  return {
    draft: rows.filter((r) => r.status === "Draft").length,
    posted: posted.length,
    cancelled: rows.filter((r) => r.status === "Cancelled").length,
    postedTotals: sumByCurrency(
      posted.map((r) => ({
        currencyId: r.currency_id,
        currencyLabel: r.currency_label,
        amount: r.reclass_amount,
      }))
    ),
  };
}

