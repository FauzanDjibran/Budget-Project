# Opening Balance & Fiscal Year Closing — Implementation Phases

> **Plan of record.** Agreed with the user across a design session before any code
> was written. Every decision below is settled; none of them is open for
> re-litigation in a phase session. If something here contradicts `CLAUDE.md`,
> §7 says which entries this work supersedes — surface the conflict to the user
> rather than picking one silently.

---

## 1. How to use this document

Each phase is written to be executed in **its own chat session**. A phase
session should:

1. Read `CLAUDE.md` (it loads automatically) and then this file.
2. Read §2–§5 for the model and the codebase facts. They are the findings of the
   design session; do not re-derive them.
3. Execute **one** phase from §6, in order. Do not start a later phase early.
4. Validate with `npm run build`, `npm run lint`, `npm test`, and exercise the
   feature in a browser where it has UI.
5. Report what changed, what was verified, and what was not.

Phases 1–3 contain **no closing semantics** and are individually useful.
Migrations land in phases 1, 2 and 3 — three, all additive, none destructive.

---

## 2. What is being built

Two menus under **Accounting › Period Control**, each standing on its own:

- **Opening Balance** — a read-only register of per-Company, per-fiscal-year
  balance snapshots.
- **Fiscal Year Closing** — the workspace that validates a year, previews its
  closing journal, and executes the close.

The end-to-end flow:

```
FY_N (Open)  ·  FY_N+1 may also be Open — at most two Open years exist
   │
   ├─ VALIDATE   balanced · no Draft journal created inside the year ·
   │             settings resolved · FY_N+1 exists · FY_N is the oldest Open year
   ├─ PREVIEW    the closing journal, computed, nothing written
   └─ EXECUTE    one transaction, per Company:
                   CLS-0001  dated 31/12/FY_N  → P&L into Laba/Rugi Tahun Sebelumnya
                   OPB-0001  for FY_N+1        → snapshot at (account, partner?) grain
                   acc_fiscal_closing row      → that Company's year is shut, permanently
                   AccFiscalYear.status        → Closed, only once BOTH Companies closed
```

**Out of scope, by the user's decision:** subject-book (subledger) opening
balances — the subject books are continuous stores; and cash/bank FX
revaluation — a separate process, not part of GL closing.

---

## 3. The accounting model, settled

### 3.1 Laba/Rugi Tahun Berjalan is computed, never posted

The closing journal moves the P&L **straight into Laba/Rugi Tahun Sebelumnya**.
`Laba/Rugi Tahun Berjalan` is a **Balance Sheet presentation line** — the figure
that makes Neraca balance during an open year, computed as Σ Pendapatan −
Σ Biaya. Nothing ever posts to it.

This matches Odoo, Xero, QuickBooks, SAP FI and Accurate. The two alternatives
were considered and rejected:

- posting it as a pass-through inside the same journal leaves an account whose
  balance is permanently zero, and the Neraca still has to compute the running
  figure anyway;
- posting it and holding it for a year means the line named "tahun berjalan"
  contains the *previous* year's result for twelve months, which is the single
  most common source of confusion with this account in practice.

**Accepted cost:** after closing, "FY2026 made 250 juta" is no longer a balance
— it is merged into Laba/Rugi Tahun Sebelumnya. It stays readable as a movement
on that account's General Ledger, and on the closing journal itself.

### 3.2 The closing journal

**One journal**, `CLS-0001`, dated the **last day of the fiscal year**:

```
D   every ProfitLoss account carrying a credit balance, at its balance
K   every ProfitLoss account carrying a debit balance, at its balance
K/D Laba/Rugi Tahun Sebelumnya — the residual
```

Balanced by construction, so `postJournal`'s refusal never fires. It is written
through the same engine as every other journal.

### 3.3 Which accounts close

`sys_account_type` gains a **`section`** column: `AccountSection { BalanceSheet,
ProfitLoss }`, rendered "Neraca" / "Laba Rugi".

Seeded — types `1 AKTIVA`, `2 PASIVA`, `3 EKUITAS` → BalanceSheet; `4
PENDAPATAN`, `5 BIAYA` → ProfitLoss. **Not editable and not on a form**: a
type's section is not a judgement call.

This exists **to stop an assumption**. The section was originally going to be
read off the first segment of the lineage-composed `account_label`, which would
have worked — and the user rejected it, because a convention that happens to
hold is something a future maintainer can break with nothing failing. A stored
column is a fact the database can be asked for and a test can assert over.

### 3.4 The four System Defaults

Two per Company, in a new settings group:

