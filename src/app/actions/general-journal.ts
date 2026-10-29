"use server";

import { revalidatePath } from "next/cache";
import { type Actor } from "@/lib/siba/access";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import {
  cancelGeneralJournal,
  createGeneralJournal,
  postGeneralJournal,
  updateGeneralJournal,
  type GeneralJournalLineValues,
} from "@/lib/siba/general-journal";
import { generalJournalOptions, type GeneralJournalOptions } from "@/lib/siba/general-journal-rows";
import {
  GENERAL_JOURNAL_TRANSITIONS,
  type GeneralJournalAction,
} from "@/lib/siba/general-journal-workflow";
import type { JournalPreviewLine } from "@/lib/siba/journal";

/**
 * Jurnal Umum's write path. The permission and the Company are asked here;
 * every rule about a line is `general-journal.ts`'s and its ledgers' adapters,
 * where a test can reach it.
 */

export type GeneralJournalHeaderValues = {
  company_id: string;
  journal_date: string;
  description: string;
};

/** One row of the editor; ids and figures arrive as the form's strings. */
export type GeneralJournalFormLine = {
  account_id: string;
  side: "debit" | "credit" | "";
  partner_id: string;
  subject_id: string;
  /** The book a new item opens in, on an account keeping several. */
  budget_category_id: string;
  cash_bank_layer_id: string;
  currency_id: string;
  exchange_rate: string;
  amount: string;
  description: string;
};

export type GeneralJournalActionResult =
  | { ok: true; id: number; journalNo: string }
  | { ok: false; errors: Record<string, string> };

type Guard =
  | { ok: true; actor: Actor }
  | { ok: false; denial: { ok: false; errors: Record<string, string> } };

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

const id = (raw: string | null | undefined): number | null => {
  const n = Number(String(raw ?? "").trim());
  return String(raw ?? "").trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
};

const decimal = (raw: string | null | undefined): number | null => {
  const v = String(raw ?? "").trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const asLines = (lines: GeneralJournalFormLine[]): GeneralJournalLineValues[] =>
  lines
    // A row added and never filled in is not a line.
    .filter((l) => id(l.account_id) !== null || decimal(l.amount))
    .map((l) => {
      const amount = decimal(l.amount) ?? 0;
      return {
        account_id: id(l.account_id),
        partner_id: id(l.partner_id),
        subject_id: id(l.subject_id),
        budget_category_id: id(l.budget_category_id),
        cash_bank_layer_id: id(l.cash_bank_layer_id),
        currency_id: id(l.currency_id),
        exchange_rate: decimal(l.exchange_rate),
        debit: l.side === "debit" ? amount : 0,
        credit: l.side === "credit" ? amount : 0,
        description: l.description ?? "",
      };
    });

async function refuseCompany(actor: Actor, companyId: number | null) {
  if (!companyId) return null;
  if ((await accessibleCompanyIds(actor.permissions)).includes(companyId)) return null;
  return { ok: false as const, errors: { company_id: "Anda tidak memiliki akses ke Company tersebut." } };
}

/** What a line may be built from, for the Company the user is still choosing. */
export async function listGeneralJournalOptions(
  companyId: number
): Promise<{ ok: true; options: GeneralJournalOptions } | { ok: false; errors: Record<string, string> }> {
  const g = await authorize("JOURNAL_GENERAL_CREATE");
  if (!g.ok) return g.denial;
  const refused = await refuseCompany(g.actor, companyId);
  if (refused) return refused;
  return { ok: true, options: await generalJournalOptions(companyId) };
}

export async function createGeneralJournalAction(
  header: GeneralJournalHeaderValues,
  lines: GeneralJournalFormLine[]
): Promise<GeneralJournalActionResult> {
  const g = await authorize("JOURNAL_GENERAL_CREATE");
  if (!g.ok) return g.denial;
  const companyId = id(header.company_id);
  const refused = await refuseCompany(g.actor, companyId);
  if (refused) return refused;

  const result = await createGeneralJournal(
    { company_id: companyId, journal_date: header.journal_date, description: header.description },
    asLines(lines),
    g.actor.user.id
  );
  if (result.ok) revalidate(result.id);
  return result;
}

export async function updateGeneralJournalAction(
  journalId: number,
  header: GeneralJournalHeaderValues,
  lines: GeneralJournalFormLine[]
): Promise<GeneralJournalActionResult> {
  const g = await authorize("JOURNAL_GENERAL_EDIT");
  if (!g.ok) return g.denial;
  const companyId = id(header.company_id);
  const refused = await refuseCompany(g.actor, companyId);
  if (refused) return refused;

  const result = await updateGeneralJournal(
    journalId,
    { company_id: companyId, journal_date: header.journal_date, description: header.description },
    asLines(lines),
    g.actor.user.id,
    await accessibleCompanyIds(g.actor.permissions)
  );
  if (result.ok) revalidate(journalId);
  return result;
}

export async function transitionGeneralJournal(
  journalId: number,
  action: GeneralJournalAction
): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }> {
  const transition = GENERAL_JOURNAL_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };
  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;

  const scope = await accessibleCompanyIds(g.actor.permissions);
  const result =
    action === "post"
      ? await postGeneralJournal(journalId, g.actor.user.id, scope)
      : await cancelGeneralJournal(journalId, g.actor.user.id, scope);
  if (!result.ok) return { ok: false, errors: result.errors };

  revalidate(journalId);
  return { ok: true, message: transition.done };
}

/** The journal Post would write, from Post's own path run as a dry run. */
export async function previewGeneralJournalPost(
  journalId: number
): Promise<{ ok: true; lines: JournalPreviewLine[] } | { ok: false; errors: Record<string, string> }> {
  const g = await authorize(GENERAL_JOURNAL_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  const result = await postGeneralJournal(
    journalId,
    g.actor.user.id,
    await accessibleCompanyIds(g.actor.permissions),
    true
  );
  return result.ok ? { ok: true, lines: result.preview } : result;
}

function revalidate(journalId: number) {
  revalidatePath("/accounting/jurnal-umum");
  revalidatePath(`/accounting/jurnal-umum/${journalId}`);
  // A posted one is in the General Ledger and in whichever books its lines touch.
  revalidatePath("/accounting/journal");
  revalidatePath("/accounting/report/general-ledger");
  revalidatePath("/accounting/report/trial-balance");
  revalidatePath("/finance/report/cash-bank-ledger");
  revalidatePath("/finance/report/subledger");
  revalidatePath("/dashboard");
}
