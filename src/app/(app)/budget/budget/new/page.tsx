import { BudgetForm } from "@/components/budget/budget-form";
import { requirePermission } from "@/lib/siba/auth";
import { budgetMappings, budgetRefs, fiscalPeriod } from "@/lib/siba/budget";
import { budgetAbilities } from "@/lib/siba/budget-workflow";
import { defaultCurrencyId } from "@/lib/siba/system-settings";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const actor = await requirePermission("BUDGET_CREATE", "/budget/budget/new");
  const { month: monthParam } = await searchParams;

  // Carried only so the breadcrumb and Cancel return where the user came from.
  // The budget's month is decided by its date, never by this parameter.
  const id = Number(monthParam);
  const period =
    Number.isInteger(id) && id > 0 ? await fiscalPeriod(id) : null;

  const [refs, mappings, currencyDefault] = await Promise.all([
    budgetRefs(),
    budgetMappings(),
    defaultCurrencyId(),
  ]);

  return (
    <BudgetForm
      mode="new"
      budget={null}
      refs={refs}
      mappings={mappings}
      month={period ? { id: period.id, label: period.label, name: period.name } : null}
      can={budgetAbilities(actor.permissions)}
      defaultCurrencyId={currencyDefault}
    />
  );
}
