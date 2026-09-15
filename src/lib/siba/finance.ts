import "server-only";

import { prisma } from "@/lib/prisma";
import { sumByCurrency, type MoneyTotal } from "@/lib/format";
import { recordCashBankEntry } from "./cash-bank";
import { postJournal, type JournalLineInput } from "./journal";
import { PURPOSES, purposeOf, type Purpose } from "./rules";
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

  const budgets = await prisma.budBudget.findMany({
    where: { id: { in: lines.map((l) => l.source_doc_id) } },
  });
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
        budget_date: day(b.budget_date),
        description: b.description,
        category_id: b.category_id,
        partner_id: b.partner_id,
        budget_amount: b.budget_amount.toNumber(),
        realized_amount: b.realized_amount.toNumber(),
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

export type FinanceRefs = {
  companies: FinanceOption[];
  currencies: FinanceOption[];
  categories: FinanceOption[];
  partnerCategories: FinanceOption[];
  partners: FinancePartnerOption[];
  cashBanks: CashBankOption[];
  /** The induk. Every document in this scope belongs to it — see §12. */
  transactingCompanyId: number | null;
};

/**
 * Everything the finance pages need to render a reference as text, plus the
 * option sets the header picks from.
 *
 * Balances come from `cash_bank_balance` so the form can show what a resource
 * holds before the document moves it. They are display only: the Post action
 * re-reads the book inside its own transaction.
 */
export async function financeRefs(): Promise<FinanceRefs> {
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
 * The single Company a Cash Bank Transaction may be written for: the induk.
 *
 * The anak's realization does not go through this document at all — it raises a
 * **Funding Request** against the induk, which is a separate flow and a
 * separate scope (concept doc §23–§24, CLAUDE.md §13). Until that exists, a
 * document naming the anak would be a way to spend money the model says the
 * anak cannot spend directly, so the header is pinned to the induk and the
 * Server Action refuses anything else.
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
};

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
  if (!purpose || !header.company_id || !header.cash_bank_id) return [];
  if (purpose.partnerCategory && !header.partner_id) return [];

  const cashBank = await prisma.mCashBank.findUnique({
    where: { id: header.cash_bank_id },
    select: { currency_id: true, company_id: true },
  });
  if (!cashBank || cashBank.company_id !== header.company_id) return [];

  const categoryId = await categoryIdOf(purpose);
  if (!categoryId) return [];

  const budgets = await prisma.budBudget.findMany({
    where: {
      status: "Open",
      company_id: header.company_id,
      budget_type: purpose.direction,
      category_id: categoryId,
      currency_id: cashBank.currency_id,
      ...(purpose.partnerCategory ? { partner_id: header.partner_id } : {}),
    },
    orderBy: [{ budget_date: "asc" }, { id: "asc" }],
  });

  const outstanding = budgets
    .map((b) => ({
      row: b,
      left: b.budget_amount.toNumber() - b.realized_amount.toNumber(),
    }))
    .filter((x) => x.left > 0);
  if (!outstanding.length) return [];

  const draftAllocated = await draftAllocations(
    outstanding.map((x) => x.row.id),
    options.excludeTransactionId ?? null
  );

  return outstanding.map(({ row, left }) => ({
    id: row.id,
    budget_no: row.budget_no,
    budget_date: day(row.budget_date),
    description: row.description,
    category_id: row.category_id,
    partner_id: row.partner_id,
    currency_id: row.currency_id,
    budget_amount: row.budget_amount.toNumber(),
    realized_amount: row.realized_amount.toNumber(),
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
      cashBankId: number;
      currencyId: number;
      partnerId: number | null;
    }
  | { ok: false; errors: Record<string, string> };

/**
 * The document header, checked against every rule at once.
 *
 * The form narrows each picker as the user goes, but a Server Action is
 * reachable directly with any combination of ids — this is what actually
 * enforces the chain Purpose -> Company -> Partner -> Cash & Bank, and it is
 * where the induk-only scope is imposed.
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
  if (!header.company_id) {
    errors.company_id = "Company wajib dipilih.";
  } else if (header.company_id !== induk.id) {
    errors.company_id =
      "Dokumen kas/bank langsung hanya tersedia untuk Company induk. " +
      "Kebutuhan dana Company anak dipenuhi melalui Funding Request.";
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
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    purpose,
    companyId: header.company_id!,
    cashBankId: header.cash_bank_id!,
    currencyId,
    partnerId,
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
async function journalEntries(doc: {
  id: number;
  transaction_no: string;
  purpose: string;
  company_id: number;
  partner_id: number | null;
  cash_bank_id: number | null;
  transaction_type: string;
  transaction_amount: { toNumber(): number };
  lines: { source_doc_id: number; settlement_amount: { toNumber(): number } }[];
}): Promise<
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
      company_id: doc.company_id,
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

  const incoming = doc.transaction_type === "In";
  const total = doc.lines.reduce((t, l) => t + l.settlement_amount.toNumber(), 0);

  const lines: JournalLineInput[] = [
    {
      accountId: cashBank.account_id,
      currencyId: cashBank.currency_id,
      debit: incoming ? total : 0,
      credit: incoming ? 0 : total,
      description: `${doc.transaction_no} — ${cashBank.cash_bank_label}`,
    },
    ...doc.lines.map((l) => ({
      accountId: mapping.account_id,
      partnerId: doc.partner_id,
      currencyId: cashBank.currency_id,
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

  const budgets = await prisma.budBudget.findMany({
    where: { id: { in: doc.lines.map((l) => l.source_doc_id) } },
  });
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

  // Resolved before the transaction opens so a missing mapping refuses the
  // post rather than aborting it halfway: a document whose Purpose has no
  // account cannot be journalled, and a posting that moves the book without
  // writing accounting is exactly the split §12 forbids.
  const entries = await journalEntries(doc);
  if (!entries.ok) return { ok: false, errors: entries.errors };

  await prisma.$transaction(async (tx) => {
    await recordCashBankEntry(tx, {
      cashBankId: doc.cash_bank_id!,
      date: today,
      type: "Transaction",
      direction: doc.transaction_type as "In" | "Out",
      amount: doc.transaction_amount.toNumber(),
      sourceDocTypeId: docTypeId,
      sourceDocId: doc.id,
      note: doc.transaction_no,
      actorId,
    });

    for (const line of doc.lines) {
      const budget = byId.get(line.source_doc_id)!;
      const realized =
        budget.realized_amount.toNumber() + line.settlement_amount.toNumber();
      // Over-realization is permitted (§6.5) and still closes the plan: the
      // money left, and a plan cannot be "more than finished".
      const willClose = realized >= budget.budget_amount.toNumber();
      if (willClose) closed += 1;

      await tx.budBudget.update({
        where: { id: budget.id },
        data: {
          realized_amount: realized,
          ...(willClose ? { status: "Closed" as const } : {}),
          updated_by: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          entity_key: "bud_budget",
          row_id: budget.id,
          action: "UPDATE",
          by: actorId,
        },
      });
    }

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

// --------------------------------------------------------------- numbering

/**
 * Next document number, `CBT-0001`.
 *
 * Documents are numbered `PREFIX-0000`, not the `prefix.0000` system-code shape
 * `nextCode()` produces for master records — §9 keeps the two apart so a
 * document number is recognisable on sight.
 */
export async function nextTransactionNo(): Promise<string> {
  const rows = await prisma.finCashBankTransaction.findMany({
    select: { transaction_no: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = Number(r.transaction_no.split("-")[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `CBT-${String(max + 1).padStart(4, "0")}`;
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
