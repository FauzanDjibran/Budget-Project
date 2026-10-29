import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Which account a Budget Category posts to (Journal 2.0 D25). The account
 * holds its categories itself (`acc_account_book`), for its one Partner
 * Category where they take a Partner and for none where they do not, so the
 * key Mapping Budget ke Account used to keep — Company × Budget Category ×
 * Partner Category — is read off the accounts. The account form allows one
 * account per key (`checkAccountLedger`).
 */
export type CategoryAccount = {
  company_id: number;
  budget_category_id: number;
  partner_category_id: number | null;
  account: {
    id: number;
    company_id: number;
    is_active: boolean;
    is_postable: boolean;
    account_label: string;
    account_name: string;
  };
};

export async function categoryAccounts(filter: {
  companyId?: number;
  categoryIds?: number[];
} = {}): Promise<CategoryAccount[]> {
  const rows = await prisma.accAccountBook.findMany({
    where: {
      status: "Active",
      ...(filter.categoryIds && { budget_category_id: { in: filter.categoryIds } }),
      account: {
        ledger: "category",
        ...(filter.companyId != null && { company_id: filter.companyId }),
      },
    },
    select: {
      budget_category_id: true,
      account: {
        select: {
          id: true,
          company_id: true,
          partner_category_id: true,
          is_active: true,
          is_postable: true,
          account_label: true,
          account_name: true,
        },
      },
    },
  });
  return rows.map(({ budget_category_id, account: { partner_category_id, ...account } }) => ({
    company_id: account.company_id,
    budget_category_id,
    partner_category_id,
    account,
  }));
}

/** The one account for a Company × Budget Category × Partner Category (or none). */
export async function categoryAccount(
  companyId: number,
  budgetCategoryId: number,
  partnerCategoryId: number | null
): Promise<CategoryAccount | null> {
  return (
    (await categoryAccounts({ companyId, categoryIds: [budgetCategoryId] })).find(
      (a) => a.partner_category_id === partnerCategoryId
    ) ?? null
  );
}
