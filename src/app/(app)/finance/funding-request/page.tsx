import { FundingList } from "@/components/finance/funding-list";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import { financeRefs, purposeOptions } from "@/lib/siba/finance";
import { listFundingRequests, summariseFunding } from "@/lib/siba/funding";

export const dynamic = "force-dynamic";

/**
 * `?status=` opens the register already filtered, so a dashboard tile can name
 * a queue rather than dropping the reader into the whole list — the same
 * reason a Report View carries its parameters in the URL (CLAUDE.md §12).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requirePermission(
    "FUNDING_REQUEST_VIEW",
    "/finance/funding-request"
  );

  const { status } = await searchParams;
  const requests = await listFundingRequests();
  const [refs, summary] = await Promise.all([
    financeRefs(),
    summariseFunding(requests),
  ]);

  return (
    <FundingList
      requests={requests}
      refs={refs}
      purposes={await purposeOptions()}
      summary={summary}
      canConfirm={actorCan(actor, "FUNDING_REQUEST_CONFIRM")}
      initialStatus={status}
    />
  );
}
