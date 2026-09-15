import "server-only";

import { prisma } from "@/lib/prisma";
import type { PermissionCode } from "./permissions";

/**
 * Which Companies a user may see the records of.
 *
 * Access to a Company is a **permission**, not a preference: a user holds
 * `COMPANY_INDUK_ACCESS`, `COMPANY_ANAK_ACCESS`, both, or neither, and the
 * grant is made on the role permission matrix alongside every other
 * capability. There is no second path to it — roles remain the only way to
 * hold a permission (CLAUDE.md §12).
 *
 * The two permissions resolve against `is_parent` at runtime rather than
 * against a Company's label, because a Company's identity is editable through
 * the seed while the structure — one induk, one anak — is foundational and is
 * not.
 *
 * **This narrows reads and nothing else.** Every page still runs behind its own
 * view permission, and every Server Action re-checks the Company on the record
 * it is handed. A user who reaches a record of a Company they cannot access is
 * refused there too, not merely shown less.
 */

export const INDUK_PERMISSION: PermissionCode = "COMPANY_INDUK_ACCESS";
export const ANAK_PERMISSION: PermissionCode = "COMPANY_ANAK_ACCESS";

export type Company = { id: number; label: string; name: string; isParent: boolean };

/** Every Company, induk first. */
export async function allCompanies(): Promise<Company[]> {
  const rows = await prisma.sysCompany.findMany({
    orderBy: [{ is_parent: "desc" }, { id: "asc" }],
    select: { id: true, company_label: true, company_name: true, is_parent: true },
  });
  return rows.map((c) => ({
    id: c.id,
    label: c.company_label,
    name: c.company_name,
    isParent: c.is_parent,
  }));
}

/** The Companies these permissions open, induk first. Empty when neither. */
export async function accessibleCompanies(
  permissions: Set<string>
): Promise<Company[]> {
  const companies = await allCompanies();
  return companies.filter((c) =>
    permissions.has(c.isParent ? INDUK_PERMISSION : ANAK_PERMISSION)
  );
}

/** Their ids, for a list that shows every Company a user may see at once. */
export async function accessibleCompanyIds(
  permissions: Set<string>
): Promise<number[]> {
  return (await accessibleCompanies(permissions)).map((c) => c.id);
}

export type CompanyScope = {
  /** Every Company the user may choose between on this page. */
  options: Company[];
  /** The one being shown, or null when the user may see none. */
  selected: Company | null;
};

/**
 * The Company a scoped page renders, for a page that offers a picker.
 *
 * `requested` is the page's own `?company=` parameter. A value naming a
 * Company the user may not access — stale link, edited URL, a permission
 * revoked since — falls back to the first one they can, rather than showing
 * another Company's records or an error. Nothing is leaked either way: the
 * fallback is always inside what the permissions already allow.
 */
export async function companyScope(
  permissions: Set<string>,
  requested?: string | number | null
): Promise<CompanyScope> {
  const options = await accessibleCompanies(permissions);
  if (!options.length) return { options, selected: null };

  const id = Number(requested);
  const asked = Number.isFinite(id) ? options.find((c) => c.id === id) : undefined;
  return { options, selected: asked ?? options[0] };
}
