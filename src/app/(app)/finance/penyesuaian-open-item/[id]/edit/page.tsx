import { notFound } from "next/navigation";
import { ItemAdjustmentForm } from "@/components/finance/item-adjustment-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { getItemAdjustment, itemAdjustmentLines, itemAdjustmentRefs } from "@/lib/siba/item-adjustment-rows";
import {
  itemAdjustmentAbilities,
  itemAdjustmentIsEditable,
} from "@/lib/siba/item-adjustment-workflow";

export const dynamic = "force-dynamic";

/**
 * A document stops being editable once it leaves Draft.
 * `updateItemAdjustment` refuses the same request on its own, so this is
 * convenience, not the protection.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission(
    "ITEM_ADJUSTMENT_EDIT",
    `/finance/penyesuaian-open-item/${id}/edit`
  );

  const doc = await getItemAdjustment(Number(id));
  if (!doc || !itemAdjustmentIsEditable(doc.status)) notFound();

  const companyIds = await accessibleCompanyIds(actor.permissions);
  if (!companyIds.includes(doc.company_id)) notFound();

  const [lines, refs] = await Promise.all([
    itemAdjustmentLines(doc.id),
    itemAdjustmentRefs(companyIds),
  ]);

  return (
    <>
      <ItemAdjustmentForm
        mode="edit"
        doc={doc}
        lines={lines}
        refs={refs}
        can={itemAdjustmentAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="fin_item_adjustment" rowId={doc.id} />
    </>
  );
}
