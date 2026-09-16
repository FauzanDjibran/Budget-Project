import { TransactionList } from "@/components/finance/transaction-list";
import { requirePermission } from "@/lib/siba/auth";
import { cashBookSummary } from "@/lib/siba/cash-bank";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import {
  financeRefs,
  listTransactions,
  purposeOptions,
  summariseTransactions,
} from "@/lib/siba/finance";
import { transactionAbilities } from "@/lib/siba/transaction-workflow";

export const dynamic = "force-dynamic";

/**
 * `?status=` opens the register already filtered, so a link can name a queue
 * rather than dropping the reader into the whole list.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requirePermission(
    "CASH_BANK_TRANSACTION_VIEW",
    "/finance/cash-bank-transaction"
  );

  const { status } = await searchParams;
  const companyIds = await accessibleCompanyIds(actor.permissions);
  const transactions = await listTransactions(companyIds);
  const [refs, summary, cash] = await Promise.all([
    financeRefs(),
    summariseTransactions(transactions),
    cashBookSummary(companyIds),
  ]);

  return (
    <TransactionList
      transactions={transactions}
      refs={refs}
      purposes={purposeOptions()}
      summary={summary}
      cash={cash}
      can={transactionAbilities(actor.permissions)}
      initialStatus={status}
    />
  );
}
