import { notFound } from "next/navigation";
import { RevaluationForm } from "@/components/finance/revaluation-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { getRevaluation, revaluationRefs } from "@/lib/siba/cash-bank-revaluation";
import {
  revaluationAbilities,
  revaluationIsEditable,
} from "@/lib/siba/cash-bank-revaluation-workflow";

export const dynamic = "force-dynamic";

/**
 * A document stops being editable once it leaves Draft. `updateRevaluation`
 * refuses the same request on its own, so this is convenience, not the
 * protection.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission(
    "CASH_BANK_REVALUATION_EDIT",
    `/finance/revaluasi-kurs/${id}/edit`
  );

  const doc = await getRevaluation(Number(id));
  if (!doc || !revaluationIsEditable(doc.status)) notFound();

  const companyIds = await accessibleCompanyIds(actor.permissions);
  if (!companyIds.includes(doc.company_id)) notFound();

  const refs = await revaluationRefs(companyIds);

  return (
    <>
      <RevaluationForm
        mode="edit"
        doc={doc}
        closedLayers={[]}
        openedLayerNo={null}
        refs={refs}
        can={revaluationAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="fin_cash_bank_revaluation" rowId={doc.id} />
    </>
  );
}
