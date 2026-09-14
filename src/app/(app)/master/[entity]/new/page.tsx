import { notFound } from "next/navigation";
import { EntityForm } from "@/components/master/entity-form";
import { EntityLocked } from "@/components/master/entity-locked";
import { isCompanyEntity } from "@/lib/siba/company";
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

  // Company is create-locked — the route renders an explanation, never a form.
  if (isCompanyEntity(entity.slug)) {
    return (
      <EntityLocked
        entity={entity}
        mode="new"
        backHref={`/${entity.module}/${entity.slug}`}
      />
    );
  }

  const refs = await refOptions(entity);

  return <EntityForm entity={entity} mode="new" row={null} refs={refs} />;
}
