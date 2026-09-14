import { notFound } from "next/navigation";
import { EntityForm } from "@/components/master/entity-form";
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

  const row = await getRow(entity, Number(id));
  if (!row) notFound();

  const refs = await refOptions(entity);

  return <EntityForm entity={entity} mode="edit" row={row} refs={refs} />;
}
