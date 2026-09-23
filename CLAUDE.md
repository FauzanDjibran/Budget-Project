@AGENTS.md

# Project Context — SIBA 3.0

> Authoritative project context for Claude Code. Read this before substantial work.
>
> **Keep `AGENTS.md`.** `next dev` manages the Next.js agent-rules block and, per
> `node_modules/next/dist/server/lib/generate-agent-files.js`, leaves this file alone
> only while `AGENTS.md` exists and hosts that block. Project context belongs here, not
> in `AGENTS.md`.

---

## 1. Project Overview

**SIBA 3.0** is a multi-company budgeting and accounting web application, built in
Indonesian for Indonesian accounting practice. It is a **real application on a real
database**, used by real people who enter their own data.

Governing principle from the concept doc:

> Budget plans → Finance executes → on Post, one business event writes to several
> **independent** books in parallel → those books reconcile against the General Ledger.

The project began as a **conversion of a finished HTML prototype**. All source
material lives in `Initialization/` (committed, treated as read-only reference):

| File | Role |
| --- | --- |
| `Konsep SIBA 3.0 v3.md` | Concept / behaviour spec (42 sections) |
| `SIBA 3.0 DBML.txt` | Source database schema (MySQL-flavoured DBML, 19 tables) |
| `SIBA Mockup 2.0.html` | The mockup — a working ~4.7k-line JS SPA, not static HTML |
| `akui_proto_ui_reference.md` | UI/UX benchmark study that produced the mockup's design |
| `CORE Multi Currency Concept.md` | The general foreign-exchange model — origination, relief, settlement, FX difference |
| `SIBA Multi Currency Concept.md` | That model applied to SIBA's own flow: layers, kurs provenance, which books carry which measure |
| `Template COA.xlsx` | The chart-of-accounts skeleton. **Sheet1 is the only visible sheet and the only authoritative one** (§12) |

The two multi-currency documents arrived **after** the rest and deliberately
supersede several decisions taken when the system held no rate at all. Where an
older statement in this file and those documents disagree, the documents won —
that is recorded in §12 rather than left for a reader to work out.

**The mockup is a reference for UI and behaviour only — never for data.** Because
it is a self-contained HTML simulation with no database, it carried its whole
dataset inline. That dataset was demo content, not canonical fixtures, and none of
it exists in the application any more. Master data belongs to whoever uses the app
and is expected to grow and change through the GUI. Do not design features, tests
or invariants that assume a particular row exists.

**Scope:**

- **Built** — authentication and RBAC, Master, Accounting, Budget through approval,
  the Cash Bank Book (`cash_bank_ledger` / `cash_bank_balance`), the six **subject
  books** (`sub_ledger` / `sub_ledger_balance`), Finance's Cash Bank Transaction —
  draft, edit, cancel and Post, which realizes approved Budgets and writes all three
  stores — the **Funding Request** flow that carries the anak's realization across to
  the induk, **multi-currency** end to end (every book carries a base measure beside
  its own, foreign resources hold rate layers, and a settlement recognises its FX
  difference), the **Cash Bank Transfer** — moving the Company's own money between
  its own resources, including selling and buying foreign currency — and the
  **Report Views** over all of it, and **period control** — the fiscal calendar as a
  posting lock, `Fiscal Year Closing` per Company, and the `Opening Balance`
  snapshot a close writes and the ledger reports then read their openings from.
- **Not yet built** — report output (print and export), intercompany settlement (the
  anak paying the induk back), subledger opening balances, and revaluation of standing
  foreign positions at a period end. Full list in §13.

### Current status

| Area | State |
| --- | --- |
| Scaffold, DB, migration | Done |
| Seed | Done — **system data only**, idempotent, destroys nothing (§12) |
| Cash Bank Book | Done — append-only `cash_bank_ledger` plus materialised `cash_bank_balance`; every entry carries **both measures**, the resource's own currency and what it was worth in base; opening balance entered when a resource is registered |
| Multi-currency | Done — `lib/siba/fx.ts` is the kernel (origination, relief, settlement, FX difference), `lib/siba/currency.ts` the rules (base currency, what may settle what, where a kurs comes from). Every book carries a base measure, the Journal balances in base, and a settlement recognises its difference against a named FX account. Period-end revaluation is **not** built (§13) |
| Rate layers | Done — a foreign Cash & Bank resource holds `cash_bank_layer` rows, one per acquisition, never merged. Money leaving draws on **one** layer the user picks; money arriving opens a new one. `Posisi Layer Kurs` under Finance › Laporan shows them and says when they stop reconciling with the book |
| Subject books (subledgers) | Done — **a book is a Budget Category that names a Partner**, so a category created through the GUI has a working book with no code change: one Report View with a book toggle, one permission, one menu entry. append-only `sub_ledger` plus materialised `sub_ledger_balance`, one book per partner-bearing Budget Category: Titipan, Hutang, Piutang, Prive, Investasi, Hasil Investasi. Both measures, like the Cash Bank Book. Written at Post alongside the Cash Bank Book and the Journal, never derived from either. Six Report Views under Finance › Laporan. No manual entry and no Opening path yet |
| Design system port | Done — including the app's own `Select` and `DateInput`, so no control is drawn by the OS |
| App shell (topbar, rail, submenu) | Done |
| Dashboard | Done — the commitment funnel (submitted → approved-not-executed → awaiting the induk), the cash position and what it is already committed to, the subject books' and the intercompany bridge's standing positions, and system health. MECE: no figure is stated twice, Draft records are counted nowhere, and `tests/dashboard.test.ts` holds the partition. Composed in `lib/siba/dashboard.ts` from what each module says about its own records |
| Master module (Partner, Cash & Bank, Currency) | Done — list, detail, create, edit, status toggle |
| Klasifikasi (Budget Category, Partner Category, Purpose) | Done — the Budget Category rules are rows now, not a constant: which directions a category allows, whether it names a Partner, and which Partner Categories it admits — **the last chosen on the category's own form and written in the same transaction**, so a new category is usable in one save. Under Pengaturan › Klasifikasi, each deactivable. Retiring a pair withdraws the Purposes resting on it from the picker while leaving every record already classified by it readable |
| Company master | List + detail done. Create and edit are locked at both the routes and the Server Actions. |
| Accounting module (COA tree, mapping, journal, ledger, fiscal calendar) | Done — registry-driven, with Chart of Accounts rendered as a tree and numbered by lineage (`1` → `1.1` → `1.1.1` → `1.1.1.2`). Journal, General Ledger and Trial Balance are built: posting writes one balanced, immutable journal and both reports derive from its lines. **Manual journals** are drafted and posted through the same engine, and may not touch a control account. Fiscal Year is created Draft, activated into Open, and its twelve periods are generated at that moment. |
| Period control (lock, closing, Opening Balance) | Done — a posting is allowed only inside an Open year its Company has not closed, enforced on all four posting paths. **Fiscal Year Closing** moves a year's profit and loss into equity (`CLS-` journal, dated the year's last day — the one back-dated journal), writes the next year's **Opening Balance** snapshot at `(account, partner?)` grain, and stamps `acc_fiscal_closing`; the year itself reads Closed only once every Company has closed it. At most two years stand Open and only the oldest is closable. The General Ledger and the Trial Balance compute their openings from the snapshot instead of scanning a Company's whole history, and say which document they read. Opening Balance is read-only — a close writes one, or a developer injects go-live figures with a null source. |
| Transaction Purpose | Done — rows in `sys_purpose` a maintainer **enters** under Pengaturan › Klasifikasi. Nothing generates them, so a Budget Category with none cannot be transacted; the Budget Category list states the count. The label is composed from direction × Category × Partner Category and never stored |
| Budget module | Done for create → approve — Budget Month, Budget list, create/edit, and the Draft → Submit → Approve/Reject lifecycle. Bespoke, not registry-driven. |
| Finance module | Cash Bank Transaction done for draft → post — header context (Purpose · Company · Partner · Cash & Bank · Currency · kurs), multi-Budget realization, Post writing the Cash Bank Book, the subject book, the Journal, the rate layer and `realized_amount` in one transaction. Bespoke, not registry-driven. |
| Funding Request | Done — the anak has no Cash & Bank, so its document is submitted (`Pending`) rather than posted, raising an `Open` request. The induk confirms; one transaction writes its cash entry, every Budget's realization, a journal each — the two Companies' positions against one another live in those journals — the document's Posted status and the request's closure. No rejection and no partial funding. Intercompany settlement is not built |
| Cash Bank Transfer | Done — the Company's own money moving between its own Cash & Bank resources. One source on the header, several destinations on the lines, and three Purposes: `Transfer` (same currency), `Pencairan` (foreign → base) and `Pembelian Valas` (base → foreign). Base value is conserved and layers propagate one-for-one; **Pencairan is the only one that can recognise an FX difference**. Post writes both books, each destination's layer and one balanced journal in one transaction. Its own module, not a third `transaction_type` — a transfer settles no Budget |
| Report Views | Done — the screen type plus nine reports: `Buku Kas & Bank`, `Saldo Kas & Bank`, `Posisi Layer Kurs` and the six subject books under Finance › Laporan, and General Ledger + Trial Balance under Accounting. Catalogue-driven from `reports.ts`, parameters in the URL, read-only, reconciling. On-screen only; no print or export yet |
| Authentication | Done — email/password, database-backed sessions, login/logout |
| Authorization (RBAC) | Done — permission catalogue, roles, server-side enforcement on every route and action |
| User & role management, profile | Done — Admin-only user/role administration; own profile for everyone |
| System Default | Done — `/settings/system-default`; catalogue in code, values in `sys_setting`. Default Currency, the four intercompany bridge accounts, and each Company's FX difference account |
| Tests | Security suite plus the Accounting, Budget, Finance, Funding, Transfer, Cash Bank Book, subject book, rate layer, FX kernel, manual journal, fiscal calendar, Opening Balance, Fiscal Year closing and System Default enforcement points, via `node:test` (`npm test`). `tests/ledger-opening.test.ts` holds the one property the snapshot-based opening rests on — equivalence with the full scan, at three boundaries. Business fixtures are created by the tests, not by the seed. A design-system suite scans the source for UI conventions that had already drifted, and `tests/money-input.test.ts` drives the one numeric field one keystroke at a time, for an amount and for a kurs. |

---

## 2. Core Principles

1. **The mockup informs the UI. The concept doc drives behaviour. The DBML informs the
   data model.** None of the three governs the data: the database does. When they
   conflict, surface the conflict — do not silently pick one.
2. **The seeder seeds system data only.** Everything a user can create through the
   GUI, a user creates. Never plant business data in the seed, and never write a
   seed step that deletes it.
3. **The design system is finished work.** Reuse its class names; do not restyle.
4. **Registry over pages.** New entities are added as config, not as new page files.
5. **Validate on the server.** Client-side checks are convenience, never the guarantee.
   Locks and business rules must be *enforced*, not merely hidden in the UI.
6. **Every write is audited.** Creates and updates append to `audit_log`.
7. **Master data is never deleted.** Deactivate instead. History and references stay intact.
8. **Two companies, permanently.** One parent (*induk*), one child (*anak*). This is a
   foundational invariant, not configuration — build on it directly rather than
   abstracting it into a generic multi-company design.
9. **Indonesian UI, English code.** User-facing strings are Indonesian; identifiers,
   comments and commit messages are English.
10. **Authorization is server-side and permission-based.** Hiding a button is
   presentation. Every route and every Server Action asks for a named permission
   itself. Never branch on a role name in business logic — ask for the permission.
11. **A foreign amount and its base value are two independent facts.** Every book
   records both, and neither is derived from the other. A rate is either an input
   that creates base value, or an output read off a balance that already has some —
   never both, and never fetched from anywhere. §10 rules 66–76 and §12.

---

## 3. Architecture

```
Browser
  │
  ├─ Server Components  ──► src/lib/siba/records.ts ──► Prisma ──► PostgreSQL
  │    (page.tsx files fetch and serialize)
  │
  └─ Client Components  ──► Server Actions (src/app/actions/*) ──► Prisma ──► PostgreSQL
       (interactivity: tables, forms, dialogs)          │
                                                        └─ revalidatePath() + router.refresh()
```

**There is no REST/GraphQL API layer, by design.** Reads go through Server Components;
writes go through Server Actions. Do not add an API route unless an external consumer
genuinely requires one.

**Everything passes the same gate.** `src/lib/siba/auth.ts` resolves the session from
the cookie and answers every authorization question. Pages call `requireAuth` /
`requirePermission`; Server Actions call `actorOrDeny` / `authorizeAction`. Nothing
reads the session cookie directly, and no page or action carries an authorization rule
of its own.

### Major components

| Layer | Location | Responsibility |
| --- | --- | --- |
| Entity registry | `src/lib/siba/entities.ts` | Field + column config driving list, detail and form |
| Navigation model | `src/lib/siba/nav.ts` | Modules → groups → entities; rail and submenu |
| Purpose seed data | `src/lib/siba/rules.ts` | `SEED_PURPOSES`: the historical 22, planted once. **Not a runtime source** |
| Purposes | `src/lib/siba/purposes.ts` | `syncPurposes` generates them from the classification; `allPurposes` / `availablePurposes` read them; `server-only` |
| Classification rules | `src/lib/siba/classification.ts` | Budget Category -> Partner Category -> Partner, as pure functions over a catalogue, plus `DIRECTION_TEXT`. Client-safe |
| Classification data | `src/lib/siba/classification-data.ts` | `loadClassification` — the catalogue read from `sys_budget_category` and `sys_budget_partner_category_mapping`; `server-only` |
| FX kernel | `src/lib/siba/fx.ts` | `originate` / `relieve` / `drawLayer` / `settle` / `fxDifference` — pure arithmetic over numbers, no database, no module dependency; client-safe so the form previews exactly what the Server Action computes |
| Currency rules | `src/lib/siba/currency.ts` | The base currency, which resource may settle which document, and where a kurs comes from (`identity` / `layer` / `entered`); client-safe |
| Account numbering | `src/lib/siba/account-code.ts` | The dotted lineage code — parsing, segments, ordering; client-safe |
| Company access | `src/lib/siba/company-access.ts` | Permissions -> the Companies a user may read; `server-only` |
| Journal | `src/lib/siba/journal.ts` | The posting engine and the shared balance rule — writes the journal a posting produces, and the draft CRUD a manual journal is edited through. `JRN-` / `JUR-` numbering; `server-only` |
| General Ledger | `src/lib/siba/ledger.ts` | General Ledger and Trial Balance over journal lines, `closingBalances` at `(account, partner?)` grain, and the shared `openingBasis` that stands on an Opening Balance snapshot rather than scanning a Company's whole history; `server-only` |
| Opening Balance | `src/lib/siba/opening-balance.ts` | The immutable per-Company, per-year snapshot: writing one, reading one back, and `openingBasisFor`, which is what the two ledger reports open from. `OPB-` numbering; `server-only` |
| Fiscal Year closing | `src/lib/siba/closing.ts` | The seven blocking checks, the closing journal preview, and the one transaction that writes the `CLS-` journal, the `OPB-` snapshot and the closing record. Names no other module's table; `server-only` |
| Permission catalogue | `src/lib/siba/permissions.ts` | Every capability in the system; client-safe |
| Seeded roles | `src/lib/siba/roles.ts` | ADMIN / STAFF and their grants |
| Authorization gate | `src/lib/siba/auth.ts` | `requireAuth`, `requirePermission`, `authorizeAction` |
| Access resolution | `src/lib/siba/access.ts` | User -> active roles -> permissions, read per request |
| Sessions | `src/lib/siba/session.ts` | Issue, validate, revoke; opaque token, SHA-256 at rest |
| Credentials | `src/lib/siba/login.ts` | bcrypt verification, password rules |
| User/role admin | `src/lib/siba/user-admin.ts` | Guarded service; all admin-protection rules |
| Own account | `src/lib/siba/profile.ts` | Profile read/edit, own password change |
| Entity permissions | `src/lib/siba/entity-access.ts` | Registry entity -> permission per operation |
| Data access | `src/lib/siba/records.ts` | Generic list/get/options/computed, COA tree, the account rules the actions enforce; `server-only` |
| Record naming | `src/lib/siba/record-title.ts` | How a record names itself, for forms, lists and the audit log; client-safe |
| Audit vocabulary | `src/lib/siba/audit-events.ts` | An `event` key -> its past-tense label, icon and tone, read from the owning workflow table; client-safe |
| Audit reading | `src/lib/siba/audit.ts` | `entity_key` -> subject, `row_id` -> title, each resolved by the owning module; `server-only` |
| Fiscal calendar | `src/lib/siba/fiscal.ts` | Fiscal Year shape, generation of its twelve periods, reading them back, the posting lock (`checkPostingPeriod`), and the per-Company closing record with the year's `Closed` rollup over it; `server-only` |
| Fiscal Year lifecycle | `src/lib/siba/fiscal-workflow.ts` | Draft → Open → Closed, each transition's permission, the max-two-Open rule, and the `runAt` that sends closing to its own screen; client-safe |
| Startup check | `src/lib/siba/startup-check.ts` | Is the database the one this build expects; read at boot by `instrumentation-node.ts`; `server-only` |
| System Default catalogue | `src/lib/siba/system-defaults.ts` | Every value the app prefills with; client-safe |
| System Default store | `src/lib/siba/system-settings.ts` | Reads and writes `sys_setting`, resolves a default against its master; `server-only` |
| Header button order | `src/lib/siba/header-actions.ts` | Where a button sits in `.ph-act` and how it is drawn — one tone, read by every lifecycle table; client-safe |
| Budget lifecycle | `src/lib/siba/budget-workflow.ts` | The transition table — from-status, to-status, permission; client-safe |
| Budget data | `src/lib/siba/budget.ts` | Month rollups, budget reads, classification enforcement, `BGT-` numbering; `server-only` |
| Cash Bank Book | `src/lib/siba/cash-bank.ts` | Append-only ledger writes on **both measures**, the materialised balance, `CBL-` numbering, per-currency summary; `server-only` |
| Rate layers | `src/lib/siba/cash-bank-layers.ts` | A foreign resource's parcels of currency — `openLayer`, `drawFromLayer`, `reconcileLayers`, the layer report, `CBLY-` numbering. Owned by the Cash Bank Book, so it imports only the kernel; `server-only` |
| Subledger catalogue | `src/lib/siba/subledger-catalogue.ts` | Which categories keep a subject book, which way each one moves; client-safe |
| Subject books | `src/lib/siba/subledger.ts` | Append-only `sub_ledger` writes on both measures, the materialised position, `SBL-` numbering, the six reports; `server-only` |
| Manual journal | `src/lib/siba/manual-journal.ts` | Which account a person may write to by hand, which line needs a Partner, which needs a kurs — the control-account rule; `server-only` |
| Journal lifecycle | `src/lib/siba/journal-workflow.ts` | A manual journal's Draft → Post / Cancel, one transition table; client-safe |
| Transaction lifecycle | `src/lib/siba/transaction-workflow.ts` | Draft → Post / Cancel, one transition table; client-safe |
| Finance data | `src/lib/siba/finance.ts` | Header and line enforcement, Budget eligibility, `applyPosting`, the funded posting both Companies share, `CBT-` numbering, realization trace; `server-only` |
| Funding Request | `src/lib/siba/funding.ts` | Raising, withdrawing and confirming a request, `FR-` numbering; depends on Finance and never the reverse; `server-only` |
| Transfer catalogue | `src/lib/siba/transfer-catalogue.ts` | The three transfer Purposes and the currency relation each asserts; client-safe |
| Transfer valuation | `src/lib/siba/transfer-valuation.ts` | What one transfer line is worth on each side — pure, so the form previews exactly what the posting computes; client-safe |
| Transfer lifecycle | `src/lib/siba/transfer-workflow.ts` | Draft → Post / Cancel, one transition table; client-safe |
| Transfer data | `src/lib/siba/transfer.ts` | Header and destination enforcement, `applyTransfer`, `TRF-` numbering; `server-only` |
| Report catalogue | `src/lib/siba/reports.ts` | Every Report View — slug, permission, parameter set; client-safe |
| Dashboard composition | `src/lib/siba/dashboard.ts` | The commitment funnel, the cash position and the setup gaps, asked of each owning module; names no table itself; `server-only` |
| Write path | `src/app/actions/master.ts` | Validation, create, update, status toggle, audit |
| Budget writes | `src/app/actions/budget.ts` | Create, edit, and the lifecycle transitions |
| Finance writes | `src/app/actions/finance.ts` | Create, edit, the eligible-Budget query, and Post / Cancel |
| Funding writes | `src/app/actions/funding.ts` | Ajukan Dana, withdraw, and the induk's confirmation |
| Shell | `src/components/shell/app-shell.tsx` | Topbar, icon rail, collapsible submenu |
| Registry pages | `src/components/master/entity-pages.tsx` | The four registry pages, mounted under each owning module |
| Generic UI | `src/components/master/`, `src/components/ui/` | Table, tree, form, and the shared controls: `Combobox`, `Select`, `DateInput`, `MoneyInput`, `SearchField`, `Dialog`, `ConfirmDialog`, toast |

### The module contract

A module is a **building block**: it owns its tables, its rules, its permissions and
its routes, and other modules reach it only through functions it exports. SIBA ships as
one deployable unit, and that is not changing — but a module that cannot be replaced or
lifted out without unpicking three others is not really a module, and the boundary is
what keeps future work cheap. Enforced by `tests/module-boundaries.test.ts`, which is a
source scan and needs no database.

| Module | Owns (tables) | Data module + writes |
| --- | --- | --- |
| Budget | `bud_budget` | `lib/siba/budget.ts`, `app/actions/budget.ts` |
| Finance | `fin_cash_bank_transaction(_line)` | `lib/siba/finance.ts`, `app/actions/finance.ts` |
| Funding | `fin_funding_request` | `lib/siba/funding.ts`, `app/actions/funding.ts` |
| Transfer | `fin_cash_bank_transfer(_line)` | `lib/siba/transfer.ts`, `app/actions/transfer.ts` |
| Cash Bank Book | `cash_bank_ledger`, `cash_bank_balance`, `cash_bank_layer` | `lib/siba/cash-bank.ts`, `lib/siba/cash-bank-layers.ts` |
| Subject books | `sub_ledger`, `sub_ledger_balance` | `lib/siba/subledger.ts` (+ `subledger-data.ts`, which reads the Budget Categories the books are) |
| Journal | `acc_journal(_line)` | `lib/siba/journal.ts` (`ledger.ts` reads them — rule 22); the manual journal's rules sit above it in `lib/siba/manual-journal.ts` + `app/actions/journal.ts` |
| Fiscal | `acc_fiscal_year`, `acc_fiscal_period`, `acc_fiscal_closing` | `lib/siba/fiscal.ts` |
| Opening Balance | `acc_opening_balance(_line)` | `lib/siba/opening-balance.ts` |

Three rules, in force:

1. **A module's tables are named only by that module.** No other file writes
   `prisma.<delegate>` for a table it does not own — the data module *and* its Server
   Action count as one block, because they are two layers of the same thing.
2. **Dependencies point one way.** Finance executes what Budget plans, so Finance may
   depend on Budget and never the reverse: a plan is complete without an execution.
   Funding sits above Finance on the same reasoning — a realization is complete
   without a funding, which is only how the cash reached it — so `funding.ts` reads
   documents and moves their status through functions `finance.ts` exports, and
   `finance.ts` names nothing in Funding. The same applies to the UI —
   `components/finance` may reuse `components/budget`, not the other way round.
3. **The books depend on nothing.** `cash-bank.ts`, `cash-bank-layers.ts`,
   `journal.ts` and `subledger.ts` import only the shared kernel
   (`document-number`, `period`, `account-code`, `permissions`, `fx`, `currency`)
   and, for the subledgers, their own client-safe catalogue. They are independent
   historical stores (concept doc §2.5); a book that imported its writer could not
   be lifted out, and would invite being derived from it. `fx.ts` in particular
   depends on **nothing at all** — it is arithmetic, and a kernel that imported a
   business rule would stop being one.

**Cross-module references.** A foreign key into *master* data (Company, Partner,
Currency, Account) is correct and expected. A reference to another module's **document**
goes through the weak `(doc_type_id, doc_id)` pair instead — which is already how
`cash_bank_ledger`, `acc_journal` and `fin_cash_bank_transaction_line` all behave. That
pair is what lets a book survive the module that wrote into it being replaced.

**The shared kernel** is small on purpose: `auth`, `access`, `permissions`, `prisma`,
`format`, `account-code`, `document-number`, `period`, `fx`, `currency`. Everything in
it is needed by several modules and would never be extracted on its own. `fx` and
`currency` earned their place the same way: the form, the Server Action and all three
books have to answer "what is this worth in base?" identically, and a rule that exists
twice is a rule with two answers.

**Two boundaries are still crossed**, baselined in the test rather than hidden — see
§17. Adding a third fails the suite.

### Data flow for a Master page

```
page.tsx (server)
  → requireEntity(slug) / entityBySlug(slug)
  → listRows() + refOptions() + computedValues()
  → serialize()            // Decimal → number, Date → ISO string
  → <EntityList /> (client)
       → user edits → Server Action → validate → Prisma → audit → revalidatePath
       → router.refresh()
```

**Serialization boundary:** Prisma `Decimal` and `Date` do not survive the
server→client boundary. Everything passed into a client component must go through
`serialize()` in `records.ts`.

---

## 4. Technology Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript (strict) | |
| Framework | Next.js 16.3.5, App Router, Turbopack | |
| UI | React 19.2 | |
| ORM | Prisma 7.10 | **Requires a driver adapter** — see §12 |
| DB driver | `@prisma/adapter-pg` | |
| Database | PostgreSQL 18 (local dev) | |
| Styling | Plain CSS, one global stylesheet | **No utility framework — deliberate** |
| Fonts | `next/font` — Plus Jakarta Sans + JetBrains Mono | |
| Auth | Built on Next.js + `bcryptjs` + `node:crypto`. **No auth library** — see §12 | |
| Validation | Hand-written in Server Actions; `zod` installed but **unused** | |
| Hashing | `bcryptjs` (seed only so far) | |
| Lint | ESLint 9 + `eslint-config-next` | |
| Seed runner | `tsx` | |
| Tests | `node:test` via `tsx` — zero extra dependencies (`npm test`) | |

Path alias: `@/*` → `./src/*`.

---

## 5. Repository Structure

```
Initialization/          Read-only source material (concept, DBML, mockup, UI study,
                         the two multi-currency concept documents, COA template)
SIBA DBML/
  SIBA DBML.md           The current schema as DBML — one file, updated in the
                         same change as any migration (§9). Not to be confused
                         with `Initialization/SIBA 3.0 DBML.txt`, which is the
                         frozen source material the project was converted from
prisma/
  schema.prisma          Data model; deviations from the DBML commented inline
  migrations/            Applied migrations
  seed.ts                System data only — idempotent, never touches business data
scripts/
  backfill-account-flags.ts  One-off: brings `is_postable` and
                         `is_control_account` back into agreement with the
                         structure that decides them — leaf for the first,
                         what reconciles against the account for the second.
                         Idempotent, sets and clears. Run by hand, never by
                         install or CI
  backfill-subledger.ts  One-off: replays already-posted Cash Bank Transactions
                         into the subject books, in document order and
                         idempotently. Run by hand, never by install or CI
  truncate-transactions.ts  Empties every transaction store and leaves master
                         and system data standing — the documents, the books
                         and their audit rows, in one transaction. Reports and
                         refuses without `--confirm`. Run by hand, never by
                         install or CI
  seed-showcase.ts       Dev convenience: a believable year of business data, so
                         every menu has something in it — Partners for both
                         Companies, a Chart of Accounts, the mappings, the cash
                         resources with their opening balances and layers, a
                         fiscal year, Budgets across the lifecycle, and the
                         documents that realize them. **Not** the seeder —
                         ordinary inserts, run by hand, never by
                         install/migrate/reset/CI. Anything posted goes through
                         the real engine, never a direct book insert
src/
  proxy.ts               Optimistic redirect to /login (NOT a security boundary);
                         lets /login and /api/health through without a cookie
  instrumentation.ts     Runs once before the server serves. `register` runs in
                         the Edge runtime too, so this file holds only the
                         runtime check and a dynamic import — anything it can
                         see is compiled for Edge and warned about there
  instrumentation-node.ts  The check itself. In production a schema behind the
                         build exits the process rather than throwing — a thrown
                         `register` leaves Next listening and answering 500,
                         which a supervisor reads as healthy
  app/
    layout.tsx           Root layout: fonts, metadata
    page.tsx             Sends a signed-in user to their first permitted page
    forbidden.tsx        403 outside the shell
    globals.css          Design system (see §12)
    (auth)/login/        The only page reachable without a session
    (app)/               Route group carrying the shell
      layout.tsx         requireAuth + shell; nav filtered by permission
      forbidden.tsx      403 inside the shell — the refusal screen
      error.tsx          Generic failure screen (authz never lands here)
      dashboard/
      master/[entity]/   Dynamic: list, /new, /[id], /[id]/edit
      accounting/[entity]/ The same four registry pages — COA, mapping, Fiscal Year
      accounting/journal/  The register, plus the manual journal: /new,
                         /[id], /[id]/edit
      accounting/closing/  Bespoke: the closing workspace — checklist,
                         journal preview, one confirm
      accounting/opening-balance/  Read-only: the register and /[id]
      budget/budget/     Bespoke, not registry: month list, /month/[period],
                         /new, /[id], /[id]/edit
      finance/cash-bank-transaction/  Bespoke: list, /new, /[id], /[id]/edit
      finance/cash-bank-transfer/  Bespoke: list, /new, /[id], /[id]/edit
      finance/funding-request/  The induk's queue: list and /[id] (confirm)
      finance/report/[report]/  Every Report View, driven by `reports.ts`
      settings/[entity]/ The registry pages again — the classification chain:
                         Budget Category, Partner Category, Transaction Purpose
      settings/user/     Admin-only user management (bespoke, not registry)
      settings/role/     Admin-only roles + permission matrix
      settings/system-default/  Values the application prefills with
      settings/profile/  Own account — authentication only, no permission
    actions/
      master.ts          Master module writes
      budget.ts          Budget writes: create, edit, lifecycle transitions
      finance.ts         Cash Bank Transaction writes, plus Post
      funding.ts         Ajukan Dana, withdraw, and Confirm Funding
      transfer.ts        Cash Bank Transfer writes, plus Post
      fiscal.ts          The Fiscal Year lifecycle — the one way out of Draft
      journal.ts         Manual journal writes: create, edit, Post / Batalkan
      settings.ts        System Default writes
      auth.ts            login / logout
      users.ts           User and role administration
      profile.ts         Own profile and password
  components/
    icon.tsx             <Icon name size /> renderer
    icon-paths.ts        SVG path map
    shell/               App shell
    master/              entity-pages (the four shared pages), EntityList,
                         AccountTree, EntityForm, EntityLocked, CompanyFilter,
                         CashBankBookCard (the master's link into the report)
    budget/              BudgetMonthList, BudgetList, BudgetForm,
                         ApproveDialog, ReportPicker, CashBalanceDialog,
                         RealizationCard
    finance/             TransactionList, TransactionForm, BudgetPicker,
                         KursSelect (which rate layer a payment draws on),
                         FundingList, FundingDetail,
                         TransferList, TransferForm
    report/              ReportView chrome, ReportSummary, its two filter bars
                         (ReportParams for one subject, SubjectParams for
                         several), and the report bodies: Cash Bank Ledger,
                         Cash Bank Balance, Cash Bank Layer, General Ledger,
                         Trial Balance, Subledger
    dashboard/           Dashboard — the funnel, the cash table, the positions
    settings/            UserList, UserForm, RoleList, RoleForm, ProfileView
    auth/                LoginForm, AccessDenied
    accounting/          FiscalPeriods (shown inside a Fiscal Year),
                         FiscalYearActions, JournalList, JournalDetail,
                         JournalActions, JournalForm (the manual journal)
    ui/                  form (FormBody/FormSection/FormRow/Field — every
                         form in the application is built from these),
                         Combobox, Select, DateInput, MoneyInput, RateInput,
                         SearchField, AnchoredPopup (every dropdown hangs off it),
                         RecordHistory + RecordHistoryCard (a record's own
                         audit trail, at the foot of every form),
                         Dialog, ConfirmDialog, ToastProvider
  lib/
    prisma.ts            Client singleton with adapter; the cache is keyed on the
                         generated class, so `prisma generate` retires it (§12)
    format.ts            Date/number/money/rate formatting (UTC-based). The only
                         place a date, an amount or a kurs is formatted (§12)
    siba/                entities, nav, rules, purposes, classification,
                         classification-data, records, users, account-code,
                         header-actions,
                         company-access, journal, ledger,
                         fx, currency,
                         permissions, roles, access, auth, auth-errors,
                         session, login, user-admin, profile, entity-access, fiscal,
                         fiscal-workflow, journal-workflow, manual-journal,
                         budget, budget-workflow, cash-bank,
                         cash-bank-layers,
                         subledger, subledger-catalogue, subledger-data,
                         finance, transaction-workflow, funding,
                         transfer, transfer-catalogue, transfer-valuation,
                         transfer-workflow, reports,
                         system-defaults, system-settings
  generated/prisma/      Prisma client output — gitignored, never edit
tests/                   Security, Accounting, Budget, Finance, Funding, Transfer, the books,
                         fx, layers, money-input, reports, fiscal, settings, schema
                         and design-system suites (node:test); helpers.ts builds
                         and cleans up its own business fixtures
.claude/skills/          Project skills — `run-siba` brings the app up locally (§6)
.github/workflows/ci.yml PostgreSQL service -> migrate -> seed -> lint -> build -> test
```

