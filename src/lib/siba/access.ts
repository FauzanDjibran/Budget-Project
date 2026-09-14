import "server-only";

import { prisma } from "@/lib/prisma";
import type { SessionUser } from "./session";

/**
 * Resolves what an authenticated user may do.
 *
 * Permissions are read from the database on every request — never from the
 * cookie, never cached across requests — so revoking a role takes effect
 * immediately and a tampered client can gain nothing.
 *
 * Only Active roles contribute. Deactivating a role therefore withdraws it from
 * everyone holding it without touching a single assignment.
 */

export type Actor = {
  user: SessionUser;
  roles: { id: number; label: string; name: string }[];
  /** Every permission code the actor holds, via their active roles. */
  permissions: Set<string>;
};

export async function permissionsForUser(userId: number): Promise<Set<string>> {
  const rows = await prisma.sysUserRole.findMany({
    where: { user_id: userId, role: { status: "Active" } },
    select: {
      role: {
        select: {
          permissions: { select: { permission: { select: { permission_code: true } } } },
        },
      },
    },
  });

  const out = new Set<string>();
  for (const r of rows) {
    for (const rp of r.role.permissions) out.add(rp.permission.permission_code);
  }
  return out;
}

export async function rolesForUser(
  userId: number
): Promise<{ id: number; label: string; name: string }[]> {
  const rows = await prisma.sysUserRole.findMany({
    where: { user_id: userId },
    select: { role: { select: { id: true, role_label: true, role_name: true, status: true } } },
    orderBy: { role_id: "asc" },
  });
  return rows
    .filter((r) => r.role.status === "Active")
    .map((r) => ({ id: r.role.id, label: r.role.role_label, name: r.role.role_name }));
}

export async function actorFor(user: SessionUser): Promise<Actor> {
  const [roles, permissions] = await Promise.all([
    rolesForUser(user.id),
    permissionsForUser(user.id),
  ]);
  return { user, roles, permissions };
}

export function actorCan(actor: Actor | null, code: string): boolean {
  return Boolean(actor?.permissions.has(code));
}

export function actorCanAll(actor: Actor | null, codes: string[]): boolean {
  return codes.every((c) => actorCan(actor, c));
}

export function actorCanAny(actor: Actor | null, codes: string[]): boolean {
  return codes.some((c) => actorCan(actor, c));
}
