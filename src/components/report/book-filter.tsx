"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";

/**
 * Which subject book the Buku Subjek report is showing.
 *
 * The six books used to be six menu entries, each its own Report View with its
 * own permission. A book is now a Budget Category that names a Partner, created
 * through Master › Klasifikasi — so enumerating them in the menu would have put
 * a deploy between a new category and its book. There is one report, and this
 * is how you move between the books inside it.
 *
 * It navigates on change rather than waiting for *Tampilkan*, like the Company
 * filter beside it and for the same reason: the book is what the report is
 * *about*, not a filter narrowing it, and the Partner list below depends on it.
 * Changing the book therefore **clears the chosen Partners** — they belong to
 * the book that was open, and carrying them across would silently ask for
 * subjects that may hold no position in the new one.
 */
export function BookFilter({
  books,
  selectedKey,
}: {
  books: { key: string; name: string }[];
  selectedKey: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  // One book is not a choice — the same rule the Company filter follows. It
  // still renders nothing rather than a disabled control, because the report
  // title already says which book is open.
  if (books.length < 2) return null;

  const onChange = (value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("book", value);
    next.delete("partners");
    router.push(`?${next.toString()}`);
  };

  return (
    <Select
      variant="toolbar"
      value={selectedKey}
      onChange={onChange}
      title="Buku subjek yang ditampilkan"
      ariaLabel="Buku"
      options={books.map((b) => ({ value: b.key, label: b.name }))}
    />
  );
}
