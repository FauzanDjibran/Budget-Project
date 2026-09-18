"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { type Actor } from "@/lib/siba/access";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { roundBase } from "@/lib/siba/fx";
import {
  applyTransfer,
  checkTransferHeader,
  checkTransferLines,
  nextTransferNo,
  type TransferLineInput,
} from "@/lib/siba/transfer";
import {
  TRANSFER_TRANSITIONS,
  transferIsEditable,
  transferTransitionAllowed,
  type TransferAction,
  type TransferStatus,
} from "@/lib/siba/transfer-workflow";

/**
 * Cash Bank Transfer writes.
 *
 * Three things are enforced here and nowhere that matters less:
 *
 *  1. **The header.** The Purpose must match the currencies the chosen source
 *     actually holds, and a source holding foreign currency must name the one
 *     layer the transfer draws on.
 *  2. **The lines.** Every destination must belong to the same Company, be
 *     active, hold a currency the Purpose admits, and not be the source.
 *  3. **The lifecycle.** Draft moves nothing. Post is the boundary and writes
 *     both books, every layer and the journal in one database transaction;
 *     Posted is final, because every operational book is append-only (§15).
 *
 * The rules themselves live in `lib/siba/transfer.ts` so the test suite can
 * exercise them — an action resolves a caller from a session cookie, which a
 * test process does not have.
 */

export type TransferValues = {
  purpose: string;
  from_cash_bank_id: string;
  /** Only an input for Pembelian Valas; derived from the source otherwise. */
  currency_id: string;
  cash_bank_layer_id: string;
  note: string;
};

export type TransferLineValues = {
  to_cash_bank_id: string;
  amount: string;
  exchange_rate: string;
};

export type TransferResult =
  | { ok: true; id: number; transfer_no?: string }
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

/** A kurs carries decimals, so it is not `num`, which exists for row ids. */
function rateNum(raw: string | undefined | null): number | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const headerOf = (values: TransferValues) => ({
  purpose: String(values.purpose ?? "").trim(),
  from_cash_bank_id: num(values.from_cash_bank_id),
  currency_id: num(values.currency_id),
  cash_bank_layer_id: num(values.cash_bank_layer_id),
});

const asLines = (lines: TransferLineValues[]): TransferLineInput[] =>
  lines
    .map((l) => ({
      to_cash_bank_id: num(l.to_cash_bank_id) ?? 0,
      amount: num(l.amount) ?? 0,
      exchange_rate: rateNum(l.exchange_rate),
    }))
    .filter((l) => l.to_cash_bank_id > 0);

/**
 * May this user write in that Company's books at all?
 *
 * The header rules say what a *transfer* may be; this says whose money the
 * caller may move. Checked here rather than in `checkTransferHeader` because it
 * is about the actor, and the data module deliberately takes its scope as an
 * argument rather than reaching into the request (CLAUDE.md §12).
 */
async function refuseCompany(
  actor: Actor,
  companyId: number
): Promise<TransferResult | null> {
  const allowed = await accessibleCompanyIds(actor.permissions);
  if (allowed.includes(companyId)) return null;
  return {
    ok: false,
    errors: {
      from_cash_bank_id: "Anda tidak memiliki akses ke Company tersebut.",
    },
  };
}

export async function createTransfer(
  values: TransferValues,
  lines: TransferLineValues[]
): Promise<TransferResult> {
  const g = await authorize("CASH_BANK_TRANSFER_CREATE");
  if (!g.ok) return g.denial;

  const checked = await checkTransferHeader(headerOf(values));
  if (!checked.ok) return { ok: false, errors: checked.errors };

  // The Company is the source's, so this is checked once the source is known
  // rather than against a field the form never offered.
  const refused = await refuseCompany(g.actor, checked.companyId);
  if (refused) return refused;

  const settled = await checkTransferLines(checked, asLines(lines));
  if (!settled.ok) return { ok: false, errors: settled.errors };

  const transfer_no = await nextTransferNo();

  const created = await prisma.finCashBankTransfer.create({
    data: {
      transfer_no,
      // A document acquires its date when the money moves, not when it is
      // drafted — concept doc §2.3. Post fills both date columns.
      document_date: null,
      posting_date: null,
      company_id: checked.companyId,
      purpose: checked.purpose,
      from_cash_bank_id: checked.fromCashBankId,
      currency_id: checked.currencyId,
      cash_bank_layer_id: checked.layerId,
      transfer_amount: settled.total,
      // Provisional while the document is a Draft: Post re-reads the layer
      // before it values anything, and what a layer releases is known only by
      // drawing it.
      transfer_base_amount: roundBase(settled.total * (checked.layerRate ?? 1)),
      note: values.note?.trim() || null,
      status: "Draft",
      created_by: g.actor.user.id,
      lines: {
        create: settled.lines.map((l, i) => ({
          sequence_no: i + 1,
          to_cash_bank_id: l.toCashBankId,
          amount: l.amount,
          exchange_rate: l.rate,
          // Every figure below is written at Post. A Draft has moved nothing,
          // so it has nothing to be worth.
          out_amount: 0,
          out_base_amount: 0,
          in_amount: 0,
          in_base_amount: 0,
          fx_difference: 0,
          created_by: g.actor.user.id,
        })),
      },
    },
  });

  await audit(created.id, "TAMBAH", "create", g.actor.user.id);
  revalidateTransfer(created.id);
  return { ok: true, id: created.id, transfer_no };
}

