import { notFound } from "next/navigation";
import { EntityForm } from "@/components/master/entity-form";
import { EntityLocked } from "@/components/master/entity-locked";
import { requirePermission } from "@/lib/siba/auth";
import { isCompanyEntity } from "@/lib/siba/company";
import { abilitiesFor, entityPermissions } from "@/lib/siba/entity-access";
import { entityBySlug } from "@/lib/siba/entities";
import { getRow, refOptions } from "@/lib/siba/records";

export const dynamic = "force-dynamic";

export default async function EntityEditPage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity: slug, id } = await params;
  const entity = entityBySlug(slug);
  if (!entity) notFound();

  // A locked entity explains itself rather than demanding an edit permission
  // nobody can hold — but reading that explanation still requires being allowed
  // to see the entity in the first place.
  if (isCompanyEntity(entity.slug)) {
    await requirePermission(
      entityPermissions(entity.key).view,
      `/${entity.module}/${entity.slug}/${id}/edit`
    );
  } else {
    const edit = entityPermissions(entity.key).edit;
    if (!edit) notFound();
    await requirePermission(edit, `/${entity.module}/${entity.slug}/${id}/edit`);
  }

  const row = await getRow(entity, Number(id));
  if (!row) notFound();

  // Company is edit-locked — the route renders an explanation, never a form.
  if (isCompanyEntity(entity.slug)) {
    const label = entity.labelField ? String(row[entity.labelField] ?? "") : "";
    const name = String(row[entity.nameField] ?? "");
    return (
      <EntityLocked
        entity={entity}
        mode="edit"
        subject={label ? `${label} – ${name}` : name}
        backHref={`/${entity.module}/${entity.slug}/${row.id}`}
      />
    );
  }

  const actor = await requirePermission(
    entityPermissions(entity.key).edit!,
    `/${entity.module}/${entity.slug}/${id}/edit`
  );
  const refs = await refOptions(entity);

  return (
    <EntityForm
      entity={entity}
      mode="edit"
      row={row}
      refs={refs}
      can={abilitiesFor(entity.key, actor.permissions)}
    />
  );
}
