import { notFound, redirect } from "next/navigation";
import { TransactionForm } from "@/components/finance/transaction-form";
import { TransactionList } from "@/components/finance/transaction-list";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { budgetMappings } from "@/lib/siba/budget";
import { cashBookSummary } from "@/lib/siba/cash-bank";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import {
  financeRefs,
  getTransaction,
  listTransactions,
  summariseTransactions,
  transactionLines,
} from "@/lib/siba/finance";
import { openRequestFor } from "@/lib/siba/funding";
import { realizationHref } from "@/lib/siba/realization";
import { defaultCurrencyId } from "@/lib/siba/system-settings";
import {
  transactionAbilities,
  transactionIsEditable,
} from "@/lib/siba/transaction-workflow";

/**
 * The four Realisasi Budget pages, written once.
 *
 * Realisasi Penerimaan and Realisasi Pengeluaran are one document type and two
 * menus, so each menu's route files are thin wrappers that pass their
 * direction — the same arrangement the registry pages use for their module.
 * One permission set covers both menus.
 *
 * A document opened under the other menu's route is sent to its own: its
 * direction is fixed, and the page it belongs to is the one that says so.
 */

type Direction = "In" | "Out";

export async function RealizationListPage({
  direction,
  status,
}: {
  direction: Direction;
  status?: string;
}) {
  const actor = await requirePermission("REALIZATION_VIEW", realizationHref(direction));

  const companyIds = await accessibleCompanyIds(actor.permissions);
  const transactions = await listTransactions(companyIds, direction);
  const [refs, summary, cash] = await Promise.all([
    financeRefs(),
    summariseTransactions(transactions),
    cashBookSummary(companyIds),
  ]);

  return (
    <TransactionList
      direction={direction}
      transactions={transactions}
      refs={refs}
      summary={summary}
      cash={cash}
      can={transactionAbilities(actor.permissions)}
      initialStatus={status}
    />
  );
}

export async function RealizationNewPage({ direction }: { direction: Direction }) {
  const actor = await requirePermission(
    "REALIZATION_CREATE",
    `${realizationHref(direction)}/new`
  );

  // Which Companies this reader may write for, so the picker offers exactly
  // what the Server Action would accept.
  const companyIds = await accessibleCompanyIds(actor.permissions);
  const [refs, mappings, currencyId] = await Promise.all([
    financeRefs(companyIds),
    budgetMappings(),
    defaultCurrencyId(),
  ]);

  return (
    <TransactionForm
      direction={direction}
      mode="new"
      transaction={null}
      lines={[]}
      refs={refs}
      mappings={mappings}
      defaultCurrencyId={currencyId}
      can={transactionAbilities(actor.permissions)}
    />
  );
}

export async function RealizationViewPage({
  direction,
  id,
}: {
  direction: Direction;
  id: string;
}) {
  const actor = await requirePermission(
    "REALIZATION_VIEW",
    realizationHref(direction, id)
  );

  const transaction = await getTransaction(Number(id));
  if (!transaction) notFound();
  if (transaction.transaction_type !== direction) {
    redirect(realizationHref(transaction.transaction_type, transaction.id));
  }

  const [lines, refs, mappings, request] = await Promise.all([
    transactionLines(transaction.id),
    financeRefs(await accessibleCompanyIds(actor.permissions)),
    budgetMappings(),
    openRequestFor(transaction.id),
  ]);

  return (
    <>
      <TransactionForm
        direction={direction}
        mode="view"
        transaction={transaction}
        lines={lines}
        refs={refs}
        mappings={mappings}
        fundingRequestNo={request?.funding_request_no ?? null}
        can={transactionAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="fin_cash_bank_transaction" rowId={transaction.id} />
    </>
  );
}

/**
 * A document leaves Draft and stops being editable. The route says so as well
 * as the Server Action does — `updateTransaction` refuses the same request on
 * its own, so this is convenience, not the protection.
 */
export async function RealizationEditPage({
  direction,
  id,
}: {
  direction: Direction;
  id: string;
}) {
  const actor = await requirePermission(
    "REALIZATION_EDIT",
    `${realizationHref(direction, id)}/edit`
  );

  const transaction = await getTransaction(Number(id));
  if (!transaction) notFound();
  if (transaction.transaction_type !== direction) {
    redirect(`${realizationHref(transaction.transaction_type, transaction.id)}/edit`);
  }
  if (!transactionIsEditable(transaction.status)) notFound();

  const [lines, refs, mappings] = await Promise.all([
    transactionLines(transaction.id),
    financeRefs(await accessibleCompanyIds(actor.permissions)),
    budgetMappings(),
  ]);

  return (
    <>
      <TransactionForm
        direction={direction}
        mode="edit"
        transaction={transaction}
        lines={lines}
        refs={refs}
        mappings={mappings}
        can={transactionAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="fin_cash_bank_transaction" rowId={transaction.id} />
    </>
  );
}
