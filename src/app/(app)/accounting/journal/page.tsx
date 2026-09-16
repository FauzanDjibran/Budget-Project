import { JournalList } from "@/components/accounting/journal-list";
import { requirePermission } from "@/lib/siba/auth";
import { companyScope } from "@/lib/siba/company-access";
import { listJournals } from "@/lib/siba/journal";

export const dynamic = "force-dynamic";

/**
 * The Journal register. Read-only: a journal is written by a posting and is
 * never edited afterwards, so there is no create route and no edit route —
 * `/accounting/journal/[id]` is the only thing below this page.
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
    />
  );
}
