"use server";

import { isAccessDenied } from "@/lib/siba/auth-errors";
import { authorizeAction } from "@/lib/siba/auth";
import { cashBankEntriesPage, type LedgerEntryRow } from "@/lib/siba/cash-bank";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { attachDocumentNumbers } from "@/lib/siba/document-numbers";
import type { BookCursor } from "@/lib/siba/register-query";
import { subledgerEntriesPage, type SubledgerEntryRow } from "@/lib/siba/subledger-reports";
import { loadSubledgers } from "@/lib/siba/subledger-data";

type Page<T> = { ok: true; entries: T[]; next: BookCursor | null } | { ok: false; error: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const invalid = { ok: false, error: "Permintaan tidak valid." } as const;

function cursorOk(cursor: BookCursor | null): boolean {
  return !cursor || (DAY.test(cursor.date) && Number.isInteger(cursor.id));
}

/**
 * One page of a Cash & Bank's entries, read when its block is opened.
 *
 * The same permission and Company scope as the report; a resource outside the
 * reader's Companies reads as not found.
 */
export async function loadCashBankEntries(
  cashBankId: number,
  from: string,
  to: string,
  cursor: BookCursor | null
): Promise<Page<LedgerEntryRow>> {
  let permissions;
  try {
    ({ permissions } = await authorizeAction("REPORT_CASH_BANK_LEDGER_VIEW"));
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, error: error.message };
    throw error;
  }
  if (!Number.isInteger(cashBankId) || !DAY.test(from) || !DAY.test(to) || !cursorOk(cursor)) {
    return invalid;
  }

  const page = await cashBankEntriesPage(
    cashBankId,
    { from, to },
    await accessibleCompanyIds(permissions),
    cursor
  );
  if (!page) return { ok: false, error: "Cash & Bank tidak ditemukan." };
  await attachDocumentNumbers(page.entries);
  return { ok: true, ...page };
}

/** One page of a subject book's entries for one Partner and currency. */
export async function loadSubjectEntries(
  bookId: number,
  partnerId: number,
  currencyId: number,
  from: string,
  to: string,
  cursor: BookCursor | null
): Promise<Page<SubledgerEntryRow>> {
  let permissions;
  try {
    ({ permissions } = await authorizeAction("REPORT_SUBLEDGER_VIEW"));
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, error: error.message };
    throw error;
  }
  if (
    !Number.isInteger(bookId) ||
    !Number.isInteger(partnerId) ||
    !Number.isInteger(currencyId) ||
    !DAY.test(from) ||
    !DAY.test(to) ||
    !cursorOk(cursor)
  ) {
    return invalid;
  }

  const page = await subledgerEntriesPage(
    await loadSubledgers(),
    bookId,
    partnerId,
    currencyId,
    { from, to },
    await accessibleCompanyIds(permissions),
    cursor
  );
  if (!page) return { ok: false, error: "Buku atau Partner tidak ditemukan." };
  await attachDocumentNumbers(page.entries);
  return { ok: true, ...page };
}
