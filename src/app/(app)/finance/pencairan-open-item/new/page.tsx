import { ItemConversionForm } from "@/components/finance/item-conversion-form";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { conversionRefs } from "@/lib/siba/item-conversion";
import { conversionAbilities } from "@/lib/siba/item-conversion-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission(
    "ITEM_CONVERSION_CREATE",
    "/finance/pencairan-open-item/new"
  );

  // The Companies this reader may write for, so the pickers offer exactly what
  // the Server Action would accept.
  const refs = await conversionRefs(await accessibleCompanyIds(actor.permissions));

  return (
    <ItemConversionForm
      mode="new"
      conversion={null}
      lines={[]}
      refs={refs}
      can={conversionAbilities(actor.permissions)}
    />
  );
}
