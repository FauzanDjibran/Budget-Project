import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { sumByCurrency, type MoneyTotal } from "@/lib/format";
import {
  budgetsByIds,
  openBudgetsMatching,
  realizeBudgets,
} from "./budget";
import { InsufficientFunds, cashBankShortfall, recordCashBankEntry } from "./cash-bank";
import {
  LayerNotAvailable,
  drawFromLayer,
  layerDateRefusal,
  openLayer,
  openLayersFor,
  type LayerOption,
} from "./cash-bank-layers";
import {
  BASE_CURRENCY_LABEL,
  createsLayer,
  isBaseCurrency,
  maySettle,
  rateSource,
  settlementRefusal,
} from "./currency";
import { allocateBase, drawLayer, fxDifference, relieve, roundBase } from "./fx";
import { realizationOf } from "./realization";
import { nextDocumentNumber } from "./document-number";
import {
  PeriodShut,
  checkTransactionDate,
  holdPostingPeriod,
  todayDay,
  type TransactionDateCheck,
} from "./fiscal";
import {
  describeJournalLines,
  postJournal,
  type JournalLineInput,
  type JournalPreviewLine,
} from "./journal";
import {
  type SubledgerDef,
  subledgerForCategory,
  subledgerMovement,
} from "./subledger-catalogue";
import { loadSubledgers } from "./subledger-data";
import {
  SubledgerItemUnavailable,
  itemLowestFrom,
  lockSubledgerPosition,
  openSubledgerItems,
  recordSubledgerEntry,
  subledgerItem,
  subledgerItemsByIds,
  type SubledgerItem,
} from "./subledger";
import { systemAccountId } from "./system-account-data";
import type { TransactionStatus } from "./transaction-workflow";

/**
 * Finance reads and the rules a Realisasi Budget is held to.
 *
 * Finance is the execution layer (concept doc §2.2, §9): Budget plans, Finance
 * executes. A document's **header** — direction, Company, Cash & Bank,
 * Currency — is the context that decides which approved Budgets it may
 * realize, and its **lines** are the realization itself. The direction is the
 * menu the document was opened from (Realisasi Penerimaan / Pengeluaran), and
 * nothing else in the header narrows by classification: one document may
 * settle Budgets of every Budget Category and every Partner at once. Each line
 * then carries its own Budget's classification into every book it writes.
 *
 * Nothing here moves money. Draft is inert by design (§2.3): the balance and
 * `realized_amount` move only at Post, which is `app/actions/finance.ts`.
 *
 * Like Budget, this sits outside the entity registry: a document with a
 * lifecycle, a header that filters its own lines, and a child table is exactly
 * what the registry cannot express.
 */

const day = (d: Date): string => d.toISOString().slice(0, 10);

// -------------------------------------------------------------------- rows

