import { notFound } from "next/navigation";
import { FundingDetail } from "@/components/finance/funding-detail";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import { financeRefs, transactionLines } from "@/lib/siba/finance";
import {
  getFundingRequest,
  providerCashBanks,
} from "@/lib/siba/funding";
import { realizationOf } from "@/lib/siba/realization";
import { intercompanyBridge } from "@/lib/siba/system-account-data";
import { RecordHistoryCard } from "@/components/ui/record-history-card";

export const dynamic = "force-dynamic";

/**
 * One Funding Request, with everything the induk needs to answer it.
 *
 * The resources offered are already narrowed to the request's own currency, and
 * the bridge settings are resolved here so the screen can say what is missing
 * *before* somebody presses the button — `confirmFundingRequest` refuses the
 * same request on its own, so this is the explanation rather than the
 * protection.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePermission(
    "FUNDING_REQUEST_VIEW",
    `/finance/funding-request/${id}`
  );

  const request = await getFundingRequest(Number(id));
  if (!request) notFound();

  const doc = request.transaction;

  const [lines, refs, resources, bridge] = await Promise.all([
    doc ? transactionLines(doc.id) : Promise.resolve([]),
    financeRefs(),
    providerCashBanks(request.currency_id),
    intercompanyBridge(),
  ]);

  const provider = request.provider_cash_bank_id
    ? refs.cashBanks.find((c) => c.id === request.provider_cash_bank_id) ?? null
    : null;

  return (
    <>
      <FundingDetail
        request={request}
        lines={lines}
        resources={resources}
        companyLabel={
          refs.companies.find((c) => c.id === doc?.company_id)?.label ?? "anak"
        }
        currencyLabel={
          refs.currencies.find((c) => c.id === request.currency_id)?.label ?? "IDR"
        }
        purposeLabel={doc ? realizationOf(doc.transaction_type).title : "—"}
        partnerLabel={null}
        providerLabel={provider ? `${provider.label} - ${provider.name}` : null}
        bridgeMissing={bridge.ok ? [] : bridge.missing}
        canConfirm={actorCan(actor, "FUNDING_REQUEST_CONFIRM")}
      />
      <RecordHistoryCard entityKey="fin_funding_request" rowId={request.id} />
    </>
  );
}
