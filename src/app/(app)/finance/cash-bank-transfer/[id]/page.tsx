import { notFound } from "next/navigation";
import { TransferForm } from "@/components/finance/transfer-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { getTransfer, transferLines, transferRefs } from "@/lib/siba/transfer";
import { transferAbilities } from "@/lib/siba/transfer-workflow";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePermission(
    "CASH_BANK_TRANSFER_VIEW",
    `/finance/cash-bank-transfer/${id}`
  );

  const transfer = await getTransfer(Number(id));
  if (!transfer) notFound();

  // A transfer belonging to a Company this reader may not see reads as not
  // found, which is the same answer one that does not exist gives.
  const companyIds = await accessibleCompanyIds(actor.permissions);
  if (!companyIds.includes(transfer.company_id)) notFound();

  const [lines, refs] = await Promise.all([
    transferLines(transfer.id),
    transferRefs(companyIds),
  ]);

  return (
    <>
      <TransferForm
        mode="view"
        transfer={transfer}
        lines={lines}
        refs={refs}
        can={transferAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="fin_cash_bank_transfer" rowId={transfer.id} />
    </>
  );
}
