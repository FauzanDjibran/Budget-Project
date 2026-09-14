import { notFound } from "next/navigation";
import { EntityForm } from "@/components/master/entity-form";
import { EntityLocked } from "@/components/master/entity-locked";
import { requirePermission } from "@/lib/siba/auth";
import { isCompanyEntity } from "@/lib/siba/company";
import { abilitiesFor, entityPermissions } from "@/lib/siba/entity-access";
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
  // Reading the explanation still needs permission to see the entity at all.
  if (isCompanyEntity(entity.slug)) {
    await requirePermission(
      entityPermissions(entity.key).view,
      `/${entity.module}/${entity.slug}/new`
    );
    return (
      <EntityLocked
        entity={entity}
        mode="new"
        backHref={`/${entity.module}/${entity.slug}`}
      />
    );
  }

  const create = entityPermissions(entity.key).create;
  if (!create) notFound();
  const actor = await requirePermission(create, `/${entity.module}/${entity.slug}/new`);

  const refs = await refOptions(entity);

  return (
    <EntityForm
      entity={entity}
      mode="new"
      row={null}
      refs={refs}
      can={abilitiesFor(entity.key, actor.permissions)}
    />
  );
}
