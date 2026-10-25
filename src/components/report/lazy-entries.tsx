"use client";

import { useState } from "react";
import { ENTRY_PAGE_SIZE } from "@/lib/siba/register-query";

/**
 * What a report block has loaded of its entries, and how it loads the rest.
 *
 * A report states each block's rollup and leaves the rows to be fetched when the
 * block is opened — the first page — and then a page at a time on request. The
 * fetching is the report's own Server Action; this holds the pages and the
 * cursor that says where the next one starts, so the General Ledger and the
 * books share one behaviour rather than three copies of it.
 */
export type Loaded<T, C> = {
  entries: T[];
  /** Null when the last page has been read. */
  next: C | null;
  busy: boolean;
  error: string | null;
};

export type PageResult<T, C> =
  | { ok: true; entries: T[]; next: C | null }
  | { ok: false; error: string };

export function useLazyEntries<T, C, K extends string | number>(
  fetchPage: (key: K, cursor: C | null) => Promise<PageResult<T, C>>
) {
  const [loaded, setLoaded] = useState<Record<string, Loaded<T, C>>>({});

  /** `initial` is for a report that arrived with its entries already in it. */
  const get = (key: K, initial: T[] = []): Loaded<T, C> | null =>
    loaded[String(key)] ??
    (initial.length ? { entries: initial, next: null, busy: false, error: null } : null);

  const more = async (key: K, initial: T[] = []) => {
    const have = get(key, initial);
    if (have?.busy) return;
    const entries = have?.entries ?? [];
    const cursor = have?.next ?? null;
    setLoaded((prev) => ({
      ...prev,
      [String(key)]: { entries, next: cursor, busy: true, error: null },
    }));
    const result = await fetchPage(key, cursor);
    setLoaded((prev) => ({
      ...prev,
      [String(key)]: result.ok
        ? { entries: [...entries, ...result.entries], next: result.next, busy: false, error: null }
        : { entries, next: cursor, busy: false, error: result.error },
    }));
  };

  return { get, more };
}

/**
 * The row under a block's entries that says what is still to come: the wait for
 * the first page, or the button for the next one.
 */
export function LazyRows<T, C>({
  colSpan,
  total,
  have,
  onMore,
}: {
  colSpan: number;
  /** How many entries the period holds. */
  total: number;
  have: Loaded<T, C> | null;
  onMore: () => void;
}) {
  if (total === 0) return null;

  if (!have) {
    return (
      <tr>
        <td colSpan={colSpan} className="mut" style={{ textAlign: "center" }}>
          Memuat mutasi…
        </td>
      </tr>
    );
  }
  if (!have.next && !have.busy && !have.error) return null;

  const left = total - have.entries.length;
  return (
    <tr>
      <td colSpan={colSpan} style={{ textAlign: "center" }}>
        {have.error ? <span className="err">{have.error} </span> : null}
        <button type="button" className="btn sm" disabled={have.busy} onClick={onMore}>
          {have.busy
            ? "Memuat…"
            : `Muat ${Math.min(ENTRY_PAGE_SIZE, left)} mutasi berikutnya (${left} tersisa)`}
        </button>
      </td>
    </tr>
  );
}
