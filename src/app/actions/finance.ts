"use server";

import type { JournalPreviewLine } from "@/lib/siba/journal";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { type Actor } from "@/lib/siba/access";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { roundBase } from "@/lib/siba/fx";
import {
  applyPosting,
  previewPosting,
  budgetDocTypeId,
  checkDocumentDate,
  checkHeader,
  checkLines,
  eligibleBudgets,
  nextTransactionNo,
  type EligibleBudget,
  type LineInput,
} from "@/lib/siba/finance";
import {
  TRANSACTION_TRANSITIONS,
  transactionIsEditable,
  transactionTransitionAllowed,
  type TransactionAction,
  type TransactionStatus,
} from "@/lib/siba/transaction-workflow";
import { realizationHref } from "@/lib/siba/realization";

/**
 * Realisasi Budget writes — the execution layer's one write path, behind both
 * menus (Realisasi Penerimaan and Realisasi Pengeluaran).
 *
 * Three things are enforced here and nowhere else that matters:
 *
 *  1. **The header.** The direction is the menu's and is fixed once saved;
 *     Company, Cash & Bank, Currency and kurs must be a combination the rules
 *     admit — the anak's realization is a Funding Request, a separate flow.
 *  2. **The lines.** Every line is re-derived from `eligibleBudgets`, so a
 *     document can never settle a Budget its header does not admit, whatever
 *     the caller submits.
 *  3. **The lifecycle.** Draft moves nothing. Post is the actual boundary
 *     (concept doc §2.3) and the only thing that touches money; Posted is
 *     final, because every operational book is append-only (§15).
 *
 * Post writes three things inside **one** database transaction — the Cash Bank
 * Book entry and its balance, each Budget's `realized_amount`, and the document
 * itself. Either the money moved and the plan records it, or nothing happened.
 *
 * The Journal and the General Ledger are deliberately absent: they are the next
 * scope (CLAUDE.md §13). The Cash Bank Book is written *directly* from the
 * document via `recordCashBankEntry`, never derived from a journal line — that
 * independence is the whole point of the multi-book model (§2.5, §11.7).
 */

export type TransactionValues = {
  /** The menu the document was opened from. Ignored on edit: it is locked. */
  transaction_type: "In" | "Out";
  company_id: string;
  cash_bank_id: string;
  /** The document's own currency, on both routes. */
  currency_id: string;
  /** Typed where the user states a kurs; empty where a layer supplies it. */
  exchange_rate: string;
  /** The rate layer a payment out of a foreign resource draws on. */
  cash_bank_layer_id: string;
  /** `YYYY-MM-DD` — the day the document belongs to in the books. */
  document_date: string;
  note: string;
};

export type TransactionLineValues = {
  budget_id: string;
  amount: string;
  /** The open item a line lowering a subject-book position settles. */
  item_id?: string;
};

export type TransactionResult =
  | { ok: true; id: number; transaction_no?: string }
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

/** The submitted header, in the shape the rules read it. */
const headerOf = (values: TransactionValues) => ({
  transaction_type: (values.transaction_type === "In" ? "In" : "Out") as "In" | "Out",
  company_id: num(values.company_id),
  cash_bank_id: num(values.cash_bank_id),
  currency_id: num(values.currency_id),
  exchange_rate: rateNum(values.exchange_rate),
  cash_bank_layer_id: num(values.cash_bank_layer_id),
});

/**
 * A kurs carries decimals, so it is not `num`, which exists for row ids.
 */
function rateNum(raw: string | undefined | null): number | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * May this user write documents for that Company at all?
 *
 * The header rules say what a *document* may be; this says whose books the
 * caller may touch, which is the same question the Company permissions answer
 * everywhere else. Checked here rather than in `checkHeader` because it is
 * about the actor, and the data module deliberately takes its scope as an
 * argument rather than reaching into the request (CLAUDE.md §12).
 */
async function refuseCompany(
  actor: Actor,
  companyId: number | null
): Promise<TransactionResult | null> {
  if (!companyId) return null;
  const allowed = await accessibleCompanyIds(actor.permissions);
  if (allowed.includes(companyId)) return null;
  return {
    ok: false,
    errors: { company_id: "Anda tidak memiliki akses ke Company tersebut." },
  };
}

const asLines = (lines: TransactionLineValues[]): LineInput[] =>
  lines
    .map((l) => ({
      budget_id: num(l.budget_id) ?? 0,
      amount: num(l.amount) ?? 0,
      item_id: num(l.item_id),
    }))
    .filter((l) => l.budget_id > 0);

/**
 * The Budgets a header may realize, for the form.
 *
 * An action rather than a page prop: the pool depends on Company, Cash & Bank
 * and Currency, which the user is still choosing, and a Finance clerk holding no
 * `BUDGET_VIEW` has no business receiving every Budget in the system just so
 * the browser can filter them. It asks for the same permission the write does,
 * and returns exactly the set `checkLines` will accept — so the picker and the
 * Server Action can never disagree about what is eligible.
 */
