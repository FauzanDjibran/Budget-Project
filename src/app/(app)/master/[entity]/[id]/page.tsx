import { notFound } from "next/navigation";
import { EntityForm } from "@/components/master/entity-form";
import { entityBySlug } from "@/lib/siba/entities";
import { getRow, refOptions } from "@/lib/siba/records";
import { userEmails } from "@/lib/siba/users";

export const dynamic = "force-dynamic";

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity: slug, id } = await params;
  const entity = entityBySlug(slug);
  if (!entity) notFound();

  const row = await getRow(entity, Number(id));
  if (!row) notFound();

  const refs = await refOptions(entity);
  const emails = await userEmails([row.created_by as number, row.updated_by as number]);

  return (
    <EntityForm
      entity={entity}
      mode="view"
      row={row}
      refs={refs}
      createdByEmail={emails[row.created_by as number]}
      updatedByEmail={emails[row.updated_by as number]}
    />
  );
}