| Key | Account | Job |
| --- | --- | --- |
| `induk_accumulated_pl_account` · `anak_accumulated_pl_account` | 3.3.x Laba/Rugi Tahun Sebelumnya | **Posting target** of closing. Closing is refused **by name** when unset. |
| `induk_current_pl_account` · `anak_current_pl_account` | 3.4.x Laba/Rugi Tahun Berjalan | **Presentation line** for the Neraca. Never posted to. |

All four are **control accounts**, so a manual journal may not touch them. This
needs **no code change**: `systemDefaultAccountIds()` in `system-settings.ts` is
generic over every account-valued System Default, and `app/actions/settings.ts`
already re-syncs control accounts on every settings write. A test proves it
rather than code implementing it.

`*_current_pl_account` is read by nothing until a Balance Sheet report exists
(there is none). It is declared now on the user's instruction, because the
account is real in the chart and its purpose is known.

### 3.5 Opening Balance

One document per Company per fiscal year. **Immutable.** Base currency only.
Read-only in the UI — there is no create form and no edit path.

**Line grain is `(account, partner?)`**, one flat table, exactly as the source
DBML already declares. A Hutang account with three branch partners produces
three lines; an account with no partner produces one line with `partner_id =
null`.

Why not a parent line per account plus a child table for the partner split:

- the flat grain **is the journal line's own grain** (`acc_journal_line` is
  `account_id` + nullable `partner_id`), so the derivation is one `groupBy` and
  the reconciliation is one comparison;
- a parent row holding the account total would store a figure that is the sum of
  its children — a permanent, unverifiable duplicate. The materialised balances
  elsewhere in SIBA are allowed only because a rebuild function can re-derive
  them; an immutable snapshot has no rebuild;
- a mixed-sign account (one branch overpaid, two not) is natural under the flat
  grain and contradictory under the parent/child one.

**The grain is derived from the posted journal lines as they actually are** —
grouped by `(account_id, partner_id)` — **not** from
`acc_account.require_partner`. Reading the flag would drop a partner-bearing
balance sitting on an unflagged account and would invent a null-partner line for
an account that has none.

Uniqueness `(opening_id, account_id, partner_id)` with **`NULLS NOT DISTINCT`**
in raw migration SQL, because Postgres otherwise treats two null-partner rows
for one account as distinct.

**Two invariants, both asserted by tests:**

- per `(account, partner?)`, the line equals that pair's General Ledger balance
  on the closing date;
- across the whole document, **total debit = total credit** — after the P&L is
  closed out, what remains is a balance sheet.

**Go-live:** the first live implementation's opening balances are **injected
into the database by a developer**, with `source_fiscal_year_id = null`. There
is deliberately no hand-entry screen; a null source is what distinguishes an
injected snapshot from a generated one.

### 3.6 The fiscal calendar stays global

`acc_fiscal_year` and `acc_fiscal_period` keep **no `company_id`**. One calendar,
shared by both Companies.

This was reconsidered and confirmed. Splitting the calendar per Company was
proposed on the grounds that there was nowhere to record "the induk closed 2026
and the anak has not" — **that argument is wrong**: the closing state lives in
its own record (§3.7). Everything that genuinely must be per-Company — the
chart, the journal, the equity accounts, the Opening Balance, the posting lock —
already is, and none of it lives on the fiscal year.

Keeping it global:

- **retains Budget Month untouched** — one calendar means twelve periods, not
  twenty-four, and `monthOfDate`'s `findFirst` resolves unambiguously;
- needs **no data migration** at all;
- matches the user's own statement that **a Budget transcends Company**. A
  cross-Company Budget grouped by a cross-Company calendar is coherent; a
  cross-Company Budget sitting on two calendars is not;
- matches group accounting practice — subsidiaries under one parent normally
  share a fiscal calendar, because consolidation requires it.

**Given up, knowingly:** different year-ends per Company (impossible, and
undesirable for a group); and the max-two-Open rule couples the Companies, since
opening a third year requires the oldest to be `Closed`, which requires both
Companies to have closed it.

### 3.7 Per-Company closing state

New table **`acc_fiscal_closing`**, one row per `(fiscal_year, company)`:

```
fiscal_year_id, company_id      -- unique together
status              Open | Closed
closed_at, closed_by
closing_journal_id?             -- the CLS- journal
opening_balance_id?             -- the OPB- document it produced
```

Deliberately **an explicit record rather than a derived existence check** over
`acc_opening_balance`. Inferring a status from the presence of a row in another
table is the same habit §3.3 exists to stop.

**`AccFiscalYear.status` becomes a rollup:** the year reads `Closed` once
**every** Company has closed it, written in the same transaction as the last
Company's close. Confirmed with the user as a derived meaning rather than a
direct fact.

