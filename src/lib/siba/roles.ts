/**
 * The two foundational role levels, plus the grants each seeded role carries.
 *
 * Roles are identified in code by `role_label`, which is immutable on system
 * roles. ADMIN's permission set is frozen — it always holds the whole catalogue
 * — so the application can never be left without a way to administer users.
 * STAFF, and any role an administrator creates, are freely editable.
 *
 * **There are no default permissions.** ADMIN is the single exception, and only
 * because something has to be able to administer the system. Every other role
 * starts empty, and nothing anywhere infers access from a role's name: a user's
 * permissions are exactly the rows an administrator put in their roles.
 */
import { PERMISSION_CODES, type PermissionCode } from "./permissions";

export const ADMIN_ROLE = "ADMIN";
export const STAFF_ROLE = "STAFF";

export type SeededRole = {
  label: string;
  name: string;
  note: string;
  /** `null` means "the whole catalogue", kept in sync by the seed. */
  permissions: PermissionCode[] | null;
};

export const SEEDED_ROLES: SeededRole[] = [
  {
    label: ADMIN_ROLE,
    name: "Administrator",
    note:
      "Mengelola user dan hak akses. Permission role ini terkunci dan selalu " +
      "mencakup seluruh katalog permission.",
    permissions: null,
  },
  {
    label: STAFF_ROLE,
    name: "Staff",
    note:
      "Wadah akses untuk pengguna biasa. Role ini dibuat kosong: tidak ada " +
      "permission yang melekat pada nama Role. Administrator menambahkan " +
      "permission yang memang dibutuhkan.",
    // Deliberately empty. There are no default permissions anywhere in this
    // system: holding STAFF — or any other role — grants nothing until an
    // administrator puts a permission in it. A user with only this role can
    // sign in and reach their own profile, and nothing else.
    permissions: [],
  },
];

/** ADMIN's frozen grant: every code in the catalogue. */
export function adminPermissionCodes(): PermissionCode[] {
  return [...PERMISSION_CODES];
}

export function isSystemRoleLabel(label: string): boolean {
  return label === ADMIN_ROLE || label === STAFF_ROLE;
}

/** ADMIN's permission matrix is not editable — see the note above. */
export function isFrozenRoleLabel(label: string): boolean {
  return label === ADMIN_ROLE;
}

export const ROLE_FROZEN_MESSAGE =
  "Permission role Administrator terkunci. Role ini selalu mencakup seluruh " +
  "permission agar sistem tidak pernah kehilangan jalur administrasi.";

export const ROLE_SYSTEM_MESSAGE =
  "Role bawaan sistem tidak dapat dinonaktifkan atau diganti labelnya.";
