import "server-only";

import { prisma } from "@/lib/prisma";
import { openLayersFor, type LayerOption } from "./cash-bank-layers";
import { isBaseCurrency } from "./currency";

/** What a Realisasi form offers to choose from, and the Company that holds the cash. */

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

