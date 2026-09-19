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
import {
  type ClassificationCatalogue,
  budgetCategoryNeedsPartner,
} from "./classification";
import { isBaseCurrency } from "./currency";
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
   * An amount. Rendered by `ui/money-input.tsx` — mono, right-aligned,
   * grouped in thousands as it is typed, with the currency named by
   * `currencyFrom` shown inside the box. Never a native `<input
   * type="number">`: that control is drawn by the operating system and cannot
   * carry a separator, which is how the same figure came to read three
   * different ways on three screens.
   */
  | "money"
  /**
   * An exchange rate. Rendered by `ui/rate-input.tsx`, which is a separate
   * control from `money` on purpose: a rate is not an amount. It carries six
   * decimals where money carries two, it has to accept a decimal separator at
   * all, and it reads as a ratio between two currencies rather than as a
   * quantity of one. Giving it the money control would say it was the same
   * kind of figure — and would silently drop the decimals.
   */
  | "rate"
  /**
   * One number continuing a code the record inherits. The user types `5`; the
   * Server Action writes `1.1.1.5` into the field named by `writesTo`. See
   * `lib/siba/account-code.ts` — Chart of Accounts is the entity that needs it.
   */
  | "segment"
  /**
   * A **set** of references, written to a join table rather than to a column on
   * this row — which Partner Categories a Budget Category admits.
   *
   * The registry could already write a child row (a Cash & Bank resource opens
   * its book in the same transaction it is registered in); this is the same
   * mechanism for a set of them. It exists because the alternative was a second
   * menu: the pairing used to be its own entity, so creating a category and
   * saying what it admits were two records, two forms and two saves — and a
   * category saved between them is inert, which is a state the application now
   * refuses outright.
   *
   * Never deletes. Unticking a reference **deactivates** its row and re-ticking
   * reopens the same one, so a pairing keeps its history and its code.
   */
  | "multiref";

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  /**
   * How much of the twelve-column form row this field takes. Left unset a
   * field takes a third, which is what suits the short values a master record
   * holds; `full` and a textarea take the whole row. Set it only where a field
   * genuinely needs a different share — a long name, or a pair that must sit
   * side by side. See `components/ui/form.tsx`.
   */
  span?: 3 | 4 | 5 | 6 | 8 | 12;
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
   * For a `multiref`: the join entity whose rows carry the set. The Server
   * Action reconciles it inside the same transaction that writes this record.
   */
  joinTable?: string;
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
    /** Only the Partner Categories the chosen Budget Category admits. */
    | "admittedPartnerCategory";
  /**
   * Named predicate deciding whether the field applies at all. A field that
   * does not apply is hidden and stored as null — the Server Action evaluates
   * the same predicate, so hiding it is never what enforces the rule.
   */
  visibleWhen?:
    | "accountRequiresPartner"
    | "budgetCategoryRequiresPartner"
    /**
     * A Budget Category that keeps a book **and** moves both ways, so which
     * direction raises its subject is a real choice. A single-direction
     * category's book can only run that way — the CHECK constraint says as
     * much — so asking would be offering one answer.
     */
    | "categoryChoosesRaises"
    /**
     * The chosen `currency_id` is not the base currency. A base-currency
     * resource needs no kurs — asking for one and answering "1" would be a
     * field that states the obvious on every rupiah account in the system.
     */
    | "currencyIsForeign";
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
  /**
   * `money` and `rate`. The ref field naming the currency this field relates
   * to: for an amount, the currency it is denominated in; for a rate, the
   * currency it converts *from*. Either way the box can say so rather than
   * leaving the reader to infer it.
   */
  currencyFrom?: string;
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
  help: "bila Inactive, tidak muncul pada transaksi baru",
};

const FISCAL_STATUS_FIELD: Field = {
  name: "status",
  label: "Status",
  type: "select",
  required: true,
  options: ["Draft", "Open", "Closed"],
  defaultValue: "Draft",
  help: "Draft belum dipakai · Open menerima posting · Closed terkunci",
};

const NOTE_FIELD: Field = {
  name: "note",
  label: "Catatan",
  type: "textarea",
  full: true,
  placeholder: "Keterangan tambahan (opsional)…",
};

