# SIBA 3.0 — Fiscal Calendar per Company, and Period Closing

> **Status: proposed, not executed.** Drafted 20/10/2026 at the user's request.
> No code, schema or KB has been changed. Section 1 needs the user's decision
> before anything starts.

## Goal

1. **Each Company runs its own fiscal calendar.** Its own Fiscal Years, its own
   twelve periods, its own lifecycle and checks. The induk's calendar never
   blocks the anak's, and the reverse.
2. **A period can be closed**, per Company. A closed period refuses every
   posting dated inside it — the first of the period validations to follow.
3. **`cash_bank_period` refers to the fiscal period** it falls in, so a later
   period check (for example "the Cash Bank Book of this period reconciles")
   can join on the period rather than on a date range.

---

## 1. Decisions needed first

### 1.1 This reverses a recorded decision

`Initialization/Opening & Closing Update Phase.md` §3.6 — *"The fiscal calendar
stays global"* — was "reconsidered and confirmed" while closing was built.
CLAUDE.md §12 (*Fiscal Year is the only fiscal entity*, *Budget Month is derived
from fiscal period*) and the comment on `CashBankPeriod` in `schema.prisma` rest
on it. The honest case for keeping it:

- **Budget Month** reads one calendar. A Budget transcends Company (the user's
  rule), so a cross-Company Budget list grouped by two calendars needs a new
  definition of "month" (§3.1).
- **Group practice**: subsidiaries share a fiscal calendar because
  consolidation needs it. Both Companies' years would still run 01/01–31/12
  (the year shape is generated, never typed), so this is kept by construction,
  not by the schema.
- **Everything per-Company that the global calendar lacked is already a
  record of its own**: `acc_fiscal_closing` (year close per Company), the
  posting lock per `(year, Company)`, the Opening Balance per `(year, Company)`.

**There is a smaller alternative (B)** that delivers every validation named in
the Goal without splitting the calendar: keep one calendar and add
`acc_fiscal_period_closing (fiscal_period_id, company_id, status, closed_at,
closed_by)` — the period-level twin of `acc_fiscal_closing`. Each Company then
closes its own periods and is checked on its own. What B does **not** give is
independent *activation* (both Companies get a year when it is opened) and a
year record each Company owns.

