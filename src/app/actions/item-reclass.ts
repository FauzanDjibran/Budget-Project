"use server";

import type { JournalPreviewLine } from "@/lib/siba/journal";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { type Actor } from "@/lib/siba/access";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { checkTransactionDate } from "@/lib/siba/fiscal";
import { checkReclassHeader, checkReclassLines, nextReclassNo, type ReclassLineInput, type ResolvedReclassLine } from "@/lib/siba/item-reclass";
import { applyReclass, previewReclass } from "@/lib/siba/item-reclass-post";
import {
  RECLASS_TRANSITIONS,
  reclassIsEditable,
  reclassTransitionAllowed,
  type ReclassAction,
  type ReclassStatus,
} from "@/lib/siba/item-reclass-workflow";

/**
 * Reklasifikasi Open Item writes.
 *
 * The rules live in `lib/siba/item-reclass.ts` so the test suite can exercise
 * them — an action resolves a caller from a session cookie, which a test
 * process does not have. What is here is the caller: whose Companies they may
 * write for, which permission each step needs, and the audit row.
 */

export type ReclassValues = {
  budget_category_id: string;
  partner_id: string;
  currency_id: string;
  /** `YYYY-MM-DD` — the day the document belongs to in the books. */
  accounting_date: string;
  note: string;
};

export type ReclassLineValues = {
  target_budget_category_id: string;
  target_partner_id: string;
  description: string;
  sources: { item_id: number; amount: number }[];
  targets: { item_id: number; amount: number }[];
};

export type ReclassResult =
  | { ok: true; id: number; reclass_no?: string }
  | { ok: false; errors: Record<string, string> };

type Guard =
  | { ok: true; actor: Actor; companyIds: number[] }
  | { ok: false; denial: { ok: false; errors: Record<string, string> } };

