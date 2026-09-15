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

**The mockup is a reference for UI and behaviour only — never for data.** Because
it is a self-contained HTML simulation with no database, it carried its whole
dataset inline. That dataset was demo content, not canonical fixtures, and none of
it exists in the application any more. Master data belongs to whoever uses the app
and is expected to grow and change through the GUI. Do not design features, tests
or invariants that assume a particular row exists.

**Scope:**

- **Built** — authentication and RBAC, Master, Accounting, Budget through approval,
  the Cash Bank Book (`cash_bank_ledger` / `cash_bank_balance`), Finance's Cash Bank
  Transaction — draft, edit, cancel and Post, which realizes approved Budgets and moves
  the book, induk only — and the first two **Report Views** over that book.
- **Not yet built** — the rest of the posting engine (Journal, General Ledger, and the
  Prive / Titipan / Hutang / Piutang books), Opening Balance, and the intercompany
  Funding Request flow that carries the anak's realization. Full list in §13.

### Current status

| Area | State |
| --- | --- |
| Scaffold, DB, migration | Done |
| Seed | Done — **system data only**, idempotent, destroys nothing (§12) |
| Cash Bank Book | Done — append-only `cash_bank_ledger` plus materialised `cash_bank_balance`; opening balance entered when a resource is registered |
| Design system port | Done — including the app's own `Select` and `DateInput`, so no control is drawn by the OS |
| App shell (topbar, rail, submenu) | Done |
| Dashboard | Done |
| Master module (Partner, Cash & Bank, Currency) | Done — list, detail, create, edit, status toggle |
| Company master | List + detail done. Create and edit are locked at both the routes and the Server Actions. |
| Accounting module (COA tree, mapping, fiscal calendar) | Done — registry-driven, with Chart of Accounts rendered as a tree and numbered by lineage (`1` → `1.1` → `1.1.1` → `1.1.1.2`). Fiscal Year is the only fiscal menu entry; it is created Draft, activated into Open, and its twelve periods are generated at that moment. Closing is not built. |
| Budget module | Done for create → approve — Budget Month, Budget list, create/edit, and the Draft → Submit → Approve/Reject lifecycle. Bespoke, not registry-driven. |
| Finance module | Cash Bank Transaction done for draft → post — header context (Purpose · Company · Partner · Cash & Bank), multi-Budget realization, Post writing the Cash Bank Book and `realized_amount` in one transaction. Induk only; the anak's realization waits on Funding Request. Journal and the subject ledgers are not built. Bespoke, not registry-driven. |
| Report Views | Done — the screen type plus its first two: `Buku Kas & Bank` and `Saldo Kas & Bank`, under Finance › Laporan. Catalogue-driven from `reports.ts`, parameters in the URL, read-only, reconciling. On-screen only; no print or export yet |
| Authentication | Done — email/password, database-backed sessions, login/logout |
| Authorization (RBAC) | Done — permission catalogue, roles, server-side enforcement on every route and action |
| User & role management, profile | Done — Admin-only user/role administration; own profile for everyone |
| System Default | Done — `/settings/system-default`; catalogue in code, values in `sys_setting`. Currently one entry: default Currency |
| Tests | Security suite plus the Accounting, Budget, Finance, Cash Bank Book, fiscal calendar and System Default enforcement points, via `node:test` (`npm test`). Business fixtures are created by the tests, not by the seed. |

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
| Business rules | `src/lib/siba/rules.ts` | Budget categories and the 22 transaction purposes |
| Account numbering | `src/lib/siba/account-code.ts` | The dotted lineage code — parsing, segments, ordering; client-safe |
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
| Fiscal calendar | `src/lib/siba/fiscal.ts` | Fiscal Year shape, generation of its twelve periods, and reading them back; `server-only` |
| Fiscal Year lifecycle | `src/lib/siba/fiscal-workflow.ts` | Draft → Open, its permission, and why Closed is not reachable; client-safe |
| System Default catalogue | `src/lib/siba/system-defaults.ts` | Every value the app prefills with; client-safe |
| System Default store | `src/lib/siba/system-settings.ts` | Reads and writes `sys_setting`, resolves a default against its master; `server-only` |
| Budget lifecycle | `src/lib/siba/budget-workflow.ts` | The transition table — from-status, to-status, permission; client-safe |
| Budget data | `src/lib/siba/budget.ts` | Month rollups, budget reads, classification enforcement, `BGT-` numbering; `server-only` |
| Cash Bank Book | `src/lib/siba/cash-bank.ts` | Append-only ledger writes, the materialised balance, `CBL-` numbering, per-currency summary; `server-only` |
| Transaction lifecycle | `src/lib/siba/transaction-workflow.ts` | Draft → Post / Cancel, one transition table; client-safe |
| Finance data | `src/lib/siba/finance.ts` | Header and line enforcement, Budget eligibility, `applyPosting`, `CBT-` numbering, realization trace; `server-only` |
| Report catalogue | `src/lib/siba/reports.ts` | Every Report View — slug, permission, parameter set; client-safe |
| Write path | `src/app/actions/master.ts` | Validation, create, update, status toggle, audit |
| Budget writes | `src/app/actions/budget.ts` | Create, edit, and the lifecycle transitions |
| Finance writes | `src/app/actions/finance.ts` | Create, edit, the eligible-Budget query, and Post / Cancel |
| Shell | `src/components/shell/app-shell.tsx` | Topbar, icon rail, collapsible submenu |
| Registry pages | `src/components/master/entity-pages.tsx` | The four registry pages, mounted under each owning module |
| Generic UI | `src/components/master/`, `src/components/ui/` | Table, tree, form, combobox, dialog, toast |

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
Initialization/          Read-only source material (concept, DBML, mockup, UI study)
prisma/
  schema.prisma          Data model; deviations from the DBML commented inline
  migrations/            Applied migrations
  seed.ts                System data only — idempotent, never touches business data
