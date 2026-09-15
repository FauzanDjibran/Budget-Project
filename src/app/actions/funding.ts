"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/siba/access";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import {
  confirmFundingRequest,
  raiseFundingRequest,
  withdrawFundingRequest,
} from "@/lib/siba/funding";

/**
 * Funding Request writes — the intercompany bridge's one write path.
 *
 * Three actions, and each is one side of the same business event:
 *
 *  1. **`requestFunding`** — the anak submits its realization. The document
 *     freezes at Pending and a request opens. Nothing moves.
 *  2. **`withdrawFunding`** — the anak takes it back while it is still open.
 *     Still nothing moves; the request closes as Cancelled with the document.
 *  3. **`confirmFunding`** — the induk names a resource and confirms. This is
 *     the actual boundary for **both** Companies (concept doc §30): one
 *     transaction writes the induk's cash entry, both Companies' subject books,
 *     a journal each, every Budget's realization, the document's own status,
 *     and the request's closure.
 *
 * There is no reject. The induk always complies (§29), so its action is a
 * confirmation and the only refusals are mechanical — a request already
 * answered, an unfinished bridge, a resource in the wrong currency, a Budget
 * that has closed since. Each refuses before anything is written.
 *
 * The rules live in `lib/siba/funding.ts` rather than here, so the test suite
 * can exercise the real path: an action resolves a caller from a session
 * cookie, which a test process does not have.
 */

export type FundingActionResult =
  | { ok: true; message: string }
  | { ok: false; errors: Record<string, string> };

type Guard =
  | { ok: true; actor: Actor }
  | { ok: false; denial: { ok: false; errors: Record<string, string> } };

/** Refusals come back as a `_form` error, and never name the permission code. */
async function authorize(code: string): Promise<Guard> {
  try {
    return { ok: true, actor: await authorizeAction(code) };
  } catch (error) {
    if (isAccessDenied(error)) {
      return { ok: false, denial: { ok: false, errors: { _form: error.message } } };
    }
    throw error;
  }
}

export async function requestFunding(
  transactionId: number
): Promise<FundingActionResult> {
  const g = await authorize("CASH_BANK_TRANSACTION_SUBMIT");
  if (!g.ok) return g.denial;

  const result = await raiseFundingRequest(transactionId, g.actor.user.id);
  if (!result.ok) return result;

  revalidateFunding(transactionId);
  return {
    ok: true,
    message: `Funding Request ${result.funding_request_no} dibuat`,
  };
}

export async function withdrawFunding(
  transactionId: number
): Promise<FundingActionResult> {
  // The same permission that cancels any document: withdrawing is cancelling
  // one's own realization, not overruling the Company that would have funded it.
  const g = await authorize("CASH_BANK_TRANSACTION_CANCEL");
  if (!g.ok) return g.denial;

  const result = await withdrawFundingRequest(transactionId, g.actor.user.id);
  if (!result.ok) return result;

  revalidateFunding(transactionId);
  return { ok: true, message: "Dokumen dan Funding Request dibatalkan" };
}

export async function confirmFunding(
  requestId: number,
  cashBankId: number
): Promise<FundingActionResult> {
  const g = await authorize("FUNDING_REQUEST_CONFIRM");
  if (!g.ok) return g.denial;

  if (!Number.isInteger(cashBankId) || cashBankId <= 0) {
    return { ok: false, errors: { cash_bank_id: "Cash & Bank wajib dipilih." } };
  }

  const result = await confirmFundingRequest(
    requestId,
    cashBankId,
    g.actor.user.id
  );
  if (!result.ok) return result;

  revalidateFunding(null);
  revalidatePath(`/finance/funding-request/${requestId}`);
  return {
    ok: true,
    message: result.closed
      ? `Funding dikonfirmasi · ${result.closed} Budget ditutup`
      : "Funding dikonfirmasi",
  };
}

/**
 * Confirmation moves a cash balance, both Companies' books, every Budget on the
 * document and the document itself, so every page that reads any of them is
 * stale the moment it returns.
 */
function revalidateFunding(transactionId: number | null) {
  revalidatePath("/finance/funding-request");
  revalidatePath("/finance/cash-bank-transaction");
  if (transactionId) {
    revalidatePath(`/finance/cash-bank-transaction/${transactionId}`);
  }
  revalidatePath("/budget/budget");
  revalidatePath("/budget/budget/month/[period]", "page");
  revalidatePath("/master/cash-bank");
  revalidatePath("/dashboard");
}
