import { notFound } from "next/navigation";
import { EntityList } from "@/components/master/entity-list";
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
    <EntityList entity={entity} rows={rows} refs={refs} computed={computed} />
  );
}
