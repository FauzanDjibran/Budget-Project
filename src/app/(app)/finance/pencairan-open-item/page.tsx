import { ItemConversionList } from "@/components/finance/item-conversion-list";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { listConversions, summariseConversions } from "@/lib/siba/item-conversion";
import { conversionAbilities } from "@/lib/siba/item-conversion-workflow";

export const dynamic = "force-dynamic";

/** `?status=` opens the register already filtered. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requirePermission("ITEM_CONVERSION_VIEW", "/finance/pencairan-open-item");

  const { status } = await searchParams;
  const conversions = await listConversions(await accessibleCompanyIds(actor.permissions));

  return (
    <ItemConversionList
      conversions={conversions}
      summary={summariseConversions(conversions)}
      can={conversionAbilities(actor.permissions)}
      initialStatus={status}
    />
  );
}
