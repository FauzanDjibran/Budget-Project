import { notFound } from "next/navigation";
import { TransactionForm } from "@/components/finance/transaction-form";
import { requirePermission } from "@/lib/siba/auth";
import { budgetMappings } from "@/lib/siba/budget";
import {
  financeRefs,
  getTransaction,
  purposeOptions,
  transactionLines,
} from "@/lib/siba/finance";
import { transactionAbilities } from "@/lib/siba/transaction-workflow";
import { userEmails } from "@/lib/siba/users";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePermission(
    "CASH_BANK_TRANSACTION_VIEW",
    `/finance/cash-bank-transaction/${id}`
  );

  const transaction = await getTransaction(Number(id));
  if (!transaction) notFound();

  const [lines, refs, mappings, emails] = await Promise.all([
    transactionLines(transaction.id),
    financeRefs(),
    budgetMappings(),
    userEmails([transaction.created_by, transaction.updated_by]),
  ]);

  return (
    <TransactionForm
      mode="view"
      transaction={transaction}
      lines={lines}
      refs={refs}
      purposes={purposeOptions()}
      mappings={mappings}
      createdByEmail={emails[transaction.created_by]}
      updatedByEmail={
        transaction.updated_by ? emails[transaction.updated_by] : undefined
      }
      can={transactionAbilities(actor.permissions)}
    />
  );
}
