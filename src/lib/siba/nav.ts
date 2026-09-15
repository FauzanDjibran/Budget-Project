/**
 * Navigation model: modules, the groups inside them, and the entities inside
 * those. Each registry entity declares its own module and group, so this file
 * describes the shape of the menu and nothing about the entities themselves.
 */
import type { IconName } from "@/components/icon";
import type { PermissionCode } from "./permissions";

export type NavEntity = {
  key: string;
  /** URL segment under the module. */
  slug: string;
  name: string;
  /** Singular form, when it differs from `name`. */
  single?: string;
  icon: IconName;
  desc: string;
  /**
   * Permission required to see this leaf. Omitted only where the destination is
   * open to every signed-in user — the profile, which is about who you are
   * rather than what you may do.
   */
  permission?: PermissionCode;
};

export type NavGroup = {
  key: string;
  name: string;
  entities: NavEntity[];
};

export type NavModule = {
  key: string;
  name: string;
  icon: IconName;
  desc: string;
  /** Menu access is its own permission, separate from any action inside. */
  permission?: PermissionCode;
  /** A module with no groups is a single page (the dashboard). */
  groups?: NavGroup[];
};

export const MODULES: NavModule[] = [
  {
    key: "dashboard",
    name: "Dashboard",
    icon: "grid",
    desc: "Ringkasan data master dan hal yang perlu ditindaklanjuti.",
    permission: "MENU_DASHBOARD_ACCESS",
  },
  {
    key: "master",
    name: "Master",
    icon: "book",
    desc: "Sumber referensi untuk seluruh modul.",
    permission: "MENU_MASTER_ACCESS",
    groups: [
      {
        key: "entity",
        name: "Entitas",
        entities: [
          {
            key: "sys_company",
            slug: "company",
            name: "Company",
            icon: "build",
            desc: "Entity dan ownership context. Seluruh Budget, Finance, book, dan Journal berdiri di atas Company.",
            permission: "COMPANY_VIEW",
          },
          {
            key: "m_partner",
            slug: "partner",
            name: "Partner",
            icon: "users",
            desc: "Business subject milik sebuah Company, menjadi subjek utama Hutang, Piutang, Titipan, dan Prive Ledger.",
            permission: "PARTNER_VIEW",
          },
          {
            key: "m_cash_bank",
            slug: "cash-bank",
            name: "Cash & Bank",
            icon: "wallet",
            desc: "Resource tempat uang berada. Setiap Cash Bank memiliki Cash Bank Book sendiri.",
            permission: "CASH_BANK_VIEW",
          },
        ],
      },
      {
        key: "reference",
        name: "Referensi",
        entities: [
          {
            key: "ref_currency",
            slug: "currency",
            name: "Currency",
            icon: "coin",
            desc: "Referensi mata uang. Base currency pelaporan adalah IDR; transaction currency dan base currency tetap dipisah.",
            permission: "CURRENCY_VIEW",
          },
        ],
      },
    ],
  },
  {
    key: "budget",
    name: "Budget",
    icon: "clip",
    desc: "Perencanaan kebutuhan dana per periode.",
    permission: "MENU_BUDGET_ACCESS",
    groups: [
      {
        key: "plan",
        name: "Perencanaan",
        entities: [
          {
            key: "bud_budget_month",
            slug: "budget",
            name: "Budget",
            single: "Budget Month",
            icon: "clip",
            desc: "Perencanaan kebutuhan dana. Pilih bulan untuk membuka daftar Budget di dalamnya.",
            permission: "BUDGET_VIEW",
          },
        ],
      },
    ],
  },
  {
    key: "finance",
    name: "Finance",
    icon: "wallet2",
    desc: "Eksekusi aktual atas Budget yang sudah disetujui.",
    permission: "MENU_FINANCE_ACCESS",
    groups: [
      {
        key: "exec",
        name: "Eksekusi",
        entities: [
          {
            key: "fin_cash_bank_transaction",
            slug: "cash-bank-transaction",
            name: "Cash Bank Transaction",
            icon: "wallet2",
            desc: "Layer eksekusi. Satu dokumen kas/bank dapat merealisasikan beberapa Budget yang sudah disetujui.",
            permission: "CASH_BANK_TRANSACTION_VIEW",
          },
        ],
      },
    ],
  },
  {
    key: "accounting",
    name: "Accounting",
    icon: "calc",
    desc: "Bagan akun, mapping, dan kendali periode.",
    permission: "MENU_ACCOUNTING_ACCESS",
    groups: [
      {
        key: "coa",
        name: "Chart of Accounts",
        entities: [
          {
            key: "acc_account",
            slug: "account",
            name: "Chart of Accounts",
            single: "Account",
            icon: "book",
            desc: "Account accounting per Company. Account adalah subjek utama General Ledger.",
            permission: "ACCOUNT_VIEW",
          },
        ],
      },
      {
        key: "mapping",
        name: "Mapping",
        entities: [
          {
            key: "acc_budget_category_account",
            slug: "budget-category-account",
            name: "Mapping Budget ke Account",
            single: "Mapping",
            icon: "link",
            desc: "Menghubungkan Budget Category, Company, dan Account tujuan — jembatan antara klasifikasi planning dan account accounting.",
            permission: "MAPPING_VIEW",
          },
        ],
      },
      {
        key: "fiscal",
        name: "Period Control",
        entities: [
          {
            key: "acc_fiscal_year",
            slug: "fiscal-year",
            name: "Fiscal Year",
            icon: "cal",
            desc: "Tahun buku, menjadi payung Fiscal Period dan Opening Balance.",
            permission: "FISCAL_YEAR_VIEW",
          },
          {
            key: "acc_fiscal_period",
            slug: "fiscal-period",
            name: "Fiscal Period",
            icon: "clock",
            desc: "Period control untuk Budget Month dan posting accounting.",
            permission: "FISCAL_PERIOD_VIEW",
          },
        ],
      },
    ],
  },
  {
    key: "settings",
    name: "Pengaturan",
    icon: "gear",
    desc: "Pengguna, hak akses, dan akun Anda sendiri.",
    permission: "MENU_SETTINGS_ACCESS",
    groups: [
      {
        key: "access",
        name: "Kontrol Akses",
        entities: [
          {
            key: "sys_user",
            slug: "user",
            name: "User",
            icon: "user",
            desc: "Akun yang dapat masuk ke aplikasi. Akses setiap user ditentukan oleh Role yang diberikan kepadanya.",
            permission: "MENU_USER_ACCESS",
          },
          {
            key: "sys_role",
            slug: "role",
            name: "Role",
            icon: "tags",
            desc: "Kumpulan permission. Role adalah satu-satunya jalur pemberian akses kepada user.",
            permission: "MENU_ROLE_ACCESS",
          },
        ],
      },
      {
        key: "account",
        name: "Akun Saya",
        entities: [
          {
            key: "profile",
            slug: "profile",
            name: "Profil Saya",
            icon: "user",
            desc: "Data akun Anda sendiri dan ringkasan akses yang Anda miliki.",
          },
        ],
      },
    ],
  },
];

