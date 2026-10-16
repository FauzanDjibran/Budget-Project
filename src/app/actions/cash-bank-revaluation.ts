"use server";

import type { JournalPreviewLine } from "@/lib/siba/journal";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { type Actor } from "@/lib/siba/access";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import {
  RevaluationRefused,
  applyRevaluation,
  checkRevaluationHeader,
  nextRevaluationNo,
  previewRevaluation,
  valueRevaluation,
  writeRevaluationDraftValues,
} from "@/lib/siba/cash-bank-revaluation";
import {
  REVALUATION_TRANSITIONS,
  revaluationIsEditable,
  revaluationTransitionAllowed,
  type RevaluationAction,
  type RevaluationStatus,
} from "@/lib/siba/cash-bank-revaluation-workflow";
import { checkTransactionDate } from "@/lib/siba/fiscal";

/**
 * Revaluasi Kurs writes.
 *
 * A Draft restates nothing — no layer is closed, no book entry, no journal. It
 * does state what Post will write: the resource's balance, what it is carried
 * at, what it would be carried at and the difference, valued when it is saved
 * by the same `valueRevaluation` Post runs. Post is the boundary and writes the
 * layers, the book and the journal in one transaction; Posted is final.
 *
 * The rules live in `lib/siba/cash-bank-revaluation.ts` so the suite can
 * exercise them — an action resolves a caller from a session cookie, which a
 * test process does not have.
 */

export type RevaluationValues = {
  cash_bank_id: string;
  /** The kurs the user states as current, unformatted. */
  exchange_rate: string;
  /** `YYYY-MM-DD` — the day the revaluation belongs to in the books. */
  document_date: string;
  note: string;
};

export type RevaluationResult =
  | { ok: true; id: number; revaluation_no?: string }
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

