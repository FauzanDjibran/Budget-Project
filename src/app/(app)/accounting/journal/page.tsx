import { JournalList } from "@/components/accounting/journal-list";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { listJournals } from "@/lib/siba/journal";

export const dynamic = "force-dynamic";

/**
 * The Journal register. Read-only: a journal is written by a posting and is
 * never edited afterwards, so there is no create route and no edit route —
 * `/accounting/journal/[id]` is the only thing below this page.
 */
export default async function Page() {
  const actor = await requirePermission("JOURNAL_VIEW", "/accounting/journal");
  const journals = await listJournals(
    await accessibleCompanyIds(actor.permissions)
  );
  return <JournalList journals={journals} />;
}
