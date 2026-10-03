"use server";

import type { JournalPreviewLine } from "@/lib/siba/journal";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { type Actor } from "@/lib/siba/access";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { checkTransactionDate } from "@/lib/siba/fiscal";
import { roundBase } from "@/lib/siba/fx";
import {
  applyConversion,
  checkConversionHeader,
  checkConversionLines,
  nextConversionNo,
  previewConversion,
  type ConversionLineInput,
  type ResolvedConversionLine,
} from "@/lib/siba/item-conversion";
import {
  CONVERSION_TRANSITIONS,
  conversionIsEditable,
  conversionTransitionAllowed,
  type ConversionAction,
  type ConversionStatus,
} from "@/lib/siba/item-conversion-workflow";

/**
 * Pencairan Open Item writes.
 *
 * The rules live in `lib/siba/item-conversion.ts` so the test suite can
 * exercise them — an action resolves a caller from a session cookie, which a
 * test process does not have. What is here is the caller: whose Companies they
 * may write for, which permission each step needs, and the audit row.
 */

export type ConversionValues = {
  from_cash_bank_id: string;
  cash_bank_layer_id: string;
  budget_category_id: string;
  partner_id: string;
  /** `YYYY-MM-DD` — the day the document belongs to in the books. */
  document_date: string;
  note: string;
};

export type ConversionLineValues = {
  to_cash_bank_id: string;
  exchange_rate: string;
  items: { item_id: number; amount: number }[];
};

export type ConversionResult =
  | { ok: true; id: number; conversion_no?: string }
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

const headerOf = (values: ConversionValues) => ({
  from_cash_bank_id: num(values.from_cash_bank_id),
  cash_bank_layer_id: num(values.cash_bank_layer_id),
  budget_category_id: num(values.budget_category_id),
  partner_id: num(values.partner_id),
});

const asLines = (lines: ConversionLineValues[]): ConversionLineInput[] =>
  lines
    .map((l) => ({
      to_cash_bank_id: num(l.to_cash_bank_id) ?? 0,
      exchange_rate: num(l.exchange_rate),
      items: (l.items ?? []).map((i) => ({
        item_id: Number(i.item_id),
        amount: Number(i.amount),
      })),
    }))
    .filter((l) => l.to_cash_bank_id > 0);

