import { notFound } from "next/navigation";
import { TransferForm } from "@/components/finance/transfer-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { getTransfer, transferLines, transferRefs } from "@/lib/siba/transfer";
import {
  transferAbilities,
  transferIsEditable,
} from "@/lib/siba/transfer-workflow";

export const dynamic = "force-dynamic";

/**
 * A document leaves Draft and stops being editable. The route says so as well
 * as the Server Action does — `updateTransfer` refuses the same request on its
 * own, so this is convenience, not the protection.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePermission(
    "CASH_BANK_TRANSFER_EDIT",
    `/finance/cash-bank-transfer/${id}/edit`
  );

  const transfer = await getTransfer(Number(id));
  if (!transfer) notFound();
  if (!transferIsEditable(transfer.status)) notFound();

  const companyIds = await accessibleCompanyIds(actor.permissions);
  if (!companyIds.includes(transfer.company_id)) notFound();

  const [lines, refs] = await Promise.all([
    transferLines(transfer.id),
    transferRefs(companyIds),
  ]);

  return (
    <>
      <TransferForm
        mode="edit"
        transfer={transfer}
        lines={lines}
        refs={refs}
        can={transferAbilities(actor.permissions)}
      />
      <RecordHistoryCard entityKey="fin_cash_bank_transfer" rowId={transfer.id} />
    </>
  );
}
