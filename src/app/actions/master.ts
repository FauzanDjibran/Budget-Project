"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { type Actor } from "@/lib/siba/access";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { entityPermissions } from "@/lib/siba/entity-access";
import {
  COMPANY_CREATE_BLOCKED,
  COMPANY_UPDATE_BLOCKED,
  isCompanyEntity,
} from "@/lib/siba/company";
import { type Entity, type Field } from "@/lib/siba/entities";
import { openCashBankBook } from "@/lib/siba/cash-bank";
import { ensureFiscalPeriods, fiscalYearShape, parseYear } from "@/lib/siba/fiscal";
import {
  CASH_BANK_SUBCATEGORIES,
  accountDescendants,
  checkCashBankAccount,
  delegate,
  nextCode,
  partnerCategoriesForBudgetCategory,
  requireEntity,
} from "@/lib/siba/records";

/**
 * Every action here is permission-gated before it touches anything, and every
 * write is attributed to the signed-in user. A Server Action is reachable
 * directly, so the check below — not the hidden button in the list — is what
 * actually stops an unauthorized write.
 *
 * The same holds for the business rules in `validate`: a picker that offers
 * only valid options is a convenience. The rules are enforced here.
 */

export type FormValues = Record<string, string | boolean | null>;

/**
 * `errors` is keyed by field name, except for `_form` — a whole-form refusal
 * that no single field can carry, such as a locked entity.
 */
export type SaveResult =
  | { ok: true; id: number; code?: string }
  | { ok: false; errors: Record<string, string> };

type Guard =
  | { ok: true; actor: Actor }
  | { ok: false; denial: { ok: false; errors: Record<string, string> } };

/**
 * Resolves the caller and checks the one permission this operation needs.
 *
 * Refusals come back as a `_form` error rather than an exception, so the form
 * shows them the same way it shows a validation failure. The message never
 * names the permission code.
 */
async function authorize(
  entityKey: string,
  operation: "create" | "edit" | "activate" | "deactivate"
): Promise<Guard> {
  const code = entityPermissions(entityKey)[operation];
  if (!code) {
    return { ok: false, denial: { ok: false, errors: { _form: "Operasi tidak tersedia." } } };
  }
  try {
    return { ok: true, actor: await authorizeAction(code) };
  } catch (error) {
    if (isAccessDenied(error)) {
      return { ok: false, denial: { ok: false, errors: { _form: error.message } } };
    }
    throw error;
  }
}

/**
 * Coerces a submitted value to what Prisma expects for the field's type.
 * Empty string means "not filled" for every type except text/textarea.
 */