export type TransactionRow = {
  id: number;
  transaction_no: string;
  document_date: string | null;
  posting_date: string | null;
  transaction_type: "In" | "Out";
  company_id: number;
  cash_bank_id: number | null;
  currency_id: number;
  transaction_amount: number;
  /** The kurs the document was valued at. */
  exchange_rate: number;
  cash_bank_layer_id: number | null;
  note: string | null;
  status: TransactionStatus;
  line_count: number;
  created_by: number;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type TransactionLineRow = {
  id: number;
  sequence_no: number;
  budget_id: number;
  budget_no: string;
  budget_date: string;
  description: string;
  category_id: number | null;
  partner_id: number | null;
  budget_amount: number;
  realized_amount: number;
  /** What was still settleable when the line was written. */
  outstanding_amount: number;
  settlement_amount: number;
  budget_status: string;
  /** The open items the line settles, where it lowers a position — in order. */
  items: LineItemRow[];
};

/** One open item a saved line settles, and what it came to. */
export type LineItemRow = {
  item: OpenItemOption;
  /** In the document's currency. */
  amount: number;
  /** Signed as a gain; nil until Post, which is when it is valued. */
  fxDifference: number;
};

type TxRecord = {
  id: number;
  transaction_no: string;
  document_date: Date | null;
  posting_date: Date | null;
  transaction_type: string;
  company_id: number;
  cash_bank_id: number | null;
  currency_id: number;
  transaction_amount: { toNumber(): number };
  exchange_rate: { toNumber(): number };
  cash_bank_layer_id: number | null;
  note: string | null;
  status: string;
  created_by: number;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
  _count?: { lines: number };
};

function toRow(t: TxRecord): TransactionRow {
  return {
    id: t.id,
    transaction_no: t.transaction_no,
    document_date: t.document_date ? day(t.document_date) : null,
    posting_date: t.posting_date ? t.posting_date.toISOString() : null,
    transaction_type: t.transaction_type as "In" | "Out",
    company_id: t.company_id,
    cash_bank_id: t.cash_bank_id,
    currency_id: t.currency_id,
    transaction_amount: t.transaction_amount.toNumber(),
    exchange_rate: t.exchange_rate.toNumber(),
    cash_bank_layer_id: t.cash_bank_layer_id,
    note: t.note,
    status: t.status as TransactionStatus,
    line_count: t._count?.lines ?? 0,
    created_by: t.created_by,
    updated_by: t.updated_by,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
  };
}

export async function listTransactions(
  companyIds: number[],
  direction?: "In" | "Out"
): Promise<TransactionRow[]> {
  // Every document belongs to the induk today (§12), so a user holding induk
  // access sees exactly what they did before. What this adds is the other
  // half: a user without it sees none, and the list is already right when
  // Funding Request brings the anak into Finance.
  const rows = await prisma.finCashBankTransaction.findMany({
    where: {
      company_id: { in: companyIds },
      ...(direction ? { transaction_type: direction } : {}),
    },
    orderBy: [{ id: "desc" }],
    include: { _count: { select: { lines: true } } },
  });
  return rows.map(toRow);
}

export async function getTransaction(
  id: number
): Promise<TransactionRow | null> {
  const row = await prisma.finCashBankTransaction.findUnique({
    where: { id },
    include: { _count: { select: { lines: true } } },
  });
  return row ? toRow(row) : null;
}

/**
 * One document's lines, joined to the Budget each settles.
 *
 * `source_doc_type_id` / `source_doc_id` are deliberately generic so a line can
 * one day settle any document type; today only Budget is ever referenced, so
 * the join is resolved here rather than by a polymorphic reader.
 */
export async function transactionLines(
  transactionId: number
): Promise<TransactionLineRow[]> {
  const lines = await prisma.finCashBankTransactionLine.findMany({
    where: { transaction_id: transactionId },
    orderBy: { sequence_no: "asc" },
    include: { items: { orderBy: { sequence_no: "asc" } } },
  });
  if (!lines.length) return [];

  const [budgets, items] = await Promise.all([
    budgetsByIds(lines.map((l) => l.source_doc_id)),
    subledgerItemsByIds(
      lines.flatMap((l) => l.items.map((a) => a.sub_ledger_balance_id))
    ),
  ]);
  const byId = new Map(budgets.map((b) => [b.id, b]));
  const itemOf = new Map(items.map((i) => [i.id, itemOption(i)]));

  return lines.flatMap((l) => {
    const b = byId.get(l.source_doc_id);
    if (!b) return [];
    return [
      {
        id: l.id,
        sequence_no: l.sequence_no,
        budget_id: b.id,
        budget_no: b.budget_no,
        budget_date: b.budget_date,
        description: b.description,
        category_id: b.category_id,
        partner_id: b.partner_id,
        budget_amount: b.budget_amount,
        realized_amount: b.realized_amount,
        outstanding_amount: l.outstanding_amount.toNumber(),
        settlement_amount: l.settlement_amount.toNumber(),
        budget_status: b.status,
        items: l.items.flatMap((a) => {
          const item = itemOf.get(a.sub_ledger_balance_id);
          return item
            ? [
                {
                  item,
                  amount: a.amount.toNumber(),
                  fxDifference: a.fx_difference.toNumber(),
                },
              ]
            : [];
        }),
      },
    ];
  });
}

/**
 * Every document that has ever named one Budget — the realization trace.
 *
 * `realized_amount` says how much has been spent against a plan; this says by
 * which documents, which is the question anybody who doubts the figure asks
 * next. Draft and Cancelled documents are included and labelled, because a
 * Budget "reserved" by a Draft somebody forgot to post is exactly what a
 * planner needs to see.
 */
export async function budgetRealizations(budgetId: number): Promise<
  {
    transactionId: number;
    transactionNo: string;
    date: string | null;
    status: TransactionStatus;
    direction: "In" | "Out";
    amount: number;
    /** The open item the line opened, where it raised a subject-book position. */
    openedItemId: number | null;
  }[]
> {
  const docType = await budgetDocTypeId();
  const lines = await prisma.finCashBankTransactionLine.findMany({
    where: { source_doc_type_id: docType, source_doc_id: budgetId },
    include: { transaction: true },
    orderBy: { id: "asc" },
  });
  return lines.map((l) => ({
    transactionId: l.transaction.id,
    transactionNo: l.transaction.transaction_no,
    date: l.transaction.document_date ? day(l.transaction.document_date) : null,
    status: l.transaction.status as TransactionStatus,
    direction: l.transaction.transaction_type as "In" | "Out",
    amount: l.settlement_amount.toNumber(),
    openedItemId: l.opened_item_id,
  }));
}

// ---------------------------------------------------------------- doc types

/**
 * The `sys_doc_type` row a line points at, resolved by table name.
 *
 * Looked up rather than hardcoded: the ids depend on seed order, and a document
 * reference that silently points at the wrong type is the kind of mistake
 * nothing downstream would catch.
 */
async function docTypeIdFor(table: string): Promise<number> {
  const row = await prisma.sysDocType.findFirstOrThrow({
    where: { doc_table: table },
    select: { id: true },
  });
  return row.id;
}

export const budgetDocTypeId = () => docTypeIdFor("bud_budget");
export const transactionDocTypeId = () =>
  docTypeIdFor("fin_cash_bank_transaction");

// ----------------------------------------------------------------- options

export type FinanceOption = {
  id: number;
  label: string;
  name: string;
  active: boolean;
};

export type CashBankOption = FinanceOption & {
  companyId: number;
  currencyId: number;
  currencyLabel: string;
  type: string;
  balance: number;
  /**
   * The open rate layers this resource holds, oldest first. Empty for a
   * base-currency resource, which has none by design.
   *
   * Carried on the resource rather than in a map beside it: layers belong to
   * the resource that holds them, and that is the question the form asks.
   */
  layers: LayerOption[];
};

export type FinancePartnerOption = FinanceOption & {
  companyId: number;
  categoryId: number;
  categoryLabel: string;
};

export type CompanyOption = FinanceOption & {
  /** The induk: it holds the cash, so its documents post directly. */
  isParent: boolean;
  /** Whether this reader may write a document for it. */
  selectable: boolean;
};

export type FinanceRefs = {
  companies: CompanyOption[];
  currencies: FinanceOption[];
  categories: FinanceOption[];
  partnerCategories: FinanceOption[];
  partners: FinancePartnerOption[];
  cashBanks: CashBankOption[];
  /** The induk — the treasury provider every Funding Request is answered by. */
  transactingCompanyId: number | null;
};

/**
 * Everything the finance pages need to render a reference as text, plus the
 * option sets the header picks from.
 *
 * Balances come from `cash_bank_balance` so the form can show what a resource
 * holds before the document moves it. They are display only: the Post action
 * re-reads the book inside its own transaction.
 *
 * `companyIds` marks which Companies this reader may **write** a document for,
 * without hiding the others: a list still has to name the Company of every row
 * it shows. Omitted, every Company is selectable — which is what a test or a
 * caller with its own scoping wants.
 */
export async function financeRefs(companyIds?: number[]): Promise<FinanceRefs> {
  const [companies, currencies, categories, partners, partnerCategories, cashBanks] =
    await Promise.all([
      prisma.sysCompany.findMany({ orderBy: { id: "asc" } }),
      prisma.refCurrency.findMany({ orderBy: { id: "asc" } }),
      prisma.sysBudgetCategory.findMany({ orderBy: { id: "asc" } }),
      prisma.mPartner.findMany({ orderBy: { id: "asc" } }),
      prisma.sysPartnerCategory.findMany(),
      prisma.mCashBank.findMany({
        orderBy: { id: "asc" },
        include: {
          currency: { select: { id: true, currency_label: true } },
          book_balance: { select: { balance: true } },
        },
      }),
    ]);

  const partnerCategoryLabel = new Map(
    partnerCategories.map((p) => [p.id, p.category_label])
  );

  // The open layers of every foreign resource. A base-currency resource has
  // none, so it simply gets an empty list and the form never asks for a kurs.
  // Read here rather than when a resource is chosen: the form is a client
  // component and the page is where the database is read (§3).
  //
  // One query for all of them, not one per resource: this runs on every load
  // of the Cash Bank Transaction form, and asking per resource made the form's
  // cost grow with how many foreign accounts the Companies happen to hold.
  const layersOf = await openLayersFor(
    cashBanks
      .filter((c) => !isBaseCurrency(c.currency.currency_label))
      .map((c) => c.id)
  );

  return {
    companies: companies.map((c) => ({
      id: c.id,
      label: c.company_label,
      name: c.company_name,
      active: true,
      isParent: c.is_parent,
      selectable: companyIds ? companyIds.includes(c.id) : true,
    })),
    currencies: currencies.map((c) => ({
      id: c.id,
      label: c.currency_label,
      name: c.currency_name,
      active: c.status === "Active",
    })),
    categories: categories.map((c) => ({
      id: c.id,
      label: c.category_label,
      name: c.category_name,
      active: true,
    })),
    partnerCategories: partnerCategories.map((c) => ({
      id: c.id,
      label: c.category_label,
      name: c.category_name,
      active: true,
    })),
    partners: partners.map((p) => ({
      id: p.id,
      label: p.partner_label,
      name: p.partner_name,
      active: p.status === "Active",
      companyId: p.company_id,
      categoryId: p.category_id,
      categoryLabel: partnerCategoryLabel.get(p.category_id) ?? "",
    })),
    cashBanks: cashBanks.map((c) => ({
      id: c.id,
      label: c.cash_bank_label,
      name: c.cash_bank_name,
      active: c.status === "Active",
      companyId: c.company_id,
      currencyId: c.currency.id,
      currencyLabel: c.currency.currency_label,
      type: c.cash_bank_type,
      balance: c.book_balance?.balance.toNumber() ?? 0,
      layers: layersOf.get(c.id) ?? [],
    })),
    transactingCompanyId: companies.find((c) => c.is_parent)?.id ?? null,
  };
}

/**
 * The treasury provider: the induk.
 *
 * Every Funding Request is answered by this Company, and the money always
 * leaves one of its resources — the anak spends nothing directly, it raises a
 * request and the induk confirms it (concept doc §25, §29).
 *
 * Resolved at runtime from `is_parent`, never hardcoded — CLAUDE.md §12(c).
 */
export async function transactingCompany(): Promise<{
  id: number;
  label: string;
  name: string;
} | null> {
  const row = await prisma.sysCompany.findFirst({
    where: { is_parent: true },
    select: { id: true, company_label: true, company_name: true },
  });
  return row
    ? { id: row.id, label: row.company_label, name: row.company_name }
    : null;
}

// ------------------------------------------------------------- eligibility

export type EligibleBudget = {
  id: number;
  budget_no: string;
  budget_date: string;
  description: string;
  category_id: number | null;
  partner_id: number | null;
  currency_id: number;
  budget_amount: number;
  realized_amount: number;
  outstanding: number;
  /** Settlement already written by *other* Draft documents — informational. */
  draftAllocated: number;
  /**
   * True when realizing this Budget **lowers** a subject-book position — a
   * Titipan returned, a Hutang paid, a Piutang collected. Such a line must name
   * the open item it settles; a line that raises a position opens one at Post.
   */
  lowers: boolean;
  /** True when realizing this Budget raises a position, opening a new item. */
  opensItem: boolean;
  /**
   * True when the book this line raises only ever accumulates — Investasi,
   * Hasil Investasi. Its items are a record of where the money went or came
   * from, never something a later line settles, so the form does not speak of
   * an open item for it.
   */
  accumulates: boolean;
  /** The open items this line may settle, oldest first. Empty unless `lowers`. */
  items: OpenItemOption[];
};

/** One open item as a line's picker offers it. */
export type OpenItemOption = {
  id: number;
  itemNo: string;
  date: string;
  rate: number;
  remaining: number;
  note: string | null;
};

const itemOption = (i: SubledgerItem): OpenItemOption => ({
  id: i.id,
  itemNo: i.itemNo,
  date: i.date,
  rate: i.rate,
  remaining: i.remaining,
  note: i.note,
});

export type TransactionHeader = {
  /** Fixed by the menu the document was opened from, never typed. */
  transaction_type: "In" | "Out";
  company_id: number | null;
  cash_bank_id: number | null;
  /**
   * The document's own currency, on **both** routes. It used to be read off the
   * Cash & Bank on the self route, which only worked while the two could not
   * differ — a foreign document paid from a rupiah account is the case that
   * separated them.
   */
  currency_id?: number | null;
  /**
   * The kurs, where the user types one: a foreign document converted by the
   * bank, or foreign currency arriving into a foreign resource. Read off the
   * chosen layer instead when money is leaving a foreign resource, and ignored
   * entirely when the document is already base currency.
   */
  exchange_rate?: number | null;
  /**
   * The rate layer this payment draws on. One transaction, one bank, one kurs —
   * so the document is capped at what this layer still holds.
   */
  cash_bank_layer_id?: number | null;
};

/**
 * How a Company's documents reach actual money.
 *
 * `self` — the Company has Cash & Bank resources of its own and posts
 * directly. `treasury` — it has none, so its document raises a Funding
 * Request and the induk's confirmation posts it (concept doc §26).
 *
 * Keyed on `is_parent` rather than on a label or a setting: which Company
 * holds the treasury is structural, not configuration (CLAUDE.md §12).
 */
export type FundingRoute = "self" | "treasury";

export async function fundingRoute(
  companyId: number
): Promise<FundingRoute | null> {
  const company = await prisma.sysCompany.findUnique({
    where: { id: companyId },
    select: { is_parent: true },
  });
  if (!company) return null;
  return company.is_parent ? "self" : "treasury";
}

/**
 * May this document be dated this day?
 *
 * The date rule is the fiscal calendar's (`checkTransactionDate`); what this
 * adds is **which Companies** it is asked of. A direct document writes one
 * Company's books. A funded one writes both — the induk's cash and journal and
 * the anak's own — so a day either of them has closed cannot be written.
 */
export async function checkDocumentDate(
  raw: string | Date | null | undefined,
  companyId: number,
  route: FundingRoute
): Promise<TransactionDateCheck> {
  const companies = [companyId];
  if (route === "treasury") {
    const induk = await transactingCompany();
    if (induk) companies.push(induk.id);
  }
  return checkTransactionDate(raw, companies);
}

/**
 * The currency a document is denominated in, and the route it will take.
 *
 * One resolver for both the eligibility query and the header check, so the
 * picker and the enforcement can never disagree about which Budgets a header
 * could settle.
 */
async function headerContext(header: TransactionHeader): Promise<
  | {
      ok: true;
      route: FundingRoute;
      currencyId: number;
      cashBankId: number | null;
    }
  | { ok: false }
> {
  if (!header.company_id) return { ok: false };
  const route = await fundingRoute(header.company_id);
  if (!route) return { ok: false };

  // The document's currency is the document's own on both routes. It used to
  // be read off the Cash & Bank, which only worked while the two could not
  // differ — a foreign document paid from a rupiah account is the case that
  // separated them.
  const currencyId = header.currency_id ?? 0;
  if (!currencyId) return { ok: false };

  if (route === "treasury") {
    if (header.cash_bank_id) return { ok: false };
    return { ok: true, route, currencyId, cashBankId: null };
  }

  if (!header.cash_bank_id) return { ok: false };
  const cashBank = await prisma.mCashBank.findUnique({
    where: { id: header.cash_bank_id },
    select: {
      company_id: true,
      currency: { select: { currency_label: true } },
    },
  });
  if (!cashBank || cashBank.company_id !== header.company_id) {
    return { ok: false };
  }

  // A resource that cannot settle this currency admits no Budgets at all,
  // rather than admitting the resource's own. `checkHeader` refuses the pairing
  // by name; this simply offers nothing.
  const currency = await prisma.refCurrency.findUnique({
    where: { id: currencyId },
    select: { currency_label: true },
  });
  if (
    !currency ||
    !maySettle(currency.currency_label, cashBank.currency.currency_label)
  ) {
    return { ok: false };
  }

  return { ok: true, route, currencyId, cashBankId: header.cash_bank_id };
}

/**
 * The Budgets one header may realize.
 *
 * A Budget is eligible when it is **Open** (approved, so it carries a
 * classification), belongs to the same Company, points the way the menu does,
 * is denominated in the document's own currency, and still has something
 * outstanding. Budget Category and Partner are **not** criteria: a realization
 * may settle plans of every category and every Partner in one document, and
 * each line carries its own Budget's classification into the books.
 *
 * Budget Date is deliberately *not* a filter: §9 says the month is a reporting
 * dimension (early or late realization), never a gate.
 *
 * Currency is the **document's**, not the resource's. A USD document settles
 * USD plans, whether it is paid from a USD account or from a rupiah one.
 */
export async function eligibleBudgets(
  header: TransactionHeader,
  options: { excludeTransactionId?: number } = {}
): Promise<EligibleBudget[]> {
  if (!header.company_id) return [];
  if (header.transaction_type !== "In" && header.transaction_type !== "Out") {
    return [];
  }

  const context = await headerContext(header);
  if (!context.ok) return [];

  const budgets = await openBudgetsMatching({
    companyId: header.company_id,
    budgetType: header.transaction_type,
    currencyId: context.currencyId,
  });

  const outstanding = budgets
    .map((b) => ({ row: b, left: b.budget_amount - b.realized_amount }))
    .filter((x) => x.left > 0);
  if (!outstanding.length) return [];

  const draftAllocated = await draftAllocations(
    outstanding.map((x) => x.row.id),
    options.excludeTransactionId ?? null
  );

  // Which lines lower a subject-book position, and the open items each may
  // settle. Asked of the book's own direction, so a Titipan returned and a
  // Piutang collected both read as lowering whatever the cash direction is.
  const books = await loadSubledgers();
  const lowering = new Map<number, number>();
  const opening = new Set<number>();
  const accumulating = new Set<number>();
  for (const { row } of outstanding) {
    const book = subledgerForCategory(books, row.category_id);
    if (book && row.partner_id != null) {
      if (subledgerMovement(book, header.transaction_type, 1) < 0) {
        lowering.set(row.id, book.categoryId);
      } else {
        opening.add(row.id);
        if (book.nature === "cumulative") accumulating.add(row.id);
      }
    }
  }
  const openItems = await openSubledgerItems(
    outstanding
      .filter(({ row }) => lowering.has(row.id))
      .map(({ row }) => ({
        bookId: lowering.get(row.id)!,
        partnerId: row.partner_id!,
        currencyId: context.currencyId,
      }))
  );

  return outstanding.map(({ row, left }) => ({
    lowers: lowering.has(row.id),
    opensItem: opening.has(row.id),
    accumulates: accumulating.has(row.id),
    items: lowering.has(row.id)
      ? openItems
          .filter(
            (i) =>
              i.bookId === lowering.get(row.id) &&
              i.partnerId === row.partner_id &&
              i.currencyId === context.currencyId
          )
          .map(itemOption)
      : [],
    id: row.id,
    budget_no: row.budget_no,
    budget_date: row.budget_date,
    description: row.description,
    category_id: row.category_id,
    partner_id: row.partner_id,
    currency_id: row.currency_id,
    budget_amount: row.budget_amount,
    realized_amount: row.realized_amount,
    outstanding: left,
    draftAllocated: draftAllocated.get(row.id) ?? 0,
  }));
}

/**
 * How much of each Budget other Draft documents have already written down.
 *
 * Reported, never subtracted. A Draft has moved nothing (§2.3), so reserving
 * outstanding against it would make a plan look spent because somebody left a
 * document open. Showing the figure lets the user decide.
 */
async function draftAllocations(
  budgetIds: number[],
  excludeTransactionId: number | null
): Promise<Map<number, number>> {
  if (!budgetIds.length) return new Map();
  const docType = await budgetDocTypeId();
  const lines = await prisma.finCashBankTransactionLine.findMany({
    where: {
      source_doc_type_id: docType,
      source_doc_id: { in: budgetIds },
      transaction: {
        status: "Draft",
        ...(excludeTransactionId ? { id: { not: excludeTransactionId } } : {}),
      },
    },
    select: { source_doc_id: true, settlement_amount: true },
  });

  const out = new Map<number, number>();
  for (const l of lines) {
    out.set(
      l.source_doc_id,
      (out.get(l.source_doc_id) ?? 0) + l.settlement_amount.toNumber()
    );
  }
  return out;
}

// ------------------------------------------------------------- enforcement

export type HeaderCheck =
  | {
      ok: true;
      direction: "In" | "Out";
      companyId: number;
      /** Null on the funded route: the anak has no resource of its own. */
      cashBankId: number | null;
      currencyId: number;
      /** The document's own currency, which need not be the resource's. */
      currencyLabel: string;
      /** The paying resource's currency, or "" on the funded route. */
      resourceCurrencyLabel: string;
      /** The kurs this document is valued at — entered, read off a layer, or 1. */
      rate: number;
      /** The layer the payment draws on, where one is involved. */
      layerId: number | null;
      route: FundingRoute;
    }
  | { ok: false; errors: Record<string, string> };

/**
 * The document header, checked against every rule at once.
 *
 * The form narrows each picker as the user goes, but a Server Action is
 * reachable directly with any combination of ids — this is what actually
 * enforces the chain Company -> Cash & Bank -> Currency -> kurs.
 *
 * **Which Company decides the shape of the rest.** The induk holds the cash, so
 * its documents name a Cash & Bank and take their currency from it. The anak
 * holds none by design (concept doc §25, §32), so its documents name a Currency
 * instead and are refused if they name a resource at all — including a resource
 * belonging to the induk, which is exactly the submission this rule exists to
 * stop. What the anak's document then does is raise a Funding Request; the
 * money still only ever leaves an induk resource.
 */
export async function checkHeader(
  header: TransactionHeader
): Promise<HeaderCheck> {
  const errors: Record<string, string> = {};

  const direction = header.transaction_type;
  if (direction !== "In" && direction !== "Out") {
    return {
      ok: false,
      errors: { _form: "Arah realisasi tidak dikenali." },
    };
  }

  const induk = await transactingCompany();
  if (!induk) {
    return {
      ok: false,
      errors: { _form: "Company induk belum tersedia pada master Company." },
    };
  }

  let route: FundingRoute | null = null;
  let currencyId = 0;
  let cashBankId: number | null = null;
  /** The paying resource's own currency, where there is a resource. */
  let resourceCurrencyLabel = "";
  if (!header.company_id) {
    errors.company_id = "Company wajib dipilih.";
  } else {
    route = await fundingRoute(header.company_id);
    if (!route) errors.company_id = "Company tidak ditemukan.";
  }

  // The document's own currency, on both routes. It used to be read off the
  // Cash & Bank on the self route, which stopped working the moment a foreign
  // document could be paid from a base-currency resource: the two are no longer
  // the same question.
  let currencyLabel = "";
  if (!header.currency_id) {
    errors.currency_id = "Currency wajib dipilih.";
  } else {
    const currency = await prisma.refCurrency.findUnique({
      where: { id: header.currency_id },
      select: { id: true, status: true, currency_label: true },
    });
    if (!currency) errors.currency_id = "Currency tidak ditemukan.";
    else if (currency.status !== "Active") {
      errors.currency_id = "Currency tersebut non-aktif dan tidak dapat dipakai.";
    } else {
      currencyId = currency.id;
      currencyLabel = currency.currency_label;
    }
  }

  if (route === "treasury") {
    if (header.cash_bank_id) {
      errors.cash_bank_id =
        "Company anak tidak memiliki Cash & Bank sendiri. Dana disediakan " +
        "Company induk melalui Funding Request.";
    }
  } else if (route === "self") {
    if (!header.cash_bank_id) {
      errors.cash_bank_id = "Cash & Bank wajib dipilih.";
    } else {
      const cashBank = await prisma.mCashBank.findUnique({
        where: { id: header.cash_bank_id },
        select: {
          company_id: true,
          status: true,
          currency_id: true,
          currency: { select: { currency_label: true } },
        },
      });
      if (!cashBank) errors.cash_bank_id = "Cash & Bank tidak ditemukan.";
      else if (cashBank.company_id !== header.company_id) {
        errors.cash_bank_id =
          "Cash & Bank harus milik Company yang sama dengan dokumen.";
      } else if (cashBank.status !== "Active") {
        errors.cash_bank_id =
          "Cash & Bank tersebut non-aktif dan tidak dapat dipakai.";
      } else if (
        currencyLabel &&
        !maySettle(currencyLabel, cashBank.currency.currency_label)
      ) {
        // Crossing goes through the base currency only: a foreign document is
        // paid from its own currency or from rupiah, and never from a third
        // currency. `lib/siba/currency.ts` is the one place that rule lives.
        errors.cash_bank_id = settlementRefusal(
          currencyLabel,
          cashBank.currency.currency_label
        )!;
      } else {
        cashBankId = header.cash_bank_id;
        resourceCurrencyLabel = cashBank.currency.currency_label;
      }
    }
  }

  // Where the kurs comes from, and therefore what the header must carry. One
  // control on the form, three provenances — and a rate of `1` means the money
  // is base currency, never that two foreign amounts happen to match.
  let rate = 1;
  let layerId: number | null = null;
  if (route === "self" && currencyLabel && resourceCurrencyLabel) {
    const source = rateSource(
      direction,
      currencyLabel,
      resourceCurrencyLabel
    );

    if (source === "entered") {
      const entered = header.exchange_rate ?? 0;
      if (!(entered > 0)) {
        errors.exchange_rate =
          `Isi kurs — berapa nilai 1 ${currencyLabel} dalam ` +
          `${BASE_CURRENCY_LABEL} pada transaksi ini.`;
      } else {
        rate = entered;
      }
      if (header.cash_bank_layer_id) {
        errors.cash_bank_layer_id =
          "Transaksi ini tidak mengambil dari layer kurs mana pun.";
      }
    } else if (source === "layer") {
      if (!header.cash_bank_layer_id) {
        errors.cash_bank_layer_id =
          "Pilih layer kurs yang dipakai. Satu transaksi memakai tepat satu layer.";
      } else {
        const layer = await prisma.cashBankLayer.findUnique({
          where: { id: header.cash_bank_layer_id },
          select: { cash_bank_id: true, status: true, rate: true },
        });
        if (!layer || layer.cash_bank_id !== cashBankId) {
          errors.cash_bank_layer_id =
            "Layer kurs tersebut bukan milik Cash & Bank yang dipilih.";
        } else if (layer.status !== "Open") {
          errors.cash_bank_layer_id =
            "Layer kurs tersebut sudah habis dan tidak dapat dipakai lagi.";
        } else {
          rate = layer.rate.toNumber();
          layerId = header.cash_bank_layer_id;
        }
      }
    } else if (header.exchange_rate && header.exchange_rate !== 1) {
      // `identity`: rupiah moving through a rupiah account. A rate here would
      // be a rate between the base currency and itself.
      errors.exchange_rate =
        `Dokumen dalam ${BASE_CURRENCY_LABEL} tidak memakai kurs.`;
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    direction,
    companyId: header.company_id!,
    cashBankId,
    currencyId,
    currencyLabel,
    resourceCurrencyLabel,
    rate,
    layerId,
    route: route!,
  };
}

export type LineInput = {
  budget_id: number;
  /** Ignored on a line lowering a position: there it is the sum of its items. */
  amount: number;
  /** The open items a lowering line settles, each for the amount the user chose. */
  items?: { item_id: number; amount: number }[];
};

/** One chosen open item on a checked line. */
export type CheckedItem = { itemId: number; amount: number };

export type LineCheck =
  | {
      ok: true;
      lines: {
        budgetId: number;
        amount: number;
        outstanding: number;
        items: CheckedItem[];
      }[];
      total: number;
    }
  | { ok: false; errors: Record<string, string> };

/**
 * The lines, checked against the header that is supposed to admit them.
 *
 * Every line is re-derived from `eligibleBudgets` rather than trusted: the form
 * drops rows that stop qualifying as the header changes, but a direct call
 * could name any budget id at all.
 *
 * Over-realization is allowed on purpose — concept doc §6.5 permits it and the
 * Post dialog says so — because a real payment can legitimately exceed its
 * plan, and refusing it would push the difference off the books.
 */
export async function checkLines(
  header: TransactionHeader,
  lines: LineInput[],
  options: { excludeTransactionId?: number } = {}
): Promise<LineCheck> {
  // A line lowering a position is worth what its chosen items add up to;
  // whatever amount came with it is not trusted.
  const amountOf = (l: LineInput) =>
    l.items?.length
      ? Math.round(l.items.reduce((t, it) => t + (it.amount > 0 ? it.amount : 0), 0) * 100) / 100
      : l.amount;
  const wanted = lines.filter((l) => amountOf(l) > 0);
  if (!wanted.length) {
    return {
      ok: false,
      errors: {
        _lines: lines.length
          ? "Nominal realisasi setiap Budget harus lebih dari nol."
          : "Dokumen harus merealisasikan minimal satu Budget.",
      },
    };
  }

  const seen = new Set<number>();
  for (const l of wanted) {
    if (seen.has(l.budget_id)) {
      return {
        ok: false,
        errors: { _lines: "Satu Budget hanya boleh muncul sekali dalam dokumen." },
      };
    }
    seen.add(l.budget_id);
  }

  const eligible = await eligibleBudgets(header, options);
  const byId = new Map(eligible.map((b) => [b.id, b]));

  const resolved: {
    budgetId: number;
    amount: number;
    outstanding: number;
    items: CheckedItem[];
  }[] = [];
  // What each open item still holds, drawn down line by line: two lines may
  // settle one item, and together they may not take it below nothing.
  const itemLeft = new Map<number, number>();
  for (const l of wanted) {
    const budget = byId.get(l.budget_id);
    if (!budget) {
      return {
        ok: false,
        errors: {
          _lines:
            "Ada Budget pada dokumen ini yang tidak lagi memenuhi kriteria header. " +
            "Buka kembali dokumen dan pilih ulang Budget-nya.",
        },
      };
    }

    const chosen = l.items ?? [];
    const checked: CheckedItem[] = [];
    if (!budget.lowers) {
      if (chosen.length) {
        return {
          ok: false,
          errors: {
            _lines:
              `${budget.budget_no} tidak menurunkan posisi buku subjek, sehingga ` +
              "tidak menyelesaikan open item — posting akan membuka item baru.",
          },
        };
      }
    } else {
      if (!chosen.length) {
        return {
          ok: false,
          errors: {
            _lines:
              `Pilih open item yang diselesaikan ${budget.budget_no}, dan nominal ` +
              "untuk setiap item. Realisasi yang menurunkan posisi menunjuk open item-nya.",
          },
        };
      }
      const once = new Set<number>();
      for (const c of chosen) {
        if (once.has(c.item_id)) {
          return {
            ok: false,
            errors: {
              _lines: `Satu open item hanya boleh dipilih sekali pada ${budget.budget_no}.`,
            },
          };
        }
        once.add(c.item_id);
        // The pool offers only this line's own open items, so an id outside
        // it is another subject's item, a cleared one, or one that does not
        // exist.
        const offered = budget.items.find((i) => i.id === c.item_id);
        if (!offered) {
          return {
            ok: false,
            errors: {
              _lines:
                `Open item pada ${budget.budget_no} bukan milik Partner, buku, dan ` +
                "currency Budget ini, atau sudah selesai.",
            },
          };
        }
        if (!(c.amount > 0)) {
          return {
            ok: false,
            errors: {
              _lines: `Nominal untuk ${offered.itemNo} pada ${budget.budget_no} harus lebih dari nol.`,
            },
          };
        }
        const left = (itemLeft.get(c.item_id) ?? offered.remaining) - c.amount;
        if (Math.round(left * 100) < 0) {
          return {
            ok: false,
            errors: {
              _lines:
                `Nominal untuk ${offered.itemNo} pada ${budget.budget_no} melebihi ` +
                "sisa open item itu. Posisi buku subjek tidak boleh di bawah nol — " +
                "kurangi nominalnya.",
            },
          };
        }
        itemLeft.set(c.item_id, left);
        checked.push({ itemId: c.item_id, amount: c.amount });
      }
    }

    resolved.push({
      budgetId: budget.id,
      amount: amountOf(l),
      outstanding: budget.outstanding,
      items: checked,
    });
  }

  const total = resolved.reduce((t, l) => t + l.amount, 0);

  // The layer cap. One transaction draws on one layer, so the document is
  // limited to what that layer still holds — whatever the account holds
  // overall. A resource with five layers of a million each holds five million
  // and cannot pay one and a half in a single document.
  //
  // Checked here rather than only at Post because it couples two things the
  // form keeps apart: the Budget lines being filled in, and the kurs chosen in
  // the header. Whichever is chosen second has to validate against the first.
  if (header.cash_bank_layer_id) {
    const layer = await prisma.cashBankLayer.findUnique({
      where: { id: header.cash_bank_layer_id },
      select: { foreign_remaining: true, status: true, layer_no: true },
    });
    if (layer && layer.status === "Open") {
      const remaining = layer.foreign_remaining.toNumber();
      if (total > remaining) {
        return {
          ok: false,
          errors: {
            _lines:
              `Total realisasi ${total} melebihi sisa layer ${layer.layer_no} ` +
              `yang tinggal ${remaining}. Satu transaksi memakai tepat satu ` +
              "layer — kurangi nominalnya, pilih layer lain, atau pecah dokumen.",
          },
        };
      }
    }
  }

  return { ok: true, lines: resolved, total };
}

// ------------------------------------------------------------------ posting

export type PostingResult =
  | { ok: true; closed: number; journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/**
 * What one Budget line is worth on the cash side.
 *
 * A document has a currency; a resource has a currency; they need not be the
 * same, but under the crossing rule one of them is always the base currency
 * when they differ. Three cases, and `rateSource` in `lib/siba/currency.ts` is
 * the one place they are told apart:
 *
 *   * **foreign out of a foreign resource** — the kurs is the chosen layer's,
 *     read rather than typed, and each line's base is what the layer gives up
 *     for that line, drawn one line after the other;
 *   * **foreign through a base-currency resource** — the kurs is the one the
 *     bank actually converted at, typed on the document, applied per line;
 *   * **base on base** — the kurs is `1`.
 *
 * Valued **per line** rather than once and apportioned, because every line
 * writes a Cash Bank Book entry of its own: an entry's base has to be what that
 * line actually cost, not a share of a figure nobody booked.
 */
export type CashLine = {
  /** What moves through the resource, in the resource's own currency. */
  accountAmount: number;
  /** What the movement was worth in base. */
  base: number;
};

export type Valuation = {
  /** Document currency to base. Never 1 unless the document is base currency. */
  rate: number;
  /** The rate the *resource's* own currency was valued at — 1 when it is base. */
  accountRate: number;
  /** The layer drawn on, where one was. */
  layerId: number | null;
  /** One per document line, in line order. */
  lines: CashLine[];
};

export type ValuationCheck =
  | { ok: true; valuation: Valuation }
  | { ok: false; errors: Record<string, string> };

/**
 * Resolves a document's kurs before anything is written.
 *
 * Reads the layer rather than trusting the rate the document carries: a Draft
 * may have chosen a layer that another document has since drawn to nothing, and
 * the rate stored on the draft would then value the payment at a price the bank
 * no longer holds.
 */
async function resolveValuation(doc: {
  transaction_type: string;
  exchange_rate: { toNumber(): number };
  cash_bank_layer_id: number | null;
  document_date: Date | null;
  currency: { currency_label: string };
  cash_bank: { currency: { currency_label: string } } | null;
  amounts: number[];
}): Promise<ValuationCheck> {
  const amounts = doc.amounts;
  const total = amounts.reduce((t, a) => t + a, 0);
  const direction = doc.transaction_type as "In" | "Out";
  const documentCurrency = doc.currency.currency_label;
  const resourceCurrency = doc.cash_bank?.currency.currency_label ?? "";

  const source = rateSource(direction, documentCurrency, resourceCurrency);
  if (!source) {
    return {
      ok: false,
      errors: {
        _form:
          settlementRefusal(documentCurrency, resourceCurrency) ??
          "Kombinasi currency dokumen dan Cash & Bank tidak diperbolehkan.",
      },
    };
  }

  const resourceIsBase = isBaseCurrency(resourceCurrency);

  if (source === "identity") {
    return {
      ok: true,
      valuation: {
        rate: 1,
        accountRate: 1,
        layerId: null,
        lines: amounts.map((a) => ({ accountAmount: a, base: a })),
      },
    };
  }

  if (source === "entered") {
    const rate = doc.exchange_rate.toNumber();
    if (!(rate > 0)) {
      return {
        ok: false,
        errors: { exchange_rate: "Kurs wajib diisi untuk dokumen mata uang asing." },
      };
    }
    // The bank converts only when the document and the resource differ, which
    // under the crossing rule means the resource holds rupiah.
    const converts = resourceIsBase && documentCurrency !== resourceCurrency;
    return {
      ok: true,
      valuation: {
        rate,
        // A base-currency resource is unlayered and worth its own face value.
        accountRate: resourceIsBase ? 1 : rate,
        layerId: null,
        lines: amounts.map((a) => {
          const base = roundBase(a * rate);
          return { accountAmount: converts ? base : a, base };
        }),
      },
    };
  }

  // `layer` — money leaving a foreign resource. The kurs is the layer's, and
  // each line's base is what the layer gives up for it, drawn in line order:
  // drawing a layer to nothing releases its remainder exactly, on the last line.
  if (!doc.cash_bank_layer_id) {
    return {
      ok: false,
      errors: {
        cash_bank_layer_id:
          "Pilih layer kurs yang dipakai. Satu transaksi memakai tepat satu layer.",
      },
    };
  }
  const layer = await prisma.cashBankLayer.findUnique({
    where: { id: doc.cash_bank_layer_id },
    select: {
      rate: true,
      foreign_remaining: true,
      base_remaining: true,
      status: true,
      layer_no: true,
      acquisition_date: true,
    },
  });
  if (!layer || layer.status !== "Open") {
    return {
      ok: false,
      errors: {
        cash_bank_layer_id:
          "Layer kurs yang dipilih sudah tidak tersedia. Buka kembali dokumen dan pilih ulang.",
      },
    };
  }
  const tooNew = doc.document_date
    ? layerDateRefusal(layer, doc.document_date.toISOString().slice(0, 10))
    : null;
  if (tooNew) return { ok: false, errors: { cash_bank_layer_id: tooNew } };
  if (total > layer.foreign_remaining.toNumber()) {
    return {
      ok: false,
      errors: {
        cash_bank_layer_id:
          `Layer ${layer.layer_no} hanya menyisakan ` +
          `${layer.foreign_remaining.toNumber()}, sedangkan dokumen ini bernilai ` +
          `${total}. Satu transaksi memakai tepat satu layer — pecah dokumen ` +
          "atau pilih layer lain.",
      },
    };
  }

  const rate = layer.rate.toNumber();
  let remaining = {
    foreign: layer.foreign_remaining.toNumber(),
    base: layer.base_remaining.toNumber(),
    rate,
  };
  const lines: CashLine[] = [];
  for (const a of amounts) {
    const drawn = drawLayer(remaining, a);
    lines.push({ accountAmount: a, base: drawn.base });
    remaining = drawn.remaining;
  }

  return {
    ok: true,
    valuation: { rate, accountRate: rate, layerId: doc.cash_bank_layer_id, lines },
  };
}

/**
 * The account one Budget line journals against — Company × its Budget Category
 * × its Partner's Partner Category, or no Partner Category where the Budget
 * names no Partner.
 *
 * Resolved **per line**: a realization may settle Budgets of several categories
 * and several Partners, and each lands on its own account.
 */
async function lineAccountIds(
  companyId: number,
  budgets: { id: number; budget_no: string; category_id: number | null; partner_id: number | null }[]
): Promise<
  | { ok: true; accounts: Map<number, number> }
  | { ok: false; errors: Record<string, string> }
> {
  const partnerIds = [
    ...new Set(budgets.map((b) => b.partner_id).filter((p): p is number => p != null)),
  ];
  const categoryIds = [
    ...new Set(budgets.map((b) => b.category_id).filter((c): c is number => c != null)),
  ];
  const [partners, mappings, categories] = await Promise.all([
    prisma.mPartner.findMany({
      where: { id: { in: partnerIds } },
      select: { id: true, category_id: true, category: { select: { category_label: true } } },
    }),
    prisma.accBudgetCategoryAccount.findMany({
      where: { company_id: companyId, budget_category_id: { in: categoryIds } },
      select: { budget_category_id: true, partner_category_id: true, account_id: true },
    }),
    prisma.sysBudgetCategory.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, category_label: true },
    }),
  ]);
  const partnerOf = new Map(partners.map((p) => [p.id, p]));
  const categoryLabel = new Map(categories.map((c) => [c.id, c.category_label]));

  const accounts = new Map<number, number>();
  const missing: string[] = [];
  for (const b of budgets) {
    if (b.category_id == null) {
      missing.push(`${b.budget_no} (belum berkategori)`);
      continue;
    }
    const partner = b.partner_id != null ? partnerOf.get(b.partner_id) : null;
    const partnerCategoryId = partner ? partner.category_id : null;
    const mapping = mappings.find(
      (m) =>
        m.budget_category_id === b.category_id &&
        m.partner_category_id === partnerCategoryId
    );
    if (!mapping) {
      const combination = partner
        ? `${categoryLabel.get(b.category_id)} × ${partner.category.category_label}`
        : `${categoryLabel.get(b.category_id)}`;
      missing.push(`${b.budget_no} (${combination})`);
      continue;
    }
    accounts.set(b.id, mapping.account_id);
  }

  if (missing.length) {
    // Approval tolerates a missing mapping (§10 rule 28) because that gap
    // belongs to Accounting. Posting cannot: without a mapping there is no
    // account to journal against, and money must not move unaccounted for.
    return {
      ok: false,
      errors: {
        _form:
          `Belum ada Mapping Budget ke Account untuk: ${missing.join(", ")}. ` +
          "Lengkapi mapping di Accounting sebelum dokumen diposting.",
      },
    };
  }
  return { ok: true, accounts };
}

