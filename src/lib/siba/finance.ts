import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { sumByCurrency, type MoneyTotal } from "@/lib/format";
import {
  budgetsByIds,
  openBudgetsMatching,
  realizeBudgets,
} from "./budget";
import { recordCashBankEntry } from "./cash-bank";
import { isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { postJournal, type JournalLineInput } from "./journal";
import { PURPOSES, purposeOf, type Purpose } from "./rules";
import { subledgerForCategory } from "./subledger-catalogue";
import { recordSubledgerEntry } from "./subledger";
import type { TransactionStatus } from "./transaction-workflow";

/**
 * Finance reads and the rules a Cash Bank Transaction is held to.
 *
 * Finance is the execution layer (concept doc §2.2, §9): Budget plans, Finance
 * executes. A document's **header** — Purpose, Company, Partner, Cash & Bank —
 * is the context that decides which approved Budgets it may realize, and its
 * **lines** are the realization itself. One document can realize several
 * Budgets, and one Budget can be realized by several documents (§10).
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
  purpose: string;
  cash_bank_id: number | null;
  currency_id: number;
  partner_id: number | null;
  transaction_amount: number;
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
};

type TxRecord = {
  id: number;
  transaction_no: string;
  document_date: Date | null;
  posting_date: Date | null;
  transaction_type: string;
  company_id: number;
  purpose: string;
  cash_bank_id: number | null;
  currency_id: number;
  partner_id: number | null;
  transaction_amount: { toNumber(): number };
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
    purpose: t.purpose,
    cash_bank_id: t.cash_bank_id,
    currency_id: t.currency_id,
    partner_id: t.partner_id,
    transaction_amount: t.transaction_amount.toNumber(),
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
  companyIds: number[]
): Promise<TransactionRow[]> {
  // Every document belongs to the induk today (§12), so a user holding induk
  // access sees exactly what they did before. What this adds is the other
  // half: a user without it sees none, and the list is already right when
  // Funding Request brings the anak into Finance.
  const rows = await prisma.finCashBankTransaction.findMany({
    where: { company_id: { in: companyIds } },
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
  });
  if (!lines.length) return [];

  const budgets = await budgetsByIds(lines.map((l) => l.source_doc_id));
  const byId = new Map(budgets.map((b) => [b.id, b]));

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
    purpose: string;
    amount: number;
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
    purpose: l.transaction.purpose,
    amount: l.settlement_amount.toNumber(),
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
};

export type TransactionHeader = {
  purpose: string;
  company_id: number | null;
  partner_id: number | null;
  cash_bank_id: number | null;
  /**
   * Only read on the funded route, where there is no resource to take a
   * currency from. On the self-funded route the Cash & Bank decides it and a
   * submitted value is ignored.
   */
  currency_id?: number | null;
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

  if (route === "treasury") {
    if (header.cash_bank_id) return { ok: false };
    const currencyId = header.currency_id ?? 0;
    if (!currencyId) return { ok: false };
    return { ok: true, route, currencyId, cashBankId: null };
  }

  if (!header.cash_bank_id) return { ok: false };
  const cashBank = await prisma.mCashBank.findUnique({
    where: { id: header.cash_bank_id },
    select: { currency_id: true, company_id: true },
  });
  if (!cashBank || cashBank.company_id !== header.company_id) {
    return { ok: false };
  }
  return {
    ok: true,
    route,
    currencyId: cashBank.currency_id,
    cashBankId: header.cash_bank_id,
  };
}

