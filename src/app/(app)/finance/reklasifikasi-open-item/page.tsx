import { ItemReclassList } from "@/components/finance/item-reclass-list";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { listReclasses, summariseReclasses } from "@/lib/siba/item-reclass";
import { reclassAbilities } from "@/lib/siba/item-reclass-workflow";

export const dynamic = "force-dynamic";

/** `?status=` opens the register already filtered. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requirePermission("ITEM_RECLASS_VIEW", "/finance/reklasifikasi-open-item");

  const { status } = await searchParams;
  const reclasses = await listReclasses(await accessibleCompanyIds(actor.permissions));

  return (
    <ItemReclassList
      reclasses={reclasses}
      summary={summariseReclasses(reclasses)}
      can={reclassAbilities(actor.permissions)}
      initialStatus={status}
    />
  );
}
