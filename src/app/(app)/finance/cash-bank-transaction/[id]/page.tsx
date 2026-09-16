import { notFound } from "next/navigation";
import { TransactionForm } from "@/components/finance/transaction-form";
import { requirePermission } from "@/lib/siba/auth";
import { budgetMappings } from "@/lib/siba/budget";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { openRequestFor } from "@/lib/siba/funding";
import {
  financeRefs,
  getTransaction,
  purposeOptions,
  transactionLines,
} from "@/lib/siba/finance";
import { transactionAbilities } from "@/lib/siba/transaction-workflow";
import { userEmails } from "@/lib/siba/users";
import { RecordHistoryCard } from "@/components/ui/record-history-card";

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

  const [lines, refs, mappings, emails, request] = await Promise.all([
    transactionLines(transaction.id),
    financeRefs(await accessibleCompanyIds(actor.permissions)),
    budgetMappings(),
    userEmails([transaction.created_by, transaction.updated_by]),
    openRequestFor(transaction.id),
  ]);

  return (
    <>
      <TransactionForm
        mode="view"
        transaction={transaction}
        lines={lines}
        refs={refs}
        purposes={purposeOptions()}
        mappings={mappings}
        fundingRequestNo={request?.funding_request_no ?? null}
        createdByEmail={emails[transaction.created_by]}
        updatedByEmail={
          transaction.updated_by ? emails[transaction.updated_by] : undefined
        }
        can={transactionAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="fin_cash_bank_transaction" rowId={transaction.id} />
    </>
  );
}
