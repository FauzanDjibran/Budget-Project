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
import { delegate, nextCode, requireEntity } from "@/lib/siba/records";

/**
 * Every action here is permission-gated before it touches anything, and every
 * write is attributed to the signed-in user. A Server Action is reachable
 * directly, so the check below — not the hidden button in the list — is what
 * actually stops an unauthorized write.
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

async function validate(
  entity: Entity,
  values: FormValues,
  currentId: number | null
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};

  for (const field of entity.fields) {
    const value = coerce(field, values[field.name]);

    if (field.required) {
      const missing =
        value === null || value === undefined || value === "" ;
      if (missing) errors[field.name] = `${field.label} wajib diisi.`;
    }

    if (field.unique && typeof value === "string" && value !== "") {
      const clash = await delegate(entity.key).findFirst({
        where: {
          [field.name]: { equals: value, mode: "insensitive" },
          ...(currentId ? { id: { not: currentId } } : {}),
        },
        select: { id: true },
      });
      if (clash) {
        errors[field.name] = `${field.label} "${value}" sudah dipakai record lain.`;
      }
    }
  }

  // Company has no write path, so there is no single-parent rule to validate
  // here — the invariant is asserted against the seeded data instead, by
  // `companyStructure()` in records.ts.

  // A cash/bank resource must post to an account owned by the same company.
  if (entity.key === "m_cash_bank") {
    const companyId = coerce({ name: "company_id", label: "", type: "ref" }, values.company_id);
    const accountId = coerce({ name: "account_id", label: "", type: "ref" }, values.account_id);
    if (companyId && accountId) {
      const account = await prisma.accAccount.findUnique({
        where: { id: Number(accountId) },
        select: { company_id: true },
      });
      if (account && account.company_id !== Number(companyId)) {
        errors.account_id =
          "Account harus milik Company yang sama dengan resource ini.";
      }
    }
  }

  return errors;
}

function buildData(entity: Entity, values: FormValues) {
  const data: Record<string, unknown> = {};
  for (const field of entity.fields) {
    data[field.name] = coerce(field, values[field.name]);
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

  const errors = await validate(entity, values, null);
  if (Object.keys(errors).length) return { ok: false, errors };

  const code = await nextCode(entity);
  const created = await delegate(entity.key).create({
    data: {
      ...buildData(entity, values),
      [entity.codeField]: code,
      created_by: actor.user.id,
      updated_by: null,
    },
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
  // changes go through seed data, not through this path.
  if (isCompanyEntity(slug)) {
    return { ok: false, errors: { _form: COMPANY_UPDATE_BLOCKED } };
  }

  const entity = requireEntity(slug);
  const guard = await authorize(entity.key, "edit");
  if (!guard.ok) return guard.denial;
  const actor = guard.actor;

  const errors = await validate(entity, values, id);
  if (Object.keys(errors).length) return { ok: false, errors };

  const data = buildData(entity, values);
  // Locked fields are immutable once the record exists.
  for (const field of entity.fields) {
    if (field.locked) delete data[field.name];
  }

  await delegate(entity.key).update({
    where: { id },
    data: { ...data, updated_by: actor.user.id },
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
): Promise<{ ok: boolean; status?: string; message?: string }> {
  // Deactivating is an edit, so the company lock covers it too.
  if (isCompanyEntity(slug)) {
    return { ok: false, message: COMPANY_UPDATE_BLOCKED };
  }

  const entity = requireEntity(slug);
  if (!entity.statusField) {
    return { ok: false, message: `${entity.name} tidak memiliki status.` };
  }

  const row = await delegate(entity.key).findUnique({ where: { id } });
  if (!row) return { ok: false, message: "Data tidak ditemukan." };

  const next = row.status === "Active" ? "Inactive" : "Active";

  // Activating and deactivating are separate capabilities, so the direction of
  // the toggle decides which permission is required.
  const guard = await authorize(entity.key, next === "Active" ? "activate" : "deactivate");
  if (!guard.ok) return { ok: false, message: guard.denial.errors._form };
  const actor = guard.actor;
  await delegate(entity.key).update({
    where: { id },
    data: { status: next, updated_by: actor.user.id },
  });

  await prisma.auditLog.create({
    data: { entity_key: entity.key, row_id: id, action: "UPDATE", by: actor.user.id },
  });

  revalidatePath(`/${entity.module}/${entity.slug}`);
  revalidatePath(`/${entity.module}/${entity.slug}/${id}`);
  revalidatePath("/dashboard");
  return { ok: true, status: next };
}
