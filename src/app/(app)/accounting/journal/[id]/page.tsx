import { notFound } from "next/navigation";
import { JournalDetail } from "@/components/accounting/journal-detail";
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

  return <JournalDetail journal={journal} />;
}
