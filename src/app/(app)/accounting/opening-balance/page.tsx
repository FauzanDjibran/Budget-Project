import { OpeningBalanceList } from "@/components/accounting/opening-balance-list";
import { requirePermission } from "@/lib/siba/auth";
import { companyScope } from "@/lib/siba/company-access";
import { listOpeningBalances } from "@/lib/siba/opening-balance";

export const dynamic = "force-dynamic";

/**
 * The Opening Balance register.
 *
 * Read-only: there is no `/new` and no `/[id]/edit` below this route, because
 * a snapshot is written by a fiscal year's close or injected by a developer
 * before the application has any history, and is immutable once it exists.
 *
 * One Company at a time, chosen from the Companies this reader's permissions
 * open — each keeps its own chart of accounts, so a register holding both
 * reads as duplicated rows (CLAUDE.md §12).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const actor = await requirePermission(
    "OPENING_BALANCE_VIEW",
    "/accounting/opening-balance"
  );
  const { company } = await searchParams;
  const scope = await companyScope(actor.permissions, company);
  const openings = scope.selected
    ? await listOpeningBalances([scope.selected.id])
    : [];

  return (
    <OpeningBalanceList
      openings={openings}
      companies={scope.options}
      companyId={scope.selected?.id ?? null}
    />
  );
}
