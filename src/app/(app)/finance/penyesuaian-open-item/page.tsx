import { ItemAdjustmentList } from "@/components/finance/item-adjustment-list";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { summariseItemAdjustments } from "@/lib/siba/item-adjustment";
import { listItemAdjustments } from "@/lib/siba/item-adjustment-rows";
import { itemAdjustmentAbilities } from "@/lib/siba/item-adjustment-workflow";

export const dynamic = "force-dynamic";

/** `?status=` opens the register already filtered. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requirePermission("ITEM_ADJUSTMENT_VIEW", "/finance/penyesuaian-open-item");
  const { status } = await searchParams;
  const rows = await listItemAdjustments(await accessibleCompanyIds(actor.permissions));

  return (
    <ItemAdjustmentList
      rows={rows}
      summary={summariseItemAdjustments(rows)}
      can={itemAdjustmentAbilities(actor.permissions)}
      initialStatus={status}
    />
  );
}
