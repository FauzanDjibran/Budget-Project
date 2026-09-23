import { notFound } from "next/navigation";
import { OpeningBalanceDetail } from "@/components/accounting/opening-balance-detail";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { getOpeningBalance } from "@/lib/siba/opening-balance";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePermission(
    "OPENING_BALANCE_VIEW",
    "/accounting/opening-balance"
  );

  // A snapshot of a Company this reader may not see is not found rather than
  // refused: the refusal itself would confirm the record exists.
  const opening = await getOpeningBalance(
    Number(id),
    await accessibleCompanyIds(actor.permissions)
  );
  if (!opening) notFound();

  return (
    <>
      <OpeningBalanceDetail opening={opening} />
      <RecordHistoryCard entityKey="acc_opening_balance" rowId={opening.id} />
    </>
  );
}
