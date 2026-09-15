"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { type Actor } from "@/lib/siba/access";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import {
  BUDGET_TRANSITIONS,
  budgetIsEditable,
  transitionAllowed,
  type BudgetAction,
  type BudgetStatus,
} from "@/lib/siba/budget-workflow";
import { checkClassification, nextBudgetNo } from "@/lib/siba/budget";

/**
 * Budget writes.
 *
 * Two things are enforced here and nowhere else that matters:
 *
 *  1. **The lifecycle.** A transition is legal only from the statuses
 *     `BUDGET_TRANSITIONS` names, and only for a caller holding that
 *     transition's permission. The row menu reads the same table to decide what
 *     to show, but an action is reachable directly with any id and any status,
 *     so the check below is the one that counts.
 *  2. **The classification.** Approval assigns Budget Category and Partner, and
 *     `checkClassification` re-checks the whole chain — direction, whether the
 *     category takes a subject, and whether the partner is one it admits.
 *
 * Editing is refused outright once a budget leaves Draft or Rejected: concept
 * doc §6.4 makes an approved budget immutable, and a budget awaiting approval
 * must not change under the approver.
 */

export type BudgetValues = {
  budget_date: string;
  company_id: string;
  currency_id: string;
  budget_type: string;
  budget_amount: string;
  description: string;
};

export type BudgetResult =
  | { ok: true; id: number; budget_no?: string }
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

async function validate(
  values: BudgetValues,
  existing: { company_id: number } | null
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};

  const date = String(values.budget_date ?? "").trim();
  if (!date) errors.budget_date = "Tanggal Budget wajib diisi.";
  else if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    errors.budget_date = "Tanggal Budget tidak valid.";
  }

  // company_id is immutable once the record exists — ledger history is tied to
  // the Company, so the submitted value is ignored on edit rather than trusted.
  const companyId = existing ? existing.company_id : num(values.company_id);
  if (!companyId) errors.company_id = "Company wajib diisi.";
  else if (!existing) {
    const company = await prisma.sysCompany.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) errors.company_id = "Company tidak ditemukan.";
  }

  const currencyId = num(values.currency_id);
  if (!currencyId) errors.currency_id = "Currency wajib diisi.";
  else {
    const currency = await prisma.refCurrency.findUnique({
      where: { id: currencyId },
      select: { status: true },
    });
    if (!currency) errors.currency_id = "Currency tidak ditemukan.";
    else if (currency.status !== "Active") {
      errors.currency_id = "Currency tersebut non-aktif dan tidak dapat dipilih.";
    }
  }

  const type = String(values.budget_type ?? "").trim();
  if (!type) errors.budget_type = "Tipe wajib diisi.";
  else if (type !== "In" && type !== "Out") {
    errors.budget_type = "Tipe harus Penerimaan atau Pengeluaran.";
  }

  const amount = num(values.budget_amount);
  if (amount == null) errors.budget_amount = "Nominal Budget wajib diisi.";
  else if (!(amount > 0)) {
    errors.budget_amount = "Nominal budget harus lebih dari nol.";
  }

  if (!String(values.description ?? "").trim()) {
    errors.description = "Deskripsi wajib diisi.";
  }

  return errors;
}

export async function createBudget(values: BudgetValues): Promise<BudgetResult> {
  const g = await authorize("BUDGET_CREATE");
  if (!g.ok) return g.denial;

  const errors = await validate(values, null);
  if (Object.keys(errors).length) return { ok: false, errors };

  const budget_no = await nextBudgetNo();
  const created = await prisma.budBudget.create({
    data: {
      budget_no,
      budget_date: new Date(`${values.budget_date}T00:00:00Z`),
      company_id: num(values.company_id)!,
      currency_id: num(values.currency_id)!,
      budget_type: values.budget_type as "In" | "Out",
      description: values.description.trim(),
      budget_amount: num(values.budget_amount)!,
      // Classification is an approver's job — both stay null until then.
      category_id: null,
      partner_id: null,
      status: "Draft",
      created_by: g.actor.user.id,
      updated_by: null,
    },
  });

  await audit(created.id, "TAMBAH", g.actor.user.id);
  revalidateBudget(created.id);
  return { ok: true, id: created.id, budget_no };
}

