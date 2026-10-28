# SIBA 3.0 — Database DBML

> **The current schema, always.** This file is the one authoritative DBML for
> SIBA and is updated in the same change as any migration that alters the
> database — a new table, a new column, a new enum, a changed constraint.
> If `prisma/schema.prisma` and this file disagree, this file is out of date
> and is the thing to fix.

```dbml
//----------------------------------
// Sys Table
//----------------------------------

table sys_user {
  id                          int [pk, increment, not null]

  user_code                   varchar(255) [not null, unique]

  email                       varchar(255) [not null, unique]
  name                        varchar(255) [not null]
  initials                    varchar(255) [not null]

  password_hash               varchar(255) [not null]

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]
}

table sys_role {
  id                          int [pk, increment, not null]

  role_code                   varchar(255) [not null, unique]

  role_label                  varchar(255) [not null, unique]
  role_name                   varchar(255) [not null]

  is_system                   boolean [not null, default: false]

  note                        text

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]
}

table sys_permission {
  id                          int [pk, increment, not null]

  permission_code             varchar(255) [not null, unique]
  permission_name             varchar(255) [not null]

  module                      varchar(255) [not null]
  description                 text

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    module
  }
}

table sys_user_role {
  id                          int [pk, increment, not null]

  user_id                     int [not null, ref : > sys_user.id]
  role_id                     int [not null, ref : > sys_role.id]

  created_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (user_id, role_id) [unique]
    user_id
  }
}

table sys_role_permission {
  id                          int [pk, increment, not null]

  role_id                     int [not null, ref : > sys_role.id]
  permission_id               int [not null, ref : > sys_permission.id]

  created_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (role_id, permission_id) [unique]
    role_id
  }
}

table sys_session {
  id                          int [pk, increment, not null]

  token_hash                  varchar(255) [not null, unique]

  user_id                     int [not null, ref : > sys_user.id]

  expires_at                  timestamptz [not null]
  last_seen_at                timestamptz [not null, default: `transaction_timestamp()`]
  revoked_at                  timestamptz

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    user_id
    expires_at
  }
}

// System Default: application settings that prefill a form — Currency,
// Company and the Realisasi Cash & Bank default. Keys are declared in
// `system-defaults.ts`; a row with an unknown key is ignored. The accounts
// posting engines post to are not here — see acc_system_account.
table sys_setting {
  id                          int [pk, increment, not null]

  setting_key                 varchar(255) [not null, unique]
  setting_value               text

  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]
}

table sys_company {
  id                          int [pk, increment, not null]

  company_code                varchar(255) [not null, unique]

  company_label               varchar(255) [not null]
  company_name                varchar(255) [not null]

  is_parent                   boolean [not null, default: false]

  note                        text

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]
}

table sys_account_type {
  id                          int [pk, increment, not null]

  type_code                   varchar(255) [not null, unique]

  type_label                  varchar(255) [not null, unique]
  type_name                   varchar(255) [not null]

  // Neraca or Laba Rugi. Seeded, never edited and never offered on a form:
  // which statement a type belongs to is not a judgement call. Stored rather
  // than read off the first segment of the lineage code, so a type that does
  // not follow the convention cannot break a derivation silently.
  section                     enum('BalanceSheet', 'ProfitLoss') [not null]

  // Which side the type's own total reads positive on — AKTIVA and BIAYA
  // Debit, PASIVA, EKUITAS and PENDAPATAN Kredit. The Neraca signs every row
  // beneath a type by it rather than by the account's own normal balance,
  // which is what prints Akumulasi Penyusutan (a Kredit account inside
  // AKTIVA) as the deduction it is. Seeded, never edited, on no form; stored
  // rather than read off the type's number for the reason `section` is.
  normal_balance              enum('Debit', 'Kredit') [not null]

  note                        text

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]
}

table sys_doc_type {
  id                          int [pk, increment, not null]

  doc_code                    varchar(255) [not null, unique]

  doc_label                   varchar(255) [not null]
  doc_name                    varchar(255) [not null]

  doc_table                   varchar(255) [not null]

  note                        text

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]
}

table sys_budget_category {
  id                          int [pk, increment, not null]

  category_code               varchar(255) [not null, unique]

  category_label              varchar(255) [not null]
  category_name               varchar(255) [not null]

  // Which directions are meaningful for this category. Balance-sheet logic,
  // not cash direction. Two booleans rather than an enum because the real
  // answer is a set, and "Both" as a third value is a set pretending to be a
  // scalar. Shown as Penerimaan / Pengeluaran; In and Out are storage only.
  allows_in                   boolean [not null, default: false]
  allows_out                  boolean [not null, default: false]

  // False = this category names no subject at all (Asset, Biaya). A statement,
  // not an absence: a category that requires a Partner but has none configured
  // yet is a setup gap, which an empty mapping list alone cannot distinguish.
  require_partner             boolean [not null, default: true]

  // A category that names a Partner keeps a subject book, and these three are
  // that book. `raises` is which cash direction raises the subject's position —
  // money out raises a Piutang and lowers a Hutang — and is the only fact
  // nothing else in the row predicts; null means no book yet. The other two are
  // presentation and fall back, so a book works without them.
  //
  // The book's identity is this row's id, which is what
  // `sub_ledger.budget_category_id` holds. Its name, its subject line and whether its closing
  // figure is a position or a running total are all derived — see
  // `src/lib/siba/subledger-catalogue.ts`.
  raises                      enum('In', 'Out')
  book_icon                   varchar(255)
  book_closing_label          varchar(255)

  // Whether a Penyesuaian Open Item may adjust this category's subject book.
  // Stored rather than inferred: the counter side is one Profit & Loss account
  // per journal side, which fixes a deposit, a payable or a receivable
  // correctly and would book income or expense against owner drawings or an
  // investment's own return. Seeded on for Titipan, Hutang and Piutang.
  // CHECK sys_budget_category_item_adjustment_needs_book: only a category that
  // keeps a book (require_partner and raises set) may carry it.
  allows_item_adjustment      boolean [not null, default: false]

  note                        text

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]
}

table sys_partner_category {
  id                          int [pk, increment, not null]

  category_code               varchar(255) [not null, unique]

  category_label              varchar(255) [not null]
  category_name               varchar(255) [not null]

  note                        text

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]
}

// sys_purpose was dropped with Realisasi Budget (migration
// 20260930090000_realisasi_budget). A realization's header no longer names a
// Purpose: its direction is the menu it is raised from, and each line carries
// its own Budget's category and Partner.

// Which Partner Categories a Budget Category admits — the chain
// Budget Category -> Partner Category -> Partner. Held as data rather than in
// code so it can be reshaped through Master > Klasifikasi while the model is
// still being discovered.
//
// One row per admitted pair, each carrying its own status, because narrowing a
// category must not rewrite history: deactivating a pair stops it being offered
// on new records and leaves every Budget already classified by it intact. That
// is the whole reason this is a table of rows and not a list on the category.
table sys_budget_partner_category_mapping {
  id                          int [pk, increment, not null]

  mapping_code                varchar(255) [not null, unique]

  budget_category_id          int [not null, ref : > sys_budget_category.id]
  partner_category_id         int [not null, ref : > sys_partner_category.id]

  note                        text

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (budget_category_id, partner_category_id) [unique]
    partner_category_id
  }
}

//----------------------------------
// Ref Table
//----------------------------------

table ref_currency {
  id                          int [pk, increment, not null]

  currency_code               varchar(255) [not null, unique]

  currency_label              varchar(255) [not null]
  currency_name               varchar(255) [not null]

  note                        text

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]
}

//----------------------------------
// Master Table
//----------------------------------

table m_partner {
  id                          int [pk, increment, not null]

  partner_code                varchar(255) [not null, unique]

  partner_label               varchar(255) [not null]
  partner_name                varchar(255) [not null]

  company_id                  int [not null, ref : > sys_company.id]

  category_id                 int [not null, ref : > sys_partner_category.id]

  note                        text

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    company_id
    category_id
  }
}

table m_cash_bank {
  id                          int [pk, increment, not null]

  cash_bank_code              varchar(255) [not null, unique]

  cash_bank_label             varchar(255) [not null]
  cash_bank_name              varchar(255) [not null]

  company_id                  int [not null, ref : > sys_company.id]

  cash_bank_type              enum('Cash', 'Bank') [not null]
  currency_id                 int [not null, ref : > ref_currency.id]

  account_id                  int [not null, ref : > acc_account.id]

  note                        text

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    company_id
  }
}

//----------------------------------
// Cash Bank Book Table
//----------------------------------

table cash_bank_ledger {
  id                          int [pk, increment, not null]

  entry_no                    varchar(255) [not null, unique]

  cash_bank_id                int [not null, ref : > m_cash_bank.id]

  accounting_date             date [not null]
  // When the document that wrote it was posted: the Post transaction's own
  // time (transaction_timestamp()). Backdated when later than accounting_date.
  posted_at                   timestamptz [not null, default: `transaction_timestamp()`]
  // Revaluation: a Revaluasi Kurs — movement nil, base_movement the restated
  // difference.
  entry_type                  enum('Opening', 'Transaction', 'Adjustment', 'Revaluation') [not null]

  // Signed: positive money in, negative money out. The sign is the direction —
  // direction, amount and base_amount were dropped in
  // 20261014114914_ledger_signed_movement, so the two can never disagree. No
  // running balance: an entry may be backdated, so balance_after followed write
  // order, not date (dropped in 20261022090000).
  movement                    decimal(18,2) [not null]

  rate                        decimal(18,6) [not null]
  base_movement               decimal(18,2) [not null]

  source_doc_type_id          int [ref : >? sys_doc_type.id]
  source_doc_id               int

  note                        text

  created_by                  int [not null]

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (cash_bank_id, accounting_date)
    (source_doc_type_id, source_doc_id)
  }
}

table cash_bank_balance {
  id                          int [pk, increment, not null]
  cash_bank_id                int [unique, not null, ref : - m_cash_bank.id]

  balance                     decimal(18,2) [not null, default: 0]
  base_balance                decimal(18,2) [not null, default: 0]

  entry_count                 int [not null, default: 0]

  last_entry_id               int
  last_entry_date             date

  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]
}

// One row per resource per calendar month, written by `recordCashBankEntry`
// with the entry, so a backdated movement is checked without reading the book
// from its first entry. The months form an unbroken chain from the first
// entry's to the latest's; each `opening` is the previous `closing`. Keyed on
// the month, not on acc_fiscal_period: a fiscal year may be missing, and a
// book depends on no module.
table cash_bank_period {
  id                          int [pk, increment, not null]
  cash_bank_id                int [not null, ref : > m_cash_bank.id]
  period                      date [not null, note: 'first day of the month']

  opening                     decimal(18,2) [not null, default: 0]
  total_in                    decimal(18,2) [not null, default: 0]
  total_out                   decimal(18,2) [not null, default: 0]
  closing                     decimal(18,2) [not null, default: 0]
  // The lowest the balance stands in the month, opening included. A backdated
  // movement shifts every later month by itself, so MIN(min_balance) + movement
  // over them is the whole check.
  min_balance                 decimal(18,2) [not null, default: 0]

  // Base measure, for reports; not validated. A nil movement (revaluation)
  // counts on the out side.
  base_opening                decimal(18,2) [not null, default: 0]
  base_total_in               decimal(18,2) [not null, default: 0]
  base_total_out              decimal(18,2) [not null, default: 0]
  base_closing                decimal(18,2) [not null, default: 0]

  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (cash_bank_id, period) [unique]
  }
}

table cash_bank_layer {
  id                          int [pk, increment, not null]

  layer_no                    varchar(255) [not null, unique]

  cash_bank_id                int [not null, ref : > m_cash_bank.id]

  acquisition_date            date [not null]
  acquisition_seq             int [not null]

  rate                        decimal(18,6) [not null]

  foreign_original            decimal(18,2) [not null]
  base_original               decimal(18,2) [not null]

  foreign_remaining           decimal(18,2) [not null]
  base_remaining              decimal(18,2) [not null]

  // ClosedByRevaluation: replaced by a Revaluasi Kurs, which keeps the record
  // (fin_cash_bank_revaluation_layer). Never reopened.
  status                      enum('Open', 'Exhausted', 'ClosedByRevaluation') [not null, default: 'Open']

  source_doc_type_id          int [ref : >? sys_doc_type.id]
  source_doc_id               int

  note                        text

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (cash_bank_id, status, acquisition_date, acquisition_seq)
    (source_doc_type_id, source_doc_id)
  }
}

//----------------------------------
// Subledger Table
//----------------------------------

table sub_ledger {
  id                          int [pk, increment, not null]

  entry_no                    varchar(255) [not null, unique]

  // The book: the Budget Category that keeps it. Was the category's code as
  // text until 20261013120000_subledger_book_category_id.
  budget_category_id          int [not null, ref : > sys_budget_category.id]

  partner_id                  int [not null, ref : > m_partner.id]
  currency_id                 int [not null, ref : > ref_currency.id]

  accounting_date             date [not null]
  // As on cash_bank_ledger: the Post transaction's own time.
  posted_at                   timestamptz [not null, default: `transaction_timestamp()`]
  // Conversion: a Pencairan Open Item — a foreign item released at its own
  // kurs, and the base-currency item it became, opened in the same book.
  // Reclass: a Reklasifikasi Open Item — an item released out of one position,
  // and the item it became or settled in another book or for another Partner.
  entry_type                  enum('Opening', 'Transaction', 'Adjustment', 'Conversion', 'Reclass') [not null]

  // Signed in the book's own direction: positive raises the position. The cash
  // direction behind it is the sign read with the category's raises, which is
  // fixed once the book has an entry. direction, amount and base_amount were
  // dropped in 20261014114914_ledger_signed_movement.
  // No running balance, as on cash_bank_ledger (dropped in 20261022090000).
  movement                    decimal(18,2) [not null]

  rate                        decimal(18,6) [not null]
  base_movement               decimal(18,2) [not null]

  // The open item this entry moved. A raising entry opens a new item and names
  // it; a lowering entry names the item the user chose and relieves it at that
  // item's own rate. Summing an item's entries rebuilds it.
  balance_id                  int [not null, ref : > sub_ledger_balance.id]

  source_doc_type_id          int [ref : >? sys_doc_type.id]
  source_doc_id               int

  note                        text

  created_by                  int [not null]

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (budget_category_id, partner_id, accounting_date)
    balance_id
    (source_doc_type_id, source_doc_id)
  }
}

// The OPEN ITEMS of the subject books: one row per movement that raised a
// position, and the balance and the item are the same row. A position (book x
// Partner x currency) is not a row — it is the sum of its items, computed on
// read. Each item keeps the kurs it was raised at, so a line lowering the
// position names the item it settles and relieves it at that item's own rate,
// never at an average. Rupiah is itemised too, at a kurs of 1. Mutable, and
// provable from the entries that name it. No item may go below nothing, so no
// position can go negative.
table sub_ledger_balance {
  id                          int [pk, increment, not null]

  // SBI-0001 — how pickers and reports name an item.
  item_no                     varchar(255) [not null, unique]

  // The book: the Budget Category that keeps it.
  budget_category_id          int [not null, ref : > sys_budget_category.id]

  partner_id                  int [not null, ref : > m_partner.id]
  currency_id                 int [not null, ref : > ref_currency.id]

  // When it was raised, the kurs it was raised at, and what it was raised by —
  // facts of the raising movement, like a rate layer's. Never change.
  opened_date                 date [not null]
  rate                        decimal(18,6) [not null]
  original                    decimal(18,2) [not null]
  base_original               decimal(18,2) [not null]

  // What remains of the item, on both measures.
  balance                     decimal(18,2) [not null, default: 0]
  base_balance                decimal(18,2) [not null, default: 0]

  status                      enum('Open', 'Cleared') [not null, default: 'Open']

  entry_count                 int [not null, default: 0]

  last_entry_id               int
  last_entry_date             date

  // The document that raised it (weak pair) and the words it was raised under.
  source_doc_type_id          int
  source_doc_id               int
  note                        text

  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (budget_category_id, partner_id, currency_id, status)
  }
}

//----------------------------------
// Accounting Table
//----------------------------------

table acc_account_category {
  id                          int [pk, increment, not null]

  account_type_id             int [not null, ref : > sys_account_type.id]

  category_code               varchar(255) [not null, unique]

  category_label              varchar(255) [not null, unique]
  category_name               varchar(255) [not null]

  // The step of the multi-step Laba Rugi this category sits in. Set exactly
  // when the category's type is ProfitLoss, null on every Neraca category —
  // across two tables, so asserted by a test rather than a CHECK. Seeded from
  // Template COA Sheet1 (4.1 OperatingRevenue, 5.1 CostOfSales, 5.2 and 5.3
  // OperatingExpense, 4.9 OtherIncome, 5.9 OtherExpense), never edited, on no
  // form. Stored rather than read off the category's number, for the reason
  // `sys_account_type.section` is. The enum's order is the statement's order:
  // Laba Kotor after CostOfSales, Laba Usaha after OperatingExpense, Laba
  // Bersih after OtherExpense.
  pl_group                    enum('OperatingRevenue', 'CostOfSales', 'OperatingExpense', 'OtherIncome', 'OtherExpense')

  note                        text

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    account_type_id
  }
}

table acc_account_subcategory {
  id                          int [pk, increment, not null]

  account_category_id         int [not null, ref : > acc_account_category.id]

  subcategory_code            varchar(255) [not null, unique]

  subcategory_label           varchar(255) [not null, unique]
  subcategory_name            varchar(255) [not null]

  note                        text

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    account_category_id
  }
}

table acc_account {
  id                          int [pk, increment, not null]

  account_subcategory_id      int [not null, ref : > acc_account_subcategory.id]

  account_code                varchar(255) [not null, unique]

  account_label               varchar(255) [not null]
  account_name                varchar(255) [not null]

  company_id                  int [not null, ref : > sys_company.id]

  parent_account              int [ref : >? acc_account.id]
  is_postable                 boolean [not null, default: true]

  normal_balance              enum('Debit', 'Kredit') [not null]

  // Set exactly when the ledger takes a Partner ('partner', 'subject_book').
  partner_category_id         int [ref : >? sys_partner_category.id]

  // Which ledger the account belongs to (Journal 2.0 D18), and so what every
  // line on it must name: 'none' nothing; 'partner' a Partner, for the
  // breakdown only; 'subject_book' a Partner and an open item in
  // ledger_book_id's book; 'cash_bank' a Cash & Bank, and the only ledger a
  // resource may post to. Replaced require_partner (dropped in
  // 20261028150000). is_control_account is 'subject_book' or 'cash_bank', plus
  // the System Account claims. Locked once the account has a journal line.
  // CHECK: ledger_book_id is set exactly when ledger = 'subject_book'. One
  // account, one ledger.
  ledger                      enum('none', 'partner', 'subject_book', 'cash_bank') [not null, default: 'none']
  ledger_book_id              int [ref : >? sys_budget_category.id]

  is_control_account          boolean [not null, default: false]

  note                        text

  is_active                   boolean [not null, default: true]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (company_id, account_label) [unique]
    company_id
    account_subcategory_id
  }
}

// Mapping Account System: per Company, the account a posting engine posts a
// role to — bridge_ar / bridge_ap (Funding Request), fx (Selisih Kurs),
// accumulated_pl / current_pl (closing and the Neraca), adjustment_income /
// adjustment_expense (the Penyesuaian Open Item counter side). Keys are declared in `system-accounts.ts`;
// a row with an unknown key is ignored. Moved out of sys_setting, where each
// was a text key naming its Company, so the account is now a real foreign key.
table acc_system_account {
  id                          int [pk, increment, not null]

  company_id                  int [not null, ref: > sys_company.id]
  account_key                 text [not null]
  account_id                  int [ref: > acc_account.id]

  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (company_id, account_key) [unique]
  }
}

table acc_budget_category_account {
  id                          int [pk, increment, not null]

  bca_code                    varchar(255) [not null, unique]

  budget_category_id          int [not null, ref : > sys_budget_category.id]
  company_id                  int [not null, ref : > sys_company.id]
  partner_category_id         int [ref : >? sys_partner_category.id]

  account_id                  int [not null, ref : > acc_account.id]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (company_id, budget_category_id, partner_category_id) [unique]
    company_id
  }
}

// One Company's fiscal year. Each Company keeps its own calendar, so it
// activates, locks and closes its years without waiting on the other
// (migration 20261021090000_fiscal_calendar_per_company split every shared year
// into one per Company). Every year still runs 01/01–31/12 — the shape is
// generated, never typed. Budget Month stays one list across both Companies,
// one row per calendar month.
//
// Any number of years may stand Open. status is the Company's own: Closed when
// its close has run, which also makes every period Closed.

table acc_fiscal_year {
  id                          int [pk, increment, not null]

  company_id                  int [not null, ref : > sys_company.id]

  year_code                   varchar(255) [not null, unique]

  year_label                  varchar(255) [not null]
  year_name                   varchar(255) [not null]

  start_date                  date [not null]
  end_date                    date [not null]

  note                        text

  status                      enum('Draft', 'Open', 'Closed') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (company_id, year_label) [unique]
  }
}

// One month of one Company's year, generated when the year is activated.
// A posting's date must fall in an Open period of its Company's calendar.
// Locked refuses postings and may be unlocked again — a state, not a close;
// a year closes only once all twelve are Locked, and its close makes them
// Closed for good.

table acc_fiscal_period {
  id                          int [pk, increment, not null]

  fiscal_year_id              int [not null, ref : > acc_fiscal_year.id]
  // The year's Company, copied when the periods are generated, so a date
  // resolves to one Company's period by a unique key.
  company_id                  int [not null, ref : > sys_company.id]
  sequence_no                 int [not null]

  period_code                 varchar(255) [not null, unique]

  period_label                varchar(255) [not null]
  period_name                 varchar(255) [not null]

  start_date                  date [not null]
  end_date                    date [not null]

  note                        text

  status                      enum('Open', 'Locked', 'Closed') [not null, default: 'Open']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (company_id, start_date) [unique]
    fiscal_year_id
  }
}

// One Company's closing state for one fiscal year.
//
// A year belongs to one Company, so this row's company_id is always its year's.
// It records what the close produced and who ran it; acc_fiscal_year.status
// turns Closed in the same transaction.
//
// An explicit record rather than a status inferred from the existence of an
// Opening Balance document. Inferring a fact from a row in another table works
// until somebody writes that row for a second reason, and then nothing fails.
//
// The lock reads this table beside the period: a posting is allowed only when
// its date falls in an Open period of an Open year its Company has not closed.
// Closing is irreversible — Closed means never again, not "not yet".

table acc_fiscal_closing {
  id                          int [pk, increment, not null]

  fiscal_year_id              int [not null, ref : > acc_fiscal_year.id]
  company_id                  int [not null, ref : > sys_company.id]

  // No Draft: a year is either still receiving this Company's postings or it
  // never will again.
  status                      enum('Open', 'Closed') [not null, default: 'Open']

  closed_at                   timestamptz
  closed_by                   int

  // The CLS- journal this close produced and the OPB- snapshot it wrote for the
  // following year. Held as ids rather than as declared references: both are
  // other modules' documents, and a reference would put a back-relation on
  // acc_journal, which is an independent book meant to stay liftable. Null
  // until a close actually happens — nothing writes either one yet.
  closing_journal_id          int
  opening_balance_id          int

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (fiscal_year_id, company_id) [unique]
    company_id
  }
}

// One Company's balances at the start of one fiscal year — a snapshot, not a
// running store.
//
// It exists so a report need not scan from the first historical transaction to
// work out where an account stood, and so a closed year hands the next one its
// position in a form somebody can read. Immutable: written once, by a close or
// by a developer injecting go-live figures, and never edited. There is no
// create form and no edit path in the application.
//
// Base currency only, and that is why there is no currency_id: the journal, the
// General Ledger and the Trial Balance are all base-currency statements, and a
// snapshot of them is the same measure.
//
// source_fiscal_year_id is what tells a generated snapshot from an injected
// one. A close writes the year it closed; go-live balances leave it null,
// because nothing produced them.

table acc_opening_balance {
  id                          int [pk, increment, not null]

  opening_no                  varchar(255) [not null, unique]

  // The day the figures speak for — the first day of the year being opened.
  accounting_date             date [not null]
  posted_at                   timestamptz [not null, default: `transaction_timestamp()`, note: 'when the close or go-live wrote it']

  // The year this snapshot opens.
  fiscal_year_id              int [not null, ref : > acc_fiscal_year.id]
  // The year whose close produced it, or null for injected go-live balances.
  source_fiscal_year_id       int [ref : >? acc_fiscal_year.id]

  company_id                  int [not null, ref : > sys_company.id]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    // One snapshot per Company per year. A second would be a second answer to
    // "where did this Company stand on 1 January", and the document is
    // immutable, so there is no legitimate route to two.
    (fiscal_year_id, company_id) [unique]
    company_id
  }
}

// One balance, at the grain the journal itself keeps: (account, partner?).
//
// A Hutang account owed to three branches produces three lines; an account
// naming no Partner produces one line with partner_id = null. There is
// deliberately no parent row holding the account's total — that figure is the
// sum of its children, and an immutable snapshot has no rebuild function to
// prove a stored duplicate still agrees with what it duplicates.
//
// The grain is derived from the posted journal lines as they actually are,
// never from acc_account.require_partner: reading the flag would drop a
// partner-bearing balance sitting on an unflagged account, and would invent a
// null-partner line for an account that has none.

table acc_opening_balance_line {
  id                          int [pk, increment, not null]

  opening_id                  int [not null, ref : > acc_opening_balance.id]
  sequence_no                 int [not null]

  account_id                  int [not null, ref : > acc_account.id]
  partner_id                  int [ref : >? m_partner.id]

  // Base currency, like every figure in the journal this is a snapshot of.
  // Exactly one side carries the value, and the document's two sides sum equal.
  debit_amount                decimal(18,2) [not null, default: 0]
  kredit_amount               decimal(18,2) [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    // Created NULLS NOT DISTINCT in the migration's own SQL, because Postgres
    // otherwise treats two null-partner rows for one account as distinct —
    // which is precisely the duplicate this index is for, and the common case.
    (opening_id, account_id, partner_id) [unique]
    opening_id
  }
}

table acc_journal {
  id                          int [pk, increment, not null]

  journal_no                  varchar(255) [not null, unique]
  // The day the journal belongs to in the books — its document's date, which
  // may be earlier than today (a backdated document) and never later. A manual
  // draft carries the date it is meant for; every reader filters Posted, so a
  // draft's date reaches no report. When it was written is created_at.
  accounting_date             date
  // When Post ran; null while a manual journal is a draft.
  posted_at                   timestamptz [default: `transaction_timestamp()`]

  source_doc_type_id          int [ref : >? sys_doc_type.id]
  source_doc_id               int

  company_id                  int [not null, ref : > sys_company.id]

  description                 text [not null]

  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Posted']
  is_manual                   boolean [not null, default: false]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (company_id, accounting_date)
    (source_doc_type_id, source_doc_id)
  }
}

table acc_journal_line {
  id                          int [pk, increment, not null]

  journal_id                  int [not null, ref : > acc_journal.id]
  sequence_no                 int [not null]

  account_id                  int [not null, ref : > acc_account.id]
  partner_id                  int [ref : >? m_partner.id]

  currency_id                 int [not null, ref : > ref_currency.id]
  exchange_rate               decimal(18,6) [not null, default: 1]

  debit_amount                decimal(18,2) [not null, default: 0]
  kredit_amount               decimal(18,2) [not null, default: 0]

  trx_amount                  decimal(18,2) [not null]

  description                 text [not null]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    journal_id
    account_id
  }
}

// Jurnal Umum (JUM-, Journal 2.0): a journal that may write any money ledger.
// Every column of acc_journal under the same name and type, so it can later
// replace that table without being reshaped. Post writes an ordinary posted
// acc_journal, linked by posted_journal_id.
table acc_general_journal {
  id                          int [pk, increment, not null]

  journal_no                  varchar(255) [not null, unique]  // JUM-0001
  accounting_date             date
  // Null while a draft, as on a manual journal; Post sets it.
  posted_at                   timestamptz [default: `transaction_timestamp()`]
  // Null on a Jurnal Umum. Kept so that, once this table replaces
  // acc_journal, every posting document writes its journal here.
  source_doc_type_id          int [ref : >? sys_doc_type.id]
  source_doc_id               int
  company_id                  int [not null, ref : > sys_company.id]
  description                 text [not null]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']
  is_manual                   boolean [not null, default: true]

  // The journal Post wrote, while acc_journal is still the ledger.
  posted_journal_id           int [unique, ref : - acc_journal.id]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (company_id, accounting_date)
    (source_doc_type_id, source_doc_id)
  }
}

// A Jurnal Umum line: every column of acc_journal_line, plus the subject its
// account's ledger demands. After Post its rows equal the posted
// acc_journal_line rows one for one, the netted Selisih Kurs included.
table acc_general_journal_line {
  id                          int [pk, increment, not null]

  journal_id                  int [not null, ref : > acc_general_journal.id]
  sequence_no                 int [not null]
  // Chosen first; it brings its ledger (acc_account.ledger).
  account_id                  int [not null, ref : > acc_account.id]
  partner_id                  int [ref : >? m_partner.id]
  currency_id                 int [not null, ref : > ref_currency.id]
  // 1 for the base currency; the subject's own kurs where it holds one; typed
  // only for something new. Nothing records which.
  exchange_rate               decimal(18,6) [not null, default: 1]
  // Base currency, exactly as Post writes them to acc_journal_line.
  debit_amount                decimal(18,2) [not null, default: 0]
  kredit_amount               decimal(18,2) [not null, default: 0]
  trx_amount                  decimal(18,2) [not null]
  description                 text [not null]

  // A weak reference read by the account's ledger adapter, no foreign key:
  //   subject_book → sub_ledger_balance.id, the open item (null: a new item)
  //   cash_bank    → m_cash_bank.id
  subject_id                  int
  // The rate layer a foreign Cash & Bank line draws on.
  cash_bank_layer_id          int [ref : >? cash_bank_layer.id]
  // Saldo baru as typed, and the balance it was typed against; Post refuses
  // if the object no longer holds balance_before.
  new_value                   decimal(18,2)
  balance_before              decimal(18,2)
  // The one netted Selisih Kurs line, written by the system on save.
  is_generated                boolean [not null, default: false]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    journal_id
    account_id
    (account_id, subject_id)
    cash_bank_layer_id
  }
}

//----------------------------------
// Budget Table
//----------------------------------

table bud_budget {
  id                          int [pk, increment, not null]

  budget_no                   varchar(255) [not null, unique]

  budget_date                 date [not null]

  company_id                  int [not null, ref : > sys_company.id]

  currency_id                 int [not null, ref : > ref_currency.id]

  budget_type                 enum('In', 'Out') [not null]

  // Null until the Budget is classified in Klasifikasi Budget, which moves it
  // from Approved to Open. Approval itself classifies nothing.
  category_id                 int [ref : >? sys_budget_category.id]
  partner_id                  int [ref : >? m_partner.id]

  description                 text [not null]

  budget_amount               decimal(18,2) [not null]
  realized_amount             decimal(18,2) [not null, default: 0]

  // Draft -> Submitted -> Approved (awaiting classification) -> Open
  // (classified, realizable) -> Closed. Rejected and Cancelled are final:
  // a rejected plan is replaced by a new Budget, never resubmitted.
  status                      enum('Draft', 'Cancelled', 'Submitted', 'Rejected', 'Approved', 'Open', 'Closed') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    company_id
    status
    budget_date
  }
}

//----------------------------------
// Finance Table
//----------------------------------

// A Realisasi Budget — Realisasi Penerimaan (In, RBM-0001) or Realisasi
// Pengeluaran (Out, RBK-0001). The header names no Purpose and no Partner:
// one document settles Budgets of any Budget Category and any Partner, and
// every book it writes (Cash Bank Book, subject book) takes one entry per line.
table fin_cash_bank_transaction {
  id                          int [pk, increment, not null]

  transaction_no              varchar(255) [not null, unique]
  // The day the document belongs to in the books, chosen on the draft — any day
  // up to today. Post dates every book entry and the journal by it;
  // posted_at is when Post actually ran. Null only on an older draft.
  accounting_date             date
  posted_at                   timestamptz

  transaction_type            enum('In', 'Out') [not null]

  company_id                  int [not null, ref : > sys_company.id]

  cash_bank_id                int [ref : >? m_cash_bank.id]

  currency_id                 int [not null, ref : > ref_currency.id]
  exchange_rate               decimal(18,6) [not null, default: 1]

  cash_bank_layer_id          int

  transaction_amount          decimal(18,2) [not null]
  transaction_base_amount     decimal(18,2) [not null]

  note                        text

  status                      enum('Draft', 'Pending', 'Posted', 'Cancelled') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    company_id
    status
  }
}

table fin_cash_bank_transaction_line {
  id                          int [pk, increment, not null]

  transaction_id              int [not null, ref : > fin_cash_bank_transaction.id]
  sequence_no                 int [not null]

  source_doc_type_id          int [not null, ref : > sys_doc_type.id]
  source_doc_id               int [not null]

  outstanding_amount          decimal(18,2) [not null]

  settlement_amount           decimal(18,2) [not null]
  settlement_base_amount      decimal(18,2) [not null]
  settlement_exchange_rate    decimal(18,6)

  transaction_amount          decimal(18,2) [not null]
  transaction_base_amount     decimal(18,2) [not null]

  // The line's FX result, signed as a gain. On a line settling open items it
  // is the sum of its items' differences, for reading only — each item's is
  // journaled on its own line (fin_cash_bank_transaction_line_item), never
  // netted.
  fx_difference               decimal(18,2) [not null, default: 0]

  // The open item the line opened where it raised a subject-book position
  // (sub_ledger_balance.id, plain id) — how a Budget follows its money on, e.g.
  // into a Reklasifikasi Open Item. Null where the line lowered a position,
  // kept no book, or was posted before the column existed (not backfilled).
  opened_item_id              int

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (transaction_id, sequence_no) [unique]
    (source_doc_type_id, source_doc_id)
    opened_item_id
  }
}

// The open items one Realisasi line settles, and for how much each. A line
// lowering a subject-book position may settle several items of its Budget's
// Partner; the user picks each item and states each amount — nothing is
// distributed by the system — and the line's settlement_amount is their sum.
// Each item is relieved at its own kurs and has its own FX difference, on a
// journal line of its own (IAS 21 / PSAK 10: per monetary item settled).
// Empty for a line that raises a position or whose category keeps no book.
table fin_cash_bank_transaction_line_item {
  id                          int [pk, increment, not null]

  line_id                     int [not null, ref : > fin_cash_bank_transaction_line.id]
  sequence_no                 int [not null]
  // The item settled (sub_ledger_balance.id). A plain id, not a ref, like
  // cash_bank_layer_id: the item belongs to the subject-book module.
  sub_ledger_balance_id       int [not null]

  // Document currency; more than nil (CHECK), never more than the item holds.
  amount                      decimal(18,2) [not null]
  // What the item released at its own kurs. Written at Post.
  settlement_base_amount      decimal(18,2) [not null, default: 0]
  // This item's share of the line's cash cost; a line's shares add up to its
  // transaction_base_amount exactly (the last takes the rounding). At Post.
  transaction_base_amount     decimal(18,2) [not null, default: 0]
  // Signed as a gain: positive posts to the credit side, negative the debit.
  fx_difference               decimal(18,2) [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (line_id, sub_ledger_balance_id) [unique]
    (line_id, sequence_no) [unique]
    sub_ledger_balance_id
  }
}

table fin_cash_bank_transfer {
  id                          int [pk, increment, not null]

  transfer_no                 varchar(255) [not null, unique]
  // As on fin_cash_bank_transaction: chosen on the draft, up to today.
  accounting_date             date
  posted_at                   timestamptz

  company_id                  int [not null, ref : > sys_company.id]

  purpose                     enum('Transfer', 'Pencairan', 'PembelianValas') [not null]

  from_cash_bank_id           int [not null, ref : > m_cash_bank.id]

  currency_id                 int [not null, ref : > ref_currency.id]

  cash_bank_layer_id          int

  transfer_amount             decimal(18,2) [not null]
  transfer_base_amount        decimal(18,2) [not null]

  note                        text

  status                      enum('Draft', 'Pending', 'Posted', 'Cancelled') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    company_id
    status
  }
}

table fin_cash_bank_transfer_line {
  id                          int [pk, increment, not null]

  transfer_id                 int [not null, ref : > fin_cash_bank_transfer.id]
  sequence_no                 int [not null]

  to_cash_bank_id             int [not null, ref : > m_cash_bank.id]

  amount                      decimal(18,2) [not null]
  exchange_rate               decimal(18,6) [not null]

  out_amount                  decimal(18,2) [not null]
  out_base_amount             decimal(18,2) [not null]

  in_amount                   decimal(18,2) [not null]
  in_base_amount              decimal(18,2) [not null]

  fx_difference               decimal(18,2) [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (transfer_id, sequence_no) [unique]
    to_cash_bank_id
  }
}

// PENCAIRAN OPEN ITEM: foreign currency sold out of the Company's own Cash &
// Bank, and ONE Partner's open items in that currency converted to base
// currency at the SAME kurs, in one document. The cash leg is a Pencairan (one
// foreign source, one layer, base-currency destinations each at its own kurs);
// the Partner leg releases each chosen foreign item at its own kurs and opens
// one base-currency item per line, in the same book, for exactly what that
// line's sale produced. One Selisih Kurs journal line per document — a
// difference of the sale, never a revaluation. Its own module, not a fourth
// Transfer purpose: a transfer names no Partner and writes no subject book.
table fin_item_conversion {
  id                          int [pk, increment, not null]

  // POI-0001.
  conversion_no               varchar(255) [not null, unique]
  // Chosen on the draft, any day up to today; Post dates everything by it.
  accounting_date             date
  posted_at                   timestamptz

  // The source's Company, derived rather than picked.
  company_id                  int [not null, ref : > sys_company.id]
  // The foreign source; money always leaves it.
  from_cash_bank_id           int [not null, ref : > m_cash_bank.id]
  // The source's own currency, and the currency of every item converted.
  currency_id                 int [not null, ref : > ref_currency.id]
  // The one source layer the sale draws on (cash_bank_layer.id, plain id).
  cash_bank_layer_id          int [not null]

  // One book (a subject book is a Budget Category) and one Partner.
  budget_category_id          int [not null, ref : > sys_budget_category.id]
  partner_id                  int [not null, ref : > m_partner.id]

  conversion_amount           decimal(18,2) [not null]
  // What the layer released; provisional on a Draft, written at Post.
  conversion_base_amount      decimal(18,2) [not null]
  // The one Selisih Kurs figure, signed as a gain. Written at Post.
  fx_difference               decimal(18,2) [not null, default: 0]

  note                        text

  status                      enum('Draft', 'Pending', 'Posted', 'Cancelled') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    company_id
    partner_id
    status
  }
}

// One base-currency destination, worth exactly the items it converts.
table fin_item_conversion_line {
  id                          int [pk, increment, not null]

  conversion_id               int [not null, ref : > fin_item_conversion.id]
  sequence_no                 int [not null]

  // A base-currency Cash & Bank; never twice in one document.
  to_cash_bank_id             int [not null, ref : > m_cash_bank.id]

  // Document currency, > 0 (CHECK); the sum of the line's items.
  amount                      decimal(18,2) [not null]
  // > 0 (CHECK). The rate the bank bought at, and the rate the items convert at.
  exchange_rate               decimal(18,6) [not null]

  // Written at Post: what the layer released, what the bank paid in base
  // (= the new item's value), and the new item (sub_ledger_balance.id).
  out_base_amount             decimal(18,2) [not null, default: 0]
  in_amount                   decimal(18,2) [not null, default: 0]
  opened_item_id              int

  // The line's two halves of the difference, each signed as a gain. The
  // journal carries their sum, once per document.
  cash_fx_difference          decimal(18,2) [not null, default: 0]
  item_fx_difference          decimal(18,2) [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (conversion_id, sequence_no) [unique]
    to_cash_bank_id
  }
}

// One foreign open item a line converts, chosen and stated by the user.
table fin_item_conversion_line_item {
  id                          int [pk, increment, not null]

  line_id                     int [not null, ref : > fin_item_conversion_line.id]
  sequence_no                 int [not null]
  // sub_ledger_balance.id — a plain id: the item is the subject book's.
  sub_ledger_balance_id       int [not null]

  // > 0 (CHECK), never more than the item holds across the document.
  amount                      decimal(18,2) [not null]
  // Written at Post: what the item released at its own kurs, its share of
  // the new base-currency item (a line's shares add up to its in_amount), and
  // its difference signed as a gain.
  settlement_base_amount      decimal(18,2) [not null, default: 0]
  converted_base_amount       decimal(18,2) [not null, default: 0]
  fx_difference               decimal(18,2) [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (line_id, sub_ledger_balance_id) [unique]
    (line_id, sequence_no) [unique]
    sub_ledger_balance_id
  }
}

// RECLASSIFICATION — REKLASIFIKASI OPEN ITEM: value moved out of one
// subject-book position (book x Partner x currency) into another — another
// book, another Partner, or both — with NO cash moving. Built to clear the two
// Belum Teridentifikasi holding books once the money's place is known, and
// open to any book to any book: a category that names a Partner is all a book
// is. Each line names a target; the target is posted as if the original
// movement had been classified into it. A target running the same way OPENS one
// item per source item at that item's own kurs and base (no difference can
// arise); one running the other way has items SETTLED, chosen by the user, and
// each settled item states its own FX difference on its own journal line. It
// reclassifies items in the books, never a Budget (rule 26).
table fin_item_reclass {
  id                          int [pk, increment, not null]

  // RKL-0001.
  reclass_no                  varchar(255) [not null, unique]
  // Chosen on the draft, any day up to today; Post dates everything by it.
  accounting_date             date
  posted_at                   timestamptz

  // The source Partner's Company, derived rather than picked.
  company_id                  int [not null, ref : > sys_company.id]
  // The source position: one book (a Budget Category), one Partner, one
  // currency. Every target is in the same currency.
  budget_category_id          int [not null, ref : > sys_budget_category.id]
  partner_id                  int [not null, ref : > m_partner.id]
  currency_id                 int [not null, ref : > ref_currency.id]

  // Sum of the lines.
  reclass_amount              decimal(18,2) [not null]
  // What the source items released, in base. Written at Post.
  reclass_base_amount         decimal(18,2) [not null, default: 0]
  // Sum of every settled target item's difference, signed as a gain.
  // Informational — each is journalled on its own line. Written at Post.
  fx_difference               decimal(18,2) [not null, default: 0]

  note                        text

  status                      enum('Draft', 'Pending', 'Posted', 'Cancelled') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    company_id
    partner_id
    status
  }
}

// One target, and the source items it takes. A source can be split across
// lines — part Hutang, part Titipan.
table fin_item_reclass_line {
  id                          int [pk, increment, not null]

  reclass_id                  int [not null, ref : > fin_item_reclass.id]
  sequence_no                 int [not null]

  // A category that keeps a book, and a Partner it admits. Never the source
  // position itself.
  target_budget_category_id   int [not null, ref : > sys_budget_category.id]
  target_partner_id           int [not null, ref : > m_partner.id]

  // Why the value moved; the note on what the line writes.
  description                 text

  // > 0 (CHECK); the sum of the line's source items.
  amount                      decimal(18,2) [not null]
  // Written at Post: what the source items released, and the sum of the
  // settled target items' differences (zero where the target opens items).
  released_base_amount        decimal(18,2) [not null, default: 0]
  fx_difference               decimal(18,2) [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (reclass_id, sequence_no) [unique]
    target_partner_id
  }
}

// One source item a line moves, chosen and stated by the user.
table fin_item_reclass_line_source {
  id                          int [pk, increment, not null]

  line_id                     int [not null, ref : > fin_item_reclass_line.id]
  sequence_no                 int [not null]
  // sub_ledger_balance.id — a plain id: the item is the subject book's.
  sub_ledger_balance_id       int [not null]

  // > 0 (CHECK), never more than the item holds across the document.
  amount                      decimal(18,2) [not null]
  // Written at Post: what the item released at its own kurs, and the target
  // item it became where the target opens items — the clearing link from the
  // held item to where it went (sub_ledger_balance.id, plain id).
  released_base_amount        decimal(18,2) [not null, default: 0]
  opened_item_id              int

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (line_id, sub_ledger_balance_id) [unique]
    (line_id, sequence_no) [unique]
    sub_ledger_balance_id
    opened_item_id
  }
}

// One target item a line settles, where the target book runs the other way.
// A line's target amounts add up to its source amount exactly.
table fin_item_reclass_line_target {
  id                          int [pk, increment, not null]

  line_id                     int [not null, ref : > fin_item_reclass_line.id]
  sequence_no                 int [not null]
  // sub_ledger_balance.id — a plain id.
  sub_ledger_balance_id       int [not null]

  // > 0 (CHECK), never more than the item holds across the document.
  amount                      decimal(18,2) [not null]
  // Written at Post: this item's share of what the line's source items
  // released (a line's shares add up to its released_base_amount), what the
  // item released at its own kurs, and the gap, signed as a gain.
  allocated_base_amount       decimal(18,2) [not null, default: 0]
  settlement_base_amount      decimal(18,2) [not null, default: 0]
  fx_difference               decimal(18,2) [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (line_id, sub_ledger_balance_id) [unique]
    (line_id, sequence_no) [unique]
    sub_ledger_balance_id
  }
}

table fin_funding_request {
  id                          int [pk, increment, not null]

  funding_request_no          varchar(255) [not null, unique]

  request_date                date [not null]

  transaction_id              int [not null, ref : > fin_cash_bank_transaction.id]

  currency_id                 int [not null, ref : > ref_currency.id]

  request_amount              decimal(18,2) [not null]

  provider_cash_bank_id       int [ref : >? m_cash_bank.id]
  // The rate layer the confirmation drew on, where foreign currency left a
  // foreign resource. A plain id like fin_cash_bank_transaction.cash_bank_layer_id:
  // the layer is mutable, so the document that consumed it keeps which one.
  provider_cash_bank_layer_id int

  status                      enum('Open', 'Closed', 'Cancelled') [not null, default: 'Open']

  note                        text

  confirmed_at                timestamptz
  confirmed_by                int

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    status
    transaction_id
  }
}

//----------------------------------
// Penyesuaian Open Item Table
//----------------------------------

// The adjustment document for a Partner's standing position in a subject book.
// It replaced Debit / Credit Note (migration 20261015090000_item_adjustment
// renamed fin_dncn in place); notes posted before keep their DN- / CN-
// numbers. No cash moves: Post writes Adjustment entries in sub_ledger and one
// balanced journal, in one transaction, and touches no Cash Bank Book, no rate
// layer and no Budget.
//
// It changes existing open items of one position (book x Partner x currency)
// and never opens one — what mainstream ERP calls a Debit Note (Penambahan,
// Increase) and a Credit Note (Pengurangan, Decrease) against an invoice; SIBA
// keeps no invoice, so the item is what it references. Every line names its
// items, each for the amount the user stated, and each moves at its own kurs as
// a new ledger line on the same item, so no FX difference arises and no kurs
// is typed. Only an Open item may be adjusted. Which side of the journal that is follows from the
// book's own `raises`. The counter side is the Company's Pendapatan
// Penyesuaian account when credited, Beban Penyesuaian when debited.
//
// Valued when the draft is saved and again at Post, under a transaction-scoped
// advisory lock on the position.

table fin_item_adjustment {
  id                          int [pk, increment, not null]

  // PYO-0001; DN- / CN- for documents posted as Debit / Credit Notes.
  adjustment_no               varchar(255) [not null, unique]

  // accounting_date is chosen on the draft, up to today, and dates what Post
  // writes; posted_at stays null until Post runs.
  accounting_date             date
  posted_at                   timestamptz

  // The Partner's Company, derived rather than picked.
  company_id                  int [not null, ref : > sys_company.id]

  // The book: a Budget Category carrying allows_item_adjustment.
  budget_category_id          int [not null, ref : > sys_budget_category.id]

  partner_id                  int [not null, ref : > m_partner.id]

  // The position's currency.
  currency_id                 int [not null, ref : > ref_currency.id]

  // Null: every item moves at its own kurs. Documents posted while a raise
  // opened a new item at a typed kurs keep the 1 they carried.
  exchange_rate               decimal(18,6)

  // The net change: what the lines raise less what they lower, so negative
  // when the document lowers the position on balance. The same in base,
  // valued when the draft is saved and again at Post.
  adjustment_amount           decimal(18,2) [not null]
  adjustment_base_amount      decimal(18,2) [not null, default: 0]

  // The counterparty's own document number, where there is one.
  reference                   varchar(255)

  note                        text

  status                      enum('Draft', 'Pending', 'Posted', 'Cancelled') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    company_id
    partner_id
    status
  }
}

// One reason, and the open items it adjusts. The journal writes a Partner line
// and a counter line per document line, so the General Ledger reads back to the
// reason. The amount is the sum of the line's items.
table fin_item_adjustment_line {
  id                          int [pk, increment, not null]

  adjustment_id               int [not null, ref : > fin_item_adjustment.id]

  sequence_no                 int [not null]

  // Written by the system — "Penambahan USD 200,00 atas SBI-0012".
  description                 varchar(255) [not null]

  // The item adjusted. A plain id: the item belongs to the subject-book
  // module. Null only on documents posted while a raise opened a new item.
  sub_ledger_balance_id       int

  // The sign of the difference, never chosen.
  effect                      enum('Increase', 'Decrease') [not null]

  // What the item held when the draft was saved, and the value typed for it.
  // Post refuses an item that no longer holds balance_before. Null on
  // documents posted before a line was stated as a new value.
  balance_before              decimal(18,2)
  new_amount                  decimal(18,2)

  // The difference, unsigned; effect says which way.
  amount                      decimal(18,2) [not null]
  // At the item's own kurs.
  base_amount                 decimal(18,2) [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (adjustment_id, sequence_no) [unique]
    sub_ledger_balance_id
  }
}

// Revaluasi Kurs: one foreign Cash & Bank restated at a kurs the user states,
// raised by a user — never by a period close. Post closes every open layer of
// the resource, opens one layer of the whole balance at the stated kurs,
// writes one base-only Cash Bank Book entry (Revaluation) and journals the
// difference on the Company's fx_revaluation account. Reads the layers as they
// stand when posted. Final: a wrong kurs is corrected by another revaluation.
table fin_cash_bank_revaluation {
  id                          int [pk, increment, not null]

  // RVK-0001.
  revaluation_no              varchar(255) [not null, unique]

  accounting_date             date
  posted_at                   timestamptz

  // Derived from the resource.
  company_id                  int [not null, ref : > sys_company.id]
  cash_bank_id                int [not null, ref : > m_cash_bank.id]
  currency_id                 int [not null, ref : > ref_currency.id]

  // The kurs the user states as current — an input.
  exchange_rate               decimal(18,6) [not null]

  // Valued when the draft is saved and again at Post.
  foreign_balance             decimal(18,2) [not null, default: 0]
  base_before                 decimal(18,2) [not null, default: 0]
  base_after                  decimal(18,2) [not null, default: 0]
  // base_after − base_before: positive a gain, negative a loss.
  fx_difference               decimal(18,2) [not null, default: 0]

  // The layer Post opened. A plain id: the layer belongs to the Cash Bank Book.
  opened_layer_id             int

  note                        text
  status                      enum('Draft', 'Pending', 'Posted', 'Cancelled') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    company_id
    cash_bank_id
    status
  }
}

// One layer a posted revaluation closed, as it stood when closed. Written at
// Post only; a layer is closed by at most one revaluation.
table fin_cash_bank_revaluation_layer {
  id                          int [pk, increment, not null]

  revaluation_id              int [not null, ref : > fin_cash_bank_revaluation.id]
  sequence_no                 int [not null]

  // cash_bank_layer.id, a plain id like every other layer reference.
  cash_bank_layer_id          int [not null, unique]

  rate                        decimal(18,6) [not null]
  foreign_amount              decimal(18,2) [not null]
  base_amount                 decimal(18,2) [not null]

  created_by                  int [not null]
  created_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    revaluation_id
  }
}

//----------------------------------
// Audit Table
//----------------------------------

table audit_log {
  id                          int [pk, increment, not null]

  entity_key                  varchar(255) [not null]
  row_id                      int [not null]

  action                      enum('TAMBAH', 'UPDATE', 'HAPUS') [not null]
  event                       varchar(255)

  at                          timestamptz [not null, default: `transaction_timestamp()`]
  by                          int [not null]

  indexes {
    (entity_key, row_id)
  }
}
```
