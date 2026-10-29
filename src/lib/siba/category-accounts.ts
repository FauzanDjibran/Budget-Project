import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Which account a Budget Category posts to: Mapping Budget ke Account,
 * Company × Budget Category × Partner Category (none where the category names
 * no Partner) to exactly one account. Many mappings may name one account.
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
  return prisma.accBudgetCategoryAccount.findMany({
    where: {
      ...(filter.categoryIds && { budget_category_id: { in: filter.categoryIds } }),
      ...(filter.companyId != null && { company_id: filter.companyId }),
    },
    select: {
      company_id: true,
      budget_category_id: true,
      partner_category_id: true,
      account: {
        select: {
          id: true,
          company_id: true,
          is_active: true,
          is_postable: true,
          account_label: true,
          account_name: true,
        },
      },
    },
  });
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
