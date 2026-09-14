/**
 * Entity registry for the registry-driven modules, ported from the mockup's
 * ENTITIES map.
 *
 * One config drives the list table, the detail view, and the create/edit form,
 * exactly as it did in the prototype. Adding an entity means adding a config
 * here, not writing another page. Master and Accounting both run on it; the
 * only bespoke registry entity is Chart of Accounts, whose *list* renders as a
 * tree (`view: "tree"`) while its detail and form stay generic.
 */
import type { IconName } from "@/components/icon";
import { BUDGET_CATEGORY_RULES } from "./rules";

export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "ref"
  | "bool"
  | "date"
  | "number";

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Enforced case-insensitively across the table. */
  unique?: boolean;
  /**
   * Narrows `unique` to rows sharing this column's value — an account number is
   * unique within a Company, not globally.
   */
  uniqueWithin?: string;
  /** Short human identifier — renders as a chip when read-only, mono when editing. */
  ident?: boolean;
  /** Immutable once the record exists. */
  locked?: boolean;
  placeholder?: string;
  help?: string;
  /** `select` options. */
  options?: string[];
  optionLabels?: Record<string, string>;
  /** `ref` target entity key. */
  ref?: string;
  /**
   * Named narrowing for a ref field. The server applies the structural half
   * (postable, subcategory, active) when it builds the options; the form
   * applies the half that depends on values the user is still choosing, such
   * as the Company. Kept as a name so the config stays serialisable.
   */
  refFilter?:
    | "cashBankAccount"
    | "postableAccount"
    | "parentAccount"
    | "mappingPartnerCategory";
  /**
   * Named predicate deciding whether the field applies at all. A field that
   * does not apply is hidden and stored as null — the Server Action evaluates
   * the same predicate, so hiding it is never what enforces the rule.
   */
  visibleWhen?: "accountRequiresPartner" | "budgetCategoryRequiresPartner";
  defaultValue?: string | boolean | number;
  /** `bool` caption and sub-caption. */
  caption?: string;
  captionDetail?: string;
  full?: boolean;
  /** Clearing this field clears these too (dependent refs). */
  resets?: string[];
};

export type Column = {
  field: string;
  label: string;
  width?: string;
  /** `.pri` — bolder, primary column. */
  primary?: boolean;
  muted?: boolean;
  numeric?: boolean;
  /** Render as a `.lab` code chip. */
  isLabel?: boolean;
  isRef?: boolean;
  /** Show only the ref's short label, not label + name. */
  refLabelOnly?: boolean;
  isStatus?: boolean;
  isTag?: boolean;
  isBool?: boolean;
  isDate?: boolean;
  truncate?: boolean;
  /** Value comes from the server-computed map rather than the row. */
  computed?: boolean;
  filter?: "text" | "ref" | "enum" | "bool";
};

/**
 * How a record carries active/inactive — or, for fiscal records, a lifecycle
 * that is not a toggle at all.
 *
 * `toggle` is what decides whether activate/deactivate exist as operations.
 * Fiscal Year and Fiscal Period move Draft -> Open -> Closed through an edit,
 * so they declare a status for filtering and display but no toggle.
 */
export type StatusModel = {
  field: string;
  /** `enum` stores the value as text; `bool` stores true/false. */
  kind: "enum" | "bool";
  /** Values offered in the list's status filter, in order. */
  options: string[];
  toggle: boolean;
};

export type Entity = {
  key: string;
  slug: string;
  module: string;
  name: string;
  single?: string;
  icon: IconName;
  desc: string;
  codeField: string;
  codePrefix: string;
  labelField?: string;
  nameField?: string;
  /**
   * Records with no identity of their own — a mapping is named by what it
   * connects. Titles are composed from these ref fields' labels.
   */
  titleRefs?: string[];
  /** Column used to filter by the topbar company context. */
  scope?: string;
  /** How the list page renders. */
  view?: "table" | "tree";
  statusModel?: StatusModel;
  fields: Field[];
  columns: Column[];
};

