/**
 * The document-number format, in one place.
 *
 * Documents are numbered `PREFIX-0001` — deliberately not the `prefix.0000`
 * system-code shape `nextCode()` produces for master records, so a document
 * number is recognisable on sight (CLAUDE.md §9).
 *
 * Four modules used to carry their own copy of this, in three different
 * shapes: two of them loaded *every* row in the table to find a maximum, which
 * is a read that grows without bound, and each spelled the parsing slightly
 * differently. The format now lives here; the query stays with the module that
 * owns the table, which is why `nextDocumentNumber` takes a reader rather than
 * a Prisma delegate. A shared helper that reached into four tables would be
 * exactly the boundary violation this change exists to remove.
 *
 * Deliberately free of `server-only` and of any database import.
 */

/** `BGT` + 1 -> `BGT-0001`. Padded to four digits, and simply longer beyond. */
export function formatDocumentNumber(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

/**
 * The numeric tail of a document number, or 0 for anything unreadable.
 *
 * Splits on the first `-` so a prefix is free to contain one later.
 */
export function documentSequence(documentNo: string | null | undefined): number {
  if (!documentNo) return 0;
  const dash = documentNo.indexOf("-");
  if (dash < 0) return 0;
  const n = Number(documentNo.slice(dash + 1));
  return Number.isFinite(n) ? n : 0;
}

/**
 * The next number for a series.
 *
 * `highest` returns the current highest-numbered document, which every caller
 * answers with a single `findFirst` ordered by `id` descending: numbers are
 * assigned as "highest + 1" at insert, so id order and number order are the
 * same, and ordering by the number column itself would go wrong at `-10000`.
 *
 * This is not a reservation. Two concurrent callers can read the same highest
 * number, and the second insert then fails on the column's unique constraint
 * rather than silently duplicating — the safe failure, and the reason every
 * document-number column is `@unique`.
 */
export async function nextDocumentNumber(
  prefix: string,
  highest: () => Promise<string | null>
): Promise<string> {
  return formatDocumentNumber(prefix, documentSequence(await highest()) + 1);
}
