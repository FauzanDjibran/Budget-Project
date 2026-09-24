"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";

export const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * Client-side paging state for a list that holds every row in memory.
 * `current` is clamped, so a filter that shrinks the list never strands the
 * reader on a page that no longer exists; `resetOn` — the filter's own state —
 * sends the reader back to page 1 whenever it changes.
 */
export function usePaging<T>(rows: T[], resetOn = "", initialPerPage = 25) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(initialPerPage);
  const [seen, setSeen] = useState(resetOn);
  if (seen !== resetOn) {
    setSeen(resetOn);
    setPage(1);
  }
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(page, pages);
  const start = (current - 1) * perPage;
  return {
    page: current,
    pages,
    perPage,
    total: rows.length,
    start,
    pageRows: rows.slice(start, start + perPage),
    setPage,
    setPerPage: (n: number) => {
      setPerPage(n);
      setPage(1);
    },
  };
}

/**
 * The pager at the foot of every list that grows with use. It shows the
 * current page only — never a run of page numbers, which grows with the list
 * and stops fitting long before the list stops being useful.
 */
export function Pager({
  page,
  pages,
  total,
  perPage,
  onPage,
  onPerPage,
}: {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  onPage: (page: number) => void;
  onPerPage: (perPage: number) => void;
}) {
  return (
    <div className="pager">
      <span className="inf">
        Halaman <b>{page}</b> dari <b>{pages}</b> ({total} total)
      </span>
      <Select
        variant="compact"
        value={String(perPage)}
        ariaLabel="Baris per halaman"
        options={PAGE_SIZES.map((n) => ({ value: String(n), label: `Tampil ${n}` }))}
        onChange={(v) => onPerPage(Number(v))}
      />
      <div className="pgs">
        <button className="pg" disabled={page <= 1} onClick={() => onPage(1)} aria-label="Halaman pertama">
          «
        </button>
        <button className="pg" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Halaman sebelumnya">
          ‹
        </button>
        <span className="pg on">{page}</span>
        <button className="pg" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Halaman berikutnya">
          ›
        </button>
        <button className="pg" disabled={page >= pages} onClick={() => onPage(pages)} aria-label="Halaman terakhir">
          »
        </button>
      </div>
    </div>
  );
}
