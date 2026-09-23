"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { executeClosing } from "@/lib/siba/closing";
import { accessibleCompanyIds } from "@/lib/siba/company-access";

/**
 * Closing a fiscal year, for one Company.
 *
 * The rules live in `closing.ts` rather than here, for the reason every other
 * write path in the application does: an action resolves its caller from a
 * session cookie, which a test process does not have, so a rule written here
 * could only be exercised through the screen. `executeClosing` re-runs every
 * blocking check itself before it writes anything — the checklist the user read
 * is not trusted to still be true.
 *
 * There is deliberately **no** matching "reopen". A close posts a journal, and
 * a posted journal is never reversed (CLAUDE.md §12), so undoing one would mean
 * writing the one kind of entry this application refuses.
 */
export type CloseYearResult =
  | {
      ok: true;
      message: string;
      journalNo: string | null;
      openingNo: string | null;
      yearClosed: boolean;
    }
  | { ok: false; message: string };

export async function closeFiscalYear(
  companyId: number,
  fiscalYearId: number
): Promise<CloseYearResult> {
  let actorId: number;
  let permissions: Set<string>;
  try {
    const actor = await authorizeAction("FISCAL_YEAR_CLOSE");
    actorId = actor.user.id;
    permissions = actor.permissions;
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, message: error.message };
    throw error;
  }

  // Holding the permission is not the same as being allowed to act on this
  // Company's books. The screen only offers Companies this reader may see; the
  // action is reachable directly with any id, which is where it counts.
  const allowed = await accessibleCompanyIds(permissions);
  if (!allowed.includes(companyId)) {
    return {
      ok: false,
      message: "Anda tidak memiliki akses ke Company tersebut.",
    };
  }

  const result = await executeClosing(companyId, fiscalYearId, actorId);
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath("/accounting/closing");
  revalidatePath("/accounting/fiscal-year");
  revalidatePath(`/accounting/fiscal-year/${fiscalYearId}`);
  revalidatePath("/accounting/opening-balance");
  revalidatePath("/accounting/journal");
  revalidatePath("/dashboard");

  return {
    ok: true,
    message: result.yearClosed
      ? "Tahun buku ditutup — seluruh Company selesai"
      : "Tahun buku ditutup untuk Company ini",
    journalNo: result.journalNo,
    openingNo: result.openingNo,
    yearClosed: result.yearClosed,
  };
}
