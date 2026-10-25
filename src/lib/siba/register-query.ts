/**
 * What a register is asked for, carried in the URL: `?page=&size=&q=&status=`.
 *
 * A register that grows with use is paged, searched and filtered by the
 * database, so a page costs the same however many documents exist. The URL is
 * the state — a link names a queue (`?status=Draft`), the back button works, and
 * the page stays a Server Component. Client-safe, so the route that parses it
 * and the list that writes it agree on one shape.
 */

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export type RegisterQuery = {
  page: number;
  size: number;
  /** Free-text search, trimmed; empty means none. */
  q: string;
  /** One status, or empty for all. */
  status: string;
};

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/**
 * Reads the register's parameters, ignoring anything it does not recognise.
 * `statuses` is the set the register offers: a `?status=` outside it reads as
 * "all", so a stale link never produces an empty page that looks like no data.
 */
export function parseRegisterQuery(
  params: Params,
  statuses?: readonly string[]
): RegisterQuery {
  const page = Number(one(params.page));
  const size = Number(one(params.size));
  const status = one(params.status) ?? "";
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
    q: (one(params.q) ?? "").trim().slice(0, 100),
    status: !statuses || statuses.includes(status) ? status : "",
  };
}

/** One page of a register, and what the footer needs to describe it. */
export type Paged<T> = {
  rows: T[];
  /** Rows matching the query. */
  total: number;
  /** Rows the register holds before any search or status filter. */
  all: number;
  /** The page actually shown — the one asked for, clamped to what exists. */
  page: number;
  pages: number;
  size: number;
};

/** The skip/take for a query over `total` rows, with the page clamped. */
export function windowOf(total: number, query: Pick<RegisterQuery, "page" | "size">) {
  const pages = Math.max(1, Math.ceil(total / query.size));
  const page = Math.min(query.page, pages);
  return { page, pages, skip: (page - 1) * query.size, take: query.size };
}

/**
 * One page of a register: the matching count, the unfiltered count and the
 * rows, so a reader states only its own `where` and `include`.
 */
export async function pageOf<T>(
  query: RegisterQuery,
  count: (filtered: boolean) => Promise<number>,
  fetch: (skip: number, take: number) => Promise<T[]>
): Promise<Paged<T>> {
  const [total, all] = await Promise.all([count(true), count(false)]);
  const win = windowOf(total, query);
  const rows = await fetch(win.skip, win.take);
  return { rows, total, all, page: win.page, pages: win.pages, size: query.size };
}