export type PostingLine = {
  lineId: number;
  budgetId: number;
  budgetNo: string;
  /** The Budget's own description — what every book entry of this line reads. */
  description: string;
  partnerId: number | null;
  /** In the document's currency. */
  amount: number;
  /** What moved through the resource, in the resource's own currency. */
  accountAmount: number;
  /** What the cash cost for this line, in base. */
  transactionBase: number;
  /** What the obligation released for this line, in base. */
  settlementBase: number;
  /**
   * Signed as a gain. On a line settling items, the sum of theirs — read, not
   * journaled; each item's difference is its own journal line.
   */
  fxDifference: number;
  counterAccountId: number;
  /** The subject book this line writes into, where its category keeps one. */
  book: SubledgerDef | null;
  /** The items a lowering line settles, in the user's order; empty where it raises. */
  items: PostingItem[];
};

/** One open item a line settles, valued. */
export type PostingItem = {
  /** `fin_cash_bank_transaction_line_item.id`. */
  allocationId: number;
  itemId: number;
  itemNo: string;
  /** The kurs the item was raised at — its own, never derived from the relief. */
  rate: number;
  /** In the document's currency. */
  amount: number;
  /** What the item released, at its own kurs. */
  settlementBase: number;
  /** This item's share of what the line's cash cost. */
  transactionBase: number;
  /** Signed as a gain: positive on the credit side, negative on the debit side. */
  fxDifference: number;
};