export async function listEligibleBudgets(
  values: TransactionValues,
  options: { excludeTransactionId?: number } = {}
): Promise<
  | { ok: true; budgets: EligibleBudget[] }
  | { ok: false; errors: Record<string, string> }
> {
  const g = await authorize(
    options.excludeTransactionId
      ? "REALIZATION_EDIT"
      : "REALIZATION_CREATE"
  );
  if (!g.ok) return g.denial;

  const budgets = await eligibleBudgets(headerOf(values), options);
  return { ok: true, budgets };
}

export async function createTransaction(
  values: TransactionValues,
  lines: TransactionLineValues[]
): Promise<TransactionResult> {
  const g = await authorize("REALIZATION_CREATE");
  if (!g.ok) return g.denial;

  const header = headerOf(values);

  const refused = await refuseCompany(g.actor, header.company_id);
  if (refused) return refused;

  const checked = await checkHeader(header);
  if (!checked.ok) return { ok: false, errors: checked.errors };

  // Any day up to today, inside a year every Company this document will write
  // into may still be written. Asked again at Post, since a year can close in
  // between.
  const dated = await checkDocumentDate(
    values.document_date,
    checked.companyId,
    checked.route
  );
  if (!dated.ok) return { ok: false, errors: { document_date: dated.message } };

  const settled = await checkLines(header, asLines(lines));
  if (!settled.ok) return { ok: false, errors: settled.errors };

  const transaction_no = await nextTransactionNo(checked.direction);
  const docType = await budgetDocTypeId();

  const created = await prisma.finCashBankTransaction.create({
    data: {
      transaction_no,
      // The day it belongs to in the books, chosen on the draft and possibly
      // earlier than today. `posting_date` stays empty until Post writes the
      // moment it actually happened.
      document_date: new Date(`${dated.date}T00:00:00Z`),
      posting_date: null,
      transaction_type: checked.direction,
      company_id: checked.companyId,
      cash_bank_id: checked.cashBankId,
      currency_id: checked.currencyId,
      exchange_rate: checked.rate,
      cash_bank_layer_id: checked.layerId,
      transaction_amount: settled.total,
      // Both figures are provisional while the document is a Draft: a Draft has
      // moved nothing, and Post re-reads the layer before it values anything.
      transaction_base_amount: roundBase(settled.total * checked.rate),
      note: values.note?.trim() || null,
      status: "Draft",
      created_by: g.actor.user.id,
      lines: {
        create: settled.lines.map((l, i) => ({
          sequence_no: i + 1,
          source_doc_type_id: docType,
          source_doc_id: l.budgetId,
          outstanding_amount: l.outstanding,
          settlement_amount: l.amount,
          settlement_base_amount: roundBase(l.amount * checked.rate),
          settlement_exchange_rate: checked.rate,
          transaction_amount: l.amount,
          transaction_base_amount: roundBase(l.amount * checked.rate),
          sub_ledger_balance_id: l.itemId,
          created_by: g.actor.user.id,
        })),
      },
    },
  });

  await audit(created.id, "TAMBAH", "create", g.actor.user.id);
  revalidateFinance(created.id, checked.direction);
  return { ok: true, id: created.id, transaction_no };
}

export async function updateTransaction(
  id: number,
  values: TransactionValues,
  lines: TransactionLineValues[]
): Promise<TransactionResult> {
  const g = await authorize("REALIZATION_EDIT");
  if (!g.ok) return g.denial;

  const existing = await prisma.finCashBankTransaction.findUnique({
    where: { id },
    select: { status: true, transaction_type: true },
  });
  if (!existing) {
    return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  }
  if (!transactionIsEditable(existing.status as TransactionStatus)) {
    return {
      ok: false,
      errors: {
        _form:
          "Dokumen hanya dapat diubah selama berstatus Draft. Dokumen yang " +
          "sudah diposting atau dibatalkan bersifat final.",
      },
    };
  }

  // The direction is the menu the document was raised from, and its number
  // series says so — it is never changed by an edit, whatever is submitted.
  const header = {
    ...headerOf(values),
    transaction_type: existing.transaction_type as "In" | "Out",
  };

  const refused = await refuseCompany(g.actor, header.company_id);
  if (refused) return refused;

  const checked = await checkHeader(header);
  if (!checked.ok) return { ok: false, errors: checked.errors };

  // Any day up to today, inside a year every Company this document will write
  // into may still be written. Asked again at Post, since a year can close in
  // between.
  const dated = await checkDocumentDate(
    values.document_date,
    checked.companyId,
    checked.route
  );
  if (!dated.ok) return { ok: false, errors: { document_date: dated.message } };

  const settled = await checkLines(header, asLines(lines), {
    excludeTransactionId: id,
  });
  if (!settled.ok) return { ok: false, errors: settled.errors };

  const docType = await budgetDocTypeId();

  // A Draft's lines are the document's own content, not history: nothing has
  // been posted from them and no book refers to them. Replacing them wholesale
  // is what "edit the document" means. The no-delete rule protects master data
  // and posted records, neither of which these are.
  await prisma.$transaction(async (tx) => {
    await tx.finCashBankTransactionLine.deleteMany({
      where: { transaction_id: id },
    });
    await tx.finCashBankTransaction.update({
      where: { id },
      data: {
        company_id: checked.companyId,
        cash_bank_id: checked.cashBankId,
        currency_id: checked.currencyId,
        exchange_rate: checked.rate,
        cash_bank_layer_id: checked.layerId,
        document_date: new Date(`${dated.date}T00:00:00Z`),
        transaction_amount: settled.total,
        transaction_base_amount: roundBase(settled.total * checked.rate),
        note: values.note?.trim() || null,
        updated_by: g.actor.user.id,
        lines: {
          create: settled.lines.map((l, i) => ({
            sequence_no: i + 1,
            source_doc_type_id: docType,
            source_doc_id: l.budgetId,
            outstanding_amount: l.outstanding,
            settlement_amount: l.amount,
            settlement_base_amount: roundBase(l.amount * checked.rate),
            settlement_exchange_rate: checked.rate,
            transaction_amount: l.amount,
            transaction_base_amount: roundBase(l.amount * checked.rate),
            sub_ledger_balance_id: l.itemId,
            created_by: g.actor.user.id,
          })),
        },
      },
    });
  });

  await audit(id, "UPDATE", "update", g.actor.user.id);
  revalidateFinance(id, checked.direction);
  return { ok: true, id };
}

