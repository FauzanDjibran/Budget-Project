# SIBA 3.0 — Mapping Budget ke Account back; the account names only its ledger

Supersedes Journal 2.0 D21, D24 and D25 (account holds its Budget Categories,
Mapping is gone) and P4 of `Partner Without Book - Plan.md` (no book beside a
partner tag on one account).

## 1. Decisions (user, 29/10/2026)

| # | Decision |
|---|---|
| M1 | The account says only its **ledger**: Tanpa · Kategori · Kas & Bank. Its Partner Category and the categories it holds (`acc_account_book`) go |
| M2 | **Mapping Budget ke Account comes back**: Company × Budget Category × Partner Category (or none) → one account, its own menu under Accounting › Mapping |
| M3 | **Any number of mappings may name one account**, whatever the category: a book (Piutang), a partner tag (Piutang (n) — Partner, no open item), a category without a Partner, a Hutang beside a Piutang. The account's balance may go negative; accepted |
| M4 | A mapping's target must be a **Kategori** account, postable, active, a leaf, of the mapping's Company. Kategori stays a control account (reached only through a mapping) |
| M5 | Whether a line needs a Partner or an open item comes from the **Budget Category**, never the account |
| M6 | An account mixing booked and unbooked categories no longer equals its book in the GL. Accepted; how to filter it is to be discussed later |
| M7 | KB revised for every project (option **B**): subject-books drops "an account holds books or partner tags, never both"; SIBA's chart-of-accounts D25 exception row is rewritten to the mapping shape |

## 2. Gap analysis

| Area | Today (D25) | After |
|---|---|---|
| Schema | `acc_account.partner_category_id`, `acc_account_book` | `acc_budget_category_account` (old shape, unique on the three keys `NULLS NOT DISTINCT`); the other two dropped |
| Resolver | `category-accounts.ts` reads `acc_account_book` × the account's Partner Category | Same API (`categoryAccounts`, `categoryAccount`), reads the mapping. Realisasi, Funding, Penyesuaian, Pencairan, Reklasifikasi, Klasifikasi's *Account tujuan* and `budgetMappings` keep working unchanged |
| Account form | Ledger, Kategori set, Partner Category; `checkAccountLedger` holds one account per key and refuses mixing | Ledger only. Ledger locked once the account has a journal line (unchanged), and may not leave Kategori while a mapping names it — refusal names the mappings |
| Mapping menu | Gone | Registry entity restored from `d6323b1^` (fields, columns, `MAPPING_*` permissions, nav entry, `validateMapping`), target narrowed to Kategori accounts (M4) |
| Partner rule on journal lines | `accountTakesPartner` = Kategori with a Partner Category; GL / Journal flag a line missing one | A Kategori account *may* carry a Partner; only a Partner on a Tanpa or Kas & Bank line is flagged. The "missing Partner" warning goes (M5) |
| Jurnal Umum | Buku Subjek / Kategori line finds its account from the account's books and Partner Category (D21) | The line names its Budget Category, then the Partner where the category takes one; the account is the mapping's. Partner tag: Partner, no item. No-Partner category: neither. Booked: as today |
| Manual journal | Branch requiring a Partner on a Kategori account | Removed — it cannot touch a Kategori account anyway |
| `db:reconcile` check 14 | Book = GL per account and Partner | Reads the mapping; **skips an account any unbooked category maps to** (M6), and says so in its name |
| Showcase seed, test helpers | Create `acc_account_book` rows | `makeMapping` / showcase write mapping rows; `makeAccount` loses `partnerCategoryLabel` / `bookLabels` |
| `npm run db:seed` | — | Unchanged: mappings are business data |

## 3. Steps

Each ends green on `npm run build`, `npm run lint`, `npm test` (the 53 tests
already failing on `main` are a separate fixture problem; this work should
fix the ones caused by D25 fixtures and add no new failures).

| Step | Work |
|---|---|
| 1 Schema | Migration: create `acc_budget_category_account`, carry every active `acc_account_book` row × its account's Partner Category into it, drop `acc_account_book` and `acc_account.partner_category_id`. `schema.prisma` relations, `SIBA DBML.md` |
| 2 Resolver + menu | `category-accounts.ts` on the mapping; registry entity, permissions, `entity-access`, nav; `validateMapping` in `master.ts`; `refOptions` filters `admittedPartnerCategory` and `categoryAccount`; mapping list's Normal column |
| 3 Account | Strip book and Partner Category fields, predicates and `checkAccountLedger`'s category rules; add the "still mapped" refusal |
| 4 Partner rule | `accountTakesPartner` → "may carry a Partner" (Kategori); `partnerMismatch` keeps only `unexpected`; GL rollup, `journal.ts`, `manual-journal.ts`, account list column |
| 5 Jurnal Umum | `general-journal-ledgers.ts` category adapter checks via the mapping and the category; `general-journal-rows.ts` sends mappings instead of `bookIds` / `partnerCategoryId`; the form resolves the account from category + Partner; `general-journal.ts` stops loading books |
| 6 Scripts + tests | `reconcile-books.ts` check 14; `seed-showcase.ts`; `tests/helpers.ts`; adjust `accounting`, `finance`, `general-journal`, `item-reclass`, `manual-journal` tests; add: two categories (Piutang, Piutang (n)) mapped to one account both post there, the tag writing no `sub_ledger` |
| 7 Neon | `db:neon-migrate`, `db:neon-seed`; nothing to re-enter if the carry-over finds every current account's categories |
| 8 Docs | CLAUDE.md (D25-era text in §1, §10 rules 16, 28, 50, 52, 79, §12 control-account and manual-journal decisions, §14), `Journal 2.0 - Plan.md` (D21/D24/D25 marked superseded), KNOWLEDGE.md, KB subject-books and the chart-of-accounts exception row; commit |

## 4. Risks

- A Neon account holding categories with no Partner Category set, or a book
  split oddly, carries over as-is; the migration refuses on a duplicate key
  rather than guessing.
- Jurnal Umum is the largest edit (form + adapter); its suite is the check.
- With M3, Saldo Buku Subjek and the GL disagree on mixed accounts until the
  filter in M6 is designed.
