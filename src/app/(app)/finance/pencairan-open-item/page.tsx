import { ItemConversionList } from "@/components/finance/item-conversion-list";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { cashBookSummary } from "@/lib/siba/cash-bank";
import { layerReport } from "@/lib/siba/cash-bank-layers";
import { listConversions } from "@/lib/siba/item-conversion-rows";
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
  const companyIds = await accessibleCompanyIds(actor.permissions);
  const [conversions, cash, layers] = await Promise.all([
    listConversions(companyIds),
    cashBookSummary(companyIds),
    layerReport(companyIds),
  ]);

  return (
    <ItemConversionList
      conversions={conversions}
      cash={cash}
      layers={layers}
      can={conversionAbilities(actor.permissions)}
      initialStatus={status}
    />
  );
}
