import { notFound } from "next/navigation";
import { DncnForm } from "@/components/finance/dncn-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { dncnRefs, getNote, noteLines } from "@/lib/siba/dncn";
import { dncnAbilities, dncnIsEditable } from "@/lib/siba/dncn-workflow";

export const dynamic = "force-dynamic";

/**
 * A note stops being editable once it leaves Draft. `updateDncn` refuses the
 * same request on its own, so this is convenience, not the protection.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("DNCN_EDIT", `/finance/debit-credit-note/${id}/edit`);

  const note = await getNote(Number(id));
  if (!note || !dncnIsEditable(note.status)) notFound();

  const companyIds = await accessibleCompanyIds(actor.permissions);
  if (!companyIds.includes(note.company_id)) notFound();

  const [lines, refs] = await Promise.all([noteLines(note.id), dncnRefs(companyIds)]);

  return (
    <>
      <DncnForm mode="edit" note={note} lines={lines} refs={refs} can={dncnAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_dncn" rowId={note.id} />
    </>
  );
}