const ACTIVE_STATUS: StatusModel = {
  field: "status",
  kind: "enum",
  options: ["Active", "Inactive"],
  toggle: true,
};

const FISCAL_STATUS: StatusModel = {
  field: "status",
  kind: "enum",
  options: ["Draft", "Open", "Closed"],
  toggle: false,
};

const STATUS_FIELD: Field = {
  name: "status",
  label: "Status",
  type: "select",
  required: true,
  options: ["Active", "Inactive"],
  optionLabels: { Active: "Aktif", Inactive: "Non Aktif" },
  defaultValue: "Active",
  help: "Data Inactive tidak muncul sebagai pilihan pada transaksi baru.",
};

const FISCAL_STATUS_FIELD: Field = {
  name: "status",
  label: "Status",
  type: "select",
  required: true,
  options: ["Draft", "Open", "Closed"],
  defaultValue: "Draft",
  help: "Draft belum dipakai · Open menerima posting · Closed terkunci.",
};

const NOTE_FIELD: Field = {
  name: "note",
  label: "Catatan",
  type: "textarea",
  full: true,
  placeholder: "Keterangan tambahan (opsional)…",
};

const identHelp =
  "Identitas ringkas yang dipakai di seluruh dropdown dan laporan.";

export const ENTITIES: Entity[] = [
  {
    key: "sys_company",
    slug: "company",
    module: "master",
    name: "Company",
    icon: "build",
    desc: "Entity dan ownership context. Seluruh Budget, Finance, book, dan Journal berdiri di atas Company.",
    codeField: "company_code",
    codePrefix: "comp",
    labelField: "company_label",
    nameField: "company_name",
    fields: [
      {
        name: "company_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "Holding",
        help: identHelp,
      },
      {
        name: "company_name",
        label: "Nama Company",
        type: "text",
        required: true,
        placeholder: "Holding Company",
        help: "Nama lengkap entitas.",
      },
      {
        name: "is_parent",
        label: "Company Induk",
        type: "bool",
        defaultValue: false,
        caption: "Company ini adalah induk",
        captionDetail:
          "Hanya boleh satu Company induk. Company lain otomatis dianggap anak dari induk tersebut.",
      },
      NOTE_FIELD,
    ],
    columns: [
      { field: "company_label", label: "Label", isLabel: true, width: "128px", filter: "text" },
      { field: "company_name", label: "Nama Company", primary: true, filter: "text" },
      { field: "rel", label: "Posisi", computed: true, width: "168px" },
      { field: "partner_count", label: "Partner", computed: true, numeric: true, width: "92px" },
      { field: "cash_bank_count", label: "Cash & Bank", computed: true, numeric: true, width: "112px" },
      { field: "account_count", label: "Account", computed: true, numeric: true, width: "96px" },
    ],
  },

  {
    key: "m_partner",
    slug: "partner",
    module: "master",
    name: "Partner",
    icon: "users",
    desc: "Business subject milik sebuah Company, menjadi subjek utama Hutang, Piutang, Titipan, dan Prive Ledger.",
    codeField: "partner_code",
    codePrefix: "part",
    labelField: "partner_label",
    nameField: "partner_name",
    scope: "company_id",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "partner_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "CAB-JKT",
        help: identHelp,
      },
      {
        name: "partner_name",
        label: "Nama Partner",
        type: "text",
        required: true,
        placeholder: "Cabang Jakarta",
        help: "Nama lengkap entitas.",
      },
      {
        name: "company_id",
        label: "Company",
        type: "ref",
        ref: "sys_company",
        required: true,
        locked: true,
        help: "Partner dimiliki satu Company dan tidak dapat dipindah, karena history ledger terikat pada Company.",
      },
      {
        name: "category_id",
        label: "Partner Category",
        type: "ref",
        ref: "sys_partner_category",
        required: true,
        help: "Menentukan Budget Category mana yang boleh memakai Partner ini.",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "partner_label", label: "Label", isLabel: true, width: "140px", filter: "text" },
      { field: "partner_name", label: "Nama Partner", primary: true, filter: "text" },
      { field: "company_id", label: "Company", isRef: true, width: "214px", filter: "ref" },
      { field: "category_id", label: "Partner Category", isRef: true, width: "190px", filter: "ref" },
      { field: "status", label: "Status", isStatus: true, width: "120px", filter: "enum" },
    ],
  },

  {
    key: "m_cash_bank",
    slug: "cash-bank",
    module: "master",
    name: "Cash & Bank",
    icon: "wallet",
    desc: "Resource tempat uang berada. Setiap Cash Bank memiliki Cash Bank Book sendiri.",
    codeField: "cash_bank_code",
    codePrefix: "cbnk",
    labelField: "cash_bank_label",
    nameField: "cash_bank_name",
    scope: "company_id",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "cash_bank_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "Mandiri IDR",
        help: identHelp,
      },
      {
        name: "cash_bank_name",
        label: "Nama Cash Bank",
        type: "text",
        required: true,
        placeholder: "Bank Mandiri Rupiah",
        help: "Nama lengkap entitas.",
      },
      {
        name: "company_id",
        label: "Company",
        type: "ref",
        ref: "sys_company",
        required: true,
        locked: true,
        resets: ["account_id"],
        help: "Pemilik resource. Pilihan Account mengikuti Company ini.",
      },
      {
        name: "cash_bank_type",
        label: "Tipe",
        type: "select",
        required: true,
        options: ["Cash", "Bank"],
        defaultValue: "Bank",
      },
      {
        name: "currency_id",
        label: "Currency",
        type: "ref",
        ref: "ref_currency",
        required: true,
        help: "Currency dari resource, bukan currency transaksi.",
      },
      {
        name: "account_id",
        label: "Account",
        type: "ref",
        ref: "acc_account",
        required: true,
        refFilter: "cashBankAccount",
        help: "Hanya account postable pada kelompok Kas atau Bank milik Company yang sama.",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "cash_bank_label", label: "Label", isLabel: true, width: "118px", filter: "text" },
      { field: "cash_bank_name", label: "Nama Cash Bank", primary: true, filter: "text" },
      { field: "company_id", label: "Company", isRef: true, width: "158px", filter: "ref" },
      { field: "cash_bank_type", label: "Tipe", isTag: true, width: "92px", filter: "enum" },
      { field: "currency_id", label: "Currency", isRef: true, width: "126px", filter: "ref" },
      { field: "account_id", label: "Account", isRef: true, width: "152px", filter: "ref" },
      { field: "status", label: "Status", isStatus: true, width: "112px", filter: "enum" },
    ],
  },

  {
    key: "ref_currency",
    slug: "currency",
    module: "master",
    name: "Currency",
    icon: "coin",
    desc: "Referensi mata uang. Base currency pelaporan adalah IDR; transaction currency dan base currency tetap dipisah.",
    codeField: "currency_code",
    codePrefix: "curr",
    labelField: "currency_label",
    nameField: "currency_name",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "currency_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "EUR",
        help: "Kode ISO mata uang, dipakai di seluruh dropdown dan laporan.",
      },
      {
        name: "currency_name",
        label: "Nama Currency",
        type: "text",
        required: true,
        placeholder: "Euro",
        help: "Nama lengkap entitas.",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "currency_label", label: "Label", isLabel: true, width: "118px", filter: "text" },
      { field: "currency_name", label: "Nama Currency", primary: true, filter: "text" },
      { field: "cash_bank_count", label: "Cash & Bank", computed: true, numeric: true, width: "112px" },
      { field: "status", label: "Status", isStatus: true, width: "120px", filter: "enum" },
      { field: "note", label: "Catatan", muted: true, truncate: true },
    ],
  },

  // ------------------------------------------------- accounting · chart of accounts

  {
    key: "acc_account",
    slug: "account",
    module: "accounting",
    name: "Chart of Accounts",
    single: "Account",
    icon: "book",
    desc: "Account accounting per Company. Account adalah subjek utama General Ledger.",
    codeField: "account_code",
    codePrefix: "coa",
    labelField: "account_label",
    nameField: "account_name",
    scope: "company_id",
    view: "tree",
    statusModel: { field: "is_active", kind: "bool", options: ["true", "false"], toggle: true },
    fields: [
      {
        name: "account_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        uniqueWithin: "company_id",
        ident: true,
        placeholder: "1401",
        help: "Nomor account. Unik dalam satu Company.",
      },
      {
        name: "account_name",
        label: "Nama Account",
        type: "text",
        required: true,
        placeholder: "Persediaan",
        help: "Nama lengkap entitas.",
      },
      {
        name: "company_id",
        label: "Company",
        type: "ref",
        ref: "sys_company",
        required: true,
        locked: true,
        resets: ["parent_account"],
        help: "Account adalah master per Company. Nomor yang sama pada Company berbeda adalah record berbeda.",
      },
      {
        name: "account_subcategory_id",
        label: "Kelompok Account",
        type: "ref",
        ref: "acc_account_subcategory",
        required: true,
        help: "Menentukan posisi account pada struktur bagan akun.",
      },
      {
        name: "normal_balance",
        label: "Normal Balance",
        type: "select",
        required: true,
        options: ["Debit", "Kredit"],
        defaultValue: "Debit",
      },
      {
        name: "parent_account",
        label: "Parent Account",
        type: "ref",
        ref: "acc_account",
        refFilter: "parentAccount",
        help: "Opsional. Mengaitkan account ini sebagai turunan dari account lain dalam Company yang sama.",
      },
      {
        name: "is_postable",
        label: "Postable",
        type: "bool",
        defaultValue: true,
        caption: "Account dapat menerima Journal Line",
        captionDetail:
          "Matikan untuk account header yang hanya menampung turunan.",
      },
      {
        name: "require_partner",
        label: "Require Partner",
        type: "bool",
        defaultValue: false,
        resets: ["partner_category_id"],
        caption: "Journal Line wajib mengisi Partner",
        captionDetail:
          "Aktifkan untuk account subledger: Titipan, Hutang, Piutang, Prive, Investasi.",
      },
      {
        name: "partner_category_id",
        label: "Partner Category",
        type: "ref",
        ref: "sys_partner_category",
        required: true,
        visibleWhen: "accountRequiresPartner",
        help: "Satu Account hanya menampung satu Partner Category, sehingga subledger tidak tercampur antar kategori subjek.",
      },
      {
        name: "is_control_account",
        label: "Control Account",
        type: "bool",
        defaultValue: false,
        caption: "Direkonsiliasi dengan operational book",
        captionDetail:
          "Saldo GL dibandingkan dengan Hutang/Piutang/Titipan/Prive Ledger.",
      },
      {
        name: "is_active",
        label: "Aktif",
        type: "bool",
        defaultValue: true,
        caption: "Account aktif",
        captionDetail: "Account non-aktif tidak muncul pada pemilihan baru.",
      },
      NOTE_FIELD,
    ],
    columns: [
      { field: "account_label", label: "Account", isLabel: true, width: "116px", filter: "text" },
      { field: "account_name", label: "Nama Account", primary: true, filter: "text" },
      { field: "company_id", label: "Company", isRef: true, width: "190px", filter: "ref" },
      { field: "account_subcategory_id", label: "Kelompok", isRef: true, width: "196px", filter: "ref" },
      { field: "normal_balance", label: "Normal", isTag: true, width: "96px", filter: "enum" },
      { field: "partner_category_id", label: "Partner Cat.", isRef: true, refLabelOnly: true, width: "116px", filter: "ref" },
      { field: "is_active", label: "Status", isBool: true, width: "100px", filter: "bool" },
    ],
  },

  // ------------------------------------------------------- accounting · mapping

  {
    key: "acc_budget_category_account",
    slug: "budget-category-account",
    module: "accounting",
    name: "Mapping Budget ke Account",
    single: "Mapping",
    icon: "link",
    desc: "Menghubungkan Budget Category, Company, dan Account tujuan — jembatan antara klasifikasi planning dan account accounting.",
    codeField: "bca_code",
    codePrefix: "bcam",
    titleRefs: ["budget_category_id", "partner_category_id", "account_id"],
    scope: "company_id",
    fields: [
      {
        name: "company_id",
        label: "Company",
        type: "ref",
        ref: "sys_company",
        required: true,
        locked: true,
        resets: ["account_id"],
        help: "Mapping berlaku per Company karena bagan akun berbeda per Company.",
      },
      {
        name: "budget_category_id",
        label: "Budget Category",
        type: "ref",
        ref: "sys_budget_category",
        required: true,
        resets: ["partner_category_id", "account_id"],
        help: "Menentukan Partner Category mana saja yang boleh dipasangkan pada baris ini.",
      },
      {
        name: "partner_category_id",
        label: "Partner Category",
        type: "ref",
        ref: "sys_partner_category",
        required: true,
        refFilter: "mappingPartnerCategory",
        visibleWhen: "budgetCategoryRequiresPartner",
        resets: ["account_id"],
        help: "Satu kombinasi Budget Category × Partner Category menuju tepat satu Account.",
      },
      {
        name: "account_id",
        label: "Account",
        type: "ref",
        ref: "acc_account",
        required: true,
        full: true,
        refFilter: "postableAccount",
        help: "Hanya account postable milik Company yang sama.",
      },
    ],
    columns: [
      { field: "company_id", label: "Company", isRef: true, refLabelOnly: true, width: "104px", filter: "ref" },
      { field: "budget_category_id", label: "Budget Category", isRef: true, refLabelOnly: true, width: "150px", filter: "ref" },
      { field: "partner_category_id", label: "Partner Category", isRef: true, refLabelOnly: true, width: "150px", filter: "ref" },
      { field: "account_id", label: "Account Tujuan", isRef: true, primary: true, filter: "ref" },
      { field: "normal_balance", label: "Normal", computed: true, width: "96px" },
    ],
  },

  // ------------------------------------------------ accounting · period control

  {
    key: "acc_fiscal_year",
    slug: "fiscal-year",
    module: "accounting",
    name: "Fiscal Year",
    icon: "cal",
    desc: "Tahun buku, menjadi payung Fiscal Period dan Opening Balance.",
    codeField: "year_code",
    codePrefix: "fyr",
    labelField: "year_label",
    nameField: "year_name",
    statusModel: FISCAL_STATUS,
    fields: [
      {
        name: "year_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "2028",
        help: identHelp,
      },
      {
        name: "year_name",
        label: "Nama Tahun Buku",
        type: "text",
        required: true,
        placeholder: "Tahun Buku 2028",
        help: "Nama lengkap entitas.",
      },
      { name: "start_date", label: "Tanggal Mulai", type: "date", required: true },
      { name: "end_date", label: "Tanggal Selesai", type: "date", required: true },
      FISCAL_STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "year_label", label: "Label", isLabel: true, width: "118px", filter: "text" },
      { field: "year_name", label: "Nama Tahun Buku", primary: true, filter: "text" },
      { field: "start_date", label: "Mulai", isDate: true, width: "132px" },
      { field: "end_date", label: "Selesai", isDate: true, width: "132px" },
      { field: "period_count", label: "Period", computed: true, numeric: true, width: "94px" },
      { field: "status", label: "Status", isStatus: true, width: "118px", filter: "enum" },
    ],
  },

  {
    key: "acc_fiscal_period",
    slug: "fiscal-period",
    module: "accounting",
    name: "Fiscal Period",
    icon: "clock",
    desc: "Period control untuk Budget Month dan posting accounting.",
    codeField: "period_code",
    codePrefix: "fprd",
    labelField: "period_label",
    nameField: "period_name",
    statusModel: FISCAL_STATUS,
    fields: [
      {
        name: "period_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        placeholder: "2027-01",
        help: identHelp,
      },
      {
        name: "period_name",
        label: "Nama Period",
        type: "text",
        required: true,
        placeholder: "Januari 2027",
        help: "Nama lengkap entitas.",
      },
      {
        name: "fiscal_year_id",
        label: "Fiscal Year",
        type: "ref",
        ref: "acc_fiscal_year",
        required: true,
        locked: true,
        help: "Period tidak dapat dipindah ke tahun buku lain setelah dibuat.",
      },
      {
        name: "sequence_no",
        label: "Urutan",
        type: "number",
        required: true,
        defaultValue: 1,
        help: "Urutan periode dalam satu tahun buku.",
      },
      { name: "start_date", label: "Tanggal Mulai", type: "date", required: true },
      { name: "end_date", label: "Tanggal Selesai", type: "date", required: true },
      FISCAL_STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "period_label", label: "Label", isLabel: true, width: "126px", filter: "text" },
      { field: "period_name", label: "Nama Period", primary: true, filter: "text" },
      { field: "fiscal_year_id", label: "Fiscal Year", isRef: true, width: "214px", filter: "ref" },
      { field: "sequence_no", label: "Urutan", numeric: true, width: "86px" },
      { field: "start_date", label: "Mulai", isDate: true, width: "132px" },
      { field: "end_date", label: "Selesai", isDate: true, width: "132px" },
      { field: "status", label: "Status", isStatus: true, width: "118px", filter: "enum" },
    ],
  },
];