export async function updateTransfer(
  id: number,
  values: TransferValues,
  lines: TransferLineValues[]
): Promise<TransferResult> {
  const g = await authorize("CASH_BANK_TRANSFER_EDIT");
  if (!g.ok) return g.denial;

  const existing = await prisma.finCashBankTransfer.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  }
  if (!transferIsEditable(existing.status as TransferStatus)) {
    return {
      ok: false,
      errors: {
        _form:
          "Dokumen hanya dapat diubah selama berstatus Draft. Dokumen yang " +
          "sudah diposting atau dibatalkan bersifat final.",
      },
    };
  }

  const checked = await checkTransferHeader(headerOf(values));
  if (!checked.ok) return { ok: false, errors: checked.errors };

  const refused = await refuseCompany(g.actor, checked.companyId);
  if (refused) return refused;

  const settled = await checkTransferLines(checked, asLines(lines));
  if (!settled.ok) return { ok: false, errors: settled.errors };

  // A Draft's lines are the document's own content, not history: nothing has
  // been posted from them and no book refers to them. Replacing them wholesale
  // is what "edit the document" means. The no-delete rule protects master data
  // and posted records, neither of which these are.
  await prisma.$transaction(async (tx) => {
    await tx.finCashBankTransferLine.deleteMany({ where: { transfer_id: id } });
    await tx.finCashBankTransfer.update({
      where: { id },
      data: {
        company_id: checked.companyId,
        purpose: checked.purpose,
        from_cash_bank_id: checked.fromCashBankId,
        currency_id: checked.currencyId,
        cash_bank_layer_id: checked.layerId,
        transfer_amount: settled.total,
        transfer_base_amount: roundBase(
          settled.total * (checked.layerRate ?? 1)
        ),
        note: values.note?.trim() || null,
        updated_by: g.actor.user.id,
        lines: {
          create: settled.lines.map((l, i) => ({
            sequence_no: i + 1,
            to_cash_bank_id: l.toCashBankId,
            amount: l.amount,
            exchange_rate: l.rate,
            out_amount: 0,
            out_base_amount: 0,
            in_amount: 0,
            in_base_amount: 0,
            fx_difference: 0,
            created_by: g.actor.user.id,
          })),
        },
      },
    });
  });

  await audit(id, "UPDATE", "update", g.actor.user.id);
  revalidateTransfer(id);
  return { ok: true, id };
}

export type TransferTransitionResult =
  | { ok: true; status: TransferStatus; message: string }
  | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle transition.
 *
 * `post` is the only one that writes anything beyond the document's own status,
 * and it is the boundary: before it nothing has happened, after it nothing can
 * be taken back.
 */
export async function transitionTransfer(
  id: number,
  action: TransferAction
): Promise<TransferTransitionResult> {
  const transition = TRANSFER_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };

  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;

  const doc = await prisma.finCashBankTransfer.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };

  const status = doc.status as TransferStatus;
  if (!transferTransitionAllowed(action, status)) {
    return {
      ok: false,
      errors: {
        _form: `Dokumen berstatus ${status} tidak dapat di-${transition.label.toLowerCase()}.`,
      },
    };
  }

  if (action === "cancel") {
    await prisma.finCashBankTransfer.update({
      where: { id },
      data: { status: "Cancelled", updated_by: g.actor.user.id },
    });
    await audit(id, "UPDATE", "cancel", g.actor.user.id);
    revalidateTransfer(id);
    return { ok: true, status: "Cancelled", message: transition.done };
  }

  // Post is the actual boundary, and everything it touches moves together.
  // The writes live in `applyTransfer` so the rule can be exercised by the
  // test suite, which has no session to authorize against.
  const posted = await applyTransfer(id, g.actor.user.id);
  if (!posted.ok) return { ok: false, errors: posted.errors };

  await audit(id, "UPDATE", "post", g.actor.user.id);
  revalidateTransfer(id);

  return {
    ok: true,
    status: "Posted",
    message: posted.fxDifference
      ? `${transition.done} · selisih kurs diakui`
      : transition.done,
  };
}

/**
 * One row in the trace.
 *
 * Post and Cancel are both UPDATEs, so `event` is what separates them: without
 * it a document posted after being drafted and edited would show three
 * indistinguishable rows and the panel could not say when the money moved.
 */
async function audit(
  rowId: number,
  action: "TAMBAH" | "UPDATE",
  event: string,
  by: number
) {
  await prisma.auditLog.create({
    data: { entity_key: "fin_cash_bank_transfer", row_id: rowId, action, event, by },
  });
}

function revalidateTransfer(id: number) {
  revalidatePath("/finance/cash-bank-transfer");
  revalidatePath(`/finance/cash-bank-transfer/${id}`);
  // Posting moves two Cash & Bank balances and writes a journal, so the pages
  // that read either are stale the moment this returns.
  revalidatePath("/master/cash-bank");
  revalidatePath("/dashboard");
}
