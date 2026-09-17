import { JournalList } from "@/components/accounting/journal-list";
import { requirePermission } from "@/lib/siba/auth";
import { companyScope } from "@/lib/siba/company-access";
import { listJournals } from "@/lib/siba/journal";
import { journalAbilities } from "@/lib/siba/journal-workflow";

export const dynamic = "force-dynamic";

/**
 * The Journal register.
 *
 * Both kinds live here: journals a posting produced, which are final from the
 * moment they exist, and manual journals, which are drafted below this page at
 * `/new` and `/[id]/edit` and become the same thing once posted.
 *
 * One Company at a time, chosen from the Companies this reader's permissions
 * open. Each Company keeps its own books and its own chart of accounts, so a
 * register holding both reads as one set of duplicated rows — the same reason
 * the Chart of Accounts tree shows one Company (CLAUDE.md §12).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const actor = await requirePermission("JOURNAL_VIEW", "/accounting/journal");
  const { company } = await searchParams;
  const scope = await companyScope(actor.permissions, company);
  const journals = scope.selected ? await listJournals([scope.selected.id]) : [];
  return (
    <JournalList
      journals={journals}
      companies={scope.options}
      companyId={scope.selected?.id ?? null}
      can={journalAbilities(actor.permissions)}
    />
  );
}
