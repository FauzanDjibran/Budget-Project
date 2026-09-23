"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { type Actor } from "@/lib/siba/access";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import {
  applyDncn,
  checkDncnHeader,
  checkDncnLines,
  nextNoteNo,
  positionRefusal,
  type DncnLineInput,
} from "@/lib/siba/dncn";
import {
  DNCN_TRANSITIONS,
  dncnIsEditable,
  dncnTransitionAllowed,
  type DncnAction,
  type DncnStatus,
  type DncnType,
} from "@/lib/siba/dncn-workflow";
import { subledgerPosition } from "@/lib/siba/subledger";

/**
 * Debit / Credit Note writes.
 *
 * A Draft adjusts nothing — no subject-book entry, no journal, no date. Post is
 * the boundary and writes both in one transaction; Posted is final, and a note
 * is corrected by a note of the opposite type.
 *
 * The rules live in `lib/siba/dncn.ts` so the suite can exercise them — an
 * action resolves a caller from a session cookie, which a test process does
 * not have.
 */

export type DncnValues = {
  note_type: string;
  budget_category_id: string;
  partner_id: string;
  currency_id: string;
  exchange_rate: string;
  reference: string;
  note: string;
};

export type DncnLineValues = { description: string; amount: string };

export type DncnResult =
  | { ok: true; id: number; note_no?: string }
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

const headerOf = (values: DncnValues) => ({
  note_type: String(values.note_type ?? "").trim(),
  budget_category_id: num(values.budget_category_id),
  partner_id: num(values.partner_id),
  currency_id: num(values.currency_id),
  exchange_rate: num(values.exchange_rate),
});

const asLines = (lines: DncnLineValues[]): DncnLineInput[] =>
  lines.map((l) => ({
    description: String(l.description ?? ""),
    amount: num(l.amount) ?? 0,
  }));

/**
 * Everything a note must satisfy before it is saved. The position is checked
 * here too, so a note that could never post is refused while it is still being
 * typed — Post asks again, under a lock, because the position may have moved.
 */
async function validate(actor: Actor, values: DncnValues, lines: DncnLineValues[]) {
  const companyIds = await accessibleCompanyIds(actor.permissions);
  const header = await checkDncnHeader(headerOf(values), companyIds);
  if (!header.ok) return { ok: false as const, errors: header.errors };

  const settled = checkDncnLines(asLines(lines));
  if (!settled.ok) return { ok: false as const, errors: settled.errors };

  const position = await subledgerPosition(header.book.key, header.partnerId, header.currencyId);
  const refusal = positionRefusal(position, header.raises, settled.total, header.currencyLabel);
  if (refusal) return { ok: false as const, errors: { _lines: refusal } };

  return { ok: true as const, header, settled };
}

export async function createDncn(
  values: DncnValues,
  lines: DncnLineValues[]
): Promise<DncnResult> {
  const g = await authorize("DNCN_CREATE");
  if (!g.ok) return g.denial;

  const checked = await validate(g.actor, values, lines);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const { header, settled } = checked;

  const note_no = await nextNoteNo(header.type);
  const created = await prisma.finDncn.create({
    data: {
      note_no,
      note_type: header.type,
      document_date: null,
      posting_date: null,
      company_id: header.companyId,
      budget_category_id: header.book.categoryId,
      partner_id: header.partnerId,
      currency_id: header.currencyId,
      exchange_rate: header.rate,
      note_amount: settled.total,
      // Written at Post: what a lowering note releases is known only from the
      // position as it stands then.
      note_base_amount: 0,
      reference: values.reference?.trim() || null,
      note: values.note?.trim() || null,
      status: "Draft",
      created_by: g.actor.user.id,
      lines: {
        create: settled.lines.map((l, i) => ({
          sequence_no: i + 1,
          description: l.description,
          amount: l.amount,
          base_amount: 0,
          created_by: g.actor.user.id,
        })),
      },
    },
  });

  await audit(created.id, "TAMBAH", "create", g.actor.user.id);
  revalidateDncn(created.id);
  return { ok: true, id: created.id, note_no };
}

