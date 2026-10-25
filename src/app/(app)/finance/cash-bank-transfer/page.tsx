import { TransferList } from "@/components/finance/transfer-list";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { cashBookSummary } from "@/lib/siba/cash-bank";
import { layerReport } from "@/lib/siba/cash-bank-layers";
import { parseRegisterQuery } from "@/lib/siba/register-query";
import { TRANSFER_PURPOSES } from "@/lib/siba/transfer-catalogue";
import { listTransfers, transferRefs } from "@/lib/siba/transfer-rows";
import { transferAbilities } from "@/lib/siba/transfer-workflow";

export const dynamic = "force-dynamic";

/**
 * `?status=`, `?purpose=`, `?q=`, `?page=` and `?size=` are the register's query, so
 * a link can name a queue rather than dropping the reader into the whole list.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePermission(
    "CASH_BANK_TRANSFER_VIEW",
    "/finance/cash-bank-transfer"
  );

  const params = await searchParams;
  const purpose = Array.isArray(params.purpose) ? params.purpose[0] : params.purpose;
  const companyIds = await accessibleCompanyIds(actor.permissions);
  const transfers = await listTransfers(
    companyIds,
    parseRegisterQuery(params, ["Draft", "Posted", "Cancelled"]),
    TRANSFER_PURPOSES.some((p) => p.key === purpose) ? purpose : ""
  );
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
    />
  );
}