### 3.8 The lock

**A posting is allowed only when the year containing its date is `Open`, and
that Company has no `Closed` row in `acc_fiscal_closing` against it.**

`Draft` = not yet. `Closed` = never again. Closing is **irreversible**; once a
Company's year is closed, no new transaction can ever be made inside it.

**At most two Fiscal Years may be `Open`.** Activating a third is refused,
naming the year to close. Only the **oldest** Open year is closable — closing
the newer one would leave an Open year with no successor to inherit into. The
two-open window is what lets late FY_N work post while FY_N+1 is already
running.

**Honest note on what the lock currently catches.** Every posting date in SIBA
is today, and the only back-dated journal is the closing entry itself, so a
closed past year is already unreachable by arithmetic. The user asked for the
guard anyway, explicitly, because the no-back-dating rule may change and the
lock must be in place before it does. Its value today is that the rule is
enforced rather than incidental, and that it refuses a second close.

**Back-dating:** `CLS-` journals are the **only** exception to SIBA's
no-back-dating rule. Nothing else gains a date field.

### 3.9 Blocking validations

| Check | Note |
| --- | --- |
| Trial Balance balanced for that Company, and no unbalanced journal | `trialBalanceReport` + `unbalancedJournals` already answer this |
| No `Draft` journal in the year | **Stated assumption:** a draft has no posting date, only `created_at`, so "in the year" is read as `created_at` inside the year's range, for that Company. Raise it with the user if a phase session finds a better column. |
| Every other journal `Posted` or `Cancelled` | The baseline said "Posted or Closed"; `JournalStatus` has no `Closed` and gains none — adding one would mean mutating posted journals, which is frozen |
| Accumulated P&L account resolved, postable, active, same Company | Refused **by name**, like the intercompany bridge. No fallback. |
| FY_N+1 exists | **Refused, not created** — a Fiscal Year is chosen by someone (frozen). `Draft` is enough; the snapshot attaches and activating it later generates the twelve periods as today. |
| FY_N is `Open`, is the oldest Open year, and this Company has not closed it | §3.8 |

**Not blocking, by decision:** a Budget may be dated into a closed year. There
is no date restriction on a Budget.

---

## 4. Codebase findings

Established by reading the code during the design session. A phase session can
rely on these rather than re-deriving them.

### 4.1 What exists

| | |
| --- | --- |
| `src/lib/siba/fiscal.ts` | `ensureFiscalPeriods` (idempotent on the count), `fiscalYearShape`, `parseYear`, `fiscalYearPeriods` |
| `src/lib/siba/fiscal-workflow.ts` | One transition, `open`. `FISCAL_YEAR_CLOSING_NOTE` is the placeholder explaining why closing is absent — **replaced in Phase 4** |
| `src/lib/siba/journal.ts` | `postJournal` **hardcodes the prefix `"JRN"`** and calls `postingDateToday()`; `nextJournalNo(tx, prefix)` already takes a prefix, union `"JRN" \| "JUR"`; `resolveJournalLines` is the shared validator |
| `src/lib/siba/ledger.ts` | `generalLedgerReport`, `trialBalanceReport`, `signedMovement`, `accountPositions`, the `POSTED` filter. **`trialBalanceReport` reads every posted line with `posting_date: { lte: to }`** — the unbounded scan Opening Balance removes |
| `src/lib/siba/system-settings.ts` | `systemDefaultAccountIds()` is **generic over every account-valued System Default** — this is why §3.4 needs no code |
| `src/app/actions/settings.ts` | Re-syncs control accounts on every settings write (`before`/`after` diff → `syncControlAccounts`) |
| `src/lib/siba/records.ts` | `syncControlAccounts`, `controlAccountReasons`, `checkAccountIsLeaf` |
| `prisma/seed.ts` | `COA_SKELETON` (already contains `3.3 LABA/RUGI TAHUN SEBELUMNYA`, `3.4 LABA/RUGI TAHUN BERJALAN`); `DOC_TYPES` is **append-only**, codes are positional |

### 4.2 What does not exist

- **No Balance Sheet and no Profit & Loss report.** Only General Ledger and
  Trial Balance.
- **No fiscal gating on any posting path.** `applyPosting`, `writeFundedPosting`,
  `applyTransfer` and `postDraftJournal` never consult the calendar.
- **`acc_opening_balance` / `_line` are in the DBML only**, never migrated. The
  DBML line carries no currency — kept that way deliberately, since the journal,
  the General Ledger and the Trial Balance are base-currency only.
