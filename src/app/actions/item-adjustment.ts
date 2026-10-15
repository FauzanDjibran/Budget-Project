"use server";

import type { JournalPreviewLine } from "@/lib/siba/journal";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { type Actor } from "@/lib/siba/access";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import {
  applyItemAdjustment,
  checkItemAdjustmentHeader,
  checkItemAdjustmentLines,
  nextItemAdjustmentNo,
  previewItemAdjustment,
  valueItemAdjustmentDraft,
  type CheckedAdjustmentLine,
  type ItemAdjustmentLineInput,
} from "@/lib/siba/item-adjustment";
import {
  ITEM_ADJUSTMENT_TRANSITIONS,
  itemAdjustmentIsEditable,
  itemAdjustmentTransitionAllowed,
  type ItemAdjustmentAction,
  type ItemAdjustmentStatus,
} from "@/lib/siba/item-adjustment-workflow";
import { checkTransactionDate } from "@/lib/siba/fiscal";
import { SubledgerItemUnavailable } from "@/lib/siba/subledger";

/**
 * Penyesuaian Open Item writes.
 *
 * A Draft adjusts nothing — no subject-book entry, no journal. It does state
 * what Post will write: every line and item is valued when it is saved, by
 * the same `valueItemAdjustment` Post runs. Post is the boundary and writes the
 * books and the journal in one transaction; Posted is final, and an
 * adjustment is corrected by one of the opposite effect.
 *
 * The rules live in `lib/siba/item-adjustment.ts` so the suite can exercise
 * them — an action resolves a caller from a session cookie, which a test
 * process does not have.
 */

export type ItemAdjustmentValues = {
  effect: string;
  budget_category_id: string;
  partner_id: string;
  currency_id: string;
  exchange_rate: string;
  /** `YYYY-MM-DD` — the day the adjustment belongs to in the books. */
  document_date: string;
  reference: string;
  note: string;
};

export type ItemAdjustmentLineValues = {
  description: string;
  amount: string;
  items: { item_id: number; amount: number }[];
};

export type ItemAdjustmentResult =
  | { ok: true; id: number; adjustment_no?: string }
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

const headerOf = (values: ItemAdjustmentValues) => ({
  effect: String(values.effect ?? "").trim(),
  budget_category_id: num(values.budget_category_id),
  partner_id: num(values.partner_id),
  currency_id: num(values.currency_id),
  exchange_rate: num(values.exchange_rate),
});

const asLines = (lines: ItemAdjustmentLineValues[]): ItemAdjustmentLineInput[] =>
  lines.map((l) => ({
    description: String(l.description ?? ""),
    amount: num(l.amount) ?? 0,
    items: (l.items ?? []).map((i) => ({
      item_id: Number(i.item_id),
      amount: Number(i.amount) || 0,
    })),
  }));

/** Everything an adjustment must satisfy before it is saved. */
async function validate(
  actor: Actor,
  values: ItemAdjustmentValues,
  lines: ItemAdjustmentLineValues[]
) {
  const companyIds = await accessibleCompanyIds(actor.permissions);
  const header = await checkItemAdjustmentHeader(headerOf(values), companyIds);
  if (!header.ok) return { ok: false as const, errors: header.errors };

  const settled = await checkItemAdjustmentLines(header, asLines(lines));
  if (!settled.ok) return { ok: false as const, errors: settled.errors };

  // Any day up to today, inside a year this Company may still write into.
  // Asked again at Post, since a year can close in between.
  const dated = await checkTransactionDate(values.document_date, [header.companyId]);
  if (!dated.ok) {
    return { ok: false as const, errors: { document_date: dated.message } };
  }

  return { ok: true as const, header, settled, date: dated.date };
}

const lineData = (lines: CheckedAdjustmentLine[], actorId: number) =>
  lines.map((l, i) => ({
    sequence_no: i + 1,
    description: l.description,
    amount: l.amount,
    created_by: actorId,
    items: {
      create: l.items.map((it, k) => ({
        sequence_no: k + 1,
        sub_ledger_balance_id: it.itemId,
        amount: it.amount,
        created_by: actorId,
      })),
    },
  }));

export async function createItemAdjustment(
  values: ItemAdjustmentValues,
  lines: ItemAdjustmentLineValues[]
): Promise<ItemAdjustmentResult> {
  const g = await authorize("ITEM_ADJUSTMENT_CREATE");
  if (!g.ok) return g.denial;

  const checked = await validate(g.actor, values, lines);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const { header, settled, date } = checked;

  const adjustment_no = await nextItemAdjustmentNo();
  let id: number;
  try {
    id = await prisma.$transaction(async (tx) => {
      const created = await tx.finItemAdjustment.create({
        data: {
          adjustment_no,
          effect: header.effect,
          // The day it belongs to in the books, chosen on the draft and
          // possibly earlier than today. `posting_date` waits for Post.
          document_date: new Date(`${date}T00:00:00Z`),
          posting_date: null,
          company_id: header.companyId,
          budget_category_id: header.book.categoryId,
          partner_id: header.partnerId,
          currency_id: header.currencyId,
          exchange_rate: null,
          adjustment_amount: settled.total,
          reference: values.reference?.trim() || null,
          note: values.note?.trim() || null,
          status: "Draft",
          created_by: g.actor.user.id,
          lines: { create: lineData(settled.lines, g.actor.user.id) },
        },
      });
      await valueItemAdjustmentDraft(tx, created.id, header, settled.lines, g.actor.user.id);
      return created.id;
    });
  } catch (error) {
    if (error instanceof SubledgerItemUnavailable) {
      return { ok: false, errors: { _lines: error.message } };
    }
    throw error;
  }

  await audit(id, "TAMBAH", "create", g.actor.user.id);
  revalidateItemAdjustment(id);
  return { ok: true, id, adjustment_no };
}