export async function updateBudget(
  id: number,
  values: BudgetValues
): Promise<BudgetResult> {
  const g = await authorize("BUDGET_EDIT");
  if (!g.ok) return g.denial;

  const existing = await prisma.budBudget.findUnique({
    where: { id },
    select: { status: true, company_id: true },
  });
  if (!existing) return { ok: false, errors: { _form: "Budget tidak ditemukan." } };

  if (!budgetIsEditable(existing.status as BudgetStatus)) {
    return {
      ok: false,
      errors: {
        _form:
          "Budget hanya dapat diubah selama berstatus Draft atau Ditolak. " +
          "Budget yang sudah diajukan atau disetujui bersifat final.",
      },
    };
  }

  const errors = await validate(values, { company_id: existing.company_id });
  if (Object.keys(errors).length) return { ok: false, errors };

  await prisma.budBudget.update({
    where: { id },
    data: {
      budget_date: new Date(`${values.budget_date}T00:00:00Z`),
      currency_id: num(values.currency_id)!,
      budget_type: values.budget_type as "In" | "Out",
      description: values.description.trim(),
      budget_amount: num(values.budget_amount)!,
      updated_by: g.actor.user.id,
    },
  });

  await audit(id, "UPDATE", g.actor.user.id);
  revalidateBudget(id);
  return { ok: true, id };
}

export type TransitionResult =
  | { ok: true; status: BudgetStatus; message: string }
  | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle transition.
 *
 * `classification` applies to `approve` only, which is the single transition
 * that also writes data: the Budget Category and Partner an approver assigns.
 */
export async function transitionBudget(
  id: number,
  action: BudgetAction,
  classification?: { category_id: string | null; partner_id: string | null }
): Promise<TransitionResult> {
  const transition = BUDGET_TRANSITIONS[action];
  if (!transition) return { ok: false, errors: { _form: "Aksi tidak dikenal." } };

  const g = await authorize(transition.permission);
  if (!g.ok) return g.denial;

  const budget = await prisma.budBudget.findUnique({
    where: { id },
    select: {
      status: true,
      company_id: true,
      budget_type: true,
      budget_no: true,
      description: true,
    },
  });
  if (!budget) return { ok: false, errors: { _form: "Budget tidak ditemukan." } };

  const status = budget.status as BudgetStatus;
  if (!transitionAllowed(action, status)) {
    return {
      ok: false,
      errors: {
        _form: `Budget berstatus ${status} tidak dapat di-${transition.label.toLowerCase()}.`,
      },
    };
  }

  const data: Record<string, unknown> = {
    status: transition.to,
    updated_by: g.actor.user.id,
  };

  if (action === "approve") {
    const categoryId = num(classification?.category_id ?? null);
    const partnerId = num(classification?.partner_id ?? null);
    const problems = await checkClassification(budget, categoryId, partnerId);
    if (Object.keys(problems).length) return { ok: false, errors: problems };
    data.category_id = categoryId;
    // A category that takes no subject stores null, never a stale partner.
    data.partner_id = partnerId;
  }

  await prisma.budBudget.update({ where: { id }, data });
  await audit(id, "UPDATE", g.actor.user.id);
  revalidateBudget(id);

  return { ok: true, status: transition.to, message: transition.done };
}

async function audit(rowId: number, action: "TAMBAH" | "UPDATE", by: number) {
  await prisma.auditLog.create({
    data: { entity_key: "bud_budget", row_id: rowId, action, by },
  });
}

function revalidateBudget(id: number) {
  revalidatePath("/budget/budget");
  revalidatePath("/budget/budget/month/[period]", "page");
  revalidatePath(`/budget/budget/${id}`);
  revalidatePath("/dashboard");
}
