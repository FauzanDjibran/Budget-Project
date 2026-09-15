import { TransactionForm } from "@/components/finance/transaction-form";
import { requirePermission } from "@/lib/siba/auth";
import { budgetMappings } from "@/lib/siba/budget";
import { financeRefs, purposeOptions } from "@/lib/siba/finance";
import { transactionAbilities } from "@/lib/siba/transaction-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission(
    "CASH_BANK_TRANSACTION_CREATE",
    "/finance/cash-bank-transaction/new"
  );

  const [refs, mappings] = await Promise.all([financeRefs(), budgetMappings()]);

  return (
    <TransactionForm
      mode="new"
      transaction={null}
      lines={[]}
      refs={refs}
      purposes={purposeOptions()}
      mappings={mappings}
      can={transactionAbilities(actor.permissions)}
    />
  );
}
