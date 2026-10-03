import { notFound } from "next/navigation";
import { ItemConversionForm } from "@/components/finance/item-conversion-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { conversionLines, conversionRefs, getConversion } from "@/lib/siba/item-conversion";
import {
  conversionAbilities,
  conversionIsEditable,
} from "@/lib/siba/item-conversion-workflow";

export const dynamic = "force-dynamic";

/**
 * A document leaves Draft and stops being editable. `updateConversion` refuses
 * the same request on its own, so this is convenience, not the protection.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission(
    "ITEM_CONVERSION_EDIT",
    `/finance/pencairan-open-item/${id}/edit`
  );

  const conversion = await getConversion(Number(id));
  if (!conversion) notFound();
  if (!conversionIsEditable(conversion.status)) notFound();

  const companyIds = await accessibleCompanyIds(actor.permissions);
  if (!companyIds.includes(conversion.company_id)) notFound();

  const [lines, refs] = await Promise.all([
    conversionLines(conversion.id),
    conversionRefs(companyIds),
  ]);

  return (
    <>
      <ItemConversionForm
        mode="edit"
        conversion={conversion}
        lines={lines}
        refs={refs}
        can={conversionAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="fin_item_conversion" rowId={conversion.id} />
    </>
  );
}
