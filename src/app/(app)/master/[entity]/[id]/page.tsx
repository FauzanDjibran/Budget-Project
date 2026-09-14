import { notFound } from "next/navigation";
import { EntityForm } from "@/components/master/entity-form";
import { requirePermission } from "@/lib/siba/auth";
import { abilitiesFor, entityPermissions } from "@/lib/siba/entity-access";
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

  const actor = await requirePermission(
    entityPermissions(entity.key).view,
    `/${entity.module}/${entity.slug}/${id}`
  );

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
      can={abilitiesFor(entity.key, actor.permissions)}
    />
  );
}
