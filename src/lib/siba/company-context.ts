import "server-only";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

/**
 * Which Company the user is currently working in.
 *
 * Every scoped screen reads this: Partner, Cash & Bank, Chart of Accounts, the
 * account mappings, Budget and the Finance documents all belong to one Company,
 * and showing two Companies' worth at once is what made the chart of accounts
 * look like it held every number twice.
 *
 * **A cookie rather than a URL parameter.** Reads happen in Server Components
 * (CLAUDE.md §3), so the context has to reach the server on an ordinary
 * navigation — and it has to survive every link in the rail, the submenu, a
 * breadcrumb and a row click without each of them having to carry it. A search
 * parameter would be dropped by the first link that forgot it. Report Views
 * still put *their* parameters in the URL, because a report run is a thing you
 * send someone; a working context is not.
 *
 * **There is always exactly one.** The two-Company structure is foundational
 * (§12), every scoped record belongs to one of them, and a context meaning
 * "neither" is what produced doubled rows. An unset or unrecognised cookie
 * resolves to the induk.
 *
 * This is a *view* filter and nothing more. It never widens what a user may
 * see — permissions do that — and every Server Action re-checks the Company on
 * the record it is given, so switching context can never smuggle a write into
 * the wrong Company.
 */

export const COMPANY_COOKIE = "siba_company";

export type CompanyOption = { id: number; label: string; name: string };

/** The Companies a context may name, induk first. */
export async function companyOptions(): Promise<CompanyOption[]> {
  const rows = await prisma.sysCompany.findMany({
    orderBy: [{ is_parent: "desc" }, { id: "asc" }],
    select: { id: true, company_label: true, company_name: true },
  });
  return rows.map((c) => ({
    id: c.id,
    label: c.company_label,
    name: c.company_name,
  }));
}

/**
 * The Company in context, resolved against the Company master.
 *
 * A cookie is user-supplied text, so a value naming no Company — stale, edited
 * by hand, or left over from another database — falls back to the induk rather
 * than filtering every list down to nothing.
 */
export async function activeCompany(): Promise<CompanyOption> {
  const options = await companyOptions();
  if (!options.length) {
    throw new Error("No Company is seeded. Run npm run db:seed first.");
  }

  const raw = (await cookies()).get(COMPANY_COOKIE)?.value;
  const id = Number(raw);
  return options.find((c) => c.id === id) ?? options[0];
}

export async function activeCompanyId(): Promise<number> {
  return (await activeCompany()).id;
}

/**
 * The `where` fragment a scoped entity's list needs.
 *
 * Keyed on the entity's own `scope` column so the registry stays the thing
 * that decides which entities are Company-scoped — an entity without one is
 * not filtered at all, which is right for Company itself, Currency, and the
 * reference tables.
 */
export function scopeFilter(
  scope: string | undefined,
  companyId: number
): Record<string, number> {
  return scope ? { [scope]: companyId } : {};
}
