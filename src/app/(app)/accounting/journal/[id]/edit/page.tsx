import { notFound } from "next/navigation";
import { JournalForm } from "@/components/accounting/journal-form";
import { requirePermission } from "@/lib/siba/auth";
import {
  accessibleCompanies,
  accessibleCompanyIds,
} from "@/lib/siba/company-access";
import { getJournal } from "@/lib/siba/journal";
import { journalIsEditable, type JournalStatus } from "@/lib/siba/journal-workflow";
import { manualJournalOptions } from "@/lib/siba/manual-journal";

export const dynamic = "force-dynamic";

/**
 * Editing a manual journal.
 *
 * Only a Draft is reachable: a posted journal is final, and one produced by a
 * document's posting was never editable at all. The route refuses both rather
 * than rendering a form whose every save the Server Action would reject.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePermission(
    "JOURNAL_EDIT",
    `/accounting/journal/${id}/edit`
  );

  const journal = await getJournal(
    Number(id),
    await accessibleCompanyIds(actor.permissions)
  );
  if (!journal) notFound();
  if (!journal.isManual || !journalIsEditable(journal.status as JournalStatus)) {
    notFound();
  }

  const [companies, options] = await Promise.all([
    accessibleCompanies(actor.permissions),
    manualJournalOptions(journal.companyId),
  ]);

  return (
    <JournalForm
      mode="edit"
      journal={journal}
      companies={companies}
      options={options}
      defaultCurrencyId={null}
    />
  );
}
