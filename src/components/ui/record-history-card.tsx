import { recordHistory } from "@/lib/siba/audit";
import { RecordHistory } from "./record-history";

/**
 * The history panel, fetching its own rows.
 *
 * A Server Component so that every page carrying a history is one line rather
 * than a query, a serialization step and a render — nine pages doing that by
 * hand is nine chances for one of them to cap differently or forget to convert
 * a `Date`, which is exactly the cross-screen drift the design-system suite
 * exists to stop.
 *
 * `Date` does not survive the server→client boundary, so timestamps cross as
 * ISO strings — the same rule `serialize()` applies to every registry row.
 */
export async function RecordHistoryCard({
  entityKey,
  rowId,
}: {
  entityKey: string;
  rowId: number;
}) {
  const { entries, total } = await recordHistory(entityKey, rowId);

  return (
    <RecordHistory
      entityKey={entityKey}
      entries={entries.map((e) => ({ ...e, at: e.at.toISOString() }))}
      total={total}
    />
  );
}
