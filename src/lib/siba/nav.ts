/**
 * Navigation model, ported from the mockup's MODULES array and the module/group
 * metadata on each ENTITIES entry.
 *
 * The mockup routed on `#/module/entity/id/mode`. That maps directly onto
 * `/module/entity/[id]` here, so URLs stay recognisable.
 */
import type { IconName } from "@/components/icon";

export type NavEntity = {
  key: string;
  /** URL segment under the module. */
  slug: string;
  name: string;
  /** Singular form, when it differs from `name`. */
  single?: string;
  icon: IconName;
  desc: string;
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
  /** A module with no groups is a single page (the dashboard). */
  groups?: NavGroup[];
};

export const MODULES: NavModule[] = [
  {
    key: "dashboard",
    name: "Dashboard",
    icon: "grid",
    desc: "Ringkasan data master dan hal yang perlu ditindaklanjuti.",
  },
  {
    key: "master",
    name: "Master",
    icon: "book",
    desc: "Sumber referensi untuk seluruh modul.",
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
          },
          {
            key: "m_partner",
            slug: "partner",
            name: "Partner",
            icon: "users",
            desc: "Business subject milik sebuah Company, menjadi subjek utama Hutang, Piutang, Titipan, dan Prive Ledger.",
          },
          {
            key: "m_cash_bank",
            slug: "cash-bank",
            name: "Cash & Bank",
            icon: "wallet",
            desc: "Resource tempat uang berada. Setiap Cash Bank memiliki Cash Bank Book sendiri.",
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
          },
          {
            key: "acc_fiscal_period",
            slug: "fiscal-period",
            name: "Fiscal Period",
            icon: "clock",
            desc: "Period control untuk Budget Month dan posting accounting.",
          },
        ],
      },
    ],
  },
];

export function moduleByKey(key: string): NavModule | undefined {
  return MODULES.find((m) => m.key === key);
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
