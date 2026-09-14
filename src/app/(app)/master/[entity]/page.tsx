import { notFound } from "next/navigation";
import { EntityList } from "@/components/master/entity-list";
import { requirePermission } from "@/lib/siba/auth";
import { abilitiesFor, entityPermissions } from "@/lib/siba/entity-access";
import { entityBySlug } from "@/lib/siba/entities";
import { computedValues, listRows, refOptions, optionsFor } from "@/lib/siba/records";

export const dynamic = "force-dynamic";

export default async function EntityListPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity: slug } = await params;
  const entity = entityBySlug(slug);
  if (!entity) notFound();

  // Reading the list is its own permission, checked before a single row is read.
  const actor = await requirePermission(
    entityPermissions(entity.key).view,
    `/${entity.module}/${entity.slug}`
  );

  const rows = await listRows(entity);
  const refs = await refOptions(entity);
  const computed = await computedValues(entity, rows);

  // Columns can reference entities the form never edits, so top those up.
  for (const column of entity.columns) {
    const field = entity.fields.find((f) => f.name === column.field);
    if (field?.ref && !refs[field.ref]) {
      refs[field.ref] = await optionsFor(field.ref);
    }
  }

  return (
    <EntityList
      entity={entity}
      rows={rows}
      refs={refs}
      computed={computed}
      can={abilitiesFor(entity.key, actor.permissions)}
    />
  );
}
