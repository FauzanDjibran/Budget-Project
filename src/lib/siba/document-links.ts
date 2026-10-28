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
  fin_item_adjustment: "/finance/penyesuaian-open-item",
  fin_item_conversion: "/finance/pencairan-open-item",
  fin_item_reclass: "/finance/reklasifikasi-open-item",
  fin_cash_bank_revaluation: "/finance/revaluasi-kurs",
  acc_fiscal_year: "/accounting/fiscal-year",
  acc_opening_balance: "/accounting/opening-balance",
  acc_general_journal: "/accounting/jurnal-umum",
};

/**
 * What a Cash Bank Book entry was, in a reader's words. `entry_type` alone cannot
 * say it — a transfer is a `Transaction` like a Realisasi (§12) — so the source
 * document's table and the sign of the movement decide, and the type is the fallback.
 */
const KIND: Record<string, [string, string]> = {
  fin_cash_bank_transaction: ["Uang Masuk", "Uang Keluar"],
  fin_funding_request: ["Dana Anak Masuk", "Dana Anak Keluar"],
  fin_cash_bank_transfer: ["Transfer Masuk", "Transfer Keluar"],
  fin_item_conversion: ["Pencairan Open Item", "Pencairan Open Item"],
  acc_general_journal: ["Jurnal Umum", "Jurnal Umum"],
};
const TYPE_KIND: Record<string, string> = {
  Opening: "Saldo Awal",
  Adjustment: "Penyesuaian",
  Revaluation: "Revaluasi Kurs",
};

export function entryKindText(type: string, table: string | null, movement: number): string | null {
  const byDoc = table && KIND[table];
  if (byDoc) return movement > 0 ? byDoc[0] : byDoc[1];
  if (table === "fin_cash_bank_revaluation") return "Revaluasi Kurs";
  return TYPE_KIND[type] ?? null;
}

/** The page a source document is read on, or null when it has none. */
export function documentHref(table: string | null, id: number | null): string | null {
  if (!table || !id) return null;
  const base = ROUTES[table];
  return base ? `${base}/${id}` : null;
}
