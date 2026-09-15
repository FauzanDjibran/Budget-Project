import { BudgetMonthList } from "@/components/budget/budget-month-list";
import { requirePermission } from "@/lib/siba/auth";
import { budgetMonths } from "@/lib/siba/budget";

export const dynamic = "force-dynamic";

/**
 * The module's landing page: Budget Month.
 *
 * A month is a Fiscal Period with its budgets rolled up — there is no
 * `bud_budget_month` table and there must not be one (CLAUDE.md §12).
 */
export default async function Page() {
  await requirePermission("BUDGET_VIEW", "/budget/budget");
  const months = await budgetMonths();
  return <BudgetMonthList months={months} />;
}
