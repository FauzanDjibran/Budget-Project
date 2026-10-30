# SIBA 3.0 — Journal Replacement: one journal table, named Journal

The follow-up to `Journal 2.0 - Plan.md` §8, taking **option (b), replacing
the store**: the old `acc_journal` / `acc_journal_line` are dropped, and
`acc_general_journal` / `_line` are renamed into their place. Jurnal Umum is
then simply **Journal** — one table, one menu at `/accounting/journal`, one
register — holding every journal: typed (`JUM-`), posted by a document
(`JRN-`) and closing (`CLS-`). The manual journal (`JUR-`) is retired.

Plan §6 built the new tables as a **superset** of the old ones, same column
names and types, for exactly this — still true after Mapping Restore (checked
30/10/2026). So the Prisma model keeps the name `AccJournal`, the delegate
stays `prisma.accJournal`, and the readers — `ledger.ts`, `opening-balance.ts`,
`closing.ts`, `statements.ts`, `reconcile-books.ts` — do not change. Every
posting path already writes through the one `postJournal` (Realisasi, Funding,
Transfer, Pencairan, Penyesuaian, Reklasifikasi, Revaluasi, closing, Jurnal
Umum).

> **Revised 30/10/2026**, after `Partner Without Book - Plan.md` (partner
> tags) and `Mapping Restore - Plan.md` (the account names only its ledger:
> Tanpa · Kategori · Kas & Bank; many mappings may share an account). What
> changed is marked *(rev)*. The partner-tag branch the first plan deferred
> to this work already landed in adc97ab.

---

## 1. Decisions (user, 29/10/2026)

| # | Decision |
|---|---|
| R1 | **Dissolved.** With one table every journal opens at `/accounting/journal/[id]`, so the General Ledger, the closing screen and every Sumber link keep working with no separate viewer. The databases are cleared after, so no data is carried |
| R2 | **The control account column is gone** *(rev)*. The account's ledger decides what a line demands: a **Kas & Bank** line writes its book; a **Kategori** line must name a Budget Category whose mapping sends it to that account (the category adapter's `notMapped` check), and writes a book only when the category keeps one — a partner tag or a category without a Partner writes the journal alone, with nothing to drift from. A Kategori account is therefore still reached only through its category, as a ledger rule rather than a flag. `is_control_account`, `syncControlAccounts`, `controlAccountReasons`, `structuralControlAccountIds` and `scripts/backfill-account-flags.ts`'s control half go |
| R3 | Keep **`JUM-`** for typed journals, beside `JRN-` and `CLS-` |
| R4 | Retire `JOURNAL_CREATE / _EDIT / _POST / _CANCEL`; rename `JOURNAL_GENERAL_*` → `JOURNAL_*`, deleting the old grants first so no role is silently upgraded |
| R5 | **Drop `acc_journal`, rename `acc_general_journal` to `acc_journal`** (and the lines likewise), dropping `posted_journal_id` |

### Answered 30/10/2026 (user)

- **R6 declined for now**: Journal stays open to every account, engine-owned
  ones included. Restored if trouble shows in use; the risk is recorded in §3.
- **R7 accepted**: Penyesuaian and Reklasifikasi are retired as step 1.
- **R8 now**: the replacement runs before the trial in use.
- **Deviation check: D** for both rows — a local exception, since R6 keeps
  nothing closed.
- Neon and local were both at the latest migration on 30/10/2026; local held
  no transaction. Neon is emptied when it is migrated (step 8), not before.

### Proposed *(rev)*

