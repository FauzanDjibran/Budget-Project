import { TransferList } from "@/components/finance/transfer-list";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import {
  listTransfers,
  summariseTransfers,
  transferRefs,
} from "@/lib/siba/transfer";
import { transferAbilities } from "@/lib/siba/transfer-workflow";

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
    "CASH_BANK_TRANSFER_VIEW",
    "/finance/cash-bank-transfer"
  );

  const { status } = await searchParams;
  const companyIds = await accessibleCompanyIds(actor.permissions);
  const transfers = await listTransfers(companyIds);
  const [refs, summary] = await Promise.all([
    transferRefs(companyIds),
    summariseTransfers(transfers),
  ]);

  return (
    <TransferList
      transfers={transfers}
      refs={refs}
      summary={summary}
      can={transferAbilities(actor.permissions)}
      initialStatus={status}
    />
  );
}
