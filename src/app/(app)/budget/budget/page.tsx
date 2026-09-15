import { BudgetMonthList } from "@/components/budget/budget-month-list";
import { requirePermission } from "@/lib/siba/auth";
import { budgetMonths } from "@/lib/siba/budget";
import { accessibleCompanyIds } from "@/lib/siba/company-access";

export const dynamic = "force-dynamic";

/**
 * The module's landing page: Budget Month.
 *
 * A month is a Fiscal Period with its budgets rolled up — there is no
 * `bud_budget_month` table and there must not be one (CLAUDE.md §12).
 */
export default async function Page() {
  const actor = await requirePermission("BUDGET_VIEW", "/budget/budget");
  // Budgets belong to a Company, so a reader sees the months of the Companies
  // their permissions open — and of none, if they hold neither.
  const months = await budgetMonths(await accessibleCompanyIds(actor.permissions));
  return <BudgetMonthList months={months} />;
}