/** The Budget Category id a purpose realizes, or null if the label is unknown. */
async function categoryIdOf(purpose: Purpose): Promise<number | null> {
  const row = await prisma.sysBudgetCategory.findFirst({
    where: { category_label: purpose.budgetCategory },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * The Budgets one header may realize — concept doc §9, in full.
 *
 * A Budget is eligible when it is **Open** (approved, so it carries a
 * classification), belongs to the same Company, points the same way as the
 * Purpose, carries the Budget Category the Purpose resolves to, names the
 * header's Partner where the Purpose takes one, is denominated in the Cash &
 * Bank's own currency, and still has something outstanding.
 *
 * Budget Date is deliberately *not* a filter: §9 says the month is a reporting
 * dimension (early or late realization), never a gate. A document in September
 * may settle an August plan.
 *
 * Currency is a filter because there is no exchange rate in this system: a
 * USD resource cannot settle an IDR plan without inventing one (CLAUDE.md §12).
 */
export async function eligibleBudgets(
  header: TransactionHeader,
  options: { excludeTransactionId?: number } = {}
): Promise<EligibleBudget[]> {
  const purpose = purposeOf(header.purpose);
  if (!purpose || !header.company_id) return [];
  if (purpose.partnerCategory && !header.partner_id) return [];

  const context = await headerContext(header);
  if (!context.ok) return [];

  const categoryId = await categoryIdOf(purpose);
  if (!categoryId) return [];

  const budgets = await openBudgetsMatching({
    companyId: header.company_id,
    budgetType: purpose.direction,
    categoryId,
    currencyId: context.currencyId,
    partnerId: purpose.partnerCategory ? header.partner_id : null,
  });

  const outstanding = budgets
    .map((b) => ({ row: b, left: b.budget_amount - b.realized_amount }))
    .filter((x) => x.left > 0);
  if (!outstanding.length) return [];

  const draftAllocated = await draftAllocations(
    outstanding.map((x) => x.row.id),
    options.excludeTransactionId ?? null
  );

  return outstanding.map(({ row, left }) => ({
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
      purpose: Purpose;
      companyId: number;
      /** Null on the funded route: the anak has no resource of its own. */
      cashBankId: number | null;
      currencyId: number;
      partnerId: number | null;
      route: FundingRoute;
    }
  | { ok: false; errors: Record<string, string> };

/**
 * The document header, checked against every rule at once.
 *
 * The form narrows each picker as the user goes, but a Server Action is
 * reachable directly with any combination of ids — this is what actually
 * enforces the chain Purpose -> Company -> Partner -> Cash & Bank.
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

  const purpose = purposeOf(header.purpose);
  if (!purpose) {
    return {
      ok: false,
      errors: { purpose: "Transaction Purpose wajib dipilih." },
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
  if (!header.company_id) {
    errors.company_id = "Company wajib dipilih.";
  } else {
    route = await fundingRoute(header.company_id);
    if (!route) errors.company_id = "Company tidak ditemukan.";
  }

  let partnerId: number | null = null;
  if (purpose.partnerCategory) {
    if (!header.partner_id) {
      errors.partner_id = "Purpose ini mensyaratkan Partner.";
    } else {
      const partner = await prisma.mPartner.findUnique({
        where: { id: header.partner_id },
        select: {
          company_id: true,
          status: true,
          category: { select: { category_label: true } },
        },
      });
      if (!partner) errors.partner_id = "Partner tidak ditemukan.";
      else if (partner.company_id !== header.company_id) {
        errors.partner_id = "Partner harus milik Company yang sama.";
      } else if (partner.status !== "Active") {
        errors.partner_id = "Partner tersebut non-aktif dan tidak dapat dipilih.";
      } else if (partner.category.category_label !== purpose.partnerCategory) {
        errors.partner_id = `Purpose ini hanya menerima Partner berkategori ${purpose.partnerCategory}.`;
      } else {
        partnerId = header.partner_id;
      }
    }
  } else if (header.partner_id) {
    // A purpose that takes no subject must not carry one, or a later subledger
    // would be opened against a partner the classification never meant.
    errors.partner_id = "Purpose yang dipilih tidak memakai Partner.";
  }

  let currencyId = 0;
  let cashBankId: number | null = null;

  if (route === "treasury") {
    if (header.cash_bank_id) {
      errors.cash_bank_id =
        "Company anak tidak memiliki Cash & Bank sendiri. Dana disediakan " +
        "Company induk melalui Funding Request.";
    }
    if (!header.currency_id) {
      errors.currency_id = "Currency wajib dipilih.";
    } else {
      const currency = await prisma.refCurrency.findUnique({
        where: { id: header.currency_id },
        select: { id: true, status: true },
      });
      if (!currency) errors.currency_id = "Currency tidak ditemukan.";
      else if (currency.status !== "Active") {
        errors.currency_id = "Currency tersebut non-aktif dan tidak dapat dipakai.";
      } else {
        currencyId = currency.id;
      }
    }
  } else if (route === "self") {
    if (!header.cash_bank_id) {
      errors.cash_bank_id = "Cash & Bank wajib dipilih.";
    } else {
      const cashBank = await prisma.mCashBank.findUnique({
        where: { id: header.cash_bank_id },
        select: { company_id: true, status: true, currency_id: true },
      });
      if (!cashBank) errors.cash_bank_id = "Cash & Bank tidak ditemukan.";
      else if (cashBank.company_id !== header.company_id) {
        errors.cash_bank_id =
          "Cash & Bank harus milik Company yang sama dengan dokumen.";
      } else if (cashBank.status !== "Active") {
        errors.cash_bank_id =
          "Cash & Bank tersebut non-aktif dan tidak dapat dipakai.";
      } else {
        currencyId = cashBank.currency_id;
        cashBankId = cashBank ? header.cash_bank_id : null;
      }
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    purpose,
    companyId: header.company_id!,
    cashBankId,
    currencyId,
    partnerId,
    route: route!,
  };
}

export type LineInput = { budget_id: number; amount: number };

export type LineCheck =
  | { ok: true; lines: { budgetId: number; amount: number; outstanding: number }[]; total: number }
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
  const wanted = lines.filter((l) => l.amount > 0);
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

  const resolved: { budgetId: number; amount: number; outstanding: number }[] = [];
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
    resolved.push({
      budgetId: budget.id,
      amount: l.amount,
      outstanding: budget.outstanding,
    });
  }

  return {
    ok: true,
    lines: resolved,
    total: resolved.reduce((t, l) => t + l.amount, 0),
  };
}

// ------------------------------------------------------------------ posting

export type PostingResult =
  | { ok: true; closed: number }
  | { ok: false; errors: Record<string, string> };

/**
 * The kurs a posting values its movements at.
 *
 * The books now carry a base measure, and every entry has to state the rate it
 * was valued at — but the machinery that produces a real rate does not exist
 * yet. There is no rate field on the document, no layer to read one off, and
 * nothing that could tell what a dollar was worth on the day it moved.
 *
 * So a base-currency document posts at `1`, which is true, and a foreign one is
 * **refused by name** rather than posted at a rate somebody invented. Writing
 * `1` for a USD document would record that a dollar is a rupiah, and it would
 * record it in an append-only book that cannot be corrected by editing.
 *
 * This refusal is temporary and has a named end: it comes out when the document
 * carries its own kurs and a payment draws on a layer.
 */
async function postingRate(
  currencyId: number
): Promise<
  { ok: true; rate: number } | { ok: false; errors: Record<string, string> }
> {
  const currency = await prisma.refCurrency.findUnique({
    where: { id: currencyId },
    select: { currency_label: true },
  });
  if (!currency) {
    return { ok: false, errors: { _form: "Currency dokumen tidak ditemukan." } };
  }
  if (!isBaseCurrency(currency.currency_label)) {
    return {
      ok: false,
      errors: {
        _form:
          `Dokumen dalam ${currency.currency_label} belum dapat diposting: ` +
          "pencatatan nilai kurs terhadap mata uang dasar belum tersedia. " +
          "Gunakan dokumen dalam mata uang dasar untuk sementara.",
      },
    };
  }
  return { ok: true, rate: 1 };
}

/**
 * Post: the actual boundary (concept doc §2.3).
 *
 * Three writes, one database transaction — either the money moved and every
 * book that must know about it does, or nothing happened at all:
 *
 *   1. the **Cash Bank Book** gets an entry, and its materialised balance moves
 *      with it, in the same transaction (`recordCashBankEntry`);
 *   2. every Budget on the document has its `realized_amount` raised, and a
 *      Budget that reaches its planned amount closes itself (§6.5);
 *   3. the document acquires its document and posting dates and becomes Posted.
 *
 * The book is written **straight from the document**, never derived from a
 * journal line: operational books are independent historical stores, and only
 * the General Ledger derives from journals (§2.5, §11.7). The Journal and the
 * General Ledger are the next scope and are deliberately absent here.
 *
 * Budgets are re-read *now* rather than trusted from when the document was
 * drafted: another document may have closed one in the meantime, and posting
 * against a plan that is no longer Open would record a realization nothing
 * authorised.
 *
 * Lives here rather than inside the Server Action so the rule is testable: the
 * action resolves a caller and then calls this, and the test suite calls the
 * same function.
 */
/**
 * The accounting entries a Cash Bank Transaction produces.
 *
 * Two sides, which is what a cash document is: the Cash & Bank resource's own
 * account, and the account its Purpose resolves to through the Company x Budget
 * Category x Partner Category mapping. Direction decides which side each falls
 * on — money in debits cash and credits the counterpart, money out does the
 * reverse.
 *
 * One counter line per document line rather than one aggregated line: every
 * line realizes a named Budget, and keeping them apart is what lets a ledger
 * entry be read back to the plan it settled. They share an account, so the
 * journal balances either way.
 */
/**
 * The account a Purpose resolves to for one Company — Company × Budget Category
 * × Partner Category, which is the whole reason a Purpose is exactly one of
 * each (§19).
 *
 * Resolved **per Company**, not once per document: on the funded route the
 * induk and the anak journal the same business event against their own charts,
 * and only the anak's side is classified by the Purpose at all.
 */
async function purposeAccountId(
  companyId: number,
  purpose: Purpose
): Promise<
  { ok: true; accountId: number } | { ok: false; errors: Record<string, string> }
> {
  const categoryId = await categoryIdOf(purpose);
  if (!categoryId) {
    return { ok: false, errors: { _form: "Budget Category Purpose tidak dikenali." } };
  }

  const partnerCategoryId = purpose.partnerCategory
    ? (
        await prisma.sysPartnerCategory.findFirst({
          where: { category_label: purpose.partnerCategory },
          select: { id: true },
        })
      )?.id ?? null
    : null;

  const mapping = await prisma.accBudgetCategoryAccount.findFirst({
    where: {
      company_id: companyId,
      budget_category_id: categoryId,
      partner_category_id: partnerCategoryId,
    },
    select: { account_id: true },
  });
  if (!mapping) {
    // Approval tolerates a missing mapping (§10 rule 28) because that gap
    // belongs to Accounting. Posting cannot: without a mapping there is no
    // account to journal against, and money must not move unaccounted for.
    return {
      ok: false,
      errors: {
        _form:
          `Belum ada Mapping Budget ke Account untuk kombinasi ini (${purpose.label}). ` +
          "Lengkapi mapping di Accounting sebelum dokumen diposting.",
      },
    };
  }

  return { ok: true, accountId: mapping.account_id };
}

async function journalEntries(
  doc: {
    id: number;
    transaction_no: string;
    purpose: string;
    company_id: number;
    partner_id: number | null;
    cash_bank_id: number | null;
    transaction_type: string;
    transaction_amount: { toNumber(): number };
    lines: { source_doc_id: number; settlement_amount: { toNumber(): number } }[];
  },
  /** The kurs both sides of this journal are valued at. */
  rate: number
): Promise<
  | { ok: true; lines: JournalLineInput[]; purposeLabel: string }
  | { ok: false; errors: Record<string, string> }
> {
  const purpose = purposeOf(doc.purpose);
  if (!purpose) {
    return { ok: false, errors: { _form: "Purpose dokumen tidak dikenali." } };
  }

  const cashBank = await prisma.mCashBank.findUnique({
    where: { id: doc.cash_bank_id! },
    select: {
      account_id: true,
      currency_id: true,
      cash_bank_label: true,
      account: { select: { account_label: true } },
    },
  });
  if (!cashBank) {
    return { ok: false, errors: { _form: "Cash & Bank dokumen tidak ditemukan." } };
  }

  const mapped = await purposeAccountId(doc.company_id, purpose);
  if (!mapped.ok) return mapped;
  const mapping = { account_id: mapped.accountId };

  const incoming = doc.transaction_type === "In";
  const total = doc.lines.reduce((t, l) => t + l.settlement_amount.toNumber(), 0);

  const lines: JournalLineInput[] = [
    {
      accountId: cashBank.account_id,
      currencyId: cashBank.currency_id,
      rate,
      debit: incoming ? total : 0,
      credit: incoming ? 0 : total,
      description: `${doc.transaction_no} — ${cashBank.cash_bank_label}`,
    },
    ...doc.lines.map((l) => ({
      accountId: mapping.account_id,
      partnerId: doc.partner_id,
      currencyId: cashBank.currency_id,
      rate,
      debit: incoming ? 0 : l.settlement_amount.toNumber(),
      credit: incoming ? l.settlement_amount.toNumber() : 0,
      description: `${purpose.label} — Budget #${l.source_doc_id}`,
    })),
  ];

  return { ok: true, lines, purposeLabel: purpose.label };
}

export async function applyPosting(
  transactionId: number,
  actorId: number
): Promise<PostingResult> {
  const doc = await prisma.finCashBankTransaction.findUnique({
    where: { id: transactionId },
    include: { lines: true },
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

  const today = new Date().toISOString().slice(0, 10);
  const docTypeId = await transactionDocTypeId();
  let closed = 0;

  // Both resolved before the transaction opens, so a document that cannot be
  // journalled or cannot be valued refuses rather than aborting halfway: a
  // posting that moves the book without writing accounting is exactly the
  // split §12 forbids.
  const valuation = await postingRate(doc.currency_id);
  if (!valuation.ok) return { ok: false, errors: valuation.errors };

  const entries = await journalEntries(doc, valuation.rate);
  if (!entries.ok) return { ok: false, errors: entries.errors };

  // Which subject book this document's Purpose writes into, if any. Resolved
  // from the catalogue rather than from a table: a book is a screen somebody
  // wrote (CLAUDE.md §12, subledger catalogue).
  const subledger = subledgerForCategory(
    purposeOf(doc.purpose)?.budgetCategory ?? null
  );

  await prisma.$transaction(async (tx) => {
    await recordCashBankEntry(tx, {
      cashBankId: doc.cash_bank_id!,
      date: today,
      type: "Transaction",
      direction: doc.transaction_type as "In" | "Out",
      amount: doc.transaction_amount.toNumber(),
      rate: valuation.rate,
      sourceDocTypeId: docTypeId,
      sourceDocId: doc.id,
      note: doc.transaction_no,
      actorId,
    });

    // The subject book, where the document's Budget Category keeps one. A
    // Partner's position is its own historical store (concept doc §11, §13),
    // written straight from this document like the Cash Bank Book above and
    // never derived from the journal below. One entry per document rather than
    // per line: the subject moved once, and which Budgets that settled is what
    // the document itself and the journal's counter lines record.
    //
    // Asset and Biaya name no Partner and keep no book, so they simply produce
    // no entry — the Cash Bank Book and the Journal still record the movement.
    if (subledger && doc.partner_id) {
      await recordSubledgerEntry(tx, {
        book: subledger.key,
        partnerId: doc.partner_id,
        currencyId: doc.currency_id,
        date: today,
        type: "Transaction",
        direction: doc.transaction_type as "In" | "Out",
        amount: doc.transaction_amount.toNumber(),
        // The book's own rate. Identical to the cash side's only because both
        // are base currency today; once a position carries a rate of its own,
        // a relief releases at that rate and the two diverge.
        rate: valuation.rate,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        note: `${doc.transaction_no} — ${entries.purposeLabel}`,
        actorId,
      });
    }

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
      description: `${doc.transaction_no} — ${entries.purposeLabel}`,
      sourceDocTypeId: docTypeId,
      sourceDocId: doc.id,
      lines: entries.lines,
      actorId,
    });

    await tx.finCashBankTransaction.update({
      where: { id: transactionId },
      data: {
        status: "Posted",
        document_date: new Date(`${today}T00:00:00Z`),
        posting_date: new Date(),
        updated_by: actorId,
      },
    });
  });

  return { ok: true, closed };
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

export type FundedPostingInput = {
  transactionId: number;
  /** The induk resource the money actually moves through. */
  providerCashBankId: number;
  bridge: { induk: BridgeSide; anak: BridgeSide };
  /**
   * What the **provider's** journal records as its cause — the Funding Request.
   * Passed in rather than resolved here: the Funding Request belongs to the
   * module that owns it, and Finance must not name its table.
   */
  providerSource: { docTypeId: number; docId: number };
  /** Carried onto every book entry, so a row reads back to the request. */
  note: string;
};

export type FundedPostingPlan = {
  transactionId: number;
  /** Everything below is resolved and checked; writing it cannot fail on rules. */
  induk: {
    companyId: number;
    cashBankId: number;
    cashAccountId: number;
    bridgeAccountId: number;
  };
  anak: {
    companyId: number;
    purposeAccountId: number;
    /** The subject book the Purpose itself keeps, where it keeps one. */
    purposeBook: string | null;
    purposePartnerId: number | null;
    bridgeAccountId: number;
  };
  direction: "In" | "Out";
  currencyId: number;
  amount: number;
  /** The kurs both Companies' books value this movement at. */
  rate: number;
  transactionNo: string;
  purposeLabel: string;
  note: string;
  providerSource: { docTypeId: number; docId: number };
  requesterSource: { docTypeId: number; docId: number };
  lines: { budgetId: number; amount: number }[];
};

export type FundedPostingCheck =
  | { ok: true; plan: FundedPostingPlan }
  | { ok: false; errors: Record<string, string> };

/**
 * Everything the funded posting needs, resolved and checked before anything is
 * written — the atomic intercompany posting of concept doc §30, in two halves.
 *
 * The split exists because the Funding Request's own closure belongs to the
 * module that owns it: `prepareFundedPosting` answers "may this be posted, and
 * with what", `writeFundedPosting` does it inside the caller's transaction, and
 * the caller closes its request in the same one. Either both Companies got
 * their books and the request is closed, or nothing happened at all.
 *
 * **Both directions are one mechanism.** Money leaving the induk for the anak's
 * expense debits the induk's receivable from the anak and credits the anak's
 * payable to the induk; money the anak receives into an induk resource does the
 * mirror (§34, §37). Only which side of each bridge is written flips.
 *
 * The position itself is carried by those two accounts and read through the
 * General Ledger — **no subject book entry is written for the intercompany
 * leg**, because its subject would have to be a Partner and the other Company
 * is not one. The anak's *own* subject book is untouched by that: the partner
 * it actually paid or was paid by still gets its entry, because that is the
 * business event and the funding is only how the cash reached it.
 */
export async function prepareFundedPosting(
  input: FundedPostingInput
): Promise<FundedPostingCheck> {
  const doc = await prisma.finCashBankTransaction.findUnique({
    where: { id: input.transactionId },
    include: { lines: true },
  });
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

  const purpose = purposeOf(doc.purpose);
  if (!purpose) {
    return { ok: false, errors: { _form: "Purpose dokumen tidak dikenali." } };
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

  const cashBank = await prisma.mCashBank.findUnique({
    where: { id: input.providerCashBankId },
    select: {
      company_id: true,
      status: true,
      currency_id: true,
      account_id: true,
    },
  });
  if (!cashBank) {
    return { ok: false, errors: { cash_bank_id: "Cash & Bank tidak ditemukan." } };
  }
  if (cashBank.company_id !== induk.id) {
    return {
      ok: false,
      errors: {
        cash_bank_id: `Cash & Bank harus milik Company ${induk.label}.`,
      },
    };
  }
  if (cashBank.status !== "Active") {
    return {
      ok: false,
      errors: {
        cash_bank_id: "Cash & Bank tersebut non-aktif dan tidak dapat dipakai.",
      },
    };
  }
  if (cashBank.currency_id !== doc.currency_id) {
    // There is no exchange rate in this system (CLAUDE.md §12), so a resource
    // in another currency cannot answer this request without inventing one.
    return {
      ok: false,
      errors: {
        cash_bank_id:
          "Currency Cash & Bank harus sama dengan currency permintaan dana.",
      },
    };
  }

  // Both Companies' books value this movement, so both are refused together
  // when it cannot be valued at all.
  const valuation = await postingRate(doc.currency_id);
  if (!valuation.ok) return { ok: false, errors: valuation.errors };

  // Re-read now, not trusted from when the request was raised: another document
  // may have closed a Budget in the meantime, and funding a plan that is no
  // longer Open would record a realization nothing authorised.
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
          "kemungkinan sudah ditutup dokumen lain. Funding tidak dapat dikonfirmasi.",
      },
    };
  }

  // The anak journals its own side against its own chart of accounts.
  const mapped = await purposeAccountId(doc.company_id, purpose);
  if (!mapped.ok) return mapped;

  const outgoing = doc.transaction_type === "Out";
  const subledger = subledgerForCategory(purpose.budgetCategory);

  return {
    ok: true,
    plan: {
      transactionId: doc.id,
      induk: {
        companyId: induk.id,
        cashBankId: input.providerCashBankId,
        cashAccountId: cashBank.account_id,
        // Money paid out for the anak is a claim on it; money taken in on the
        // anak's behalf is money held for it.
        bridgeAccountId: outgoing
          ? input.bridge.induk.arAccountId
          : input.bridge.induk.apAccountId,
      },
      anak: {
        companyId: doc.company_id,
        purposeAccountId: mapped.accountId,
        purposeBook: subledger?.key ?? null,
        purposePartnerId: doc.partner_id,
        bridgeAccountId: outgoing
          ? input.bridge.anak.apAccountId
          : input.bridge.anak.arAccountId,
      },
      direction: doc.transaction_type as "In" | "Out",
      currencyId: doc.currency_id,
      amount: doc.transaction_amount.toNumber(),
      rate: valuation.rate,
      transactionNo: doc.transaction_no,
      purposeLabel: purpose.label,
      note: input.note,
      providerSource: input.providerSource,
      requesterSource: {
        docTypeId: await transactionDocTypeId(),
        docId: doc.id,
      },
      lines: doc.lines.map((l) => ({
        budgetId: l.source_doc_id,
        amount: l.settlement_amount.toNumber(),
      })),
    },
  };
}

/**
 * Writes both Companies' books, inside the caller's transaction.
 *
 * One business event, five writes (§30): the induk's cash entry and its
 * balance, the anak's own subject book where its Purpose keeps one, every
 * Budget's realization, a journal each, and the document itself.
 * `postJournal` throws rather than returns, so an unbalanced journal takes the
 * whole confirmation down — the caller's request closure included.
 *
 * The two Companies' positions against each other are in those journals and
 * nowhere else: they are accounts, not subjects (see `BridgeSide`).
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
  const today = new Date().toISOString().slice(0, 10);
  const { induk, anak } = plan;

  await recordCashBankEntry(tx, {
    cashBankId: induk.cashBankId,
    date: today,
    type: "Transaction",
    direction: plan.direction,
    amount: plan.amount,
    rate: plan.rate,
    // The realization is what caused the movement, so that is what the book
    // names — the same weak pair the direct route writes.
    sourceDocTypeId: plan.requesterSource.docTypeId,
    sourceDocId: plan.requesterSource.docId,
    note: plan.note,
    actorId,
  });

  // The anak's own subject book, where its Purpose keeps one — the partner it
  // actually paid or was paid by. Unchanged from the direct route: that is the
  // business event, and the funding is only how the cash reached it.
  if (anak.purposeBook && anak.purposePartnerId) {
    await recordSubledgerEntry(tx, {
      book: anak.purposeBook,
      partnerId: anak.purposePartnerId,
      currencyId: plan.currencyId,
      date: today,
      type: "Transaction",
      direction: plan.direction,
      amount: plan.amount,
      rate: plan.rate,
      sourceDocTypeId: plan.requesterSource.docTypeId,
      sourceDocId: plan.requesterSource.docId,
      note: `${plan.transactionNo} — ${plan.purposeLabel}`,
      actorId,
    });
  }

  const { closed } = await realizeBudgets(tx, plan.lines, actorId);

  const outgoing = plan.direction === "Out";

  // Journal A — the induk's. Its cause is the Funding Request it confirmed.
  await postJournal(tx, {
    companyId: induk.companyId,
    description: `${plan.note} — ${plan.purposeLabel}`,
    sourceDocTypeId: plan.providerSource.docTypeId,
    sourceDocId: plan.providerSource.docId,
    lines: [
      {
        accountId: induk.bridgeAccountId,
        currencyId: plan.currencyId,
        rate: plan.rate,
        debit: outgoing ? plan.amount : 0,
        credit: outgoing ? 0 : plan.amount,
        description: plan.note,
      },
      {
        accountId: induk.cashAccountId,
        currencyId: plan.currencyId,
        rate: plan.rate,
        debit: outgoing ? 0 : plan.amount,
        credit: outgoing ? plan.amount : 0,
        description: plan.note,
      },
    ],
    actorId,
  });

  // Journal B — the anak's. Its cause is its own realization, which is an
  // ordinary Cash Bank Transaction that happened to be funded. One counter line
  // per document line, as on the direct route, so a ledger entry reads back to
  // the Budget it settled.
  const purposeLines: JournalLineInput[] = plan.lines.map((l) => ({
    accountId: anak.purposeAccountId,
    partnerId: anak.purposePartnerId,
    currencyId: plan.currencyId,
    rate: plan.rate,
    debit: outgoing ? l.amount : 0,
    credit: outgoing ? 0 : l.amount,
    description: `${plan.purposeLabel} — Budget #${l.budgetId}`,
  }));
  const bridgeLine: JournalLineInput = {
    accountId: anak.bridgeAccountId,
    currencyId: plan.currencyId,
    rate: plan.rate,
    debit: outgoing ? 0 : plan.amount,
    credit: outgoing ? plan.amount : 0,
    description: plan.note,
  };

  await postJournal(tx, {
    companyId: anak.companyId,
    description: `${plan.transactionNo} — ${plan.purposeLabel}`,
    sourceDocTypeId: plan.requesterSource.docTypeId,
    sourceDocId: plan.requesterSource.docId,
    lines: outgoing
      ? [...purposeLines, bridgeLine]
      : [bridgeLine, ...purposeLines],
    actorId,
  });

  await tx.finCashBankTransaction.update({
    where: { id: plan.transactionId },
    data: {
      status: "Posted",
      document_date: new Date(`${today}T00:00:00Z`),
      posting_date: new Date(),
      updated_by: actorId,
    },
  });
  // Posted, but by the induk confirming rather than by this document's own Post
  // button — the history says which, because for the anak those are different
  // events with different hands on them.
  await auditTransaction(tx, plan.transactionId, "post_funded", actorId);

  return { closed };
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

/** Next document number, `CBT-0001`. The format lives in `document-number.ts`. */
export async function nextTransactionNo(): Promise<string> {
  return nextDocumentNumber("CBT", async () => {
    const row = await prisma.finCashBankTransaction.findFirst({
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

// ------------------------------------------------------------ purpose view

export type PurposeOption = {
  key: string;
  label: string;
  direction: "In" | "Out";
  budgetCategory: string;
  partnerCategory: string | null;
};

/** The 22 purposes as the form needs them — application logic, never a table. */
export function purposeOptions(): PurposeOption[] {
  return PURPOSES.map((p) => ({
    key: p.key,
    label: p.label,
    direction: p.direction,
    budgetCategory: p.budgetCategory,
    partnerCategory: p.partnerCategory,
  }));
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
  purposeLabel: string;
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
    purposeLabel: purposeOf(t.purpose)?.label ?? t.purpose,
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
