import { CashflowMappingForm } from "@/components/accounting/cashflow-mapping-form";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import { cashflowMappingView } from "@/lib/siba/cashflow-mapping";

export const dynamic = "force-dynamic";

/** Mapping Cash Flow — the group every Budget Category, and each entry type without one, falls in. */
export default async function CashflowMappingPage() {
  const actor = await requirePermission("CASHFLOW_MAPPING_VIEW", "/accounting/cashflow-mapping");
  return (
    <CashflowMappingForm view={await cashflowMappingView()} canEdit={actorCan(actor, "CASHFLOW_MAPPING_EDIT")} />
  );
}
