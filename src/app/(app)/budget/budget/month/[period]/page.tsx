import { notFound } from "next/navigation";
import { BudgetList } from "@/components/budget/budget-list";
import { requirePermission } from "@/lib/siba/auth";
import {
  budgetMappings,
  budgetRefs,
  cashPlaceholder,
  fiscalPeriod,
  listBudgets,
  summarise,
} from "@/lib/siba/budget";
import { budgetAbilities } from "@/lib/siba/budget-workflow";

export const dynamic = "force-dynamic";

/**
 * Budgets inside one month, or `all` for every month at once.
 *
 * The month is a Fiscal Period id, and the filter is a date-range query rather
 * than a stored grouping key — which is what makes Budget Month derived.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ period: string }>;
}) {
  const { period } = await params;

  const actor = await requirePermission(
    "BUDGET_VIEW",
    `/budget/budget/month/${period}`
  );

  const month = period === "all" ? null : await resolveMonth(period);
  if (period !== "all" && !month) notFound();

  const budgets = await listBudgets(
    month ? { startDate: month.startDate, endDate: month.endDate } : null
  );

  const [refs, mappings, summary, cash] = await Promise.all([
    budgetRefs(),
    budgetMappings(),
    summarise(budgets),
    cashPlaceholder(),
  ]);

  return (
    <BudgetList
      budgets={budgets}
      refs={refs}
      mappings={mappings}
      summary={summary}
      cash={cash}
      month={month ? { id: month.id, label: month.label, name: month.name } : null}
      can={budgetAbilities(actor.permissions)}
    />
  );
}

async function resolveMonth(period: string) {
  const id = Number(period);
  if (!Number.isInteger(id) || id <= 0) return null;
  return fiscalPeriod(id);
}
