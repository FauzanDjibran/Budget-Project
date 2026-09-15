/**
 * Entity registry for the registry-driven modules.
 *
 * One config drives the list table, the detail view, and the create/edit form.
 * Adding an entity means adding a config here, not writing another page. Master
 * and Accounting both run on it; the only bespoke registry entity is Chart of
 * Accounts, whose *list* renders as a tree (`view: "tree"`) while its detail and
 * form stay generic.
 */
import type { IconName } from "@/components/icon";
import { BUDGET_CATEGORY_RULES, type Direction } from "./rules";
import type { SystemDefaultKey } from "./system-defaults";

export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "ref"
  | "bool"
  | "date"
  | "number"
  /**
   * One number continuing a code the record inherits. The user types `5`; the
   * Server Action writes `1.1.1.5` into the field named by `writesTo`. See
   * `lib/siba/account-code.ts` — Chart of Accounts is the entity that needs it.
   */
  | "segment";

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
  /**
   * Offered only when creating, and never written to the entity's own table —
   * the Server Action decides what to do with it. A Cash & Bank resource's
   * opening balance is the case: it becomes the first entry in that resource's
   * book, which is where a balance belongs.
   */
  createOnly?: boolean;
  /** Not a column on this table; `buildData` leaves it out entirely. */
  virtual?: boolean;
  /**
   * Written by the Server Action rather than typed: never offered on a form,
   * never `required`-checked, but still shown read-only on the detail view. A
   * Fiscal Year's name and date range are derived from the year it is for.
   */
  derived?: boolean;
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
  /**
   * `segment` only. The ref fields whose chosen row supplies the code this
   * segment continues, in priority order — the first one filled wins. Chart of
   * Accounts inherits from its Parent Account when there is one and from its
   * Kelompok otherwise, which is exactly what makes the number shown on screen
   * the number that gets stored.
   */
  inheritsFrom?: string[];
  /** `segment` only. The field the composed code is written into. */
  writesTo?: string;
  defaultValue?: string | boolean | number;
  /**
   * The System Default this field starts on when creating. A default fills the
   * control in and nothing more: it is not applied on edit, it never overrides
   * a value, and the Server Action validates the result exactly as it would a
   * value the user picked.
   */
  systemDefault?: SystemDefaultKey;
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

/**
 * The years a Fiscal Year may be opened for: a decade around the current one.
 *
 * Creating a fiscal year is choosing a year and nothing else — everything the
 * table needs follows from it — so the field is a list rather than free text,
 * which also rules out a typo producing a "year" nobody can post into.
 */