export async function updateItemAdjustment(
  id: number,
  values: ItemAdjustmentValues,
  lines: ItemAdjustmentLineValues[]
): Promise<ItemAdjustmentResult> {
  const g = await authorize("ITEM_ADJUSTMENT_EDIT");
  if (!g.ok) return g.denial;

  const existing = await prisma.finItemAdjustment.findUnique({
    where: { id },
    select: { status: true, effect: true, company_id: true },
  });
  const scope = await accessibleCompanyIds(g.actor.permissions);
  if (!existing || !scope.includes(existing.company_id)) {
    return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  }
  if (!itemAdjustmentIsEditable(existing.status as ItemAdjustmentStatus)) {
    return {
      ok: false,
      errors: {
        _form:
          "Dokumen hanya dapat diubah selama berstatus Draft. Dokumen yang sudah " +
          "diposting atau dibatalkan bersifat final.",
      },
    };
  }

  // The effect decides what every line is — an amount or a set of chosen
  // items — so it is fixed once the document exists. The other effect is a
  // new document.
  const checked = await validate(g.actor, { ...values, effect: existing.effect }, lines);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const { header, settled, date } = checked;

  // A Draft's lines are its own content, not history: no book refers to them.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.finItemAdjustmentLine.deleteMany({ where: { adjustment_id: id } });
      await tx.finItemAdjustment.update({
        where: { id },
        data: {
          company_id: header.companyId,
          document_date: new Date(`${date}T00:00:00Z`),
          budget_category_id: header.book.categoryId,
          partner_id: header.partnerId,
          currency_id: header.currencyId,
          exchange_rate: null,
          adjustment_amount: settled.total,
          reference: values.reference?.trim() || null,
          note: values.note?.trim() || null,
          updated_by: g.actor.user.id,
          lines: { create: lineData(settled.lines, g.actor.user.id) },
        },
      });
      await valueItemAdjustmentDraft(tx, id, header, settled.lines, g.actor.user.id);
    });
  } catch (error) {
    if (error instanceof SubledgerItemUnavailable) {
      return { ok: false, errors: { _lines: error.message } };
    }
    throw error;
  }

  await audit(id, "UPDATE", "update", g.actor.user.id);
  revalidateItemAdjustment(id);
  return { ok: true, id };
}

export type ItemAdjustmentTransitionResult =
  | { ok: true; status: ItemAdjustmentStatus; message: string }
  | { ok: false; errors: Record<string, string> };

export async function transitionItemAdjustment(
  id: number,
  action: ItemAdjustmentAction
): Promise<ItemAdjustmentTransitionResult> {
  const transition = ITEM_ADJUSTMENT_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };

  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;

  const doc = await prisma.finItemAdjustment.findUnique({
    where: { id },
    select: { status: true, company_id: true },
  });
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };

  const companyIds = await accessibleCompanyIds(g.actor.permissions);
  if (!companyIds.includes(doc.company_id)) {
    return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  }

  const status = doc.status as ItemAdjustmentStatus;
  if (!itemAdjustmentTransitionAllowed(action, status)) {
    return {
      ok: false,
      errors: {
        _form: `Dokumen berstatus ${status} tidak dapat di-${transition.label.toLowerCase()}.`,
      },
    };
  }

  if (action === "cancel") {
    await prisma.finItemAdjustment.update({
      where: { id },
      data: { status: "Cancelled", updated_by: g.actor.user.id },
    });
    await audit(id, "UPDATE", "cancel", g.actor.user.id);
    revalidateItemAdjustment(id);
    return { ok: true, status: "Cancelled", message: transition.done };
  }

  const posted = await applyItemAdjustment(id, g.actor.user.id);
  if (!posted.ok) return { ok: false, errors: posted.errors };

  await audit(id, "UPDATE", "post", g.actor.user.id);
  revalidateItemAdjustment(id);
  return { ok: true, status: "Posted", message: transition.done };
}

async function audit(rowId: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await prisma.auditLog.create({
    data: { entity_key: "fin_item_adjustment", row_id: rowId, action, event, by },
  });
}

function revalidateItemAdjustment(id: number) {
  revalidatePath("/finance/penyesuaian-open-item");
  revalidatePath(`/finance/penyesuaian-open-item/${id}`);
  // Posting moves a subject position and writes a journal.
  revalidatePath("/dashboard");
}

/**
 * The journal Post would write for this document, for its confirmation —
 * consequences before commitment. Asks the Post permission itself, because
 * only someone who could post it is being asked to confirm it, and it runs
 * the posting path as a dry run, so it refuses exactly as Post would.
 */
export async function previewItemAdjustmentPost(
  id: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const g = await authorize(ITEM_ADJUSTMENT_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  return previewItemAdjustment(id);
}