export type PostingPlan = {
  rate: number;
  accountRate: number;
  layerId: number | null;
  /** Σ of every line's base — what the cash side of the journal carries. */
  base: number;
  fxAccountId: number | null;
  lines: PostingLine[];
};

/**
 * Everything a posting needs to know before it writes anything — per line.
 *
 * Each line is a settlement of its own. The cash gives up what that line cost
 * (the layer's rate, or the rate the bank converted at), and the line's own
 * obligation releases what **the open item it settles** was raised at. Where
 * they disagree the residual is **that line's** FX difference, journaled on its
 * own line — never summed across the document.
 *
 * Where there is nothing on the books to relieve — an expense, a Piutang raised
 * by paying out, a first-ever Hutang — the movement *is* the origin of the
 * value, so the two sides come from the same place and no difference arises.
 *
 * Two lines against the same open item are settled one after the other: the
 * second relieves what the first left, which is what the book will hold when
 * its entry is written.
 */
async function planPosting(
  doc: {
    id: number;
    transaction_type: string;
    exchange_rate: { toNumber(): number };
    cash_bank_layer_id: number | null;
    company_id: number;
    currency_id: number;
    document_date: Date | null;
    currency: { currency_label: string };
    cash_bank: { currency: { currency_label: string } } | null;
    lines: {
      id: number;
      source_doc_id: number;
      settlement_amount: { toNumber(): number };
      items: { id: number; sub_ledger_balance_id: number; amount: { toNumber(): number } }[];
    }[];
  },
  budgets: Map<
    number,
    { id: number; budget_no: string; description: string; category_id: number | null; partner_id: number | null }
  >,
  options: {
    /** Whose Selisih Kurs account a difference lands on. */
    induk: boolean;
    /**
     * A cash side valued already, in place of the document's own. Only the
     * Ajukan Dana check passes one: the anak's request has no cash yet, and
     * what it asks is whether the lines themselves could be posted.
     */
    valuation?: Valuation;
    /** False skips resolving the Selisih Kurs account — the same check. */
    resolveFx?: boolean;
    /**
     * Valuing a Draft as it is saved. A missing mapping is Post's refusal, not
     * the draft's (§10 rule 50): the figures are still computed, and the
     * counter account is left unresolved because no journal is written.
     */
    draft?: boolean;
  }
): Promise<
  { ok: true; plan: PostingPlan } | { ok: false; errors: Record<string, string> }
