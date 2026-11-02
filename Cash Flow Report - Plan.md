# SIBA 3.0 — Laporan Arus Kas

A per-currency, direct-method cash-flow report read from `cash_bank_ledger`
alone. Each ledger row knows its own classification, written at Post; the report
never reads a source document. Printed examples (Neon's Partners, Budget
Categories and Cash & Banks, dummy amounts):
`Example report/SIBA export sample/Laporan Arus Kas ABHC IDR|USD 2026-01 - 2026-03 (contoh).xlsx`.

## 1. Decisions (user, 02/11/2026)

| # | Decision |
|---|---|
| C1 | `cash_bank_ledger` gains `partner_id`, `budget_category_id` and `cashflow_group_id`, written by every posting path at Post. No reference to a source document is used to classify a row |
| C2 | The groups are rows the user edits: **`sys_cashflow_group`** (code, label, name, `sort_order`, status), a registry entity under Pengaturan › Klasifikasi beside Budget Category and Partner Category. Seeded with Operasional · Investasi · Lain-lain once, never overwritten; deactivated, never deleted |
| C3 | Which group a Budget Category, and an entry type without one, falls in is set on **Mapping Cash Flow** — Accounting › Mapping, beside Mapping Budget ke Account. One page, two sections: every Budget Category, and the four entry types (Funding, Pencairan, Beli Valas, Journal). A Realisasi entry carries its Budget's category's group **as mapped at Post**; a later change of the mapping applies to later postings only, so a reported period never changes meaning |
| C4 | `entry_type` is **one value per source, no direction** (deviation check answered **A**; KB `books-and-posting` §2.3 "the sign is the direction" kept). Penerimaan / Pengeluaran is the sign of `movement` |
| C5 | Row name: **Funding → "Intercompany (SBTC)"**, one line; otherwise the Partner (`label – name`, the name alone when they match); otherwise the Budget Category; otherwise the entry type. Order inside a block: Partners, categories, entry types, Intercompany |
| C6 | PSAK 207 direct method: per group, gross receipts, gross payments in brackets, *Arus Kas Neto dari Aktivitas …*; then *Kenaikan (Penurunan) Neto* and *Saldo Akhir*. **Saldo Awal on top**, stated once. A group with no movement still prints, at nil |
| C7 | Filter: Company (hidden with one option) → **Mata Uang** → Tahun Buku → Periode awal → Periode akhir. One column per period plus *Jumlah*. Only that currency's Cash & Banks, face value, never converted |
| C8 | Fold per group (Buka / Tutup Semua); the Partner is the smallest detail. A folded group states its *Arus Kas Neto* only. The export prints fully open |
| C9 | Category groups confirmed: **Operasional** — Biaya, Piutang (N), Hutang (N), Penerimaan / Pengeluaran Belum Teridentifikasi; **Investasi** — Asset, Investasi, Hasil Investasi, Piutang; **Lain-lain** — Hutang, Titipan, Prive. The four entry types start on Lain-lain |
| C10 | The report is named **Laporan Arus Kas** and sits in Finance › Laporan with the other cash reports |

## 2. Entry types

| `entry_type` | Written by | Cash flow? | Group from | Row name |
|---|---|---|---|---|
| `Realization` | Realisasi, direct route (`finance.ts`) | yes | Budget Category | Partner → category |
| `Funding` | Funding confirmation, induk's resource (`finance.ts`, funded route) | yes | default | Intercompany (SBTC) |
| `Transfer` | Cash Bank Transfer, purpose Transfer | **no** | — | not shown (nets to nil in one currency) |
| `Pencairan` | Cash Bank Transfer, purpose Pencairan (both legs) | yes | default | Pencairan Valas |
| `BuyFx` | Cash Bank Transfer, purpose Pembelian Valas (both legs) | yes | default | Pembelian Valas |
| `Conversion` | Pencairan Open Item, both cash legs | yes | Budget Category (its book) | Partner |
| `Journal` | Typed Journal, Kas & Bank line | yes | default | Journal |
| `Register` | Cash & Bank registration opening | **no** | — | in Saldo Awal; dated inside the run, a line *Saldo awal rekening baru* outside the groups |
| `Revaluation` | Revaluasi Kurs (`movement` = 0) | **no** | — | not shown |

`cashflow_group_id` is null exactly for `Transfer`, `Register` and `Revaluation`.
Funding keeps the anak's Budget Category and Partner on the row, for Buku Kas &
Bank; its group is the default, so Intercompany stays one line.

## 3. Settled by recommendation (say so to change)

