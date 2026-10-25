import { ItemAdjustmentForm } from "@/components/finance/item-adjustment-form";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { itemAdjustmentRefs } from "@/lib/siba/item-adjustment-rows";
import { itemAdjustmentAbilities } from "@/lib/siba/item-adjustment-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission(
    "ITEM_ADJUSTMENT_CREATE",
    "/finance/penyesuaian-open-item/new"
  );
  // Only the Partners of Companies this reader may write for, so the picker
  // offers exactly what the Server Action would accept.
  const refs = await itemAdjustmentRefs(await accessibleCompanyIds(actor.permissions));

  return (
    <ItemAdjustmentForm
      mode="new"
      doc={null}
      lines={[]}
      refs={refs}
      can={itemAdjustmentAbilities(actor.permissions)}
    />
  );
}