| | **A. Calendar per Company** (the user's stated direction) | **B. Shared calendar, per-Company state** |
| --- | --- | --- |
| Period close per Company | Yes — status on the Company's own period | Yes — a state row per period × Company |
| Year activated per Company | Yes | No — one activation for both |
| Budget Month | Redefined as the calendar month (§3.1) | Unchanged |
| Migration | Splits every existing year in two and remaps references | Additive only |
| `cash_bank_period` link | To the Company's own period | To the shared period |
| Size | Large (~25 files, every fiscal reader) | Small (fiscal.ts, closing, one table) |

**Recommendation:** A, if independent activation and each Company owning its
year record matter to you; B if what you need is independent *closing and
validation*, which is what the Goal names. The rest of this plan is written for
**A**. B is phases 3 and 4 of it, without phases 1 and 2.

### 1.2 Period closing semantics (both options)

1. **Order:** must periods close in order (January before February), as years do?
   *Proposed: yes* — a closed February behind an open January would let a
   January posting move a figure February already froze.
2. **Reopening:** may a closed period be reopened? *Proposed: yes, the latest
   closed period only, by its own permission (`FISCAL_PERIOD_REOPEN`), audited,
   and never once its year is closed.* Mainstream ERP (SAP posting periods, Odoo
   lock dates, Business Central's allow-posting-from) all allow it. A year close
   stays irreversible.
3. **Year close:** does closing a year require its twelve periods closed first?
   *Proposed: yes* — it becomes the 8th blocking check, and the closing journal
   dated 31/12 is the one posting allowed into a closed December.
4. **What a period close checks:** *proposed for this round: nothing but order*
   — the checklist (trial balance balances, no draft journal, books reconcile) is
   the "validation and checking" that follows, and it lands on this plan's hooks.

### 1.3 Knowledge base (PROTOCOL §4 deviation check)

`accounting/fiscal-periods-and-statements` 1.0 §1.1 says *"A period has no
menu, route, registry entry or permission"*. A period close needs a permission
and an action. The concept does not say the calendar is global; §1.3 already
reads the lock "for that company". Proposed: **B — improve the concept for
everyone**: 1.1 (minor) adds per-Company calendars as an option and period
closing as a rule. Alternatively D, a local exception.

---

## 2. Phase 1 — Schema (option A)

One migration, `fiscal_calendar_per_company`, with `SIBA DBML/SIBA DBML.md` in
the same change.

| Table | Change |
| --- | --- |
| `acc_fiscal_year` | + `company_id` (FK `sys_company`, NOT NULL). Unique `(company_id, year_label)`. `year_code` stays unique. |
| `acc_fiscal_period` | + `company_id` (denormalised from its year, written by `ensureFiscalPeriods`, never by a form). Unique `(company_id, start_date)` — the key every date lookup uses. `status` (`Open` / `Closed`) becomes real; + `closed_at`, `closed_by`. |
| `acc_fiscal_closing` | Kept as the year-close record (journal, snapshot, who, when). Its `company_id` must equal its year's; the year's `status` rollup over two Companies disappears — a year now has exactly one closing. Folding it into `acc_fiscal_year` is possible later and not part of this. |
| `cash_bank_period` | + `fiscal_period_id` (nullable FK `acc_fiscal_period`). The month date stays the key and the arithmetic, so the unbroken chain and the per-day check are untouched. Null where the month lies in no generated period of the resource's Company. |

**Data migration, in the same SQL:**

1. Each existing year becomes the **induk's**. A copy is inserted for the
   **anak**, with its twelve periods (same dates, new codes).
2. Remap by Company: `acc_fiscal_closing` rows, `acc_opening_balance.fiscal_year_id`
   and `.source_fiscal_year_id` (by the snapshot's own `company_id`), and every
   `CLS-` journal's source `(acc_fiscal_year, id)` (by the journal's Company).
3. Fill `cash_bank_period.fiscal_period_id` by `(company of the resource,
   month = start_date)`.
4. The anak's copied year has no audit history before the migration — stated,
   not invented.

## 3. Phase 2 — Code follows the Company

| Area | Change |
| --- | --- |
| `fiscal.ts` | Every date → year/period lookup takes the Company: `checkPostingPeriod`, `holdPostingPeriod` (now returns the period id per Company), `checkYearOpenable` and "no year opens behind a close" per Company, `carriedYearsBefore`, `reportableFiscalYears(companyId)`, `closedFiscalYearsFor`. The year `Closed` rollup goes. The advisory lock key becomes the year id alone — the year already names its Company. |
| `actions/fiscal.ts`, registry `entities.ts` | Fiscal Year gains a Company field (create-only, locked after) and the list a `CompanyFilter`, as Chart of Accounts has. Scoped by `COMPANY_*_ACCESS`. Same permissions. |
| `closing.ts` | Reads the Company's own year and its successor; no cross-Company rollup. |
| `opening-balance.ts`, `ledger.ts`, `statements.ts` | Read the Company's year. Logic unchanged — every report already runs one Company. The fiscal-period filter lists the chosen Company's years. |
| `cash-bank.ts` | `NewEntry` gains `fiscalPeriodId`, written onto the entry month's chain row. The book still imports nothing: the posting paths pass the id they got from `holdPostingPeriod`, and the Cash & Bank registration Opening gets it from `fiscal.ts` in `records.ts`. Months the chain fills in without an entry stay null — they hold no movement. A new export, `linkCashBankPeriods(db, companyId, periods)`, links existing rows when a year is activated; Fiscal may depend on a book, never the reverse. |
| Dashboard setup card | "Open the fiscal calendar" asked per Company. |
| `seed-showcase.ts`, `truncate-transactions.ts` | Both Companies get their years; truncate's undo-close works per Company year. |
| Tests | `openFiscalYear()` opens both Companies' years (or the one asked for). `fiscal`, `closing`, `opening-balance`, `balance-sheet`, `profit-loss`, `ledger-opening`, `finance`, `funding`, `transfer` suites adjusted; the funded route checks **both** Companies' calendars. |
| `reconcile-books.ts` | Check 19 also asserts each linked row's period is its own month and Company, and every month with an entry inside a generated period is linked. |

### 3.1 Budget Month (option A only)

Budget Month is today "the fiscal period a Budget's date falls in". With two
calendars it becomes **the calendar month** — still derived, still no table, no
month column, still one list across both Companies (the user's rule). The route
moves from a period id to the month: `/budget/budget/month/2026-03`
(`tests/reports.test.ts` pins `/month/5` and is updated with it). A month with
no Budget is not listed, as today. CLAUDE.md's frozen *Budget Month is derived
from fiscal period* is rewritten to say so.

## 4. Phase 3 — Period closing

| Item | Detail |
| --- | --- |
| Lifecycle | Period `Open → Closed`, and `Closed → Open` (reopen) per §1.2. A table in `fiscal-workflow.ts`, like every lifecycle. |
| Permissions | `FISCAL_PERIOD_CLOSE`, `FISCAL_PERIOD_REOPEN` in the catalogue. |
| Screen | The periods list on the Fiscal Year detail (`FiscalPeriods`) gains a status badge and the row action — no new menu, no route of its own. A `ConfirmDialog` with consequence copy. |
| Gate | `checkPostingPeriod` refuses a date in a closed period, naming it: *"Periode Maret 2026 ABHC sudah ditutup."* Asked on save and under the lock at Post, on every posting path — nothing else to touch, because every path already goes through it. |
| Concurrency | Closing a period takes the same `(year)` advisory lock postings take, so a backdated posting and a period close never interleave. |
| Year close | Gains the check "all twelve periods closed". The `CLS-` journal is written with the period check bypassed for its own 31/12 date only. |
| Audit | `close_period` / `reopen_period` events, labelled in `audit-events.ts`. |

## 5. Phase 4 — Close-out

- CLAUDE.md: §1 status, §3 table, §10 rules 17 and 32, §12 *Fiscal Year…* and
  *Budget Month…*, §13/§17, and a new frozen decision for the per-Company
  calendar with its reason.
- KB per §1.3; `KNOWLEDGE.md` adoption row.
- `Initialization/Opening & Closing Update Phase.md` stays untouched (frozen
  source); the reversal is recorded in CLAUDE.md instead.
- Verification: build, lint, `npm test`, a fresh database through
  migrate → seed → showcase → `db:reconcile`, the migration run on a copy of a
  database **holding** closed years and `CLS-` journals (the showcase has one),
  `ui-audit` on the Fiscal Year screen, and Neon `migrate deploy` only on your
  go-ahead.

## 6. Order and size

1. Phase 1 + 2 together — the schema split cannot ship without its readers.
   The largest step: one migration, ~25 files, most suites touched.
2. Phase 3 — period close, on the hooks phase 2 leaves.
3. Phase 4.

Each phase is committed on its own, green, and pushed to `main`.

## 7. Not in this plan

- The period-close **checklist** (books reconcile, no drafts in the period) — the
  next step, built on phase 3.
- Different year-ends per Company — the year shape stays 01/01–31/12.
- Consolidation across the two Companies.