scripts/
  sample-data.ts         Dev convenience: plausible Partners and a Chart of Accounts
                         to test against. **Not** the seeder — ordinary inserts,
                         run by hand, never by install/migrate/reset/CI
src/
  proxy.ts               Optimistic redirect to /login (NOT a security boundary)
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
      budget/budget/     Bespoke, not registry: month list, /month/[period],
                         /new, /[id], /[id]/edit
      finance/cash-bank-transaction/  Bespoke: list, /new, /[id], /[id]/edit
      finance/report/[report]/  Every Report View, driven by `reports.ts`
      settings/user/     Admin-only user management (bespoke, not registry)
      settings/role/     Admin-only roles + permission matrix
      settings/system-default/  Values the application prefills with
      settings/profile/  Own account — authentication only, no permission
    actions/
      master.ts          Master module writes
      budget.ts          Budget writes: create, edit, lifecycle transitions
      finance.ts         Cash Bank Transaction writes, plus Post
      fiscal.ts          The Fiscal Year lifecycle — the one way out of Draft
      settings.ts        System Default writes
      auth.ts            login / logout
      users.ts           User and role administration
      profile.ts         Own profile and password
  components/
    icon.tsx             <Icon name size /> renderer
    icon-paths.ts        SVG path map
    shell/               App shell
    master/              entity-pages (the four shared pages), EntityList,
                         AccountTree, EntityForm, CashBankBook, recordTitle
    budget/              BudgetMonthList, BudgetList, BudgetForm,
                         ApproveDialog, ReportPicker, CashBalanceDialog,
                         RealizationCard
    finance/             TransactionList, TransactionForm, BudgetPicker
    report/              ReportView chrome, ReportParams, and the two report
                         bodies (Cash Bank Ledger, Cash Bank Balance)
    settings/            UserList, UserForm, RoleList, RoleForm, ProfileView
    auth/                LoginForm, AccessDenied
    accounting/          FiscalPeriods (shown inside a Fiscal Year)
    ui/                  Combobox, Select, DateInput, ConfirmDialog, ToastProvider
  lib/
    prisma.ts            Client singleton with adapter; the cache is keyed on the
                         generated class, so `prisma generate` retires it (§12)
    format.ts            Date/number/money formatting (UTC-based)
    siba/                entities, nav, rules, records, users, account-code,
                         permissions, roles, access, auth, auth-errors,
                         session, login, user-admin, profile, entity-access, fiscal,
                         fiscal-workflow, budget, budget-workflow, cash-bank,
                         finance, transaction-workflow, reports,
                         system-defaults, system-settings
  generated/prisma/      Prisma client output — gitignored, never edit
