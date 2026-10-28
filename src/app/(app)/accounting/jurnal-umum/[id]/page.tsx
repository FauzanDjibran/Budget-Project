import { notFound } from "next/navigation";
import { GeneralJournalForm } from "@/components/accounting/general-journal-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { getGeneralJournal } from "@/lib/siba/general-journal-rows";
import { generalJournalAbilities } from "@/lib/siba/general-journal-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("JOURNAL_GENERAL_VIEW", "/accounting/jurnal-umum");
  // Another Company's journal reads as not found, never as refused.
  const journal = await getGeneralJournal(Number(id), await accessibleCompanyIds(actor.permissions));
  if (!journal) notFound();
  return (
    <>
      <GeneralJournalForm mode="view" journal={journal} can={generalJournalAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="acc_general_journal" rowId={journal.id} />
    </>
  );
}