export function entityBySlug(slug: string): Entity | undefined {
  return ENTITIES.find((e) => e.slug === slug);
}

export function entityByKey(key: string): Entity | undefined {
  return ENTITIES.find((e) => e.key === key);
}

/** Label shown on the create button. */
export function createLabel(entity: Entity): string {
  return `Tambah ${entity.single ?? entity.name}`;
}

/** Whether a field applies, given the values currently entered. */
export function fieldApplies(
  field: Field,
  values: Record<string, unknown>,
  categoryLabelOf?: (id: unknown) => string | undefined
): boolean {
  if (!field.visibleWhen) return true;
  if (field.visibleWhen === "accountRequiresPartner") {
    const v = values.require_partner;
    return v === true || v === "true";
  }
  // budgetCategoryRequiresPartner
  const label = categoryLabelOf?.(values.budget_category_id);
  return label ? budgetCategoryNeedsPartner(label) : false;
}

/**
 * Whether a Budget Category is classified per Partner Category.
 * `BUDGET_CATEGORY_RULES` in `rules.ts` is the source of truth.
 */
export function budgetCategoryNeedsPartner(categoryLabel: string): boolean {
  return (BUDGET_CATEGORY_RULES[categoryLabel]?.partnerCategories.length ?? 0) > 0;
}

