/**
 * The two-company structure is foundational: exactly one parent (induk) and one
 * child (anak), permanently. Company therefore has no write path at all — the
 * master stays readable so its identity is visible, but adding or editing a
 * Company happens through seed data, never through the application.
 *
 * Deliberately plain application logic: no configuration table expresses the
 * restriction, and no generic per-entity permission framework wraps it. The
 * guards below are imported by the Server Actions (the enforcement point) and
 * by the client components (which present the lock).
 */

export const COMPANY_SLUG = "company";
export const COMPANY_ENTITY_KEY = "sys_company";

/** True for both the route slug and the registry/table key. */
export function isCompanyEntity(slugOrKey: string): boolean {
  return slugOrKey === COMPANY_SLUG || slugOrKey === COMPANY_ENTITY_KEY;
}

export const COMPANY_LOCK_BADGE = "Terkunci";

export const COMPANY_LOCK_HEADING = "Struktur Company terkunci";

export const COMPANY_LOCK_BODY =
  "Sistem berdiri di atas dua Company tetap: satu induk dan satu anak. " +
  "Company tidak dapat ditambah maupun diubah dari aplikasi. Perubahan nama, " +
  "label, atau catatan Company dilakukan melalui seed data.";

export const COMPANY_CREATE_BLOCKED =
  "Company tidak dapat ditambah. Struktur dua Company — satu induk dan satu anak — bersifat tetap.";

export const COMPANY_UPDATE_BLOCKED =
  "Company tidak dapat diubah dari aplikasi. Perubahan identitas Company dilakukan melalui seed data.";
