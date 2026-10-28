import { notFound } from "next/navigation";
import { GeneralJournalForm } from "@/components/accounting/general-journal-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanies, accessibleCompanyIds } from "@/lib/siba/company-access";
import { generalJournalOptions, getGeneralJournal } from "@/lib/siba/general-journal-rows";
import { generalJournalIsEditable } from "@/lib/siba/general-journal-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is reachable: a posted or cancelled Jurnal Umum is final. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("JOURNAL_GENERAL_EDIT", `/accounting/jurnal-umum/${id}/edit`);
  const journal = await getGeneralJournal(Number(id), await accessibleCompanyIds(actor.permissions));
  if (!journal || !generalJournalIsEditable(journal.status)) notFound();
  const [companies, options] = await Promise.all([
    accessibleCompanies(actor.permissions),
    generalJournalOptions(journal.companyId),
  ]);
  return (
    <>
      <GeneralJournalForm mode="edit" journal={journal} companies={companies} options={options} />
      <RecordHistoryCard entityKey="acc_general_journal" rowId={journal.id} />
    </>
  );
}
