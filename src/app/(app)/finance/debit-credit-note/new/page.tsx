import { DncnForm } from "@/components/finance/dncn-form";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { dncnRefs } from "@/lib/siba/dncn";
import { dncnAbilities } from "@/lib/siba/dncn-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("DNCN_CREATE", "/finance/debit-credit-note/new");
  // Only the Partners of Companies this reader may write for, so the picker
  // offers exactly what the Server Action would accept.
  const refs = await dncnRefs(await accessibleCompanyIds(actor.permissions));

  return (
    <DncnForm mode="new" note={null} lines={[]} refs={refs} can={dncnAbilities(actor.permissions)} />
  );
}
