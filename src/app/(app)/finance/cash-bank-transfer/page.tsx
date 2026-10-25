import { TransferList } from "@/components/finance/transfer-list";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { cashBookSummary } from "@/lib/siba/cash-bank";
import { layerReport } from "@/lib/siba/cash-bank-layers";
import { listTransfers, transferRefs } from "@/lib/siba/transfer-rows";
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
  const [refs, cash, layers] = await Promise.all([
    transferRefs(companyIds),
    cashBookSummary(companyIds),
    layerReport(companyIds),
  ]);

  return (
    <TransferList
      transfers={transfers}
      refs={refs}
      cash={cash}
      layers={layers}
      can={transferAbilities(actor.permissions)}
      initialStatus={status}
    />
  );
}
