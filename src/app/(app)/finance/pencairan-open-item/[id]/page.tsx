import { notFound } from "next/navigation";
import { ItemConversionForm } from "@/components/finance/item-conversion-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { conversionLines, conversionRefs, getConversion } from "@/lib/siba/item-conversion";
import { conversionAbilities } from "@/lib/siba/item-conversion-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission(
    "ITEM_CONVERSION_VIEW",
    `/finance/pencairan-open-item/${id}`
  );

  const conversion = await getConversion(Number(id));
  if (!conversion) notFound();

  // A document of a Company this reader may not see reads as not found.
  const companyIds = await accessibleCompanyIds(actor.permissions);
  if (!companyIds.includes(conversion.company_id)) notFound();

  const [lines, refs] = await Promise.all([
    conversionLines(conversion.id),
    conversionRefs(companyIds),
  ]);

  return (
    <>
      <ItemConversionForm
        mode="view"
        conversion={conversion}
        lines={lines}
        refs={refs}
        can={conversionAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="fin_item_conversion" rowId={conversion.id} />
    </>
  );
}
