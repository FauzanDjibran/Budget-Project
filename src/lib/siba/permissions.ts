/**
 * The permission catalogue — the single place every capability in the system is
 * declared.
 *
 * A permission is ONE atomic capability. Roles bundle permissions; users hold
 * roles. There is no other path to a permission, so authorization always has
 * exactly one source of truth (see CLAUDE.md §12, "RBAC is role-based only").
 *
 * Codes are stable identifiers used by business logic. Names are Indonesian UI
 * copy and may change freely — never branch on a name.
 *
 * This module is deliberately free of `server-only` and of any database import:
 * client components reference the same codes the server enforces, so the UI can
 * never drift onto a permission the server does not know about.
 *
 * Menu access and actions are separate permissions on purpose. Seeing a module
 * is not permission to create, edit, approve, reject or post inside it.
 */

export type PermissionModule =
  | "dashboard"
  | "master"
  | "accounting"
  | "budget"
  | "finance"
  | "settings";

export type PermissionDef = {
  code: string;
  /** Indonesian label shown in the role matrix. */
  name: string;
  module: PermissionModule;
  description?: string;
};

/**
 * Entries are grouped by module and, within a module, menu access first. Adding
 * a module means adding its rows here — nothing else in the catalogue changes.
 */
export const PERMISSIONS = [
  // ---------------------------------------------------------------- dashboard
  { code: "MENU_DASHBOARD_ACCESS", name: "Akses menu Dashboard", module: "dashboard" },

  // ---------------------------------------------------------------- master
  { code: "MENU_MASTER_ACCESS", name: "Akses menu Master", module: "master" },

  { code: "COMPANY_VIEW", name: "Lihat Company", module: "master", description: "Company terkunci: tidak ada permission tambah atau ubah." },

  { code: "PARTNER_VIEW", name: "Lihat Partner", module: "master" },
  { code: "PARTNER_CREATE", name: "Tambah Partner", module: "master" },
  { code: "PARTNER_EDIT", name: "Ubah Partner", module: "master" },
  { code: "PARTNER_ACTIVATE", name: "Aktifkan Partner", module: "master" },
  { code: "PARTNER_DEACTIVATE", name: "Nonaktifkan Partner", module: "master" },

  { code: "CASH_BANK_VIEW", name: "Lihat Cash & Bank", module: "master" },
  { code: "CASH_BANK_CREATE", name: "Tambah Cash & Bank", module: "master" },
  { code: "CASH_BANK_EDIT", name: "Ubah Cash & Bank", module: "master" },
  { code: "CASH_BANK_ACTIVATE", name: "Aktifkan Cash & Bank", module: "master" },
  { code: "CASH_BANK_DEACTIVATE", name: "Nonaktifkan Cash & Bank", module: "master" },

  { code: "CURRENCY_VIEW", name: "Lihat Currency", module: "master" },
  { code: "CURRENCY_CREATE", name: "Tambah Currency", module: "master" },
  { code: "CURRENCY_EDIT", name: "Ubah Currency", module: "master" },
  { code: "CURRENCY_ACTIVATE", name: "Aktifkan Currency", module: "master" },
  { code: "CURRENCY_DEACTIVATE", name: "Nonaktifkan Currency", module: "master" },

  // ---------------------------------------------------------------- accounting
  { code: "MENU_ACCOUNTING_ACCESS", name: "Akses menu Accounting", module: "accounting" },

  { code: "ACCOUNT_VIEW", name: "Lihat Account", module: "accounting" },
  { code: "ACCOUNT_CREATE", name: "Tambah Account", module: "accounting" },
  { code: "ACCOUNT_EDIT", name: "Ubah Account", module: "accounting" },
  { code: "ACCOUNT_ACTIVATE", name: "Aktifkan Account", module: "accounting" },
  { code: "ACCOUNT_DEACTIVATE", name: "Nonaktifkan Account", module: "accounting" },

  { code: "MAPPING_VIEW", name: "Lihat Mapping Budget ke Account", module: "accounting" },
  { code: "MAPPING_CREATE", name: "Tambah Mapping", module: "accounting" },
  { code: "MAPPING_EDIT", name: "Ubah Mapping", module: "accounting" },

  { code: "FISCAL_YEAR_VIEW", name: "Lihat Fiscal Year", module: "accounting" },
  { code: "FISCAL_YEAR_CREATE", name: "Tambah Fiscal Year", module: "accounting" },
  { code: "FISCAL_YEAR_EDIT", name: "Ubah Fiscal Year", module: "accounting" },

  { code: "FISCAL_PERIOD_VIEW", name: "Lihat Fiscal Period", module: "accounting" },
  { code: "FISCAL_PERIOD_CREATE", name: "Tambah Fiscal Period", module: "accounting" },
  { code: "FISCAL_PERIOD_EDIT", name: "Ubah Fiscal Period", module: "accounting" },

  // ---------------------------------------------------------------- budget
  { code: "MENU_BUDGET_ACCESS", name: "Akses menu Budget", module: "budget" },

  { code: "BUDGET_VIEW", name: "Lihat Budget", module: "budget" },
  { code: "BUDGET_CREATE", name: "Tambah Budget", module: "budget" },
  { code: "BUDGET_EDIT", name: "Ubah Budget", module: "budget" },
  { code: "BUDGET_SUBMIT", name: "Ajukan Budget", module: "budget" },
  { code: "BUDGET_APPROVE", name: "Setujui Budget", module: "budget" },
  { code: "BUDGET_REJECT", name: "Tolak Budget", module: "budget" },
  { code: "BUDGET_CANCEL", name: "Batalkan Budget", module: "budget" },

  // ---------------------------------------------------------------- finance
  { code: "MENU_FINANCE_ACCESS", name: "Akses menu Finance", module: "finance" },

  { code: "CASH_BANK_TRANSACTION_VIEW", name: "Lihat Cash Bank Transaction", module: "finance" },
  { code: "CASH_BANK_TRANSACTION_CREATE", name: "Tambah Cash Bank Transaction", module: "finance" },
  { code: "CASH_BANK_TRANSACTION_EDIT", name: "Ubah Cash Bank Transaction", module: "finance" },
  { code: "CASH_BANK_TRANSACTION_POST", name: "Post Cash Bank Transaction", module: "finance" },
  { code: "CASH_BANK_TRANSACTION_CANCEL", name: "Batalkan Cash Bank Transaction", module: "finance" },

  // ---------------------------------------------------------------- settings
  { code: "MENU_SETTINGS_ACCESS", name: "Akses menu Pengaturan", module: "settings" },
  { code: "MENU_USER_ACCESS", name: "Akses menu User", module: "settings" },
  { code: "MENU_ROLE_ACCESS", name: "Akses menu Role", module: "settings" },

  { code: "USER_VIEW", name: "Lihat User", module: "settings" },
  { code: "USER_CREATE", name: "Tambah User", module: "settings" },
  { code: "USER_EDIT", name: "Ubah User", module: "settings" },
  { code: "USER_ACTIVATE", name: "Aktifkan User", module: "settings" },
  { code: "USER_DEACTIVATE", name: "Nonaktifkan User", module: "settings" },
  { code: "USER_PASSWORD_RESET", name: "Reset password User", module: "settings" },
  {
    code: "USER_ROLE_ASSIGN",
    name: "Atur Role User",
    module: "settings",
    description:
      "Permission yang menentukan akses user lain. Hanya diberikan kepada administrator.",
  },

  { code: "ROLE_VIEW", name: "Lihat Role", module: "settings" },
  { code: "ROLE_CREATE", name: "Tambah Role", module: "settings" },
  { code: "ROLE_EDIT", name: "Ubah Role", module: "settings" },
  { code: "ROLE_ACTIVATE", name: "Aktifkan Role", module: "settings" },
  { code: "ROLE_DEACTIVATE", name: "Nonaktifkan Role", module: "settings" },
  {
    code: "ROLE_PERMISSION_MANAGE",
    name: "Atur Permission Role",
    module: "settings",
    description:
      "Permission yang menentukan isi sebuah Role. Hanya diberikan kepada administrator.",
  },
] as const satisfies readonly PermissionDef[];

