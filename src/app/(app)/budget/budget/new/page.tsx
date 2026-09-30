import { BudgetForm } from "@/components/budget/budget-form";
import { requirePermission } from "@/lib/siba/auth";
import {
  budgetMappings,
  budgetRefs,
  fiscalPeriod,
  getBudget,
} from "@/lib/siba/budget";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { budgetAbilities } from "@/lib/siba/budget-workflow";
import { defaultCurrencyId } from "@/lib/siba/system-settings";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string }>;
}) {
  const actor = await requirePermission("BUDGET_CREATE", "/budget/budget/new");
  const { month: monthParam, from } = await searchParams;

  // Carried only so the breadcrumb and Cancel return where the user came from.
  // The budget's month is decided by its date, never by this parameter.
  const id = Number(monthParam);
  const period =
    Number.isInteger(id) && id > 0 ? await fiscalPeriod(id) : null;

  // `?from=` starts the form as a copy — how a rejected plan is corrected.
  // Only a Budget of a Company the reader may see can be copied; any other id
  // simply starts an empty form, as a missing one does.
  const fromId = Number(from);
  const source =
    Number.isInteger(fromId) && fromId > 0 ? await getBudget(fromId) : null;
  const companyIds = source ? await accessibleCompanyIds(actor.permissions) : [];
  const copyFrom =
    source && companyIds.includes(source.company_id) ? source : null;

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
      copyFrom={copyFrom}
    />
  );
}