/** The rows a draft's lines are written as. Every valuation waits for Post. */
const lineRows = (lines: ResolvedConversionLine[], actorId: number) =>
  lines.map((l, i) => ({
    sequence_no: i + 1,
    to_cash_bank_id: l.toCashBankId,
    amount: l.amount,
    exchange_rate: l.rate,
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

/** Header, date and lines, checked together, in the order the form fills them. */
async function checkDraft(
  values: ConversionValues,
  lines: ConversionLineValues[],
  companyIds: number[]
) {
  const header = await checkConversionHeader(headerOf(values), companyIds);
  if (!header.ok) return { ok: false as const, errors: header.errors };

  // Any day up to today, inside a year this Company may still write into.
  // Asked again at Post, since a year can close in between.
  const dated = await checkTransactionDate(values.document_date, [header.companyId]);
  if (!dated.ok) return { ok: false as const, errors: { document_date: dated.message } };

  const settled = await checkConversionLines(header, asLines(lines));
  if (!settled.ok) return { ok: false as const, errors: settled.errors };

  return { ok: true as const, header, date: dated.date, settled };
}

export async function createConversion(
  values: ConversionValues,
  lines: ConversionLineValues[]
): Promise<ConversionResult> {
  const g = await authorize("ITEM_CONVERSION_CREATE");
  if (!g.ok) return g.denial;

  const checked = await checkDraft(values, lines, g.companyIds);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const { header, date, settled } = checked;

  const conversion_no = await nextConversionNo();
  const created = await prisma.finItemConversion.create({
    data: {
      conversion_no,
      document_date: new Date(`${date}T00:00:00Z`),
      posting_date: null,
      company_id: header.companyId,
      from_cash_bank_id: header.fromCashBankId,
      currency_id: header.currencyId,
      cash_bank_layer_id: header.layerId,
      budget_category_id: header.book.categoryId,
      partner_id: header.partnerId,
      conversion_amount: settled.total,
      // Provisional while a Draft: what a layer releases is known only by
      // drawing it, which Post does.
      conversion_base_amount: roundBase(settled.total * header.layerRate),
      note: values.note?.trim() || null,
      status: "Draft",
      created_by: g.actor.user.id,
      lines: { create: lineRows(settled.lines, g.actor.user.id) },
    },
  });

  await audit(created.id, "TAMBAH", "create", g.actor.user.id);
  revalidateConversion(created.id);
  return { ok: true, id: created.id, conversion_no };
}

export async function updateConversion(
  id: number,
  values: ConversionValues,
  lines: ConversionLineValues[]
): Promise<ConversionResult> {
  const g = await authorize("ITEM_CONVERSION_EDIT");
  if (!g.ok) return g.denial;

  const existing = await prisma.finItemConversion.findUnique({
    where: { id },
    select: { status: true, company_id: true },
  });
  if (!existing || !g.companyIds.includes(existing.company_id)) {
    return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  }
  if (!conversionIsEditable(existing.status as ConversionStatus)) {
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
    await tx.finItemConversionLine.deleteMany({ where: { conversion_id: id } });
    await tx.finItemConversion.update({
      where: { id },
      data: {
        document_date: new Date(`${date}T00:00:00Z`),
        company_id: header.companyId,
        from_cash_bank_id: header.fromCashBankId,
        currency_id: header.currencyId,
        cash_bank_layer_id: header.layerId,
        budget_category_id: header.book.categoryId,
        partner_id: header.partnerId,
        conversion_amount: settled.total,
        conversion_base_amount: roundBase(settled.total * header.layerRate),
        note: values.note?.trim() || null,
        updated_by: g.actor.user.id,
        lines: { create: lineRows(settled.lines, g.actor.user.id) },
      },
    });
  });

  await audit(id, "UPDATE", "update", g.actor.user.id);
  revalidateConversion(id);
  return { ok: true, id };
}

export type ConversionTransitionResult =
  | { ok: true; status: ConversionStatus; message: string }
  | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle transition. `post` is the boundary: before it nothing has
 * happened, after it nothing can be taken back.
 */
export async function transitionConversion(
  id: number,
  action: ConversionAction
): Promise<ConversionTransitionResult> {
  const transition = CONVERSION_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };

  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;

  const doc = await prisma.finItemConversion.findUnique({
    where: { id },
    select: { status: true, company_id: true },
  });
  if (!doc || !g.companyIds.includes(doc.company_id)) {
    return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  }

  const status = doc.status as ConversionStatus;
  if (!conversionTransitionAllowed(action, status)) {
    return {
      ok: false,
      errors: {
        _form: `Dokumen berstatus ${status} tidak dapat di-${transition.label.toLowerCase()}.`,
      },
    };
  }

  if (action === "cancel") {
    await prisma.finItemConversion.update({
      where: { id },
      data: { status: "Cancelled", updated_by: g.actor.user.id },
    });
    await audit(id, "UPDATE", "cancel", g.actor.user.id);
    revalidateConversion(id);
    return { ok: true, status: "Cancelled", message: transition.done };
  }

  const posted = await applyConversion(id, g.actor.user.id);
  if (!posted.ok) return { ok: false, errors: posted.errors };

  await audit(id, "UPDATE", "post", g.actor.user.id);
  revalidateConversion(id);
  return {
    ok: true,
    status: "Posted",
    message: posted.fxDifference
      ? `${transition.done} · selisih pencairan diakui`
      : transition.done,
  };
}

/**
 * The journal Post would write, for its confirmation — consequences before
 * commitment. Asks the Post permission, and runs the posting path as a dry run,
 * so it refuses exactly as Post would.
 */
export async function previewConversionPost(
  id: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const g = await authorize(CONVERSION_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  const doc = await prisma.finItemConversion.findUnique({
    where: { id },
    select: { company_id: true },
  });
  if (!doc || !g.companyIds.includes(doc.company_id)) {
    return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  }
  return previewConversion(id);
}

/** One row in the trace; `event` is what separates a post from a cancel. */
async function audit(
  rowId: number,
  action: "TAMBAH" | "UPDATE",
  event: string,
  by: number
) {
  await prisma.auditLog.create({
    data: { entity_key: "fin_item_conversion", row_id: rowId, action, event, by },
  });
}

function revalidateConversion(id: number) {
  revalidatePath("/finance/pencairan-open-item");
  revalidatePath(`/finance/pencairan-open-item/${id}`);
  // Posting moves Cash & Bank balances, the Partner's items and a journal.
  revalidatePath("/master/cash-bank");
  revalidatePath("/dashboard");
}
