import { notFound } from "next/navigation";
import { ItemAdjustmentForm } from "@/components/finance/item-adjustment-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { getItemAdjustment, itemAdjustmentLines, itemAdjustmentRefs } from "@/lib/siba/item-adjustment-rows";
import { itemAdjustmentAbilities } from "@/lib/siba/item-adjustment-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission(
    "ITEM_ADJUSTMENT_VIEW",
    `/finance/penyesuaian-open-item/${id}`
  );

  const doc = await getItemAdjustment(Number(id));
  if (!doc) notFound();

  // A document belonging to a Company this reader may not see reads as not found.
  const companyIds = await accessibleCompanyIds(actor.permissions);
  if (!companyIds.includes(doc.company_id)) notFound();

  const [lines, refs] = await Promise.all([
    itemAdjustmentLines(doc.id),
    itemAdjustmentRefs(companyIds),
  ]);

  return (
    <>
      <ItemAdjustmentForm
        mode="view"
        doc={doc}
        lines={lines}
        refs={refs}
        can={itemAdjustmentAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="fin_item_adjustment" rowId={doc.id} />
    </>
  );
}
