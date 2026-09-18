# SIBA 3.0 — Database DBML

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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
}

table sys_permission {
  id                          int [pk, increment, not null]

  permission_code             varchar(255) [not null, unique]
  permission_name             varchar(255) [not null]

  module                      varchar(255) [not null]
  description                 text

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    module
  }
}

table sys_user_role {
  id                          int [pk, increment, not null]

  user_id                     int [not null, ref : > sys_user.id]
  role_id                     int [not null, ref : > sys_role.id]

  created_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

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
  last_seen_at                timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  revoked_at                  timestamptz

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    user_id
    expires_at
  }
}

table sys_setting {
  id                          int [pk, increment, not null]

  setting_key                 varchar(255) [not null, unique]
  setting_value               text

  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
}

table sys_account_type {
  id                          int [pk, increment, not null]

  type_code                   varchar(255) [not null, unique]

  type_label                  varchar(255) [not null, unique]
  type_name                   varchar(255) [not null]

  note                        text

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
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
  // The book's own key is this row's `category_code`, which is what
  // `sub_ledger.book` holds. Its name, its subject line and whether its closing
  // figure is a position or a running total are all derived — see
  // `src/lib/siba/subledger-catalogue.ts`.
  raises                      enum('In', 'Out')
  book_icon                   varchar(255)
  book_closing_label          varchar(255)

  note                        text

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
}

// A Transaction Purpose: exactly one Budget Category x one Partner Category x
// one direction, which is what lets it resolve to a single account.
//
// These were 22 constants in src/lib/siba/rules.ts. They are rows because the
// Budget Categories they classify are rows: a category created through the GUI
// that no Purpose named could be planned and booked but never transacted.
//
// Generated, not authored. The original 22 were exactly the cross product of
// the categories, their admitted Partner Categories and their directions, so
// syncPurposes derives the rows and nothing creates one by hand. What a person
// edits is the label, and the generator never overwrites it.
table sys_purpose {
  id                          int [pk, increment, not null]

  // What a document stores in fin_cash_bank_transaction.purpose. Opaque and
  // immutable: the original 22 keep their historical mnemonics (TTP_CAB_IN) and
  // generated ones carry a system code. Nothing parses it.
  purpose_key                 varchar(255) [not null, unique]

  budget_category_id          int [not null, ref : > sys_budget_category.id]
  // Null where the Purpose takes no Partner — Asset and Biaya.
  partner_category_id         int [ref : > sys_partner_category.id]
  direction                   enum('In', 'Out') [not null]

  // The Indonesian sentence naming the business event, not the classification.
  // Editable, and the only field that is.
  label                       varchar(255) [not null]

  note                        text

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    (budget_category_id, partner_category_id, direction) [unique]
    partner_category_id
  }
}

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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

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

  entry_date                  date [not null]
  entry_type                  enum('Opening', 'Transaction', 'Adjustment') [not null]
  direction                   enum('In', 'Out') [not null]

  amount                      decimal(18,2) [not null]
  movement                    decimal(18,2) [not null]
  balance_after               decimal(18,2) [not null]

  rate                        decimal(18,6) [not null]
  base_amount                 decimal(18,2) [not null]
  base_movement               decimal(18,2) [not null]
  base_balance_after          decimal(18,2) [not null]

  source_doc_type_id          int [ref : >? sys_doc_type.id]
  source_doc_id               int

  note                        text

  created_by                  int [not null]

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    (cash_bank_id, entry_date)
    (source_doc_type_id, source_doc_id)
  }
}

table cash_bank_balance {
  cash_bank_id                int [pk, not null, ref : - m_cash_bank.id]

  balance                     decimal(18,2) [not null, default: 0]
  base_balance                decimal(18,2) [not null, default: 0]

  entry_count                 int [not null, default: 0]

  last_entry_id               int
  last_entry_date             date

  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
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

  status                      enum('Open', 'Exhausted', 'ClosedByRevaluation') [not null, default: 'Open']

  source_doc_type_id          int [ref : >? sys_doc_type.id]
  source_doc_id               int

  note                        text

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

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

  book                        varchar(255) [not null]

  partner_id                  int [not null, ref : > m_partner.id]
  currency_id                 int [not null, ref : > ref_currency.id]

  entry_date                  date [not null]
  entry_type                  enum('Opening', 'Transaction', 'Adjustment') [not null]
  direction                   enum('In', 'Out') [not null]

  amount                      decimal(18,2) [not null]
  movement                    decimal(18,2) [not null]
  balance_after               decimal(18,2) [not null]

  rate                        decimal(18,6) [not null]
  base_amount                 decimal(18,2) [not null]
  base_movement               decimal(18,2) [not null]
  base_balance_after          decimal(18,2) [not null]

  source_doc_type_id          int [ref : >? sys_doc_type.id]
  source_doc_id               int

  note                        text

  created_by                  int [not null]

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    (book, partner_id, entry_date)
    (source_doc_type_id, source_doc_id)
  }
}