**`src/generated/prisma/` is gitignored.** After cloning, run `npx prisma generate`.

---

## 6. Development Workflow

Verified commands only.

```bash
npm install                  # install
npm run dev                  # dev server → http://localhost:3000
npm run build                # production build (also typechecks)
npm start                    # run the production build
npm run build:standalone     # build + assemble .next/standalone (the deploy artifact)
npm run start:standalone     # run that artifact exactly as a server would
npm run lint                 # ESLint
npm test                     # test suite — needs a migrated, seeded database
npm run db:seed              # sync system data; idempotent, destroys nothing
                             # (runs under --conditions=react-server: it imports
                             #  `purposes.ts`, which is server-only)
npm run db:seed-showcase     # dev only: a believable year of business data (NOT the seeder)
npm run db:backfill-subledger  # one-off: subject books for already-posted documents
npm run db:backfill-account-flags  # one-off: resync Postable + Control Account to the structure
npm run db:truncate-transactions          # reports what it would delete, deletes nothing
npm run db:truncate-transactions -- --confirm  # DESTRUCTIVE: empties the documents and
                                               # the books, keeps master + system data
npm run db:reset             # DESTRUCTIVE: drop, re-migrate, reseed
npx prisma generate          # regenerate client after schema changes
npx prisma migrate dev       # create + apply a migration
npx prisma studio            # browse the database

# Against the DEPLOYED database rather than the local one. Both read the
# connection from `.env.neon` through `scripts/with-remote.js`.
npm run db:neon-seed         # sync system data on Neon; idempotent, destroys nothing
npm run db:neon-seed-showcase  # dev/demo only: the same believable year, on Neon
npm run db:neon-reset        # reports what it would destroy, destroys nothing
npm run db:neon-reset -- --confirm  # DESTRUCTIVE: drops and re-migrates the deployed
                                    # database. Run db:neon-seed afterwards — reset
                                    # does not seed (there is no `prisma.seed` config)
```

**First-time setup:** install PostgreSQL, `cp .env.example .env`, set `DATABASE_URL`,
create the database (`createdb -U postgres siba30`), then `npx prisma migrate dev` and
`npm run db:seed`. Full instructions are in `README.md`.

**"Run SIBA"** — the `run-siba` skill (`.claude/skills/run-siba/`) does the whole
local bring-up: starts PostgreSQL, prepares `.env`, installs, generates the Prisma
client, migrates, seeds the system data, and leaves `npm run dev` serving on port
3000. It refuses to run in a remote/cloud session, where `localhost` is not the
user's machine.

**Tests cover the security paths, plus the Accounting, Budget and Finance enforcement
points.**
`npm test` runs `tests/*.test.ts` against a real, seeded database — authentication,
sessions, RBAC, the admin protections, a structural audit that every Server Action
resolves its caller before acting, the rules that decide which account a Cash & Bank
resource may post to, whether a parent account would close a loop, and which Partner
Categories a Budget Category admits, and the Budget lifecycle: which transition is
legal from which status, that approval's classification satisfies the whole
category → partner-category → partner chain, and that Budget Month stays derived
(no table, no month column). The Finance suite holds the execution layer: that a
document's header admits only the Budgets concept doc §9 names — approved, same
Company, same direction, same Category, same Partner where the Purpose takes one, same
currency, still outstanding — that a line naming anything else is refused even when
submitted directly, that a Draft moves neither the book nor `realized_amount`, and that
Post writes the ledger entry, the balance and every Budget's realization together, is
refused when a Budget has since closed, and leaves nothing behind when it refuses.
The funding suite holds the intercompany bridge: that the route is decided by the
Company rather than by a setting, that submitting freezes the document and moves
nothing, that the induk's confirmation writes one cash entry, a balanced journal
each carrying the two Companies' positions, the realization and the request's
closure together — in both directions, since an anak receipt mirrors an anak
payment — that it writes **no** subject-book entry for the intercompany leg while
still writing the anak's own, and that an unfinished bridge, a resource in the wrong
currency, an anak resource and a Budget closed since each refuse before anything is
written.
The transfer suite holds the three properties a transfer lives or dies by, none
of which is visible on the screen: that base value is **conserved** to the cent,
including when a layer is drawn to nothing and its remainder is released rather
than recomputed; that an FX difference arises on a Pencairan and on nothing
else, with the gain on the credit side and the loss on the debit side; and that
layers propagate one-for-one, so three destinations make three destination
layers at the source layer's rate. It also holds the refusals — a Purpose
contradicted by its source, a destination in a third currency, the source as its
own destination, a destination in the other Company, a document larger than its
one layer — and the atomicity: a Pencairan whose FX account has gone missing
refuses *after* the layer was drawn inside the transaction, and the rollback
must leave that layer unspent.
The reports suite holds the one property a money report lives or dies by —
`opening + in − out = closing` — pushed at from the edges: entries dated exactly on each
boundary, entries before the period folding into the opening rather than appearing as
rows, a period with no movement still answering with its balances, a deactivated resource
that still moved money staying visible, and the two reports agreeing with each other for
the same subject and period. It also pins the navigation change the report routes needed,
so `/master/partner/12` and `/budget/budget/month/5` cannot silently stop resolving,
and it holds the Company scope: a resource belonging to a Company the reader may not
see is not a row, and its book reads as not found rather than as data.
The manual journal suite holds the rule the feature exists for: that each of the
three structural control-account sources refuses a hand-written line by itself
and the refusal names the book, that a Biaya mapping target is deliberately
**not** one, that the picker offers exactly what the check accepts, that a draft
reaches neither ledger report and is not reported as unbalanced, that an account
which became a control account after the draft was written refuses at Post and
leaves the draft untouched, and that a posted journal — manual or automatic —
cannot be edited, re-posted or cancelled.
The fiscal suite also holds the Fiscal Year lifecycle —
that `status` is not an isian, that Draft is the only status a year opens from, and
that nothing writes Draft or Closed — and the settings suite holds what a System
Default may do: a key outside the catalogue is never written, and a deactivated
Currency is stored but never prefilled. A design-system suite guards the UI conventions that had already
drifted once — that a page header runs danger → neutral → primary so a
destructive button never lands where a confirming one just was, that no native
`<select>`, date input or number input is rendered anywhere, that `globals.css` declares no bare `.ph` rule (it is the placeholder class
as well as the page header, and a bare one silently misaligned every dropdown
placeholder in the application), that the search box, the dialog chrome and a tinted
dialog icon each have exactly one implementation, and that nothing formats a date or a
number outside `lib/format.ts`. It also holds the form layout: every labelled field
goes through `components/ui/form.tsx`, no help is rendered beside a control, no form
keeps a summary side card or a page subtitle, and each document form titles itself with
its own number. It also holds the order a form is filled in: a prerequisite is
declared once as `resets`, it is listed **before** the field it gates in every
registry entity, and a waiting clause reads `Pilih <what> dulu…` rather than
naming none of the fields it could mean. And it holds that neither of an
account's two structural flags is offered on a form — Postable not at all,
Control Account read-only — and that nothing sets one without also being able
to clear it. It reads source text and the registry, so it needs no database and
costs nothing. A schema suite closes the loop underneath all of
it: every model in `prisma/schema.prisma` must have a delegate on the generated client
and a table in the database, so a checkout where `prisma generate` or `prisma migrate`
has not been run fails here rather than at the first page that reads the missing model.
Everything else is untested, so "validate" still means
`npm run build`, `npm run lint`, `npm test`, and exercising the feature in a browser.
State plainly when something is unverified.

The runner is `node:test` through `tsx`, with no extra dependency:
`node --env-file-if-exists=.env --conditions=react-server --import tsx --test`.
`--conditions=react-server` is what lets a test import a `server-only` module.

### Windows / PowerShell gotchas

- `Set-Content -Encoding utf8` (PowerShell 5.1) writes a **BOM**, which silently breaks
  CSS parsing and can corrupt TS files. Use `[System.IO.File]::WriteAllText($p, $text,
  (New-Object System.Text.UTF8Encoding($false)))`, or the Write tool.
- Postgres CLI tools live in `C:\Program Files\PostgreSQL\18\bin` and are not on PATH.
- `npm` is `npm.cmd`; its PowerShell wrapper reports misleading exit codes.

---

## 7. Coding Conventions

### Naming

| Thing | Convention | Example |
| --- | --- | --- |
| Prisma model | PascalCase + `@@map` to snake_case table | `MCashBank` → `m_cash_bank` |
| Prisma field | **snake_case**, matching the DBML and the registry | `company_id` |
| DB table | snake_case, prefixed by domain | `sys_`, `ref_`, `m_`, `acc_`, `bud_`, `fin_` |
| TS file | kebab-case | `entity-list.tsx` |
| React component | PascalCase | `EntityForm` |
| Variable / function | camelCase | `refOptions` |
| Route segment | kebab-case slug | `/master/cash-bank` |

**Why snake_case Prisma fields:** the entity registry references columns as strings
(`{ field: "company_label" }`), and the mockup's logic uses the same names. Keeping them
identical means registry configs port verbatim. Do not "modernise" these to camelCase.

### Patterns

- **Server Components by default.** Add `"use client"` only for interactivity.
- Pages that read the database set `export const dynamic = "force-dynamic"`.
- Server Actions return a discriminated result (`{ ok: true, ... } | { ok: false, errors }`)
  rather than throwing for expected validation failures.
- After a mutating action: `revalidatePath()` on the server, `router.refresh()` on the client.
- Async params: Next 16 route params are Promises — `const { entity } = await params`.
- Comments explain **why**, not what. Default to none.
- Do not add error handling for cases the database or framework already prevents.

### Type safety

- `strict: true`. Avoid `any`; the one deliberate exception is the Prisma delegate map
  in `records.ts`, where delegates cannot be indexed by a runtime string.
- Modules touching the database import `"server-only"`.

---

## 8. UI / UX Conventions

**The stylesheet is the contract.** `src/app/globals.css` is the mockup's design system
lifted verbatim. Components emit its class names; they do not invent styles.

| Concern | Convention |
| --- | --- |
| Layout | Topbar → icon rail → collapsible submenu → content. Shell owns it. **Pressing a module in the rail always opens its submenu** — that is the only way a hidden one comes back, and it never toggles |
| Page header | `.ph` → `.crumb`, `.ph-row` (h1 + `.ph-act`), `.ph-sub`. **Sticky**, and `.ph-act` is where every action on the page lives |
| Button order | Inside `.ph-act`, left to right: **danger → neutral → primary**, one primary and it is rightmost. `headerButtonClass` draws it, `orderForHeader` places it — both in `lib/siba/header-actions.ts` |
| Row menus | A vertical menu is the opposite arrangement: **safe first, danger last**. `availableActions` returns that order |
| Cards | `.card` + `.card-h` (icon `.ci`, title `.ct`) |
| Tables | `.tw` wrapper → `table.grid`; sortable `th.srt`; `.pri` `.mut` `.num` cells |
| Identity cells | `.idc` = `.lab` code chip + `.nm` name |
| Status | `.bdg` + `s-ok` / `s-bad` / `s-warn` / `s-info` / `s-mute` |
| Tags | `.bdg` + `t-info` / `t-vio` / `t-acc` / `t-slate` |
| Forms | `.fgrid solo` → `FormBody` → `FormSection` → `FormRow` → `Field`, all from `components/ui/form.tsx`. **Never hand-written** |
| Form rows | Twelve columns. A field declares its share — `span={3\|4\|5\|6\|8\|12}`, half by default. Registry entities say it as `span` on the field config |
| Field help | One clause, lower case, no full stop, **on the label row** — never a `.help` div under the control. An error replaces it |
| Page heading | A document's number (`.docno`, mono) with its status badge beside it; a master record's name with its code as a `.docno sm` chip. Before the first save, a placeholder — `Budget Baru`, `User Baru` |
| Summary cards | **None.** Each fact sits where it is read; a closing note about the record's state is a `.fnote` at the foot of its card |
| Read-only fields | `.ro` — presented as text, **never disabled inputs** |
| FK pickers | `Combobox` — searchable, `CODE – Name` options. **The control itself is the search box**: opening turns it into a text input in place, and the popup carries no filter bar of its own |
| Sets | `MultiSelect` — a searchable picker that adds, chips that remove. **Never a checkbox per option**: a grid grows with the catalogue rather than with the answer |
| Dropdowns | `Select` — **never a native `<select>`**; `variant` picks the trigger class (`field` / `toolbar` / `compact` / `ctx`). Searchable once the list is long, and searched the same way — in the trigger. A long list of combinations takes `group` on its options and `listWidth="wide"` |
| Dropdown search | Every word must match, across label + hint + group. A list of facets is searched by naming facets — `pengeluaran cabang` — and one substring against the whole row finds nothing |
| Popups | `AnchoredPopup` draws every list and calendar — portalled to `document.body`, placed from the trigger's rect, flipping and clamping to the room it has. **Never positioned inside its control** |
| Direction | Always **Penerimaan** (`In`) and **Pengeluaran** (`Out`), everywhere. `directionText` in `lib/siba/classification.ts` is the one map; the raw enum is never shown |
| Dates | `DateInput` — **never `<input type="date">`**; types and shows `dd/mm/yyyy`, opens the app's own calendar |
| Amounts | `MoneyInput` — **never `<input type="number">`**; mono, right-aligned, grouped in thousands as it is typed, currency label inside the box. `size="sm"` inside a table |
| Rates | `RateInput` — a thin wrapper over `MoneyInput`, never a second control. `decimals={6}` and the pair inside the box (`USD → IDR`, `labelWidth="pair"`) are the whole difference (§12) |
| Foreign face | `formatForeignFace` — what a base figure was before it was base: `USD 1.000,00 @ 16.000,00`, in `.rsub` beside the row it belongs to. One function, because the Journal and the General Ledger had drifted to two |
| Separators | **`.` groups thousands, `,` separates decimals** — in what is displayed and in what is typed. A typed `.` groups; a decimal is reached with `,` (§12) |
| Rate layers | `KursSelect` — a layer is *chosen*, never a rate typed, and it is chosen in a `Dialog` where date, kurs, sisa and sumber are four columns. The field afterwards carries **only the kurs** |
| Search | `SearchField` in the `.toolbar` — icon, `Cari <what>…`, clear button. `grow` when it is the only control |
| Picker prompts | Always `Pilih <what>…` — for a `Combobox`, a `Select`, and anything that stands in for one |
| Prerequisites | A picker whose options another field decides takes `waitingFor` — **shown, in its place, not collecting an answer**, reading `Pilih <what> dulu…`. Never hidden, and never an open list saying "Tidak ada pilihan yang cocok" |
| Validation | Inline `.err` under the field + `.bad` on the control + error toast |
| Unsaved changes | `.ph-dirty` chip with pulse indicator, in `.ph-act` beside Simpan |
| Confirmations | `ConfirmDialog` — small, centred, one question: tinted icon, subject chip, **consequence copy** |
| Panel dialogs | `Dialog` — wide and left-aligned: fixed header (tinted `.mi sm`, title, subtitle, close), scrolling `.rp-body`, fixed `.rp-foot`. Everything that is not a confirmation |
| Feedback | Toasts via `useToast()` |
| Empty states | `.empty` — icon, heading, explanation, CTA only when the user can act. Two sizes: `.empty` fills a page, `.empty.sm` sits inside a card, a dialog or a report body. **Never a hand-written padding** |
| Icon tints | `.mi` + `.t-ok` / `.t-bad` / `.t-brand` / `.t-warn` — never a `background`/`color` pair written inline |
| Responsive | Desktop-first. `.fgrid` collapses at 1320px, `.frow` at 1000px, nav at 860px. |

**Anti-patterns explicitly rejected** (from `akui_proto_ui_reference.md`, its §9 and §11):

- Actions parked at the bottom of a form, where a reader has to scroll to find
  out what they can do. Every action belongs in `.ph-act`.
- Read-only presented as disabled inputs.
- Font scales below ~10px.
- Duplicating filters in both a header row and a separate filter panel.
- Saturated solid badges stacked many-per-cell.

**Links:** the mockup used `<button>` with a hash router. Real routing uses `<Link>`,
so `globals.css` ends with an anchor reset. Keep shared classes working for both.

---

## 9. Data / Database Conventions

| Rule | Detail |
| --- | --- |
| Primary keys | `Int @id @default(autoincrement())` — **not BigInt** |
| Timestamps | `DateTime @db.Timestamptz(6)`; `created_at` default now, `updated_at` `@updatedAt` |
| Authorship | `created_by Int`, `updated_by Int?` — plain Ints with **no FK**, exactly as the DBML declares |
| Money | `Decimal @db.Decimal(18, 2)` |
| Exchange rates | `Decimal @db.Decimal(18, 6)`. Six decimals, and the kurs field accepts exactly that many — `formatRate` in `src/lib/format.ts` is the only thing that renders one |
| Base measures | `Decimal @db.Decimal(18, 2)`, beside the face amount on every book row and balance row. Written once, never recomputed |
| Calendar dates | `@db.Date`, stored at UTC midnight. **Displayed `dd/mm/yyyy` everywhere** — always via `formatDate` in `src/lib/format.ts`, which reads UTC parts. ISO stays the wire and storage form |
| Status | Enum `ActiveStatus` (`Active` / `Inactive`) on master tables |
| Deletion | **None.** Master data is deactivated, never hard-deleted. Do not add delete actions or `onDelete: Cascade` to master tables. |
| System codes | `<prefix>.<4 digits>` — `comp.0001`, `part.0011`. Generated by `nextCode()`, never user-entered. |
| Document numbers | `BGT-0001`, `CBT-0001` |
| Audit | Every create/update appends to `audit_log` (`entity_key`, `row_id`, `action`, `by`, `at`) |
| Passwords | bcrypt, cost 10. `password_hash` is read in exactly two functions and selected into nothing else |
| Session tokens | 256-bit random, stored only as SHA-256 |
| Session rows | Housekeeping, not business records. Revoked on logout/deactivation/password change, then deleted once dead — the no-delete rule covers master data and history, not `sys_session` |
| Grants | `sys_user_role` and `sys_role_permission` rows are grants, not master data: revoking deletes the row and writes an audit entry. The no-delete rule covers records, not assignments |

**Identity triple.** Master records carry three identifiers, and the distinction matters:

- `*_code` — system-generated, immutable, shown as a technical reference
- `*_label` — short human identifier (`Holding`, `IDR`, `1101`); dropdowns show `label - name`
- `*_name` — full name

**A balance is never a column on a master table.** `m_cash_bank` has no balance
column and must never gain one. A cash or bank resource's balance comes from its
book: `cash_bank_ledger` holds every movement and `cash_bank_balance` holds the
running total, written in the same transaction as the entry that moved it. Read a
balance through `src/lib/siba/cash-bank.ts`, never by summing something else.

**The Cash Bank Book is append-only.** Entries are never updated and never deleted
— including by a correction, which is itself a new entry. That is the whole point
of a book: the balance can always be re-derived, and `rebuildCashBankBalance`
proves the materialised total still matches. Never add an update or delete path to
`cash_bank_ledger`.

**Every book entry carries two measures.** The amount in the currency that
actually moved, and what it was worth in base currency at the moment it moved —
`amount` / `base_amount` on `cash_bank_ledger` and `sub_ledger`, `balance` /
`base_balance` on both balance tables. Neither is derived from the other. The
base figure is **history**, not a re-quotable conversion: re-deriving it at a
later rate would destroy the only number that answers what the currency movement
cost. See §12, "A rate is an input or an output, never both".

**Money in different currencies is still never added together at face value.**
USD 3.500 and Rp 45.000.000 are quantities of different things, so a figure
spanning currencies is reported as a list, not a sum (`MoneyTotal[]` and
`formatTotals` in `src/lib/format.ts`). The base measure does not change this —
it answers a different question, and the Journal and the General Ledger are where
it is read. **Never sum across currencies by multiplying through a rate you
fetched yourself**: the only rates in this system are the ones recorded on the
movements themselves.

**Migrations:** always `npx prisma migrate dev`. Never hand-edit an applied migration.
Never use `prisma db push` on this project.

**Every migration updates `SIBA DBML/SIBA DBML.md` in the same change.** That
file is the one authoritative DBML for the current schema — a new table, a new
column, a new enum, a dropped column or a changed constraint all land in it
before the work is reported done, so it can be read at any moment as the
up-to-date picture without reconstructing one from `schema.prisma` or the
migration history. It is documentation rather than a generated artifact, so it
carries the same explanatory comments the Prisma schema does. If the two
disagree, the DBML is what is stale. `Initialization/SIBA 3.0 DBML.txt` is a
different file entirely: frozen source material, never updated to match.

**Seed:** `prisma/seed.ts` syncs **system data only** and nothing else — see §12.
It is idempotent, creates what is missing, deletes no business data, and is safe to
run against a live database. Everything a user can create through the GUI is
deliberately absent from it.

---

## 10. Business / Domain Rules

Frozen structural rules:

1. **Two companies, permanently.** Exactly two seeded companies: one parent (*induk*,
   `is_parent = true`) and one child (*anak*). There will never be a third, a second
   parent, or a second child. This is a **foundation of the application**, not a
   configurable setup — business logic throughout the system may rely on it.
   The child **always** requests funding from the parent; resolve the parent from the
   company master at runtime. No relationship table, no configurable provider.
   Consequently **Company is create-locked and edit-locked** — see §12.
2. **Master data is never physically deleted.** Deactivate via the status field. Records
   remain for history, traceability and audit; existing references stay intact. No hard
   delete anywhere in the system.

Implemented and enforced:

3. **Cash bank ↔ account.** A cash/bank resource must post to an account that is owned
   by the same company, `is_postable`, under kelompok `1.1.1 KAS / SETARA KAS`, and active.
   All four conditions are one check — `checkCashBankAccount` in `records.ts` — called
   by the Server Action. The picker offers the same set, but the check is what enforces
   it: the action is reachable directly, with any account id.
4. **The connection holds in both directions.** An account a cash/bank resource already
   posts to cannot then be made non-postable, moved out of kelompok `1.1.1`, or
   deactivated — including through the status toggle. The refusal names the resources
   that depend on it.
5. **Uniqueness is case-insensitive** on identity labels.
6. **Locked fields.** `company_id` on Partner and Cash & Bank is immutable after
   creation — ledger history is tied to the company.
7. **Inactive records** disappear from new-transaction pickers but remain visible when
   already selected, and all history stays intact.
8. **Account numbers are unique per Company, never globally**
   (`@@unique([company_id, account_label])`). A chart of accounts belongs to one
   legal entity, so the induk's `1.1.4.1` and the anak's are different accounts
   that happen to share a number — not a duplicate. `checkAccountNumber` in
   `records.ts` is the enforcement and names the account already holding the
   number; the database constraint is the backstop under it. **Because of this,
   the Chart of Accounts tree shows one Company at a time** — listing both at
   once reads as doubled rows.
9. **Access comes only from roles.** A user's permissions are the union of their
   *active* roles' permissions, recomputed from the database on every request. There is
   no direct user-to-permission grant, and deactivating a role withdraws it from
   everyone holding it without touching a single assignment.
10. **There are no default permissions.** A role's name grants nothing — only the rows
   in it do. `STAFF` is seeded **empty**; `ADMIN` is the single exception, and only
   because something must be able to administer the system. A user with no roles, or
   with a role that holds no permissions, signs in successfully and can reach their own
   profile and nothing else. Never infer access from a role label.
11. **Nobody edits their own access.** Roles, status and an administrative password
   reset are all refused when the target is the caller — for administrators too. Own
   password changes go through the profile, which verifies the current password.
12. **The application always keeps an administrator.** Any change leaving no active user
   holding the administration permissions is refused, and the `ADMIN` role's permission
   set is frozen so the guard cannot be sidestepped by emptying the role instead.
13. **A deactivated user loses their sessions immediately.** Deactivation revokes them,
   and validation re-reads the account's status on every request.
14. **An account cannot become its own ancestor.** A parent must belong to the same
   company, must not be the account itself, and must not sit anywhere below it —
   otherwise the bagan akun would contain a loop no renderer could terminate on.
15. **An account requiring a Partner must name the category.** `require_partner` makes
   `partner_category_id` mandatory; clearing the flag clears the category, so a
   subledger never carries a stale one.
16. **A mapping is one combination.** Company × Budget Category × Partner Category
   resolves to exactly one postable, active account of that same company. The Partner
   Category applies only where `rules.ts` says the Budget Category takes one, and must
   be one it accepts.
17. **A fiscal period is generated, never authored.** A Fiscal Year is created by
   choosing a year; its name, 01/01 start and 31/12 end all follow. Activating it
   generates exactly twelve periods, one per calendar month, and they are read from
   inside the year that owns them. Fiscal Period has no menu, no route and no
   permissions of its own — see §12.

47. **Every journal balances, or nothing is written.** `postJournal` refuses a
   journal whose debits and credits differ, whose lines carry value on both
   sides or on neither, or whose amounts are negative — and it throws rather
   than returning, because it runs inside the posting transaction and an
   unbalanced journal must take the whole posting down. Amounts compare **in
   cents**, so binary floating point cannot fail an arithmetically sound
   journal. This is the guarantee the General Ledger and the Trial Balance rest
   on: if every journal balances, every sum of journals balances, and a trial
   balance that does not is a system fault rather than a bookkeeping one.
48. **A journal is append-only and immutable.** It is produced *by* a posting,
   never drafted towards one, and nothing updates, deletes or reverses it. A
   correction is a new business transaction, which produces its own journal.
   There is no JOURNAL_CREATE, JOURNAL_EDIT or JOURNAL_DELETE — viewing is the
   whole capability.
49. **A journal's posting date is the day it was posted — with one exception.**
   Never back-dated: it records when the books were written, not when somebody
   decided they should have been. The single exception is a **closing entry**,
   which is dated the last day of the fiscal year it closes: a `CLS-` journal
   belongs to the year it shuts, and one dated afterwards would fall inside the
   year it opens and be the first thing that year inherited.
   `JournalInput.postingDate` is tied to `series: "CLS"` in `journal.ts`, so
   back-dating anything else is unrepresentable rather than merely forbidden.
   Everything else about a posted journal is unchanged, immutability included.
50. **Posting needs a mapping; approval does not.** A Cash Bank Transaction
   journals against the account its Purpose resolves to through Company ×
   Budget Category × Partner Category. Without that mapping there is no account
   to post to, so the post is refused and nothing moves — while approval still
   tolerates the gap (rule 28), because a planner must not be stranded behind
   unfinished setup that belongs to someone else.
51. **A General Ledger balance moves in the account's own direction.** A Debit
   account rises on the debit side, a Kredit account on the credit side.
   Reporting raw debit-minus-credit would print every payable as negative,
   which is not how a ledger reads.

52. **A subject book is a Budget Category, and it keeps one exactly when it
   names a Partner *and* says which way it runs.** `require_partner` decides
   whether a book exists; `raises` decides which cash direction raises the
   subject's position, and without it the category has a **setup gap** rather
   than no book — a book running the wrong way is worse than none, so it is
   never guessed. A book's key is the category's immutable code, its lookup is
   the category's row id, and neither a Purpose nor a label is a way in. There
   is **one** Report View over all of them with the book as a parameter, so a
   category created through the GUI is readable immediately. Superseded wording
   below, kept because the reasoning still holds:
   Six of the eight do: Titipan, Hutang, Piutang, Prive, Investasi and Hasil
   Investasi. Asset and Biaya name no Partner, so a book of them would have no
   subject. The catalogue is `lib/siba/subledger-catalogue.ts`, and
   `tests/subledger.test.ts` fails if a category and its book ever disagree.
53. **A subject book signs by its own direction, not by the cash direction.**
   Money leaving the company *raises* a Piutang, a Prive and an Investasi, and
   *lowers* a Hutang or a Titipan. Each book declares which cash direction
   raises it, and `subledgerMovement` is the one place the sign is decided —
   the subledger's counterpart to the General Ledger's normal-balance signing.
   A book that mirrored the cash flow would print every position backwards.
