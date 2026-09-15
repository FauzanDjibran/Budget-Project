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
import { userEmails } from "@/lib/siba/users";

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

  const [refs, mappings, month, emails, realizations] = await Promise.all([
    budgetRefs(),
    budgetMappings(),
    monthOfDate(budget.budget_date),
    userEmails([budget.created_by, budget.updated_by]),
    budgetRealizations(budget.id),
  ]);

  return (
    <BudgetForm
      mode="view"
      budget={budget}
      refs={refs}
      mappings={mappings}
      month={month}
      createdByEmail={emails[budget.created_by]}
      updatedByEmail={budget.updated_by ? emails[budget.updated_by] : undefined}
      can={budgetAbilities(actor.permissions)}
      realizations={realizations}
    />
  );
}