> {
  const amounts = doc.lines.map((l) => l.settlement_amount.toNumber());
  let valuation: Valuation;
  if (options.valuation) valuation = options.valuation;
  else {
    const resolved = await resolveValuation({ ...doc, amounts });
    if (!resolved.ok) return resolved;
    valuation = resolved.valuation;
  }

  const lineBudgets = doc.lines.map((l) => budgets.get(l.source_doc_id)!);
  const mapped = await lineAccountIds(doc.company_id, lineBudgets);
  if (!mapped.ok && !options.draft) return mapped;
  const accounts = mapped.ok ? mapped.accounts : new Map<number, number>();

  const direction = doc.transaction_type as "In" | "Out";
  const books = await loadSubledgers();

  // The open items this document settles, as they stand now, drawn down line
  // by line — two lines may settle one item, and the second relieves what the
  // first left, which is what the book will hold when its entry is written.
  const items = new Map<number, { foreign: number; base: number }>();
  const lines: PostingLine[] = [];
  for (const [i, line] of doc.lines.entries()) {
    const budget = lineBudgets[i];
    const amount = amounts[i];
    const cash = valuation.lines[i];
    const catalogue = subledgerForCategory(books, budget.category_id);
    const book = catalogue && budget.partner_id != null ? catalogue : null;

    // Raising a position is the origin of its value, so both sides come from
    // the cash and no difference can arise. Lowering one settles the **items
    // the user chose, for the amounts the user chose** — each released at the
    // kurs it was raised at, never an average — and what the line's cash cost
    // is split across them in proportion (`allocateBase`, the last item taking
    // the rounding so the shares add up to what left the bank). Each item's gap
    // is its own FX difference, signed as a gain from the line's direction.
    let settlementBase = cash.base;
    let fx = 0;
    const settled: PostingItem[] = [];
    const cents = (n: number) => Math.round(n * 100);
    if (book && subledgerMovement(book, direction, amount) < 0) {
      if (!line.items.length) {
        return {
          ok: false,
          errors: {
            _form:
              `${budget.budget_no} belum menunjuk open item yang diselesaikan. Ubah ` +
              "dokumen dan pilih open item-nya.",
          },
        };
      }
      const allocated = line.items.map((a) => a.amount.toNumber());
      if (cents(allocated.reduce((t, a) => t + a, 0)) !== cents(amount)) {
        return {
          ok: false,
          errors: {
            _form:
              `Nominal ${budget.budget_no} tidak sama dengan jumlah open item yang ` +
              "diselesaikannya. Ubah dokumen dan periksa nominal per item.",
          },
        };
      }
      const cashShares = allocateBase(allocated, amount, cash.base);
      settlementBase = 0;
      for (const [k, allocation] of line.items.entries()) {
        const share = allocated[k];
        const item: SubledgerItem | null = await subledgerItem(
          allocation.sub_ledger_balance_id
        );
        if (
          !item ||
          item.bookId !== book.categoryId ||
          item.partnerId !== budget.partner_id ||
          item.currencyId !== doc.currency_id
        ) {
          return {
            ok: false,
            errors: {
              _form:
                `${budget.budget_no} menunjuk open item yang bukan milik Partner, ` +
                "buku, dan currency-nya. Ubah dokumen dan pilih ulang.",
            },
          };
        }
        const held = items.get(item.id) ?? {
          foreign: item.remaining,
          base: item.baseRemaining,
        };
        if (item.status !== "Open" || cents(share) > cents(held.foreign)) {
          return {
            ok: false,
            errors: {
              _form:
                `Open item ${item.itemNo} tinggal ${held.foreign}, tidak cukup untuk ` +
                `${budget.budget_no}. Kemungkinan sudah diselesaikan dokumen lain — ` +
                "ubah dokumen dan periksa nominalnya.",
            },
          };
        }
        // What earlier lines of this document took counts against the
        // document's own day as well as against today.
        const lowest = await itemLowestFrom(
          item.id,
          doc.document_date ? day(doc.document_date) : todayDay()
        );
        if (cents(share) > cents(lowest.balance - (item.remaining - held.foreign))) {
          return {
            ok: false,
            errors: {
              _form:
                `Open item ${item.itemNo} tinggal ${lowest.balance} pada ${lowest.at}, ` +
                `tidak cukup untuk ${budget.budget_no}. Posisi tidak boleh di bawah nol ` +
                "pada hari mana pun — ubah tanggal dokumen atau nominalnya.",
            },
          };
        }
        const relief = relieve(
          held,
          cents(share) === cents(held.foreign) ? held.foreign : share
        );
        items.set(item.id, relief.remaining);
        const itemFx =
          (direction === "In" ? -1 : 1) *
          fxDifference(relief.base, cashShares[k]).amount;
        settled.push({
          allocationId: allocation.id,
          itemId: item.id,
          itemNo: item.itemNo,
          rate: item.rate,
          amount: share,
          settlementBase: relief.base,
          transactionBase: cashShares[k],
          fxDifference: itemFx,
        });
        settlementBase = roundBase(settlementBase + relief.base);
        fx = roundBase(fx + itemFx);
      }
    }

    lines.push({
      lineId: line.id,
      budgetId: budget.id,
      budgetNo: budget.budget_no,
      description: budget.description,
      partnerId: budget.partner_id,
      amount,
      accountAmount: cash.accountAmount,
      transactionBase: cash.base,
      settlementBase,
      // Signed as a gain, positive on the credit side. The kernel's residual
      // (released − cost) reads that way when money leaves; when it arrives
      // the same residual is a loss — a receivable carried at 15.000 and
      // collected at 13.000 gave up more than the cash brought in — so a
      // receipt turns it over. On a line settling items it is the sum of
      // theirs, for reading; each item's is journaled on its own.
      fxDifference: fx,
      counterAccountId: accounts.get(budget.id) ?? 0,
      book,
      items: settled,
    });
  }

  // An FX difference has to land somewhere named. The account is only looked
  // up when a difference actually arises, so ordinary rupiah work is never
  // blocked by a setting it does not use.
  // Asked of every item, not of the line total: a gain on one item and a loss
  // on another can sum to nil on the line and still be two journal lines.
  let fxAccountId: number | null = null;
  if (
    options.resolveFx !== false &&
    lines.some(
      (l) => l.fxDifference !== 0 || l.items.some((it) => it.fxDifference !== 0)
    )
  ) {
    fxAccountId = await systemAccountId(options.induk, "fx");
    if (!fxAccountId) {
      return {
        ok: false,
        errors: {
          _form:
            "Selisih kurs muncul pada dokumen ini, tetapi Account Selisih Kurs " +
            "belum diatur untuk Company ini. Lengkapi di Accounting › Mapping " +
            "Account System sebelum dokumen diposting.",
        },
      };
    }
  }

  return {
    ok: true,
    plan: {
      rate: valuation.rate,
      accountRate: valuation.accountRate,
      layerId: valuation.layerId,
      base: roundBase(lines.reduce((t, l) => t + l.transactionBase, 0)),
      fxAccountId,
      lines,
    },
  };
}

/**
 * The accounting entries a realization produces.
 *
 * One cash line for the whole document — the money left or reached the
 * resource once — then, for **every Budget line**, its own counter line on the
 * account its classification maps to, carrying its own Partner, and its own FX
 * difference line where that line's two base values disagree. A document
 * realizing six Budgets across three categories is one journal of up to
 * thirteen lines, and each one reads back to the plan it settled.
 *
 * Each line carries its own currency and its own rate: a foreign document paid
 * from a rupiah account produces a rupiah cash line and foreign counter lines
 * in the same journal, and the entry balances in base alone.
 */
async function journalEntries(
  doc: {
    transaction_no: string;
    cash_bank_id: number | null;
    currency_id: number;
    transaction_type: string;
  },
  plan: PostingPlan
): Promise<
  | { ok: true; lines: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> }
> {
  const cash = await cashJournalLine(doc.cash_bank_id!, doc.transaction_type, plan);
  if (!cash) {
    return { ok: false, errors: { _form: "Cash & Bank dokumen tidak ditemukan." } };
  }
  return {
    ok: true,
    lines: [
      { ...cash, description: `${doc.transaction_no} — ${cash.description}` },
      ...(await counterJournalLines(doc, plan)),
    ],
  };
}

/**
 * The cash side of a realization's journal: one line for the whole document,
 * in the resource's own currency and at its own rate. The funded route writes
 * it into the induk's journal, and the same figures, on the bridge account,
 * into the anak's — which is what makes the two Companies' positions against
 * each other equal on both measures.
 */
async function cashJournalLine(
  cashBankId: number,
  transactionType: string,
  plan: PostingPlan
): Promise<JournalLineInput | null> {
  const cashBank = await prisma.mCashBank.findUnique({
    where: { id: cashBankId },
    select: { account_id: true, currency_id: true, cash_bank_label: true },
  });
  if (!cashBank) return null;
  const incoming = transactionType === "In";
  const accountAmount = plan.lines.reduce((t, l) => t + l.accountAmount, 0);
  return {
    accountId: cashBank.account_id,
    currencyId: cashBank.currency_id,
    rate: plan.accountRate,
    debit: incoming ? accountAmount : 0,
    credit: incoming ? 0 : accountAmount,
    baseAmount: plan.base,
    description: cashBank.cash_bank_label,
  };
}

/**
 * Per Budget: its counter line on its own mapped account and Partner — one per
 * open item it settles — and its own FX lines where its two base values
 * disagree. The same on both routes —
 * the funded one writes them into the anak's journal.
 */
async function counterJournalLines(
  doc: { currency_id: number; transaction_type: string },
  plan: PostingPlan
): Promise<JournalLineInput[]> {
  const incoming = doc.transaction_type === "In";
  const baseCurrency = await baseCurrencyId();
  const lines: JournalLineInput[] = [];

  for (const l of plan.lines) {
    // The counter side, in the document's currency and at the rate the
    // obligation was carried at — which is what makes the two differ. A line
    // settling open items writes one per item at that item's own kurs: one
    // line for several would carry their average, a rate nobody dealt at.
    const counters = l.items.length
      ? l.items.map((it) => ({
          amount: it.amount,
          rate: it.rate,
          base: it.settlementBase,
          description: `${l.description} · ${it.itemNo}`,
        }))
      : [
          {
            amount: l.amount,
            rate: l.amount ? l.settlementBase / l.amount : plan.rate,
            base: l.settlementBase,
            description: l.description,
          },
        ];
    for (const c of counters) {
      lines.push({
        accountId: l.counterAccountId,
        partnerId: l.partnerId,
        currencyId: doc.currency_id,
        rate: c.rate,
        debit: incoming ? 0 : c.amount,
        credit: incoming ? c.amount : 0,
        baseAmount: c.base,
        description: c.description,
      });
    }

    // The residuals, and only where there is one. A line settling open items
    // has one per item — never netted, so an item settled at a gain and one at
    // a loss stay a credit and a debit (IAS 21 / PSAK 10 recognise it per
    // monetary item settled). A line raising a position has none: both sides
    // came from the same cash. Each side is the balancing side, never chosen:
    // a gain on the credit side, a loss on the debit side, whichever way the
    // money moved.
    const residuals = l.items.length
      ? l.items.map((it) => ({
          amount: it.fxDifference,
          description: `Selisih kurs — ${l.description} · ${it.itemNo}`,
        }))
      : [{ amount: l.fxDifference, description: `Selisih kurs — ${l.description}` }];
    for (const r of residuals) {
      if (r.amount === 0 || !plan.fxAccountId) continue;
      const magnitude = Math.abs(r.amount);
      const gain = r.amount > 0;
      lines.push({
        accountId: plan.fxAccountId,
        currencyId: baseCurrency,
        rate: 1,
        debit: gain ? 0 : magnitude,
        credit: gain ? magnitude : 0,
        description: r.description,
      });
    }
  }

  return lines;
}

/** The base currency's row id, for the lines that have no foreign face. */
async function baseCurrencyId(): Promise<number> {
  const row = await prisma.refCurrency.findFirst({
    where: { currency_label: BASE_CURRENCY_LABEL },
    select: { id: true },
  });
  if (!row) {
    throw new Error(
      `Currency dasar ${BASE_CURRENCY_LABEL} tidak ada pada master. Jalankan db:seed.`
    );
  }
  return row.id;
}

/**
 * Post: the actual boundary (concept doc §2.3).
 *
 * One database transaction — either the money moved and every book that must
 * know about it does, or nothing happened at all:
 *
 *   1. the **Cash Bank Book** gets one entry **per Budget line**, each reading
 *      its Budget's own description, and its materialised balance moves with
 *      every one (`recordCashBankEntry`);
 *   2. the **subject book** each line's Budget Category keeps, where it keeps
 *      one — again one entry per line, never summed per Partner;
 *   3. the **Journal**, balanced in base currency (`postJournal`);
 *   4. the rate **layer** it draws on, or the one it opens;
 *   5. every Budget on the document has its `realized_amount` raised, and a
 *      Budget that reaches its planned amount closes itself (§6.5);
 *   6. the document acquires its document and posting dates and becomes Posted.
 *
 * The books are written **straight from the document**, never derived from a
 * journal line: operational books are independent historical stores, and only
 * the General Ledger derives from journals (§2.5, §11.7). That is why the three
 * writers are called side by side here and none of them reads another.
 *
 * Budgets are re-read *now* rather than trusted from when the document was
 * drafted: another document may have closed one in the meantime, and posting
 * against a plan that is no longer Open would record a realization nothing
 * authorised. The same is true of the layer — `drawFromLayer` throws rather
 * than returning, so a layer spent since the document was drafted takes the
 * whole posting down instead of being overdrawn.
 *
 * Lives here rather than inside the Server Action so the rule is testable: the
 * action resolves a caller and then calls this, and the test suite calls the
 * same function.
 */