const num = (raw: string | null | undefined): number | null => {
  const v = String(raw ?? "").trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Everything a revaluation must satisfy before it is saved. */
async function validate(actor: Actor, values: RevaluationValues) {
  const companyIds = await accessibleCompanyIds(actor.permissions);
  const header = await checkRevaluationHeader(
    { cash_bank_id: num(values.cash_bank_id), exchange_rate: num(values.exchange_rate) },
    companyIds
  );
  if (!header.ok) return { ok: false as const, errors: header.errors };

  // Any day up to today, inside a year this Company may still write into.
  // Asked again at Post, since a year can close in between.
  const dated = await checkTransactionDate(values.document_date, [header.companyId]);
  if (!dated.ok) return { ok: false as const, errors: { document_date: dated.message } };

  try {
    const valued = await valueRevaluation(header);
    return { ok: true as const, header, valued, date: dated.date };
  } catch (error) {
    if (error instanceof RevaluationRefused) {
      return { ok: false as const, errors: { cash_bank_id: error.message } };
    }
    throw error;
  }
}

export async function createRevaluation(values: RevaluationValues): Promise<RevaluationResult> {
  const g = await authorize("CASH_BANK_REVALUATION_CREATE");
  if (!g.ok) return g.denial;

  const checked = await validate(g.actor, values);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const { header, valued, date } = checked;

  const revaluation_no = await nextRevaluationNo();
  const id = await prisma.$transaction(async (tx) => {
    const created = await tx.finCashBankRevaluation.create({
      data: {
        revaluation_no,
        // The day it belongs to in the books, chosen on the draft and possibly
        // earlier than today. `posting_date` waits for Post.
        document_date: new Date(`${date}T00:00:00Z`),
        posting_date: null,
        company_id: header.companyId,
        cash_bank_id: header.cashBankId,
        currency_id: header.currencyId,
        exchange_rate: header.rate,
        note: values.note?.trim() || null,
        status: "Draft",
        created_by: g.actor.user.id,
      },
    });
    await writeRevaluationDraftValues(tx, created.id, valued);
    return created.id;
  });

  await audit(id, "TAMBAH", "create", g.actor.user.id);
  revalidateRevaluation(id);
  return { ok: true, id, revaluation_no };
}

export async function updateRevaluation(
  id: number,
  values: RevaluationValues
): Promise<RevaluationResult> {
  const g = await authorize("CASH_BANK_REVALUATION_EDIT");
  if (!g.ok) return g.denial;

  const existing = await prisma.finCashBankRevaluation.findUnique({
    where: { id },
    select: { status: true, company_id: true },
  });
  const scope = await accessibleCompanyIds(g.actor.permissions);
  if (!existing || !scope.includes(existing.company_id)) {
    return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  }
  if (!revaluationIsEditable(existing.status as RevaluationStatus)) {
    return {
      ok: false,
      errors: {
        _form:
          "Dokumen hanya dapat diubah selama berstatus Draft. Dokumen yang sudah " +
          "diposting atau dibatalkan bersifat final.",
      },
    };
  }

  const checked = await validate(g.actor, values);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const { header, valued, date } = checked;

  await prisma.$transaction(async (tx) => {
    await tx.finCashBankRevaluation.update({
      where: { id },
      data: {
        company_id: header.companyId,
        cash_bank_id: header.cashBankId,
        currency_id: header.currencyId,
        exchange_rate: header.rate,
        document_date: new Date(`${date}T00:00:00Z`),
        note: values.note?.trim() || null,
        updated_by: g.actor.user.id,
      },
    });
    await writeRevaluationDraftValues(tx, id, valued);
  });

  await audit(id, "UPDATE", "update", g.actor.user.id);
  revalidateRevaluation(id);
  return { ok: true, id };
}

export type RevaluationTransitionResult =
  | { ok: true; status: RevaluationStatus; message: string }
  | { ok: false; errors: Record<string, string> };

export async function transitionRevaluation(
  id: number,
  action: RevaluationAction
): Promise<RevaluationTransitionResult> {
  const transition = REVALUATION_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };

  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;

  const doc = await prisma.finCashBankRevaluation.findUnique({
    where: { id },
    select: { status: true, company_id: true },
  });
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };

  const companyIds = await accessibleCompanyIds(g.actor.permissions);
  if (!companyIds.includes(doc.company_id)) {
    return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  }

  const status = doc.status as RevaluationStatus;
  if (!revaluationTransitionAllowed(action, status)) {
    return {
      ok: false,
      errors: {
        _form: `Dokumen berstatus ${status} tidak dapat di-${transition.label.toLowerCase()}.`,
      },
    };
  }

  if (action === "cancel") {
    await prisma.finCashBankRevaluation.update({
      where: { id },
      data: { status: "Cancelled", updated_by: g.actor.user.id },
    });
    await audit(id, "UPDATE", "cancel", g.actor.user.id);
    revalidateRevaluation(id);
    return { ok: true, status: "Cancelled", message: transition.done };
  }

  const posted = await applyRevaluation(id, g.actor.user.id);
  if (!posted.ok) return { ok: false, errors: posted.errors };

  await audit(id, "UPDATE", "post", g.actor.user.id);
  revalidateRevaluation(id);
  return { ok: true, status: "Posted", message: transition.done };
}

async function audit(rowId: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await prisma.auditLog.create({
    data: { entity_key: "fin_cash_bank_revaluation", row_id: rowId, action, event, by },
  });
}

function revalidateRevaluation(id: number) {
  revalidatePath("/finance/revaluasi-kurs");
  revalidatePath(`/finance/revaluasi-kurs/${id}`);
  // Posting restates a cash position and writes a journal.
  revalidatePath("/dashboard");
}

/**
 * The journal Post would write for this document, for its confirmation —
 * consequences before commitment. Asks the Post permission itself, and runs
 * the posting path as a dry run, so it refuses exactly as Post would.
 */
export async function previewRevaluationPost(
  id: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const g = await authorize(REVALUATION_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  return previewRevaluation(id);
}
