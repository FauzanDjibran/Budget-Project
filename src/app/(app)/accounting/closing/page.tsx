import { ClosingWorkspace } from "@/components/accounting/closing-workspace";
import { requirePermission } from "@/lib/siba/auth";
import { closableYears, closingPlan } from "@/lib/siba/closing";
import { companyScope } from "@/lib/siba/company-access";

export const dynamic = "force-dynamic";

/**
 * The Fiscal Year Closing workspace.
 *
 * Bespoke rather than registry, for the reason Budget and Finance are: this is
 * not a record with fields. It is a checklist, a preview of an entry, and one
 * irreversible act, against a pair — a Company and a year — that no single
 * table holds.
 *
 * Both halves of that pair live in the URL, so a run is linkable and the page
 * stays a Server Component querying directly. A year the reader has not chosen
 * yet means no plan at all, which is a different screen from a plan that is
 * blocked.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; year?: string }>;
}) {
  const actor = await requirePermission("FISCAL_YEAR_CLOSE", "/accounting/closing");
  const { company, year } = await searchParams;
  const scope = await companyScope(actor.permissions, company);

  const companyId = scope.selected?.id ?? null;
  const years = companyId ? await closableYears(companyId) : [];

  // A `?year=` naming something this Company cannot be asked to close is
  // ignored rather than refused: the parameter is a navigation, and the screen
  // falls back to asking which year rather than to an error.
  const requested = Number(year);
  const yearId =
    years.some((y) => y.id === requested) ? requested : null;

  const plan =
    companyId && yearId ? await closingPlan(companyId, yearId) : null;

  return (
    <ClosingWorkspace
      plan={plan}
      years={years}
      companies={scope.options}
      companyId={companyId}
      yearId={yearId}
      canClose={actor.permissions.has("FISCAL_YEAR_CLOSE")}
    />
  );
}
