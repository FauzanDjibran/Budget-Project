import { notFound } from "next/navigation";
import { BudgetList } from "@/components/budget/budget-list";
import { requirePermission } from "@/lib/siba/auth";
import {
  budgetMonths,
  budgetRefs,
  fiscalPeriod,
  listBudgets,
  summarise,
} from "@/lib/siba/budget";
import { cashBookSummary } from "@/lib/siba/cash-bank";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { budgetAbilities } from "@/lib/siba/budget-workflow";

export const dynamic = "force-dynamic";

/**
 * Pengajuan Budget: the Budgets inside one month, or `all` for every month.
 *
 * The month is a Fiscal Period id, and the filter is a date-range query rather
 * than a stored grouping key — which is what makes Budget Month derived.
 *
 * `?status=` opens the list on that status's tab, so a dashboard tile can
 * name a queue rather than dropping the reader into every budget there is.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ period: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { period } = await params;
  const { status } = await searchParams;

  const actor = await requirePermission(
    "BUDGET_VIEW",
    `/budget/budget/month/${period}`
  );

  const month = period === "all" ? null : await resolveMonth(period);
  if (period !== "all" && !month) notFound();

  const companyIds = await accessibleCompanyIds(actor.permissions);
  const budgets = await listBudgets(
    month ? { startDate: month.startDate, endDate: month.endDate } : null,
    companyIds
  );

  const [refs, months, summary, cash] = await Promise.all([
    budgetRefs(),
    budgetMonths(companyIds),
    summarise(budgets),
    cashBookSummary(companyIds),
  ]);

  return (
    <BudgetList
      budgets={budgets}
      refs={refs}
      months={months.map((m) => ({ id: m.periodId, label: m.label, name: m.name }))}
      summary={summary}
      cash={cash}
      month={month ? { id: month.id, label: month.label, name: month.name } : null}
      can={budgetAbilities(actor.permissions)}
      initialStatus={status}
    />
  );
}

async function resolveMonth(period: string) {
  const id = Number(period);
  if (!Number.isInteger(id) || id <= 0) return null;
  return fiscalPeriod(id);
}