| # | Proposal | Why |
|---|---|---|
| R6 | **Journal refuses a line on an engine-owned account**: any account a Mapping Account System key names — `bridge_ar` / `bridge_ap`, `fx`, `fx_revaluation`, `accumulated_pl`, `current_pl` — except Journal's own generated Selisih line. One check, `systemAccountIds()` in `system-account-data.ts` (already exists), asked at save and at Post | Today `JUR-` refuses these through `is_control_account`, but **Jurnal Umum already accepts them** (they are Tanpa accounts, and the `none` ledger has no adapter). Retiring `JUR-` would leave nothing guarding them: a typed line could break the intercompany mirror, and a line on Laba/Rugi Tahun Berjalan breaks the frozen rule that nothing posts to it |
| R7 | **Do `Journal 2.0` step 6 first, or as step 1 here**: Penyesuaian and Reklasifikasi Open Item removed (D4), `allows_item_adjustment` and the `adjustment_*` keys dropped | This plan edits the same files (`documentHref`, `document-numbers`, `truncate-transactions`, `module-boundaries`, `DOCUMENT_SCREENS`, `POSTING_FORMS`, CLAUDE.md); doing both together edits each once, and R6 then needs no adjustment-pair exception |
| R8 | **Replace before the trial in use** (Journal 2.0 §7 step 8), or after | §8 put the replacement after the trial. Doing it now removes `JUR-` as the fallback before Jurnal Umum has been used for real work. Accepted risk, or wait — the user's call |

**Deviation check (CLAUDE.md §20) — still open** *(rev)*. KNOWLEDGE.md rows
52 and 53 are both affected:

- Row 52, `books-and-posting` §4: *a manual journal may not touch a control
  account* — SIBA's exception still says the plain `JUR-` refuses one.
- Row 53, `chart-of-accounts` §3, option `derived`: rewritten by Mapping
  Restore to *any ledger but Tanpa is a control account*.

The case for them: a hand-written line that moves the General Ledger without
its book is the one discrepancy nothing ever errors on. After R2 that case is
held by the ledger rule (a Kas & Bank or booked Kategori line writes its book
in the same transaction; a Kategori line goes through its mapping). It still
applies to an engine-owned account, which R6 keeps closed.

Choose: **A** keep the concept, **B** revise both concepts for every project,
**C** a second concept, **D** a local exception (rewrite rows 52 and 53).
Recommended: **A** for engine-owned accounts (R6) and **D** for book
accounts now; **B** after the trial.

---

## 2. Steps

Each step ends green on `npm run build`, `npm run lint`, `npm test`.

