import { RevaluationList } from "@/components/finance/revaluation-list";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { listRevaluations, summariseRevaluations } from "@/lib/siba/cash-bank-revaluation";
import { revaluationAbilities } from "@/lib/siba/cash-bank-revaluation-workflow";

export const dynamic = "force-dynamic";

/** `?status=` opens the register already filtered. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requirePermission("CASH_BANK_REVALUATION_VIEW", "/finance/revaluasi-kurs");
  const { status } = await searchParams;
  const rows = await listRevaluations(await accessibleCompanyIds(actor.permissions));

  return (
    <RevaluationList
      rows={rows}
      summary={summariseRevaluations(rows)}
      can={revaluationAbilities(actor.permissions)}
      initialStatus={status}
    />
  );
}
