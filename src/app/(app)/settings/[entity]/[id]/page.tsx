import { EntityDetailPage } from "@/components/master/entity-pages";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity, id } = await params;
  return <EntityDetailPage module="settings" slug={entity} id={id} />;
}
