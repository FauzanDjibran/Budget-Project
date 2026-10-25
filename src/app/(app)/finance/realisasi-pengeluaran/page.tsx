import { RealizationListPage } from "@/components/finance/realization-pages";

export const dynamic = "force-dynamic";

/** `?status=`, `?q=`, `?page=` and `?size=` are the register's query. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <RealizationListPage direction="Out" params={params} />;
}
