"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/siba/auth";
import { COMPANY_COOKIE, companyOptions } from "@/lib/siba/company-context";

/**
 * Switches the Company the user is working in.
 *
 * Needs a session and nothing more: the context decides what a page *shows*,
 * never what a user may see or do. Every list still runs behind its own view
 * permission, and every write re-checks the Company on the record itself — so
 * this cannot be used to reach another Company's data or to write into it.
 *
 * The id is resolved against the Company master before it is stored, so a
 * crafted value cannot put a Company id that does not exist into the cookie.
 */
export async function setCompanyContext(
  companyId: number
): Promise<{ ok: boolean }> {
  await requireAuth();

  const options = await companyOptions();
  if (!options.some((c) => c.id === companyId)) return { ok: false };

  (await cookies()).set(COMPANY_COOKIE, String(companyId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // A working context, not a credential: it outlives a session on purpose,
    // so signing back in resumes where the user left off.
    maxAge: 60 * 60 * 24 * 365,
  });

  // Every scoped page reads this, so the whole tree is stale once it changes.
  revalidatePath("/", "layout");
  return { ok: true };
}
