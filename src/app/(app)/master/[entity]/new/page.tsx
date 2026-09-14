import { notFound } from "next/navigation";
import { EntityForm } from "@/components/master/entity-form";
import { entityBySlug } from "@/lib/siba/entities";
import { refOptions } from "@/lib/siba/records";

export const dynamic = "force-dynamic";

export default async function NewEntityPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity: slug } = await params;
  const entity = entityBySlug(slug);
  if (!entity) notFound();

  const refs = await refOptions(entity);

  return <EntityForm entity={entity} mode="new" row={null} refs={refs} />;
}
