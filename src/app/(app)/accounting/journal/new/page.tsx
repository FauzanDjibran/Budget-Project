import { JournalForm } from "@/components/accounting/journal-form";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanies } from "@/lib/siba/company-access";
import { manualJournalOptions } from "@/lib/siba/manual-journal";
import { defaultCurrencyId } from "@/lib/siba/system-settings";

export const dynamic = "force-dynamic";

/**
 * A new manual journal.
 *
 * The options are loaded for the Company the form will start on, so the first
 * line is fillable without a round trip; changing the Company re-asks for them,
 * because an account number means a different account in the other Company.
 */
export default async function Page() {
  const actor = await requirePermission(
    "JOURNAL_CREATE",
    "/accounting/journal/new"
  );

  const companies = await accessibleCompanies(actor.permissions);
  const start = companies.length ? companies[0].id : null;

  const [options, currencyId] = await Promise.all([
    start
      ? manualJournalOptions(start)
      : Promise.resolve({ accounts: [], partners: [], currencies: [] }),
    defaultCurrencyId(),
  ]);

  return (
    <JournalForm
      mode="new"
      journal={null}
      companies={companies}
      options={options}
      defaultCurrencyId={currencyId}
    />
  );
}
