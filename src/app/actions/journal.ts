"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/siba/access";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import {
  JOURNAL_TRANSITIONS,
  type JournalAction,
} from "@/lib/siba/journal-workflow";
import {
  cancelManualJournal,
  createManualJournal,
  manualJournalOptions,
  postManualJournal,
  updateManualJournal,
  type ManualJournalLineValues,
  type ManualJournalOptions,
} from "@/lib/siba/manual-journal";

/**
 * The manual journal's write path — the only way a person puts a line in the
 * books by hand.
 *
 * Three things are enforced here and nowhere that matters less:
 *
 *  1. **The permission**, which is its own capability: seeing journals and
 *     writing one are different rights, and posting one is different again.
 *  2. **The Company**, which must be one this caller's permissions open. The
 *     rules module takes its scope as an argument and never reaches into the
 *     request, so this is where the actor's own access is asked about.
 *  3. **The rules**, in `lib/siba/manual-journal.ts` — which account may be
 *     written to, which line needs a Partner, which line needs a kurs. They
 *     live there rather than here so the test suite can exercise them: an
 *     action resolves its caller from a session cookie and a test has none.
 *
 * The balance and the posting date are not enforced here at all. They belong to
 * the posting engine, which every journal in this application goes through.
 */

export type JournalHeaderValues = {
  company_id: string;
  description: string;
};

export type JournalLineValues = {
  account_id: string;
  partner_id: string;
  currency_id: string;
  exchange_rate: string;
  debit: string;
  credit: string;
  description: string;
};

export type JournalResult =
  | { ok: true; id: number; journalNo: string }
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

const num = (raw: string | null | undefined): number | null => {
  const v = String(raw ?? "").trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A kurs and an amount both carry decimals, unlike a row id. */
const decimal = (raw: string | null | undefined): number => {
  const v = String(raw ?? "").trim();
  if (v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const asLines = (lines: JournalLineValues[]): ManualJournalLineValues[] =>
  lines
    // A row the user added and never filled in is not a line. Dropping it here
    // is what lets the editor keep an empty row at the bottom without every
    // save complaining about it.
    .filter(
      (l) =>
        num(l.account_id) !== null ||
        decimal(l.debit) > 0 ||
        decimal(l.credit) > 0
    )
    .map((l) => ({
      account_id: num(l.account_id),
      partner_id: num(l.partner_id),
      currency_id: num(l.currency_id),
      exchange_rate: num(l.exchange_rate),
      debit: decimal(l.debit),
      credit: decimal(l.credit),
      description: l.description ?? "",
    }));

/**
 * May this user write journals for that Company at all?
 *
 * The line rules say what a *journal* may be; this says whose books the caller
 * may touch, which is the same question the Company permissions answer
 * everywhere else.
 */
async function refuseCompany(
  actor: Actor,
  companyId: number | null
): Promise<{ ok: false; errors: Record<string, string> } | null> {
  if (!companyId) return null;
  const allowed = await accessibleCompanyIds(actor.permissions);
  if (allowed.includes(companyId)) return null;
  return {
    ok: false,
    errors: { company_id: "Anda tidak memiliki akses ke Company tersebut." },
  };
}

/**
 * What a line may be built from, for the form.
 *
 * An action rather than a page prop because the set depends on the Company the
 * user is still choosing. It asks for the same permission the write does, and
 * returns exactly the accounts `checkManualJournal` will accept — so the picker
 * and the Server Action can never disagree about what is selectable.
 */
export async function listJournalOptions(
  companyId: number,
  options: { editing?: boolean } = {}
): Promise<
  { ok: true; options: ManualJournalOptions } | { ok: false; errors: Record<string, string> }
> {
  const g = await authorize(options.editing ? "JOURNAL_EDIT" : "JOURNAL_CREATE");
  if (!g.ok) return g.denial;

  const refused = await refuseCompany(g.actor, companyId);
  if (refused) return refused;

  return { ok: true, options: await manualJournalOptions(companyId) };
}

export async function createJournal(
  header: JournalHeaderValues,
  lines: JournalLineValues[]
): Promise<JournalResult> {
  const g = await authorize("JOURNAL_CREATE");
  if (!g.ok) return g.denial;

  const companyId = num(header.company_id);
  const refused = await refuseCompany(g.actor, companyId);
  if (refused) return refused;

  const result = await createManualJournal(
    { company_id: companyId, description: header.description },
    asLines(lines),
    g.actor.user.id
  );
  if (result.ok) revalidateJournal(result.id);
  return result;
}

export async function updateJournal(
  id: number,
  header: JournalHeaderValues,
  lines: JournalLineValues[]
): Promise<JournalResult> {
  const g = await authorize("JOURNAL_EDIT");
  if (!g.ok) return g.denial;

  const companyId = num(header.company_id);
  const refused = await refuseCompany(g.actor, companyId);
  if (refused) return refused;

  const result = await updateManualJournal(
    id,
    { company_id: companyId, description: header.description },
    asLines(lines),
    g.actor.user.id,
    await accessibleCompanyIds(g.actor.permissions)
  );
  if (result.ok) revalidateJournal(id);
  return result;
}

export type JournalTransitionResult =
  | { ok: true; message: string }
  | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle transition.
 *
 * `post` is the boundary: before it the journal is a draft nothing can see,
 * after it the General Ledger reads it and it can never be taken back.
 */
export async function transitionJournal(
  id: number,
  action: JournalAction
): Promise<JournalTransitionResult> {
  const transition = JOURNAL_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };

  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;

  // The journal's own Company is checked by the rules module rather than here:
  // reading `acc_journal` belongs to the Journal, and a journal outside this
  // caller's scope reads as not found.
  const scope = await accessibleCompanyIds(g.actor.permissions);
  const result =
    action === "post"
      ? await postManualJournal(id, g.actor.user.id, scope)
      : await cancelManualJournal(id, g.actor.user.id, scope);

  if (!result.ok) return { ok: false, errors: result.errors };

  revalidateJournal(id);
  return { ok: true, message: transition.done };
}

function revalidateJournal(id: number) {
  revalidatePath("/accounting/journal");
  revalidatePath(`/accounting/journal/${id}`);
  // A posted journal is immediately part of both ledger reports, and the
  // dashboard reads the same lines for its standing positions.
  revalidatePath("/accounting/report/general-ledger");
  revalidatePath("/accounting/report/trial-balance");
  revalidatePath("/dashboard");
}