export type TransitionResult =
  | { ok: true; status: TransactionStatus; message: string }
  | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle transition.
 *
 * `post` is the only one that writes anything beyond the document's own status,
 * and it is the boundary the whole concept turns on: before it, nothing has
 * happened; after it, nothing can be taken back.
 */
export async function transitionTransaction(
  id: number,
  action: TransactionAction
): Promise<TransitionResult> {
  const transition = TRANSACTION_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };

  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;

  const doc = await prisma.finCashBankTransaction.findUnique({
    where: { id },
    select: { status: true, transaction_type: true },
  });
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  const direction = doc.transaction_type as "In" | "Out";

  const status = doc.status as TransactionStatus;
  if (!transactionTransitionAllowed(action, status)) {
    return {
      ok: false,
      errors: {
        _form: `Dokumen berstatus ${status} tidak dapat di-${transition.label.toLowerCase()}.`,
      },
    };
  }

  if (action === "cancel") {
    // A Pending document has an open Funding Request attached to it, and
    // closing that is the Funding module's to do — cancelling the document
    // here would leave a request open against a document that no longer
    // exists to fund. The transition table admits both statuses; which action
    // runs it is decided by which module owns the rest of the state.
    if (status === "Pending") {
      return {
        ok: false,
        errors: {
          _form:
            "Dokumen yang menunggu funding ditarik kembali melalui Funding Request, " +
            "agar permintaan dananya ikut dibatalkan.",
        },
      };
    }
    await prisma.finCashBankTransaction.update({
      where: { id },
      data: { status: "Cancelled", updated_by: g.actor.user.id },
    });
    await audit(id, "UPDATE", "cancel", g.actor.user.id);
    revalidateFinance(id, direction);
    return { ok: true, status: "Cancelled", message: transition.done };
  }

  // Post is the actual boundary, and everything it touches moves together.
  // The writes themselves live in `applyPosting` so the rule can be exercised
  // by the test suite, which has no session to authorize against.
  const posted = await applyPosting(id, g.actor.user.id);
  if (!posted.ok) return { ok: false, errors: posted.errors };

  await audit(id, "UPDATE", "post", g.actor.user.id);
  revalidateFinance(id, direction);

  return {
    ok: true,
    status: "Posted",
    message: posted.closed
      ? `${transition.done} · ${posted.closed} Budget ditutup`
      : transition.done,
  };
}

/**
 * One row in the trace.
 *
 * Post, Cancel and Submit are all UPDATEs, so `event` is what separates them:
 * without it a document posted after being drafted and edited would show three
 * indistinguishable rows and the panel could not say when the money moved.
 */
async function audit(
  rowId: number,
  action: "TAMBAH" | "UPDATE",
  event: string,
  by: number
) {
  await prisma.auditLog.create({
    data: {
      entity_key: "fin_cash_bank_transaction",
      row_id: rowId,
      action,
      event,
      by,
    },
  });
}

function revalidateFinance(id: number, direction: "In" | "Out") {
  revalidatePath(realizationHref(direction));
  revalidatePath(realizationHref(direction, id));
  // Posting moves both a Budget's realization and a Cash & Bank balance, so the
  // pages that read either are stale the moment this returns.
  revalidatePath("/budget/budget");
  revalidatePath("/budget/budget/month/[period]", "page");
  revalidatePath("/master/cash-bank");
  revalidatePath("/dashboard");
}

/**
 * The journal Post would write for this dokumen, for its confirmation —
 * consequences before commitment. Asks the Post permission itself, because
 * only someone who could post it is being asked to confirm it, and it runs
 * the posting path as a dry run, so it refuses exactly as Post would.
 */
export async function previewTransactionPost(
  id: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const g = await authorize(TRANSACTION_TRANSITIONS.post.permission);
  if (!g.ok) return g.denial;
  return previewPosting(id);
}