export function moduleByKey(key: string): NavModule | undefined {
  return MODULES.find((m) => m.key === key);
}

/**
 * The navigation a given set of permissions can see.
 *
 * Menu visibility mirrors authorization but never substitutes for it: every
 * page and every Server Action behind these links checks for itself. A module
 * whose leaves are all hidden disappears rather than leading to a refusal.
 */
export function visibleModules(permissions: Iterable<string>): NavModule[] {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  const allowed = (code?: string) => !code || held.has(code);

  const out: NavModule[] = [];
  for (const mod of MODULES) {
    if (!allowed(mod.permission)) continue;
    if (!mod.groups) {
      out.push(mod);
      continue;
    }
    const groups = mod.groups
      .map((g) => ({ ...g, entities: g.entities.filter((e) => allowed(e.permission)) }))
      .filter((g) => g.entities.length > 0);
    if (groups.length) out.push({ ...mod, groups });
  }
  return out;
}

/** Where a signed-in user should land, given what they can see. */
export function landingHref(permissions: Iterable<string>): string {
  const visible = visibleModules(permissions);
  const first = visible[0];
  if (!first) return "/settings/profile";
  if (!first.groups) return `/${first.key}`;
  const leaf = first.groups[0]?.entities[0];
  return leaf ? entityHref(first.key, leaf.slug) : `/${first.key}`;
}

export function entityHref(moduleKey: string, slug: string): string {
  return `/${moduleKey}/${slug}`;
}

/** Finds the module/group/entity that owns a pathname like `/master/partner`. */
export function resolvePath(pathname: string) {
  const [, moduleKey, slug] = pathname.split("/");
  const mod = moduleByKey(moduleKey ?? "");
  if (!mod) return { module: undefined, group: undefined, entity: undefined };
  for (const group of mod.groups ?? []) {
    const entity = group.entities.find((e) => e.slug === slug);
    if (entity) return { module: mod, group, entity };
  }
  return { module: mod, group: undefined, entity: undefined };
}
