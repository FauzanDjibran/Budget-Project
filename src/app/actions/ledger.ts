"use server";

import { isAccessDenied } from "@/lib/siba/auth-errors";
import { authorizeAction } from "@/lib/siba/auth";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import {
  ledgerEntriesPage,
  type LedgerCursor,
  type LedgerEntryPage,
} from "@/lib/siba/ledger";

export type LedgerEntriesResult =
  | ({ ok: true } & LedgerEntryPage)
  | { ok: false; error: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One page of a General Ledger account's entries, read when the account is
 * opened rather than with the report.
 *
 * The same permission and the same Company scope as the page: an account that
 * is not in the reader's scope reads as not found, which is what one that does
 * not exist reads as.
 */
export async function loadLedgerEntries(
  accountId: number,
  from: string,
  to: string,
  cursor: LedgerCursor | null
): Promise<LedgerEntriesResult> {
  let permissions: Awaited<ReturnType<typeof authorizeAction>>["permissions"];
  try {
    ({ permissions } = await authorizeAction("REPORT_GENERAL_LEDGER_VIEW"));
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, error: error.message };
    throw error;
  }

  if (!Number.isInteger(accountId) || !DAY.test(from) || !DAY.test(to)) {
    return { ok: false, error: "Permintaan tidak valid." };
  }
  if (
    cursor &&
    (!DAY.test(cursor.date) || !Number.isInteger(cursor.journalId) || !Number.isInteger(cursor.sequenceNo))
  ) {
    return { ok: false, error: "Permintaan tidak valid." };
  }

  const page = await ledgerEntriesPage(
    accountId,
    { from, to },
    await accessibleCompanyIds(permissions),
    cursor
  );
  if (!page) return { ok: false, error: "Account tidak ditemukan." };
  return { ok: true, ...page };
}
