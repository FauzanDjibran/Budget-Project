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
