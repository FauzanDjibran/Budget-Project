import { FundingList } from "@/components/finance/funding-list";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import { financeRefs, purposeOptions } from "@/lib/siba/finance";
import { listFundingRequests, summariseFunding } from "@/lib/siba/funding";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission(
    "FUNDING_REQUEST_VIEW",
    "/finance/funding-request"
  );

  const requests = await listFundingRequests();
  const [refs, summary] = await Promise.all([
    financeRefs(),
    summariseFunding(requests),
  ]);

  return (
    <FundingList
      requests={requests}
      refs={refs}
      purposes={purposeOptions()}
      summary={summary}
      canConfirm={actorCan(actor, "FUNDING_REQUEST_CONFIRM")}
    />
  );
}
