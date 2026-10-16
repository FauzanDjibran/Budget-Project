import { RevaluationForm } from "@/components/finance/revaluation-form";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { revaluationRefs } from "@/lib/siba/cash-bank-revaluation";
import { revaluationAbilities } from "@/lib/siba/cash-bank-revaluation-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission(
    "CASH_BANK_REVALUATION_CREATE",
    "/finance/revaluasi-kurs/new"
  );
  // Only the resources of Companies this reader may write for, so the picker
  // offers exactly what the Server Action would accept.
  const refs = await revaluationRefs(await accessibleCompanyIds(actor.permissions));

  return (
    <RevaluationForm
      mode="new"
      doc={null}
      closedLayers={[]}
      openedLayerNo={null}
      refs={refs}
      can={revaluationAbilities(actor.permissions)}
    />
  );
}
