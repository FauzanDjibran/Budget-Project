/**
 * The two foundational role levels, plus the grants each seeded role carries.
 *
 * Roles are identified in code by `role_label`, which is immutable on system
 * roles. ADMIN's permission set is frozen — it always holds the whole catalogue
 * — so the application can never be left without a way to administer users.
 * STAFF, and any role an administrator creates, are freely editable.
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
      "Akses dasar. Tambahkan permission sesuai kebutuhan — staff tidak " +
      "menerima akses apa pun secara otomatis.",
    // Read-only starter set. Staff receive nothing beyond this until an
    // administrator grants it.
    permissions: [
      "MENU_DASHBOARD_ACCESS",
      "MENU_MASTER_ACCESS",
      "COMPANY_VIEW",
      "PARTNER_VIEW",
      "CASH_BANK_VIEW",
      "CURRENCY_VIEW",
      // The Pengaturan menu itself grants nothing: for a user without
      // MENU_USER_ACCESS or MENU_ROLE_ACCESS it contains only their own
      // profile, which every signed-in user may reach anyway.
      "MENU_SETTINGS_ACCESS",
    ],
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
