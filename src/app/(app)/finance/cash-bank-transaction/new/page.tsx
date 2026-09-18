import { TransactionForm } from "@/components/finance/transaction-form";
import { requirePermission } from "@/lib/siba/auth";
import { budgetMappings } from "@/lib/siba/budget";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { availablePurposeOptions, financeRefs } from "@/lib/siba/finance";
import { defaultCurrencyId } from "@/lib/siba/system-settings";
import { transactionAbilities } from "@/lib/siba/transaction-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission(
    "CASH_BANK_TRANSACTION_CREATE",
    "/finance/cash-bank-transaction/new"
  );

  // Which Companies this reader may write for, so the picker offers exactly
  // what the Server Action would accept. A user who may see only one never
  // sees the control at all.
  const companyIds = await accessibleCompanyIds(actor.permissions);
  const [refs, mappings, currencyId] = await Promise.all([
    financeRefs(companyIds),
    budgetMappings(),
    defaultCurrencyId(),
  ]);

  return (
    <TransactionForm
      mode="new"
      transaction={null}
      lines={[]}
      refs={refs}
      purposes={await availablePurposeOptions()}
      mappings={mappings}
      defaultCurrencyId={currencyId}
      can={transactionAbilities(actor.permissions)}
    />
  );
}