table sub_ledger_balance {
  id                          int [pk, increment, not null]

  book                        varchar(255) [not null]

  partner_id                  int [not null, ref : > m_partner.id]
  currency_id                 int [not null, ref : > ref_currency.id]

  balance                     decimal(18,2) [not null, default: 0]
  base_balance                decimal(18,2) [not null, default: 0]

  entry_count                 int [not null, default: 0]

  last_entry_id               int
  last_entry_date             date

  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    (book, partner_id, currency_id) [unique]
    book
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

  note                        text

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

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

  require_partner             boolean [not null, default: false]
  partner_category_id         int [ref : >? sys_partner_category.id]

  is_control_account          boolean [not null, default: false]

  note                        text

  is_active                   boolean [not null, default: true]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    (company_id, account_label) [unique]
    company_id
    account_subcategory_id
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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    (company_id, budget_category_id, partner_category_id) [unique]
    company_id
  }
}

table acc_fiscal_year {
  id                          int [pk, increment, not null]

  year_code                   varchar(255) [not null, unique]

  year_label                  varchar(255) [not null]
  year_name                   varchar(255) [not null]

  start_date                  date [not null]
  end_date                    date [not null]

  note                        text

  status                      enum('Draft', 'Open', 'Closed') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
}

table acc_fiscal_period {
  id                          int [pk, increment, not null]

  fiscal_year_id              int [not null, ref : > acc_fiscal_year.id]
  sequence_no                 int [not null]

  period_code                 varchar(255) [not null, unique]

  period_label                varchar(255) [not null]
  period_name                 varchar(255) [not null]

  start_date                  date [not null]
  end_date                    date [not null]

  note                        text

  status                      enum('Draft', 'Open', 'Closed') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    fiscal_year_id
  }
}

table acc_journal {
  id                          int [pk, increment, not null]

  journal_no                  varchar(255) [not null, unique]
  posting_date                date

  source_doc_type_id          int [ref : >? sys_doc_type.id]
  source_doc_id               int

  company_id                  int [not null, ref : > sys_company.id]

  description                 text [not null]

  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Posted']
  is_manual                   boolean [not null, default: false]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    (company_id, posting_date)
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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    journal_id
    account_id
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

  category_id                 int [ref : >? sys_budget_category.id]
  partner_id                  int [ref : >? m_partner.id]

  description                 text [not null]

  budget_amount               decimal(18,2) [not null]
  realized_amount             decimal(18,2) [not null, default: 0]

  status                      enum('Draft', 'Cancelled', 'Submitted', 'Rejected', 'Open', 'Closed') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    company_id
    status
    budget_date
  }
}

//----------------------------------
// Finance Table
//----------------------------------

table fin_cash_bank_transaction {
  id                          int [pk, increment, not null]

  transaction_no              varchar(255) [not null, unique]
  document_date               date
  posting_date                timestamptz

  transaction_type            enum('In', 'Out') [not null]

  company_id                  int [not null, ref : > sys_company.id]

  purpose                     varchar(255) [not null]

  cash_bank_id                int [ref : >? m_cash_bank.id]

  currency_id                 int [not null, ref : > ref_currency.id]
  exchange_rate               decimal(18,6) [not null, default: 1]

  cash_bank_layer_id          int

  partner_id                  int [ref : >? m_partner.id]

  transaction_amount          decimal(18,2) [not null]
  transaction_base_amount     decimal(18,2) [not null]

  note                        text

  status                      enum('Draft', 'Pending', 'Posted', 'Cancelled') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

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

  fx_difference               decimal(18,2) [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    (transaction_id, sequence_no) [unique]
    (source_doc_type_id, source_doc_id)
  }
}

table fin_cash_bank_transfer {
  id                          int [pk, increment, not null]

  transfer_no                 varchar(255) [not null, unique]
  document_date               date
  posting_date                timestamptz

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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

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

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    (transfer_id, sequence_no) [unique]
    to_cash_bank_id
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

  status                      enum('Open', 'Closed', 'Cancelled') [not null, default: 'Open']

  note                        text

  confirmed_at                timestamptz
  confirmed_by                int

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at                  timestamptz [not null, default: `CURRENT_TIMESTAMP`]

  indexes {
    status
    transaction_id
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

  at                          timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  by                          int [not null]

  indexes {
    (entity_key, row_id)
  }
}
```