| # | Point | Taken as |
|---|---|---|
| O2 | Existing ledger rows | One-off backfill (step 5), using the mapping as it stands. Whatever it cannot place reads as **Belum Dikelompokkan**, a `.rwarn`, never dropped |
| O5 | Drill from a figure into Buku Kas & Bank | Step 8, after the report works |
| O6 | A Budget Category, or one of the four entry types, with no mapping | Post refused by name, pointing at Mapping Cash Flow, like a missing account mapping (rule 50); Klasifikasi still allowed (rule 28). The dry run says so first |
| O7 | Deactivating a group a mapping still points at | Refused, naming the mappings — re-point them first (rule 93's "no useless state"). Ledger rows keep their group whatever its status, and the report prints it |
| O8 | One mapping for both Companies | Yes: only the induk holds cash, and a Funding entry on the induk's resource carries the anak's category |

**Still to answer — O3.** KB `books-and-posting` §2.3 lists what a book entry
holds; partner, category and group extend it. **B** (revise the concept for every
project: an optional counterparty classification on a cash-book entry) or **D**
(local exception in `KNOWLEDGE.md`). Needed by step 9 only.

## 4. Steps

Each ends green on `npm run build`, `npm run lint`, `npm test`.

| Step | Work | Done when |
|---|---|---|
| **1 Schema** | Migration: table `sys_cashflow_group` (`id`, `cashflow_group_code` `cfg.0001`, `_label`, `_name`, `sort_order`, `status`, authorship), label unique case-insensitive; table `acc_cashflow_mapping` (`id`, `budget_category_id` unique nullable FK, `entry_type` unique nullable, `cashflow_group_id` FK, authorship), CHECK exactly one of `budget_category_id` / `entry_type`, and `entry_type` only one of the four; `cash_bank_ledger.partner_id` (FK `m_partner`), `budget_category_id` (FK `sys_budget_category`), `cashflow_group_id` (FK `sys_cashflow_group`), index `(cash_bank_id, accounting_date, cashflow_group_id)`. `CashBankEntryType` replaced by the nine values; existing rows mapped in the migration — `Opening` → `Register`, `Revaluation` kept, `Adjustment` → `Journal`, `Transaction` → `Realization` / `Funding` / `Transfer` / `Pencairan` / `BuyFx` / `Conversion` by `source_doc_type_id` and, for a transfer, its purpose. CHECK `entry_type = Revaluation ⇒ movement = 0`. `schema.prisma` comments, `SIBA DBML.md` | `migrate dev` clean on a copy of the showcase; `tests/schema.test.ts` |
| **2 Book writer** | `recordCashBankEntry` (`cash-bank.ts`) takes `type`, `partnerId`, `budgetCategoryId`, `cashflowGroupId`, and throws on a flow type without a group or a non-flow type with one. The book still imports only the kernel — the group arrives as a value. `CashBankEntryType` in `cash-bank.ts` follows the enum | `tests/cash-bank.test.ts` |
| **3 Six callers** | `finance.ts` — Realisasi: the Budget's Partner, category and category's group; funded: `Funding`, the anak's Budget's Partner and category, the default group. `transfer.ts` — purpose → `Transfer` / `Pencairan` / `BuyFx`. `item-conversion.ts` — `Conversion`, the document's Partner and book, the book's group. `general-journal-ledgers.ts` — `Journal`, the default. `cash-bank-revaluation.ts` — `Revaluation`. `cash-bank.ts` registration — `Register`. The group is resolved through `cashflowGroupFor({ budgetCategoryId } | { entryType })` in a new `cashflow-mapping.ts` (`server-only`, owns `acc_cashflow_mapping`), refused by name while unmapped; the dry runs ask it too, so a Post preview says so first | Every posting suite asserts the columns of what it writes, including the dry-run refusal |
| **4 Group master + Mapping Cash Flow** | `sys_cashflow_group` as a registry entity (`entities.ts`, `nav.ts` under Pengaturan › Klasifikasi, `CASHFLOW_GROUP_VIEW / _CREATE / _EDIT / _ACTIVATE / _DEACTIVATE`), list, form and status toggle like Partner Category; deactivation refused while a mapping points at it (O7). **Mapping Cash Flow** at `/accounting/cashflow-mapping`, bespoke like Mapping Account System: two `FormSection`s — every active Budget Category, and the four entry types — each a `Select` of the active groups, saved together by one Server Action under `CASHFLOW_MAPPING_VIEW` / `_EDIT`, audited with an `event`, a `.fnote` saying a change applies to later postings. Nav entry in Accounting › Mapping after Mapping Budget ke Account. Seed: the three groups and the mapping of its own six categories and the four entry types, created only when missing. `seed-showcase.ts` maps the categories it creates | `tests/cashflow-mapping.test.ts`: save round trip, a key outside the catalogue dropped, deactivation refused while mapped, Post refused while unmapped; `tests/design-system.test.ts` nav check |
| **5 Backfill** | `scripts/backfill-cashflow.ts` (`npm run db:backfill-cashflow`), idempotent, run by hand, never by install or CI: fills the three columns on rows still null — Realisasi entries matched to their document's lines in write order (rule 54), funded entries likewise, Pencairan Open Item from its document's Partner and book. Reports each row it could not place | Run on the showcase and on a copy of Neon; `db:reconcile` clean |
| **6 Report** | `reports.ts`: `cash-flow`, `REPORT_CASH_FLOW_VIEW`, a new parameter set (company, currency, fiscal year, period from / to); `nav.ts`: entry **Laporan Arus Kas** in Finance › Laporan (C10). Reader `cashFlowReport` in `cash-bank.ts`: openings from `cash_bank_period`, flows by one `groupBy` over `(cashflow_group_id, partner_id, budget_category_id, entry_type, sign, month)` for the currency's resources, names and `sort_order` from master data, C5 for the row names; every group that is active or carries a movement prints, in `sort_order`. Body on the statements' tree and fold (`useStatementFold`, `StatementNameCell`, `StatementTitle`). Reconciles per column; a non-nil Belum Dikelompokkan is a `.rwarn` with one sentence | `tests/reports.test.ts`: opening + net = closing per column; Transfer and Revaluation absent; IDR and USD never mix; a Partner on both sides stays gross; Funding is one line; null group surfaced; `Register` inside the run reconciles |
| **7 Export** | `cash-flow-export.ts` on `bookSheet`'s page, portrait to four periods and landscape beyond, the shape of the examples; `finance/report/[report]/export` route; Unduh XLSX on the report | Raw-sheet test: no formulas, A4, plain values |
| **8 Drill** | Buku Kas & Bank takes `?partner=&group=&dir=`; every Partner figure of the report is a `Drill` to it for that column's range. `entryKindText` reads `entry_type` | Seen in the browser |
| **9 Docs + KB** | `tests/module-boundaries.test.ts` and CLAUDE.md §3: a block *Cash Flow Mapping* owning `acc_cashflow_mapping` (`cashflow-mapping.ts` + its action); the book reads the group as a value and never imports it. CLAUDE.md: §1 scope and status table, §5 tree, §10 rules (entry type per source; the cash book carries its counterparty classification; the cash-flow layout), §12 frozen decision, §14, §17. `KNOWLEDGE.md` per O3. `reconcile-books.ts`: no flow entry without a group. `truncate-transactions.ts` unaffected (no new document table) | `kb-check` ok |
| **10 Verify** | `db:seed`, `db:seed-showcase`, `db:backfill-cashflow`, `db:reconcile`; browser: Cash Flow Group master, Mapping Cash Flow, the unmapped refusal, each posting path, the report in IDR and USD, the export against the examples; `ui-audit` against the Laba Rugi | All agree |

## 5. Progress (02/11/2026)

| Step | State |
|---|---|
| 1 Schema | Done, committed `7ec6fa3` |
| 2 Book writer | Done — `recordCashBankEntry` stores `partnerId` / `budgetCategoryId` / `cashflowGroupId`, refuses a flow type without a group and a non-flow type with one (`isCashFlow`) |
| 3 Callers | Done — `planPosting` resolves each line's group (Funding via `funded: true`), tolerated on a draft; Transfer / Pencairan Open Item / Journal resolve inside their transaction and treat `CashflowUnmapped` as a refusal. `cashflow-mapping.ts`, `cashflow-catalogue.ts` |
| 4 Group master + Mapping Cash Flow | Done — registry entity `sys_cashflow_group` (Pengaturan › Klasifikasi), `/accounting/cashflow-mapping`, permissions, seed (3 groups, 10 mappings), showcase maps its six categories, fixtures map theirs |
| 5 Backfill | Done — `npm run db:backfill-cashflow`; local: 20 placed, 0 left |
| 6 Report | Done — `cash-flow` in `reports.ts` (`currency-fiscal-range`), Finance › Laporan › Laporan Arus Kas, `REPORT_CASH_FLOW_VIEW`, `cashFlowReport` in `cash-bank.ts`, `CashFlowParams`, `CashFlowReport` on the statements table; `tests/cash-flow.test.ts` |
| 7 Export | Done — `cash-flow-export.ts`, the finance export route |
| 8 Drill | Not done — deferred, needs Partner / group / direction filters on Buku Kas & Bank |
| 9 Docs | Done — CLAUDE.md rules 123–125, module boundary, reconcile check 20, KNOWLEDGE.md queue (B or D pending) |
| 10 Verify | Done — build, lint, `db:reconcile` (19 checks); full suite 967 pass, the only failures the general-journal / accounting fixture guard against the showcase mappings on the local database; browser: IDR and USD runs reconcile in every column, fold, export 200, Mapping Cash Flow, Cash Flow Group |
