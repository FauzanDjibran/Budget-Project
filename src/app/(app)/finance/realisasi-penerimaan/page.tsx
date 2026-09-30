import { RealizationListPage } from "@/components/finance/realization-pages";

export const dynamic = "force-dynamic";

/** `?status=` opens the register already filtered to one queue. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  return <RealizationListPage direction="In" status={status} />;
}
