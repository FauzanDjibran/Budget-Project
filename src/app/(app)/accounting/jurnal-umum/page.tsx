import { GeneralJournalList } from "@/components/accounting/general-journal-list";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { listGeneralJournals } from "@/lib/siba/general-journal-rows";
import { generalJournalAbilities } from "@/lib/siba/general-journal-workflow";

export const dynamic = "force-dynamic";

/** The Jurnal Umum register, every Company this reader may see. */
export default async function Page() {
  const actor = await requirePermission("JOURNAL_GENERAL_VIEW", "/accounting/jurnal-umum");
  return (
    <GeneralJournalList
      rows={await listGeneralJournals(await accessibleCompanyIds(actor.permissions))}
      can={generalJournalAbilities(actor.permissions)}
    />
  );
}