export async function applyPosting(
  transactionId: number,
  actorId: number,
  /**
   * Stop once the journal is known and write nothing — what the Post
   * confirmation shows. Every check and every valuation above that point runs
   * exactly as it does for a real Post, so the preview is the journal.
   */
  dryRun = false
): Promise<PostingResult> {
  const doc = await prisma.finCashBankTransaction.findUnique({
    where: { id: transactionId },
    include: {
      lines: { include: { items: { orderBy: { sequence_no: "asc" } } } },
      currency: { select: { currency_label: true } },
      cash_bank: { select: { currency: { select: { currency_label: true } } } },
    },
  });
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Draft") {
    return {
      ok: false,
      errors: { _form: "Hanya dokumen berstatus Draft yang dapat diposting." },
    };
  }
  // The funded route never comes through here. An anak document has no
  // resource of its own to move, and its posting is the induk's confirmation
  // of a Funding Request — which posts both Companies at once.
  if ((await fundingRoute(doc.company_id)) !== "self") {
    return {
      ok: false,
      errors: {
        _form:
          "Dokumen Company anak tidak diposting langsung. Ajukan dana ke induk, " +
          "dan dokumen terposting saat induk mengonfirmasi Funding Request.",
      },
    };
  }
  if (!doc.lines.length) {
    return {
      ok: false,
      errors: {
        _form: "Tambahkan minimal satu Budget sebelum dokumen diposting.",
      },
    };
  }
  if (!doc.cash_bank_id) {
    return { ok: false, errors: { _form: "Dokumen belum menunjuk Cash & Bank." } };
  }

  const budgets = await budgetsByIds(doc.lines.map((l) => l.source_doc_id));
  const byId = new Map(budgets.map((b) => [b.id, b]));

  const stale = doc.lines.filter(
    (l) => byId.get(l.source_doc_id)?.status !== "Open"
  );
  if (stale.length) {
    return {
      ok: false,
      errors: {
        _form:
          `${stale.length} Budget pada dokumen ini sudah tidak berstatus Disetujui (Open), ` +
          "kemungkinan sudah ditutup dokumen lain. Ubah dokumen dan keluarkan baris tersebut.",
      },
    };
  }

  // The day this document belongs to in the books — chosen on the draft, and
  // possibly earlier than today. Every book entry, the layer it opens and the
  // journal are dated it; `posting_date` keeps the moment it was actually
  // posted. A draft saved before drafts carried a date posts as today.
  //
  // Re-checked here rather than trusted from the save: a year can close in
  // between. Asked before anything is resolved, so a refusal costs nothing and
  // reads as what it is — not a fault, but a period that is shut.
  const dated = await checkTransactionDate(
    doc.document_date ?? todayDay(),
    [doc.company_id]
  );
  if (!dated.ok) return { ok: false, errors: { _form: dated.message } };
  const date = dated.date;

  const docTypeId = await transactionDocTypeId();
  let closed = 0;

  // Everything is resolved and checked before the transaction opens, so a
  // document that cannot be valued, cannot be journalled, or has chosen a layer
  // another document has since emptied refuses rather than aborting halfway: a
  // posting that moves the book without writing accounting is exactly the split
  // §12 forbids.
  const planned = await planPosting(doc, byId, { induk: true });
  if (!planned.ok) return { ok: false, errors: planned.errors };
  const plan = planned.plan;

  const entries = await journalEntries(doc, plan);
  if (!entries.ok) return { ok: false, errors: entries.errors };
  const short = await cashShortfall(doc.cash_bank_id, doc.transaction_type, date, plan);
  if (short) return short;
  if (dryRun) return { ok: true, closed: 0, journal: entries.lines };

  try {
  await prisma.$transaction(async (tx) => {
    // The year this is dated in, held against a close for the rest of the
    // transaction and re-asked under the hold: the check above was before it.
    await holdPostingPeriod(tx, [doc.company_id], date);

    await lockPlanPositions(tx, plan, doc.currency_id);
    await writeRealizationLines(tx, plan, {
      cashBankId: doc.cash_bank_id!,
      direction: doc.transaction_type as "In" | "Out",
      documentCurrencyLabel: doc.currency.currency_label,
      resourceCurrencyLabel: doc.cash_bank?.currency.currency_label ?? "",
      currencyId: doc.currency_id,
      docTypeId,
      docId: doc.id,
      date,
      actorId,
    });

    // Realization is Budget's to write, not Finance's — same transaction, but
    // `bud_budget` is only ever touched by the module that owns it. Closing
    // follows from the figures and is reported back for the caller's message.
    ({ closed } = await realizeBudgets(
      tx,
      doc.lines.map((line) => ({
        budgetId: line.source_doc_id,
        amount: line.settlement_amount.toNumber(),
      })),
      actorId
    ));

    // The Journal is written *alongside* the Cash Bank Book, never from it:
    // an operational book is an independent historical store and only the
    // General Ledger derives from journal lines (concept doc §2.5, §2.6).
    // `postJournal` throws unless the two sides sum equal, and a throw in here
    // takes the whole posting down — which is the guarantee.
    await postJournal(tx, {
      companyId: doc.company_id,
      postingDate: new Date(`${date}T00:00:00Z`),
      description: `${doc.transaction_no} — ${realizationOf(doc.transaction_type).title}`,
      sourceDocTypeId: docTypeId,
      sourceDocId: doc.id,
      lines: entries.lines,
      actorId,
    });

    await tx.finCashBankTransaction.update({
      where: { id: transactionId },
      data: {
        status: "Posted",
        document_date: new Date(`${date}T00:00:00Z`),
        posting_date: new Date(),
        exchange_rate: plan.rate,
        transaction_base_amount: plan.base,
        updated_by: actorId,
      },
    });
  });
  } catch (error) {
    if (isPostingRefusal(error)) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }

  return { ok: true, closed };
}

/**
 * Every position a plan lowers, held for the rest of the transaction so two
 * documents settling one open item cannot both pass against the same remaining
 * figure. Taken after the period lock and in one fixed order, so nothing waits
 * in a circle. Both routes take it.
 */
async function lockPlanPositions(
  tx: Prisma.TransactionClient,
  plan: PostingPlan,
  currencyId: number
): Promise<void> {
  const held = [
    ...new Set(
      plan.lines
        .filter((l) => l.items.length && l.book)
        .map((l) => `${l.book!.categoryId}|${l.partnerId}`)
    ),
  ].sort();
  for (const k of held) {
    const [bookId, partnerId] = k.split("|");
    await lockSubledgerPosition(tx, Number(bookId), Number(partnerId), currencyId);
  }
}

/**
 * What one realization writes into the books, per Budget line — shared by
 * the direct route and the funded one, which differ only in whose resource
 * the cash moves through and whose journal carries it.
 *
 * Per line: the layer drawn on (or one opened), one Cash Bank Book entry, and
 * the subject-book entries its category keeps — opening an item or settling
 * the ones the user chose. Then each line's and each item's base figures on
 * the document. The journal and the realization are the caller's.
 */
async function writeRealizationLines(
  tx: Prisma.TransactionClient,
  plan: PostingPlan,
  ctx: {
    /** The resource the money moves through — the induk's on the funded route. */
    cashBankId: number;
    direction: "In" | "Out";
    documentCurrencyLabel: string;
    resourceCurrencyLabel: string;
    /** The document's currency, which the subject books are kept in. */
    currencyId: number;
    docTypeId: number;
    docId: number;
    date: string;
    actorId: number;
  }
): Promise<void> {
  const direction = ctx.direction;
  const opensLayer = createsLayer(
    direction,
    ctx.documentCurrencyLabel,
    ctx.resourceCurrencyLabel
  );

  for (const line of plan.lines) {
    // The layer the payment drew on, taken down by exactly what this line
    // took from it. Drawn before the line's book entry so an exhausted layer
    // refuses before anything else is written — `drawFromLayer` throws, and
    // a throw in here takes the posting down. A layer another document has
    // moved since the plan was made would value the line differently from
    // the journal already composed, so that refuses too.
    if (plan.layerId) {
      const drawn = await drawFromLayer(tx, {
        layerId: plan.layerId,
        cashBankId: ctx.cashBankId,
        foreign: line.accountAmount,
        date: ctx.date,
        actorId: ctx.actorId,
      });
      if (drawn.base !== line.transactionBase) {
        throw new LayerNotAvailable(
          "Layer kurs berubah sejak dokumen divaluasi. Ulangi Post."
        );
      }
    }

    // One Cash Bank Book entry per Budget, reading that Budget's own words,
    // so the book traces back to each plan it paid rather than to a total.
    await recordCashBankEntry(tx, {
      cashBankId: ctx.cashBankId,
      date: ctx.date,
      type: "Transaction",
      direction,
      // In the **resource's** own currency, which is the line's amount
      // unless the bank did the converting.
      amount: line.accountAmount,
      rate: plan.accountRate,
      baseAmount: line.transactionBase,
      sourceDocTypeId: ctx.docTypeId,
      sourceDocId: ctx.docId,
      note: line.description,
      actorId: ctx.actorId,
    });

    // Money arriving into a foreign resource is currency acquired, and each
    // line acquires a layer of its own at the rate it was bought in at —
    // one per book entry, never merged with an existing one.
    if (opensLayer) {
      await openLayer(tx, {
        cashBankId: ctx.cashBankId,
        date: ctx.date,
        rate: plan.accountRate,
        foreign: line.accountAmount,
        baseAmount: line.transactionBase,
        sourceDocTypeId: ctx.docTypeId,
        sourceDocId: ctx.docId,
        note: line.description,
        actorId: ctx.actorId,
      });
    }

    // The subject book this line's Budget Category keeps, where it keeps
    // one — one entry per Budget, never summed per Partner, so a Partner
    // settling six plans shows six movements. Written straight from the
    // document like the Cash Bank Book, never derived from the journal.
    //
    // A line lowering a position writes one entry per item it settles —
    // an entry names exactly one item — each at that item's own rate and
    // reading the Budget's description, so the book still traces every
    // movement to the plan it settled. A raising line writes one entry,
    // which opens its item.
    if (line.book) {
      const entries = line.items.length
        ? line.items.map((it) => ({
            amount: it.amount,
            baseAmount: it.settlementBase,
            itemId: it.itemId as number | null,
          }))
        : [{ amount: line.amount, baseAmount: line.settlementBase, itemId: null }];
      for (const e of entries) {
        const written = await recordSubledgerEntry(tx, {
          book: line.book,
          partnerId: line.partnerId!,
          currencyId: ctx.currencyId,
          date: ctx.date,
          type: "Transaction",
          direction,
          amount: e.amount,
          // **This book's own rate**, not the cash side's. A relief releases
          // what the item was carried at; the gap to what the cash cost is
          // the item's FX difference, and it lives in the journal.
          rate: e.amount ? e.baseAmount / e.amount : plan.rate,
          baseAmount: e.baseAmount,
          // Null raises a new open item; an id settles the one chosen, and
          // the book refuses if it has moved since the plan valued it.
          itemId: e.itemId,
          sourceDocTypeId: ctx.docTypeId,
          sourceDocId: ctx.docId,
          note: line.description,
          actorId: ctx.actorId,
        });
        // The item a raise opened, kept on the line so the Budget can follow
        // its money on — into a reclassification, for one.
        if (!e.itemId) {
          await tx.finCashBankTransactionLine.update({
            where: { id: line.lineId },
            data: { opened_item_id: written.balance_id },
          });
        }
      }
    }
  }

  // What the document was worth, and what each line's share of that was. The
  // draft stored the same figures when it was saved; written again here
  // because Post re-values against the books as they stand now.
  await writeLineValuation(tx, plan, ctx.actorId);
}

/**
 * Each line's and each item's base figures, as a plan valued them — written
 * when a draft is saved, so the document states what Post will write, and
 * again by Post, which re-values first.
 */
async function writeLineValuation(
  tx: Prisma.TransactionClient,
  plan: PostingPlan,
  actorId: number
): Promise<void> {
  for (const share of plan.lines) {
    await tx.finCashBankTransactionLine.update({
      where: { id: share.lineId },
      data: {
        settlement_base_amount: share.settlementBase,
        settlement_exchange_rate: share.amount
          ? share.settlementBase / share.amount
          : plan.rate,
        transaction_base_amount: share.transactionBase,
        fx_difference: share.fxDifference,
        updated_by: actorId,
      },
    });
    for (const it of share.items) {
      await tx.finCashBankTransactionLineItem.update({
        where: { id: it.allocationId },
        data: {
          settlement_base_amount: it.settlementBase,
          transaction_base_amount: it.transactionBase,
          fx_difference: it.fxDifference,
          updated_by: actorId,
        },
      });
    }
  }
}

/** A draft that could not be valued — rolls its save back. */
export class DraftNotValued extends Error {
  constructor(readonly errors: Record<string, string>) {
    super(Object.values(errors)[0] ?? "Dokumen tidak dapat divaluasi.");
  }
}

/**
 * Values a direct-route draft as it is saved, inside the save's transaction:
 * the same `planPosting` Post runs, so every line and item states the base,
 * the kurs and the FX difference Post would write if it ran now. Post still
 * re-values — a layer or an item may move while the draft waits — and writes
 * the figures again.
 *
 * An anak draft names no cash, so the cash side is the induk's choice at
 * confirmation, in every currency alike: only the settlement side is stated —
 * each settled item at its own kurs. The cash side — the header kurs and base,
 * each line's and item's transaction base and FX difference, and the base of a
 * line that opens an item, which the cash originates — stays unwritten (nil,
 * kurs empty) until the confirmation values the whole document.
 */