export type PermissionCode = (typeof PERMISSIONS)[number]["code"];

export const PERMISSION_CODES: PermissionCode[] = PERMISSIONS.map((p) => p.code);

const BY_CODE = new Map<string, PermissionDef>(PERMISSIONS.map((p) => [p.code, p]));

export function permissionByCode(code: string): PermissionDef | undefined {
  return BY_CODE.get(code);
}

export function isPermissionCode(code: string): code is PermissionCode {
  return BY_CODE.has(code);
}

export const MODULE_LABELS: Record<PermissionModule, string> = {
  dashboard: "Dashboard",
  master: "Master",
  accounting: "Accounting",
  budget: "Budget",
  finance: "Finance",
  settings: "Pengaturan",
};

/** Catalogue order, grouped by module — drives the role permission matrix. */
export const MODULE_ORDER: PermissionModule[] = [
  "dashboard",
  "master",
  "accounting",
  "budget",
  "finance",
  "settings",
];

export function permissionsByModule(): Record<PermissionModule, PermissionDef[]> {
  const out = {} as Record<PermissionModule, PermissionDef[]>;
  for (const m of MODULE_ORDER) out[m] = [];
  for (const p of PERMISSIONS) out[p.module].push(p);
  return out;
}

/**
 * Permissions that let a user change who can do what. Granting any of these is
 * granting administration, so the guards in `user-admin.ts` treat them as the
 * privilege boundary: a user can never hand one to themselves.
 */
export const PRIVILEGE_PERMISSIONS: PermissionCode[] = [
  "USER_ROLE_ASSIGN",
  "ROLE_PERMISSION_MANAGE",
];

/**
 * What it takes to administer the application: reach the settings menu, reach
 * user management, read the register, create an account, and grant it a role.
 *
 * This is an ALL-OF set. `user-admin.ts` refuses any change that would leave no
 * active user holding every entry, so a user holding one or two of these — a
 * staff member who can see the settings menu to reach their own profile, say —
 * is not an administrator and is not counted as one.
 */
export const ADMIN_CRITICAL_PERMISSIONS: PermissionCode[] = [
  "MENU_SETTINGS_ACCESS",
  "MENU_USER_ACCESS",
  "USER_VIEW",
  "USER_CREATE",
  "USER_ROLE_ASSIGN",
];