export async function updateDncn(
  id: number,
  values: DncnValues,
  lines: DncnLineValues[]
): Promise<DncnResult> {
  const g = await authorize("DNCN_EDIT");
  if (!g.ok) return g.denial;

  const existing = await prisma.finDncn.findUnique({
    where: { id },
    select: { status: true, note_type: true, company_id: true },
  });
  const scope = await accessibleCompanyIds(g.actor.permissions);
  if (!existing || !scope.includes(existing.company_id)) {
    return { ok: false, errors: { _form: "Nota tidak ditemukan." } };
  }
  if (!dncnIsEditable(existing.status as DncnStatus)) {
    return {
      ok: false,
      errors: {
        _form:
          "Nota hanya dapat diubah selama berstatus Draft. Nota yang sudah " +
          "diposting atau dibatalkan bersifat final.",
      },
    };
  }

  // The type names the number series the note was filed under, so it is fixed
  // once the note exists: a DN- number on a Credit Note would say the opposite
  // of what the note does.
  const checked = await validate(
    g.actor,
    { ...values, note_type: existing.note_type as DncnType },
    lines
  );
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const { header, settled } = checked;

  // A Draft's lines are its own content, not history: no book refers to them.
  await prisma.$transaction(async (tx) => {
    await tx.finDncnLine.deleteMany({ where: { note_id: id } });
    await tx.finDncn.update({
      where: { id },
      data: {
        company_id: header.companyId,
        budget_category_id: header.book.categoryId,
        partner_id: header.partnerId,
        currency_id: header.currencyId,
        exchange_rate: header.rate,
        note_amount: settled.total,
        reference: values.reference?.trim() || null,
        note: values.note?.trim() || null,
        updated_by: g.actor.user.id,
        lines: {
          create: settled.lines.map((l, i) => ({
            sequence_no: i + 1,
            description: l.description,
            amount: l.amount,
            base_amount: 0,
            created_by: g.actor.user.id,
          })),
        },
      },
    });
  });

  await audit(id, "UPDATE", "update", g.actor.user.id);
  revalidateDncn(id);
  return { ok: true, id };
}

export type DncnTransitionResult =
  | { ok: true; status: DncnStatus; message: string }
  | { ok: false; errors: Record<string, string> };

export async function transitionDncn(
  id: number,
  action: DncnAction
): Promise<DncnTransitionResult> {
  const transition = DNCN_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };

  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;

  const doc = await prisma.finDncn.findUnique({
    where: { id },
    select: { status: true, company_id: true },
  });
  if (!doc) return { ok: false, errors: { _form: "Nota tidak ditemukan." } };

  const companyIds = await accessibleCompanyIds(g.actor.permissions);
  if (!companyIds.includes(doc.company_id)) {
    return { ok: false, errors: { _form: "Nota tidak ditemukan." } };
  }

  const status = doc.status as DncnStatus;
  if (!dncnTransitionAllowed(action, status)) {
    return {
      ok: false,
      errors: {
        _form: `Nota berstatus ${status} tidak dapat di-${transition.label.toLowerCase()}.`,
      },
    };
  }

  if (action === "cancel") {
    await prisma.finDncn.update({
      where: { id },
      data: { status: "Cancelled", updated_by: g.actor.user.id },
    });
    await audit(id, "UPDATE", "cancel", g.actor.user.id);
    revalidateDncn(id);
    return { ok: true, status: "Cancelled", message: transition.done };
  }

  const posted = await applyDncn(id, g.actor.user.id);
  if (!posted.ok) return { ok: false, errors: posted.errors };

  await audit(id, "UPDATE", "post", g.actor.user.id);
  revalidateDncn(id);
  return { ok: true, status: "Posted", message: transition.done };
}

async function audit(rowId: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await prisma.auditLog.create({
    data: { entity_key: "fin_dncn", row_id: rowId, action, event, by },
  });
}

function revalidateDncn(id: number) {
  revalidatePath("/finance/debit-credit-note");
  revalidatePath(`/finance/debit-credit-note/${id}`);
  // Posting moves a subject position and writes a journal.
  revalidatePath("/dashboard");
}
