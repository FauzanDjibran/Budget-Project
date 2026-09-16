import { notFound } from "next/navigation";
import { BudgetForm } from "@/components/budget/budget-form";
import { requirePermission } from "@/lib/siba/auth";
import {
  budgetMappings,
  budgetRefs,
  getBudget,
  monthOfDate,
} from "@/lib/siba/budget";
import { budgetAbilities } from "@/lib/siba/budget-workflow";
import { budgetRealizations } from "@/lib/siba/finance";
import { RecordHistoryCard } from "@/components/ui/record-history-card";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePermission("BUDGET_VIEW", `/budget/budget/${id}`);

  const budget = await getBudget(Number(id));
  if (!budget) notFound();

  const [refs, mappings, month, realizations] = await Promise.all([
    budgetRefs(),
    budgetMappings(),
    monthOfDate(budget.budget_date),
    budgetRealizations(budget.id),
  ]);

  return (
    <>
      <BudgetForm
        mode="view"
        budget={budget}
        refs={refs}
        mappings={mappings}
        month={month}
        can={budgetAbilities(actor.permissions)}
        realizations={realizations}
      />
      <RecordHistoryCard entityKey="bud_budget" rowId={budget.id} />
    </>
  );
}