- **No function classifies an account as P&L or balance-sheet.**

### 4.3 Structural facts

- **Nothing in the schema has a foreign key to `acc_fiscal_period`.** Its only
  readers are `budgetMonths` / `fiscalPeriod` / `monthOfDate` in `budget.ts`,
  `fiscalYearPeriods`, a count column in `records.ts` and a setup-gap count in
  `dashboard.ts`.
- The four posting paths are `applyPosting` and `writeFundedPosting`
  (`finance.ts`), `applyTransfer` (`transfer.ts`), `postDraftJournal`
  (`journal.ts`).
- **Module boundary:** `closing.ts` must not name another module's tables. It
  reads balances through a new function in `ledger.ts` (the sanctioned reader of
  journal lines, CLAUDE.md §10 rule 22), writes journals through `journal.ts`,
  writes snapshots through `opening-balance.ts`, and moves the year through
  `fiscal.ts`. `KNOWN_CROSSINGS` in `tests/module-boundaries.test.ts` must stay
  at two.

---

## 5. Naming and numbering

| | |
| --- | --- |
| Closing journal | `CLS-0001` — its own series beside `JRN-` and `JUR-` |
| Opening Balance document | `OPB-0001` |
| Menus | **Opening Balance** and **Fiscal Year Closing**, Accounting › Period Control |
| Doc types appended | `Opening Balance` (`acc_opening_balance`), `Fiscal Year` (`acc_fiscal_year`) |
| Permissions | `FISCAL_YEAR_CLOSE`, `OPENING_BALANCE_VIEW` |
| Enum | `AccountSection { BalanceSheet, ProfitLoss }` in code; "Neraca" / "Laba Rugi" in the UI |

`Saldo Awal` is already the Cash & Bank resource's opening entry and means
something else. Do not reuse it for this.

---

## 6. The five phases

### Phase 1 — The chart learns what it is

No closing semantics. Independently useful.

**Migration** — `sys_account_type.section`, NOT NULL, **backfilled by
`type_label`** so deployed databases survive the migration.

**Work**

- Seed the five sections (§3.3). Not editable, not on any form.
- Four System Defaults (§3.4): catalogue entries, a new group on the settings
  page, write-time validation (right Company, postable, active — reuse
  `checkSystemDefaultValue`).
- Dashboard "Perlu Perhatian" names an unset accumulated-P&L account, in the
  same shape the intercompany bridge gap already uses.

**Tests**

- every `sys_account_type` has a section, and the two sets partition the chart;
- the four accounts become `is_control_account` when set, and are released when
  repointed where nothing else claims them;
- a manual journal naming one is refused, and the refusal names it.

**Done when** each Company can name its two equity accounts, both are closed to
hand entry, and the chart can say which accounts are P&L. Nothing closes yet.

---

### Phase 2 — The calendar becomes lockable

No closing semantics. The lock is enforced before anything can close.

**Migration** — `acc_fiscal_closing` (§3.7).

**Work**

- Max-two-Open rule on `FISCAL_YEAR_OPEN`: activating a third year is refused,
  naming the year to close.
- Posting guard in `fiscal.ts` (§3.8), wired into **all four** posting paths.
  Query the **year** — it carries the date range — plus the Company's
  `acc_fiscal_closing` row.

**Do not** add `FISCAL_YEAR_CLOSE` here. CLAUDE.md §13 says the permission lands
in the change that builds the process; that is Phase 4.

**Tests**

- a posting into a `Draft` year is refused;
- a posting into a Company-closed year is refused **while the other Company
  still posts** — exercised by writing an `acc_fiscal_closing` row in a fixture;
- all four paths covered;
- a third Open year is refused.

**Done when** the lock is enforced everywhere and is exercisable from a fixture.

---

### Phase 3 — The Opening Balance store

No closing semantics. Delivers the go-live path.

**Migration** — `acc_opening_balance` + `acc_opening_balance_line` (§3.5),
`(opening_id, account_id, partner_id)` unique with `NULLS NOT DISTINCT` in raw
SQL. Two `DOC_TYPES` appended (§5) — the list is append-only, so append at the
end.

**Work**

- `src/lib/siba/opening-balance.ts` — owns both tables; write and read.
- `closingBalances(companyId, asOf)` in **`ledger.ts`**, at `(account,
  partner?)` grain. It lives there so `closing.ts` adds no boundary crossing.
- `postJournal` gains an optional posting date and a prefix argument;
  `nextJournalNo`'s union widens to include `"CLS"`.
- `/accounting/opening-balance` — register and detail, read-only, its own menu
  entry. No create form, no edit path.

