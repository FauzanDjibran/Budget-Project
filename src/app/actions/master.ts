"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { type Entity, type Field } from "@/lib/siba/entities";
import { delegate, nextCode, requireEntity } from "@/lib/siba/records";

/** Until Auth.js lands, writes are attributed to the seeded everyday user. */
const CURRENT_USER = 2;

export type FormValues = Record<string, string | boolean | null>;

export type SaveResult =
  | { ok: true; id: number; code?: string }
  | { ok: false; errors: Record<string, string> };

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

  // Exactly one company may be the treasury parent.
  if (entity.key === "sys_company") {
    const wantsParent = coerce({ name: "is_parent", label: "", type: "bool" }, values.is_parent);
    if (wantsParent) {
      const other = await prisma.sysCompany.findFirst({
        where: { is_parent: true, ...(currentId ? { id: { not: currentId } } : {}) },
        select: { id: true },
      });
      if (other) {
        errors.is_parent =
          "Sudah ada Company induk. Hanya boleh satu induk dalam satu sistem.";
      }
    } else if (currentId) {
      const current = await prisma.sysCompany.findUnique({
        where: { id: currentId },
        select: { is_parent: true },
      });
      const anyOther = await prisma.sysCompany.findFirst({
        where: { is_parent: true, id: { not: currentId } },
        select: { id: true },
      });
      if (current?.is_parent && !anyOther) {
        errors.is_parent =
          "Harus ada satu Company yang ditetapkan sebagai induk.";
      }
    }
  }

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
  const entity = requireEntity(slug);

  const errors = await validate(entity, values, null);
  if (Object.keys(errors).length) return { ok: false, errors };

  const code = await nextCode(entity);
  const created = await delegate(entity.key).create({
    data: {
      ...buildData(entity, values),
      [entity.codeField]: code,
      created_by: CURRENT_USER,
      updated_by: null,
    },
  });

  await prisma.auditLog.create({
    data: { entity_key: entity.key, row_id: created.id, action: "TAMBAH", by: CURRENT_USER },
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
  const entity = requireEntity(slug);

  const errors = await validate(entity, values, id);
  if (Object.keys(errors).length) return { ok: false, errors };

  const data = buildData(entity, values);
  // Locked fields are immutable once the record exists.
  for (const field of entity.fields) {
    if (field.locked) delete data[field.name];
  }

  await delegate(entity.key).update({
    where: { id },
    data: { ...data, updated_by: CURRENT_USER },
  });

  await prisma.auditLog.create({
    data: { entity_key: entity.key, row_id: id, action: "UPDATE", by: CURRENT_USER },
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
  const entity = requireEntity(slug);
  if (!entity.statusField) {
    return { ok: false, message: `${entity.name} tidak memiliki status.` };
  }

  const row = await delegate(entity.key).findUnique({ where: { id } });
  if (!row) return { ok: false, message: "Data tidak ditemukan." };

  const next = row.status === "Active" ? "Inactive" : "Active";
  await delegate(entity.key).update({
    where: { id },
    data: { status: next, updated_by: CURRENT_USER },
  });

  await prisma.auditLog.create({
    data: { entity_key: entity.key, row_id: id, action: "UPDATE", by: CURRENT_USER },
  });

  revalidatePath(`/${entity.module}/${entity.slug}`);
  revalidatePath(`/${entity.module}/${entity.slug}/${id}`);
  revalidatePath("/dashboard");
  return { ok: true, status: next };
}
