/**
 * A date range, inclusive at both ends.
 *
 * This lives on its own because three unrelated modules need the shape and none
 * of them should have to depend on another to get it. It was previously
 * declared in `cash-bank.ts`, which meant the General Ledger — and the whole
 * Accounting report route — imported the Cash Bank Book for a two-field type
 * (CLAUDE.md §12, module boundaries).
 *
 * Deliberately free of `server-only` and of any database import: a report page
 * parses its parameters into one of these before any reader is called.
 */

/** `from` and `to` are `YYYY-MM-DD`, and both days are inside the period. */
export type PeriodRange = { from: string; to: string };
