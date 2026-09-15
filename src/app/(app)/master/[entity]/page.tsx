import { EntityListPage } from "@/components/master/entity-pages";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<{ company?: string }>;
}) {
  const { entity } = await params;
  const { company } = await searchParams;
  return <EntityListPage module="master" slug={entity} company={company} />;
}
