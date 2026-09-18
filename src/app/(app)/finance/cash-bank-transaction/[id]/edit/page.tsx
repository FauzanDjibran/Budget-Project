import { notFound } from "next/navigation";
import { TransactionForm } from "@/components/finance/transaction-form";
import { requirePermission } from "@/lib/siba/auth";
import { budgetMappings } from "@/lib/siba/budget";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import {
  financeRefs,
  getTransaction,
  availablePurposeOptions,
  transactionLines,
} from "@/lib/siba/finance";
import {
  transactionAbilities,
  transactionIsEditable,
} from "@/lib/siba/transaction-workflow";
import { RecordHistoryCard } from "@/components/ui/record-history-card";

export const dynamic = "force-dynamic";

/**
 * A document leaves Draft and stops being editable. The route says so as well
 * as the Server Action does — `updateTransaction` refuses the same request on
 * its own, so this is convenience, not the protection.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePermission(
    "CASH_BANK_TRANSACTION_EDIT",
    `/finance/cash-bank-transaction/${id}/edit`
  );

  const transaction = await getTransaction(Number(id));
  if (!transaction) notFound();
  if (!transactionIsEditable(transaction.status)) notFound();

  const [lines, refs, mappings] = await Promise.all([
    transactionLines(transaction.id),
    financeRefs(await accessibleCompanyIds(actor.permissions)),
    budgetMappings(),
  ]);

  return (
    <>
      <TransactionForm
        mode="edit"
        transaction={transaction}
        lines={lines}
        refs={refs}
        purposes={await availablePurposeOptions(transaction.purpose)}
        mappings={mappings}
        can={transactionAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="fin_cash_bank_transaction" rowId={transaction.id} />
    </>
  );
}