export async function valueDraft(
  tx: Prisma.TransactionClient,
  transactionId: number,
  actorId: number
): Promise<void> {
  const doc = await tx.finCashBankTransaction.findUnique({
    where: { id: transactionId },
    include: {
      lines: { include: { items: { orderBy: { sequence_no: "asc" } } } },
      currency: { select: { currency_label: true } },
      cash_bank: { select: { currency: { select: { currency_label: true } } } },
    },
  });
  if (!doc || !doc.lines.length) return;

  const budgets = await budgetsByIds(doc.lines.map((l) => l.source_doc_id));
  const byId = new Map(budgets.map((b) => [b.id, b]));
  const amounts = doc.lines.map((l) => l.settlement_amount.toNumber());
  const funded = !doc.cash_bank_id;
  const planned = await planPosting(doc, byId, {
    induk: !funded,
    draft: true,
    resolveFx: false,
    // A funded draft has no resource to value against. This only stands in:
    // nothing it produces on the cash side is written below.
    valuation: funded
      ? {
          rate: 1,
          accountRate: 1,
          layerId: null,
          lines: amounts.map((a) => ({ accountAmount: a, base: a })),
        }
      : undefined,
  });
  if (!planned.ok) throw new DraftNotValued(planned.errors);
  const plan = planned.plan;

  if (funded) {
    for (const line of plan.lines) {
      const settles = line.items.length > 0;
      await tx.finCashBankTransactionLine.update({
        where: { id: line.lineId },
        data: {
          settlement_base_amount: settles ? line.settlementBase : 0,
          settlement_exchange_rate:
            settles && line.amount ? line.settlementBase / line.amount : null,
          transaction_base_amount: 0,
          fx_difference: 0,
          updated_by: actorId,
        },
      });
      for (const it of line.items) {
        await tx.finCashBankTransactionLineItem.update({
          where: { id: it.allocationId },
          data: {
            settlement_base_amount: it.settlementBase,
            transaction_base_amount: 0,
            fx_difference: 0,
            updated_by: actorId,
          },
        });
      }
    }
    await tx.finCashBankTransaction.update({
      where: { id: transactionId },
      data: { exchange_rate: 0, transaction_base_amount: 0 },
    });
    return;
  }

  await writeLineValuation(tx, plan, actorId);
  await tx.finCashBankTransaction.update({
    where: { id: transactionId },
    data: { exchange_rate: plan.rate, transaction_base_amount: plan.base },
  });
}

// ----------------------------------------------------- funded posting (anak)

/**
 * One Company's side of the intercompany bridge: where it records its claim on
 * the other, and what it owes the other.
 *
 * Accounts only. The position between the two Companies is **journal**, not
 * subject book: a subject book's subject is a Partner (§10 rule 56), and the
 * other Company is not one — inventing a Partner to stand for it would put a
 * fiction in the master just to satisfy a foreign key. The General Ledger and
 * the Trial Balance are where the two sides are read and reconciled.
 */
export type BridgeSide = {
  arAccountId: number;
  apAccountId: number;
};

/**
 * The cash side the induk chooses when it confirms: which of its resources,
 * and — where that resource and the document differ, or the resource is
 * foreign — the layer drawn on or the kurs the bank used. Exactly the three
 * things a direct Realisasi carries on its own header.
 */
export type FundingCashSide = {
  cashBankId: number;
  /** The layer drawn on, where foreign currency leaves a foreign resource. */
  layerId: number | null;
  /** The kurs the bank used, where one is entered; ignored otherwise. */
  rate: number | null;
};

export type FundedPostingInput = {
  transactionId: number;
  cash: FundingCashSide;
  bridge: { induk: BridgeSide; anak: BridgeSide };
  /**
   * What the **provider's** journal records as its cause — the Funding Request.
   * Passed in rather than resolved here: the Funding Request belongs to the
   * module that owns it, and Finance must not name its table.
   */
  providerSource: { docTypeId: number; docId: number };
  /** The request's own number, as a fact rather than a phrase. */
  requestNo: string;
};

export type FundedPostingPlan = {
  transactionId: number;
  indukCompanyId: number;
  anakCompanyId: number;
  cashBankId: number;
  direction: "In" | "Out";
  documentCurrencyLabel: string;
  resourceCurrencyLabel: string;
  /** `YYYY-MM-DD` — the day both Companies' books are written for. */
  date: string;
  currencyId: number;
  transactionNo: string;
  title: string;
  requestNo: string;
  providerSource: { docTypeId: number; docId: number };
  requesterSource: { docTypeId: number; docId: number };
  /** Valued exactly as a direct Realisasi of the same lines would be. */
  posting: PostingPlan;
  /** Cash against the induk's bridge account. */
  indukJournal: JournalLineInput[];
  /** The anak's bridge account where the cash line would be, then every Budget. */
  anakJournal: JournalLineInput[];
  lines: { budgetId: number; amount: number }[];
};

export type FundedPostingCheck =
  | { ok: true; plan: FundedPostingPlan }
  | { ok: false; errors: Record<string, string> };

/** The anak's document, read the way both checks below need it. */
async function readFundedDocument(transactionId: number) {
  return prisma.finCashBankTransaction.findUnique({
    where: { id: transactionId },
    include: {
      lines: { include: { items: { orderBy: { sequence_no: "asc" } } } },
      currency: { select: { currency_label: true } },
    },
  });
}

/**
 * The Budgets a funded document realizes, re-read now: another document may
 * have closed one since the request was raised.
 */
async function openBudgetsOf(doc: { lines: { source_doc_id: number }[] }) {
  const budgets = await budgetsByIds(doc.lines.map((l) => l.source_doc_id));
  const byId = new Map(budgets.map((b) => [b.id, b]));
  const stale = doc.lines.filter((l) => byId.get(l.source_doc_id)?.status !== "Open");
  return { byId, stale: stale.length };
}

/**
 * Could this anak document be posted, cash aside? Asked at **Ajukan Dana**, so
 * a request that no confirmation could ever answer — a Budget without a
 * mapping, a line lowering a position with no open item, an item another
 * document has since settled — is refused while the anak can still fix it,
 * rather than frozen in front of the induk.
 *
 * The lines are valued as if the cash cost exactly what the obligation is
 * worth in the document's own figures; what the cash actually costs is the
 * induk's to decide, and is asked again, whole, at confirmation.
 */
export async function checkFundable(
  transactionId: number
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const doc = await readFundedDocument(transactionId);
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  const { byId, stale } = await openBudgetsOf(doc);
  if (stale) {
    return {
      ok: false,
      errors: {
        _form:
          `${stale} Budget pada dokumen ini sudah tidak berstatus Disetujui (Open). ` +
          "Ubah dokumen dan keluarkan baris tersebut.",
      },
    };
  }
  const amounts = doc.lines.map((l) => l.settlement_amount.toNumber());
  const planned = await planPosting(
    { ...doc, cash_bank: null },
    byId,
    {
      induk: false,
      resolveFx: false,
      valuation: {
        rate: 1,
        accountRate: 1,
        layerId: null,
        lines: amounts.map((a) => ({ accountAmount: a, base: a })),
      },
    }
  );
  return planned.ok ? { ok: true } : planned;
}

/**
 * Everything the funded posting needs, resolved and checked before anything is
 * written — the atomic intercompany posting of concept doc §30, in two halves.
 *
 * **The anak's document is an ordinary Realisasi that does not name its cash.**
 * Its lines, its Budgets and the open items each line settles were all chosen
 * on its draft, exactly as on the induk's; what the induk adds by confirming
 * is the cash side — a resource, and its layer or kurs. From there the posting
 * is `planPosting`, the same valuation a direct Realisasi runs: one Cash Bank
 * Book entry per Budget, one subject-book entry per Budget or per settled item,
 * one counter line per Budget on its own account and Partner, and one Selisih
 * Kurs line per settled item.
 *
 * The two journals differ only in where the cash line goes. The induk's is
 * cash against its bridge account; the anak's carries its bridge account
 * where the cash line would be, then every Budget. Both bridge lines carry the
 * **cash line's own figures** — the currency the induk actually moved, at the
 * rate it moved at — so the two Companies' positions against each other are
 * equal on both measures, and every FX difference lands in the anak's books,
 * on the anak's Selisih Kurs account: the anak carried the obligation, and the
 * induk's claim is what the cash cost.
 *
 * Split from the write because the Funding Request's own closure belongs to
 * the module that owns it: `prepareFundedPosting` answers "may this be
 * posted, and with what", `writeFundedPosting` does it inside the caller's
 * transaction, and the caller closes its request in the same one. Run alone,
 * this is also the confirmation's preview — the journals it returns are the
 * journals the write posts.
 */
export async function prepareFundedPosting(
  input: FundedPostingInput
): Promise<FundedPostingCheck> {
  const doc = await readFundedDocument(input.transactionId);
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Pending") {
    return {
      ok: false,
      errors: {
        _form:
          "Hanya dokumen berstatus Menunggu Funding yang dapat diposting melalui " +
          "konfirmasi Funding Request.",
      },
    };
  }
  if (!doc.lines.length) {
    return { ok: false, errors: { _form: "Dokumen tidak memuat Budget." } };
  }
  if (doc.cash_bank_id) {
    return {
      ok: false,
      errors: { _form: "Dokumen Company anak tidak boleh menunjuk Cash & Bank." },
    };
  }

  const induk = await transactingCompany();
  if (!induk) {
    return {
      ok: false,
      errors: { _form: "Company induk belum tersedia pada master Company." },
    };
  }
  if (doc.company_id === induk.id) {
    return {
      ok: false,
      errors: { _form: "Dokumen Company induk tidak melalui Funding Request." },
    };
  }

  // One business event, two Companies' books — so the date is checked for
  // both. The day is the anak's document date, chosen when it was drafted and
  // possibly earlier than today: the realization happened then, whenever the
  // induk gets round to confirming it.
  const dated = await checkTransactionDate(doc.document_date ?? todayDay(), [
    induk.id,
    doc.company_id,
  ]);
  if (!dated.ok) return { ok: false, errors: { _form: dated.message } };

  const cashBank = await prisma.mCashBank.findUnique({
    where: { id: input.cash.cashBankId },
    select: {
      company_id: true,
      status: true,
      currency: { select: { currency_label: true } },
    },
  });
  if (!cashBank) {
    return { ok: false, errors: { cash_bank_id: "Cash & Bank tidak ditemukan." } };
  }
  if (cashBank.company_id !== induk.id) {
    return {
      ok: false,
      errors: { cash_bank_id: `Cash & Bank harus milik Company ${induk.label}.` },
    };
  }
  if (cashBank.status !== "Active") {
    return {
      ok: false,
      errors: { cash_bank_id: "Cash & Bank tersebut non-aktif dan tidak dapat dipakai." },
    };
  }
  const documentCurrency = doc.currency.currency_label;
  const resourceCurrency = cashBank.currency.currency_label;
  const direction = doc.transaction_type as "In" | "Out";
  const source = rateSource(direction, documentCurrency, resourceCurrency);
  if (!source) {
    return {
      ok: false,
      errors: {
        cash_bank_id:
          settlementRefusal(documentCurrency, resourceCurrency) ??
          "Cash & Bank tersebut tidak dapat menyelesaikan currency dokumen ini.",
      },
    };
  }
  // The layer must be this resource's own, and is asked for only where the
  // kurs is read off one — the checks `checkHeader` makes on a direct header.
  if (source === "layer" && input.cash.layerId) {
    const layer = await prisma.cashBankLayer.findUnique({
      where: { id: input.cash.layerId },
      select: { cash_bank_id: true },
    });
    if (!layer || layer.cash_bank_id !== input.cash.cashBankId) {
      return {
        ok: false,
        errors: {
          cash_bank_layer_id: "Layer kurs tersebut bukan milik Cash & Bank yang dipilih.",
        },
      };
    }
  }

  const { byId, stale } = await openBudgetsOf(doc);
  if (stale) {
    return {
      ok: false,
      errors: {
        _form:
          `${stale} Budget pada dokumen ini sudah tidak berstatus Disetujui (Open), ` +
          "kemungkinan sudah ditutup dokumen lain. Funding tidak dapat dikonfirmasi.",
      },
    };
  }

  // Valued as a direct Realisasi of the same lines would be, with the induk's
  // cash side standing in for the header the anak's document does not carry.
  const planned = await planPosting(
    {
      ...doc,
      cash_bank: { currency: { currency_label: resourceCurrency } },
      cash_bank_layer_id: source === "layer" ? input.cash.layerId : null,
      exchange_rate: { toNumber: () => (source === "entered" ? input.cash.rate ?? 0 : 1) },
    },
    byId,
    { induk: false }
  );
  if (!planned.ok) return planned;
  const posting = planned.plan;
  const short = await cashShortfall(input.cash.cashBankId, direction, dated.date, posting);
  if (short) return short;

  const cash = await cashJournalLine(input.cash.cashBankId, doc.transaction_type, posting);
  if (!cash) {
    return { ok: false, errors: { cash_bank_id: "Cash & Bank tidak ditemukan." } };
  }

  const outgoing = direction === "Out";
  const title = realizationOf(doc.transaction_type).title;
  const funding = `${input.requestNo} — ${doc.transaction_no} — ${title}`;

  // The induk: cash against its bridge. Money paid out for the anak is a claim
  // on it; money taken in on the anak's behalf is money held for it.
  const indukBridge: JournalLineInput = {
    ...cash,
    accountId: outgoing ? input.bridge.induk.arAccountId : input.bridge.induk.apAccountId,
    debit: cash.credit,
    credit: cash.debit,
    description: funding,
  };
  const indukCash: JournalLineInput = {
    ...cash,
    description: `${funding} — ${cash.description}`,
  };

  // The anak: its own payable (or receivable) where its cash line would be,
  // then each Budget exactly as a direct Realisasi journals it.
  const anakBridge: JournalLineInput = {
    ...cash,
    accountId: outgoing ? input.bridge.anak.apAccountId : input.bridge.anak.arAccountId,
    description: funding,
  };

  return {
    ok: true,
    plan: {
      transactionId: doc.id,
      indukCompanyId: induk.id,
      anakCompanyId: doc.company_id,
      cashBankId: input.cash.cashBankId,
      direction,
      documentCurrencyLabel: documentCurrency,
      resourceCurrencyLabel: resourceCurrency,
      date: dated.date,
      currencyId: doc.currency_id,
      transactionNo: doc.transaction_no,
      title,
      requestNo: input.requestNo,
      providerSource: input.providerSource,
      requesterSource: { docTypeId: await transactionDocTypeId(), docId: doc.id },
      posting,
      indukJournal: outgoing ? [indukBridge, indukCash] : [indukCash, indukBridge],
      anakJournal: [anakBridge, ...(await counterJournalLines(doc, posting))],
      lines: doc.lines.map((l) => ({
        budgetId: l.source_doc_id,
        amount: l.settlement_amount.toNumber(),
      })),
    },
  };
}

