import { DncnList } from "@/components/finance/dncn-list";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { listNotes, summariseNotes } from "@/lib/siba/dncn";
import { dncnAbilities } from "@/lib/siba/dncn-workflow";

export const dynamic = "force-dynamic";

/** `?status=` opens the register already filtered. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requirePermission("DNCN_VIEW", "/finance/debit-credit-note");
  const { status } = await searchParams;
  const notes = await listNotes(await accessibleCompanyIds(actor.permissions));

  return (
    <DncnList
      notes={notes}
      summary={await summariseNotes(notes)}
      can={dncnAbilities(actor.permissions)}
      initialStatus={status}
    />
  );
}
