import "server-only";

import { prisma } from "@/lib/prisma";

/** Resolves user ids to emails for the audit/summary panels. */
export async function userEmails(
  ids: (number | null | undefined)[]
): Promise<Record<number, string>> {
  const wanted = Array.from(
    new Set(ids.filter((id): id is number => typeof id === "number"))
  );
  if (!wanted.length) return {};

  const users = await prisma.sysUser.findMany({
    where: { id: { in: wanted } },
    select: { id: true, email: true },
  });

  return Object.fromEntries(users.map((u) => [u.id, u.email]));
}

/**
 * User ids to a readable identity, for the audit panel.
 *
 * Name where there is one, email otherwise — an audit entry naming a person
 * should read as a person, not as a login.
 */
export async function userLabels(
  ids: number[]
): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const users = await prisma.sysUser.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.name || u.email]));
}

/** Role ids to `LABEL – Name`, for the audit panel. */
export async function roleLabels(
  ids: number[]
): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const roles = await prisma.sysRole.findMany({
    where: { id: { in: ids } },
    select: { id: true, role_label: true, role_name: true },
  });
  return new Map(
    roles.map((r) => [r.id, `${r.role_label} – ${r.role_name}`])
  );
}
