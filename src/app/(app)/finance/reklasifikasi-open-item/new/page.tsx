import { ItemReclassForm } from "@/components/finance/item-reclass-form";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { reclassRefs } from "@/lib/siba/item-reclass";
import { reclassAbilities } from "@/lib/siba/item-reclass-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission(
    "ITEM_RECLASS_CREATE",
    "/finance/reklasifikasi-open-item/new"
  );

  // The Companies this reader may write for, so the pickers offer exactly what
  // the Server Action would accept.
  const refs = await reclassRefs(await accessibleCompanyIds(actor.permissions));

  return (
    <ItemReclassForm
      mode="new"
      reclass={null}
      lines={[]}
      refs={refs}
      can={reclassAbilities(actor.permissions)}
    />
  );
}
