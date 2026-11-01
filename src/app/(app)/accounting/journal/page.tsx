import { JournalList } from "@/components/accounting/journal-list";
import { requirePermission } from "@/lib/siba/auth";
import { companyScope } from "@/lib/siba/company-access";
import { listJournals } from "@/lib/siba/journal";
import { parseRegisterQuery } from "@/lib/siba/register-query";
import { generalJournalAbilities } from "@/lib/siba/general-journal-workflow";

export const dynamic = "force-dynamic";

/**
 * The Journal register.
 *
 * Every journal lives here: those a posting produced, final from the moment
 * they exist, and typed ones, which Jurnal Umum drafts, edits and posts.
 *
 * One Company at a time, chosen from the Companies this reader's permissions
 * open. Each Company keeps its own books and its own chart of accounts, so a
 * register holding both reads as one set of duplicated rows — the same reason
 * the Chart of Accounts tree shows one Company (CLAUDE.md §12).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePermission("JOURNAL_VIEW", "/accounting/journal");
  const params = await searchParams;
  const company = Array.isArray(params.company) ? params.company[0] : params.company;
  const origin = Array.isArray(params.origin) ? params.origin[0] : params.origin;
  const scope = await companyScope(actor.permissions, company);
  const journals = scope.selected
    ? await listJournals(
        [scope.selected.id],
        parseRegisterQuery(params, ["Draft", "Posted", "Cancelled"]),
        origin === "manual" || origin === "auto" ? origin : ""
      )
    : null;
  return (
    <JournalList
      journals={journals}
      companies={scope.options}
      companyId={scope.selected?.id ?? null}
      can={generalJournalAbilities(actor.permissions)}
    />
  );
}