export const YEAR_OPTIONS: string[] = Array.from({ length: 11 }, (_, i) =>
  String(new Date().getUTCFullYear() - 5 + i)
);

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
        systemDefault: "default_currency",
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
      {
        name: "opening_balance",
        label: "Saldo Awal",
        type: "number",
        createOnly: true,
        virtual: true,
        defaultValue: 0,
        placeholder: "0",
        help: "Saldo resource ini saat mulai dicatat. Disimpan sebagai entri pembuka pada Cash Bank Book, bukan sebagai kolom pada master — saldo berikutnya selalu berasal dari buku.",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "cash_bank_label", label: "Label", isLabel: true, width: "118px", filter: "text" },
      { field: "cash_bank_name", label: "Nama Cash Bank", primary: true, filter: "text" },
      { field: "company_id", label: "Company", isRef: true, width: "158px", filter: "ref" },
      { field: "cash_bank_type", label: "Tipe", isTag: true, width: "92px", filter: "enum" },
      { field: "currency_id", label: "Currency", isRef: true, width: "116px", filter: "ref" },
      { field: "account_id", label: "Account", isRef: true, width: "142px", filter: "ref" },
      { field: "balance", label: "Saldo", computed: true, numeric: true, width: "142px" },
      { field: "status", label: "Status", isStatus: true, width: "104px", filter: "enum" },
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
        locked: true,
        resets: ["parent_account"],
        help: "Menentukan posisi account pada struktur bagan akun, sekaligus awal nomornya.",
      },
      {
        name: "parent_account",
        label: "Parent Account",
        type: "ref",
        ref: "acc_account",
        refFilter: "parentAccount",
        locked: true,
        help: "Opsional. Diisi bila account ini turunan dari account lain pada Kelompok yang sama — nomornya melanjutkan nomor parent.",
      },
      {
        name: "account_segment",
        label: "Nomor Urut",
        type: "segment",
        required: true,
        virtual: true,
        createOnly: true,
        inheritsFrom: ["parent_account", "account_subcategory_id"],
        writesTo: "account_label",
        placeholder: "1",
        help: "Angka 1–999, unik di bawah induk yang sama. Nomor lengkap dibentuk dari induknya dan tidak dapat diubah setelah disimpan.",
      },
      {
        name: "account_label",
        label: "Nomor Account",
        type: "text",
        required: true,
        derived: true,
        locked: true,
        ident: true,
        help: "Dibentuk otomatis dari Kelompok atau Parent Account ditambah Nomor Urut.",
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
        name: "normal_balance",
        label: "Normal Balance",
        type: "select",
        required: true,
        options: ["Debit", "Kredit"],
        defaultValue: "Debit",
      },
      {
        name: "is_postable",
        label: "Postable",
        type: "bool",
        defaultValue: true,
        caption: "Menerima Journal Line",
      },
      {
        name: "require_partner",
        label: "Require Partner",
        type: "bool",
        defaultValue: false,
        resets: ["partner_category_id"],
        caption: "Wajib mengisi Partner",
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
        caption: "Direkonsiliasi dengan book",
      },
      {
        name: "is_active",
        label: "Aktif",
        type: "bool",
        defaultValue: true,
        caption: "Account aktif",
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
    desc: "Tahun buku. Periode bulanan di dalamnya dibuat otomatis saat tahun buku diaktifkan.",
    codeField: "year_code",
    codePrefix: "fyr",
    labelField: "year_label",
    nameField: "year_name",
    statusModel: FISCAL_STATUS,
    fields: [
      {
        name: "year_label",
        label: "Tahun",
        type: "select",
        options: YEAR_OPTIONS,
        required: true,
        unique: true,
        ident: true,
        locked: true,
        help:
          "Cukup pilih tahunnya. Nama, tanggal mulai 01/01, dan tanggal selesai " +
          "31/12 mengikuti otomatis dan tidak dapat diubah terpisah.",
      },
      { name: "year_name", label: "Nama Tahun Buku", type: "text", derived: true },
      { name: "start_date", label: "Tanggal Mulai", type: "date", derived: true },
      { name: "end_date", label: "Tanggal Selesai", type: "date", derived: true },
      {
        // A fiscal year's status is its lifecycle, not an isian: it is created
        // as Draft, activated into Open — which is what generates the twelve
        // periods — and closed by a process of its own. Derived and locked, so
        // neither form nor a submitted value can move it. See
        // `fiscal-workflow.ts` and `app/actions/fiscal.ts`.
        ...FISCAL_STATUS_FIELD,
        derived: true,
        locked: true,
        help:
          "Draft belum dipakai · Open menerima posting dan memiliki 12 Fiscal " +
          "Period · Closed terkunci.",
      },
      NOTE_FIELD,
    ],
    columns: [
      { field: "year_label", label: "Tahun", isLabel: true, width: "108px", filter: "text" },
      { field: "year_name", label: "Nama Tahun Buku", primary: true, filter: "text" },
      { field: "start_date", label: "Mulai", isDate: true, width: "126px" },
      { field: "end_date", label: "Selesai", isDate: true, width: "126px" },
      { field: "period_count", label: "Period", computed: true, numeric: true, width: "94px" },
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

/**
 * Whether a Budget Category makes sense for a budget going this way.
 *
 * Direction follows balance-sheet logic, not cash direction: Biaya and Asset
 * only ever go Out, Hasil Investasi only ever comes In, while the four subject
 * categories move in both directions. `BUDGET_CATEGORY_RULES` is the source.
 */
export function budgetCategoryAllowsDirection(
  categoryLabel: string,
  direction: string
): boolean {
  const rule = BUDGET_CATEGORY_RULES[categoryLabel];
  return rule ? rule.directions.includes(direction as Direction) : false;
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
