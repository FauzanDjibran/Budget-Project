import { EntityNewPage } from "@/components/master/entity-pages";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity } = await params;
  return <EntityNewPage module="settings" slug={entity} />;
}
