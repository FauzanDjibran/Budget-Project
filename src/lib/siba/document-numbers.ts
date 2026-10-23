import "server-only";

import { documentNumbers as transaction } from "./finance";
import { documentNumbers as funding } from "./funding";
import { documentNumbers as transfer } from "./transfer";
import { documentNumbers as adjustment } from "./item-adjustment";
import { documentNumbers as conversion } from "./item-conversion";
import { documentNumbers as reclass } from "./item-reclass";
import { documentNumbers as revaluation } from "./cash-bank-revaluation";

/**
 * The number of the document a book entry came from. A book holds only the weak
 * `(doc_table, doc_id)` pair and cannot name another module's table (§3), so the
 * report page asks here — each owner answers for its own table.
 */
const OWNERS: Record<string, (ids: number[]) => Promise<Map<number, string>>> = {
  fin_cash_bank_transaction: transaction,
  fin_funding_request: funding,
  fin_cash_bank_transfer: transfer,
  fin_item_adjustment: adjustment,
  fin_item_conversion: conversion,
  fin_item_reclass: reclass,
  fin_cash_bank_revaluation: revaluation,
};

type Sourced = { sourceDocTable: string | null; sourceDocId: number | null; sourceDocNo: string | null };

/** Sets `sourceDocNo` on every entry whose source document has a known owner. */
export async function attachDocumentNumbers(entries: Sourced[]): Promise<void> {
  const byTable = new Map<string, Set<number>>();
  for (const e of entries) {
    if (e.sourceDocTable && e.sourceDocId && OWNERS[e.sourceDocTable]) {
      byTable.set(e.sourceDocTable, (byTable.get(e.sourceDocTable) ?? new Set()).add(e.sourceDocId));
    }
  }
  const found = new Map<string, Map<number, string>>();
  await Promise.all(
    [...byTable].map(async ([table, ids]) => found.set(table, await OWNERS[table]([...ids])))
  );
  for (const e of entries) {
    e.sourceDocNo = (e.sourceDocTable && e.sourceDocId && found.get(e.sourceDocTable)?.get(e.sourceDocId)) || null;
  }
}
