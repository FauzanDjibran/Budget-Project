import { notFound } from "next/navigation";
import { RevaluationForm } from "@/components/finance/revaluation-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import {
  getRevaluation,
  revaluationClosedLayers,
  revaluationOpenedLayerNo,
  revaluationRefs,
} from "@/lib/siba/cash-bank-revaluation";
import { revaluationAbilities } from "@/lib/siba/cash-bank-revaluation-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission(
    "CASH_BANK_REVALUATION_VIEW",
    `/finance/revaluasi-kurs/${id}`
  );

  const doc = await getRevaluation(Number(id));
  if (!doc) notFound();

  // A document belonging to a Company this reader may not see reads as not found.
  const companyIds = await accessibleCompanyIds(actor.permissions);
  if (!companyIds.includes(doc.company_id)) notFound();

  const [closedLayers, openedLayerNo, refs] = await Promise.all([
    revaluationClosedLayers(doc.id),
    revaluationOpenedLayerNo(doc.id),
    revaluationRefs(companyIds),
  ]);

  return (
    <>
      <RevaluationForm
        mode="view"
        doc={doc}
        closedLayers={closedLayers}
        openedLayerNo={openedLayerNo}
        refs={refs}
        can={revaluationAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="fin_cash_bank_revaluation" rowId={doc.id} />
    </>
  );
}