| Step | Work | Done when |
|---|---|---|
| **0 Prep** | Answer R6–R8 and the deviation check. Check where Neon stands (`prisma migrate status` through `scripts/with-remote.js`): Journal 2.0 step 2 recorded it unmigrated, Mapping Restore had its own Neon step. Empty the transaction stores (`db:truncate-transactions -- --confirm`) on local and Neon, since the migration drops `acc_journal` | Both databases at the same migration, holding no journal |
| **1 Retire Penyesuaian / Reklas** *(rev, if R7)* | Journal 2.0 step 6 as written there: tables (a migration), routes, registers, actions, permissions, doc types; `allows_item_adjustment`, `adjustment_*`, `reclassTrail`; `seed-showcase`, `reconcile-books`, `truncate-transactions`, `module-boundaries` | The suite passes; `db:reconcile` agrees |
| **2 Schema** | One migration: drop `acc_journal_line`, `acc_journal`; rename `acc_general_journal(_line)` → `acc_journal(_line)` with their indexes, constraints and sequences; drop `posted_journal_id`; drop `acc_account.is_control_account`. `schema.prisma`: `AccGeneralJournal*` become `AccJournal*` (old `general_journal` back-relation gone), back-relations on Company, Account, Partner, Currency, Doc Type, Cash Bank Layer follow. `SIBA DBML.md` in the same change | `prisma migrate dev` and `generate` clean |
| **3 One writer** | `postJournal` (`journal.ts`) inserts into the new table, writing `status: Posted` and `is_manual: false` explicitly (the new defaults are Draft / true). Jurnal Umum's Post (`general-journal.ts`) stops writing a second journal: it validates through the same `resolveJournalLines` balance rule, writes the books, and flips **its own row** to Posted with `posted_at`. R6's check at save and Post. Drop the manual-journal draft CRUD from `journal.ts` and `draftJournalsDatedBetween`'s fallback | `tests/general-journal.test.ts`: a posted `JUM-` *is* the ledger row the General Ledger reads; a line on each engine-owned key is refused; every document suite's journal assertions pass unchanged |
| **4 Retire the manual journal** | Delete `manual-journal.ts`, `journal-workflow.ts`, `app/actions/journal.ts`, `journal-form.tsx`, `journal-actions.tsx`, the old `journal/new` and `journal/[id]/edit` routes, `tests/manual-journal.test.ts` (keep its immutability assertions in `journal.test.ts`). `seed-showcase.ts` posts its one manual journal through Journal | Nothing imports the removed files |
| **5 Drop the control account (R2)** | Remove the flag's readers and writers: `records.ts`, `app/actions/master.ts`, `app/actions/system-account.ts`, `app/(app)/accounting/system-account/page.tsx` *(rev)*, `entities.ts` (the read-only field), `system-account-data.ts` (`fx_revaluation` now asks `ledger === 'none'`), `seed-showcase.ts`, `backfill-account-flags.ts` (Postable half stays), tests (`accounting`, `settings`, `design-system`, `general-journal`, `helpers`) | No `is_control_account` left |
| **6 One menu, named Journal** | Move `accounting/jurnal-umum/*` to `accounting/journal/*`. **Register:** the old `JournalList` shape — paged, searched and filtered by the database, with its `?origin=` facet (Dokumen / Manual / Closing; Manual = `is_manual`) — over the one table, linking every row to the Jurnal Umum form. **Form:** view mode also serves a document's journal, read-only with its Sumber via `documentHref`. Nav: one entry *Journal* (`acc_journal`, `JOURNAL_VIEW`). "Jurnal Umum" → "Journal" in every UI string; doc type name in the seed; permissions (R4) in the catalogue and a data migration; `documentHref`, `document-numbers`, `audit-events`, `audit`, `DOCUMENT_SCREENS`, `POSTING_FORMS`, `module-boundaries`, `truncate-transactions`, `revalidatePath`s | No user-facing "Jurnal Umum"; GL → journal → source drill works for `JRN-`, `CLS-` and `JUM-` |
| **7 Documentation** *(rev)* | CLAUDE.md carries Journal 2.0's step 7 debt too (it still lists Penyesuaian and Reklas as built and has no Jurnal Umum module): §1, §3 (module table, contract), §5, §9, §10 rules 47–49 (one table), 70, 79–83 (no control account; Journal is the hand-written journal; R6), 97–102 and 113–117 (if R7), §12 *A posted journal balances…*, *A manual journal is drafted…*, *An account with children…* (Postable half stays), §14, §17. KNOWLEDGE.md rows 52 and 53 per the deviation answer. `Journal 2.0 - Plan.md` §8 / §10 | |
| **8 Verify** | `npm run db:seed`, `npm run db:seed-showcase`, `npm run db:reconcile`; browser: new → save → Post, a Realisasi's journal, a close's journal, GL drill; `ui-audit` the register and form; apply on Neon and reseed | All agree |

---

## 3. Risks

- **Bookmarks** to `/accounting/jurnal-umum/*` stop resolving. Accepted.
- **Grants**: a role with manual-journal rights loses them (R4); the
  administrator re-grants Journal deliberately.
- **Without R6**, the bridge, Selisih Kurs and both Laba/Rugi accounts become
  typeable: the dashboard's Posisi Intercompany turns red, nothing refuses it.
- **With R8 "now"**, there is no hand-written fallback while Journal is
  untried.
- **Mixed accounts** (Mapping Restore M6) still do not equal their book in the
  General Ledger, and `db:reconcile` check 14 still skips them; this plan does
  not change that (see §4).

---

## 4. Later, made possible by this plan *(rev)*

After step 2 every journal line has `budget_category_id`. If Realisasi,
Funding, Pencairan and the Kategori lines of every other posting path fill it,
the General Ledger can filter an account by category and check 14 can compare
each booked category with its book instead of skipping a mixed account —
closing M6. Not in scope; a plan of its own.
