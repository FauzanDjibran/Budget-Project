/**
 * Where a document named by its weak `(doc_type, doc_id)` pair is read.
 *
 * A journal points at the document that produced it through that pair rather
 * than a relation (CLAUDE.md §3), so the book never learns another module's
 * routes. The screen that shows the journal does, and asks here — keyed on the
 * document type's `doc_table`, which is stable, never on its label.
 *
 * Client-safe: a map of strings and nothing else.
 */
const ROUTES: Record<string, string> = {
  // A realization lives under one of two menus, and the pair does not say
  // which. Either route answers for any realization: the page sends a document
  // opened under the other menu's route to its own.
  fin_cash_bank_transaction: "/finance/realisasi-pengeluaran",
  fin_funding_request: "/finance/funding-request",
  fin_cash_bank_transfer: "/finance/cash-bank-transfer",
  fin_dncn: "/finance/debit-credit-note",
  fin_item_conversion: "/finance/pencairan-open-item",
  acc_fiscal_year: "/accounting/fiscal-year",
  acc_opening_balance: "/accounting/opening-balance",
};

/** The page a source document is read on, or null when it has none. */
export function documentHref(table: string | null, id: number | null): string | null {
  if (!table || !id) return null;
  const base = ROUTES[table];
  return base ? `${base}/${id}` : null;
}
