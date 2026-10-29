# SIBA 3.0 — A Partner without a book, and a Partner filter on the General Ledger

Jurnal Umum / Journal Replacement is set aside for this work (see §5).

## 1. Decisions (user, 29/10/2026)

| # | Decision |
|---|---|
| P1 | The General Ledger takes **several Partners** (`?partner=3,7`, `MultiSelect`). Every account shows only lines tagged with those Partners, its opening filtered the same way. None chosen = no filter |
| P2 | A Budget Category gains a **Buku Subjek** toggle, offered only when *Memakai Partner* is on. A book exists when the category names a Partner **and** is a book **and** says which way it runs |
| P3 | A category with a Partner and no book is a **partner tag**: Klasifikasi still picks a Partner, the account is still Company × Category × the Partner's Partner Category, and Realisasi journals the counter line with the Partner and writes **no** `sub_ledger` entry and no open item |
| P4 | One account may **not** hold a book category and a partner-only category together |
| P5 | The toggle is locked once any Budget is classified into the category |
| P6 | Deviation check answered **B**: revise KB `accounting/subject-books` §1 for every project |

## 2. Gap analysis

| # | Today | Gap |
|---|---|---|
| 1 GL Partner filter | `generalLedgerReport(accountIds, range, companyIds)` and `ledgerEntriesPage` read every line; the snapshot is already at `(account, partner?)` grain | Parameter, picker, and a `partner_id in (…)` on the opening scan, the snapshot read, the movement sum, the entry pages and the export |
| 2 Book toggle | `keepsBook(row) = require_partner && raises` (`subledger-catalogue.ts:99`); `raises` mandatory whenever `require_partner` (rule 93, CHECKs) | New column; `keepsBook` reads it; `raises`, `book_icon`, `book_closing_label`, `allows_item_adjustment` move under it |
| 3 Account for a partner-only category | Resolution is already Company × Category × Partner Category (`categoryAccount`), and Klasifikasi already demands a Partner when `require_partner`. But `checkAccountLedger` refuses a partner category with no book ("belum menyebut arah bukunya") | Accept it; refuse mixing (P4) |
| 4 Klasifikasi shows the effect | `ClassifyDialog` shows *Account tujuan* only | Add the item effect beside it |
| 5 Realisasi | `finance-plan.ts:434` already writes a book only when `subledgerForCategory` finds one, and line 551 already tags the counter line with `budget.partner_id` | Nothing structural — it follows from step 2. Needs a test |

## 3. Steps

Each ends green on `npm run build`, `npm run lint`, `npm test`.

| Step | Work | Done when |
|---|---|---|
| **1 Schema** | Migration: `sys_budget_category.keeps_book boolean not null default false`; backfill `true` where `require_partner and raises is not null` (the six books and the two holding categories keep theirs). CHECKs: `keeps_book → require_partner`; `raises` set **iff** `keeps_book` (replaces the `require_partner` one); `allows_item_adjustment → keeps_book` (replaces `…_needs_book`). `schema.prisma` comment, `SIBA DBML.md`. Seed: seeded book categories carry `keeps_book: true` | `migrate dev` clean; existing categories read the same books |
| **2 Catalogue + form** | `keepsBook` reads `keeps_book`; `BookSource` gains it; `loadSubledgers` selects it. Registry (`entities.ts`): `keeps_book` bool, `visibleWhen require_partner`, listed after it; `raises`, book fields and `allows_item_adjustment` `visibleWhen keeps_book` (hidden, not waiting — they don't apply). `derivedColumns` (`master.ts`): clearing `require_partner` clears `keeps_book`; clearing `keeps_book` clears `raises` / book fields / adjustment; `categoryChoosesRaises` asks only when `keeps_book`. Lock (P5): `keeps_book` refused to change when `budgetCountByCategory` > 0 — `lockNote` / `Terkunci` chip on edit. Category list: book column says *Tanpa buku* for a partner tag, distinct from *arah belum diatur* | `tests/budget-category.test.ts`: round trip, the three CHECKs, the lock; `tests/subledger.test.ts`: a partner-tag category keeps no book |
| **3 Accounts (P3, P4)** | `checkAccountLedger` (`records.ts:592`): a partner category without a book is admitted (pairing check still applies); a set mixing book and partner-only categories is refused by name ("… memegang Buku Subjek, … tidak"). `categoriesTakePartner` unchanged | `tests/accounting.test.ts`: partner-only account saves; mixed set refuses |
| **4 Klasifikasi effect** | `ClassifyDialog`: beside *Account tujuan*, one line read from the client-safe catalogue and the selection's direction via `subledgerMovement` — **Membuka open item di Buku X** / **Menyelesaikan open item Buku X** (needs one at Realisasi) / **Menambah rincian Buku X** (cumulative) / **Tanpa open item — journal ditandai Partner**. Page passes `booksFrom(...)` down. Shown for the selection, never prefilled | Seen in the browser on each of the four cases; `ui-audit` against the current dialog |
| **5 Realisasi** | No code expected. Check the Rincian dialog and `BudgetPicker` show no Open Item column for a partner tag (`bookEffect` already returns null) | `tests/finance.test.ts`: a Realisasi on a partner-tag Budget posts a journal counter line with the Partner, writes no `sub_ledger` row, `reconcile-books` stays clean |
| **6 GL Partner filter** | `report-params.ts` / `reports.ts`: `account-period` gains `partner`. Filter bar: `MultiSelect` of the Company's Partners (narrowed to the chosen accounts' Partner Categories where they have one). `ledger.ts`: `generalLedgerReport` and `ledgerEntriesPage` (+ `loadLedgerEntries` action) take `partnerIds?: number[]`, applied to the scan, the snapshot lines and the sums. `ledger-export.ts` and the export route pass it; the title block states the Partners. An account with no matching line still shows its (filtered) opening and closing (Report View rule 5) | `tests/ledger-opening.test.ts`: filtered opening equals the filtered full scan at the three boundaries; `tests/reports.test.ts`: two Partners' filtered runs add up to the unfiltered one |
| **7 Docs + KB** | CLAUDE.md: §1 status, rules 52, 93, 99, 115 (Reklasifikasi: "any category that keeps a book"), the frozen *A subject book is a Budget Category*, the GL decision (Partner filter), §14. KB `subject-books` §1 revised per PROTOCOL (version bump, changelog, `REGISTRY.md`, `KNOWLEDGE.md` row) | `kb-check` reports ok |
| **8 Verify** | `db:seed`, `db:seed-showcase` (add one partner-tag category and Budget, believable description), `db:reconcile`; browser: category form toggles, account form, Klasifikasi, Realisasi Post, GL with Partners + export | All agree |

## 4. Risks

- **Existing data**: backfill keeps every current book a book; a category with `require_partner` and no `raises` (a setup gap today) becomes a partner tag — check Neon for any before migrating.
- **Reports keyed on "names a Partner"**: Reklasifikasi target lists, Penyesuaian / Pencairan book pickers and the dashboard's Posisi Buku Subjek all go through `loadSubledgers`, so a partner tag drops out of them automatically. Grep for `require_partner` used as "has a book" outside the catalogue during step 2.

## 5. Deferred: Jurnal Umum

`general-journal-ledgers.ts:117–137` demands an open item on every line of a Kategori account that carries a Partner Category. Until it is adapted, a Jurnal Umum line on a partner-only account is refused ("Pilih open item…"); Realisasi is unaffected. The fix is one branch: no book → Partner required, no item. To land with the Journal Replacement.
