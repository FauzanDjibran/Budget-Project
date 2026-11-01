import { notFound, redirect } from "next/navigation";
import { JournalForm } from "@/components/accounting/journal-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { getJournal } from "@/lib/siba/journal";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePermission("JOURNAL_VIEW", "/accounting/journal");

  // A journal of a Company this reader may not see is not found rather than
  // refused: the refusal itself would confirm the record exists.
  const journal = await getJournal(
    Number(id),
    await accessibleCompanyIds(actor.permissions)
  );
  if (!journal) notFound();
  // A typed journal is drafted, edited and posted in Jurnal Umum.
  if (journal.isManual) redirect(`/accounting/jurnal-umum/${journal.id}`);

  return (
    <>
      <JournalForm journal={journal} />
      <RecordHistoryCard entityKey="acc_journal" rowId={journal.id} />
    </>
  );
}