54. **A subject book is written by posting, one entry per document.** The
   subject moved once; which Budgets that settled is recorded by the document
   itself and by the journal's counter lines. The entry is written inside
   `applyPosting`'s transaction, alongside the Cash Bank Book and the Journal
   and never derived from either (concept doc §13).
55. **A subject book is append-only and immutable, like every other book.** No
   update path, no delete path, no cascade. A correction is a further entry,
   which is what keeps `rebuildSubledgerBalance` able to re-derive the
   position from the entries.
56. **A subject is a Partner and a currency.** A Partner owing in two
   currencies holds two positions, reported as two blocks, and they are never
   pooled: a debt of USD 1.000 and a debt of Rp 15.000.000 are two obligations
   settled by two different things. Each position also carries its own base
   measure, which is what a settlement relieves against (§10 rule 73) — that is
   a second measure of the same position, never a way to merge two of them.

44. **A chart-of-accounts code states its own lineage.** Every level continues
   its parent's number rather than starting a new one: Account Type `1`,
   Account Category `1.1`, Account Subcategory `1.1.1`, then accounts
   `1.1.1.2`, `1.1.1.2.1` and as deep as the chart goes. A segment is a whole
   number 1–999 and is unique **within its parent**, so `1.1.1.10` and
   `1.1.2.10` are different accounts and both may exist, while two `1.1.1.10`
   in one Company may not. Only the last segment is ever typed — `composeSegmentCode`
   in `app/actions/master.ts` writes the rest — so a code contradicting its own
   lineage is unreachable rather than merely refused.
45. **An account's number is frozen once it exists.** Kelompok, Parent Account
   and the segment are all locked after creation, so nothing below an account
   is ever orphaned by a renumber and a code written on paper stays true. A
   miscoded account is deactivated, not moved.
46. **A Parent Account sits in the same Kelompok.** A parent supplies the code,
   so an account whose parent is in another group would claim a place in the
   chart it is not in. `validateAccount` enforces it; the picker only narrows.

77. **An account that gains a sub-account stops receiving postings, for good.**
   A parent is a heading over where money lands, not a place it lands: its
   balance is whatever sits below it, so a posting made directly to it would
   be money in the chart that no leaf accounts for. `createRecord` writes
   `is_postable = false` on the parent in the same transaction as the child,
   and `checkAccountIsLeaf` in `records.ts` is the check underneath that flag
   — asked of the tree rather than of the boolean, so an account that somehow
   still carried it is refused anyway. Every place an account is *chosen as a
   destination* asks: the Cash & Bank resource's account, the Budget Category
   mapping, and the account-valued System Defaults. The revocation is one-way;
   nothing in the application makes a parent postable again, because nothing
   removes the sub-account either.
78. **An account that is already in use cannot be given a sub-account.** The
   mirror of rule 77, and what stops the two contradicting each other: an
   account with journal lines, a Cash & Bank resource, a mapping or a System
   Default pointing at it would be left naming a heading the moment a child
   appeared, and the postings already made to it would have no leaf accounting
   for them. `accountUsage` in `records.ts` and `systemDefaultsUsingAccount` in
   `system-settings.ts` report what depends on it, and the refusal **names
   them**. A miscoded account is deactivated, never restructured (rule 45).

79. **A control account is one a book outside the General Ledger reconciles
   against.** Two structures make one: a Cash & Bank resource posting to it,
   which ties it to the Cash Bank Book and its rate layers, and a mapping from a
   Budget Category that keeps a subject book, which ties it to that book. The
   bridge and FX System Defaults make a third, because those accounts are
   written by the posting engine alone. `is_control_account` is **recomputed
   from those three, in both directions**, by `syncControlAccounts` in
   `records.ts` — called from every write path that can change the answer, so
   repointing a Cash & Bank, a mapping or a System Default claims the new
   account and releases the old one where nothing else still claims it.
   `controlAccountReasons` is what can say which book, for the refusal to name.
   A Biaya or Asset mapping target is **not** one: those categories keep no
   subject book, so the account reconciles against the General Ledger and
   nothing else.
   The **equity/P&L System Defaults** are claimed by that same third source,
   and one of them for a different reason worth stating: Laba/Rugi Tahun
   Sebelumnya is a posting engine's target, like the bridge accounts, but
   **Laba/Rugi Tahun Berjalan is closed to hand entry because nothing posts to
   it at all** — it is a Balance Sheet presentation line, computed as
   Σ Pendapatan − Σ Biaya for the year still open. The mechanism needed no
   change to cover them: both are account-valued System Defaults, and
   `systemDefaultAccountIds` is generic over every one of those.
80. **Whether an account may be written to is `is_postable` and
   `is_control_account`, and neither is an isian.** The user's own rule, and
   every place an account is chosen asks it. Both are decided by the backend:
   `is_postable` is whether the account is a leaf, with `checkAccountIsLeaf`
   under it because the tree is what makes the flag true (rule 77), and
   `is_control_account` is whether anything reconciles against it (rule 79).
   **Neither appears on a form.** Postable is not shown at all — it is a
   consequence of the chart's shape, and a reader who needs to know why an
   account no longer receives postings is told in the note at the foot of its
   card. Control Account is shown read-only, because a manual journal is
   refused by it and that refusal has to be readable before somebody starts
   writing one.
81. **A manual journal is drafted before it is posted, and only it is ever a
   Draft.** A journal a document produced is `Posted` the moment it exists,
   because it records something that has already happened. A manual journal is
   saved `Draft`, may be edited and cancelled while it is one, and reaches
   `Posted` through the same engine — which is also when it acquires its posting
   date. Nothing reverses a posted journal, manual or not.
82. **A draft is not accounting.** It has no posting date, the General Ledger
   and the Trial Balance filter it out, `unbalancedJournals` ignores it, and it
   is allowed **not to balance** — a journal halfway through being typed does
   not, and the balance is a rule about posting rather than about saving.
83. **A manual journal's accounts are re-checked at Post.** A mapping made since
   the draft was written can have turned one of them into a control account, and
   posting against a chart that has moved on would write exactly the discrepancy
   the rule exists to prevent. The same reasoning `applyPosting` uses for
   re-reading its Budgets (rule 35).

90. **A Budget Category's rules are rows, and a pair is retired rather than
   removed.** `allows_in` / `allows_out` say which directions are meaningful,
   `require_partner` says whether the category names a subject at all, and
   `sys_budget_partner_category_mapping` holds one row per admitted Partner
   Category. Deactivating a pair withdraws it from every picker at once and
   leaves every Budget already classified by it intact — which is the whole
   reason it is a row with a status rather than an entry in a list.
   `loadClassification` in `classification-data.ts` is the only reader, and it
   drops a pair whose row, or whose Partner Category, is inactive.
93. **A combination that produces nothing useful is refused, not reported.**
   The user's rule, and it decided two states that had been left reachable. A
   Budget Category that names a Partner **keeps a book**, so `raises` is
   mandatory the moment `require_partner` is on — leaving it optional produced
   a category that could be transacted while its subject book silently recorded
   nothing. And a category that names a Partner but has **no Partner Category
   paired to it** may not be Active: no Purpose is generated for it, so no
   document can name it, and its book can never receive an entry.
   `strandedCategories` in `records.ts` is the one question behind that
   refusal, asked from **all four directions** that reach the state — saving the
   category, activating it, retiring its last pairing, and deactivating the
   Partner Category that pairing points at. Three CHECK constraints are the
   backstop under the first half, because it fails silently rather than loudly.

91. **A Budget Category must be able to classify something.** A category
   allowing neither direction is refused, because it could classify no Budget
   at all. So is clearing `require_partner` while active pairs still point at
   it, and the refusal **names them** — the mirror rule, without which the flag
   and the pairs would contradict each other.
92. **A Purpose is withdrawn with the classification it rests on.** The 22
   Purposes stayed in code (§12) and each names a Budget Category and a Partner
   Category. Retiring that pair withdraws its Purposes from every picker —
   `availablePurposeOptions` — while `purposeOptions` stays unfiltered, because
   a posted document must keep naming its own Purpose afterwards. A draft
   already carrying one keeps it, for the same reason a deactivated record stays
   visible in the picker that already selected it.

18. **Budget category → partner category → account.** Each budget category declares
   which partner categories are valid and which directions (In/Out) make sense.
   Direction follows balance-sheet logic, not cash direction. Rule 16 above is the
   Accounting half of this chain; rule 26 below is the Budget half. Both are enforced.
20. **Budget Month is derived, not stored.** It groups budgets by `acc_fiscal_period`
    and has no independent lifecycle or table. A budget belongs to the period its
    `budget_date` falls inside, resolved by a date-range query at read time.
25. **A budget is created without classification.** Date, Company, Currency, Type,
    Amount and Description are all a planner supplies. `category_id` and `partner_id`
    stay null until approval — concept doc §6.2 and §6.3.
26. **Approval is what classifies.** The approver assigns the Budget Category, and the
    Partner where the category takes a subject. The category must be valid for the
    budget's direction, the partner must belong to the budget's Company, be active, and
    hold a Partner Category that budget category admits. A category that takes no
    subject stores null rather than a stale partner. `checkClassification` in
    `budget.ts` is the enforcement; the approval dialog only narrows the pickers.
27. **A budget is editable only while Draft or Rejected.** Submitting freezes it so it
    cannot change under its approver; approving freezes it permanently so realization
    stays traceable. Enforced in `updateBudget`, not merely by hiding the button.
28. **A missing account mapping does not block approval.** The approval dialog reports
    an unmapped Company × Category × Partner Category combination, but still allows the
    approval — that gap belongs to the Accounting module, and refusing here would
    strand a planner behind someone else's unfinished setup.
29. **A cash/bank balance comes only from the Cash Bank Book.** Every resource gets a
    `cash_bank_balance` row when it is registered, and a non-zero starting figure is
    written as an `Opening` entry in `cash_bank_ledger`. Nothing else may hold a
    balance, and the ledger is append-only — see §9 and §12.
30. **Money is totalled per currency at face value, and in base currency only where
    a base measure was recorded.** A figure spanning currencies is reported as a
    list, not a sum. The Journal and the General Ledger are the exception and the
    only one: every journal line stores what it was worth in base at the moment it
    was posted, so those two report one column. Nothing anywhere converts by
    fetching a rate — §12.
31. **A System Default prefills; it never decides.** A default fills a control in when
    a record is created, is resolved against its master first, and is validated by the
    Server Action exactly as a typed value would be. It is never applied to an existing
    record and never narrows what is valid — §12.
32. **A Fiscal Year is activated, not edited into Open.** It is created Draft; only
    `transitionFiscalYear` moves it, under its own `FISCAL_YEAR_OPEN` permission.
    `status` is `derived` and `locked`, so no form offers it and no submitted value
    writes it. Open is one-way, and Closed is reached by a closing process that is not
    built — §12 and §13.
33. **An editable date field starts on today.** Every date somebody types begins
    prefilled with today's date, and its picker opens as soon as the field is reached.
    Derived dates — a Fiscal Year's 01/01 and 31/12 — are untouched, because they are
    the Server Action's to write.
34. **The document header decides what the document may realize.** Purpose × Company ×
    Partner × Cash & Bank × Currency is the context (concept doc §9). A Budget is
    eligible only when it is Open, belongs to that Company, points the way the Purpose
    does, carries the Budget Category the Purpose resolves to, names that Partner where
    the Purpose takes one, is denominated in **the document's own currency**, and still
    has outstanding. That currency is the document's and not the resource's: a USD
    document settles USD plans whether it is paid from a USD account or a rupiah one,
    a distinction that did not exist while a document took its currency from whatever
    was paying it. **Neither Budget Date nor the kurs is a criterion** — the distance
    between plan and execution is a report, not a gate, and eligibility turns on what
    is being settled rather than on what it cost. `eligibleBudgets` and `checkLines` in
    `finance.ts` are the enforcement; the picker only narrows.
35. **Post is the actual boundary, and it is atomic.** A Draft touches nothing: no
    ledger entry, no balance, no `realized_amount`, no document date. Post writes the
    Cash Bank Book entry and its balance, every Budget's realization, and the
    document's own dates inside one database transaction — `applyPosting` in
    `finance.ts`. Budgets are re-read at Post, so one another document has since
    closed refuses the post rather than being realized twice.
36. **Realization closes a Budget; nobody closes one by hand.** A Budget whose
    realization reaches its planned amount becomes `Closed` as a consequence of
    posting, carried by `CASH_BANK_TRANSACTION_POST`. Over-realization is permitted
    (concept doc §6.5) and still closes it. There is no `BUDGET_CLOSE` permission and
    no user-facing close action — §12.
37. **A posted document is permanent.** Draft is editable; Posted and Cancelled are
    final, and neither can be edited, deleted or reversed. A correction is a new
    business transaction (concept doc §15). There is no delete anywhere in Finance.
38. **Which Company a document belongs to decides how it reaches money.** The induk
    holds the cash, so its documents name a Cash & Bank and post directly. The anak
    holds none by design (concept doc §25, §32), so its documents name a **Currency**
    instead, are refused if they name a resource at all, and are executed by the
    induk confirming their Funding Request. `checkHeader` enforces both shapes and
    `fundingRoute` is the one place the question is asked — keyed on `is_parent`,
    never on a setting.
57. **A Funding Request is raised by submitting, and answered by confirming.** The
    anak's document leaves Draft as **Pending** and opens one request carrying the
    document's whole amount: there is no partial funding (§28) and no rejection, since
    the induk always complies (§29) — its action is a confirmation, and the only
    refusals are mechanical. The requester may withdraw while the request is still
    open, which cancels document and request together.
58. **Pending is exactly as inert as Draft.** No cash entry, no subject book, no
    journal, no `realized_amount`, no document date. Confirmation is the actual
    boundary, for **both** Companies at once (§30).
59. **One confirmation, one transaction, two Companies.** `writeFundedPosting` writes
    the induk's cash entry and balance, the anak's own subject book where its Purpose
    keeps one, every Budget's realization, a journal each and the document's Posted
    status; `confirmFundingRequest` closes the request in the same transaction.
    Either all of it happened or none of it did.
60. **Each journal points at its own Company's document.** The induk's names the
    Funding Request it confirmed; the anak's names its own Cash Bank Transaction,
    because that document is an ordinary realization that happened to be funded.
    Neither journal is the source of the other, which is what concept doc §31's
    Intercompany Event exists to guarantee — the request is that identifier, so there
    is no separate ICE table.
61. **Money out of the induk is a claim on the anak; money in is a debt to it.** An
    anak payment debits the induk's receivable and credits the anak's payable; an
    anak receipt does the mirror (§34, §37). **That position is journal, never
    subject book**: a subject book's subject is a Partner (rule 56) and the other
    Company is not one, so the two bridge accounts carry it and the General Ledger is
    where it is read and reconciled. The anak's *own* subject book is untouched by
    this — the partner it actually paid or was paid by still gets its entry, because
    that is the business event and the funding is only how the cash arrived.
62. **The bridge is four System Defaults, and nothing guesses them.** Each Company
    names the account for what it is owed and the account for what it owes. A
    confirmation is refused, by name, until every one is set — see §12.
84. **A transfer moves the Company's own money, and settles nothing.** It
    realizes no Budget, names no Partner and writes no subject book — there is
    no counterparty, so there is no subject whose position moved. It is
    therefore its own module with its own tables rather than a third
    `transaction_type` on `fin_cash_bank_transaction`, whose every line settles
    a Budget. Both legs belong to one Company: a movement between the two is
    the intercompany bridge, which is Funding Request's (§36). And because the
    anak holds no Cash & Bank at all, every transfer is in practice the
    induk's — which falls out of the resource rather than being configured.
85. **A transfer Purpose states how the two currencies relate, and nothing
    else.** `Transfer` is the same currency on both sides, `Pencairan` is
    foreign out and base in, `Pembelian Valas` is base out and foreign in.
    There is no fourth: one foreign currency to another is refused by
    `maySettle` (rule 67) and is done as a Pencairan followed by a Pembelian
    Valas, which is also how a bank does it. The relation is derivable from the
    two resources, so the Purpose is **redundant as data and kept as an input**
    — the user states what they mean and the resources are checked against it,
    which is what turns picking the wrong account into a refusal rather than a
    silent currency sale.
86. **A transfer conserves base value, and layers propagate one-for-one.** CORE
    multi-currency §5.8 and SIBA multi-currency §6. What the destinations
    receive in base is exactly what the source released — never a product
    recomputed from a derived rate — and each line draws its own amount out of
    the source layer and opens its own layer on the destination. Three
    destinations make three destination layers at the source layer's rate,
    never one blended layer: blending would let an unwanted rate be laundered
    into a fresh average, which is the whole thing layering exists to prevent.
87. **Pencairan is the only transfer that can recognise a difference.** Selling
    foreign currency resolves two independently determined base values — what
    the layer was carried at, and what the bank actually credited at the sale
    rate — so the residual is a **realized** gain or loss, and it is the
    balancing figure of the journal exactly as it is for a settlement (rule 74).
    A Transfer conserves by construction. A Pembelian Valas is origination:
    nothing is on the books to disagree with, so the rupiah spent *is* the base
    value of the currency bought (rule 73). The difference lands in the
    Company's existing Account Selisih Kurs, resolved only when one arises.
88. **A transfer's kurs is stated per line, and only ever multiplies.** The
    entered rate always values the **foreign** side into base: on a Pencairan
    the line states the foreign amount sold, on a Pembelian Valas the foreign
    amount bought, and the rupiah side is the product. Nothing is ever divided
    by a kurs, which is what keeps the foreign amount a figure somebody stated
    rather than a quotient that does not round cleanly. Per line rather than
    per document because proceeds split across two accounts may carry the two
    rates the bank actually used.
89. **The source gives up once, however many destinations there are.** One Cash
    Bank Book entry out and one per destination in — the money left the source
    once, and a book that showed one withdrawal per destination would not read
    like the bank statement it is reconciled against.

39. **A report states what it was run for.** Every Report View restates its subject,
    its period and when it was produced, on the output itself. A page of figures that
    does not say what it covers cannot be checked by anyone who did not run it, and a
    report is meant to leave the screen.
40. **A money report reconciles on its own page.** `opening + in − out = closing`, for
    every subject and every period. This is why the Cash Bank Ledger offers **no
    entry-type filter**: dropping `Adjustment` rows would leave totals that no longer
    add up. Type is a column to scan, not a filter — §12.
41. **A date range is inclusive at both ends, and anything earlier is the opening.**
    Entries dated exactly `from` or exactly `to` are inside the period; everything
    before `from` is folded into the opening balance rather than listed. Opening is
    summed from `movement`, the same arithmetic `rebuildCashBankBalance` uses, so the
    report's own figures are derived rather than trusted.
42. **A report is read-only.** No Report View writes, and none carries a row action
    that mutates. It reports on records; it never becomes a second way to edit them.
43. **A report about a resource is not a property of that resource.** The Cash Bank
    Book is reached from Finance › Laporan, not from the Cash & Bank master form — the
    master shows what the book adds up to and links into it. Entering an opening
    balance at registration stays as it is, because that writes a real ledger entry
    (§29) rather than storing a figure on the master.

63. **Every write names the step it was, and a record carries its own
    history.** `audit_log.action` is TAMBAH / UPDATE / HAPUS, which cannot
    tell a submission from an approval from a post — all three are UPDATEs. The
    nullable `event` column carries the transition key the owning module's
    workflow table already declares, and `lib/siba/audit-events.ts` turns that
    key into a past-tense label by reading the same table the button reads. A
    lifecycle step that writes no `event` reports as a bare "Diubah", which is
    the one thing the panel exists to stop.
64. **A history is the last thing on a form, and it is newest-first.** Every
    form with a saved record ends with `RecordHistoryCard` — after the summary,
    after a Fiscal Year's periods, after the Cash & Bank book card. Newest at
    the top because a history is read backwards: the entry somebody opened the
    panel for is the most recent one, and oldest-first would push it below the
    fold on a long-lived record. It is capped at ten and **says so**, because a
    slice presented as the whole story is worse than a stated cap.
65. **The history states only what the log knows.** Who, when, and which step —
    never what changed, because `audit_log` stores no snapshot (§17). An event
    the build cannot name falls back to the coarse verb rather than guessing,
    and a consequence nobody chose — a Budget closing because a posting reached
    its planned amount — is marked as automatic rather than attributed to the
    person who posted.

19. **A Transaction Purpose is one Budget Category × one Partner Category ×
    one direction**, which is what lets it resolve to a single account. It is
    the field a Cash Bank Transaction's header starts from, and it decides the
    document's direction, its Budget Category, and whether a Partner is
    required. Purposes are **rows in `sys_purpose` that a maintainer enters** —
    nothing generates them, so a Budget Category with none cannot be
    transacted, which is a maintenance gap rather than a fault. The label is
    **composed** from the three fields and never stored, so every Purpose reads
    the same way. §12.

22. **Operational books are independent append-only stores** — never views over
    journal lines. Only the General Ledger derives from journals.
    `cash_bank_ledger` and `sub_ledger` are both built this way: `applyPosting`
    calls `recordCashBankEntry`, `recordSubledgerEntry` and `postJournal` side by
    side, and none of the three reads another.

**Multi-currency** — the rules the two concept documents in `Initialization/` add.
The model is in §12 under "A rate is an input or an output, never both"; these are
the rules that follow from it.

66. **The base currency is a constant, not a setting.** `BASE_CURRENCY_LABEL` in
    `lib/siba/currency.ts` is `IDR`, and `prisma/seed.ts` imports it rather than
    reading an environment variable. Every book entry records what it was worth in
    base, so a deployment that could seed a different base would invalidate every
    stored base figure at once. Only the currency's display *name* stays
    configurable, because nothing branches on a name.
67. **Crossing goes through the base currency only.** A foreign document may be
    settled from a resource in its own currency or from a base-currency resource,
    and from nothing else: USD from USD or IDR, EUR from EUR or IDR, USD never
    from EUR, and an IDR document from IDR alone. This is **narrower than the
    source specification**, which also admits a third currency needing a cross
    rate — deliberately, because it means the only rate this system ever holds
    converts a foreign currency to base. There is no EUR-to-USD rate to enter,
    store or source. `maySettle` and `settlementRefusal` are the one place it
    lives, and the Server Action refuses with the same rule the picker narrows by.
68. **A kurs has exactly three provenances, and `rateSource` is the only thing
    that decides which.** `identity` — base money through a base resource, where
    the rate is 1 and no control is shown. `layer` — foreign currency leaving a
    foreign resource, where the rate is read off the layer the user picked and is
    never typed. `entered` — everywhere else, where the user states the rate the
    bank actually used. A rate of `1` is correct **only** in the identity case; a
    rate of 1 between two foreign amounts would assert that USD 100 is IDR 100.
69. **A foreign Cash & Bank resource holds rate layers; a base-currency one holds
    none.** A layer is a parcel of currency acquired at a known kurs. Rupiah is
    already the measure everything is reported in, so a base resource has nothing
    to choose between and is unlayered by design, not by omission.
70. **A layer is chosen, never averaged — and one document draws on exactly one
    layer.** Currency bought at 15.000 and currency bought at 16.000 are not
    interchangeable: which one a payment spends decides the gain or loss
    recognised, so it is a decision somebody takes rather than an average the
    system computes. Nothing ever auto-selects. **The single-layer limit is a
    deliberate narrowing** of the source specification, which allows a payment to
    draw on several: a resource with five layers of a million each holds five
    million and still cannot make one payment of one and a half. `checkLines`
    refuses it at draft time and says so.
71. **Layers are never merged, and a layer's rate is immutable.** Two receipts at
    an identical kurs stay two layers, whatever their source or timing — that is
    what makes "the layer from 28 January" name something where "the 15.000" would
    name three things at once. The rate stays true by construction rather than by
    rule: relief releases base in proportion to what is left, so
    `base_remaining ÷ foreign_remaining` equals the layer's rate for its whole
    life. Period-end revaluation is the **only** sanctioned consolidation of
    layers, and it is not built (§13).
72. **A foreign account's balance *is* the sum of its open layers, on both
    measures.** `cash_bank_layer` is mutable, unlike the books beside it, so
    nothing can recompute it from an entry log; `reconcileLayers` is what checks
    it still agrees with the book written beside it, and the layer report says so
    when it does not.
73. **A settlement resolves two independently determined base values.** The
    obligation releases what it was carried at; the cash gives up what it actually
    cost. **The discriminator is whether base value already exists** — never the
    Purpose, never the direction, never which book is being written. Where nothing
    is on the books the movement *is* the origin of the value, both measures come
    from the same place, and no difference can arise. `settle` in `fx.ts` is the
    one implementation.
74. **The FX difference is the balancing figure, and its sign is never chosen
    separately.** It is `settlementBase − transactionBase`: positive is a gain on
    the credit side, negative a loss on the debit side, exactly zero writes no
    line at all. Deriving it from the balance requirement rather than computing a
    magnitude and then assigning a side is what makes an unbalanced FX entry
    unrepresentable.
75. **A difference needs a named account, and posting is refused without one.**
    Each Company names its own Account Selisih Kurs in System Default. The account
    is resolved **only when a difference actually arises**, so ordinary rupiah work
    is never blocked by a setting it does not use — and when one does arise the
    post is refused by name rather than falling back to anything.
76. **Base amounts round half away from zero, in one place.** `roundBase` in
    `fx.ts`. `Math.round` rounds half toward positive infinity, which would round
    a loss a cent differently from the matching gain and stop the two being mirror
    images. It also refuses a figure beyond safe integer precision rather than
    returning one that is merely nearby.

Specified in the concept doc, **not yet implemented** (see §13):

23. **Intercompany settlement** (§36). Funding leaves the induk holding a claim on
    the anak and the anak a matching payable; handing the money back clears both.
    Both positions are already kept — in the two Companies' **journals**, on the
    bridge accounts, not in the subject books (rule 61) — and what is missing is
    the document that settles them.
24. **Period-end revaluation** (SIBA multi-currency §7). Closing a period
    retranslates open positions at the closing rate and collapses a foreign
    account's layers into one. `CashBankLayerStatus.ClosedByRevaluation` exists in
    the schema and nothing writes it: a layer's status had to be able to reach
    that state, because revaluation is the one sanctioned way layers consolidate
    and it must not arrive later as a change to an append-only shape.

---

## 11. Security Rules

- **Never commit secrets.** `.env` is gitignored; `.env.example` holds placeholders only.
  Never write real credentials into this file, the README, or commit messages.
- **Authentication is required everywhere.** `/login` is the only route reachable without
  a session. `src/proxy.ts` redirects a visitor with no session cookie, but it is a
  convenience, not the boundary — it does not touch the database and a forged cookie
  gets past it. The real check is `requireAuth` in `(app)/layout.tsx` and in every page,
  and `actorOrDeny` in every Server Action.
- **Authorize in the Server Action, not in the component.** Actions are reachable
  directly with a valid action id and any cookie. Hiding a control changes nothing.
- **Ask for a permission, never for a role.** `if (role === "ADMIN")` in business logic
  is a bug; `requirePermission("USER_CREATE")` is the rule.
- **Own-profile access is inherent to authentication**, deliberately not a permission —
  so no permission change can lock a user out of their own account details. Nothing
  reachable from the profile can change access.
- Passwords are bcrypt-hashed and `password_hash` never leaves the two functions that
  read it. Never select it into anything that crosses to a client component.
- Sessions are server-side rows; the cookie is an opaque random token, `HttpOnly`,
  `SameSite=Lax`, and `Secure` in production. Revocation is immediate because every
  request re-reads the row and the account's status.
- A password change — the user's own or an administrator's reset — revokes every session
  the account holds.
- **Login failures are indistinguishable.** Wrong password, unknown address and
  deactivated account all return the same message, and the no-such-user path still pays
  for a bcrypt comparison so timing does not reveal which accounts exist.
- **Denials say nothing about internals** — no permission codes, no record existence, no
  stack traces. `UNAUTHENTICATED` redirects to login; `UNAUTHORIZED` renders a 403.
- The seed's development password is intentionally weak and must not survive into any
  deployed environment. `SIBA_ADMIN_PASSWORD` is required when `NODE_ENV=production`.
- Prisma parameterises every query. The only raw SQL is the two `$queryRaw` schema
  assertions in the test suite, which take no user input. Do not introduce raw SQL
  with interpolated user input.

## 12. Important Decisions / Frozen Decisions

### The seeder seeds system data only (FROZEN)
- **Decision:** `prisma/seed.ts` writes the `sys_*` tables — the bootstrap
  administrator, the permission catalogue, the seeded roles, the two Companies — plus
  the reference tables that behave as system data even though their prefixes say
  otherwise: account types, document types, budget categories, partner categories,
  the account **category** and **subcategory** skeleton, and the base reporting
  currency. Nothing else. Partners, cash & bank resources, further currencies,
  accounts, mappings, fiscal years and periods, budgets and transactions are business
  data that users create through the GUI.
- **Reason:** The seed previously reproduced `SIBA Mockup 2.0.html`'s inline dataset as
  if it were canonical. It was demo content in a file with no database. Now that the
  application runs on PostgreSQL, that data belongs to whoever uses it, and reseeding
  it would wipe real records and reimpose demo content.
- **Impact:** A fresh installation has system data and nothing else. The dashboard's
  "Perlu Perhatian" card is the setup path — it names the chart of accounts, the
  fiscal calendar, the mappings and the missing cash resources in dependency order.
  Tests build their own business fixtures (`tests/helpers.ts`) and clean them up.
- **Sample business data has its own script, outside the seed.**
  `scripts/seed-showcase.ts` (`npm run db:seed-showcase`) fills a development
  database with a believable year of it: Partners for both Companies, a full
  Chart of Accounts each, every Budget Category × Partner Category → account
  mapping, the cash and bank resources with their opening balances and the
  foreign one's first rate layer, an open fiscal year, Budgets across the
  lifecycle, and the documents that realize them — Cash Bank Transactions, all
  three kinds of Transfer, a confirmed and an open Funding Request, and a posted
  and a draft manual journal. The goal is that **no menu is empty**, so a screen
  can be judged on what it shows rather than on an empty state.
  It replaced `scripts/sample-data.ts` (`npm run db:sample`), which stopped at
  the setup tables and left every document screen blank.
  It is deliberately *not* part of the seed, is never run by install, migrate,
  reset or CI, and writes ordinary records — composed account numbers, audit
  entries, editable through the GUI. It reuses anything already present rather
  than overwriting it, and deletes nothing.