tests/                   Security, Accounting, Budget, Finance, Cash Bank Book, reports,
                         fiscal, settings and schema suites (node:test); helpers.ts
                         builds and cleans up its own business fixtures
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
npm run lint                 # ESLint
npm test                     # test suite — needs a migrated, seeded database
npm run db:seed              # sync system data; idempotent, destroys nothing
npm run db:sample            # dev only: sample Partners + Chart of Accounts (NOT the seeder)
npm run db:reset             # DESTRUCTIVE: drop, re-migrate, reseed
npx prisma generate          # regenerate client after schema changes
npx prisma migrate dev       # create + apply a migration
npx prisma studio            # browse the database
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
The reports suite holds the one property a money report lives or dies by —
`opening + in − out = closing` — pushed at from the edges: entries dated exactly on each
boundary, entries before the period folding into the opening rather than appearing as
rows, a period with no movement still answering with its balances, a deactivated resource
that still moved money staying visible, and the two reports agreeing with each other for
the same subject and period. It also pins the navigation change the report routes needed,
so `/master/partner/12` and `/budget/budget/month/5` cannot silently stop resolving.
The fiscal suite also holds the Fiscal Year lifecycle —
that `status` is not an isian, that Draft is the only status a year opens from, and
that nothing writes Draft or Closed — and the settings suite holds what a System
Default may do: a key outside the catalogue is never written, and a deactivated
Currency is stored but never prefilled. A schema suite closes the loop underneath all of
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
| Layout | Topbar → icon rail → collapsible submenu → content. Shell owns it. |
| Page header | `.ph` → `.crumb`, `.ph-row` (h1 + `.ph-act`), `.ph-sub`. **Sticky**, and `.ph-act` is where every action on the page lives |
| Cards | `.card` + `.card-h` (icon `.ci`, title `.ct`) |
| Tables | `.tw` wrapper → `table.grid`; sortable `th.srt`; `.pri` `.mut` `.num` cells |
| Identity cells | `.idc` = `.lab` code chip + `.nm` name |
| Status | `.bdg` + `s-ok` / `s-bad` / `s-warn` / `s-info` / `s-mute` |
| Tags | `.bdg` + `t-info` / `t-vio` / `t-acc` / `t-slate` |
| Forms | `.fgrid` (form + summary side card) → `.fsec` → `.sec-t` → `.frow` → `.fld` |
| Read-only fields | `.ro` — presented as text, **never disabled inputs** |
| FK pickers | `Combobox` — searchable, `CODE – Name` options |
| Dropdowns | `Select` — **never a native `<select>`**; `variant` picks the trigger class (`field` / `toolbar` / `compact` / `ctx`) |
| Dates | `DateInput` — **never `<input type="date">`**; types and shows `dd/mm/yyyy`, opens the app's own calendar |
| Validation | Inline `.err` under the field + `.bad` on the control + error toast |
| Unsaved changes | `.ph-dirty` chip with pulse indicator, in `.ph-act` beside Simpan |
| Confirmations | `ConfirmDialog` — tinted icon, subject chip, **consequence copy** |
| Feedback | Toasts via `useToast()` |
| Empty states | `.empty` — icon, heading, explanation, CTA only when the user can act |
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
| Exchange rates | `Decimal @db.Decimal(18, 6)` |
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

**Money in different currencies is never added together.** There is no
authoritative exchange-rate source in the system, so totals are reported per
currency (`MoneyTotal[]` and `formatTotals` in `src/lib/format.ts`). Do not
reintroduce a conversion constant — see §12.

