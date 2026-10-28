import { GeneralJournalForm } from "@/components/accounting/general-journal-form";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanies } from "@/lib/siba/company-access";
import { generalJournalOptions } from "@/lib/siba/general-journal-rows";

export const dynamic = "force-dynamic";

/** A new Jurnal Umum, its options loaded for the Company the form starts on. */
export default async function Page() {
  const actor = await requirePermission("JOURNAL_GENERAL_CREATE", "/accounting/jurnal-umum/new");
  const companies = await accessibleCompanies(actor.permissions);
  const options = companies.length ? await generalJournalOptions(companies[0].id) : undefined;
  return <GeneralJournalForm mode="new" journal={null} companies={companies} options={options} />;
}
