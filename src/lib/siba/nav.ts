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
    desc: "Komitmen yang berjalan, posisi kas, dan posisi terhadap pihak lain.",
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
        key: "klasifikasi",
        name: "Klasifikasi",
        entities: [
          {
            key: "sys_budget_category",
            slug: "budget-category",
            name: "Budget Category",
            icon: "tags",
            desc: "Klasifikasi yang diberikan saat Budget disetujui: arah yang berlaku, apakah memakai Partner, dan Partner Category mana yang boleh dipilih.",
            permission: "BUDGET_CATEGORY_VIEW",
          },
          {
            key: "sys_partner_category",
            slug: "partner-category",
            name: "Partner Category",
            icon: "users",
            desc: "Jenis Partner. Menentukan Partner mana yang boleh dipilih untuk sebuah Budget Category.",
            permission: "PARTNER_CATEGORY_VIEW",
          },
          {
            key: "sys_purpose",
            slug: "purpose",
            name: "Transaction Purpose",
            icon: "tags",
            desc: "Arah × Budget Category × Partner Category. Dibuat otomatis dari Klasifikasi, sehingga Budget Category baru langsung dapat ditransaksikan.",
            permission: "PURPOSE_VIEW",
          },
          {
            key: "sys_budget_partner_category_mapping",
            slug: "budget-partner-category",
            name: "Partner Category per Budget Category",
            single: "Klasifikasi",
            icon: "link",
            desc: "Pasangan yang diizinkan: rantai Budget Category ke Partner Category ke Partner.",
            permission: "BUDGET_PARTNER_CATEGORY_VIEW",
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
          {
            key: "fin_cash_bank_transfer",
            slug: "cash-bank-transfer",
            name: "Cash Bank Transfer",
            icon: "link",
            desc: "Pemindahan dana antar Cash & Bank milik Company sendiri: transfer mata uang sama, pencairan valuta asing, dan pembelian valas.",
            permission: "CASH_BANK_TRANSFER_VIEW",
          },
          {
            key: "fin_funding_request",
            slug: "funding-request",
            name: "Funding Request",
            icon: "link",
            desc: "Permintaan dana Company anak yang menunggu konfirmasi induk. Konfirmasi memposting dokumen dan menulis journal kedua Company sekaligus.",
            permission: "FUNDING_REQUEST_VIEW",
          },
        ],
      },
      {
        key: "report",
        name: "Laporan",
        entities: [
          {
            key: "report_cash_bank_ledger",
            slug: "report/cash-bank-ledger",
            name: "Buku Kas & Bank",
            icon: "book",
            desc: "Seluruh mutasi satu resource kas atau bank pada rentang tanggal yang dipilih.",
            permission: "REPORT_CASH_BANK_LEDGER_VIEW",
          },
          {
            key: "report_cash_bank_balance",
            slug: "report/cash-bank-balance",
            name: "Saldo Kas & Bank",
            icon: "wallet",
            desc: "Saldo awal, penerimaan, pengeluaran, dan saldo akhir setiap resource kas dan bank.",
            permission: "REPORT_CASH_BANK_BALANCE_VIEW",
          },
          {
            key: "report_cash_bank_layer",
            slug: "report/cash-bank-layer",
            name: "Posisi Layer Kurs",
            icon: "layers",
            desc: "Layer kurs setiap resource mata uang asing dan sisa pada masing-masing kurs.",
            permission: "REPORT_CASH_BANK_LAYER_VIEW",
          },
          // One entry for every subject book, with the book as a toggle on the
          // report itself. It was six entries generated from a six-entry
          // catalogue; a book is now a Budget Category that names a Partner, so
          // enumerating them here would put a deploy between a new category and
          // its book — which is the thing this arrangement exists to remove.
          {
            key: "report_subledger",
            slug: "report/subledger",
            name: "Buku Subjek",
            icon: "book",
            desc: "Riwayat dan posisi setiap Partner pada Titipan, Hutang, Piutang, Prive, Investasi, dan kategori lain yang memakai Partner.",
            permission: "REPORT_SUBLEDGER_VIEW",
          },
        ],
      },
    ],
  },
  {
    key: "accounting",
    name: "Accounting",
    icon: "calc",
    desc: "Bagan akun, mapping, journal, buku besar, dan kendali periode.",
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
        key: "journal",
        name: "Journal & Buku Besar",
        entities: [
          {
            key: "acc_journal",
            slug: "journal",
            name: "Journal",
            single: "Journal",
            icon: "book",
            desc: "Journal dari posting dokumen, dan Journal Manual untuk entri yang tidak berasal dari dokumen. Final setelah diposting.",
            permission: "JOURNAL_VIEW",
          },
          {
            key: "report_general_ledger",
            slug: "report/general-ledger",
            name: "General Ledger",
            icon: "tree",
            desc: "Mutasi dan saldo setiap account pada rentang tanggal yang dipilih, satu tabel per account.",
            permission: "REPORT_GENERAL_LEDGER_VIEW",
          },
          {
            key: "report_trial_balance",
            slug: "report/trial-balance",
            name: "Trial Balance",
            icon: "calc",
            desc: "Saldo awal, mutasi debit, mutasi kredit, dan saldo akhir seluruh account — dengan uji keseimbangan debit dan kredit.",
            permission: "REPORT_TRIAL_BALANCE_VIEW",
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
            desc: "Tahun buku. Periode bulanan di dalamnya dibuat otomatis saat tahun buku diaktifkan.",
            permission: "FISCAL_YEAR_VIEW",
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
        key: "system",
        name: "Sistem",
        entities: [
          {
            key: "sys_setting",
            slug: "system-default",
            name: "System Default",
            icon: "gear",
            desc: "Nilai bawaan yang dipakai seluruh aplikasi. Default mengisi sebuah pilihan lebih dulu; pengguna tetap dapat menggantinya.",
            permission: "MENU_SYSTEM_DEFAULT_ACCESS",
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

/**
 * Finds the module/group/entity that owns a pathname like `/master/partner`.
 *
 * The slug is matched against the **whole** tail after the module, not just its
 * first segment, because a Report View's slug spans two (`report/cash-bank-ledger`).
 * Deeper paths still resolve to the entity that owns them — `/master/partner/12`
 * and `/budget/budget/month/5` both land on their list entity — and the longest
 * matching slug wins, so an entity whose slug is a prefix of another's can never
 * swallow it.
 */
export function resolvePath(pathname: string) {
  const [, moduleKey, ...rest] = pathname.split("/");
  const mod = moduleByKey(moduleKey ?? "");
  if (!mod) return { module: undefined, group: undefined, entity: undefined };

  const tail = rest.join("/");
  let best: { group: NavGroup; entity: NavEntity } | null = null;

  for (const group of mod.groups ?? []) {
    for (const entity of group.entities) {
      const matches = tail === entity.slug || tail.startsWith(`${entity.slug}/`);
      if (!matches) continue;
      if (!best || entity.slug.length > best.entity.slug.length) {
        best = { group, entity };
      }
    }
  }

  return best
    ? { module: mod, group: best.group, entity: best.entity }
    : { module: mod, group: undefined, entity: undefined };
}