**Migrations:** always `npx prisma migrate dev`. Never hand-edit an applied migration.
Never use `prisma db push` on this project.

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
8. **Account numbers** are unique per company, not globally (`@@unique([company_id, account_label])`).
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
30. **Money is totalled per currency, never converted.** No exchange rate exists in the
    system, so a figure spanning currencies is reported as a list, not a sum — §12.
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
    Partner × Cash & Bank is the context (concept doc §9). A Budget is eligible only
    when it is Open, belongs to that Company, points the way the Purpose does, carries
    the Budget Category the Purpose resolves to, names that Partner where the Purpose
    takes one, is denominated in the Cash & Bank's own currency, and still has
    outstanding. **Budget Date is not a criterion** — the distance between plan and
    execution is a report, not a gate. `eligibleBudgets` and `checkLines` in
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
38. **Cash Bank Transaction is induk-only, for now.** The header is pinned to the
    `is_parent = true` company and the Server Action refuses any other. The anak's
    realization goes through the Funding Request flow, which is not built — §12, §13.
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

19. **22 transaction purposes.** A purpose is exactly one budget category × one partner
    category × one direction, which is what lets it resolve to a single account. It is
    the field a Cash Bank Transaction's header starts from, and it decides the
    document's direction, its Budget Category, and whether a Partner is required.
    Purposes are **application logic, never a master table** — see §12.

Specified in the concept doc, **not yet implemented** (see §13):

21. Post fans out into the cash/bank ledger, subject ledgers, and Journal → General
    Ledger. **The cash/bank half is built**: `applyPosting` calls
    `recordCashBankEntry` and does not build a book of its own. The subject ledgers
    (Prive / Titipan / Hutang / Piutang) and the Journal are still to come, and they
    are added alongside that call rather than replacing it.
22. Operational books are independent append-only stores — **never** views over
    journal lines. Only the General Ledger derives from journals. `cash_bank_ledger`
    is built this way already.
23. The child company's realization emits a Funding Request; the parent confirms it and
    one atomic event produces two journals linked by an Intercompany Event.
24. No partial funding: realization = request = funding amount.

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
  `scripts/sample-data.ts` (`npm run db:sample`) inserts six generic Partners
  and a full Chart of Accounts for both Companies, so a developer has something
  to test against. It is deliberately *not* part of the seed, is never run by
  install, migrate, reset or CI, and writes ordinary records — composed account
  numbers, audit entries, editable through the GUI. It reuses anything already
  present rather than overwriting it, and deletes nothing.
- **The seed is also idempotent and non-destructive.** It creates what is missing and
  leaves everything else alone, so it is safe to run against a live database and is
  how a newly added permission reaches it. The one exception is the permission
  catalogue, which is re-synced from code because code is its source of truth.
  `npm run db:reset` is the separate, explicitly destructive path.
- **Do not change unless:** explicitly instructed. **Never add business data to the
  seed, and never add a delete step to it.**
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
- **Impact:** A new page gets its buttons in `.ph-act` and nowhere else. The
  sticky rule is scoped `.pad >` **deliberately**: `.ph` is also the
  placeholder class inside `Combobox` and `Select`, and a bare `.ph` rule would
  make every placeholder in the app sticky. Page headers are always a direct
  child of `.pad`, so the selector is exact. `z-index: 30` puts the header over
  a table's own sticky `thead` (3) and the report criteria bar (20), under the
  topbar (40). The header costs about 100px of a scrolling viewport, which is
  the price of the actions always being reachable.
- **Do not change unless:** explicitly instructed. **Never add a button bar at
  the bottom of a form**, and never widen the sticky rule to a bare `.ph`.
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

### No API layer
- **Decision:** Server Components read; Server Actions write. No REST/GraphQL.
- **Reason:** No external consumer exists; an API layer for ~15 CRUD entities is overhead.
- **Do not change unless:** an external consumer appears.

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

