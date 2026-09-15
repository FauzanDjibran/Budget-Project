import { notFound } from "next/navigation";
import { BudgetForm } from "@/components/budget/budget-form";
import { BudgetLocked } from "@/components/budget/budget-locked";
import { requirePermission } from "@/lib/siba/auth";
import {
  budgetMappings,
  budgetRefs,
  getBudget,
  monthOfDate,
} from "@/lib/siba/budget";
import { budgetAbilities, budgetIsEditable } from "@/lib/siba/budget-workflow";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePermission(
    "BUDGET_EDIT",
    `/budget/budget/${id}/edit`
  );

  const budget = await getBudget(Number(id));
  if (!budget) notFound();

  // A budget that has left Draft or Rejected is not editable by anyone. The
  // route explains rather than rendering a form whose save would be refused —
  // `updateBudget` refuses it either way.
  if (!budgetIsEditable(budget.status)) {
    return <BudgetLocked budget={budget} />;
  }

  const [refs, mappings, month] = await Promise.all([
    budgetRefs(),
    budgetMappings(),
    monthOfDate(budget.budget_date),
  ]);

  return (
    <BudgetForm
      mode="edit"
      budget={budget}
      refs={refs}
      mappings={mappings}
      month={month}
      can={budgetAbilities(actor.permissions)}
    />
  );
}