- **Everything it posts goes through the real engine.** `applyPosting`,
  `applyTransfer`, `confirmFundingRequest` and `postManualJournal`, never a
  direct insert into a book. Inserting those rows would be faster and would
  produce reports whose figures do not reconcile — which is worse than an empty
  screen, because it looks like the application is wrong. It is also what makes
  the script a standing check on the posting paths: a rule one of them breaks
  refuses here, loudly, rather than being discovered on a report.
- **The names are the point.** "Cabang Medan", "Budi Santoso", "Termin II
  kontraktor gudang Cikarang" — on the user's instruction, because a showcase
  populated with "Partner A" and "Category C" demonstrates the layout and
  nothing else. The two Companies are renamed from the seeded "Perusahaan
  Induk" / "Perusahaan Anak" to **ABHC** and **SBTC** for the same reason; that
  is the one `sys_*` row it touches, and a reseed of a fresh database restores
  the defaults.
- **The seed is also idempotent and non-destructive.** It creates what is missing and
  leaves everything else alone, so it is safe to run against a live database and is
  how a newly added permission reaches it. The one exception is the permission
  catalogue, which is re-synced from code because code is its source of truth.
  `npm run db:reset` is the separate, explicitly destructive path.
- **The named administrators are the one deviation, and it is deliberate.**
  `ADDITIONAL_ADMINS` in `prisma/seed.ts` seeds two further accounts beside the
  bootstrap one. They are named people, and `/settings/user` creates exactly this
  kind of record through the GUI — so by the rule above they do not belong here.
  They are here on the user's explicit instruction, because the deployed database
  is rebuilt from this file and an operator who must be re-created by hand after
  every reset is the step that gets forgotten. What keeps it inside the seeder's
  stated scope at all is that they are `sys_*` rows, like the bootstrap
  administrator and the Sistem account already in the seed. They share one
  password, which **costs the audit trail its meaning** — `audit_log` attributes
  each write to a person and people sharing a password are indistinguishable in
  it — so each is expected to change it from the profile page. The seed never
  touches an account that already exists, so that change is permanent.
  **This is not a precedent for seeding business data**; adding a Partner, an
  account or a Currency here is still the thing this decision forbids.
- **Do not change unless:** explicitly instructed. **Never add business data to the
  seed, and never add a delete step to it.**
- **Status:** Frozen, current.

### A form is one component, twelve columns wide, and carries no summary (FROZEN)

- **Decision:** `src/components/ui/form.tsx` is the only thing that builds a
  form. `FormBody` → `FormSection` → `FormRow` → `Field`; nothing else emits
  `.fld`, `.fsec`, `.sec-t` or `.fbody`. A row is **twelve columns** and a field
  declares its share (`span`, half by default). **Help sits on the label row**,
  right-aligned, as one lower-case clause — an error replaces it rather than
  stacking under it. A page heading is the record's identity: a document's
  number in mono (`.docno`) with its status badge beside it, a master record's
  name with its code as a chip, and a placeholder (`Budget Baru`) before the
  first save. **There is no summary side card anywhere**, and no form page
  carries a `.ph-sub`.
- **Reason:** A field cost 89px to present a 34px control — 14px of its own
  padding, 20px of label and 21px of help *beneath* the control — and the row
  was pinned to two equal columns, so a date picker sat in a 500px box and every
  third field started a new row. Cash Bank Transaction's whole Budget section was
  below the fold before a single field had been filled in, and the pointer
  travelled ~570px between two controls that each needed 180px. The users work
  by **mouse**, not by Tab, so both the scrolling and the travel are real costs
  rather than taste. The summary card was the same failure in a second form: it
  restated the status the header already showed, named a Budget Month the
  breadcrumb already linked to, and reported an authorship the record's own
  history panel covers — while taking 306px of width that buys a third column.
- **Impact:** A Budget create form went 704px → 390px; Cash Bank Transaction now
  fits header, Budget table and all, with no scroll at 1600×900. `Foot()` had
  been hand-copied into three files and `Field` into a fourth and fifth, so
  eleven files had to be edited in step to change anything about a field; it is
  now one. Registry entities get spans as config (`span` on `Field` in
  `entities.ts`), defaulting to a third. The 34px control height and every hit
  area are **deliberately unchanged** — a smaller target costs a mouse-first
  operator more than the pixels are worth.
- **The exception that stays:** a label-less `.fld` is a layout slot, not a
  field — a button, an error banner, the role checkbox grid — and is still
  written by hand.
- **`tests/design-system.test.ts` holds it**: no file outside `ui/form.tsx` may
  render a `.fld` containing a bare `<label>`, emit `.fsec` / `.sec-t` / `.fbody`,
  put a `.help` div beside a control, keep a `.card side`, or give a form page a
  `.ph-sub`; and the four document forms must title themselves with `.docno`.
- **Do not change unless:** explicitly instructed. **Never hand-write a field**,
  never put help back under a control, never reintroduce a summary side card or a
  form subtitle, and never shrink a control to buy height.
- **Status:** Frozen, current.


### A repeated control is a component, and the test suite says so (FROZEN)
- **Decision:** Anything that appears on more than one screen is drawn by one
  component in `src/components/ui/`, not by markup copied between pages. That is
  now: `Combobox`, `Select`, `DateInput`, **`MoneyInput`**, **`SearchField`**,
  **`AnchoredPopup`** (the popup all three pickers hang off their trigger),
  **`Dialog`** (the wide panel) and `ConfirmDialog` (the small question).
  `tests/design-system.test.ts` enforces the ones that had already drifted —
  no native `<select>`, date or number input; no bare `.ph` rule; no `.srch`
  markup outside `SearchField`; no `.ovl` outside the two dialog components; no
  `.cbpop` rendered outside `AnchoredPopup` and nothing anchoring a popup with
  `top: calc(100% …)`; no `.mi` tinted inline; no date or number formatted
  outside `lib/format.ts`; and no `.ph-act` block writing a danger button after
  its primary.
- **Reason:** A CLAUDE.md line cannot enforce a convention, because none of these
  mistakes breaks a build, fails a type check or throws at runtime. They just make
  one screen behave unlike the rest, and the drift is only visible to whoever holds
  every screen in their head at once. Seven lists each carried their own copy of the
  search box; four dialogs each drew their own header out of inline styles, so their
  icons were 34px in two and 38px in two, two had a close button and two did not;
  eight empty states had four different hand-written paddings between them. Each
  copy was defensible the day it was written.
- **Impact:** The test is a source-text scan, so it costs nothing and needs no
  database. When a genuinely new shape is needed, the answer is a new component and a
  new assertion — not an exception to an existing one. A component takes a `variant`
  or a `size` where two contexts differ; it does not take a `style`.
- **Do not change unless:** explicitly instructed. **Never reproduce one of these
  controls by hand, and never relax an assertion in `tests/design-system.test.ts` to
  let a copy through.**
- **Status:** Frozen, current.

### The dropdown's own field is the search box (FROZEN)
- **Decision:** A `Combobox` is always searchable and a `Select` is searchable
  once its list is long, and both search **in the trigger**: opening replaces
  the control's contents with a `.cbq` text input, in the same box, at the same
  height, in the same place. The popup carries the list and nothing else —
  `.cbpop .s` is gone from the stylesheet. Enter picks the first remaining
  option, Escape closes, and clicking the trigger again closes it.
- **Reason:** The popup used to grow a search bar of its own, directly below
  the control. The field a user had just clicked was therefore not the field
  they had to type into, and reaching it was a second mouse movement — which
  these users pay for, because they work by mouse rather than by Tab (§12,
  form density). One gesture, one box.
- **Impact:** Both triggers are `<div role="combobox">` rather than `<button>`,
  because a button may not contain an input and a trigger that changed element
  type between its two states would lose focus mid-gesture. That is why
  `:disabled` no longer styles them and `.dis` does, and why `.tsel` / `.psel`
  / `.ctxsel` became `inline-flex` with their label in a `.tv` span — a `<div>`
  does not centre its own text the way a button did. The placeholder while
  searching is **the value already set**, so the field still says what it holds
  while it is being searched in.
- **Do not change unless:** explicitly instructed. **Never put a filter box
  back inside a popup**, and do not give one screen's dropdown a search that
  works differently from the rest.
- **Status:** Frozen, current.

### A field waits for its prerequisite, and says which one (FROZEN)
- **Decision:** A picker whose options are decided by another field is
  **shown, in its own place, and does not collect an answer** until that field
  is filled in. `waitingFor` on `Combobox` and on `Select` is the one
  implementation: the control renders inert with `.wait` and carries the clause
  `Pilih <what> dulu…` where its prompt would be. It is never hidden, and it is
  never `disabled` — `.dis` means *never*, `.wait` means *not yet*, and the two
  read differently on purpose. In the registry the dependency is derived from
  `resets` by `prerequisitesOf` in `entities.ts`; a bespoke form states its own
  clause, and states the **first** missing field rather than listing them all.
- **Reason:** Chart of Accounts is where it showed. Parent Account sat beside
  Company and Kelompok Account and could be opened before either was chosen,
  whereupon it reported "Tidak ada pilihan yang cocok" — which says the options
  do not exist, when what has actually happened is that the question deciding
  them has not been asked. The same hole was open on Cash & Bank's Account, the
  mapping's Account, Cash Bank Transaction's Partner and Cash & Bank, and the
  transfer's source, where picking the resource before the Purpose meant
  choosing from a list the Purpose would then contradict and having the
  selection silently cleared out from under the field.
- **Shown rather than hidden, on the user's instruction.** A form whose shape
  changes as it is filled in is worse than one that waits: the reader loses the
  map of what the document needs, and a field that appears late reads as one
  they missed. The field stays where it is and explains itself, which is the
  shape the segment input's `menunggu induk` prefix already had.
- **A prerequisite is declared once.** `resets` already says "changing me
  clears you", which is the same fact as "you cannot be answered before me".
  Two declarations of one dependency drift the first time either is edited
  alone. A `bool` never counts — it is always answered — and a field that does
  not apply is skipped, so a Partner Category the Budget Category does not take
  never blocks the Account behind it.
- **Impact:** None of this is enforcement. The Server Action re-checks every
  rule exactly as before (§12, "a picker's filter is never the enforcement") —
  this only stops the form offering a control whose every use would be refused,
  or worse, silently discarded. `tests/design-system.test.ts` holds three
  things: that `prerequisitesOf` reads `resets`, that a prerequisite is listed
  **before** the field it gates in every registry entity, and that every
  waiting clause reads `Pilih <what> dulu…` rather than something like
  "Lengkapi header dokumen terlebih dahulu", which names none of the five
  fields it could mean.
- **Do not change unless:** explicitly instructed. **Never hide a field until
  its prerequisite is answered**, never let a picker open onto an empty list
  that a missing prerequisite caused, never use `disabled` where the field is
  merely waiting, and do not write a waiting clause that fails to name a field.
- **Status:** Frozen, current.

### A list of combinations is grouped, and searched by its facets (FROZEN)
- **Decision:** A `Select` whose options are combinations rather than names
  takes `group` on each option and `listWidth="wide"`. The list emits a heading
  each time `group` changes — sticky, so the heading is on screen while its own
  rows are read — and the search requires **every word** of the query to match
  somewhere in label + hint + group, rather than the whole query to match as one
  substring. `filterOptions` in `components/ui/select.tsx` is that rule, exported
  and pure so it can be driven directly. Both are opt-in: a caller that passes
  neither is byte-identical to before.
- **Reason:** Transaction Purpose is 22 rows and showed why. A Purpose *is*
  direction × Budget Category × Partner Category, and its label is that triple
  written as a sentence — so the row put "Penerimaan Titipan dari Cabang" beside
  a chip reading "Penerimaan · Titipan", saying each word twice while starving
  the label of the width it needed to reach its **last** one. Every label ends
  with its Partner Category, so the 320px cap truncated precisely the facet that
  appeared nowhere else: "Penerimaan Titipan dari Stakeh…", on row after row.
  The search failed the same way from the other side — an operator picks a
  Purpose by naming facets, and "pengeluaran cabang" matched nothing, because no
  row spells the two in that order.
- **Impact:** The Category is stated once per group instead of 22 times, the
  chip carries the direction alone — the one facet "Pembayaran", "Pemberian",
  "Pembelian" and "Pengembalian" all imply without spelling — and the label gets
  the rest of a 440px list. Options must arrive **already ordered by group**: the
  list emits a heading on change rather than sorting, so the caller keeps the
  order and a group filtered down to nothing simply never gets a heading.
  `tests/purpose-picker.test.ts` holds the search over the real 22, and
  `tests/design-system.test.ts` holds the heading — `.cbgh` is rendered only by
  `Select`, and must stay `position:sticky` with an opaque background, because a
  heading that scrolls away is not a landmark.
- **Do not change unless:** explicitly instructed. **Never put a facet in a chip
  that the label already spells**, never widen a list past what its longest
  option needs, do not let a screen draw its own group headings, and do not
  return the search to a single substring test.
- **Status:** Frozen, current.

### An account with children is a heading, not a destination (FROZEN)
- **Decision:** Creating an account under a parent sets that parent's
  `is_postable` to false in the same transaction, permanently, and every place
  an account is chosen as somewhere money goes refuses a parent outright —
  `checkCashBankAccount`, the Budget Category mapping, and
  `checkSystemDefaultValue` for the bridge and FX accounts. The mirror rule
  refuses a sub-account under an account that anything already depends on.
  §10 rules 77 and 78 are the statement of both.
- **Reason:** A parent's balance is the sum of what is below it. A posting made
  directly to one is money in the chart that no leaf accounts for, and it
  reconciles against nothing. The pair of rules is what keeps them from
  contradicting each other: without the second, adding a child would revoke a
  posting privilege that a Cash & Bank resource, a mapping or a System Default
  was already relying on — and §10 rule 4 says exactly that may not happen.
- **Impact:** `checkAccountIsLeaf` asks the **tree**, not the flag, so an
  account that somehow still carried `is_postable` is refused anyway. The
  `parentAccount` picker narrows by `journal_lines`/`cash_banks`/`mappings`
  being empty, and the Server Action adds the System Default case, which is not
  expressible as a `where`. Revocation is one-way: nothing makes a parent
  postable again, because nothing removes the sub-account either.
- **There is no Postable toggle, and there never was a reason for one.** The
  form used to carry a checkbox that was locked off per row once an account
  had children — `lockedFields` on `EntityForm` — which was a control that
  could only ever agree with the structure or be refused. It is gone entirely
  (§10 rule 80): whether an account receives postings is the shape of the
  chart, restated to nobody. `lockNote` survives without it, because an
  account that has quietly dropped out of every destination picker still owes
  its reader an explanation.
- **Do not change unless:** explicitly instructed. **Never let a parent account
  be posted to, never add a path that makes one postable again, never put
  `is_postable` back on a form, and never loosen the mirror rule** — the two
  only work as a pair.
- **Status:** Frozen, current.

### A popup is placed in viewport coordinates, never inside its control (FROZEN)
- **Decision:** Every dropdown the application opens — the FK picker's list, the
  `Select`'s list, the `DateInput`'s calendar — is rendered into `document.body`
  by `src/components/ui/anchored-popup.tsx` and positioned from its trigger's own
  `getBoundingClientRect()`. It opens downwards, flips above when there is more
  room there, clamps its height to the space it actually has so the list scrolls
  internally, follows its trigger while an ancestor scrolls, and closes on an
  outside click or on Escape — which it takes in the **capture** phase and stops,
  so one press closes the dropdown and not the dialog around it.
- **Reason:** A popup drawn inside its control belongs to whatever scrolls around
  it. All three pickers positioned theirs `absolute; top: calc(100% + 4px)`, so
  inside a panel dialog the list was clipped at `.rp-body`'s edge and the only way
  to reach the options below the fold was to scroll the **dialog** — which moved
  the field, the header and the summary card while the list stayed put. The same
  was true of every ordinary page, whose `.content` is a scroll box too; the
  dialogs simply made it obvious. A list has its own scroll; nothing behind it
  should have to move.
- **Impact:** `.cbpop` keeps `position:fixed` and `.cal` no longer declares a
  position at all — the component places both. A new popup passes `width`
  (`anchor` / `auto` / `none`), never its own coordinates. Because the popup is a
  sibling of the overlay rather than a descendant, `z-index: 96` over `.ovl`'s
  `90` is what keeps it above a dialog, and a click inside it never reaches the
  backdrop's dismiss handler.
- **Do not change unless:** explicitly instructed. **Never position a popup
  relative to its own control**, never render `.cbpop` outside `AnchoredPopup`,
  and do not give one screen's dropdown bespoke placement.
- **Status:** Frozen, current.

### Design system lifted verbatim
- **Decision:** `globals.css` is the mockup's stylesheet, near-unmodified. No Tailwind or
  CSS-in-JS. Components emit its class names.
- **Reason:** It is a coherent, finished token system that already encodes the decisions
  from `akui_proto_ui_reference.md`. Rewriting discards that work.
- **Impact:** Styling means reusing classes, not authoring new CSS.
- **Do not change unless:** a genuinely new component has no existing class — then extend
  the sheet in its own section, matching the token vocabulary.

### Registry-driven entity pages
- **Decision:** One config in `entities.ts` drives list, detail and form. Routes are
  dynamic (`/master/[entity]`, `/accounting/[entity]`), and the four page bodies are
  written once in `components/master/entity-pages.tsx`; each module's route files are
  three-line wrappers that pass their own module key. That key is checked against the
  entity's, so `/accounting/partner` is a 404 rather than a second way into Partner.
- **Reason:** Mirrors the mockup's `ENTITIES` map; ~15 entities would otherwise be ~45 pages.
  Mounting the same pages under a second module is config, not another copy.
- **Impact:** Add an entity by adding config, not pages. A new module that owns registry
  entities needs four wrapper files and nothing else.
- **Do not change unless:** an entity needs behaviour the registry genuinely cannot express
  — then give that one a bespoke route and leave the registry intact.

### Chart of Accounts is the one registry entity with a tree list
- **Decision:** `Entity.view: "tree"` sends the *list* to `AccountTree` instead of
  `EntityList`. Detail, create and edit stay generic. Category and kelompok are read as
  structure only — they are seeded, have no menu, and are not accounts.
- **Reason:** The shape of the bagan akun is the information. A flat table of 36 rows
  hides what a reader of a chart of accounts is actually looking for, and the design
  system already carries the tree (`.tree`, `.tn`, `.tkids`) lifted from the mockup.
- **Impact:** One flag, one component. Everything else about the entity is registry
  config, so its form and its rules are enforced exactly like any other entity's.
- **Do not change unless:** a second entity needs a genuinely different list shape —
  and then give it its own named view rather than generalising this one.

### Ref options are keyed by field, and narrowed on the server
- **Decision:** `refOptions()` returns options keyed by **field name**, not by target
  table, and applies each field's structural `refFilter` in the query. The form applies
  only the part that depends on values the user is still choosing (the Company, the
  Budget Category). Every rule is then re-checked by the Server Action.
- **Reason:** Two fields can target the same table and still need different sets —
  `parent_account` may pick any account in the Company, while Cash & Bank may pick only
  a postable Kas/Bank one. Keying by table made one of them wrong, and the narrowing
  lived only in the client, so the picker and the action could disagree.
- **Impact:** A ref column in a list looks its options up by its own field name. Adding
  a narrowing means adding a `refFilter` name plus its server-side `where` — never a
  client-only filter.
- **Do not change unless:** explicitly instructed. **A picker's filter is never the
  enforcement**; the matching check in the Server Action is.

### The page header is sticky, and every action lives in it (FROZEN)
- **Decision:** `.pad > .ph` is `position: sticky; top: 0`, so the breadcrumb,
  title, status and `.ph-act` travel with the page as it scrolls. **Every**
  action a page offers sits in `.ph-act` at the top right — Batal and Simpan
  while editing, Ubah and the lifecycle transitions while viewing. The bottom
  `.dirty` bar is gone from all six forms; unsaved changes are stated by a
  `.ph-dirty` chip beside the Simpan button that resolves them.
- **Reason:** Cash Bank Transaction showed why. Its header carried only Batal
  while editing, so on a new document the only Simpan was inside the bottom
  bar — and that bar rendered only once the form was dirty. A user who had
  filled nothing in could not see how to save, and a user who had could only
  save by scrolling past a Budget table of arbitrary length. Actions belong
  where a reader looks first, and one place, not two.
- **Impact:** A new page gets its buttons in `.ph-act` and nowhere else. Every
  page-header rule is scoped `.pad >` **deliberately**, and `globals.css` now
  carries **no bare `.ph` rule at all**: `.ph` is also the placeholder class
  inside `Combobox`, `Select` and `DateInput`. Page headers are always a direct
  child of `.pad`, so the selector is exact. `z-index: 30` puts the header over
  a table's own sticky `thead` (3) and the report criteria bar (20), under the
  topbar (40). The header costs about 100px of a scrolling viewport, which is
  the price of the actions always being reachable.
- **What a bare `.ph` rule actually did.** `.ph{margin-bottom:15px}` shipped
  alongside the scoped one and put 15px under **every dropdown placeholder in
  the application**. Inside a control centred on its children that lifted the
  text half a line above the caret beside it — visible on every report filter,
  every FK picker and every form select, and invisible the moment a value was
  chosen, because only the placeholder carries the class. Nothing broke; the
  application simply looked slightly wrong in one specific way on every screen.
  `tests/design-system.test.ts` now fails on a bare `.ph` selector.
- **Do not change unless:** explicitly instructed. **Never add a button bar at
  the bottom of a form**, and **never write a bare `.ph` rule** — not the sticky
  one, not a margin, not anything. `.pad > .ph` and `.cbx .ph` both say which
  `.ph` they mean, and that is the only acceptable shape.
- **Status:** Frozen, current.

### A header's buttons are ordered danger → neutral → primary (FROZEN)
- **Decision:** Inside `.ph-act` the order, left to right, is **what refuses,
  then what is merely another step, then the one thing the screen is chiefly
  for**. There is exactly one primary per header and it is the **rightmost**
  button. `src/lib/siba/header-actions.ts` is the single implementation:
  `ActionTone` (`danger` / `neutral` / `primary`), `orderForHeader` for the
  placement, `headerButtonClass` for the weight. Every lifecycle transition
  declares its own `tone`, so the table that says what an action *is* is also
  what says how it is drawn and where it sits. A **vertical row menu keeps the
  opposite arrangement** — safe first, danger last — which is what
  `availableActions` returns.
- **Reason:** The three lifecycle headers each mapped their module's
  `availableActions()` straight into `.ph-act`, and that order — submit,
  approve, reject, cancel — was written for the row menu. Reused horizontally
  it put **Setujui** to the left of **Tolak** on a Submitted budget and
  **Ajukan** to the right of **Ubah** on a Draft one, so the same click landed
  on a different word depending which status the record happened to be in.
  Nothing was broken; the buttons simply moved around under the user's cursor,
  and a destructive one kept arriving where a confirming one had just been.
  Fiscal Year drew two primaries side by side for the same reason — the weight
  was decided by a string comparison in the component (`a === "approve"`)
  rather than by the table.
- **Impact:** `Draft` reads `Batalkan · Ubah · Ajukan`, `Submitted` reads
  `Tolak · Batalkan · Setujui`, a Draft document reads `Batalkan · Ubah · Post`,
  and a Draft Fiscal Year reads `Ubah · Aktifkan Tahun Buku` — Ubah steps down
  to neutral wherever a lifecycle action is offered beside it, which is what
  `EntityForm`'s `editTone` prop carries. Two buttons of one tone keep the
  order their transition table declares, because the sort is stable.
- **Ordered in the markup, never with CSS `order`.** `order` moves a button on
  screen without moving it in the document, so the tab order would stop
  matching what a keyboard user is looking at. A one-line stylesheet rule was
  the tempting version of this and is the wrong one.
- **`tests/design-system.test.ts` holds it**: no `.ph-act` block may write a
  danger button after its primary, no component may decide a lifecycle button's
  weight inline, every transition must carry a `tone`, and the resulting order
  for each status is pinned outright — the application has no delete, so those
  statuses cannot be walked through in a browser without leaving records behind.
- **Do not change unless:** explicitly instructed. **Never put a destructive
  action to the right of the primary**, never give one header two primaries,
  never decide a button's weight inline where `headerButtonClass` exists, and
  do not reorder `.ph-act` with CSS.
- **Status:** Frozen, current.

### A posted journal balances, and never changes (FROZEN)
- **Decision:** Every journal reaches `Posted` through the posting engine in
  `lib/siba/journal.ts`, which **refuses** any journal whose two sides do not
  sum equal **in base currency**. A posted journal is immutable: nothing
  updates, deletes or reverses one, and a correction is a new journal. The
  posting date is the day of posting, never back-dated. An automatic journal —
  one a business document produced — is written by `postJournal` inside that
  document's posting transaction and is `Posted` the moment it exists;
  `applyPosting` calls it **alongside** `recordCashBankEntry`, in the same
  `prisma.$transaction`.
- **A manual journal is the second way in, and it changes none of the above.**
  See "A manual journal is drafted, posted, and may not touch a book" below.
  `resolveJournalLines` is the shared validator, so the two paths cannot come
  to different conclusions about what a balanced journal is.
- **This supersedes the earlier wording** that a journal is "produced by a
  posting, never drafted towards one" and that "viewing is the whole
  capability". Both were true while every journal came from a document. What
  survives unchanged is the part that matters: nothing is in the books until a
  posting put it there, and once it is there it never moves.
- **The journal is measured in base.** `debit_amount` and `kredit_amount` are
  rupiah; `trx_amount`, `currency_id` and `exchange_rate` carry the same line's
  transaction-currency face. Every line states the rate it was valued at, with
  no default — `1` is right only when the money is already base currency.
  A consequence with teeth: **one journal may hold lines in two different
  currencies**, and it balances only in base. Every journal used to be
  single-currency and three places in the code relied on it.
- **Reason:** Concept doc §2.5 and §2.6 — operational books are independent
  historical stores and only the General Ledger derives from journal lines. If
  the book were derived from the journal, or the journal from the book, one
  would silently become a view of the other and the reconciliation they exist
  for would prove nothing. And the balance has to be refused at the point of
  writing: a trial balance that fails to add up only means something if a
  journal could never have been written unbalanced in the first place.
- **Impact:** A Cash Bank Transaction journals its Cash & Bank resource's own
  account against the account its Purpose maps to — one cash line, one counter
  line per document line, so a ledger entry reads back to the Budget it
  settled. **Posting now requires the mapping** (rule 50), which approval does
  not. `unbalancedJournals` exists so the Trial Balance can say "this is a
  system fault" rather than print a difference nobody can act on.
- **Do not change unless:** explicitly instructed. **Never add an edit, delete
  or reversal path for a *posted* journal**, never derive an operational book
  from journal lines, never write a journal outside the posting engine, and
  never back-date one.
- **Status:** Frozen, current.

### A manual journal is drafted, posted, and may not touch a book (FROZEN)
- **Decision:** A journal may also be typed by a person — depreciation, an
  accrual, a reclassification, an equity entry: the work that is real accounting
  but is not a cash movement anybody could raise a Budget for. It is an
  `acc_journal` row like any other, distinguished by `is_manual`, and it is the
  **only** kind that is ever a `Draft`. Saving writes the draft; posting runs
  the same validation an automatic posting does, stamps the posting date and
  flips the status. `JUR-0001` is its own number series beside `JRN-0001`, so
  which kind of journal a number names is readable without opening it.
  `Cancelled` retires a draft that should not exist, because nothing here is
  deleted.
- **A manual journal may not create a discrepancy between the General Ledger and
  a book.** That is the whole safety requirement, and it is the user's. The
  operational books are written *alongside* the journal by one posting, which is
  why they agree with it; a hand-written line touching an account one of them
  reconciles against would move the General Ledger and leave the book behind,
  and **nothing would error** — the application would simply stop being able to
  prove its own figures.
- **The check is two flags: `is_postable` and `is_control_account`.** Stated by
  the user as the general rule for deciding whether an account may be used, and
  it is the whole test here — plus active and same-Company, with
  `checkAccountIsLeaf` as the structural backstop under `is_postable` (an
  account that somehow still carried the flag is refused anyway). The refusal
  **names the book**, because "tidak dapat dipilih" tells nobody which document
  they should have raised instead.
- **The structure decides the flag, in both directions, so nobody has to
  remember to.** `is_control_account` existed since the schema was written and
  nothing read it or set it — it was a checkbox. It is now the recomputed
  answer to "does anything outside the General Ledger reconcile against this
  account?": a Cash & Bank resource registered on it, a mapping from a Budget
  Category that keeps a subject book, a bridge or FX System Default naming it.
  `syncControlAccounts` in `records.ts` re-asks that question on every write
  that can change it, and writes only when the answer has moved.