export function allowedPartnerCategories(categoryLabel: string): string[] {
  return BUDGET_CATEGORY_RULES[categoryLabel]?.partnerCategories ?? [];
}

export const STATUS_TEXT: Record<string, string> = {
  Active: "Aktif",
  Inactive: "Non Aktif",
  Open: "Open",
  Draft: "Draft",
  Closed: "Closed",
  Posted: "Posted",
  Submitted: "Diajukan",
  Rejected: "Ditolak",
  Cancelled: "Dibatalkan",
  true: "Aktif",
  false: "Non Aktif",
};

export const STATUS_CLASS: Record<string, string> = {
  Active: "s-ok",
  Open: "s-ok",
  Posted: "s-ok",
  Inactive: "s-bad",
  Draft: "s-warn",
  Closed: "s-mute",
  Submitted: "s-info",
  Rejected: "s-bad",
  Cancelled: "s-mute",
  true: "s-ok",
  false: "s-bad",
};

export const TAG_CLASS: Record<string, string> = {
  Bank: "t-info",
  Cash: "t-vio",
  Debit: "t-info",
  Kredit: "t-acc",
};

/** The value a status model treats as "active". */
export function isActiveStatus(model: StatusModel, raw: unknown): boolean {
  return model.kind === "bool" ? raw === true : raw === "Active";
}