/** Refusals come back as a `_form` error, and never name the permission code. */
async function authorize(code: string): Promise<Guard> {
  try {
    const actor = await authorizeAction(code);
    return { ok: true, actor, companyIds: await accessibleCompanyIds(actor.permissions) };
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

const headerOf = (values: ReclassValues) => ({
  budget_category_id: num(values.budget_category_id),
  partner_id: num(values.partner_id),
  currency_id: num(values.currency_id),
});

const allocations = (rows: { item_id: number; amount: number }[] | undefined) =>
  (rows ?? []).map((a) => ({ item_id: Number(a.item_id), amount: Number(a.amount) }));

const asLines = (lines: ReclassLineValues[]): ReclassLineInput[] =>
  lines.map((l) => ({
    target_budget_category_id: num(l.target_budget_category_id) ?? 0,
    target_partner_id: num(l.target_partner_id) ?? 0,
    description: l.description ?? null,
    sources: allocations(l.sources),
    targets: allocations(l.targets),
  }));

/** The rows a draft's lines are written as. Every valuation waits for Post. */
const lineRows = (lines: ResolvedReclassLine[], actorId: number) =>
  lines.map((l, i) => ({
    sequence_no: i + 1,
    target_budget_category_id: l.targetBook.categoryId,
    target_partner_id: l.targetPartnerId,
    description: l.description,
    amount: l.amount,
    created_by: actorId,
    sources: {
      create: l.sources.map((s, k) => ({
        sequence_no: k + 1,
        sub_ledger_balance_id: s.itemId,
        amount: s.amount,
        created_by: actorId,
      })),
    },
    targets: {
      create: l.targets.map((t, k) => ({
        sequence_no: k + 1,
        sub_ledger_balance_id: t.itemId,
        amount: t.amount,
        created_by: actorId,
      })),
    },
  }));

/** Header, date and lines, checked together, in the order the form fills them. */
async function checkDraft(
  values: ReclassValues,
  lines: ReclassLineValues[],
  companyIds: number[]
) {
  const header = await checkReclassHeader(headerOf(values), companyIds);
  if (!header.ok) return { ok: false as const, errors: header.errors };

  // Any day up to today, inside a year this Company may still write into.
  // Asked again at Post, since a year can close in between.
  const dated = await checkTransactionDate(values.accounting_date, [header.companyId]);
  if (!dated.ok) return { ok: false as const, errors: { accounting_date: dated.message } };

  const settled = await checkReclassLines(header, asLines(lines), dated.date);
  if (!settled.ok) return { ok: false as const, errors: settled.errors };

  return { ok: true as const, header, date: dated.date, settled };
}

export async function createReclass(
  values: ReclassValues,
  lines: ReclassLineValues[]
): Promise<ReclassResult> {
  const g = await authorize("ITEM_RECLASS_CREATE");
  if (!g.ok) return g.denial;

  const checked = await checkDraft(values, lines, g.companyIds);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const { header, date, settled } = checked;

  const reclass_no = await nextReclassNo();
  const created = await prisma.finItemReclass.create({
    data: {
      reclass_no,
      accounting_date: new Date(`${date}T00:00:00Z`),
      posted_at: null,
      company_id: header.companyId,
      budget_category_id: header.book.categoryId,
      partner_id: header.partnerId,
      currency_id: header.currencyId,
      reclass_amount: settled.total,
      note: values.note?.trim() || null,
      status: "Draft",
      created_by: g.actor.user.id,
      lines: { create: lineRows(settled.lines, g.actor.user.id) },
    },
  });

  await audit(created.id, "TAMBAH", "create", g.actor.user.id);
  revalidateReclass(created.id);
  return { ok: true, id: created.id, reclass_no };
}

export async function updateReclass(
  id: number,
  values: ReclassValues,
  lines: ReclassLineValues[]
): Promise<ReclassResult> {
  const g = await authorize("ITEM_RECLASS_EDIT");
  if (!g.ok) return g.denial;

  const existing = await prisma.finItemReclass.findUnique({
    where: { id },
    select: { status: true, company_id: true },
  });
  if (!existing || !g.companyIds.includes(existing.company_id)) {
    return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  }
  if (!reclassIsEditable(existing.status as ReclassStatus)) {
    return {
      ok: false,
      errors: {
        _form:
          "Dokumen hanya dapat diubah selama berstatus Draft. Dokumen yang " +
          "sudah diposting atau dibatalkan bersifat final.",
      },
    };
  }

  const checked = await checkDraft(values, lines, g.companyIds);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const { header, date, settled } = checked;

  // A Draft's lines are the document's own content, not history: nothing has
  // been posted from them and no book refers to them, so they are replaced
  // wholesale.
  await prisma.$transaction(async (tx) => {
    await tx.finItemReclassLine.deleteMany({ where: { reclass_id: id } });
    await tx.finItemReclass.update({
      where: { id },
      data: {
        accounting_date: new Date(`${date}T00:00:00Z`),
        company_id: header.companyId,
        budget_category_id: header.book.categoryId,
        partner_id: header.partnerId,
        currency_id: header.currencyId,
        reclass_amount: settled.total,
        note: values.note?.trim() || null,
        updated_by: g.actor.user.id,
        lines: { create: lineRows(settled.lines, g.actor.user.id) },
      },
    });
  });

  await audit(id, "UPDATE", "update", g.actor.user.id);
  revalidateReclass(id);
  return { ok: true, id };
}

export type ReclassTransitionResult =
  | { ok: true; status: ReclassStatus; message: string }
  | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle transition. `post` is the boundary: before it nothing has
 * moved, after it nothing can be taken back.
 */
export async function transitionReclass(
  id: number,
  action: ReclassAction
): Promise<ReclassTransitionResult> {
  const transition = RECLASS_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };

  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;

  const doc = await prisma.finItemReclass.findUnique({
    where: { id },
    select: { status: true, company_id: true },
  });
  if (!doc || !g.companyIds.includes(doc.company_id)) {
    return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  }

  const status = doc.status as ReclassStatus;
  if (!reclassTransitionAllowed(action, status)) {
    return {
      ok: false,
      errors: {
        _form: `Dokumen berstatus ${status} tidak dapat di-${transition.label.toLowerCase()}.`,
      },
    };
  }

  if (action === "cancel") {
    await prisma.finItemReclass.update({
      where: { id },
      data: { status: "Cancelled", updated_by: g.actor.user.id },
    });
    await audit(id, "UPDATE", "cancel", g.actor.user.id);
    revalidateReclass(id);
    return { ok: true, status: "Cancelled", message: transition.done };
  }

  const posted = await applyReclass(id, g.actor.user.id);
  if (!posted.ok) return { ok: false, errors: posted.errors };

  await audit(id, "UPDATE", "post", g.actor.user.id);
  revalidateReclass(id);
  return {
    ok: true,
    status: "Posted",
    message: posted.fxDifference ? `${transition.done} · selisih kurs diakui` : transition.done,
  };
}

/**
 * The journal Post would write, for its confirmation — consequences before
 * commitment. Asks the Post permission, and runs the posting path as a dry run,
 * so it refuses exactly as Post would.
 */
export async function previewReclassPost(
  id: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const g = await authorize(RECLASS_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  const doc = await prisma.finItemReclass.findUnique({
    where: { id },
    select: { company_id: true },
  });
  if (!doc || !g.companyIds.includes(doc.company_id)) {
    return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  }
  return previewReclass(id);
}

/** One row in the trace; `event` is what separates a post from a cancel. */
async function audit(
  rowId: number,
  action: "TAMBAH" | "UPDATE",
  event: string,
  by: number
) {
  await prisma.auditLog.create({
    data: { entity_key: "fin_item_reclass", row_id: rowId, action, event, by },
  });
}

function revalidateReclass(id: number) {
  revalidatePath("/finance/reklasifikasi-open-item");
  revalidatePath(`/finance/reklasifikasi-open-item/${id}`);
  // Posting moves two positions' items and writes a journal.
  revalidatePath("/dashboard");
}
