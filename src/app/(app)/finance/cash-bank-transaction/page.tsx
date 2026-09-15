import { TransactionList } from "@/components/finance/transaction-list";
import { requirePermission } from "@/lib/siba/auth";
import { cashBookSummary } from "@/lib/siba/cash-bank";
import {
  financeRefs,
  listTransactions,
  purposeOptions,
  summariseTransactions,
} from "@/lib/siba/finance";
import { transactionAbilities } from "@/lib/siba/transaction-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission(
    "CASH_BANK_TRANSACTION_VIEW",
    "/finance/cash-bank-transaction"
  );

  const transactions = await listTransactions();
  const [refs, summary, cash] = await Promise.all([
    financeRefs(),
    summariseTransactions(transactions),
    cashBookSummary(),
  ]);

  return (
    <TransactionList
      transactions={transactions}
      refs={refs}
      purposes={purposeOptions()}
      summary={summary}
      cash={cash}
      can={transactionAbilities(actor.permissions)}
    />
  );
}