### Transaction purposes stay application logic
- **Decision:** The 22 purposes live in `src/lib/siba/rules.ts` as typed constants plus
  helper functions. **Do not create a `fin_purpose` master/config table.**
- **Reason:** Each purpose carries behaviour a generic table cannot express — purpose
  category, whether a partner is required, document/reference requirements, and
  transaction-specific rules. Application logic decides required fields and behaviour.
- **Impact:** `fin_cash_bank_transaction.purpose` stays a string key resolved in code.
- **Do not change unless:** explicitly instructed. This supersedes the mockup's own
  suggestion of a `fin_purpose` table.
- **Status:** Frozen, current.

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
- **Impact:** `Open` is a one-way door: no transition produces `Draft` or `Closed`.
  The detail header carries the lifecycle buttons through `EntityForm`'s
  `headerActions` slot — the registry describes fields, not lifecycles, so the escape
  hatch is a slot rather than a config key nothing else would use.
- **Closing is deliberately not built.** The header shows a disabled *Tutup Tahun
  Buku* explaining that closing is a process of its own, and the catalogue carries
  **no** `FISCAL_YEAR_CLOSE`: a capability is a catalogue entry first (§12, "The
  permission catalogue lives in code"). Real closing locks periods against posting and
  belongs with the journal and the general ledger (§13).
- **Do not change unless:** explicitly instructed. **Never make `status` an editable
  field again, never add a transition back to Draft, and do not add a
  `FISCAL_YEAR_CLOSE` permission without building the closing process in the same
  change.**
- **Status:** Frozen, current.

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
- **Do not change unless:** explicitly instructed. **Never let a default decide what is
  valid, never apply one to an existing record, and do not add a UI for creating
  setting keys** — the catalogue is code.
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
  `<select>` or date input, and never format a date outside `formatDate`.**
- **Status:** Frozen, current.

### Amounts are never converted between currencies (FROZEN)
- **Decision:** There is no exchange rate anywhere in the application. The hardcoded
  `RATES` constant is gone. Money is totalled per currency — `MoneyTotal[]` and
  `formatTotals` in `src/lib/format.ts` — and rendered side by side (`Rp 45.000.000 ·
  USD 3.500,00`).
- **Reason:** The user confirmed a real rate source is coming in a later update. Until
  it exists, any conversion is a fabricated number presented as a fact, and a budget
  KPI or a submission report built on one is worse than no figure at all.
- **Impact:** Budget KPIs, the Budget Month rollup, the submission report recap and the
  cash balance card all report per currency. When the rate source arrives, conversion
  is added on top of `MoneyTotal[]` — the per-currency figures stay.
- **Do not change unless:** the real rate source lands. **Do not reintroduce a
  conversion constant, and do not create an exchange-rate master table** (§13).
- **Status:** Frozen, current.

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
  `src/lib/siba/reports.ts`; one route — `finance/report/[report]` — resolves the entry,
  checks its permission and parses its parameters; `components/report/report-view.tsx`
  carries the chrome; only the body differs per report. Ten rules define the type:

  1. **Parameters live in the URL.** `?cashBank=12&from=…&to=…`. A run is therefore
     linkable, bookmarkable and back-button-able, and the page stays a Server Component
     that queries directly (§3) instead of fetching from the client.
  2. **Parameter bar on top, restated on the output.** The `.critbar` repeats the
     subject, the period and the run timestamp. This is the one thing that separates a
     report from a list page.
  3. **The subject is explicit.** For these two it is always a Cash & Bank resource.
  4. **It reconciles on the page** — see §10 rule 40, and the no-type-filter rule that
     follows from it.
  5. **Empty is not zero.** A period with no movement still reports its opening and
     closing. An empty state means "no subject chosen yet", which is a different screen.
  6. **Read-only, always.**
  7. **Drill-through downward.** A summary row links to the detail report for the same
     parameters, so a figure is one click from the rows that produced it.
  8. **Money is grouped per currency, never converted** (§12, amounts are never
     converted).
  9. **No new CSS.** The convention is a composition of classes the design system
     already has — `.ph`, `.toolbar`, `.critbar`, `table.rcp`, `.cblock`/`.cbh`,
     `table.grid`, `.totrow`, `.foot-note`, `.empty`. The "Laporan Pengajuan" modal is
     where that vocabulary came from.
  10. **Export belongs in `.ph-act`.** The slot exists and is empty; print and XLSX are
      deferred, and adding them later changes no layout.

- **Reason:** Reports are the bulk of what the Journal, the General Ledger and the
  subject ledgers will add, and a report invented per screen would produce a different
  answer to "what period is this?" on every page. Settling the type once, while there
  were only two, is far cheaper than reconciling six later.
- **Impact:** Adding a report is a `reports.ts` entry, a permission, a nav entry and a
  body component — no new route file and no new CSS. Permissions are named
  `REPORT_<SUBJECT>_VIEW`, prefix-first like `MENU_<AREA>_ACCESS` (§12). Report slugs
  live under a `report/` namespace, which is why `resolvePath` matches the whole path
  tail against entity slugs, longest match first.
- **Do not change unless:** explicitly instructed. **Never let a Report View write**,
  never add a filter that breaks a money report's own arithmetic, and do not build a
  generic report engine — the catalogue and the chrome are shared, the bodies are not.
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
  no balance, no `realized_amount`, not even a document date. `applyPosting` in
  `src/lib/siba/finance.ts` is the single place money moves, and it writes the Cash
  Bank Book entry (through `recordCashBankEntry`), its materialised balance, every
  Budget's realization, and the document's own dates inside **one** `prisma.$transaction`.
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
- **The Journal is deliberately absent.** The book is written **straight from the
  document**, never derived from a journal line: operational books are independent
  historical stores and only the General Ledger derives from journals (§2.5, §11.7).
  When the Journal and the subject ledgers land they are added *alongside* that call.
- **Do not change unless:** explicitly instructed. **Never split Post into separate
  writes, never let a Draft touch a balance, and never derive the Cash Bank Book from a
  journal line.**
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

### Cash Bank Transaction is induk-only until Funding Request exists
- **Decision:** The document's Company is pinned to the induk — resolved at runtime
  from `is_parent = true` by `transactingCompany()` — shown as a locked field, and
  `checkHeader` refuses any other Company outright. The refusal says where the anak's
  realization actually goes.
- **Reason:** In this model the anak does not spend directly: it raises a **Funding
  Request** against the induk, and the induk's confirmation produces the two linked
  journals (concept doc §23–§24). That flow is the next scope. Until it exists, a
  document naming the anak would be a way to spend money the model says the anak cannot
  spend, so the scope is imposed rather than left to the user.
- **Impact:** One named check, in one place, so lifting it when Funding Request lands is
  a single change rather than a hunt. The company picker is not a picker at all, which
  also removes a choice that currently has exactly one answer.
- **Do not change unless:** the Funding Request flow is built (§13) — and then the anak
  reaches Finance **through that flow**, not by unpinning this field. **Do not**
  generalise this into a configurable per-company switch (§12, two-company structure).
- **Status:** Current, scoped.

### Finance is bespoke, and its base-amount columns are placeholders
- **Decision:** Cash Bank Transaction has its own routes under
  `/finance/cash-bank-transaction`, its own data module (`lib/siba/finance.ts`), its own
  actions and its own components. It is **not** in `entities.ts`, and `entity-access.ts`
  has no `fin_cash_bank_transaction` row. Authorization runs through
  `transactionAbilities()` against the same catalogue.
- **Reason:** The registry expresses fields, columns and an active/inactive toggle. This
  is a document with a header that filters its own child table, a lifecycle, and a Post
  that writes three tables — precisely the escape hatch the registry decision
  anticipated, and the one User, Role and Budget already took.
- **`exchange_rate`, `transaction_base_amount` and `settlement_base_amount` are written
  as the identity**: rate `1`, base = amount. There is no exchange rate anywhere in this
  system (§12, "Amounts are never converted"), so nothing reads or displays these
  columns; they exist because the schema carries what the real rate source will one day
  fill. A document can only settle a Budget in the Cash & Bank's own currency, which is
  why the identity is honest rather than a fabricated conversion.
- **Do not change unless:** explicitly instructed. **Do not display a base amount, and
  do not put a conversion constant in these columns** — when the rate source lands, it
  fills them.
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
| Posting engine — the rest | Post already writes the Cash Bank Book and Budget realization. Still to come, added *alongside* that call and never derived from it: the subject ledgers (Prive / Titipan / Hutang / Piutang) and the Journal → General Ledger |
| Exchange rate | A real rate source, arriving in a later update. **Do not create a standalone exchange-rate master table, and do not reintroduce a hardcoded rate in the meantime** — §12 |
| Submission report export | Write the XLSX for "Laporan Pengajuan"; the picker and its recap are already built |
| Report output | A print sheet and an export for Report Views. Both land in the `.ph-act` slot the convention already reserves, and the print half means finally defining the `.psheet` / `.ps-doc` / `.ps-tb` classes `globals.css` references but never declared |
| `Transfer` transaction type | Extend the transaction-type enum, UI and logic. Note `transaction_type` currently shares the `FlowDirection` enum with `budget_type`, so this likely needs a separate enum rather than a third member |
| Fiscal Year closing | The closing process that moves a year Open → Closed, locking its periods against posting. Belongs with the journal and the general ledger. **Add `FISCAL_YEAR_CLOSE` to the catalogue in the same change that builds it, never before** — §12 |
| Opening Balance | `acc_opening_balance(_line)` tables and UI — the accounting opening balance per account, distinct from a cash resource's opening entry, which already exists |
| Funding Request | `fin_funding_request` + the atomic two-company posting and Intercompany Event. This is how the **anak** realizes anything: Cash Bank Transaction is pinned to the induk until it exists (§12) |

**Exchange rate — current state.** There is none, deliberately. Every total is
reported per currency instead (§12). When the real source arrives, conversion is
layered on top of `MoneyTotal[]`; the per-currency figures stay.

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
- Do **not** create a `fin_purpose` table, an exchange-rate master, or a Budget Month table.
  Budget Month is a date-range query over `acc_fiscal_period`; do not add a month column
  to `bud_budget` either.
- Do **not** add a Budget Close or Budget Delete action, or move Budget into the entity
  registry. The lifecycle is create → approve and lives in `budget-workflow.ts`; a
  Budget reaches `Closed` only as a consequence of posting (§12).
- Do **not** let a budget be edited outside Draft and Rejected, and do **not** let
  `category_id` or `partner_id` be set anywhere but approval.
- Do **not** add a balance column to `m_cash_bank` or any other master table, and do
  **not** compute a balance anywhere but `src/lib/siba/cash-bank.ts` (§9, §12).
- Do **not** add an update or delete path to `cash_bank_ledger`. The book is
  append-only; a correction is a further entry.
- Do **not** reintroduce a hardcoded exchange rate, and do **not** sum amounts across
  currencies. Totals are reported per currency until a real rate source exists (§12).
- Do **not** put business data in `prisma/seed.ts`, and do **not** add a delete step to
  it. It syncs system data and nothing else (§12).
- Do **not** use a native `<select>` or `<input type="date">`. Use `Select` and
  `DateInput` from `components/ui/` — the OS draws neither of those (§12).
- Do **not** format a date anywhere but `formatDate`. Every date reads `dd/mm/yyyy`.
- Do **not** give Fiscal Period a menu entry, a route, a registry config, or
  permissions, and do **not** let a period's dates be edited by hand. Periods are
  generated when a Fiscal Year is activated (§12).
- Do **not** make a Fiscal Year's `status` an editable field, add a transition back to
  Draft, or add a `FISCAL_YEAR_CLOSE` permission without building the closing process
  in the same change (§12).
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
- Do **not** unpin the Cash Bank Transaction's Company from the induk; the anak reaches
  Finance through Funding Request, not by widening this document (§12).
- Do **not** display or populate `transaction_base_amount` / `settlement_base_amount`
  with a conversion — they are the identity until a real rate source lands (§12).
- Do **not** add a `BUDGET_CLOSE` permission or a close action; a Budget closes when
  realization reaches its planned amount, as a consequence of posting (§12).
- Do **not** let a Report View write anything, and do **not** give one a row action
  that mutates. A report reports (§10, §12).
- Do **not** add a filter that breaks a money report's own arithmetic — no entry-type
  filter on the Cash Bank Ledger (§10, §12).
- Do **not** invent a new report screen shape or new report CSS; extend the Report View
  convention instead, and do **not** build a generic report engine (§12).
- Do **not** re-embed the Cash Bank Book under the Cash & Bank master record. The
  master links into the report (§12).
- Do **not** put a form's buttons anywhere but `.ph-act`, and do **not**
  reintroduce a bottom action bar (§8, §12).
- Do **not** write a bare `.ph` CSS rule — it is the Combobox and Select
  placeholder class as well as the page header. Scope page-header rules to
  `.pad > .ph` (§12).
- Do **not** let an account number be typed whole, renumbered, or moved to a
  different parent. A code is composed from its lineage and frozen once saved
  (§10, §12).
- Do **not** seed accounts. The seeded skeleton stops at Account Subcategory
  (depth 3); depth 4 and below is the user's chart (§12).
- Do **not** replace `CASH_BANK_SUBCATEGORY` with a list of account names or a
  setting. Kelompok `1.1.1` is the anchor (§12).
- Do **not** edit `src/generated/prisma/` — regenerate it.
- Do **not** rewrite `globals.css` or introduce a utility CSS framework.
- Do **not** rename Prisma fields to camelCase.
- Do **not** build the Journal, the General Ledger, the subject ledgers or the Funding
  Request flow without explicit instruction (§13).
- Do **not** add an API route layer for internal CRUD.
- Do **not** hand-edit applied migrations or use `prisma db push`.
- Do **not** run `npm run db:reset` against data the user cares about — it drops the
  database. `npm run db:seed` is the safe one and destroys nothing.
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
| Company context selector is inert | The topbar dropdown is local state and filters nothing. `Entity.scope` exists in the registry but is unused. |
| Audit log shows raw table keys | Dashboard renders `m_partner` rather than `Partner / Cabang Medan`; needs entity display names + record lookup. (The author column resolves correctly.) |
| Budget report has no export | The picker is complete; "Unduh XLSX" is disabled by agreement (§12). |
| The Cash Bank Book has no UI write path of its own | Entries are created by registering a resource with an opening balance, or by posting a Cash Bank Transaction. There is deliberately no manual entry form and no `Adjustment` path yet — so an `Adjustment` entry can exist in the book but cannot be made through the application. |
| Reports are on-screen only | No print stylesheet and no export. `globals.css` still carries an `@media print` block referencing `.psheet` / `.ps-doc` / `.ps-tb`, which have never been defined — dead until a print sheet is built. The `.ph-act` slot on every Report View is where those buttons go. |
| A report has no pagination | The period is the only control on size. Fine for a month of one resource's book; a year of a busy account will render every row. |
| A posted document produces no Journal | Post writes the Cash Bank Book and Budget realization only. The Journal, the General Ledger and the subject ledgers are the next scope (§13), so a posted document is not yet reflected in accounting. |
| The Finance list is not Company-scoped | Every document belongs to the induk today, so the topbar Company selector would filter nothing. This becomes real when Funding Request brings the anak into the picture. |
| `zod` unused | Installed; validation is hand-written in the services. |
| Tests cover security, Accounting, Budget, Finance, the Cash Bank Book, the reports and the fiscal calendar | No tests for the Master module's own write path or the registry forms. The Server Actions' own bodies are covered structurally only — a test process has no session, so the rules they delegate to are what the suites call. |
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