const identHelp =
  "identitas ringkas, dipakai di dropdown dan laporan";

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
        help: "nama lengkap",
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
      // Company first, because it is what the record belongs to and cannot be
      // changed afterwards. A form is read top to bottom, and the field that
      // fixes a record's context belongs before the fields that describe it.
      {
        name: "company_id",
        label: "Company",
        type: "ref",
        ref: "sys_company",
        required: true,
        locked: true,
        help: "terikat pada satu Company, tidak dapat dipindah",
      },
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
        help: "nama lengkap",
      },
      {
        name: "category_id",
        label: "Partner Category",
        type: "ref",
        ref: "sys_partner_category",
        required: true,
        help: "menentukan Budget Category yang boleh memakainya",
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
      // Company first: it is what the resource belongs to, it cannot be
      // changed afterwards, and the Account picker below is decided by it.
      {
        name: "company_id",
        label: "Company",
        type: "ref",
        ref: "sys_company",
        required: true,
        locked: true,
        resets: ["account_id"],
        help: "pilihan Account mengikuti Company ini",
      },
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
        help: "nama lengkap",
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
        help: "currency resource, bukan currency transaksi",
      },
      {
        name: "account_id",
        label: "Account",
        type: "ref",
        ref: "acc_account",
        required: true,
        refFilter: "cashBankAccount",
        help: "account postable di kelompok Kas/Bank Company ini",
      },
      {
        name: "opening_balance",
        label: "Saldo Awal",
        type: "money",
        currencyFrom: "currency_id",
        createOnly: true,
        virtual: true,
        // Starts empty on its placeholder rather than on a literal `0` the user
        // has to delete first — the same as every other amount in the
        // application. A blank field is read as zero by `createRecord`.
        placeholder: "0",
        help: "dicatat sebagai entri pembuka di Cash Bank Book",
      },
      {
        // A foreign resource's opening balance was acquired at some price, and
        // that price is what a later payment out of it releases. Without it the
        // account would hold currency of unknown value — which is why a foreign
        // opening balance was refused outright until layers existed.
        name: "opening_rate",
        label: "Kurs Perolehan",
        type: "rate",
        currencyFrom: "currency_id",
        createOnly: true,
        virtual: true,
        visibleWhen: "currencyIsForeign",
        placeholder: "0",
        help: "kurs saat saldo awal itu diperoleh",
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
        help: "kode ISO mata uang",
      },
      {
        name: "currency_name",
        label: "Nama Currency",
        type: "text",
        required: true,
        placeholder: "Euro",
        help: "nama lengkap",
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

  // ------------------------------------------------ pengaturan · klasifikasi
  //
  // The classification chain, as three editable entities. These are `sys_`
  // tables the seeder still plants, but the model they describe is the part of
  // the business still being discovered — so they are read from the database
  // rather than compiled in, and reshaped here. See `classification.ts`.
  //
  // Under Pengaturan rather than Master because they configure how the
  // application classifies, which is a different job from maintaining the
  // records it classifies — a Partner or a Cash & Bank resource is data
  // somebody enters daily, while these are set up once and revisited rarely.

  {
    key: "sys_budget_category",
    slug: "budget-category",
    module: "settings",
    name: "Budget Category",
    icon: "tags",
    desc: "Klasifikasi yang diberikan saat Budget disetujui. Menentukan arah yang berlaku, apakah memakai Partner, dan Partner Category mana yang boleh dipilih.",
    codeField: "category_code",
    codePrefix: "bcat",
    labelField: "category_label",
    nameField: "category_name",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "category_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        span: 4,
        placeholder: "Hutang",
        help: identHelp,
      },
      {
        name: "category_name",
        label: "Nama Budget Category",
        type: "text",
        required: true,
        span: 8,
        placeholder: "Hutang kepada pihak lain",
        help: "nama lengkap",
      },
      // One field rather than two checkboxes, because two checkboxes can both
      // be off — a category that moves in no direction could classify no
      // Budget at all, and the Server Action and a CHECK constraint both refuse
      // it. A required select has no such state to reach: the bad combination
      // stops being something a user can build and then be told about.
      //
      // Virtual: it is written as `allows_in` / `allows_out`, which is what
      // every reader still asks for. See `derivedColumns` in
      // `app/actions/master.ts`.
      {
        name: "direction_mode",
        label: "Arah",
        type: "select",
        options: ["Out", "In", "Both"],
        optionLabels: {
          Out: "Pengeluaran saja",
          In: "Penerimaan saja",
          Both: "Keduanya",
        },
        required: true,
        virtual: true,
        span: 4,
        help: "mengikuti logika neraca, bukan arah kas",
      },
      {
        name: "require_partner",
        label: "Memakai Partner",
        type: "bool",
        span: 4,
        resets: ["raises", "book_closing_label", "partner_category_ids"],
        help: "matikan bila kategori ini tidak punya subjek",
      },
      // Chosen here rather than on a menu of its own. A category that names a
      // Partner is only usable once it admits at least one Partner Category —
      // no Purpose is generated for it otherwise, and its subject book can
      // never receive an entry — so the two belong in one save. `required`
      // together with `visibleWhen` reads as "mandatory exactly when the
      // category names a Partner".
      {
        name: "partner_category_ids",
        label: "Partner Category",
        type: "multiref",
        ref: "sys_partner_category",
        joinTable: "sys_budget_partner_category_mapping",
        virtual: true,
        required: true,
        visibleWhen: "accountRequiresPartner",
        span: 12,
        help: "boleh dipilih saat Budget kategori ini disetujui",
      },
      // A category that names a Partner keeps a subject book, and these two are
      // what that book needs. `raises` is the only fact nothing else predicts:
      // money out raises a Piutang and lowers a Hutang, which is balance-sheet
      // logic rather than cash direction. Without it the category has no book —
      // deliberately, because a book running the wrong way is worse than none.
      {
        name: "raises",
        label: "Posisi Naik Saat",
        type: "select",
        options: ["Out", "In"],
        optionLabels: { Out: "Pengeluaran", In: "Penerimaan" },
        // Required *because* of `visibleWhen`, not despite it: a field that
        // does not apply is skipped by `validate`, so this reads as "mandatory
        // exactly when the category names a Partner". Naming a Partner means
        // keeping a book, and a book has to know which way it runs — leaving it
        // optional produced a category that could be transacted while its
        // subject book silently recorded nothing.
        required: true,
        visibleWhen: "categoryChoosesRaises",
        span: 4,
        help: "arah yang menambah posisi subjek",
      },
      {
        name: "book_closing_label",
        label: "Sebutan Saldo Akhir",
        type: "text",
        visibleWhen: "accountRequiresPartner",
        span: 8,
        placeholder: "Sisa hutang",
        help: "opsional, dipakai pada laporan Buku Subjek",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "category_label", label: "Label", isLabel: true, width: "130px", filter: "text" },
      { field: "category_name", label: "Nama Budget Category", primary: true, filter: "text" },
      { field: "directions", label: "Arah", computed: true, width: "170px" },
      { field: "partner_categories", label: "Partner Category", computed: true, width: "210px" },
      { field: "book", label: "Buku Subjek", computed: true, width: "150px" },
      { field: "purpose_count", label: "Purpose", computed: true, numeric: true, width: "92px" },
      { field: "budget_count", label: "Budget", computed: true, numeric: true, width: "86px" },
      { field: "status", label: "Status", isStatus: true, width: "104px", filter: "enum" },
    ],
  },

  {
    key: "sys_partner_category",
    slug: "partner-category",
    module: "settings",
    name: "Partner Category",
    icon: "users",
    desc: "Jenis Partner — Cabang, Karyawan, Stakeholder. Menentukan Partner mana yang boleh dipilih untuk sebuah Budget Category.",
    codeField: "category_code",
    codePrefix: "pcat",
    labelField: "category_label",
    nameField: "category_name",
    statusModel: ACTIVE_STATUS,
    fields: [
      {
        name: "category_label",
        label: "Label",
        type: "text",
        required: true,
        unique: true,
        ident: true,
        span: 4,
        placeholder: "Karyawan",
        help: identHelp,
      },
      {
        name: "category_name",
        label: "Nama Partner Category",
        type: "text",
        required: true,
        span: 8,
        placeholder: "Pegawai perusahaan",
        help: "nama lengkap",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "category_label", label: "Label", isLabel: true, width: "130px", filter: "text" },
      { field: "category_name", label: "Nama Partner Category", primary: true, filter: "text" },
      { field: "budget_categories", label: "Dipakai Budget Category", computed: true, width: "260px" },
      { field: "partner_count", label: "Partner", computed: true, numeric: true, width: "92px" },
      { field: "status", label: "Status", isStatus: true, width: "110px", filter: "enum" },
    ],
  },

  {
    key: "sys_purpose",
    slug: "purpose",
    module: "settings",
    name: "Transaction Purpose",
    single: "Purpose",
    icon: "tags",
    desc: "Arah × Budget Category × Partner Category, sebagaimana dipilih pada Cash Bank Transaction. Ditambahkan sendiri — Budget Category tanpa Purpose belum dapat ditransaksikan.",
    codeField: "purpose_key",
    codePrefix: "purp",
    statusModel: ACTIVE_STATUS,
    fields: [
      // A Purpose *is* the triple direction × Budget Category × Partner
      // Category, so all three are chosen once and locked. Editing one would
      // not change this Purpose — it would silently make it a different one,
      // against which documents have already been posted.
      //
      // There is no Sebutan: the label is composed from these three
      // (`purposeLabel` in `purposes.ts`), so every Purpose reads the same way
      // and none can drift from what it describes.
      {
        name: "direction",
        label: "Arah",
        type: "select",
        options: ["Out", "In"],
        optionLabels: { Out: "Pengeluaran", In: "Penerimaan" },
        required: true,
        locked: true,
        span: 4,
        help: "arah kas dokumen",
      },
      {
        name: "budget_category_id",
        label: "Budget Category",
        type: "ref",
        ref: "sys_budget_category",
        required: true,
        locked: true,
        resets: ["partner_category_id"],
        span: 4,
        help: "menentukan Budget yang dapat direalisasikan",
      },
      {
        name: "partner_category_id",
        label: "Partner Category",
        type: "ref",
        ref: "sys_partner_category",
        required: true,
        locked: true,
        // Shown only where the Budget Category names a subject, and offering
        // only the Partner Categories that category admits — so the reader
        // never has to guess which ones a Budget Category takes, and cannot
        // pick one `validatePurpose` would then refuse.
        visibleWhen: "budgetCategoryRequiresPartner",
        refFilter: "admittedPartnerCategory",
        span: 4,
        help: "hanya yang diakui Budget Category itu",
      },
      STATUS_FIELD,
      NOTE_FIELD,
    ],
    columns: [
      { field: "label", label: "Sebutan", computed: true, primary: true },
      { field: "direction", label: "Arah", computed: true, width: "128px" },
      { field: "budget_category_id", label: "Budget Category", isRef: true, refLabelOnly: true, width: "160px", filter: "ref" },
      { field: "partner_category_id", label: "Partner Category", isRef: true, refLabelOnly: true, width: "150px", filter: "ref" },
      { field: "purpose_key", label: "Key", muted: true, width: "120px", filter: "text" },
      { field: "status", label: "Status", isStatus: true, width: "104px", filter: "enum" },
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
        help: "nomor sama pada Company lain adalah account lain",
      },
      {
        name: "account_subcategory_id",
        label: "Kelompok Account",
        type: "ref",
        ref: "acc_account_subcategory",
        required: true,
        locked: true,
        resets: ["parent_account"],
        help: "menentukan posisi dan awal nomor account",
      },
      {
        name: "parent_account",
        label: "Parent Account",
        type: "ref",
        ref: "acc_account",
        refFilter: "parentAccount",
        locked: true,
        help: "opsional — nomornya melanjutkan nomor parent",
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
        help: "1–999, unik di bawah induk yang sama",
      },
      {
        name: "account_label",
        label: "Nomor Account",
        type: "text",
        required: true,
        derived: true,
        locked: true,
        ident: true,
        help: "dibentuk otomatis dari induk + nomor urut",
      },
      {
        name: "account_name",
        label: "Nama Account",
        type: "text",
        required: true,
        placeholder: "Persediaan",
        help: "nama lengkap",
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
        help: "satu Account menampung satu Partner Category",
      },
      {
        // Whether a book outside the General Ledger reconciles against this
        // account: a Cash & Bank resource registered on it, a subject-book
        // mapping pointing at it, a bridge or FX System Default naming it.
        // The structure answers that question, so the flag is recomputed from
        // it on every event that can change the answer and is never typed —
        // `syncControlAccounts` in `records.ts`. Still shown, because a manual
        // journal is refused by it and that refusal has to be readable before
        // somebody starts writing one.
        name: "is_control_account",
        label: "Control Account",
        type: "bool",
        derived: true,
        locked: true,
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
        help: "bagan akun berbeda per Company",
      },
      {
        name: "budget_category_id",
        label: "Budget Category",
        type: "ref",
        ref: "sys_budget_category",
        required: true,
        resets: ["partner_category_id", "account_id"],
        help: "menentukan Partner Category yang boleh dipasangkan",
      },
      {
        name: "partner_category_id",
        label: "Partner Category",
        type: "ref",
        ref: "sys_partner_category",
        required: true,
        refFilter: "admittedPartnerCategory",
        visibleWhen: "budgetCategoryRequiresPartner",
        resets: ["account_id"],
        help: "satu kombinasi menuju tepat satu Account",
      },
      {
        name: "account_id",
        label: "Account",
        type: "ref",
        ref: "acc_account",
        required: true,
        full: true,
        refFilter: "postableAccount",
        help: "hanya account postable milik Company ini",
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

/**
 * The fields that have to be answered before this one can be, in form order.
 *
 * Derived from `resets` rather than declared a second time. A field that
 * clears another when it changes *is* a field that other one depends on —
 * Company clears Parent Account because a parent belongs to a Company — so
 * stating the dependency twice would be a rule with two answers, and the two
 * would drift the first time one of them was edited alone.
 *
 * A `bool` never counts: it is always answered, one way or the other. A field
 * that does not apply is skipped, so a Partner Category the Budget Category
 * does not take never blocks the Account behind it.
 */
export function prerequisitesOf(
  entity: Entity,
  field: Field,
  values: Record<string, unknown>,
  applies: (f: Field) => boolean
): Field[] {
  return entity.fields.filter(
    (f) =>
      f.type !== "bool" &&
      (f.resets?.includes(field.name) ?? false) &&
      applies(f) &&
      (values[f.name] == null || values[f.name] === "")
  );
}

/**
 * What a picker says while it waits — `Pilih Company dan Kelompok Account
 * dulu…`, in the same `Pilih <what>…` shape every prompt in the application
 * uses (CLAUDE.md §8).
 */
export function waitingClause(missing: Field[]): string | null {
  if (!missing.length) return null;
  const names = missing.map((f) => f.label);
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} dan ${names[names.length - 1]}`
      : names[0];
  return `Pilih ${list} dulu…`;
}

/**
 * Whether a field applies, given the values currently entered.
 *
 * The classification catalogue is passed in rather than read here: this module
 * is client-safe and the rules now live in the database, so the page loads them
 * once and hands them down. An absent catalogue answers "does not apply",
 * which is the safe direction — the Server Action re-checks regardless.
 */
export function fieldApplies(
  field: Field,
  values: Record<string, unknown>,
  categoryLabelOf?: (id: unknown) => string | undefined,
  currencyLabelOf?: (id: unknown) => string | undefined,
  classification?: ClassificationCatalogue
): boolean {
  if (!field.visibleWhen) return true;
  if (field.visibleWhen === "accountRequiresPartner") {
    const v = values.require_partner;
    return v === true || v === "true";
  }
  if (field.visibleWhen === "categoryChoosesRaises") {
    const v = values.require_partner;
    return (v === true || v === "true") && values.direction_mode === "Both";
  }
  if (field.visibleWhen === "currencyIsForeign") {
    const label = currencyLabelOf?.(values.currency_id);
    // Nothing chosen yet is not foreign: the field appears once the answer is
    // known, rather than flickering in on an empty picker.
    return label ? !isBaseCurrency(label) : false;
  }
  // budgetCategoryRequiresPartner
  const label = categoryLabelOf?.(values.budget_category_id);
  return label && classification
    ? budgetCategoryNeedsPartner(classification, label)
    : false;
}

// The Budget Category rules themselves moved to `classification.ts` and are
// loaded from the database — see `loadClassification` in `records.ts`. They
// left this file because a registry of field definitions should not also be
// where a business rule lives, and because they stopped being constants.

export const STATUS_TEXT: Record<string, string> = {
  Active: "Aktif",
  Inactive: "Non Aktif",
  Open: "Open",
  Draft: "Draft",
  Closed: "Closed",
  Posted: "Posted",
  Pending: "Menunggu Funding",
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
  Pending: "s-info",
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
