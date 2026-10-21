import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { dashboardData } from "@/lib/siba/dashboard";
import { Dashboard } from "@/components/dashboard/dashboard";

export const dynamic = "force-dynamic";

/**
 * The dashboard. `?period=` names the month the plan and the Laba Rugi tiles
 * read; everything else is today's position.
 *
 * Reaching it is the only permission checked. Which tiles a given role should
 * see is a decision still to be taken; the data is composed per section, so
 * gating later is a filter here rather than a rewrite.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const actor = await requirePermission("MENU_DASHBOARD_ACCESS", "/dashboard");
  const { period } = await searchParams;
  const periodId = Number(period);
  const data = await dashboardData(
    await accessibleCompanyIds(actor.permissions),
    Number.isInteger(periodId) && periodId > 0 ? periodId : null
  );
  return <Dashboard data={data} />;
}