**Tests**

- a document balances (total debit = total credit);
- a duplicate `(account, partner)` is refused, including two null-partner rows;
- `closingBalances` matches the General Ledger at both grains;
- `postJournal` honours an explicit date and prefix, and still refuses an
  imbalance.

**Done when** a developer can inject go-live balances and read them through the
menu.

---

### Phase 4 — Closing

**Work**

- `src/lib/siba/closing.ts` — validation (§3.9), preview, and the one
  transaction: the `CLS-` journal, the `OPB-` snapshot for FY_N+1, the
  `acc_fiscal_closing` row, and `AccFiscalYear.status → Closed` **only when this
  is the second Company to close**.
- `FISCAL_YEAR_CLOSE` permission, the `close` transition in
  `fiscal-workflow.ts`, and its audit label in `audit-events.ts` — all in this
  change. `FISCAL_YEAR_CLOSING_NOTE` is replaced by the real action.
- `src/app/actions/closing.ts`.
- `/accounting/closing` — pick year → validation checklist → closing-journal
  preview → one confirm. Its own menu entry. Bespoke, not registry.

**Tests**

- the journal balances and zeroes **every** ProfitLoss account;
- Laba/Rugi Tahun Berjalan is never posted to;
- the snapshot balances and reconciles to the General Ledger at both grains;
- each blocking validation is refused **by name** — unbalanced, a `Draft`
  journal created inside the year, unset accumulated account, missing next year,
  not the oldest Open year, already closed;
- a second close is refused;
- a failed close writes nothing;
- the year rolls to `Closed` only on the second Company's close.

**Done when** closing works end to end for both Companies.

---

### Phase 5 — The reporting payoff, and the record

**Work**

- General Ledger and Trial Balance openings read the snapshot instead of
  scanning from the first historical transaction.
- `CLAUDE.md` — §10, §12, §13, §17 (see §7).

**This is the riskiest read change in the set**: it alters how two existing
reports compute a figure they already produce. The test that matters is
**equivalence** — for the same account and date, the snapshot-based opening must
equal the full-scan opening to the cent.

**Tests**

- equivalence, across a closed boundary and inside an open year;
- a report run against a database with no close is byte-identical to today's.

**Done when** Opening Balance is actually serving its stated purpose — reporting
without scanning from the first historical transaction.

---

## 7. What this supersedes in CLAUDE.md

Update these **in Phase 5**, in the same change, using the Decision / Reason /
Impact / Do-not-change format. Do not edit them earlier, and do not remove an
entry silently.

| Entry | Change |
| --- | --- |
| §10 rule 49 · §12 "A posted journal balances, and never changes" | Gains the single back-dating exception: a `CLS-` journal is dated the last day of the fiscal year it closes. Everything else is unchanged, including immutability. |
| §10 rule 79 · §12 "A manual journal is drafted…" | Gains one clause: the current-P&L account is closed to hand entry because it is a computed presentation line, not because a posting engine owns it. The mechanism is unchanged — it is already an account-valued System Default. |
| §12 "A Fiscal Year has a lifecycle, not a status field" | `Closed` becomes reachable, as a **rollup** over `acc_fiscal_closing`. Adds the max-two-Open rule and the oldest-first constraint. `FISCAL_YEAR_CLOSE` is added here, with the process, as §13 requires. |
| §13 | Remove **Fiscal Year closing** and **Opening Balance** from Planned Changes. **Subledger opening balances** and **period-end revaluation** stay — both remain unbuilt and out of scope. |
| §17 | Remove "Nothing refuses a posting on a period's status" — Phase 2 closes it on all four paths. |

**Not touched by this work:** §10 rule 20 and §12 "Budget Month is derived from
fiscal period" both stand exactly as written. Budget Month is retained (§3.6),
there is still no `bud_budget_month` table and no month column on `bud_budget`,
and there must not be.

---

## 8. Standing constraints for every phase

- **Do not implement beyond the phase you are running.**
- Master data is never deleted; nothing here adds a delete path.
- A posted journal is never edited, reversed or deleted. Closing is irreversible.
- Every write appends to `audit_log`; every lifecycle transition writes an
  `event` and names it in `audit-events.ts`.
- Server-side enforcement is the guarantee; a picker's filter is never it.
- Indonesian UI, English code.
- No new UI control — reuse `components/ui/`. Forms are built from `FormBody` /
  `FormSection` / `FormRow` / `Field`. Header buttons run danger → neutral →
  primary through `lib/siba/header-actions.ts`.
- A new menu entry must have a route that answers, in the same change.
- Commit to `main`, small and per-feature.
