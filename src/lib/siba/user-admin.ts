import "server-only";

import { prisma } from "@/lib/prisma";
import { type Actor, actorCan, permissionsForUser } from "./access";
import { AccessDeniedError } from "./auth-errors";
import { hashPassword, normalizeEmail, passwordProblem } from "./login";
import {
  ADMIN_CRITICAL_PERMISSIONS,
  PERMISSION_CODES,
  isPermissionCode,
} from "./permissions";
import {
  ROLE_FROZEN_MESSAGE,
  ROLE_SYSTEM_MESSAGE,
  isFrozenRoleLabel,
  isSystemRoleLabel,
} from "./roles";
import { revokeSessionsForUser } from "./session";

/**
 * User and role administration.
 *
 * Every function here takes the acting user explicitly and asserts the
 * permission it needs before touching anything. That is the enforcement point:
 * the Server Actions in `src/app/actions/` are thin wrappers with no rules of
 * their own, so an action reached directly is checked exactly like one reached
 * through the UI.
 *
 * Three protections sit on top of the plain permission checks, because a
 * permission alone is not enough to make privilege changes safe:
 *
 *   1. Nobody edits their own access. Not roles, not status, not a password
 *      reset — those go through the profile, which verifies the current
 *      password. This is what makes self-escalation impossible even for an
 *      administrator who lost their judgement.
 *   2. The application always keeps a way in. Any change that would leave no
 *      active user holding the administration permissions is refused.
 *   3. The ADMIN role's permission set is frozen, so (2) cannot be defeated by
 *      emptying the role instead of the account.
 */

/** Mirrors `SaveResult` in the Master actions, so forms handle both the same. */
export type AdminResult =
  | { ok: true; id: number; status?: string }
  | { ok: false; errors: Record<string, string> };

const SELF_ROLE_MESSAGE =
  "Anda tidak dapat mengubah role akun Anda sendiri. Minta administrator lain melakukannya.";
const SELF_STATUS_MESSAGE = "Anda tidak dapat menonaktifkan akun Anda sendiri.";
const SELF_RESET_MESSAGE =
  "Password akun sendiri diubah melalui Profil Saya, dengan memasukkan password lama.";
const LAST_ADMIN_MESSAGE =
  "Perubahan ini akan membuat sistem tidak memiliki administrator aktif. " +
  "Tunjuk administrator lain terlebih dahulu.";

function deny(field: string, message: string): AdminResult {
  return { ok: false, errors: { [field]: message } };
}

function assert(actor: Actor, code: string): void {
  if (!actorCan(actor, code)) throw new AccessDeniedError("UNAUTHORIZED");
}

// ---------------------------------------------------------------- codes

async function nextUserCode(): Promise<string> {
  const rows = await prisma.sysUser.findMany({ select: { user_code: true } });
  return nextSequentialCode("user", rows.map((r) => r.user_code));
}

async function nextRoleCode(): Promise<string> {
  const rows = await prisma.sysRole.findMany({ select: { role_code: true } });
  return nextSequentialCode("role", rows.map((r) => r.role_code));
}

