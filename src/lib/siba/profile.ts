import "server-only";

import { prisma } from "@/lib/prisma";
import type { Actor } from "./access";
import { passwordProblem, setPassword, verifyPassword } from "./login";
import { permissionByCode, type PermissionDef } from "./permissions";

/**
 * "My Profile" — the one area every authenticated user reaches, whatever
 * permissions they hold.
 *
 * Own-profile access is deliberately NOT a permission. It is inherent to having
 * a session, for two reasons: an administrator can never accidentally lock
 * everyone out of their own account details, and ownership ("is this me?") is a
 * different question from capability ("may I do this?"). Everything a profile
 * can change is identity and credentials — never access.
 */

export type ProfileView = {
  id: number;
  user_code: string;
  email: string;
  name: string;
  initials: string;
  status: string;
  created_at: string;
  roles: { label: string; name: string }[];
  /** Read-only summary. Changing access from here is impossible by design. */
  permissions: PermissionDef[];
};

export async function profileFor(actor: Actor): Promise<ProfileView> {
  const user = await prisma.sysUser.findUniqueOrThrow({
    where: { id: actor.user.id },
    select: {
      id: true,
      user_code: true,
      email: true,
      name: true,
      initials: true,
      status: true,
      created_at: true,
    },
  });

  return {
    ...user,
    created_at: user.created_at.toISOString(),
    roles: actor.roles.map((r) => ({ label: r.label, name: r.name })),
    permissions: [...actor.permissions]
      .map(permissionByCode)
      .filter((p): p is PermissionDef => Boolean(p))
      .sort((a, b) => a.module.localeCompare(b.module) || a.code.localeCompare(b.code)),
  };
}

export type ProfileResult =
  | { ok: true }
  | { ok: false; errors: Record<string, string> };

/**
 * The editable half of a profile: display name and initials.
 *
 * Email is the login identifier and stays with user administration, so changing
 * who you are cannot be done from inside your own session.
 */
export async function updateOwnProfile(
  actor: Actor,
  input: { name: string; initials: string }
): Promise<ProfileResult> {
  const errors: Record<string, string> = {};
  const name = (input.name ?? "").trim();
  const initials = (input.initials ?? "").trim();

  if (!name) errors.name = "Nama wajib diisi.";
  if (!initials) errors.initials = "Inisial wajib diisi.";
  else if (initials.length > 3) errors.initials = "Inisial maksimal 3 karakter.";
  if (Object.keys(errors).length) return { ok: false, errors };

  await prisma.sysUser.update({
    where: { id: actor.user.id },
    data: { name, initials: initials.toUpperCase(), updated_by: actor.user.id },
  });

  await prisma.auditLog.create({
    data: {
      entity_key: "sys_user",
      row_id: actor.user.id,
      action: "UPDATE",
      by: actor.user.id,
    },
  });

  return { ok: true };
}

/**
 * Changing your own password requires the current one, so a hijacked session
 * cannot lock the real owner out. Succeeding revokes every session the account
 * holds — the caller re-issues one for the browser that made the change.
 */
export async function changeOwnPassword(
  actor: Actor,
  input: { current: string; next: string; confirm: string }
): Promise<ProfileResult> {
  const errors: Record<string, string> = {};

  if (!input.current) errors.current = "Password saat ini wajib diisi.";
  const issue = passwordProblem(input.next ?? "");
  if (issue) errors.next = issue;
  if (input.next !== input.confirm) {
    errors.confirm = "Konfirmasi password tidak sama.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  if (!(await verifyPassword(actor.user.id, input.current))) {
    return { ok: false, errors: { current: "Password saat ini tidak sesuai." } };
  }

  await setPassword(actor.user.id, input.next);

  await prisma.auditLog.create({
    data: {
      entity_key: "sys_user",
      row_id: actor.user.id,
      action: "UPDATE",
      by: actor.user.id,
    },
  });

  return { ok: true };
}