- **Claiming used to be automatic and releasing was not**, which is the defect
  this closed. A mapping repointed at another account left the old one flagged
  for good — closed to manual entry, reconciling against nothing, with a
  checkbox as the only way back. That checkbox is now gone too (§10 rule 80),
  so a one-way claim would have been worse than what it replaced. What is lost
  is declaring a control account **by hand** where nothing structurally claims
  it. That is deliberate: rule 79 defines a control account as one a book
  reconciles against, and ticking the box on an account nothing reconciles
  against was using the flag to mean a different thing ("don't hand-write
  here"). If that policy lever is ever wanted it is a separate flag with a
  separate name, not this one.
- **Reason for the shape.** A separate document table was the alternative and
  the user chose this one: the draft lives in `acc_journal`, and automatic
  journals are categorised as instantly Posted. The cost is real and is paid in
  one place — **every reader of journal lines filters `status: "Posted"`**: the
  General Ledger's opening and movement reads, the Trial Balance's two, and
  `unbalancedJournals`, which would otherwise report every half-finished draft
  as a system fault. `tests/manual-journal.test.ts` pins that a draft reaches
  neither report.
- **Impact:** `posting_date` is nullable — a draft has none, because the date is
  written when the books are. Debit and kredit are base currency as they always
  were; a foreign line carries its own currency, kurs and face amount as extra
  information on the same row, which is the user's own statement of the rule. A
  draft is allowed **not to balance**: a journal halfway through being typed
  does not, and enforcing it at save would put the rule at the wrong moment. The
  accounts are **re-checked at Post**, not trusted from when the draft was
  written — a mapping made in the meantime can have turned one into a control
  account, which is the same reasoning `applyPosting` uses for re-reading its
  Budgets.
- **Where the rules live.** `lib/siba/manual-journal.ts` owns the account and
  line rules and `lib/siba/journal.ts` owns the table, so the Journal stays a
  leaf that imports only the shared kernel: deciding what a manual journal may
  touch needs the Cash Bank Book, the subject books and the System Defaults, and
  a book that imported those could not be lifted out. No new boundary crossing.
- **Do not change unless:** explicitly instructed. **Never let a manual journal
  reach a control account**, never let a draft be read by a ledger report, never
  put either account flag back on a form, never reduce `syncControlAccounts` to
  a one-way claim, never add a date field to the form, and never add a reversal
  — a posted manual journal is as final as any other.
- **Status:** Frozen, current.

### A subject book is a Budget Category (FROZEN)
- **Decision:** The subledgers — the concept doc's Prive / Titipan / Hutang /
  Piutang Ledgers, plus Investasi and Hasil Investasi — are **one** append-only
  table (`sub_ledger`) with a `book` discriminator, one materialised position
  table (`sub_ledger_balance`), one writer (`recordSubledgerEntry`), one reader
  (`subledgerReport`), one report body — and **one Report View, one permission
  and one menu entry for all of them**. A book *is* a Budget Category that names
  a Partner. Which book you are reading is a parameter (`?book=bcat.0002`), not
  a report of its own.
- **This supersedes the six-entry catalogue.** `subledger-catalogue.ts` used to
  declare six books, each with its own key, slug, permission, nav entry and
  Report View — so a seventh category meant a code change, a new permission and
  a deploy. The categories are data now (see the decision above), and the user
  asked for a new one to have its book without a developer in the loop.
  **Confirmed with the user before implementation.**
- **What a book derives, and what it stores.** Derived: its **name** (`Buku
  Hutang`), its **subject line**, and its **nature** — a category that moves
  both ways holds a *position* that settles to nil, one that moves a single way
  only accumulates, which is exactly `allows_in && allows_out` and matched all
  six hand-written entries. Stored on the category: **`raises`**, which cash
  direction raises the subject's position, the one fact nothing else predicts;
  and **`book_icon`** / **`book_closing_label`**, presentation that falls back.
- **A book exists when the category names a Partner *and* says which way it
  runs.** A category with a Partner but no `raises` is a **setup gap**, not a
  category without a book: the list says `arah belum diatur` rather than a dash,
  because the two are different things somebody would act on differently. A book
  running the wrong way is worse than no book, so it is not guessed.
- **The key is the category's code, and the lookup is by its id.**
  `sub_ledger.book` holds `bcat.0002` — the code, because it is
  system-generated and never edited, so renaming "Hutang" cannot orphan a book,
  which is exactly what keying on the label used to risk. It stays a **string,
  not a foreign key**: `sub_ledger` is an independent store that must stay
  liftable, and a book declaring a relation to the table classifying it would
  invite being derived from it. In code, `subledgerForCategory` takes the
  category's **row id**, which is what every caller already holds.
- **A Purpose is not a way in.** The Purpose is the control an operator picks on
  a Cash Bank Transaction; it resolves to a Budget Category, and the **category**
  owns the book. Resolving a book through the Purpose's own copy of the category
  label is the mistake this rule exists to prevent — the user's own correction.
- **Which categories, and why six became "however many".** A category earns a
  book when its postings name a Partner, because that is what gives the book a
  subject. The concept doc (§11.3–§11.6) names four; `rules.ts` grew Investasi
  and Hasil Investasi, which carry a Cabang. Asset and Biaya take no Partner and
  keep no book; their postings still reach the Cash Bank Book and the Journal.
- **One permission, which is a reversal.** Each book used to carry its own
  `REPORT_<BOOK>_LEDGER_VIEW`, on the reasoning that who may read the owners'
  Prive is a different decision from who may read Hutang. A book is now created
  through the GUI, so a permission per book would be a permission created at
  runtime — the one thing the catalogue forbids. `REPORT_SUBLEDGER_VIEW` covers
  all of them. **The cost is real and is recorded in §17**: whoever may read
  Hutang may read Prive. Nothing in the seeded roles relied on the distinction.
- **Menu placement deviates from the concept doc, deliberately.** §21 lists the
  ledgers under Accounting › Ledger beside the General Ledger. The one entry
  lives under **Finance › Laporan** instead, on the user's instruction: the books
  are written by Finance's Post, and Accounting's two reports are the ones that
  derive from journals.
- **Do not change unless:** explicitly instructed. **Never add an update, delete
  or reversal path to `sub_ledger`**, never derive a subject book from a journal
  line, never write one outside `recordSubledgerEntry`, do not split the books
  into separate tables or give one its own report, **do not go back to one report
  or one permission per book**, and do not resolve a book through a Purpose or a
  category label.
- **Status:** Frozen, current. Supersedes "The subject books are one mechanism
  with six books".

### The ledger reports take several accounts, one Company at a time (FROZEN)
- **Decision:** General Ledger and Trial Balance are Report Views in the
  **Accounting** module (`accounting/report/[report]`), on the same convention
  as Finance's. They take the `account-period` parameter set: a **Company
  filter**, **several accounts** (`?accounts=3,17,42`) and a date range. Each
  account gets its own table, rolled up to opening / debit / credit / closing
  and expandable to its entries.
- **Reason:** Reading a ledger means comparing an account against its
  counterpart, so one account per page load is what makes checking the books
  tedious. Rolled up by default because the figure is what a reader checks
  first and the rows are what they check it against. One Company per run
  because each numbers its own chart — the induk's 1.1.1.1 and the anak's are
  different accounts sharing a number, and offering both would read as
  duplicates.
- **Both reports are measured in base currency, on one scale.** This
  supersedes the per-currency grouping they carried while the system held no
  rate at all, and restores concept doc §11.2 and §16. Every journal line now
  stores what it was worth in rupiah, so both reports read one column.
  The grouping could not have survived multi-currency in any case: **one
  journal may hold two currencies** — a foreign document paid from a
  base-currency resource is exactly that — so grouping by transaction currency
  would split one balanced entry across two tables and leave neither of them
  balancing. The transaction-currency face is not lost; it travels on each
  entry (`trxAmount`, `trxCurrencyLabel`, `rate`) so a reader can see that a
  rupiah figure came from three hundred dollars, and `LedgerAccount`
  names the foreign currencies that fed it.
- **Do not change unless:** explicitly instructed. **Do not sum across accounts
  in the General Ledger** — that is the Trial Balance's job — and do not group
  either report by transaction currency again.
- **Status:** Frozen, current.

### An Opening Balance is a snapshot, and a report's opening stands on it (FROZEN)
- **Decision:** `acc_opening_balance(_line)` records where one Company's accounts
  stood at the start of one fiscal year, at the journal line's own
  `(account, partner?)` grain, in base currency, **written once and never touched**.
  A close writes one; a developer injects the go-live figures with
  `source_fiscal_year_id = null`. There is no create form, no edit path and no
  delete. The General Ledger and the Trial Balance then compute their openings from
  the latest snapshot on or before the range's start, plus the lines since —
  `openingBasis` in `ledger.ts` — instead of summing every journal line the Company
  has ever posted.
- **Reason:** two different ones, and both matter. A closed year has to hand the next
  one its position in a form somebody can read, rather than as an instruction to
  re-add all of history. And the opening scan grows without bound: a report for March
  2030 should need where the accounts stood on 1 January 2030 plus two months, not
  four years line by line.
- **Equivalence is the whole guarantee.** For the same account and the same date, the
  snapshot-based opening equals the full-scan opening **to the cent**. Where no
  snapshot covers the date the scan runs exactly as it always did, so a database that
  has never closed a year produces the figures it produced before any of this
  existed. `tests/ledger-opening.test.ts` restates the pre-change algorithm as a
  reference — deliberately *not* imported, so the two cannot drift into agreement by
  sharing code — and pushes at three boundaries: before any snapshot, exactly on one,
  and a year past one.
- **The grain is what was posted, never what a flag says.** Pairs come from the
  journal lines as they actually are; reading `acc_account.require_partner` would drop
  a partner-bearing balance on an unflagged account and invent a null-partner line for
  an account that has none. There is no parent row holding an account's total: that
  figure is the sum of its children, and an immutable snapshot has no rebuild function
  to prove a stored duplicate still agrees with what it duplicates.
- **Impact:** uniqueness on `(opening_id, account_id, partner_id)` is created
  **`NULLS NOT DISTINCT`** in the migration's own SQL, because Postgres otherwise
  treats two null-partner rows for one account as distinct — which is the common case
  and precisely the duplicate that matters. The Trial Balance now seeds its rows from
  the snapshot as well as from the period's lines, or an account carrying an opening
  and no movement would vanish from it. Both reports say which document their opening
  came from, as one clause on the footnote they already carry. What is genuinely lost
  is recorded in §17: a snapshot is base currency, so it cannot say which currencies
  fed an opening.
- **Do not change unless:** explicitly instructed. **Never add an update, delete or
  reversal path to a snapshot, never give it a create form, never derive its grain
  from `require_partner`, and never let a snapshot-based opening disagree with the
  full scan** — if they ever differ, the report is wrong.
- **Status:** Frozen, current.

### Company access is a permission, and the picker lives on the page (FROZEN)
- **Decision:** Which Company's records a user may see is governed by two
  ordinary catalogue permissions, `COMPANY_INDUK_ACCESS` and
  `COMPANY_ANAK_ACCESS`, granted on the role permission matrix beside every
  other capability. A user may hold both, one, or **neither** — neither means
  no Company-scoped record is readable at all. The Company *selection* is a
  per-page control (`?company=`) on the screens where it is genuinely
  ambiguous: Partner, Cash & Bank, Chart of Accounts, the account mappings and
  the Journal register.
  **There is no Company control in the topbar.**
- **Reason:** A global context in the topbar made every page's contents depend
  on a control somewhere else, and it answered a question most screens never
  ask. Access is also not a preference — who may see the anak's books is an
  administrator's decision, so it belongs where every other such decision is
  made. Two permissions rather than a grant table keeps the RBAC path single
  (§12, "RBAC is role-based only"): the two-Company structure is foundational,
  so there will never be a third row to add.
- **Impact:** `lib/siba/company-access.ts` resolves permissions to Companies,
  keyed on `is_parent` and never on a label — a Company's identity is editable
  through the seed, its structure is not. A page with a picker calls
  `companyScope`; a page without one (Budget, Finance's document register) reads
  `accessibleCompanyIds` and shows every Company the user may see. **Every Report
  View has a picker**, and the reports it drives were the one place this was not
  enforced at all: `cashBankLedgerReport` and `cashBankBalanceReport` read every
  resource in the database regardless of who was asking, which is why they now
  take the scope as an argument like everything else. A picker
  with fewer than two options does not render, because that is not a choice.
  A `?company=` naming a Company the user may not access falls back to one
  they can, inside what the permissions already allow.
- **Scoped readers take their Companies as an argument**, never resolving them
  themselves: `listRows`, `accountTree`, `budgetMonths`, `listBudgets` and
  `listTransactions` are all handed the scope by the page. An earlier attempt
  had them read a context cookie directly and `tests/budget.test.ts` failed
  with "cookies was called outside a request scope" — which is the point. A
  data module that reaches into the request cannot be tested, and this codebase
  puts rules in the data module precisely so tests can exercise them.
- **Do not change unless:** explicitly instructed. **Do not put a Company
  control back in the topbar**, do not add a per-user or per-record Company
  grant table, and do not let a scoped reader resolve its own Company.
- **Status:** Frozen, current.

### A chart of accounts belongs to one Company, and the tree shows one (FROZEN)
- **Decision:** Account numbering is per Company. Two Companies each holding
  their own `1.1.4.1` is correct and expected; one Company holding it twice is
  refused by `checkAccountNumber` and, underneath, by
  `@@unique([company_id, account_label])`. The Chart of Accounts tree therefore
  renders one Company's chart alone, chosen from the picker in its own toolbar.
- **Reason:** With both Companies populated the tree listed every number twice,
  one row per Company, which reads as duplicated data rather than as two books.
  The numbers were never duplicated — the screen was.
- **Impact:** The per-row Company badge is gone from the tree: the picker names
  the Company once, so repeating it on every row earned nothing. Search, the
  expand/collapse state and the kelompok counts all work on the selected
  Company's accounts only, and the picker offers only the Companies the reader's
  permissions open.
- **Do not change unless:** explicitly instructed. **Never make account numbers
  globally unique** — that would stop the anak from keeping a normal chart of
  accounts — and do not merge both Companies back into one tree.
- **Status:** Frozen, current.

### The chart of accounts is one lineage-numbered tree (FROZEN)
- **Decision:** Account Type, Account Category, Account Subcategory and Account
  share a single dotted numbering scheme, and every level **continues** its
  parent's code: `1` AKTIVA → `1.1` AKTIVA LANCAR → `1.1.1` KAS / SETARA KAS →
  `1.1.1.2` BANK → `1.1.1.2.1` BANK BCA IDR. The first three levels are exactly
  one, two and three segments and are **seeded**; everything deeper is an
  account and may nest without limit. A segment is a whole number **1–999**,
  unique within its parent — so `1.1.1.10` and `1.1.2.10` may both exist and two
  `1.1.1.10` in one Company may not. The rules live in
  `src/lib/siba/account-code.ts`, which is client-safe so the form and the
  Server Action read the same ones.
- **Reason:** A code that carries its lineage is readable on its own: anyone
  looking at `1.1.1.2.1` knows it is a bank account under cash & equivalents
  under current assets, without a join. That only holds if the code cannot
  disagree with the tree, which means the code must be composed rather than
  typed.
- **Impact:** The **create form offers one segment**, rendered after the
  inherited code (`1.1.1.` · `[ 2 ]`). `composeSegmentCode` in
  `app/actions/master.ts` writes `account_label`; a submitted one is ignored.
  This is a registry field type — `type: "segment"` with `inheritsFrom` and
  `writesTo` — so a second entity numbered this way is config, not a branch.
  An account's number is **frozen after creation** (rule 45) and a Parent
  Account must share the Kelompok (rule 46).
- **The skeleton comes from `Initialization/Template COA.xlsx`.** Sheet1 is the
  workbook's **only visible sheet** — the other eight are `state="hidden"` and
  are older, unrelated schemes. `COA_SKELETON` in `prisma/seed.ts` transcribes
  it: 5 types, 17 categories, 37 subcategories, names verbatim.
- **Do not change unless:** explicitly instructed. **Never let an account number
  be typed whole, never add a renumber or move path, and do not seed accounts** —
  depth 4 and below is the user's chart, created through the GUI (§12, seeder
  scope).
- **Status:** Frozen, current.

### Cash & Bank anchors on kelompok 1.1.1, not on account names (FROZEN)
- **Decision:** `CASH_BANK_SUBCATEGORY` in `src/lib/siba/records.ts` is the
  single string `"1.1.1"`. A Cash & Bank resource may post to any postable,
  active account of its own Company sitting under that kelompok, at any depth.
- **Reason:** It replaced `CASH_BANK_SUBCATEGORIES = ["Kas", "Bank"]`, which
  named two *subcategories*. In the real chart KAS and BANK are **accounts**
  (`1.1.1.1`, `1.1.1.2`) under one kelompok, and the accounts beneath them —
  BANK BCA IDR and so on — are the user's to create. Anchoring on the kelompok
  keeps the rule a single check that stays true however deep the user nests.
- **Impact:** One constant, read by `accountWhere` (the picker) and
  `checkCashBankAccount` (the enforcement). Renaming kelompok `1.1.1` in the
  seed without changing it here silently breaks the rule, which is why the
  seed says so at the top of its skeleton.
- **Do not change unless:** explicitly instructed. **Do not widen this to a list
  of account names, and do not make it configurable.**
- **Status:** Frozen, current.

### Prisma 7 requires a driver adapter
- **Decision:** Clients are constructed with `new PrismaPg({ connectionString })`.
- **Reason:** Prisma 7 removed the bundled engine connection path.
- **Impact:** `new PrismaClient()` without an adapter throws at runtime. Applies to the app
  singleton and any script, including the seed.
- **Do not change unless:** upgrading Prisma changes the contract.

### The cached Prisma client is keyed on the generated class (FROZEN)
- **Decision:** `src/lib/prisma.ts` still caches one client on `globalThis` so the dev
  server does not open a pool per hot reload, but the cache now remembers *which*
  `PrismaClient` class produced the instance. When that class is not the one currently
  imported, the cached instance is disconnected and replaced.
- **Reason:** `npx prisma generate` rewrites the generated client while `next dev` is
  still running. A plain `globalForPrisma.prisma ?? createClient()` then hands back an
  instance built from the *previous* class, which carries only the models it was
  generated with — every model added since reads as `undefined`. That is what broke
  every create page once `SysSetting` was added: the first call to
  `prisma.sysSetting.findMany()` threw "Cannot read properties of undefined", and the
  typechecker could not see it, because the types came from that same stale client.
  A regenerated class is a different object, which is the cheapest reliable signal.
- **Impact:** A schema change no longer needs the dev server restarted, and the failure
  is no longer reachable by hot reload alone. `tests/schema.test.ts` is the other half:
  it asserts every model in `schema.prisma` has both a delegate on the generated client
  and a table in the database, and names the command to run when one is missing.
- **Do not change unless:** explicitly instructed. **Never reduce the cache back to a
  bare presence check**, and do not drop the schema suite — between them they are what
  turn a silent runtime crash into a failure with the fix attached.
- **Status:** Frozen, current.

### A menu destination always renders (FROZEN)
- **Decision:** Every entry `nav.ts` can show has a route that answers inside the shell.
  Where a destination is not built yet, the route exists anyway and explains itself.
- **`tests/design-system.test.ts` holds it, one test per entry.** An entry
  resolves either as a **registry entity whose slug *and module* both match**,
  or as a route directory of its own — and the first segment of that route must
  be a real directory, never the registry's `[entity]`. That last clause is the
  whole point: every module holding registry entities also has a dynamic segment
  matching any slug, so a weaker check calls a broken entry healthy.
- **It has failed once.** Removing the Budget Category × Partner Category
  pairing from the registry took `sys_purpose` out with it, and the Purpose menu
  linked to a 404 for two rounds of work — nothing built, type-checked or tested
  differently, because a menu entry is a string and a missing route is a runtime
  `notFound()`.
- **Reason:** The icon rail linked to `/finance/cash-bank-transaction`, which had no
  route: clicking it produced the framework's bare English 404, outside the design
  system, in an Indonesian application. `EntityLocked` already settled the principle for
  Company — a route the UI offers should explain itself rather than 404.
- **Impact:** Adding a menu entry means adding its destination in the same change, even
  when that destination is only an explanation.
- **History:** Finance's placeholder (`finance/[entity]/page.tsx`) was exactly such a
  page and has been **removed**, replaced by the real
  `finance/cash-bank-transaction/` routes — which is what that decision said would
  happen. Nothing in `nav.ts` is now without a real destination.
- **Do not change unless:** explicitly instructed. **Never add a `nav.ts` entry whose
  route does not answer.**
- **Status:** Frozen, current.

### snake_case Prisma fields
- **Decision:** Model names PascalCase; field names snake_case matching the DBML.
- **Reason:** The registry addresses columns by string, and the mockup's logic uses the
  same names — identical naming makes ports verbatim.
- **Impact:** Idiomatic-TS renaming would break registry configs.
- **Do not change unless:** the registry approach is abandoned.

### Schema deviations from the source DBML
- **Decision:** Four intentional deviations, each commented in `schema.prisma`:
  `Int` ids instead of `bigint`; money normalised to `Decimal(18,2)` (the DBML used
  `(18,6)` on budget amounts only — read as a typo); `document_date` nullable (the mockup
  records it only at post time); added `SysUser`, `sys_company.is_parent`,
  `acc_account.partner_category_id`, `acc_budget_category_account.partner_category_id`,
  `audit_log`, the Cash Bank Book tables, and dropped `acc_account.partner_type`.
- **Reason:** The DBML lacks columns the application demonstrably needs; the mockup annotates
  most of these itself.
- **Impact:** The DBML is reference, not gospel.
- **Note:** `cash_bank_ledger` / `cash_bank_balance` are the concept doc's "Cash Bank
  Book", which the DBML never modelled. See §9 and §12.
- **Do not change unless:** the user confirms the original DBML intent.

### Combobox shows inactive records only when selected
- **Decision:** Inactive records are hidden from FK pickers, except the one currently set.
- **Reason:** `akui_proto_ui_reference.md` §12.3 left this open. Hiding outright would
  silently drop a valid reference when editing an older record.
- **Impact:** Applies to every FK picker.
- **Do not change unless:** the user decides otherwise.

### No API layer, with one deliberate exception
- **Decision:** Server Components read; Server Actions write. No REST/GraphQL for
  business data. **The one Route Handler in the application is `/api/health`**, which
  reports whether the process is up and whether the database answers.
- **Reason:** No external consumer exists for business data, and an API layer for ~15
  CRUD entities is overhead. A health endpoint is the case the original rule reserved:
  its consumer *is* external and has no session — a process supervisor, a reverse proxy,
  or a deploy script waiting for the new process. A Server Action cannot serve it.
- **Impact:** `/api/health` is the only path besides `/login` that `src/proxy.ts` lets
  through without a session cookie, because a 302 to the login page reads as "alive" to
  most monitors. It returns `{status, database}` and nothing else — no version, no schema
  detail, no error text. A public endpoint that describes the inside of the system is a
  reconnaissance tool; the real reason goes to the server log.
- **The other legitimate Route Handler is a file download.** Report export (§13) cannot
  be a Server Action, which returns serializable data rather than a `Response` with
  `Content-Disposition`. That is a second instance of the same exception, not a new rule.
- **Do not change unless:** an external consumer appears. **Adding a Route Handler for
  business CRUD is still the thing this decision forbids** — and if one ever lands, the
  authorization gate must stay `auth.ts`, never a second model (§11).

### Two-company structure is foundational (FROZEN — architectural bedrock)
- **Decision:** The application is built around exactly **two permanent companies**: one
  parent (*induk*, `is_parent = true`) and one child (*anak*). There will never be a
  third company, a second parent, or a second child. This is a foundation of the
  application, **not** a configurable multi-company architecture — modules and business
  logic may assume it directly.
- **Reason:** This is the real shape of the business. Generalising it into a configurable
  multi-company ERP adds cost and abstraction for a case that will never occur.
- **Impact:** Reverses the earlier decision that enabled Company create. Design future
  modules against this invariant rather than abstracting over it.
- **Do not change unless:** an explicit new requirement changes the architecture.
  **Do not assume this ever becomes configurable.**
- **Status:** Frozen, foundational. Lock implemented in `src/lib/siba/company.ts`,
  enforced by the Server Actions and the `/master/[entity]` routes.

**Three consequences of that decision:**

**a. Company create and edit are locked.** The Company UI may stay visible for list and
detail. Creation and editing must be blocked at **both** layers — routes *and* Server
Actions. Hiding or disabling the button is not sufficient: `createRecord` and
`updateRecord` must themselves reject the `company` slug, and any future API entry point
must too. Implement this directly in application logic; **do not add a configuration
table to express the restriction**, and do not build a generic per-entity permission
framework for it.

**b. No treasury-provider relationship model.** With one parent and one child, a
company-to-company provider mapping is redundant. **Do not add
`treasury_provider_company_id`, a treasury-provider table, or any other
company-to-company relationship table.** The `is_parent` flag on the existing company
master is the entire model: the `is_parent = true` record is the Induk, the other is the
Anak.

**c. Child funding always goes to the parent.** Resolve the parent from the company
master at runtime (query `is_parent = true`) rather than hard-coding an id or duplicating
the relationship anywhere. Do not build a configurable funding-provider mechanism.

**Why the company table is still retained.** It remains a master/reference table so
company identity — `company_name`, `company_label`, `company_code`, notes — can be
changed later through the **seeder / seed data**, without touching application code or
exposing a GUI. It is *not* a mechanism for configuring how many companies exist or how
they relate. Keep the table; keep it out of the UI's write path.

### The classification chain is data; the purposes are not (FROZEN)
- **Decision:** Which Partner Categories a Budget Category admits, and which
  directions are meaningful for it, are **rows**: `sys_budget_category` gains
  `allows_in`, `allows_out` and `require_partner`, and
  `sys_budget_partner_category_mapping` holds one row per admitted pair. Both
  category tables gain `status`. `BUDGET_CATEGORY_RULES` in `rules.ts` is
  **gone**; `classification.ts` holds the same rules as pure functions over a
  catalogue, and `classification-data.ts` loads it. Pengaturan > Klasifikasi is the
  GUI: three registry entities, no bespoke page.
- **Reason:** The user is still discovering the model and needs to reshape it
  and see what pops up downstream, which a constant compiled into the build
  cannot do. The three shapes were weighed — a join table, an array column on
  the category, and a pointer on the partner category — and the join table is
  the only one that supports deactivating a pair, which is the behaviour the
  user chose: narrowing a category must not rewrite history.
- **A pair is deactivated, never deleted.** A retired pair leaves the catalogue
  and stops being offered everywhere at once; the row survives so every Budget
  already classified by it still reads. The same holds for a deactivated Partner
  Category, which drops out of every category that admitted it without any of
  them being edited.
- **`require_partner` is a flag rather than `partnerCategories.length === 0`**,
  and that distinction is load-bearing: a category that names no subject by
  design (Asset, Biaya) is finished, while one that requires a Partner and has
  none configured is a setup gap. The list says "Tanpa Partner" for the first
  and "belum diatur" for the second. Clearing the flag while active pairs point
  at the category is **refused, by name** — the mirror rule, the same pairing
  `is_postable` and its sub-account rule use.
- **The catalogue is loaded whole and passed down.** `classification.ts` is
  client-safe for the reason `currency.ts` is: the form narrowing a picker and
  the Server Action refusing a value must read the identical rule. `EntityForm`
  takes it as a prop; `applicableFields` and `validate` in
  `app/actions/master.ts` re-check the same rows.
- **Impact:** `loadClassification` lives in its own module rather than in
  `records.ts`, because the Budget-count column on the classification screen has
  to ask `budget.ts` for its own table's figure (the module contract) and that
  would otherwise be a cycle. `tests/module-boundaries.test.ts` caught exactly
  that and `KNOWN_CROSSINGS` stays at two.
- **Do not change unless:** explicitly instructed. **Never delete a pair** —
  deactivate it; never let a category allow neither direction; never put the
  rules back in code; and never let a `require_partner = false` category hold a
  pair.
- **Status:** Frozen, current.

### A Budget Category is saved with what it admits, in one transaction (FROZEN)
- **Decision:** Which Partner Categories a Budget Category admits is chosen on
  the **Budget Category's own form**, as a `multiref` field, and written to
  `sys_budget_partner_category_mapping` **inside the same transaction** that
  writes the category. The pairing has no menu, no routes and no permissions of
  its own; `BUDGET_PARTNER_CATEGORY_*` is gone from the catalogue.
- **Reason:** it was two menus, so creating a category and saying what it admits
  were two records, two forms and two saves — and a category saved between them
  is **inert**: no Purpose names it and its subject book can receive nothing.
  Making that state merely *refused* (the earlier "simpan dulu dengan status Non
  Aktif…" message) left the user walking the detour every time. One transaction
  makes it unreachable instead, which is the rule in §10 rule 93 applied to its
  own cause rather than its symptom.
- **One transaction, not one screen.** Role is the near precedent and does
  **not** manage this: a new role is created, then its permission matrix is a
  second Server Action call from the same click, with "Role dibuat tanpa
  permission" written into the code as the failure path. That half-done state is
  exactly the one this rule exists to prevent, so the reconcile runs inside
  `createRecord`'s existing `prisma.$transaction` — the same place a Cash & Bank
  resource's book and first rate layer are written — and `updateRecord` gained a
  transaction for it.
- **A set is picked, not ticked.** `multiref` renders `MultiSelect` — a
  searchable `Combobox` that adds and chips that remove — never a checkbox per
  option. A grid costs vertical space in proportion to the **catalogue** rather
  than to the answer, and stops being scannable the moment the catalogue grows.
  The same component draws the report filter's several-Partners picker, which
  is where the pattern already existed; `tests/design-system.test.ts` fails on a
  second implementation of the chip row.
- **Arah is one field over two columns.** `allows_in` and `allows_out` are not
  offered as two checkboxes, because two checkboxes can both be off — a
  category moving in no direction classifies nothing, which the Server Action
  and a CHECK constraint both refuse *after* the user has built it. The form
  asks once, `Pengeluaran saja` / `Penerimaan saja` / `Keduanya`, and a required
  select has no fourth state to reach. The columns are unchanged, because every
  reader still wants the booleans. `derivedColumns` in `app/actions/master.ts`
  writes them and `virtualValues` in `records.ts` reads them back — mirrors that
  have to stay in step, which is what the round-trip test pins.
- **`raises` is asked only where it is a choice.** A single-direction category's
  book can only run that way, so the form stops asking and `derivedColumns`
  answers; `categoryChoosesRaises` is the predicate. Only `Keduanya` is asked.
- **`multiref` is a registry field type**, so this is config: `ref` names what
  may be chosen and `joinTable` names where the set is stored. (`writesTo` was
  taken — it is how a `segment` names the column its composed code goes into.)
  `required` beside `visibleWhen` reads as "mandatory exactly when the category
  names a Partner", because `validate` skips a field that does not apply.
- **Nothing is deleted.** Unticking sets the pairing Inactive; re-ticking reopens
  **the same row**, keeping its code, its authorship and its history, and never
  contending the unique index. Clearing "Memakai Partner" retires every pairing,
  because the field stops applying.
- **Hidden, not waiting.** The grid and the two book fields disappear when
  "Memakai Partner" is off. That is the user's own distinction: a field waiting
  on a **prerequisite** stays visible and inert (`waitingFor`), while a field
  that **does not apply to this record** is hidden. Filling in more of this form
  cannot make it answerable, so it goes.
- **Impact:** `reconcileMultiref` lives in `records.ts` rather than in the
  Server Action, so `tests/purposes.test.ts` drives the real rule — an action
  resolves its caller from a session cookie a test process does not have. The
  join table's code series is declared in `master.ts` (`bpcm.`), because a
  registry entity would otherwise have supplied it.
- **Do not change unless:** explicitly instructed. **Never give the pairing its
  own menu again**, never write the set outside the record's transaction, never
  delete a pairing row, and do not let a `multiref` reach the entity's own table
  — it is `virtual`.
- **Status:** Frozen, current.

### A Transaction Purpose is entered, and its label is composed (FROZEN)
- **Decision:** Purposes are rows in `sys_purpose` that a maintainer **enters**
  through Pengaturan › Klasifikasi › Transaction Purpose. Nothing generates one.
  Each names a direction, a Budget Category and a Partner Category, all three
  locked once saved, and its **label is composed** —
  `<Penerimaan|Pengeluaran> <Budget Category> <dari|ke> <Partner Category>` —
  never stored and never typed.
- **This supersedes "A Transaction Purpose is generated from the
  classification"**, which had `syncPurposes` derive the whole set so a new
  Budget Category was transactable the moment it was saved. **Reversed on the
  user's explicit instruction**, with the cost named by them: *"i understand it
  will lead to blockage in transaction when not set but this is not a failure
  but that mean the developer / maintenance at the time forget to add purpose in
  db after adding new budget category."*
- **Reason:** the table stands in for what somebody would otherwise type
  straight into the database, and the screen exists to exercise that. A Budget
  Category with no Purpose therefore cannot be transacted, and **that is the
  correct outcome** — it means whoever added the category has not finished. The
  gap is made *visible* (the Budget Category list carries a `Purpose` count) and
  is never closed automatically.
- **The label is computed, so it cannot drift.** Storing it would let a renamed
  Budget Category leave its Purposes reading the old name. It also makes the
  format uniform by construction: there is no field to type a one-off into, and
  no Sebutan on the form. What that discarded is the hand-written wording the
  original 22 carried — "Pemberian Advance kepada Karyawan" is now "Pengeluaran
  Piutang ke Karyawan". **Uniformity was chosen over naming the business
  event**, deliberately.
- **A consequence in the picker.** Every label now opens with its direction, so
  the chip that used to carry it was repeating a word the label already says —
  which is what the grouped-list decision forbids. The chip is gone; the group
  still states the Budget Category once.
- **The keys are unchanged and permanent.** `fin_cash_bank_transaction.purpose`
  holds them, and a posted document is permanent, so the original 22 keep their
  mnemonics (`TTP_CAB_IN`) — which is the only reason `SEED_PURPOSES` in
  `rules.ts` still exists. Entered ones carry `purp.NNNN`.
- **What is refused, and what is only hidden.** A Purpose naming a combination
  the classification does not admit is **refused at creation** — it could never
  be used, and an inert row is the thing §10 rule 93 forbids. But a pairing
  retired *afterwards* writes nothing: `availablePurposes` simply stops offering
  the Purpose, because Budget approval would refuse that classification anyway.
  A read-side filter where a write-side generator is not wanted.
- **Do not change unless:** explicitly instructed. **Never generate a Purpose**,
  never store its label, never add a "generate missing" action, never change a
  saved Purpose's direction, category or Partner Category, and do not filter
  `purposeOptions` — that is what a posted document is read back through.
- **Status:** Frozen, current. Supersedes "A Transaction Purpose is generated
  from the classification".

### The Cash Bank Book is the only source of a balance (FROZEN)
- **Decision:** `m_cash_bank` has **no** balance column. Every movement is an entry in
  `cash_bank_ledger`; `cash_bank_balance` holds the running total, one row per
  resource, written in the same database transaction as the entry that moved it.
  `src/lib/siba/cash-bank.ts` is the only module that writes either.
- **Reason:** A balance stored on the master duplicates the book's truth and drifts
  from it the first time anything is posted. Materialising the total next to the book
  that produces it keeps reads cheap without creating a second answer:
  `rebuildCashBankBalance` recomputes it from the entries and is what proves the two
  still agree.
- **Impact:** A resource's **opening balance** is entered on the Cash & Bank create
  form and becomes the first entry in its book — a create-only, `virtual` registry
  field that `createRecord` turns into an `Opening` entry, never a column. Every
  resource gets a balance row at registration, even at zero. The Cash & Bank detail
  page shows the book; the list shows the balance as a computed column.
- **The book is append-only.** No update path, no delete path, no cascade. A
  correction is a further entry. The concept doc also requires it to stay independent
  of the journal: when the posting engine lands it calls `recordCashBankEntry`
  alongside the journal write, and never derives one from the other.
- **Do not change unless:** explicitly instructed. **Never store a balance on a master
  table, and never make `cash_bank_ledger` editable.**
- **Status:** Frozen, current.

### Fiscal Year is the only fiscal entity; its periods are generated (FROZEN)
- **Decision:** Fiscal Year is a top-level menu entry. **Fiscal Period is not** — no
  menu, no route, no form, no permissions of its own. A Fiscal Year is created by
  choosing a year from a list; `year_name`, `start_date` (01/01) and `end_date`
  (31/12) are `derived` fields the Server Action writes. A year is always created
  **Draft** and is **activated** into `Open` by a deliberate act — which is what
  generates exactly twelve periods, one per calendar month, via
  `ensureFiscalPeriods` in `src/lib/siba/fiscal.ts`. They are shown on the Fiscal
  Year's detail page and nowhere else.
- **Reason:** A calendar month is not a judgement call. Every field a period needs
  follows from the year and the month number, so a form for it could only introduce
  errors — a period ending on 30 February, two periods overlapping, a thirteenth
  month — and Budget Month reads these ranges directly (rule 20), so a wrong one
  silently strands budgets between months or in none.
- **Impact:** `generation is idempotent on the count`: a year that already has periods
  is left untouched, so re-opening a closed year never duplicates or rewrites a month
  that has been posted into. `year_label` is `locked`, so the year cannot be changed
  out from under periods that already exist. Adding `derived` to a field means the
  action must fill it — see `derive()` in `app/actions/master.ts`.
- **Do not change unless:** explicitly instructed. **Do not give Fiscal Period a menu
  entry, a route, a registry config, or permissions**, and do not let a period's dates
  be edited by hand.
- **Status:** Frozen, current.

### A Fiscal Year has a lifecycle, not a status field (FROZEN)
- **Decision:** `Draft → Open → (closing process) → Closed`. `status` is **not an
  isian** on the Fiscal Year form: it is `derived` and `locked` in the registry, so no
  form renders it and `updateRecord` drops it; `derive()` pins a new year to `Draft`
  whatever was submitted. The one way out of Draft is
  `transitionFiscalYear` in `src/app/actions/fiscal.ts`, driven by the transition
  table in `src/lib/siba/fiscal-workflow.ts` — the same shape Budget uses. Activating
  is its own permission, `FISCAL_YEAR_OPEN`, separate from `FISCAL_YEAR_EDIT`.
- **Reason:** A book is started and closed; it is not a record whose status somebody
  types. Opening generates twelve periods and Budget Month is grouped by them, so
  letting a year be switched back to Draft from a dropdown would strand budgets inside
  a year claiming never to have begun — and letting an edit write `Closed` would
  "close" a book without locking anything.
- **Impact:** `Open` is a one-way door: no transition produces `Draft`. The detail
  header carries the lifecycle buttons through `EntityForm`'s `headerActions` slot —
  the registry describes fields, not lifecycles, so the escape hatch is a slot rather
  than a config key nothing else would use.
- **At most two years stand Open at once**, and only the **oldest** is closable. The
  overlap at a year-end is real — December's invoices arrive while January is already
  being worked in — but a third open year is not that case, and every month it stays
  open is a month that cannot be carried forward. Closing the newer of two would leave
  an Open year with no successor to inherit into, since the snapshot a close writes is
  what the next year opens from. `MAX_OPEN_FISCAL_YEARS` and `openLimitRefusal` in
  `fiscal-workflow.ts` are the rule; the refusal **names the year to close**, because
  "too many" is not actionable.
- **`Closed` is reachable now, and it is a rollup rather than a status anybody sets.**
  Closing happens **per Company** — the induk can shut 2026 while the anak is still
  finishing it — and that state lives in `acc_fiscal_closing`, one row per
  `(fiscal_year, company)`. `AccFiscalYear.status` reads `Closed` only once **every**
  Company has closed it, written in the same transaction as the last Company's close
  (`recordFiscalClosing` in `fiscal.ts`). An explicit record rather than a status
  inferred from the existence of an Opening Balance document: inferring a fact from a
  row in another table works until somebody writes that row for a second reason, and
  then nothing fails.
- **The closing step leaves this screen.** `FISCAL_YEAR_CLOSE` is in the catalogue and
  the `close` transition is in the table, but it carries a **`runAt`** —
  `/accounting/closing` — so the Fiscal Year header offers a *link* rather than a
  confirm button, and `availableActions` deliberately excludes it. Closing needs a
  Company, a seven-point validation checklist and a preview of the journal it is about
  to post; none of that fits behind a yes/no on a record belonging to neither Company.
  The permission landed **in the change that built the process**, never before, exactly
  as §13 required.
- **Irreversible.** Nothing reopens a closed year: the close posts a journal, a posted
  journal is never reversed (§12), and `checkPostingPeriod` refuses every later posting
  into it by that Company on all four posting paths.
- **Do not change unless:** explicitly instructed. **Never make `status` an editable
  field again, never add a transition back to Draft, never add a path that reopens a
  closed year, do not let a third year stand Open, and do not offer `close` as a header
  confirm button** — it is run where its checklist and its preview are.
- **Status:** Frozen, current. Supersedes the earlier statement that closing was not
  built and that no transition might produce `Closed`.

### System Default is a catalogue in code, and a default decides nothing (FROZEN)
- **Decision:** `/settings/system-default` holds every value the application prefills
  with. The keys are declared in `src/lib/siba/system-defaults.ts`; `sys_setting` is a
  key/value table holding only what each key is currently set to, read and written
  through `src/lib/siba/system-settings.ts`. The first entry is `default_currency`.
- **Reason:** A setting is a branch in the code, exactly as a permission is, so one
  created at runtime would be a row nothing reads. Keying the table rather than adding
  a column per setting is what lets the next default arrive as a catalogue entry and a
  form field, with no migration.
- **Impact:** A default **fills a control in and nothing more**. It applies on create
  only, never on edit, never overrides an entered value, and is resolved against its
  master first — a Currency that has since been deactivated prefills nothing, because
  the picker would not offer it either. The Server Action validates the saved record
  exactly as it would a value the user picked. A registry field opts in with
  `systemDefault: "default_currency"`; Budget takes it as a prop.
- **Two groups do more than prefill, and they are the exception.** The
  **intercompany bridge** is four settings — for each Company, the account for what
  it is owed and the account for what it owes — and they are where a confirmed
  Funding Request journals. The **FX difference accounts** are two more, one per
  Company, and they are where a settlement's gain or loss lands. Neither group fills
  a control in; both decide where a posting goes. They are still settings rather
  than a table because there are exactly two permanent Companies and a
  company-relationship table is what §14 forbids. Because they decide rather than
  suggest, they are checked **when they are stored** as well as when they are read
  (`checkSystemDefaultValue`: the right Company, postable, active). A funded
  confirmation is **refused by name** until all four bridge accounts are set; a
  posting that produces an FX difference is refused by name until that Company's
  difference account is — and only then, so ordinary rupiah work is never blocked by
  a setting it does not use. Neither falls back to anything. The dashboard's "Perlu
  Perhatian" card lists what is missing.
- **Do not change unless:** explicitly instructed. **Never let an ordinary default
  decide what is valid, never apply one to an existing record, and do not add a UI for
  creating setting keys** — the catalogue is code. Do not give the bridge or FX
  settings a silent fallback.
- **Status:** Frozen, current.

### Every date reads `dd/mm/yyyy`, and the app draws its own controls (FROZEN)
- **Decision:** Dates are displayed `dd/mm/yyyy` everywhere — lists, details, forms,
  filters, reports — through `formatDate` in `src/lib/format.ts`, the only function
  that decides the format. Date entry goes through `components/ui/date-input.tsx`, and
  every dropdown through `components/ui/select.tsx`. **No native `<select>` and no
  native `<input type="date">` anywhere in the application.**
- **Reason:** Both native controls are drawn by the operating system, in the *user's*
  locale and the OS's own typography: the same form showed `mm/dd/yyyy` to one person
  and `dd/mm/yyyy` to another, and the company picker dropped a blue Windows list over
  a finished interface. Neither is stylable, and a date format that varies by browser
  is a data-entry hazard, not a cosmetic one.
- **Impact:** `Select` reuses the combobox popup (`.cbpop` / `.cbo`) so every dropdown
  in the app behaves alike; `variant` maps to the trigger class the surrounding layout
  already expects, so swapping one in changes no spacing. `DateInput` keeps ISO
  (`yyyy-mm-dd`) as its value and masks typing onto `dd/mm/yyyy` rails; a date that
  does not exist (31/02) is refused rather than rolled forward.
- **Do not change unless:** explicitly instructed. **Never reintroduce a native
  `<select>`, date input or number input, and never format a date outside
  `formatDate`.** `tests/design-system.test.ts` fails on any of them.
- **Status:** Frozen, current.

### An amount is typed into one control, everywhere (FROZEN)
- **Decision:** Every amount a user types goes through
  `components/ui/money-input.tsx` — mono, right-aligned, grouped in thousands as
  it is typed, with its currency label inside the box on the left, and `size="sm"`
  where it sits in a table. **No native `<input type="number">` anywhere**, for the
  same reason there is no native `<select>` and no native date input: the control is
  drawn by the operating system. The registry expresses this as `type: "money"` plus
  `currencyFrom`, naming the ref field that says which currency the figure is in.
- **Reason:** The same amount read three different ways on three screens. Cash &
  Bank's Saldo Awal was a native number input: OS spinner, left-aligned, `231411`.
  Budget's Nominal was right-aligned and mono but ungrouped: `3243222`. Only a Cash
  Bank Transaction line grouped it: `3.243.222`. Grouping is not decoration in an
  accounting application — it is how a reader checks a figure's order of magnitude at
  a glance, and three conventions for one thing means a user who learns to read one
  screen has to re-learn the next.
- **Impact:** The value crossing the component's boundary is an unformatted numeric
  string, which is what a Server Action parses; the separators exist only in what is
  displayed. An amount takes digits only — `decimals` defaults to `0` — so a
  separator typed by hand cannot desync the two. An amount field starts **empty on
  its `0` placeholder**, never on a literal `0` the user has to delete first. `over`
  is the one state an amount carries.
- **The same control also carries the kurs**, at `decimals={6}`. See "One numeric
  control, and one meaning per separator key" below for what that adds and why a
  rate does not get a field of its own.
- **Do not change unless:** explicitly instructed. **Never render a native number
  input, never format an amount outside `formatNumber` / `formatMoney`, and do not
  give one screen its own amount styling.**
- **Status:** Frozen, current.

### A rate is an input or an output, never both (FROZEN)

**This supersedes "Amounts are never converted between currencies", which is kept
below in outline because the half of it that still holds is easy to lose.**

- **Decision:** `src/lib/siba/fx.ts` is the whole foreign-exchange model, and it is
  pure arithmetic over numbers — no database, no `server-only`, no dependency on any
  other module, no knowledge of what a Budget or a Partner is. Its premise is that
  **a foreign amount and its base value are two independent facts**. Every balance
  is a pair, and a rate is one of exactly two things:
    * an **input** — `originate(foreign, rate)`, which creates base value where none
      existed: a receipt, an opening balance, a conversion the bank actually made;
    * an **output** — `carryingRate(balance)`, which is `base ÷ foreign` over a
      balance that already exists.

  Confusing the two is the single failure mode the module exists to prevent. A
  derived rate is **display only**: never stored, never defaulted into a document,
  never reconciled against a market rate, and never rounded and then multiplied by.
  `relieve` computes in one expression precisely so that a carrying rate never
  becomes an intermediate value.
- **Reason:** The base value of a balance is a record of how it was built, not
  something re-derivable by re-quoting today's rate. A balance assembled from a
  16.000 receipt and a 15.500 receipt carries at 15.750, which appeared in no deal
  anyone made — so a system that re-derived base from a "current rate" would destroy
  the only figure that answers what the currency movement actually cost, and would
  do it silently. The earlier decision (no rate at all) was correct while the system
  held no rate source; it was never a statement that conversion is wrong in
  principle, and the two concept documents in `Initialization/` supersede it.
- **Impact:** Two properties are easy to lose and both are load-bearing. **A full
  release hands back the remaining base exactly** rather than recomputing
  `foreign × rate` — partial releases each round, and absorbing the residue into the
  last movement is what makes "zero foreign against a non-zero base" unreachable.
  **A partial release is one expression and one rounding**, so drift stays in the
  amount being released instead of compounding into what remains. Over-release
  throws rather than being absorbed into an FX difference where nobody would look
  for it.
- **What survives from the superseded decision, unchanged:** money in different
  currencies is **still never added together at face value**, `MoneyTotal[]` and
  `formatTotals` still render side by side (`Rp 45.000.000 · USD 3.500,00`), and
  there is **still no exchange-rate master table and no rate lookup anywhere**. The
  system holds rates only as facts recorded on movements that happened. Budget KPIs,
  the Budget Month rollup, the submission report recap and the cash balance card all
  still report per currency.
- **Do not change unless:** explicitly instructed. **Never store a derived carrying
  rate, never default one into a document, never create an exchange-rate master
  table or a rate-fetching service, and never convert a figure by a rate that was
  not recorded on the movement itself.**
- **Status:** Frozen, current. Supersedes "Amounts are never converted between
  currencies" (removed).

### Crossing goes through the base currency only (FROZEN)
- **Decision:** A document may be settled from a resource in its own currency, or
  from a base-currency resource, and from nothing else. A base-currency document is
  settled from a base-currency resource alone. `maySettle`, `settlementRefusal` and
  `rateSource` in `src/lib/siba/currency.ts` are the one statement of it; the
  picker narrows by it and `checkHeader` refuses by it.
- **Reason:** It is **narrower than the source specification**, which also admits a
  foreign document paid from a *third* currency's account — the case that needs a
  cross rate applied on top of the account's own. Removing it means the only rate
  this system ever holds converts a foreign currency to base: there is no
  EUR-to-USD rate to enter, store or source, and `fx.ts` needs one multiplication
  where the specification needs two. The narrowing was taken deliberately, not
  overlooked.
- **Impact:** `currency.ts` is client-safe on purpose — no `server-only`, no
  database import, no dependency on another module — so the form and the Server
  Action cannot disagree about what is allowed. A refusal names **both**
  currencies, because "Cash & Bank tidak sesuai" tells nobody which half to change.
- **Do not change unless:** a genuine third-currency requirement arrives, and then
  it is a cross-rate model, not a loosened check. **Do not widen `maySettle`
  without building the second rate the wider rule needs.**
- **Status:** Frozen, current.

### A layer is chosen, and one payment draws on one (FROZEN)
- **Decision:** A foreign Cash & Bank resource holds `cash_bank_layer` rows, one
  per acquisition event, never merged. Money leaving draws on **exactly one** layer
  that the user picks; money arriving opens a new one. A base-currency resource is
  unlayered. `src/lib/siba/cash-bank-layers.ts` is the only writer, and the table is
  owned by the Cash Bank Book.
- **Reason:** Currency bought at 15.000 and currency bought at 16.000 are not
  interchangeable — spending one rather than the other produces a different
  recognised gain or loss. Under averaging that figure is deterministic; here the
  user's choice sets it, which the source document calls out as the feature working
  as intended and an auditable control point. Never merging is what makes "the layer
  from 28 January" name something, where "the 15.000" would name three things.
- **The single-layer limit is a deliberate narrowing.** The source specification
  allows `Σ selected amounts = account_amount` across several layers. SIBA takes one
  per document: one transaction, one bank, one kurs. The consequence is real and
  known — a resource with five layers of a million each holds five million and
  cannot pay one and a half in a single document — so `checkLines` refuses it at
  draft time with a message that says to split the document, rather than letting it
  surface at Post.
- **`cash_bank_layer` is mutable, unlike every book beside it**, and deliberately:
  the remaining balance is what a payment is checked against and what the picker
  offers. The immutable record of what was consumed lives on the documents that
  consumed it. What replaces the books' rebuild is `reconcileLayers` — an account's
  balance *is* the sum of its open layers, on both measures, and the layer report
  says so when it is not.
- **The layer is picked in a panel, and only the kurs survives the choice.**
  `KursSelect` opens a `Dialog` whose columns are date, kurs, sisa and sumber; the
  field afterwards shows the kurs alone. As a dropdown each option had to carry all
  four attributes on one line, so every option ran past the width of the field and
  truncated — leaving the reader comparing the halves of four strings that all began
  the same way, which is precisely the comparison the feature exists to make. The
  panel reuses the Budget picker's own table (`table.grid.pkt2`), so a row that can
  be chosen looks the same wherever one is offered.
- **Ordering is chronological and display-only.** Oldest first, because that is how
  a treasury reads a stack, with a sequence number so two acquisitions on one day
  are still ordered. **Nothing is ever consumed without being told to** — there is
  deliberately no "use the oldest" shortcut that commits on its own, even though the
  source document's policy table switches one on.
- **Do not change unless:** explicitly instructed. **Never merge layers, never
  auto-select one, never let a layer's rate be edited, and do not add a second
  consolidation path** — period-end revaluation is the only sanctioned one and it is
  not built (§13).
- **Status:** Frozen, current.

### One numeric control, and one meaning per separator key (FROZEN)
- **Decision:** `src/components/ui/money-input.tsx` is the only numeric field in the
  application — every amount **and every kurs**. `RateInput` is a thin wrapper that
  passes `decimals={6}` and a pair label (`USD → IDR`, `labelWidth="pair"`); it holds
  no parsing of its own. Thousands are grouped **as the figure is typed**, in both.
- **`.` groups thousands and `,` separates decimals** — on screen and on the
  keyboard. A `.` the user types is the separator the field is already inserting, so
  it is dropped; a decimal is reached by typing `,` and nothing else. The user set
  this rule, and it is what makes grouping-as-you-type possible on a field that also
  takes decimals: exactly one meaning per key means re-reading what is on screen is
  always a no-op.
- **Reason:** The kurs field could not accept `16000`. It grouped to `1.600` at the
  fourth digit and then read its own `.` back as a decimal point when the fifth
  arrived, storing `1.6` — no error, nothing a type check or a server rule could
  catch, and the value it handed over was a perfectly valid rate. The first fix gave
  the rate field a focus buffer so it stopped grouping while being typed into; the
  user rejected it, correctly — Saldo Awal and Kurs Perolehan sit side by side on the
  Cash & Bank form, and a reader either learns one behaviour or notices there are
  two. A rate is not an amount in what it *means* (a ratio, never re-derived — see "A
  rate is an input or an output"), and that says nothing about how it is typed.
- **Impact:** `decimals` defaults to `0`, so every existing amount field is
  byte-identical to before. `parseAmount` and `displayAmount` are pure and exported,
  and `tests/money-input.test.ts` drives them one keystroke at a time — including the
  round trip `parseAmount(displayAmount(v)) === v`, which is the invariant the defect
  broke and the thing grouping-as-typed rests on. A kurs is *rendered* by `formatRate`
  in `lib/format.ts` — minimum two decimals, maximum six — and
  `tests/design-system.test.ts` fails on any file that passes a decimal count to
  `formatNumber` for a rate.
- **The cost, accepted:** a numpad `.` does not produce a decimal point. Under the
  rule above it is a thousands separator, and the operators type `,`.
- **Do not change unless:** explicitly instructed. **Never give a rate a second
  numeric control**, never let `.` mean a decimal point on input, never stop grouping
  while a field is being typed into, and never restore a per-screen decimal count for
  a rate.
- **Status:** Frozen, current. Supersedes "The kurs field shows what you typed, while
  you are typing it", which lasted one review cycle.

### Master data is never deleted
- **Decision:** No hard delete for master data anywhere. Deactivate via status.
- **Reason:** History, traceability and auditability; existing references must stay valid.
- **Impact:** No delete buttons, no delete actions, no cascading deletes on master tables.
  Pairs with the rule that inactive records stay visible when already selected.
- **Do not change unless:** explicitly instructed.
- **Status:** Frozen, current — and already how the code behaves.

### Budget Month is derived from fiscal period
- **Decision:** No Budget Month table. Budgets group by `acc_fiscal_period`. The menu or
  container may exist in the UI, but it reads fiscal periods.
- **Reason:** It has no independent lifecycle or business purpose — it is purely a
  grouping concept.
- **Impact:** Implemented as
  a date-range query in `budgetMonths()` / `listBudgets()`: a budget belongs to the
  period its `budget_date` falls inside, so it changes month by changing its date and
  nothing else needs updating. `tests/budget.test.ts` asserts there is no
  `bud_budget_month` table and no month column on `bud_budget`.
- **Do not change unless:** Budget Month gains real independent state.
- **Status:** Frozen, current.

### Budget is bespoke, not a registry entity
- **Decision:** Budget has its own routes under `/budget/budget`, its own data module
  (`lib/siba/budget.ts`), its own actions (`app/actions/budget.ts`) and its own
  components. It is **not** in `entities.ts`.
- **Reason:** The registry expresses fields, columns and an optional active/inactive
  toggle. Budget is a document: a six-state lifecycle with permissioned transitions,
  two fields only an approver may write, immutability after approval, and a list
  grouped by a derived month. That is precisely the escape hatch the registry decision
  anticipated — the same one User and Role took.
- **Impact:** The registry stays untouched and keeps driving Master and Accounting.
  `entity-access.ts` has no `bud_budget` row and must not gain one; Budget
  authorization runs through `budgetAbilities()` against the same catalogue.
- **Status:** Frozen, current.

### The Budget lifecycle is one transition table
- **Decision:** `src/lib/siba/budget-workflow.ts` declares every transition once —
  which statuses it may start from, which it produces, and the single permission it
  needs. The row menu, the detail header and the Server Action all read it. The table
  is client-safe and holds no database import.
- **Reason:** A lifecycle expressed twice is a lifecycle with two answers, and the safe
  one is whichever the code happened to check. One table means a hidden menu item and a
  refused action can never disagree.
- **Impact:** `Draft → Submit → Submitted → Approve (Open) / Reject (Rejected → Submit)`,
  plus `Cancel` from Draft, Rejected or Submitted. Editing is confined to Draft and
  Rejected — concept doc §6.4 makes an approved budget immutable, and a submitted one
  must not change under its approver. Adding a transition means adding a row here and a
  permission to the catalogue, never one without the other.
- **Do not change unless:** explicitly instructed.
- **Status:** Frozen, current.

### A Budget is closed by realization, never by hand (FROZEN)
- **Decision:** Budget's own lifecycle still ships create → approve: there is no "Tutup
  budget" action and no delete, even though the mockup's row menu offers both. `Closed`
  is now produced, but only as a **consequence of posting** — `applyPosting` sets it on
  a Budget whose `realized_amount` reaches its planned amount.
- **Reason:** Confirmed with the user when Budget was built: closing belongs to
  realization, which had to wait for Finance. It exists now, and concept doc §6.5 says
  a Budget that reaches its planned amount may close. That is a system consequence of
  money moving, carried by `CASH_BANK_TRANSACTION_POST` — not a decision somebody takes
  from a menu. The catalogue therefore still has **no** `BUDGET_CLOSE` and no
  `BUDGET_DELETE`, and a capability is a catalogue entry first (§12, "The permission
  catalogue lives in code").
- **Impact:** `BUDGET_TRANSITIONS` still holds exactly submit / approve / reject /
  cancel, and a test asserts it. Over-realization is permitted (§6.5) and closes the
  Budget too — the money left, and a plan cannot be more than finished.
- **Do not change unless:** explicitly instructed. **Do not add a `BUDGET_CLOSE`
  permission or a close action to the transition table**; if a Budget must be closable
  without realization, that is a new capability and needs a catalogue entry first.
- **Status:** Frozen, current.

### A Report View is a screen type, with one convention (FROZEN)
- **Decision:** A menu entry whose purpose is to *show* a report is a **Report View**,
  and every one of them is built the same way. The catalogue lives in
  `src/lib/siba/reports.ts`; one route per module — `finance/report/[report]`,
  `accounting/report/[report]` — resolves the entry, checks its permission and parses
  its parameters; `components/report/report-view.tsx` carries the chrome; only the body
  differs per report. Twelve rules define the type:

  1. **Parameters live in the URL.** `?cashBank=12&from=…&to=…`. A run is therefore
     linkable, bookmarkable and back-button-able, and the page stays a Server Component
     that queries directly (§3) instead of fetching from the client.
  2. **The filter lives in the sticky page header, and there is no restatement.**
     `.rfil` sits inside `.pad > .ph`, so the subject and the period travel with the
     page and are on screen wherever the reader has scrolled to. That is what a
     `.critbar` underneath used to buy, at the cost of a slab of vertical space on every
     run — so the filter *is* the statement of what the figures cover, the run timestamp
     is one muted line (`.rstamp`) at the foot, and **no Report View carries a
     `.critbar`**. A Report View also carries no `.ph-sub`: the description belongs to
     the menu entry that led there, and how to read the figures belongs in the footnote.
  3. **The subject is explicit** — a Cash & Bank resource, one or more accounts,
     or one or more Partners — and **every report runs for one Company**, named by
     a `CompanyFilter` first in the filter bar and carried in `?company=`. A cash
     resource, a Partner and an account all belong to one Company, so a report
     spanning both reads as duplicated rows; and the scope is what stops a reader
     without anak access reading the anak's book, which every other screen already
     enforces. A reader who may see one Company never sees the control, because a
     picker with one option is not a choice. **The scoped readers take the
     Companies as an argument** — `cashBankLedgerReport`, `cashBankBalanceReport`,
     `subledgerReport` — and a subject outside the scope reads as *not found*,
     which is the same answer one that does not exist gives.
  4. **It reconciles on the page** — see §10 rule 40, and the no-type-filter rule that
     follows from it.
  5. **Empty is not zero.** A period with no movement still reports its opening and
     closing. An empty state means "no subject chosen yet", which is a different screen.
  6. **Read-only, always.**
  7. **Drill-through downward.** A summary row links to the detail report for the same
     parameters, so a figure is one click from the rows that produced it.
  8. **A report states one measure, and says which.** Reports over the operational
     books group per currency at face value and never add two together — that is
     what a Cash & Bank account or a Partner position actually holds. The Journal,
     the General Ledger and the Trial Balance report **base currency on one scale**,
     because a journal balances in base alone and grouping by transaction currency
     would split one balanced entry across two tables leaving neither balancing. A
     report never converts anything itself: it prints the base measure that was
     recorded when the movement happened (§12, a rate is an input or an output).
  9. **A block states its headline figures as a `.rsum` strip**, label above value,
     right-aligned and monospaced, closing balance last and larger. Written on one line
     (`Awal Rp 0 · D Rp 0 · K Rp 200.000 · Akhir Rp -200.000`) the figures are all
     present and none of them can be read at a glance, which is the only thing a summary
     is for. `ReportSummary` is the one implementation.
  10. **A report speaks about balance only when it is broken.** "Seimbang" on a header,
      again in a total row, and again in the criteria says nothing three times — equal
      totals are visible in the columns themselves. A difference gets a `.rwarn` chip and
      a sentence, because that is the case a reader must act on.
  11. **The result does not scroll sideways.** Money columns are fixed and one text
      column flexes; anything that would be a narrow column of its own — a partner, a
      normal balance, a company, a row number — is folded into the cell it belongs to
      (`.rsub`, `.nb`) or dropped where the filter already states it. A report that has
      to be scrolled horizontally cannot be read across a row, which is the only way a
      ledger is read.
  12. **Export belongs in `.ph-act`.** The slot exists and is empty; print and XLSX are
      deferred, and adding them later changes no layout.
  13. **The footnote is one sentence.** It says the single thing a reader needs in
      order to read the figures correctly, and nothing else. Each of the six had
      grown to four or five sentences restating rules the screen already obeys —
      append-only, per-currency totals, what a saldo awal is — so the one clause
      that actually changed how a column should be read was buried in the middle
      of a paragraph nobody finishes. The same applies to a Journal's footnote.

- **Reason:** Reports are the bulk of what the subject ledgers will add, and a report
  invented per screen produces a different answer to "what period is this?" on every
  page. Rules 2, 9, 10 and 11 arrived together, from reading the four built reports side
  by side: the criteria strip restated what the bar above it already said, the block
  summaries were unreadable run-on lines, the Trial Balance announced its own balance
  three times, and every table was wide enough to need a horizontal scroll. All four
  cost the figures room on the screen while adding nothing a reader did not have.
- **Impact:** Adding a report is a `reports.ts` entry, a permission, a nav entry and a
  body component — no new route file. Permissions are named `REPORT_<SUBJECT>_VIEW`,
  prefix-first like `MENU_<AREA>_ACCESS` (§12). Report slugs live under a `report/`
  namespace, which is why `resolvePath` matches the whole path tail against entity
  slugs, longest match first. The report vocabulary is `.ph`/`.rfil`, `.rhead`,
  `.cblock`/`.cbh` + `.rsum`/`.rwarn`, `table.grid`, `.totrow`, `.rsub`, `.nb`,
  `.foot-note`, `.rstamp`, `.empty` — declared once in the "report view" section of
  `globals.css`. A new report composes those; it does not author its own.
- **Do not change unless:** explicitly instructed. **Never let a Report View write**,
  never add a filter that breaks a money report's own arithmetic, **never put the filter
  back in a `.toolbar` inside the card or reinstate the `.critbar`**, never label the
  balanced case, and do not build a generic report engine — the catalogue, the chrome
  and the vocabulary are shared, the bodies are not.
- **Status:** Frozen, current.

### A record's history lives on its own form (FROZEN)
- **Decision:** Every form with a saved record ends with `RecordHistoryCard` —
  the registry entities, Budget, Cash Bank Transaction, Funding Request, User
  and Role, on both the view and the edit page. One component
  (`components/ui/record-history.tsx`), one CSS vocabulary (`.alog` / `.ae`,
  compacted in place rather than duplicated), newest first, capped at ten with
  the total stated. It is never shown on a `new` page, because an unsaved
  record has no history.
- **The column that makes it readable.** `audit_log` gained a nullable
  `event`. Every lifecycle transition was an UPDATE, so a Budget's panel would
  have read "Diubah · Diubah · Diubah" and answered none of the questions a
  history is opened for. `event` stores the **transition key the workflow table
  already declares** — `submit`, `approve`, `post`, `confirm`, `withdraw`,
  `open`, `close`, `activate` / `deactivate` — and the Indonesian label is read
  back from that table rather than stored, so a new lifecycle step is a row in
  `budget-workflow.ts` or its siblings and **not a migration**.
- **Why not extend `AuditAction`.** A single global enum turns every module's
  private vocabulary into a shared migration and puts label text in the database
  where the transition table owns it. Nullable text also keeps every row
  written before the column honest: they report the coarse verb, because that is
  genuinely all they know.
- **Impact:** `withdrawFundingRequest` wrote **no audit row at all** and now
  writes one — a request taken back used to leave no trace of who took it back.
  `markTransactionPending` / `markTransactionCancelled` / `writeFundedPosting`
  write the document's row inside the caller's transaction, so a rolled-back
  funding cannot leave a history entry for something that never happened.
  `tests/audit.test.ts` fails if a workflow table gains a transition the
  catalogue cannot name.
- **`recentActivity()` is still uncalled and still untouched.** This is the
  per-record reader (`recordHistory`), not the dashboard feed — the feed stays
  off the dashboard (§12, MECE) pending the user's own placement for it.
- **Do not change unless:** explicitly instructed. **Never add a lifecycle
  transition without an `event` on its audit write and a label beside its
  workflow table**, never store the label in the database, never make the panel
  writable, and do not claim in it what changed — the log holds no snapshot.
- **Status:** Frozen, current.

### The dashboard is MECE, and a Draft is not on it (FROZEN)
- **Decision:** The dashboard answers four questions and no more — what is
  waiting and on whom, where the money is, what the company owes and is owed,
  and what is broken. Every figure appears **exactly once**, and the three
  funnel stages **partition** committed money: `Menunggu Persetujuan` (Budget
  `Submitted`), `Siap Direalisasi` (approved outstanding **minus** what a
  `Pending` document already holds), and `Menunggu Konfirmasi Induk` (those
  pending documents). **No Draft record appears anywhere** — not a Draft
  Budget, not a Draft document.
- **Reason:** The old page was six master-row counts, the same counts again
  broken down per Company, and an audit feed — a statement of the master data
  rather than of the business, and useless to somebody opening the app to find
  out what to do. The MECE requirement is the user's, and it has teeth:
  `realized_amount` is written only at Post (§10 rule 35), so an approved
  Budget still reports its whole outstanding while a pending document is
  holding part of it. Printing both unadjusted states the same money twice in
  two costumes. Drafts are excluded on the user's reasoning that a draft "may
  or may not happen yet" and so is not a business metric — which is also what
  keeps a draft document's claim correctly inside the approved stage rather
  than needing a stage of its own.
- **Impact:** `src/lib/siba/dashboard.ts` composes the page by asking each
  module about its own records — `submittedCommitments` / `approvedCommitments`
  on Budget, `pendingCommitments` on Finance (which returns the per-Budget
  claim map the subtraction needs), `openFundingRequests` on Funding,
  `cashBookSummary`, `subledgerPositions`, `accountPositions`,
  `unbalancedJournals`. It names no other module's table, which is what removed
  the dashboard from `KNOWN_CROSSINGS`. It is a **leaf**: it depends on every
  module and nothing depends on it. `tests/dashboard.test.ts` holds the
  partition outright — stage two plus stage three equals the approved pool,
  exactly — because that is the property a summary lives or dies by and it
  cannot be seen by looking at the screen.
- **The projection uses the approved pool only.** Cash is stated per currency
  as `Saldo · Komitmen Keluar · Ekspektasi Masuk · Proyeksi`. Stage one is
  deliberately not in it: a Budget nobody has approved is not yet a claim on
  anyone's cash. The commitment figure is the funnel's total and is **not**
  re-broken by stage there, because the tiles above already did that.
- **The audit feed is gone from the dashboard, not from the system.**
  `audit_log`, `lib/siba/audit.ts`, `recentActivity()` and the `.alog` CSS are
  all untouched; `recentActivity()` simply has no caller for now, pending the
  user's own placement for it.
- **Permission is deliberately unfinished.** The page checks
  `MENU_DASHBOARD_ACCESS` and shows every section to whoever holds it, by the
  user's instruction to settle the content before the permission model. Reads
  are still Company-scoped through `accessibleCompanyIds`, and each section is
  composed separately so gating later is a filter in `dashboardData` rather
  than a rewrite.
- **Do not change unless:** explicitly instructed. **Never put a Draft record
  on the dashboard**, never state one figure in two cards, do not restore the
  master-data counts or the per-Company spread of them, and do not add a stage
  to the funnel without showing that it still partitions.
- **Status:** Frozen, current.

### The Cash Bank Book is a report, not part of the master record
- **Decision:** `Buku Kas & Bank` and `Saldo Kas & Bank` are their own menu entries
  under Finance › Laporan. The Cash & Bank master detail keeps a summary card — balance,
  entry count, last entry date — and a link into the ledger report pre-filtered to that
  resource. The embedded book component is gone.
- **Reason:** What was under the master was a range-less, newest-first, 50-row slice of
  a book, which is neither a useful book nor a property of a master record. Keeping both
  would mean two implementations of the same ledger drifting apart, and would go on
  implying that a balance belongs to `m_cash_bank` when §12 says it does not.
- **Impact:** Entering an opening balance when registering a resource is unchanged: it
  writes an `Opening` entry in the book (§10 rule 29), which is exactly why it was never
  a column. `cashBankLedger()` and `components/master/cash-bank-book.tsx` were removed;
  `cashBankBookSummary()` replaces them for the master card.
- **Do not change unless:** explicitly instructed. **Do not re-embed a second copy of
  the book under the master record.**
- **Status:** Frozen, current.
### Post is the actual boundary, and it is one transaction (FROZEN)
- **Decision:** A Cash Bank Transaction in Draft moves **nothing** — no ledger entry,
  no balance, no subject-book entry, no journal, no layer movement, no
  `realized_amount`, not even a document date. `applyPosting` in
  `src/lib/siba/finance.ts` is the single place money moves, and inside **one**
  `prisma.$transaction` it writes the Cash Bank Book entry and its materialised
  balance (`recordCashBankEntry`), the subject book where the Purpose keeps one
  (`recordSubledgerEntry`), the balanced Journal (`postJournal`), the rate layer it
  draws on or the one it opens (`drawFromLayer` / `openLayer`), every Budget's
  realization, and the document's own dates and status.
- **Reason:** Concept doc §2.3 makes Post the actual boundary: before it nothing has
  happened, after it nothing can be taken back. Splitting those writes would let the
  money move without the plan recording it, or a plan record a realization that never
  reached a book — and the Cash Bank Book's whole value is that its balance can always
  be re-derived from its entries.
- **Impact:** Budgets are re-read *at Post*, not trusted from when the document was
  drafted: one that another document has since closed refuses the post and nothing is
  written. The rule lives in the data module rather than inside the Server Action so
  `tests/finance.test.ts` can exercise the real path — an action resolves a caller from
  a session cookie, which a test process does not have.
- **The three writers sit side by side and none reads another.** Each book is
  written **straight from the document**, never derived from a journal line:
  operational books are independent historical stores and only the General Ledger
  derives from journals (§2.5, §11.7). That is the whole reason `applyPosting` calls
  `recordCashBankEntry`, `recordSubledgerEntry` and `postJournal` in parallel rather
  than chaining them.
- **The layer is re-read at Post too.** `drawFromLayer` **throws** rather than
  returning a refusal, because it runs inside the posting transaction: a layer that
  another document has spent since this one was drafted takes the whole posting down
  instead of being overdrawn. `postJournal` throws on an unbalanced journal for the
  same reason.
- **Do not change unless:** explicitly instructed. **Never split Post into separate
  writes, never let a Draft touch a balance or a layer, and never derive the Cash Bank
  Book from a journal line.**
- **Status:** Frozen, current.

### The Cash Bank Transaction lifecycle is one transition table
- **Decision:** `src/lib/siba/transaction-workflow.ts` declares every transition once —
  `Draft → Post → Posted` and `Draft → Cancel → Cancelled`, each with the single
  permission it needs. The row menu, the detail header and the Server Action all read
  it. The table is client-safe and holds no database import. This is the shape Budget
  established, for the same reason: a lifecycle expressed twice is a lifecycle with two
  answers.
- **Reason:** Posted and Cancelled are both final, and Posted is final in the strong
  sense — concept doc §15 makes every posted record append-only, so a correction is a
  new business transaction rather than an edit. Editing is confined to Draft and
  enforced in `updateTransaction`, not merely by hiding the button.
- **Impact:** Adding a transition means adding a row here **and** a permission to the
  catalogue, never one without the other. There is no reversal and no re-open: nothing
  in the table produces `Draft`.
- **Delete is deliberately absent.** The mockup's row menu offers one; the catalogue
  carries no `CASH_BANK_TRANSACTION_DELETE`, and a capability is a catalogue entry
  first. A document that should not have existed is **cancelled**, which leaves its
  number and its reason behind.
- **Do not change unless:** explicitly instructed. **Do not add a delete, a reversal,
  or any path back to Draft.**
- **Status:** Frozen, current.

### The anak has no cash, and that is the whole of the funded route (FROZEN)
- **Decision:** A Cash Bank Transaction's Company decides how it reaches money.
  The **induk** holds every Cash & Bank resource, so its documents name one and post
  directly. The **anak** holds none — by design, not by configuration (concept doc
  §25, §32) — so its documents name a **Currency** instead, are refused outright if
  they name a resource at all, and leave Draft by **Ajukan Dana**: the document
  freezes at `Pending` and a `fin_funding_request` opens. The induk answers it from
  `Finance › Funding Request`, and that confirmation posts the document.
  `fundingRoute()` in `finance.ts` is the one place the question is asked, keyed on
  `is_parent` and never on a setting.
- **Reason:** This is the business: whatever the anak spends or receives moves through
  an induk resource, and the two Companies then hold mirrored positions against each
  other until they settle (concept doc §34, §36, §37). Modelling it as "the anak has
  a resource somewhere" would make the intercompany position invisible and let the
  anak spend money the model says it cannot.
- **Impact:** This **supersedes** the earlier decision that pinned the document to the
  induk, which existed only until this flow was built. The Company field is a real
  picker on a new document (narrowed to the Companies the reader's permissions open,
  and checked again by the Server Action), locked once the document exists.
  `Pending` joins the `TransactionStatus` enum and is exactly as inert as `Draft`.
- **No rejection, ever.** The induk always complies (§29), so `Konfirmasi Funding`
  asks one question — which resource — and every refusal is mechanical: an unfinished
  bridge, a resource in the wrong currency or belonging to the wrong Company, a
  request already answered, a Budget closed since. There is no `FUNDING_REQUEST_REJECT`
  and there is no partial funding: request amount = document amount, always.
- **Withdrawal is the requester's, not the provider's.** A Pending document may be
  cancelled by the Company that raised it, which closes its request with it. That is
  why `transitionTransaction` refuses `cancel` on a Pending document and points at
  the Funding action: the request's own state belongs to the module that owns it, and
  a document cancelled behind its back would leave an open request against nothing.
- **Do not change unless:** explicitly instructed. **Do not give the anak a Cash &
  Bank resource**, do not add a rejection or a partial funding, and do not let Finance
  import Funding to close a request.
- **Status:** Frozen, current.

### A transfer is its own module, and it settles nothing (FROZEN)
- **Decision:** Cash Bank Transfer moves the Company's own money between its own
  Cash & Bank resources. It has its own tables (`fin_cash_bank_transfer(_line)`),
  its own permissions, its own routes and its own `TRF-` series. The header names
  the **source** and each line a destination, so one document splits one
  withdrawal across several accounts. Three Purposes, and they say only how the
  two currencies relate: `Transfer`, `Pencairan`, `Pembelian Valas` (§10 rule 85).
- **This supersedes the planned `Transfer` transaction type** recorded in §13,
  which read Transfer as a third value of `transaction_type` on
  `fin_cash_bank_transaction`. **Confirmed with the user before implementation.**
  A Cash Bank Transaction line settles a *Budget*; a transfer line names a *Cash
  & Bank*. The two documents share no classification chain, no Partner, no
  account mapping, no subject book and no realization — forcing them into one
  table would put an "unless it is a transfer" clause on every Finance rule in
  §12, which is the cost that decision was avoiding in the first place.
- **Reason:** the module contract (§3). A transfer owns its tables and reaches
  the books through the functions they export; it imports only the books and the
  shared kernel, and nothing imports it. It adds **no** boundary crossing, so
  `KNOWN_CROSSINGS` stays at two.
- **Impact:** `valueTransferLine` in `transfer-valuation.ts` is pure and
  client-safe, so the form previews *exactly* what the posting computes rather
  than an approximation of it — the same reason `fx.ts` and `currency.ts` are
  client-safe. Post writes the source's one book entry, each destination's entry
  and layer, and one balanced journal, in a single transaction. The layer draw is
  a write, so a refusal that depends on it is raised as a throw and converted
  back — the rollback is what makes drawing inside the transaction safe.
- **No Budget, by decision.** A transfer has no counterparty, so there is nothing
  to plan against and nothing to realize. Confirmed with the user.
- **A transfer records as `Transaction` in the Cash Bank Book**, not as a fourth
  entry type. Confirmed with the user: the book's enum is untouched and a
  transfer is told apart by its note, which carries `TRF-0001 — <Purpose>`.
- **Do not change unless:** explicitly instructed. **Never let a transfer settle
  a Budget or write a subject book**, never merge it back into
  `fin_cash_bank_transaction`, never blend the layers it creates, and never
  divide by a kurs to derive a foreign amount.
- **Status:** Frozen, current. Supersedes §13's `Transfer` transaction type.

### One confirmation, one transaction, two Companies (FROZEN)
- **Decision:** `prepareFundedPosting` resolves and checks everything before anything
  is written; `writeFundedPosting` then writes, inside the transaction `funding.ts`
  opens: the induk's cash entry and its balance, the anak's own subject book where its
  Purpose keeps one, every Budget's realization, **one journal per Company**, and the
  document's Posted status — with the request's closure alongside. Either all of it
  happened or none of it did (concept doc §30).
- **The two Companies' positions against each other are journal, and only journal.**
  Each Company names one account for what it is owed and one for what it owes, and
  the confirmation debits one and credits the other. **No subject-book entry is
  written for the intercompany leg**, which is a deliberate deviation from §34, §37
  and §38: those show the position in the Piutang and Hutang *ledgers*, but a subject
  book's subject is a Partner (§10 rule 56) and the other Company is not one.
  Recording it there would mean registering each Company as a Partner in the other's
  master — a fiction in the master existing only to satisfy a foreign key, and one
  nothing would mark as special or protect from being deactivated. The reconciliation
  §38 asks for is the same reconciliation, read from the General Ledger: the induk's
  receivable account against the anak's payable account. **Confirmed with the user
  before implementation**, after the Partner-based version had been built and
  demonstrated.
- **Each journal points at its own Company's document.** The induk's names the Funding
  Request; the anak's names its own Cash Bank Transaction, because that document is an
  ordinary realization that happened to be funded. Neither is the source of the other,
  which is exactly what §31's Intercompany Event exists to guarantee — **the Funding
  Request is that identifier**, so there is no separate `ICE` table to keep in step.
- **The direction is one mechanism, not two.** Money leaving the induk for the anak's
  expense debits the induk's receivable and credits the anak's payable; money the anak
  receives into an induk resource does the mirror. Only which side of each bridge is
  written flips.
- **Reason:** The posting is Finance's, written for two Companies rather than one, so
  it lives in `finance.ts` beside `applyPosting`; the request's lifecycle is
  Funding's. Splitting it any other way would either put a second posting engine in a
  second module, or make Finance depend on Funding.
- **Do not change unless:** explicitly instructed. **Never split the confirmation into
  separate writes**, never derive one Company's journal from the other's, do not add
  an Intercompany Event table unless something needs an identifier the request cannot
  carry, and **do not register a Company as a Partner** in order to put the
  intercompany position in a subject book.
- **Status:** Frozen, current.

### Finance is bespoke, and its base-amount columns carry real figures
- **Decision:** Cash Bank Transaction has its own routes under
  `/finance/cash-bank-transaction`, its own data module (`lib/siba/finance.ts`), its own
  actions and its own components. It is **not** in `entities.ts`, and `entity-access.ts`
  has no `fin_cash_bank_transaction` row. Authorization runs through
  `transactionAbilities()` against the same catalogue.
- **Reason:** The registry expresses fields, columns and an active/inactive toggle. This
  is a document with a header that filters its own child table, a lifecycle, and a Post
  that writes several tables — precisely the escape hatch the registry decision
  anticipated, and the one User, Role and Budget already took.
- **`exchange_rate`, `transaction_base_amount` and `settlement_base_amount` are real
  figures now, and the two base columns are not the same number.** The transaction
  base is what the cash actually cost — the layer's rate, or the rate the bank
  converted at. The settlement base is what the obligation released, at its own
  carrying rate. They are determined independently and the residual between them is
  the FX difference (§10 rules 73–74). **This supersedes the earlier decision that
  all three were written as the identity** (rate `1`, base = amount), which was
  honest while the system held no rate and is now simply wrong.
- **A document's currency is its own, not its resource's.** It used to be read off
  the Cash & Bank; a foreign document paid from a rupiah account is the case that
  separated the two questions. Budget eligibility still turns on the document's
  currency, never on the kurs.
- **Do not change unless:** explicitly instructed. **Do not collapse the two base
  columns into one** — that is the FX difference disappearing — and do not write
  either of them from a rate that was not the one the movement actually used.
- **Status:** Frozen, current.

### The Budget page's cash card reads the book
- **Decision:** "Saldo Kas & Bank" on the budget list, its breakdown dialog, and the
  submission report's Opening Balance all read `cashBookSummary()` — real balances from
  `cash_bank_balance`, grouped per currency. The *Sementara* labelling that accompanied
  the old placeholder is gone, because the figure is no longer a placeholder.
- **Reason:** The card was originally built on the mock-only `m_cash_bank.balance`
  column and labelled to say so. With the Cash Bank Book in place there is a real
  source, so the card states it plainly.
- **Impact:** The dialog now lists balance per resource as well as per currency, since
  the underlying data supports it. Inactive resources are excluded — an inactive
  resource is not spendable capacity.
- **Status:** Current.

### The submission report ships as UI without its export
- **Decision:** "Laporan Pengajuan" renders the full picker — per-currency recap,
  selection, totals — and its "Unduh XLSX" button is disabled with an explanation.
- **Reason:** The user asked to see the feature working without the export yet, and
  writing the spreadsheet is a sizeable piece of work in its own right.
- **Impact:** No XLSX writer and no spreadsheet dependency in the tree. Building the
  export is a follow-up task; its recap now rests on real balances, so nothing blocks
  it but the work itself.
- **Status:** Current, by agreement.

### `Initialization/` stays in the repository
- **Decision:** The folder is intentionally committed and permanent. Do not remove,
  relocate, or tidy it up because the conversion looks finished.
- **Reason:** The user may supply updated mockups or concept documents there and ask for
  the repository to be reconciled against them.
- **Impact:** When asked to re-check against those files, inspect and reconcile.
- **Do not change unless:** the user explicitly asks for its removal.
- **Status:** Frozen, current.

### Authentication is built on the framework, not on an auth library (FROZEN)
- **Decision:** Email/password authentication with **database-backed sessions**, written
  against Next.js's own `cookies()` API, `bcryptjs`, and `node:crypto`. `next-auth` was
  removed from the dependencies unused.
- **Reason:** Three things the library could not give this application. Auth.js v5's
  Credentials provider supports only JWT sessions, so a deactivated user would keep a
  valid token until it expired — this system must cut them off on the next request.
  A `sys_session` table makes revocation immediate and auditable. And leaving a
  half-wired auth library in the tree invites a second, competing authorization path,
  which §12's "one authoritative model" forbids. Nothing here is hand-rolled
  cryptography: bcrypt for passwords, `randomBytes` for tokens, SHA-256 at rest.
- **Impact:** No `AUTH_SECRET` and no shared signing key to distribute. Reverses the
  earlier intent recorded in §4 that Auth.js would be wired up.
- **Do not change unless:** a requirement arrives that genuinely needs a provider
  ecosystem (SSO, OAuth, MFA). Adding one then means replacing this path, not running
  alongside it.
- **Status:** Frozen, current.

### Session rows are housekeeping, and are pruned
- **Decision:** `sys_session` rows that can no longer be accepted — expired or revoked
  — are deleted. The prune is a single `deleteMany`, called after a successful login.
- **Reason:** The no-delete rule exists to protect master data and history, neither of
  which a dead session row is. `audit_log` is the audit trail and is untouched. Logins
  are frequent enough to keep the table small and need no scheduler, cron, or job
  runner, so the cleanup costs one query and no infrastructure.
- **Impact:** Nothing observable — `validateSessionToken` already rejected those rows.
- **Do not change unless:** explicitly instructed. **Do not add session rotation, a
  cleanup scheduler, or a session-management framework**; this is an ERP login, not a
  security product.
- **Status:** Frozen, current.

### RBAC is role-based only — one authorization path (FROZEN)
- **Decision:** `USER -> ROLE -> PERMISSION`, and nothing else. A user holds zero or
  more roles; a role holds zero or more permissions; effective access is exactly the
  union of the active ones. No direct user-to-permission grant, no permission
  inheritance, no hierarchical roles, no ABAC, no per-record ACLs, no policy engine.
  **No defaults:** every role except `ADMIN` is created empty, and nothing anywhere
  reads a role's name to decide access.
- **Reason:** Two ways to hold a permission means two answers to "may this user do
  this?", and the safe one is whichever the code happened to check. One path is
  auditable by reading a single query.
- **Impact:** Giving one person an exception means giving them a role. That is the
  intended cost.
- **Do not change unless:** explicitly instructed. **Do not add a
  `sys_user_permission` table**, however convenient a one-off exception looks.
- **Status:** Frozen, current.

### The permission catalogue lives in code
- **Decision:** `src/lib/siba/permissions.ts` is the source of truth; `sys_permission`
  is its materialisation, synced by the seed. Permissions carry a stable semantic code
  (`USER_CREATE`), deliberately **not** the `<prefix>.<4 digits>` convention of §9 —
  nothing generates them.
- **Reason:** A permission is a branch in the code. Letting it be created at runtime
  produces rows no code reads and codes no one can rely on.
- **Impact:** Adding a capability means adding a catalogue entry and reseeding. The
  table carries no status and no authorship because users never author it.
- **Do not change unless:** explicitly instructed. **Do not add a UI for creating or
  editing permissions.**
- **Status:** Frozen, current.

### Menu access and actions are separate permissions
- **Decision:** `MENU_<MODULE>_ACCESS` is distinct from every action inside it, and
  view / create / edit / activate / deactivate / approve / reject / post are each their
  own permission. The prefix order is **`MENU_USER_ACCESS`**, not `USER_MENU_ACCESS` —
  confirmed by the user; do not rename the catalogue to match an example written the
  other way round.
- **Reason:** Real roles need exactly this: a user who sees Budget but cannot approve,
  or edits a document but cannot post it.
- **Impact:** More catalogue entries, and no shortcuts — never treat a menu permission
  as implying anything inside the module.
- **Status:** Frozen, current.

### The application can never be left without an administrator
- **Decision:** Three protections, enforced in `user-admin.ts`: nobody changes their own
  roles, status or password from user administration; any change that would leave no
  active user holding `ADMIN_CRITICAL_PERMISSIONS` is refused; and the `ADMIN` role's
  permission matrix is frozen at the whole catalogue.
- **Reason:** A permission check alone does not make privilege changes safe. Without the
  first, an administrator is one careless click from escalation or self-lockout; without
  the second and third, the last way into the system can be removed by accident.
- **Impact:** `ADMIN`'s grants are re-synced by the seed as the catalogue grows. Custom
  roles and `STAFF` stay fully editable.
- **Do not change unless:** explicitly instructed. **Do not add a super-admin tier** —
  these rules exist so a hierarchy is unnecessary.
- **Status:** Frozen, current.

### User and Role get bespoke routes, not registry entries
- **Decision:** `/settings/user` and `/settings/role` are hand-written, outside
  `entities.ts`.
- **Reason:** The registry expresses fields and columns. It cannot express a password
  that is write-only, a role assignment gated by a different permission from the rest of
  the form, or a permission matrix — exactly the escape hatch §12's registry decision
  anticipated.
- **Impact:** The registry stays untouched and keeps driving Master.
- **Status:** Frozen, current.

### `proxy.ts` is a convenience, not a security boundary
- **Decision:** `src/proxy.ts` checks only that a session cookie is *present* and
  redirects to `/login`. No database access, no permission evaluation.
- **Reason:** Proxy runs on every request including prefetches, so a query there is a
  per-navigation cost; more importantly, request-layer checks are the wrong place to
  rely on. A forged cookie passes this file and is rejected by the real check.
- **Impact:** Deleting the file would cost a tidy redirect and nothing else. **Never
  move an authorization decision into it.**
- **Status:** Frozen, current.

### Language convention
- **Decision:** UI strings Indonesian; code, comments, commit messages English. Technical
  accounting terms stay English inside Indonesian copy (Budget, Cash Bank, Journal).
- **Reason:** Matches the mockup and the reference study's §12.4 convention.

---

## 13. Planned Changes

Deferred by design. Do not build these without explicit instruction, and do not make
decisions now that foreclose them.

| Item | Planned behaviour |
| --- | --- |
| Subledger opening balances | A subject's position before the application started keeping its book. `SubLedgerEntryType.Opening` exists and nothing writes it. **Deliberately outside the Opening Balance work**, on the user's decision: the subject books are continuous stores, so a year-end does not interrupt one, and a close writes no subledger entry |
| Period-end revaluation | SIBA multi-currency §7: retranslate open positions at the closing rate and collapse a foreign account's layers into one. `CashBankLayerStatus.ClosedByRevaluation` exists and nothing writes it. **The only sanctioned consolidation of layers** — do not add a second one, and do not merge layers for any other reason (§10 rule 71) |
| Multi-layer settlement | The source specification lets one payment draw on several layers (`Σ selected = account_amount`). SIBA takes one per document, refused at draft time with a message that says to split it. Widening this means a selection UI with a running total and per-layer relief, not a loosened check (§12) |
| Third-currency settlement | A foreign document paid from a *third* currency's account, needing a cross rate on top of the account's own. Refused today by `maySettle`. This is a cross-rate model, not a relaxed validation (§12) |
| Submission report export | Write the XLSX for "Laporan Pengajuan"; the picker and its recap are already built |
| Report output | A print sheet and an export for Report Views. Both land in the `.ph-act` slot the convention already reserves, and the print half means finally defining the `.psheet` / `.ps-doc` / `.ps-tb` classes `globals.css` references but never declared. The print sheet is also what has to restate the criteria on paper: on screen the sticky filter does it, and paper has no sticky header |
| Intercompany settlement | Concept doc §36: the anak handing money back to the induk, clearing `A Piutang B` against `B Hutang A`. The positions are already kept, on the bridge accounts in both Companies' journals — what is missing is the document that settles them |

**Exchange rate — current state.** Built, and it is not a rate *source*. The system
holds no market rate and looks none up: a kurs is either the identity, the rate of a
layer that was acquired at it, or a figure the user typed because that is what the
bank actually used (§10 rule 68). If a real rate feed ever arrives it can only ever
**prefill** an entered kurs — it must not revalue a stored base figure, which is
history (§12, a rate is an input or an output). Period-end revaluation is the one
process allowed to restate positions, and it is not built.

---

## 14. Do Not Do

- Do **not** put project context in `AGENTS.md`, and do **not** delete it — `next dev`
  manages it, and its presence is what stops this file being reset to a one-line stub.
- Do **not** edit, move or remove `Initialization/` — it is permanent source material (§12).
- Do **not** hard-delete master data, or add delete actions / cascading deletes to master
  tables. Deactivate instead.
- Do **not** allow Company create or edit, or add a third company — at any entry point.
- Do **not** add `treasury_provider_company_id`, a treasury-provider table, or any
  company-to-company relationship table. `is_parent` is the whole model.
- Do **not** generalise the two-company structure into a configurable multi-company
  architecture, or build a configurable funding-provider mechanism.
- Do **not** delete a Budget Category x Partner Category pair, let a category allow
  neither direction, or let a `require_partner = false` category hold a pair. A pair
  is deactivated, and unticking one on the form retires it (§12).
- Do **not** give the Budget Category x Partner Category pairing its own menu again,
  or write the set outside the transaction that writes the category. Two saves is how
  an inert category becomes reachable (§12).
- Do **not** render a set as a checkbox grid, or rebuild the add-and-remove chip row.
  `MultiSelect` in `components/ui` is the one implementation (§8, §12).
- Do **not** offer `allows_in` and `allows_out` as two checkboxes again. Both can be
  off, which is a category that classifies nothing — Arah asks once (§12).
- Do **not** put the Budget Category rules back in code, or read them anywhere but
  `loadClassification`. `BUDGET_CATEGORY_RULES` is gone (§12).
- Do **not** show a direction as `In` or `Out`, or invent a second Indonesian pair
  for it. It is Penerimaan and Pengeluaran, through `directionText` (§8).
- Do **not** filter `purposeOptions` — that is what a posted document is read back
  through. A picker uses `availablePurposeOptions` (§12).
- Do **not** resolve a Budget Category from a Purpose's label. A Purpose row carries
  `budgetCategoryId`; the category owns the book and the mapping (§12).
- Do **not** generate a Transaction Purpose, store its label, or add a "generate
  missing" action. They are entered; a Budget Category with none is a maintenance
  gap, not a fault to design away (§12).
- Do **not** change a saved Purpose's direction, Budget Category or Partner Category.
  That would not edit it — it would make it a different Purpose, against which
  documents are already posted (§12).
- Do **not** add an entry to `SEED_PURPOSES` in `rules.ts`. It is the historical 22,
  planted once; a new Purpose comes from a new Budget Category or pairing (§12).
- Do **not** create an exchange-rate master table, a rate-fetching service, or a
  Budget Month table. Budget Month is a date-range query over
  `acc_fiscal_period`; do not add a month column to `bud_budget` either.
- Do **not** add a Budget Close or Budget Delete action, or move Budget into the entity
  registry. The lifecycle is create → approve and lives in `budget-workflow.ts`; a
  Budget reaches `Closed` only as a consequence of posting (§12).
- Do **not** let a budget be edited outside Draft and Rejected, and do **not** let
  `category_id` or `partner_id` be set anywhere but approval.
- Do **not** add a balance column to `m_cash_bank` or any other master table, and do
  **not** compute a balance anywhere but `src/lib/siba/cash-bank.ts` (§9, §12).
- Do **not** add an update or delete path to `cash_bank_ledger` or `sub_ledger`.
  A book is append-only; a correction is a further entry.
- Do **not** split the subject books into separate tables, give one its own bespoke
  report, or add a book for a Budget Category that names no Partner. A book **is** a
  Budget Category, derived by `subledger-catalogue.ts` from the row (§12).
- Do **not** go back to one Report View, one permission or one menu entry **per**
  subject book. That is what put a deploy between a new category and its book (§12).
- Do **not** resolve a book through a Transaction Purpose or a category label. The
  Budget Category owns the book, and the lookup takes its id (§12).
- Do **not** sign a subject book by the cash direction. Each book declares which
  direction raises it, and `subledgerMovement` is the only place that is decided
  (§10 rule 53).
- Do **not** write a subledger entry outside `recordSubledgerEntry`, and do
  **not** derive one from a journal line (§10 rule 22, §12).
- Do **not** sum amounts across currencies at face value, and do **not** convert a
  figure by any rate other than the one recorded on the movement itself. There is no
  rate lookup in this system (§9, §12).
- Do **not** store a derived carrying rate, default one into a document, or treat one
  as a market rate. `carryingRate` exists to be displayed (§10 rule 68, §12).
- Do **not** re-derive a stored base figure at a later rate. The base measure is
  history; only period-end revaluation may restate a position, and it is not built
  (§12, §13).
- Do **not** merge rate layers, auto-select one, edit a layer's rate, or add a second
  way to consolidate them. One payment draws on one layer the user picked
  (§10 rules 70–71, §12).
- Do **not** widen `maySettle` to admit a third currency without building the cross
  rate that case needs (§10 rule 67, §12).
- Do **not** write a rate of `1` for anything but base currency moving through a
  base-currency resource. Between two foreign amounts it asserts USD 100 is IDR 100
  (§10 rule 68).
- Do **not** give a rate a numeric control of its own, let `.` mean a decimal point
  on input, stop a field grouping while it is being typed into, or format a rate
  outside `formatRate`. One control, and one meaning per separator key (§8, §12).
- Do **not** put business data in `prisma/seed.ts`, and do **not** add a delete step to
  it. It syncs system data and nothing else (§12).
- Do **not** use a native `<select>`, `<input type="date">` or `<input
  type="number">`. Use `Select`, `DateInput` and `MoneyInput` from
  `components/ui/` — the OS draws none of those (§12).
- Do **not** hand-write a control that already exists in `components/ui/` —
  a search box, a dialog, an amount field, a picker. One repeated control is one
  component, and `tests/design-system.test.ts` fails on a copy (§12).
- Do **not** hide a field until its prerequisite is answered, and do **not**
  let a picker open onto a list that is empty only because another field is
  unfilled. It waits in place with `waitingFor`, saying `Pilih <what> dulu…`
  (§8, §12).
- Do **not** build a form out of `.fld` / `.frow` / `.fsec` markup. Use
  `FormBody` / `FormSection` / `FormRow` / `Field` from `components/ui/form.tsx`
  — a label-less `.fld` holding a button or a banner is the only exception (§12).
- Do **not** render a field's help under its control, lengthen it past one
  clause, or leave it as a full sentence. Help shares the label's line, and the
  space it used to take is the whole point (§8, §12).
- Do **not** add a summary side card to a form, or a `.ph-sub` to a form page.
  Each fact goes where it is read: the number and status into the page heading,
  the authorship into the record's own history panel (§12).
- Do **not** title a document form with its description. The heading is the
  document number and its status; before the first save it is a placeholder
  (§12).
- Do **not** shrink a control's height or hit area to save vertical space. The
  operators work by mouse; only the padding around the control is negotiable
  (§12).
- Do **not** position a popup relative to its own control — no
  `top: calc(100% + …)`, no `.cbpop` rendered outside `AnchoredPopup`. A popup
  inside a scroll box is clipped by it, and the sheet behind it ends up scrolling
  instead of the list (§8, §12).
- Do **not** write a bare `.ph` rule in `globals.css`, of any kind. `.ph` is the
  page header **and** the placeholder inside Combobox, Select and DateInput;
  scope every page-header rule `.pad > .ph` (§8, §12).
- Do **not** write a padding, a tint or a border inline where a modifier class
  exists — `.empty.sm`, `.mi.t-ok`, `.tw.boxed`, `.srch.grow` (§8).
- Do **not** phrase a picker's prompt any way but `Pilih <what>…` (§8).
- Do **not** format a date anywhere but `formatDate`. Every date reads `dd/mm/yyyy`.
- Do **not** give Fiscal Period a menu entry, a route, a registry config, or
  permissions, and do **not** let a period's dates be edited by hand. Periods are
  generated when a Fiscal Year is activated (§12).
- Do **not** make a Fiscal Year's `status` an editable field, add a transition back
  to Draft, or add a path that reopens a closed year. `Closed` is a rollup over
  `acc_fiscal_closing`, never a value anybody sets (§12).
- Do **not** let a third Fiscal Year stand Open, and do **not** close any but the
  oldest Open one — the newer would have no successor to inherit its snapshot
  (§12).
- Do **not** offer `close` as a header confirm button. It carries a `runAt` because
  it needs a Company, a checklist and a preview of the journal it is about to post
  (§12).
- Do **not** back-date a journal. A `CLS-` closing entry is the single exception,
  and `postJournal` refuses a `postingDate` outside that series (§10 rule 49).
- Do **not** post to Laba/Rugi Tahun Berjalan. It is a Balance Sheet presentation
  line, computed as Σ Pendapatan − Σ Biaya; the closing journal moves the result
  straight into Laba/Rugi Tahun Sebelumnya (§12).
- Do **not** add an edit, delete or reversal path to `acc_opening_balance`, or a
  create form for it. A snapshot is written by a close or injected at go-live with a
  null source, and is immutable (§12).
- Do **not** write a snapshot line for an account whose Partner split you read off
  `require_partner`. The grain comes from the posted journal lines as they actually
  are (§12).
- Do **not** let a report's opening disagree with the full scan. Equivalence is the
  property the snapshot-based opening rests on, and `tests/ledger-opening.test.ts`
  holds it at three boundaries (§12).
- Do **not** let a System Default decide what is valid, apply one to an existing
  record, or add a UI for creating setting keys. The catalogue is code and a default
  only prefills (§12).
- Do **not** add a `sys_user_permission` table or any second path to a permission —
  roles are the only one.
- Do **not** add permission inheritance, ABAC, per-record ACLs, a policy engine, or a
  super-admin tier.
- Do **not** create a UI for authoring permissions; the catalogue is code.
- Do **not** branch on a role name in business logic — ask for the permission.
- Do **not** rely on a hidden or disabled control as the protection; the Server Action
  must refuse the same request on its own.
- Do **not** move an authorization decision into `src/proxy.ts`.
- Do **not** let any user change their own roles, status, or permissions.
- Do **not** select `password_hash` into anything that crosses to a client component.
- Do **not** reintroduce an auth library alongside this one (see §12).
- Do **not** rename the permission catalogue to `<AREA>_MENU_ACCESS`; the order is
  `MENU_<AREA>_ACCESS` and is settled (§12).
- Do **not** add session rotation, a cleanup scheduler, or a session-management
  framework. Dead rows are pruned on login and that is the whole mechanism (§12).
- Do **not** reduce the cached Prisma client in `src/lib/prisma.ts` to a bare presence
  check, and do **not** delete `tests/schema.test.ts`. Together they are what stop a
  regenerated client from being shadowed by a stale one (§12).
- Do **not** add a `nav.ts` entry without a route that answers (§12).
- Do **not** add a delete, a reversal, or any path back to Draft in Finance. A posted
  document is permanent and a correction is a new document (§10, §12).
- Do **not** let a Draft touch a balance or `realized_amount`, and do **not** split
  Post into separate writes — it is one database transaction (§12).
- Do **not** derive the Cash Bank Book from a journal line when the Journal is built;
  the posting engine calls `recordCashBankEntry` alongside it (§10, §12).
- Do **not** filter eligible Budgets by Budget Date, and do **not** treat the picker as
  the enforcement — `checkHeader` and `checkLines` are (§10).
- Do **not** let a Cash Bank Transfer settle a Budget, name a Partner or write a
  subject book, and do **not** merge it back into `fin_cash_bank_transaction` as
  a third `transaction_type`. A transfer has no counterparty (§10 rule 84, §12).
- Do **not** blend the layers a transfer creates, or let a destination layer
  carry anything but the base its source released and the rate that source
  layer held. A transfer conserves base value (§10 rule 86).
- Do **not** divide by a kurs to derive a foreign amount. The entered rate
  always values the foreign side into base, in one multiplication (§10 rule 88).
- Do **not** add a fourth transfer Purpose for one foreign currency to another.
  That is a Pencairan followed by a Pembelian Valas (§10 rule 85).
- Do **not** give the anak a Cash & Bank resource, or let its document name one. It
  names a Currency and reaches money through Funding Request (§10 rule 38, §12).
- Do **not** add a rejection, a partial funding, or a second open request for one
  document. The induk confirms; the requester may withdraw (§12).
- Do **not** let `finance.ts` import `funding.ts`, and do **not** close a Funding
  Request from Finance's own action — Funding depends on Finance, never the reverse
  (§3, §12).
- Do **not** split the funded confirmation into separate writes, derive one Company's
  journal from the other's, or add an Intercompany Event table; the Funding Request is
  that identifier (§10 rules 59–60, §12).
- Do **not** give the intercompany bridge settings a fallback. A confirmation is
  refused by name until all four are set (§12).
- Do **not** register a Company as a Partner so the intercompany position can live in
  a subject book. That position is journal, and the General Ledger is where the two
  sides reconcile (§10 rule 61, §12).
- Do **not** display or populate `transaction_base_amount` / `settlement_base_amount`
  with a conversion — they are the identity until a real rate source lands (§12).
- Do **not** add a `BUDGET_CLOSE` permission or a close action; a Budget closes when
  realization reaches its planned amount, as a consequence of posting (§12).
- Do **not** put a Draft record on the dashboard, state one figure in two of its
  cards, or restore the master-data counts and their per-Company spread. The page
  is MECE and its funnel partitions committed money (§12).
- Do **not** add a lifecycle transition without writing its `event` on the audit
  row and naming it in `lib/siba/audit-events.ts` — without both, the step shows
  in every history as a bare "Diubah" (§10 rule 63, §12).
- Do **not** store an audit label in the database, or backfill an `event` onto a
  row that predates the column. The workflow table owns the wording, and an
  inferred transition is a guess presented as a fact (§12).
- Do **not** make the history panel writable, order it oldest-first, or drop the
  "menampilkan N dari M" line when it is capped (§10 rule 64).
- Do **not** let a Report View write anything, and do **not** give one a row action
  that mutates. A report reports (§10, §12).
- Do **not** let a report read outside the reader's Company scope, and do **not**
  let a scoped reader resolve its own scope. Every Report View runs for one
  Company and takes it as an argument (§12).
- Do **not** add a filter that breaks a money report's own arithmetic — no entry-type
  filter on the Cash Bank Ledger (§10, §12).
- Do **not** invent a new report screen shape or new report CSS; extend the Report View
  convention instead, and do **not** build a generic report engine (§12).
- Do **not** move a Report View's filter out of the sticky page header into a
  `.toolbar`, and do **not** reinstate the `.critbar` restatement or a `.ph-sub` on a
  report — the filter states what was run (§12).
- Do **not** label a report's balanced case. Equal totals are visible in the columns;
  only a difference gets a `.rwarn` chip and a sentence (§12).
- Do **not** give a report a column whose whole job is one short word — fold it into
  the cell it belongs to. A report that scrolls sideways cannot be read across a row
  (§12).
- Do **not** re-embed the Cash Bank Book under the Cash & Bank master record. The
  master links into the report (§12).
- Do **not** add an edit, delete or reversal path for a **posted** journal, do
  **not** write one outside the posting engine, and do **not** back-date one
  (§10, §12).
- Do **not** let a manual journal reach a control account, and do **not** decide
  an account's usability by anything but `is_postable` and `is_control_account`
  (§10 rules 79–80, §12).
- Do **not** let a Draft journal be read by the General Ledger, the Trial
  Balance or `unbalancedJournals`, and do **not** enforce the balance when a
  draft is saved — a journal being typed does not balance yet (§10 rule 82).
- Do **not** put `is_postable` or `is_control_account` on a form, and do **not**
  reduce `syncControlAccounts` to a one-way claim. Both flags are the
  structure's answer, recomputed rather than typed — and with no checkbox left,
  a claim that never releases would close an account for good (§10 rules 79–80,
  §12).
- Do **not** add a date field to the manual journal form. The engine writes the
  date when it writes the books (§10 rule 81).
- Do **not** derive an operational book from journal lines. Only the General
  Ledger derives from the journal (§10, §12).
- Do **not** sum across accounts in the General Ledger, and do **not** convert
  between currencies in either ledger report (§12).
- Do **not** make account numbers globally unique, and do **not** show both
  Companies' charts in one tree (§10, §12).
- Do **not** put a Company selector in the topbar, do **not** add a per-user or
  per-record Company grant table, and do **not** let a scoped reader resolve its
  own Company instead of taking it as an argument (§12).
- Do **not** put a form's buttons anywhere but `.ph-act`, and do **not**
  reintroduce a bottom action bar (§8, §12).
- Do **not** place a destructive button to the right of a header's primary, give
  one header two primaries, or decide a button's weight inline. `.ph-act` runs
  danger → neutral → primary through `lib/siba/header-actions.ts`, and a
  vertical row menu runs the other way (§8, §12).
- Do **not** write a bare `.ph` CSS rule — it is the Combobox and Select
  placeholder class as well as the page header. Scope page-header rules to
  `.pad > .ph` (§12).
- Do **not** let an account number be typed whole, renumbered, or moved to a
  different parent. A code is composed from its lineage and frozen once saved
  (§10, §12).
- Do **not** let a parent account be posted to, mapped to, or named by a System
  Default, and do **not** add a path that makes one postable again. Do **not**
  loosen the mirror rule that keeps an account already in use from gaining a
  sub-account — the two only work as a pair (§10 rules 77–78, §12).
- Do **not** put a filter box inside a dropdown's popup. The control itself is
  the search box, in the `Combobox` and in a searchable `Select` alike (§8, §12).
- Do **not** repeat in an option's chip a facet its label already spells, and do
  **not** let a screen draw its own group headings or return a dropdown's search
  to a single substring test. A list of combinations is grouped and searched by
  every word (§8, §12).
- Do **not** give a rate layer a dropdown again, or show anything but the kurs
  in the field once one is chosen. Four attributes do not fit on one option line
  (§12).
- Do **not** write a report footnote longer than one sentence, or restate in it
  a rule the screen already obeys (§12).
- Do **not** seed accounts. The seeded skeleton stops at Account Subcategory
  (depth 3); depth 4 and below is the user's chart (§12).
- Do **not** replace `CASH_BANK_SUBCATEGORY` with a list of account names or a
  setting. Kelompok `1.1.1` is the anchor (§12).
- Do **not** edit `src/generated/prisma/` — regenerate it.
- Do **not** rewrite `globals.css` or introduce a utility CSS framework.
- Do **not** rename Prisma fields to camelCase.
- Do **not** build anything still listed in §13 without explicit instruction.
- Do **not** add an API route layer for internal CRUD.
- Do **not** hand-edit applied migrations or use `prisma db push`.
- Do **not** land a migration without updating `SIBA DBML/SIBA DBML.md` in the same
  change, and do **not** edit `Initialization/SIBA 3.0 DBML.txt` to match the current
  schema — it is frozen source material (§9).
- Do **not** run `npm run db:reset` against data the user cares about — it drops the
  database. `npm run db:seed` is the safe one and destroys nothing.
- Do **not** run `npm run db:truncate-transactions -- --confirm` without being asked to.
  It empties the documents and the books, and a Cash & Bank's Saldo Awal cannot be
  re-entered afterwards — it is create-only. The flagless form reports and deletes
  nothing; that is the one to run when checking what is there.
- Do **not** make operational books derive from journal lines.
- Do **not** write a test that assumes a particular business row exists. Build the
  fixture (`tests/helpers.ts`) and clean it up.
- Do **not** add dependencies without saying why; several installed ones are still unused.
- Do **not** refactor working modules while implementing an unrelated feature.
- Do **not** commit `.env` or any real credential.
- Do **not** claim a feature works without having exercised it.

---

## 15. Change Discipline

1. **Read before writing.** For a feature the mockup demonstrates, look at how it
   behaves there before building it — for interaction and layout, never for its data.
2. **Smallest change that works.** No speculative abstraction.
3. **Reuse existing patterns** — registry config, Server Action shape, CSS classes.
4. **Keep commits small and per-feature**, with the established message style.
5. **Validate before reporting done:** `npm run build` (typechecks), `npm run lint`, and
   `npm test`. For UI work, exercise it in a browser; for write paths, verify the row in
   Postgres. Anything touching authentication, authorization, or money needs a test in
   `tests/`.
6. **Report** files changed, what was verified, what was not, and anything unresolved.
7. **Surface conflicts** between the concept doc, the DBML and the mockup — do not
   resolve them silently.
8. **Clean up after yourself.** Throwaway data created while testing is removed by hand
   or by a fixture teardown — never by reseeding, which no longer wipes anything, and
   never by `db:reset` on a database holding real data.

---

## 16. Git / Version Control Conventions

- **`main` is the only branch — frozen workflow.** All development happens directly on
  `main`. Do not create feature branches or session branches, and do not use pull
  requests as the route to landing work. Commit to `main` and push.
- **Why:** work once accumulated on a separate cloud-session branch behind a PR. Because
  cloud sessions run remotely, that work reached GitHub but never the user's local
  checkout, which sat on `main` — so the running app silently lagged the repository.
  One branch keeps GitHub, the working tree, and `localhost` in agreement.
- A session that somehow starts off `main` must merge back and delete the branch promptly.
  Work done remotely should land on `main` with a note to `git pull`, not be left on a
  branch to discover.
- Remote `origin` on GitHub.
- Commits are small and per-feature.
- Message style (established over the existing history): a short imperative subject line,
  then a body explaining **why** and calling out deliberate deviations.
- Attribution trailers are appended per the session's instructions.
- Never commit `.env`, `node_modules/`, `.next/`, or `src/generated/`.

---

## 17. Current Known Issues

| Issue | Detail |
| --- | --- |
| The classification sync runs only on writes through the app | `syncPurposesFor` is called by `createRecord`, `updateRecord` and `toggleStatus`, so editing `sys_budget_category` or its pairings directly in SQL leaves the Purposes behind. There is no "sync now" button. `tests/purposes.test.ts` pins that all three call sites still exist, which is what caught one of them silently missing. |
| Every subject book shares one permission | `REPORT_SUBLEDGER_VIEW` covers all of them, so whoever may read Hutang may also read Prive — the owners' drawings. It replaced six per-book permissions, which could not survive books being created through the GUI: a permission per book would be a permission created at runtime (§12). Nothing in the seeded roles relied on the distinction. If it is wanted back, the shape that fits is a `sensitive` flag on the category gated by one **further static** permission, which keeps a new category developer-free while re-fencing Prive. |
| An audit entry names a record by its current name | `audit_log` stores no snapshot, so a record renamed since it changed reads under the name it has now. Inventing a snapshot would be worse than saying nothing, but it does mean the panel is not a record of what a thing was called at the time. |
| Budget report has no export | The picker is complete; "Unduh XLSX" is disabled by agreement (§12). |
| The subject books have no manual entry path, and no opening balance | A subledger entry is only ever written by posting a Cash Bank Transaction. `SubLedgerEntryType.Opening` exists and nothing writes it, so a position carried over from before the application cannot yet be stated — that belongs with Opening Balance (§13). `Adjustment` is in the same position as the Cash Bank Book's. |
| A transfer shows in the Cash Bank Book by number, not as a link | `sourceDocumentNumbers` in `cash-bank.ts` resolves only `fin_cash_bank_transaction`, which is already the baselined crossing this table records below. A transfer entry therefore carries `TRF-0001 — <Purpose>` in its note and has no drill-through. Extending that function to a second table would deepen the debt; the clean fix is to make labelling a `(doc_type_id, doc_id)` pair the caller's job, which is a decision in its own right. |
| A subject book's report shows a document's note, not a link | An entry carries its source as the weak `(doc_type_id, doc_id)` pair and its document number inside `note`. Resolving that to a link would mean the book importing Finance, which is the boundary crossing `cash-bank.ts` already has and that has not been decided. |
| The Cash Bank Book has no UI write path of its own | Entries are created by registering a resource with an opening balance, or by posting a Cash Bank Transaction. There is deliberately no manual entry form and no `Adjustment` path yet — so an `Adjustment` entry can exist in the book but cannot be made through the application. |
| Layers can go stale, and that is accepted | Nothing forces the oldest layer to be consumed, so an unselected layer persists indefinitely. The source document names this as a consequence of the design rather than a defect: period-end revaluation is what absorbs them, and it is not built (§13). |
| The FX difference on a payment is a user decision | Which layer the user picks sets the gain or loss recognised. Under averaging it would be deterministic. This is the feature working as intended — the source document calls layer selection an auditable control point — but it does mean two clerks can post the same payment to different results, and nothing flags that. |
| A standing foreign position is never retranslated | A Hutang in USD keeps the base value it was carried at until something settles it. Without period-end revaluation (§13) there is no unrealised gain or loss anywhere in the system, so the base measure of an open position drifts from what it would be worth today — by design for now, and the one thing revaluation exists to fix. |
| A document is capped by one layer | A resource holding five layers of a million each cannot make a single payment of one and a half million. Refused at draft time with a message that says to split the document (§12). It is a deliberate narrowing of the source specification, not a validation bug. |
| A snapshot folds away which currencies fed an opening | An Opening Balance is base currency, so once a report's opening comes from one, `LedgerAccount.foreignCurrencies` covers only the lines still scanned — an account funded entirely in dollars two years ago no longer reads as foreign-sourced from its opening alone. The figures are unaffected, and the per-entry `trxAmount` / kurs columns inside the period are untouched. Restoring it would mean scanning the very history the snapshot exists to skip. |
| A closing entry is the one back-dated journal | A `CLS-` journal is dated the last day of the year it closes (§10 rule 49). Nothing else may be, and `postJournal` refuses a `postingDate` outside the `CLS` series — but it does mean the General Ledger holds one entry whose date is not the day it was written, and a reader comparing a journal's date to its audit row will find them different for exactly those. |
| A manual journal cannot be reversed | Like every other posted journal: a correction is a new manual journal. There is no `JOURNAL_DELETE` and no reversal, which is the same rule concept doc §15 sets for every posted record. |
| Reports are on-screen only | No print stylesheet and no export. `globals.css` still carries an `@media print` block referencing `.psheet` / `.ps-doc` / `.ps-tb`, which have never been defined — dead until a print sheet is built. The `.ph-act` slot on every Report View is where those buttons go. |
| A report has no pagination | The period is the only control on size. Fine for a month of one resource's book; a year of a busy account will render every row. |
| `recentActivity()` has no caller | The cross-record audit *feed* is still off the dashboard, pending the user's own plan for where it belongs. The per-record history is a separate reader (`recordHistory`) and is now on every form; `recentActivity()` itself remains unused. |
| A history says who and when, never what | `audit_log` stores no field-level snapshot, so the panel reports that a record was edited and by whom, and cannot say which field moved. Adding a diff means storing one, which is a much larger change than the `event` column was. |
| Rows written before `event` existed read as a bare verb | Rows written before the migration carry `event = null` and report "Dibuat" or "Diubah". They are not backfilled, because nothing in the table records which transition they actually were — inferring one from a timestamp would be a guess presented as a fact. |
| The suite leaves two fixture currencies behind | `cleanupFixtures` removes accounts, partners, mappings and journals but never a `ref_currency` row, so `curr.TESTEUR` and `test.ZZTESTCUR` persist in whatever database `npm test` last ran against. Harmless now that `otherCurrency` is always the suite's own row rather than `currencies[1]` — that opportunistic pick is what let the leftover become the fixture and silently disable the third-currency refusal test. Deleting them would mean hard-deleting master data, which the application itself never does. |
| `zod` unused | Installed; validation is hand-written in the services. |
| The design-system suite is a text scan, not a renderer | `tests/design-system.test.ts` catches a control reproduced by hand or a rule written where a class exists. It cannot see a spacing or alignment mistake that is genuinely new — that still needs a browser. |
| The anak's Piutang against the induk is never settled | Funding leaves `induk Piutang anak` and `anak Hutang induk` standing, and nothing in the application clears them yet — concept doc §36's settlement is the next scope (§13). The positions reconcile against each other in the meantime, which is what they are for. |
| The intercompany position has no subject-book view | It is carried by the two bridge accounts and read through the General Ledger, which is a deliberate deviation from concept doc §34/§37/§38 (§12). The consequence is that the subject books answer "which Partner moved?" and not "what does the anak owe the induk?" — that question is an account balance, and the dashboard now states it from those two accounts so it is no longer reachable only by running the General Ledger for exactly the right one. If a book of it is ever wanted, it needs a subject that is a Company, which is a change to an append-only table. |
| Tests cover security, Accounting, Budget, Finance, Funding, the books, the layers, the FX kernel, the reports, the fiscal calendar, closing and the snapshot-based opening | No tests for the Master module's own write path or the registry forms. The Server Actions' own bodies are covered structurally only — a test process has no session, so the rules they delegate to are what the suites call. |
| Two module boundaries are still crossed | Baselined in `tests/module-boundaries.test.ts` as `KNOWN_CROSSINGS`, so a third fails the suite. (1) `fiscal.ts` counts the Budgets inside each period it returns — wants a counting function on `budget.ts`. (2) `cash-bank.ts` resolves a ledger entry's source document to a document number for the report; the Book is meant to be a leaf, so it cannot import Finance without creating a cycle — labelling a `(doc_type_id, doc_id)` pair probably belongs to the caller. Each needs a decision, which is why none was changed silently. |
| `authInterrupts` is experimental | `next.config.ts` enables it so `forbidden()` returns a real 403 instead of a generic error. If a Next upgrade changes the API, the fallback is to render the refusal from each page instead. |
| Dashboard integrity checks reduced | Checks for missing accounts and dangling FKs were dropped — Postgres makes them unrepresentable. Intentional, recorded so it is not "restored" by mistake. |

## 18. Needs Confirmation

**Nothing is currently open.**

One decision was made by me rather than asked for, and has since been confirmed:
`next-auth` was removed unused, because its Credentials provider cannot give the
database-backed sessions this system's immediate-revocation requirement needs.
Reasoning in §12.

The permission-code ordering (`MENU_USER_ACCESS`, not `USER_MENU_ACCESS`) was raised
here and is now settled — recorded in §12 under "Menu access and actions are separate
permissions".

Everything else previously recorded here has moved into §12 as a frozen decision: the
two-company structure and its three consequences, transaction purposes as application
logic, the Cash Bank Book as the only source of a balance, the seeder's scope, no
currency conversion, delete policy, `Transfer`, Budget Month, and keeping
`Initialization/`.

When something genuinely ambiguous appears, record it here rather than guessing — and
move it into §12 or §10 once the user confirms it.

## 19. Context Maintenance Rules

- Read `CLAUDE.md` before beginning substantial work; treat it as authoritative unless the
  user explicitly overrides it.
- Update it when a **durable** architectural, business, technical or UX decision changes —
  in the same change that introduces it.
- Record new frozen decisions in §12 using the Decision / Reason / Impact / Do-not-change
  format.
- Move items out of §18 into §12 or §10 once confirmed, rather than leaving both.
- Keep §17 accurate: remove issues when fixed; do not promote every TODO comment into one.
- **Do not** add task history, session narration, or temporary instructions.
- **Do not** silently remove or overwrite an established decision. If new work conflicts
  with this file, surface the conflict to the user first.
- Keep it high-signal: prefer rules that change decisions over descriptions discoverable
  from the code.