function nextSequentialCode(prefix: string, existing: string[]): string {
  let max = 0;
  for (const code of existing) {
    const n = Number(String(code ?? "").split(".")[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}.${String(max + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------- audit

async function audit(
  entityKey: string,
  rowId: number,
  action: "TAMBAH" | "UPDATE",
  by: number
): Promise<void> {
  await prisma.auditLog.create({
    data: { entity_key: entityKey, row_id: rowId, action, by },
  });
}

// ---------------------------------------------------------------- invariants

/**
 * True when at least one Active user still holds every administration
 * permission, once `overrides` are applied.
 *
 * `overrides` describes the change being considered — a user's prospective role
 * ids, or a role's prospective permission codes — so the check runs before the
 * write rather than after, and nothing needs rolling back.
 */
async function administrationSurvives(overrides: {
  userRoles?: { userId: number; roleIds: number[] };
  userStatus?: { userId: number; status: "Active" | "Inactive" };
  rolePermissions?: { roleId: number; codes: string[] };
}): Promise<boolean> {
  const [users, assignments, roles] = await Promise.all([
    prisma.sysUser.findMany({ select: { id: true, status: true } }),
    prisma.sysUserRole.findMany({ select: { user_id: true, role_id: true } }),
    prisma.sysRole.findMany({
      select: {
        id: true,
        status: true,
        permissions: { select: { permission: { select: { permission_code: true } } } },
      },
    }),
  ]);

  const roleCodes = new Map<number, Set<string>>();
  for (const role of roles) {
    const codes =
      overrides.rolePermissions && overrides.rolePermissions.roleId === role.id
        ? new Set(overrides.rolePermissions.codes)
        : new Set(role.permissions.map((p) => p.permission.permission_code));
    roleCodes.set(role.id, role.status === "Active" ? codes : new Set());
  }

  for (const user of users) {
    const status =
      overrides.userStatus && overrides.userStatus.userId === user.id
        ? overrides.userStatus.status
        : user.status;
    if (status !== "Active") continue;

    const roleIds =
      overrides.userRoles && overrides.userRoles.userId === user.id
        ? overrides.userRoles.roleIds
        : assignments.filter((a) => a.user_id === user.id).map((a) => a.role_id);

    const held = new Set<string>();
    for (const id of roleIds) {
      for (const code of roleCodes.get(id) ?? []) held.add(code);
    }
    if (ADMIN_CRITICAL_PERMISSIONS.every((c) => held.has(c))) return true;
  }

  return false;
}

// ---------------------------------------------------------------- reads

export type UserRow = {
  id: number;
  user_code: string;
  email: string;
  name: string;
  initials: string;
  status: string;
  role_labels: string[];
  role_names: string[];
  created_at: string;
  updated_at: string;
  updated_by: number | null;
  created_by: number | null;
};

/**
 * Never selects `password_hash`. The column is read in exactly two places —
 * `authenticate` and `verifyPassword` — and leaves neither.
 */
export async function listUsers(actor: Actor): Promise<UserRow[]> {
  assert(actor, "USER_VIEW");
  const rows = await prisma.sysUser.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      user_code: true,
      email: true,
      name: true,
      initials: true,
      status: true,
      created_at: true,
      updated_at: true,
      created_by: true,
      updated_by: true,
      roles: { select: { role: { select: { role_label: true, role_name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    user_code: r.user_code,
    email: r.email,
    name: r.name,
    initials: r.initials,
    status: r.status,
    role_labels: r.roles.map((x) => x.role.role_label),
    role_names: r.roles.map((x) => x.role.role_name),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    created_by: r.created_by,
    updated_by: r.updated_by,
  }));
}

export async function getUser(actor: Actor, id: number): Promise<UserRow | null> {
  assert(actor, "USER_VIEW");
  const all = await listUsers(actor);
  return all.find((u) => u.id === id) ?? null;
}

export type RoleRow = {
  id: number;
  role_code: string;
  role_label: string;
  role_name: string;
  note: string | null;
  status: string;
  is_system: boolean;
  permission_codes: string[];
  user_count: number;
  created_at: string;
  updated_at: string;
};

export async function listRoles(actor: Actor): Promise<RoleRow[]> {
  assert(actor, "ROLE_VIEW");
  return readRoles();
}

/** Role identity without the permission matrix — used by the user form. */
export async function assignableRoles(
  actor: Actor
): Promise<{ id: number; label: string; name: string; status: string }[]> {
  assert(actor, "USER_ROLE_ASSIGN");
  const rows = await prisma.sysRole.findMany({ orderBy: { id: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    label: r.role_label,
    name: r.role_name,
    status: r.status,
  }));
}

async function readRoles(): Promise<RoleRow[]> {
  const rows = await prisma.sysRole.findMany({
    orderBy: { id: "asc" },
    include: {
      permissions: { select: { permission: { select: { permission_code: true } } } },
      _count: { select: { users: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    role_code: r.role_code,
    role_label: r.role_label,
    role_name: r.role_name,
    note: r.note,
    status: r.status,
    is_system: r.is_system,
    permission_codes: r.permissions.map((p) => p.permission.permission_code),
    user_count: r._count.users,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  }));
}

export async function getRole(actor: Actor, id: number): Promise<RoleRow | null> {
  assert(actor, "ROLE_VIEW");
  const all = await readRoles();
  return all.find((r) => r.id === id) ?? null;
}

// ---------------------------------------------------------------- user writes

export type UserInput = {
  email: string;
  name: string;
  initials: string;
  password?: string;
  status?: string;
  roleIds?: number[];
};

async function validateUser(
  input: UserInput,
  currentId: number | null
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};

  const email = normalizeEmail(input.email ?? "");
  if (!email) errors.email = "Email wajib diisi.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Format email tidak valid.";
  } else {
    const clash = await prisma.sysUser.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        ...(currentId ? { id: { not: currentId } } : {}),
      },
      select: { id: true },
    });
    if (clash) errors.email = `Email "${email}" sudah dipakai user lain.`;
  }

  if (!input.name?.trim()) errors.name = "Nama wajib diisi.";
  if (!input.initials?.trim()) errors.initials = "Inisial wajib diisi.";
  else if (input.initials.trim().length > 3) {
    errors.initials = "Inisial maksimal 3 karakter.";
  }

  if (input.status && input.status !== "Active" && input.status !== "Inactive") {
    errors.status = "Status tidak dikenal.";
  }

  return errors;
}

function normalizeRoleIds(roleIds: number[] | undefined): number[] {
  return Array.from(new Set((roleIds ?? []).filter((n) => Number.isInteger(n) && n > 0)));
}

export async function createUser(
  actor: Actor,
  input: UserInput
): Promise<AdminResult> {
  assert(actor, "USER_CREATE");

  const roleIds = normalizeRoleIds(input.roleIds);
  // Creating a user WITH roles is granting access, so it needs the granting
  // permission as well — otherwise USER_CREATE alone would be an escalation
  // route via a second account.
  if (roleIds.length) assert(actor, "USER_ROLE_ASSIGN");

  const errors = await validateUser(input, null);
  const passwordIssue = passwordProblem(input.password ?? "");
  if (passwordIssue) errors.password = passwordIssue;
  if (Object.keys(errors).length) return { ok: false, errors };

  const known = await prisma.sysRole.findMany({
    where: { id: { in: roleIds } },
    select: { id: true },
  });
  if (known.length !== roleIds.length) return deny("roleIds", "Role tidak dikenal.");

  const created = await prisma.sysUser.create({
    data: {
      user_code: await nextUserCode(),
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      initials: input.initials.trim().toUpperCase(),
      password_hash: await hashPassword(input.password!),
      status: input.status === "Inactive" ? "Inactive" : "Active",
      created_by: actor.user.id,
      roles: {
        create: roleIds.map((role_id) => ({ role_id, created_by: actor.user.id })),
      },
    },
    select: { id: true, user_code: true },
  });

  await audit("sys_user", created.id, "TAMBAH", actor.user.id);
  return { ok: true, id: created.id };
}

/**
 * Identity only. Roles go through `setUserRoles` and status through
 * `setUserStatus`, so USER_EDIT can be granted to someone who manages people
 * without also handing them the ability to change access.
 */
export async function updateUser(
  actor: Actor,
  id: number,
  input: UserInput
): Promise<AdminResult> {
  assert(actor, "USER_EDIT");

  const existing = await prisma.sysUser.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return deny("_form", "User tidak ditemukan.");

  const errors = await validateUser(input, id);
  if (Object.keys(errors).length) return { ok: false, errors };

  await prisma.sysUser.update({
    where: { id },
    data: {
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      initials: input.initials.trim().toUpperCase(),
      updated_by: actor.user.id,
    },
  });

  await audit("sys_user", id, "UPDATE", actor.user.id);
  return { ok: true, id };
}

export async function setUserRoles(
  actor: Actor,
  id: number,
  roleIds: number[]
): Promise<AdminResult> {
  assert(actor, "USER_ROLE_ASSIGN");

  // Protection 1: nobody changes their own access, whatever they hold.
  if (id === actor.user.id) return deny("_form", SELF_ROLE_MESSAGE);

  const target = await prisma.sysUser.findUnique({ where: { id }, select: { id: true } });
  if (!target) return deny("_form", "User tidak ditemukan.");

  const wanted = normalizeRoleIds(roleIds);
  const known = await prisma.sysRole.findMany({
    where: { id: { in: wanted } },
    select: { id: true },
  });
  if (known.length !== wanted.length) return deny("roleIds", "Role tidak dikenal.");

  // Protection 2: the application must keep an active administrator.
  if (!(await administrationSurvives({ userRoles: { userId: id, roleIds: wanted } }))) {
    return deny("_form", LAST_ADMIN_MESSAGE);
  }

  const current = await prisma.sysUserRole.findMany({
    where: { user_id: id },
    select: { role_id: true },
  });
  const currentIds = new Set(current.map((c) => c.role_id));
  const add = wanted.filter((r) => !currentIds.has(r));
  const remove = [...currentIds].filter((r) => !wanted.includes(r));

  if (!add.length && !remove.length) return { ok: true, id };

  await prisma.$transaction([
    prisma.sysUserRole.deleteMany({ where: { user_id: id, role_id: { in: remove } } }),
    prisma.sysUserRole.createMany({
      data: add.map((role_id) => ({ user_id: id, role_id, created_by: actor.user.id })),
    }),
    prisma.sysUser.update({ where: { id }, data: { updated_by: actor.user.id } }),
  ]);

  await audit("sys_user", id, "UPDATE", actor.user.id);
  return { ok: true, id };
}

export async function setUserStatus(
  actor: Actor,
  id: number,
  status: "Active" | "Inactive"
): Promise<AdminResult> {
  assert(actor, status === "Active" ? "USER_ACTIVATE" : "USER_DEACTIVATE");

  if (id === actor.user.id && status === "Inactive") {
    return deny("_form", SELF_STATUS_MESSAGE);
  }

  const target = await prisma.sysUser.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!target) return deny("_form", "User tidak ditemukan.");
  if (target.status === status) return { ok: true, id, status };

  if (
    status === "Inactive" &&
    !(await administrationSurvives({ userStatus: { userId: id, status } }))
  ) {
    return deny("_form", LAST_ADMIN_MESSAGE);
  }

  await prisma.sysUser.update({
    where: { id },
    data: { status, updated_by: actor.user.id },
  });

  // A deactivated account loses its live sessions immediately; it must not keep
  // browsing until its cookie happens to expire.
  if (status === "Inactive") await revokeSessionsForUser(id);

  await audit("sys_user", id, "UPDATE", actor.user.id);
  return { ok: true, id, status };
}

export async function resetUserPassword(
  actor: Actor,
  id: number,
  password: string
): Promise<AdminResult> {
  assert(actor, "USER_PASSWORD_RESET");

  // Own password goes through the profile, which asks for the current one.
  if (id === actor.user.id) return deny("_form", SELF_RESET_MESSAGE);

  const target = await prisma.sysUser.findUnique({ where: { id }, select: { id: true } });
  if (!target) return deny("_form", "User tidak ditemukan.");

  const issue = passwordProblem(password ?? "");
  if (issue) return deny("password", issue);

  await prisma.sysUser.update({
    where: { id },
    data: { password_hash: await hashPassword(password), updated_by: actor.user.id },
  });
  await revokeSessionsForUser(id);

  await audit("sys_user", id, "UPDATE", actor.user.id);
  return { ok: true, id };
}

// ---------------------------------------------------------------- role writes

export type RoleInput = {
  role_label: string;
  role_name: string;
  note?: string | null;
};

async function validateRole(
  input: RoleInput,
  currentId: number | null
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};

  const label = (input.role_label ?? "").trim();
  if (!label) errors.role_label = "Label wajib diisi.";
  else if (!/^[A-Z][A-Z0-9_]*$/.test(label)) {
    errors.role_label =
      "Label hanya boleh huruf kapital, angka, dan garis bawah — dipakai sebagai kunci di kode.";
  } else {
    const clash = await prisma.sysRole.findFirst({
      where: {
        role_label: { equals: label, mode: "insensitive" },
        ...(currentId ? { id: { not: currentId } } : {}),
      },
      select: { id: true },
    });
    if (clash) errors.role_label = `Label "${label}" sudah dipakai role lain.`;
  }

  if (!input.role_name?.trim()) errors.role_name = "Nama Role wajib diisi.";
  return errors;
}

export async function createRole(actor: Actor, input: RoleInput): Promise<AdminResult> {
  assert(actor, "ROLE_CREATE");

  const errors = await validateRole(input, null);
  if (Object.keys(errors).length) return { ok: false, errors };

  const created = await prisma.sysRole.create({
    data: {
      role_code: await nextRoleCode(),
      role_label: input.role_label.trim(),
      role_name: input.role_name.trim(),
      note: input.note?.trim() || null,
      is_system: false,
      created_by: actor.user.id,
    },
    select: { id: true },
  });

  await audit("sys_role", created.id, "TAMBAH", actor.user.id);
  return { ok: true, id: created.id };
}

export async function updateRole(
  actor: Actor,
  id: number,
  input: RoleInput
): Promise<AdminResult> {
  assert(actor, "ROLE_EDIT");

  const existing = await prisma.sysRole.findUnique({ where: { id } });
  if (!existing) return deny("_form", "Role tidak ditemukan.");

  // A system role's label is a key application code reads; only its display
  // name and note are editable.
  if (existing.is_system && input.role_label.trim() !== existing.role_label) {
    return deny("role_label", ROLE_SYSTEM_MESSAGE);
  }

  const errors = await validateRole(input, id);
  if (Object.keys(errors).length) return { ok: false, errors };

  await prisma.sysRole.update({
    where: { id },
    data: {
      role_label: input.role_label.trim(),
      role_name: input.role_name.trim(),
      note: input.note?.trim() || null,
      updated_by: actor.user.id,
    },
  });

  await audit("sys_role", id, "UPDATE", actor.user.id);
  return { ok: true, id };
}

export async function setRoleStatus(
  actor: Actor,
  id: number,
  status: "Active" | "Inactive"
): Promise<AdminResult> {
  assert(actor, status === "Active" ? "ROLE_ACTIVATE" : "ROLE_DEACTIVATE");

  const role = await prisma.sysRole.findUnique({ where: { id } });
  if (!role) return deny("_form", "Role tidak ditemukan.");
  if (role.is_system && status === "Inactive") {
    return deny("_form", ROLE_SYSTEM_MESSAGE);
  }
  if (role.status === status) return { ok: true, id, status };

  await prisma.sysRole.update({
    where: { id },
    data: { status, updated_by: actor.user.id },
  });

  await audit("sys_role", id, "UPDATE", actor.user.id);
  return { ok: true, id, status };
}

/**
 * Replaces a role's permission set.
 *
 * Protection 3: ADMIN is frozen, so nobody can strip the administration
 * permissions out from under themselves by editing the role instead of the
 * account. Every other role still goes through the last-administrator check,
 * which covers custom roles built to administer.
 */
export async function setRolePermissions(
  actor: Actor,
  id: number,
  codes: string[]
): Promise<AdminResult> {
  assert(actor, "ROLE_PERMISSION_MANAGE");

  const role = await prisma.sysRole.findUnique({ where: { id } });
  if (!role) return deny("_form", "Role tidak ditemukan.");
  if (isFrozenRoleLabel(role.role_label)) return deny("_form", ROLE_FROZEN_MESSAGE);

  // An unknown code is a tampered payload, not a typo: refuse the whole change
  // rather than silently applying the subset that happened to be valid.
  if (codes.some((c) => !isPermissionCode(c))) {
    return deny("_form", "Permission tidak dikenal.");
  }
  const wanted: string[] = Array.from(new Set(codes));

  // A user must never end up granting themselves access by editing a role they
  // hold. Refusing the whole change keeps the rule easy to reason about.
  const actorHoldsRole = actor.roles.some((r) => r.id === id);
  if (actorHoldsRole) {
    return deny(
      "_form",
      "Anda tidak dapat mengubah permission role yang Anda pakai sendiri. " +
        "Minta administrator lain melakukannya."
    );
  }

  if (!(await administrationSurvives({ rolePermissions: { roleId: id, codes: wanted } }))) {
    return deny("_form", LAST_ADMIN_MESSAGE);
  }

  const current = await prisma.sysRolePermission.findMany({
    where: { role_id: id },
    select: { permission: { select: { id: true, permission_code: true } } },
  });
  const currentCodes = new Set(current.map((c) => c.permission.permission_code));

  const addCodes = wanted.filter((c) => !currentCodes.has(c));
  const removeIds = current
    .filter((c) => !wanted.includes(c.permission.permission_code))
    .map((c) => c.permission.id);

  if (!addCodes.length && !removeIds.length) return { ok: true, id };

  const addRows = await prisma.sysPermission.findMany({
    where: { permission_code: { in: addCodes } },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.sysRolePermission.deleteMany({
      where: { role_id: id, permission_id: { in: removeIds } },
    }),
    prisma.sysRolePermission.createMany({
      data: addRows.map((p) => ({
        role_id: id,
        permission_id: p.id,
        created_by: actor.user.id,
      })),
    }),
    prisma.sysRole.update({ where: { id }, data: { updated_by: actor.user.id } }),
  ]);

  await audit("sys_role", id, "UPDATE", actor.user.id);
  return { ok: true, id };
}

// ---------------------------------------------------------------- helpers

/** The permission codes a user effectively holds — shown on the profile page. */
export async function effectivePermissions(userId: number): Promise<string[]> {
  const set = await permissionsForUser(userId);
  return PERMISSION_CODES.filter((c) => set.has(c));
}

export { isSystemRoleLabel };
