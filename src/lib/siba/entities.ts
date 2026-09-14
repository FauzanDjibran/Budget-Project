/**
 * Entity registry for the Master module, ported from the mockup's ENTITIES map.
 *
 * One config drives the list table, the detail view, and the create/edit form,
 * exactly as it did in the prototype. Adding an entity means adding a config
 * here, not writing another page.
 */
import type { IconName } from "@/components/icon";

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
   * Named server-side narrowing for a ref field. Implemented in
   * `options.ts` — kept as a name so the config stays serialisable.
   */
  refFilter?: "cashBankAccount";
  defaultValue?: string | boolean;
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
  truncate?: boolean;
  /** Value comes from the server-computed map rather than the row. */
  computed?: boolean;
  filter?: "text" | "ref" | "enum" | "bool";
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
  nameField: string;
  /** Column used to filter by the topbar company context. */
  scope?: string;
  /** Which column carries active/inactive, if any. */
  statusField?: "status";
  fields: Field[];
  columns: Column[];
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
    statusField: "status",
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
    statusField: "status",
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
    statusField: "status",
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
};

export const TAG_CLASS: Record<string, string> = {
  Bank: "t-info",
  Cash: "t-vio",
  Debit: "t-info",
  Kredit: "t-acc",
};
