import { notFound } from "next/navigation";
import { ItemReclassForm } from "@/components/finance/item-reclass-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { reclassLines, reclassRefs, getReclass } from "@/lib/siba/item-reclass";
import { reclassAbilities } from "@/lib/siba/item-reclass-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission(
    "ITEM_RECLASS_VIEW",
    `/finance/reklasifikasi-open-item/${id}`
  );

  const reclass = await getReclass(Number(id));
  if (!reclass) notFound();

  // A document of a Company this reader may not see reads as not found.
  const companyIds = await accessibleCompanyIds(actor.permissions);
  if (!companyIds.includes(reclass.company_id)) notFound();

  const [lines, refs] = await Promise.all([
    reclassLines(reclass.id),
    reclassRefs(companyIds),
  ]);

  return (
    <>
      <ItemReclassForm
        mode="view"
        reclass={reclass}
        lines={lines}
        refs={refs}
        can={reclassAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="fin_item_reclass" rowId={reclass.id} />
    </>
  );
}
