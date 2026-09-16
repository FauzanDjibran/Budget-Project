import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { dashboardData } from "@/lib/siba/dashboard";
import { Dashboard } from "@/components/dashboard/dashboard";

export const dynamic = "force-dynamic";

/**
 * The dashboard.
 *
 * It answers four questions and no more: what is waiting and on whom, where
 * the money is, what the company owes and is owed, and what is broken. Every
 * figure appears exactly once — see the MECE note in `lib/siba/dashboard.ts`.
 *
 * Reaching it is the only permission checked. Which tiles a given role should
 * see is a decision still to be taken; the data is composed per section, so
 * gating later is a filter here rather than a rewrite.
 */
export default async function DashboardPage() {
  const actor = await requirePermission("MENU_DASHBOARD_ACCESS", "/dashboard");
  const data = await dashboardData(
    await accessibleCompanyIds(actor.permissions)
  );
  return <Dashboard data={data} />;
}
