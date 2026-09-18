import { TransferForm } from "@/components/finance/transfer-form";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { transferRefs } from "@/lib/siba/transfer";
import { transferAbilities } from "@/lib/siba/transfer-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission(
    "CASH_BANK_TRANSFER_CREATE",
    "/finance/cash-bank-transfer/new"
  );

  // Which Companies this reader may write for, so the picker offers exactly
  // what the Server Action would accept.
  const refs = await transferRefs(
    await accessibleCompanyIds(actor.permissions)
  );

  return (
    <TransferForm
      mode="new"
      transfer={null}
      lines={[]}
      refs={refs}
      can={transferAbilities(actor.permissions)}
    />
  );
}
