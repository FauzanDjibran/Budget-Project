"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * A register's search, status and page, kept in the URL.
 *
 * The server reads the same parameters (`parseRegisterQuery`), so changing one
 * here re-renders the page with a different query rather than filtering rows
 * the browser already holds. Typing is debounced — a keystroke per request
 * would be a query per letter — and any change but the page itself returns to
 * page 1.
 */
export function useRegisterParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";

  const set = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "" || (key === "page" && value === 1)) next.delete(key);
      else next.set(key, String(value));
    }
    const query = next.toString();
    start(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  // The text in the box leads the URL by one debounce, and follows it when
  // something else (Bersihkan filter) changes it.
  const [text, setText] = useState(q);
  const [seen, setSeen] = useState(q);
  if (seen !== q) {
    setSeen(q);
    setText(q);
  }
  useEffect(() => {
    if (text.trim() === q) return;
    const timer = setTimeout(() => set({ q: text.trim(), page: null }), 300);
    return () => clearTimeout(timer);
    // `set` closes over the params it was built from; the text is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return {
    q,
    status,
    pending,
    search: { value: text, onChange: setText },
    /** Any other facet the register offers, such as `origin`. */
    param: (key: string) => params.get(key) ?? "",
    setParam: (key: string, value: string) => set({ [key]: value, page: null }),
    setStatus: (value: string) => set({ status: value, page: null }),
    setPage: (page: number) => set({ page }),
    setSize: (size: number) => set({ size, page: null }),
    /** Clears the search, the status and any extra facets named. */
    clear: (...extra: string[]) => {
      setText("");
      set({ q: null, status: null, page: null, ...Object.fromEntries(extra.map((k) => [k, null])) });
    },
  };
}