function coerce(field: Field, raw: string | boolean | null | undefined) {
  if (field.type === "bool") return raw === true || raw === "true";

  const value = raw == null ? "" : String(raw).trim();

  if (field.type === "ref" || field.type === "number") {
    if (value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (field.type === "select") return value === "" ? null : value;
  if (field.type === "date") return value === "" ? null : new Date(`${value}T00:00:00Z`);
  return value;
}

/** A numeric field's value, or null when it was blank or unparseable. */
const numberValue = (values: FormValues, name: string): number | null => {
  const raw = values[name];
  if (raw == null || raw === "" || raw === true || raw === false) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** A ref field carries a row id, which is a number like any other. */
const refValue = numberValue;

const boolValue = (values: FormValues, name: string): boolean =>
  values[name] === true || values[name] === "true";


/**
 * Fills in the fields nobody types.
 *
 * A Fiscal Year is chosen by year alone; its name and its 01/01–31/12 range
 * follow from that and are written here rather than submitted, so a crafted
 * request cannot put a fiscal year's dates out of step with the year it claims
 * to be. Runs before validation, so the derived values are what gets checked.
 */
function derive(entity: Entity, values: FormValues): FormValues {
  if (entity.key !== "acc_fiscal_year") return values;

  const year = parseYear(String(values.year_label ?? ""));
  if (!year) return values;

  const shape = fiscalYearShape(year);
  return {
    ...values,
    year_name: shape.year_name,
    start_date: shape.start_date.toISOString().slice(0, 10),
    end_date: shape.end_date.toISOString().slice(0, 10),
  };
}

/**
 * Which fields apply given what has been entered. A field that does not apply
 * is not merely hidden: it is stored as null and its `required` is waived. The
 * form hides the same fields, but this is the decision that counts.
 */
async function applicableFields(
  entity: Entity,
  values: FormValues,
  exists: boolean
): Promise<Set<string>> {
  const applies = new Set<string>();
  let budgetCategoryNeedsPartner: boolean | null = null;

  for (const field of entity.fields) {
    // A create-only field is not merely hidden on edit: it is not part of the
    // submission at all, so an edit cannot smuggle one in.
    if (field.createOnly && exists) continue;
    if (!field.visibleWhen) {
      applies.add(field.name);
      continue;
    }
    if (field.visibleWhen === "accountRequiresPartner") {
      if (boolValue(values, "require_partner")) applies.add(field.name);
      continue;
    }
    if (budgetCategoryNeedsPartner === null) {
      const categoryId = refValue(values, "budget_category_id");
      const rule = categoryId
        ? await partnerCategoriesForBudgetCategory(categoryId)
        : null;
      budgetCategoryNeedsPartner = rule?.needsPartner ?? false;
    }
    if (budgetCategoryNeedsPartner) applies.add(field.name);
  }
  return applies;
}

async function validate(
  entity: Entity,
  values: FormValues,
  currentId: number | null,
  applies: Set<string>
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};

  for (const field of entity.fields) {
    if (!applies.has(field.name)) continue;
    const value = coerce(field, values[field.name]);

    if (field.required) {
      const missing = value === null || value === undefined || value === "";
      if (missing) errors[field.name] = `${field.label} wajib diisi.`;
    }

    if (field.unique && typeof value === "string" && value !== "") {
      // Scoped uniqueness where the identity is only unique within a parent —
      // an account number is unique per Company, not across the whole table.
      const scope = field.uniqueWithin
        ? { [field.uniqueWithin]: refValue(values, field.uniqueWithin) }
        : {};
      const clash = await delegate(entity.key).findFirst({
        where: {
          [field.name]: { equals: value, mode: "insensitive" },
          ...scope,
          ...(currentId ? { id: { not: currentId } } : {}),
        },
        select: { id: true },
      });
      if (clash) {
        errors[field.name] = field.uniqueWithin
          ? `${field.label} "${value}" sudah dipakai pada Company yang sama.`
          : `${field.label} "${value}" sudah dipakai record lain.`;
      }
    }
  }

  // Company has no write path, so there is no single-parent rule to validate
  // here — the invariant is asserted against what is in the database instead, by
  // `companyStructure()` in records.ts.

  if (entity.key === "m_cash_bank") {
    Object.assign(errors, await validateCashBank(values, errors));
  }
  if (entity.key === "acc_account") {
    Object.assign(errors, await validateAccount(values, currentId, errors));
  }
  if (entity.key === "acc_budget_category_account") {
    Object.assign(errors, await validateMapping(values, currentId, errors, applies));
  }
  if (entity.key === "acc_fiscal_year" && !parseYear(String(values.year_label ?? ""))) {
    // Everything else about a fiscal year is derived from this, so a value the
    // picker could not have produced has to stop here.
    errors.year_label = "Pilih tahun buku yang valid.";
  }

  return errors;
}

/**
 * A Cash & Bank resource posts to exactly one account, and that account must be
 * one the resource can legitimately use: owned by the same Company, postable,
 * in the Kas or Bank group, and active.
 */
async function validateCashBank(
  values: FormValues,
  existing: Record<string, string>
): Promise<Record<string, string>> {
  if (existing.company_id || existing.account_id) return {};
  const companyId = refValue(values, "company_id");
  const accountId = refValue(values, "account_id");
  if (!companyId || !accountId) return {};

  const problem = await checkCashBankAccount(accountId, companyId);
  return problem ? { account_id: problem } : {};
}

async function validateAccount(
  values: FormValues,
  currentId: number | null,
  existing: Record<string, string>
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const companyId = refValue(values, "company_id");
  const parentId = refValue(values, "parent_account");

  if (parentId && companyId && !existing.parent_account) {
    if (currentId && parentId === currentId) {
      errors.parent_account = "Account tidak dapat menjadi parent dari dirinya sendiri.";
    } else {
      const parent = await prisma.accAccount.findUnique({
        where: { id: parentId },
        select: { company_id: true },
      });
      if (!parent) {
        errors.parent_account = "Parent Account tidak ditemukan.";
      } else if (parent.company_id !== companyId) {
        errors.parent_account =
          "Parent Account harus berada pada Company yang sama.";
      } else if (currentId && (await accountDescendants(currentId)).has(parentId)) {
        // Without this an account could be made a child of its own descendant,
        // and the tree would contain a loop no renderer could terminate on.
        errors.parent_account =
          "Parent Account tidak boleh berada di bawah account ini.";
      }
    }
  }

  // An account that a Cash & Bank resource already posts to cannot be moved out
  // from under the rule that let it be chosen in the first place.
  if (currentId) {
    const dependents = await prisma.mCashBank.findMany({
      where: { account_id: currentId },
      select: { cash_bank_label: true },
    });
    if (dependents.length) {
      const used = dependents.map((d) => d.cash_bank_label).join(", ");
      if (!boolValue(values, "is_postable")) {
        errors.is_postable = `Account ini dipakai Cash & Bank (${used}) dan harus tetap postable.`;
      }
      if (!boolValue(values, "is_active")) {
        errors.is_active = `Account ini dipakai Cash & Bank (${used}) dan tidak dapat dinonaktifkan.`;
      }
      const subcategoryId = refValue(values, "account_subcategory_id");
      if (subcategoryId) {
        const sub = await prisma.accAccountSubcategory.findUnique({
          where: { id: subcategoryId },
          select: { subcategory_label: true },
        });
        if (sub && !CASH_BANK_SUBCATEGORIES.includes(sub.subcategory_label)) {
          errors.account_subcategory_id = `Account ini dipakai Cash & Bank (${used}) dan harus tetap pada kelompok Kas atau Bank.`;
        }
      }
    }
  }

  return errors;
}

async function validateMapping(
  values: FormValues,
  currentId: number | null,
  existing: Record<string, string>,
  applies: Set<string>
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const companyId = refValue(values, "company_id");
  const budgetCategoryId = refValue(values, "budget_category_id");
  const partnerCategoryId = applies.has("partner_category_id")
    ? refValue(values, "partner_category_id")
    : null;
  const accountId = refValue(values, "account_id");

  if (budgetCategoryId) {
    const rule = await partnerCategoriesForBudgetCategory(budgetCategoryId);
    if (rule) {
      if (rule.needsPartner && !partnerCategoryId) {
        errors.partner_category_id =
          "Budget Category ini mensyaratkan Partner Category.";
      }
      if (
        partnerCategoryId &&
        !rule.allowedIds.includes(partnerCategoryId)
      ) {
        errors.partner_category_id =
          "Partner Category tersebut tidak berlaku untuk Budget Category ini.";
      }
    }
  }

  if (accountId && companyId && !existing.account_id) {
    const account = await prisma.accAccount.findUnique({
      where: { id: accountId },
      select: { company_id: true, is_postable: true, is_active: true },
    });
    if (!account) errors.account_id = "Account tidak ditemukan.";
    else if (account.company_id !== companyId) {
      errors.account_id = "Account harus milik Company yang sama.";
    } else if (!account.is_postable) {
      errors.account_id = "Account header tidak dapat menjadi tujuan posting.";
    } else if (!account.is_active) {
      errors.account_id = "Account tersebut non-aktif dan tidak dapat dipilih.";
    }
  }

  if (companyId && budgetCategoryId && !errors.partner_category_id) {
    const clash = await prisma.accBudgetCategoryAccount.findFirst({
      where: {
        company_id: companyId,
        budget_category_id: budgetCategoryId,
        partner_category_id: partnerCategoryId,
        ...(currentId ? { id: { not: currentId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      errors.account_id =
        "Kombinasi Company, Budget Category, dan Partner Category ini sudah dipetakan.";
    }
  }

  return errors;
}

function buildData(entity: Entity, values: FormValues, applies: Set<string>) {
  const data: Record<string, unknown> = {};
  for (const field of entity.fields) {
    if (field.virtual) continue;
    data[field.name] = applies.has(field.name)
      ? coerce(field, values[field.name])
      : field.type === "bool"
        ? false
        : null;
  }
  return data;
}

export async function createRecord(
  slug: string,
  values: FormValues
): Promise<SaveResult> {
  // Company is create-locked: the two-company structure is foundational, so the
  // count can never change from the application. Checked before the permission
  // check because it holds for everyone, whatever they are allowed to do.
  if (isCompanyEntity(slug)) {
    return { ok: false, errors: { _form: COMPANY_CREATE_BLOCKED } };
  }

  const entity = requireEntity(slug);
  const guard = await authorize(entity.key, "create");
  if (!guard.ok) return guard.denial;
  const actor = guard.actor;

  values = derive(entity, values);
  const applies = await applicableFields(entity, values, false);
  const errors = await validate(entity, values, null, applies);
  if (Object.keys(errors).length) return { ok: false, errors };

  const code = await nextCode(entity);
  const created = await prisma.$transaction(async (tx) => {
    const row = await delegate(entity.key, tx).create({
      data: {
        ...buildData(entity, values, applies),
        [entity.codeField]: code,
        created_by: actor.user.id,
        updated_by: null,
      },
    });

    // A Fiscal Year opened straight away gets its twelve months now; one saved
    // as Draft gets them when it is opened. Either way nobody types a month.
    if (entity.key === "acc_fiscal_year" && values.status === "Open") {
      await ensureFiscalPeriods(tx, {
        fiscalYearId: row.id,
        year: parseYear(String(values.year_label ?? ""))!,
        actorId: actor.user.id,
      });
    }

    // A Cash & Bank resource gets its book in the same transaction it is
    // registered in, so no resource can ever exist without one. A non-zero
    // starting figure becomes the book's opening entry rather than a column on
    // the master — see `lib/siba/cash-bank.ts`.
    if (entity.key === "m_cash_bank") {
      await openCashBankBook(tx, {
        cashBankId: row.id,
        openingBalance: numberValue(values, "opening_balance") ?? 0,
        date: new Date().toISOString().slice(0, 10),
        actorId: actor.user.id,
      });
    }

    return row;
  });

  await prisma.auditLog.create({
    data: { entity_key: entity.key, row_id: created.id, action: "TAMBAH", by: actor.user.id },
  });

  revalidatePath(`/${entity.module}/${entity.slug}`);
  revalidatePath("/dashboard");
  return { ok: true, id: created.id, code };
}

export async function updateRecord(
  slug: string,
  id: number,
  values: FormValues
): Promise<SaveResult> {
  // Company is edit-locked for the same reason it is create-locked. Identity
  // changes are made directly in the database, not through this path.
  if (isCompanyEntity(slug)) {
    return { ok: false, errors: { _form: COMPANY_UPDATE_BLOCKED } };
  }

  const entity = requireEntity(slug);
  const guard = await authorize(entity.key, "edit");
  if (!guard.ok) return guard.denial;
  const actor = guard.actor;

  values = derive(entity, values);
  const applies = await applicableFields(entity, values, true);
  const errors = await validate(entity, values, id, applies);
  if (Object.keys(errors).length) return { ok: false, errors };

  const data = buildData(entity, values, applies);
  // Locked fields are immutable once the record exists.
  for (const field of entity.fields) {
    if (field.locked) delete data[field.name];
  }

  await prisma.$transaction(async (tx) => {
    await delegate(entity.key, tx).update({
      where: { id },
      data: { ...data, updated_by: actor.user.id },
    });

    // Opening a Fiscal Year is what creates its calendar. The year comes from
    // the stored row, not the submission: `year_label` is locked, so an edit
    // never carries one.
    if (entity.key === "acc_fiscal_year" && values.status === "Open") {
      const row = await tx.accFiscalYear.findUniqueOrThrow({
        where: { id },
        select: { year_label: true },
      });
      const year = parseYear(row.year_label);
      if (year) {
        await ensureFiscalPeriods(tx, {
          fiscalYearId: id,
          year,
          actorId: actor.user.id,
        });
      }
    }
  });

  await prisma.auditLog.create({
    data: { entity_key: entity.key, row_id: id, action: "UPDATE", by: actor.user.id },
  });

  revalidatePath(`/${entity.module}/${entity.slug}`);
  revalidatePath(`/${entity.module}/${entity.slug}/${id}`);
  revalidatePath("/dashboard");
  return { ok: true, id };
}

export async function toggleStatus(
  slug: string,
  id: number
): Promise<{ ok: boolean; active?: boolean; message?: string }> {
  // Deactivating is an edit, so the company lock covers it too.
  if (isCompanyEntity(slug)) {
    return { ok: false, message: COMPANY_UPDATE_BLOCKED };
  }

  const entity = requireEntity(slug);
  const model = entity.statusModel;
  if (!model?.toggle) {
    return { ok: false, message: `${entity.name} tidak memiliki status aktif/non-aktif.` };
  }

  const row = await delegate(entity.key).findUnique({ where: { id } });
  if (!row) return { ok: false, message: "Data tidak ditemukan." };

  const wasActive =
    model.kind === "bool" ? row[model.field] === true : row[model.field] === "Active";
  const nextActive = !wasActive;

  // Activating and deactivating are separate capabilities, so the direction of
  // the toggle decides which permission is required.
  const guard = await authorize(entity.key, nextActive ? "activate" : "deactivate");
  if (!guard.ok) return { ok: false, message: guard.denial.errors._form };
  const actor = guard.actor;

  // Deactivating an account that a Cash & Bank resource posts to would leave
  // that resource pointing at an account it could no longer have chosen.
  if (entity.key === "acc_account" && !nextActive) {
    const dependents = await prisma.mCashBank.findMany({
      where: { account_id: id },
      select: { cash_bank_label: true },
    });
    if (dependents.length) {
      return {
        ok: false,
        message: `Account ini dipakai Cash & Bank (${dependents
          .map((d) => d.cash_bank_label)
          .join(", ")}) dan tidak dapat dinonaktifkan.`,
      };
    }
  }

  await delegate(entity.key).update({
    where: { id },
    data: {
      [model.field]: model.kind === "bool" ? nextActive : nextActive ? "Active" : "Inactive",
      updated_by: actor.user.id,
    },
  });

  await prisma.auditLog.create({
    data: { entity_key: entity.key, row_id: id, action: "UPDATE", by: actor.user.id },
  });

  revalidatePath(`/${entity.module}/${entity.slug}`);
  revalidatePath(`/${entity.module}/${entity.slug}/${id}`);
  revalidatePath("/dashboard");
  return { ok: true, active: nextActive };
}