/**
 * Money leaving the resource, refused here when the day it is dated on, or any
 * day since, would leave less than nothing. The dry run stops before the book
 * is written, so without this a preview would pass a Post that then refuses.
 * The lines are entries on one day, so their total is the whole question.
 */
async function cashShortfall(
  cashBankId: number,
  direction: string,
  date: string,
  plan: { lines: { accountAmount: number }[] }
): Promise<{ ok: false; errors: { _form: string } } | null> {
  if (direction !== "Out") return null;
  const total = plan.lines.reduce((sum, l) => sum + l.accountAmount, 0);
  const short = await cashBankShortfall(cashBankId, date, total);
  return short ? { ok: false, errors: { _form: short.message } } : null;
}

/**
 * Writes both Companies' books, inside the caller's transaction — the same
 * writes a direct Post makes, with the cash on the induk's resource and the
 * journal split in two.
 *
 * `postJournal` throws rather than returns, and so do the layer, the cash book
 * and the subject book when what the plan valued has moved; any of them takes
 * the whole confirmation down, the caller's request closure included.
 * `isPostingRefusal` tells the caller which throws are refusals.
 *
 * Neither journal derives from the other, and neither derives from a book: they
 * are two accounting representations of one business event, each pointing at
 * the document its own Company produced (§31).
 */
export async function writeFundedPosting(
  tx: Prisma.TransactionClient,
  plan: FundedPostingPlan,
  actorId: number
): Promise<{ closed: number }> {
  const { date } = plan;
  const postingDate = new Date(`${date}T00:00:00Z`);

  // Both Companies' years, held against a close and re-asked under the hold;
  // then every position the anak's lines lower.
  await holdPostingPeriod(tx, [plan.indukCompanyId, plan.anakCompanyId], date);
  await lockPlanPositions(tx, plan.posting, plan.currencyId);

  await writeRealizationLines(tx, plan.posting, {
    cashBankId: plan.cashBankId,
    direction: plan.direction,
    documentCurrencyLabel: plan.documentCurrencyLabel,
    resourceCurrencyLabel: plan.resourceCurrencyLabel,
    currencyId: plan.currencyId,
    docTypeId: plan.requesterSource.docTypeId,
    docId: plan.requesterSource.docId,
    date,
    actorId,
  });

  const { closed } = await realizeBudgets(tx, plan.lines, actorId);

  // Journal A — the induk's. Its cause is the Funding Request it confirmed.
  await postJournal(tx, {
    companyId: plan.indukCompanyId,
    postingDate,
    description: `${plan.requestNo} — ${plan.transactionNo} — ${plan.title}`,
    sourceDocTypeId: plan.providerSource.docTypeId,
    sourceDocId: plan.providerSource.docId,
    lines: plan.indukJournal,
    actorId,
  });

  // Journal B — the anak's. Its cause is its own realization, which is an
  // ordinary Realisasi that happened to be funded (§10 rule 60).
  await postJournal(tx, {
    companyId: plan.anakCompanyId,
    postingDate,
    description: `${plan.transactionNo} — ${plan.title}`,
    sourceDocTypeId: plan.requesterSource.docTypeId,
    sourceDocId: plan.requesterSource.docId,
    lines: plan.anakJournal,
    actorId,
  });

  await tx.finCashBankTransaction.update({
    where: { id: plan.transactionId },
    data: {
      status: "Posted",
      document_date: postingDate,
      posting_date: new Date(),
      exchange_rate: plan.posting.rate,
      transaction_base_amount: plan.posting.base,
      updated_by: actorId,
    },
  });
  // Posted, but by the induk confirming rather than by this document's own Post
  // button — the history says which, because for the anak those are different
  // events with different hands on them.
  await auditTransaction(tx, plan.transactionId, "post_funded", actorId);

  return { closed };
}

/**
 * Whether a throw out of a posting transaction is a refusal the user can act
 * on — a year closed meanwhile, a layer or an open item moved since the plan
 * valued it, a resource that does not hold enough — rather than a fault. The
 * funded route's caller lives in another module, so it asks here instead of
 * naming every book's error class itself.
 */
export function isPostingRefusal(error: unknown): error is Error {
  return (
    error instanceof PeriodShut ||
    error instanceof LayerNotAvailable ||
    error instanceof SubledgerItemUnavailable ||
    error instanceof InsufficientFunds
  );
}

// -------------------------------------------------- status, for the funded route

/**
 * The two status writes the funded route needs, and the only way another module
 * changes a document's status.
 *
 * `fin_cash_bank_transaction` is Finance's table, so Funding never writes it
 * directly (CLAUDE.md §3, the module contract): it calls these inside its own
 * transaction, which is what lets the document's status and the request's
 * status move together or not at all.
 *
 * Neither moves money. `Pending` is exactly as inert as `Draft` — the anak's
 * document waits for the induk's confirmation, and it is that confirmation, not
 * this, that writes the books.
 */
export async function markTransactionPending(
  tx: Prisma.TransactionClient,
  transactionId: number,
  actorId: number
): Promise<void> {
  await tx.finCashBankTransaction.update({
    where: { id: transactionId },
    data: { status: "Pending", updated_by: actorId },
  });
  await auditTransaction(tx, transactionId, "submit", actorId);
}

export async function markTransactionCancelled(
  tx: Prisma.TransactionClient,
  transactionId: number,
  actorId: number
): Promise<void> {
  await tx.finCashBankTransaction.update({
    where: { id: transactionId },
    data: { status: "Cancelled", updated_by: actorId },
  });
  await auditTransaction(tx, transactionId, "cancel", actorId);
}

/**
 * A status write that another module triggers still belongs in the document's
 * own history.
 *
 * It is written here rather than by the caller for the same reason the status
 * is: fin_cash_bank_transaction is Finance's table, and the row has to move in
 * the same transaction as the status it describes — otherwise a rolled-back
 * funding would leave a history entry for something that never happened.
 */
async function auditTransaction(
  tx: Prisma.TransactionClient,
  transactionId: number,
  event: string,
  actorId: number
): Promise<void> {
  await tx.auditLog.create({
    data: {
      entity_key: "fin_cash_bank_transaction",
      row_id: transactionId,
      action: "UPDATE",
      event,
      by: actorId,
    },
  });
}

/**
 * Documents by id — how another module reads the realizations it points at
 * without naming `fin_cash_bank_transaction` itself.
 */
export async function transactionsByIds(
  ids: number[]
): Promise<TransactionRow[]> {
  if (!ids.length) return [];
  const rows = await prisma.finCashBankTransaction.findMany({
    where: { id: { in: ids } },
    include: { _count: { select: { lines: true } } },
  });
  return rows.map(toRow);
}

// --------------------------------------------------------------- numbering

/**
 * Document numbers for a set of ids — how another module names a transaction
 * it holds a reference to, without reading `fin_cash_bank_transaction` itself.
 */
export async function transactionNumbersByIds(
  ids: number[]
): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.finCashBankTransaction.findMany({
    where: { id: { in: ids } },
    select: { id: true, transaction_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.transaction_no]));
}

/**
 * Next document number in the direction's own series — `RBM-0001` for a
 * Realisasi Penerimaan, `RBK-0001` for a Realisasi Pengeluaran. The format
 * lives in `document-number.ts`, the prefixes in `realization.ts`.
 */
export async function nextTransactionNo(direction: "In" | "Out"): Promise<string> {
  const prefix = realizationOf(direction).prefix;
  return nextDocumentNumber(prefix, async () => {
    const row = await prisma.finCashBankTransaction.findFirst({
      where: { transaction_no: { startsWith: `${prefix}-` } },
      orderBy: { id: "desc" },
      select: { transaction_no: true },
    });
    return row?.transaction_no ?? null;
  });
}

// ------------------------------------------------------------- KPI summary

export type TransactionSummary = {
  draft: number;
  draftTotals: MoneyTotal[];
  posted: number;
  inTotals: MoneyTotal[];
  outTotals: MoneyTotal[];
};

/** The KPI row, per currency — amounts are never converted (CLAUDE.md §12). */
export async function summariseTransactions(
  rows: TransactionRow[]
): Promise<TransactionSummary> {
  const currencies = await prisma.refCurrency.findMany({
    select: { id: true, currency_label: true },
  });
  const labelOf = new Map(currencies.map((c) => [c.id, c.currency_label]));
  const money = (t: TransactionRow) => ({
    currencyId: t.currency_id,
    currencyLabel: labelOf.get(t.currency_id) ?? "",
    amount: t.transaction_amount,
  });

  const drafts = rows.filter((t) => t.status === "Draft");
  const posted = rows.filter((t) => t.status === "Posted");

  return {
    draft: drafts.length,
    draftTotals: sumByCurrency(drafts.map(money)),
    posted: posted.length,
    inTotals: sumByCurrency(
      posted.filter((t) => t.transaction_type === "In").map(money)
    ),
    outTotals: sumByCurrency(
      posted.filter((t) => t.transaction_type === "Out").map(money)
    ),
  };
}

// ---------------------------------------------------- pending commitments

/**
 * A document frozen at `Pending`: the anak has asked for the money and the
 * induk has not yet confirmed. Draft documents are deliberately not here — a
 * draft is a preparation document that may never happen, and its claim on a
 * Budget is released simply by deleting a line, so it commits nothing.
 */
export type PendingDocumentRow = {
  id: number;
  transactionNo: string;
  companyId: number;
  companyLabel: string;
  currencyId: number;
  currencyLabel: string;
  transactionType: "In" | "Out";
  amount: number;
  lineCount: number;
  /** When the document was submitted — `Pending` is written once and frozen. */
  since: string;
};

export type PendingCommitments = {
  count: number;
  totals: MoneyTotal[];
  inTotals: MoneyTotal[];
  outTotals: MoneyTotal[];
  rows: PendingDocumentRow[];
  /**
   * Budget id -> how much of it a pending document has already claimed.
   *
   * This is what stops the dashboard counting the same money twice.
   * `realized_amount` is written at Post, so a Budget behind a pending
   * document still reports its whole outstanding — and that outstanding is
   * simultaneously sitting in this queue, waiting on the induk. The caller
   * subtracts one from the other.
   */
  claims: Map<number, number>;
};

export async function pendingCommitments(
  companyIds: number[]
): Promise<PendingCommitments> {
  const empty: PendingCommitments = {
    count: 0,
    totals: [],
    inTotals: [],
    outTotals: [],
    rows: [],
    claims: new Map(),
  };
  if (!companyIds.length) return empty;

  const docs = await prisma.finCashBankTransaction.findMany({
    where: { status: "Pending", company_id: { in: companyIds } },
    include: {
      company: { select: { company_label: true } },
      currency: { select: { currency_label: true } },
      _count: { select: { lines: true } },
    },
  });
  if (!docs.length) return empty;

  const budgetDocType = await budgetDocTypeId();
  const lines = await prisma.finCashBankTransactionLine.findMany({
    where: {
      transaction_id: { in: docs.map((d) => d.id) },
      source_doc_type_id: budgetDocType,
    },
    select: { source_doc_id: true, settlement_amount: true },
  });

  const claims = new Map<number, number>();
  for (const l of lines) {
    claims.set(
      l.source_doc_id,
      (claims.get(l.source_doc_id) ?? 0) + l.settlement_amount.toNumber()
    );
  }

  const rows: PendingDocumentRow[] = docs.map((t) => ({
    id: t.id,
    transactionNo: t.transaction_no,
    companyId: t.company_id,
    companyLabel: t.company.company_label,
    currencyId: t.currency_id,
    currencyLabel: t.currency.currency_label,
    transactionType: t.transaction_type as "In" | "Out",
    amount: t.transaction_amount.toNumber(),
    lineCount: t._count.lines,
    since: t.updated_at.toISOString(),
  }));

  const money = (r: PendingDocumentRow) => ({
    currencyId: r.currencyId,
    currencyLabel: r.currencyLabel,
    amount: r.amount,
  });

  return {
    count: rows.length,
    totals: sumByCurrency(rows.map(money)),
    inTotals: sumByCurrency(
      rows.filter((r) => r.transactionType === "In").map(money)
    ),
    outTotals: sumByCurrency(
      rows.filter((r) => r.transactionType === "Out").map(money)
    ),
    rows: rows.sort((a, b) => a.since.localeCompare(b.since)),
    claims,
  };
}

/**
 * The journal Post would write for this document, named for a reader — or
 * the refusal Post would give. Writes nothing.
 */
export async function previewPosting(
  transactionId: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const result = await applyPosting(transactionId, 0, true);
  if (!result.ok) return result;
  return { ok: true, lines: await describeJournalLines(result.journal ?? []) };
}
