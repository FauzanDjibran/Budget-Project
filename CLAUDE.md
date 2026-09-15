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
  and the Cash Bank Book (`cash_bank_ledger` / `cash_bank_balance`).
- **Not yet built** — the posting engine (Journal, General Ledger, and the Prive /
  Titipan / Hutang / Piutang books), Opening Balance, and the intercompany Funding
  Request flow. Full list in §13.

### Current status

| Area | State |
| --- | --- |
| Scaffold, DB, migration | Done |
| Seed | Done — **system data only**, idempotent, destroys nothing (§12) |
| Cash Bank Book | Done — append-only `cash_bank_ledger` plus materialised `cash_bank_balance`; opening balance entered when a resource is registered |
| Design system port | Done |
| App shell (topbar, rail, submenu) | Done |
| Dashboard | Done |
| Master module (Partner, Cash & Bank, Currency) | Done — list, detail, create, edit, status toggle |
| Company master | List + detail done. Create and edit are locked at both the routes and the Server Actions. |
| Accounting module (COA tree, mapping, fiscal year/period) | Done — registry-driven, with Chart of Accounts rendered as a tree |
| Budget module | Done for create → approve — Budget Month, Budget list, create/edit, and the Draft → Submit → Approve/Reject lifecycle. Bespoke, not registry-driven. |
| Finance module | Not started |
| Authentication | Done — email/password, database-backed sessions, login/logout |
| Authorization (RBAC) | Done — permission catalogue, roles, server-side enforcement on every route and action |
| User & role management, profile | Done — Admin-only user/role administration; own profile for everyone |
| Tests | Security suite plus the Accounting, Budget and Cash Bank Book enforcement points, via `node:test` (`npm test`). Business fixtures are created by the tests, not by the seed. |

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
| Budget lifecycle | `src/lib/siba/budget-workflow.ts` | The transition table — from-status, to-status, permission; client-safe |
| Budget data | `src/lib/siba/budget.ts` | Month rollups, budget reads, classification enforcement, `BGT-` numbering; `server-only` |
| Cash Bank Book | `src/lib/siba/cash-bank.ts` | Append-only ledger writes, the materialised balance, `CBL-` numbering, per-currency summary; `server-only` |
| Write path | `src/app/actions/master.ts` | Validation, create, update, status toggle, audit |
| Budget writes | `src/app/actions/budget.ts` | Create, edit, and the lifecycle transitions |
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
      accounting/[entity]/ The same four registry pages — COA, mapping, fiscal
      budget/budget/     Bespoke, not registry: month list, /month/[period],
                         /new, /[id], /[id]/edit
      settings/user/     Admin-only user management (bespoke, not registry)
      settings/role/     Admin-only roles + permission matrix
      settings/profile/  Own account — authentication only, no permission
    actions/
      master.ts          Master module writes
      budget.ts          Budget writes: create, edit, lifecycle transitions
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
                         ApproveDialog, ReportPicker, CashBalanceDialog
    settings/            UserList, UserForm, RoleList, RoleForm, ProfileView
    auth/                LoginForm, AccessDenied
    ui/                  Combobox, ConfirmDialog, ToastProvider
  lib/
    prisma.ts            Client singleton with adapter + dev hot-reload guard
    format.ts            Date/number/money formatting (UTC-based)
    siba/                entities, nav, rules, records, users,
                         permissions, roles, access, auth, auth-errors,
                         session, login, user-admin, profile, entity-access,
                         budget, budget-workflow, cash-bank
  generated/prisma/      Prisma client output — gitignored, never edit
tests/                   Security, Accounting, Budget and Cash Bank Book suites (node:test);
                         helpers.ts builds and cleans up its own business fixtures
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

**Tests cover the security paths, plus the Accounting and Budget enforcement points.**
`npm test` runs `tests/*.test.ts` against a real, seeded database — authentication,
sessions, RBAC, the admin protections, a structural audit that every Server Action
resolves its caller before acting, the rules that decide which account a Cash & Bank
resource may post to, whether a parent account would close a loop, and which Partner
Categories a Budget Category admits, and the Budget lifecycle: which transition is
legal from which status, that approval's classification satisfies the whole
category → partner-category → partner chain, and that Budget Month stays derived
(no table, no month column). Everything else is untested, so "validate" still means
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
| Page header | `.ph` → `.crumb`, `.ph-row` (h1 + `.ph-act`), `.ph-sub` |
| Cards | `.card` + `.card-h` (icon `.ci`, title `.ct`) |
| Tables | `.tw` wrapper → `table.grid`; sortable `th.srt`; `.pri` `.mut` `.num` cells |
| Identity cells | `.idc` = `.lab` code chip + `.nm` name |
| Status | `.bdg` + `s-ok` / `s-bad` / `s-warn` / `s-info` / `s-mute` |
| Tags | `.bdg` + `t-info` / `t-vio` / `t-acc` / `t-slate` |
| Forms | `.fgrid` (form + summary side card) → `.fsec` → `.sec-t` → `.frow` → `.fld` |
| Read-only fields | `.ro` — presented as text, **never disabled inputs** |
| FK pickers | `Combobox` — searchable, `CODE – Name` options |
| Validation | Inline `.err` under the field + `.bad` on the control + error toast |
| Unsaved changes | Sticky `.dirty` bar with pulse indicator |
| Confirmations | `ConfirmDialog` — tinted icon, subject chip, **consequence copy** |
| Feedback | Toasts via `useToast()` |
| Empty states | `.empty` — icon, heading, explanation, CTA only when the user can act |
| Responsive | Desktop-first. `.fgrid` collapses at 1320px, `.frow` at 1000px, nav at 860px. |

**Anti-patterns explicitly rejected** (from `akui_proto_ui_reference.md`, its §9 and §11):

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
| Calendar dates | `@db.Date`, stored at UTC midnight — format via `src/lib/format.ts`, which reads UTC parts |
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
   by the same company, `is_postable`, in the `Kas` or `Bank` subcategory, and active.
   All four conditions are one check — `checkCashBankAccount` in `records.ts` — called
   by the Server Action. The picker offers the same set, but the check is what enforces
   it: the action is reachable directly, with any account id.
4. **The connection holds in both directions.** An account a cash/bank resource already
   posts to cannot then be made non-postable, moved out of the `Kas`/`Bank` groups, or
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
17. **A fiscal period lives inside its year.** Both dates fall within the Fiscal Year's
   range, the end is not before the start, and the sequence number is unique within the
   year — otherwise a posting date could belong to two books, or to none.

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

Defined in `rules.ts`, not yet exercised by UI:

19. **22 transaction purposes.** A purpose is exactly one budget category × one partner
    category × one direction, which is what lets it resolve to a single account.
    Purposes are **application logic, never a master table** — see §12.

Specified in the concept doc, **not yet implemented** (see §13):

21. Post fans out into the cash/bank ledger, subject ledgers, and Journal → General Ledger.
    The cash/bank half of this already exists: the posting engine calls
    `recordCashBankEntry`, it does not build its own book.
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

### Prisma 7 requires a driver adapter
- **Decision:** Clients are constructed with `new PrismaPg({ connectionString })`.
- **Reason:** Prisma 7 removed the bundled engine connection path.
- **Impact:** `new PrismaClient()` without an adapter throws at runtime. Applies to the app
  singleton and any script, including the seed.
- **Do not change unless:** upgrading Prisma changes the contract.

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
- **Impact:** Matches the mockup, which treats Budget Month as virtual. Implemented as
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

### Budget Close and Delete are deliberately absent
- **Decision:** The module ships create → approve. There is no "Tutup budget" and no
  delete, even though the mockup's row menu offers both.
- **Reason:** Confirmed with the user when the module was built. Closing belongs to
  realization — nothing can realize a budget until the Finance module exists — and the
  permission catalogue carries neither `BUDGET_CLOSE` nor `BUDGET_DELETE`. A capability
  is a catalogue entry first (§12, "The permission catalogue lives in code").
- **Impact:** `Closed` remains a valid status because the list renders it, but
  nothing in the application produces it yet. A test asserts the
  transition table holds exactly submit / approve / reject / cancel.
- **Do not change unless:** explicitly instructed — and then add the catalogue entry
  and reseed in the same change.
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
| Finance module | Cash bank transactions: draft, edit, cancel, and Post |
| Posting engine | On Post, one event writes the Cash Bank Book (via `recordCashBankEntry` — the book already exists), the subject ledgers (Prive / Titipan / Hutang / Piutang) and the Journal → General Ledger, in parallel |
| Budget realization | `bud_budget.realized_amount` is written by a posted transaction settling the budget. Nothing writes it today |
| Exchange rate | A real rate source, arriving in a later update. **Do not create a standalone exchange-rate master table, and do not reintroduce a hardcoded rate in the meantime** — §12 |
| Submission report export | Write the XLSX for "Laporan Pengajuan"; the picker and its recap are already built |
| `Transfer` transaction type | Extend the transaction-type enum, UI and logic. Note `transaction_type` currently shares the `FlowDirection` enum with `budget_type`, so this likely needs a separate enum rather than a third member |
| Opening Balance | `acc_opening_balance(_line)` tables and UI — the accounting opening balance per account, distinct from a cash resource's opening entry, which already exists |
| Funding Request | `fin_funding_request` + the atomic two-company posting and Intercompany Event |

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
  registry. The lifecycle is create → approve and lives in `budget-workflow.ts`.
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
- Do **not** edit `src/generated/prisma/` — regenerate it.
- Do **not** rewrite `globals.css` or introduce a utility CSS framework.
- Do **not** rename Prisma fields to camelCase.
- Do **not** build the Finance module, the posting engine or the Funding Request flow
  without explicit instruction (§13).
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
| Budget realization is inert | Nothing writes `realized_amount` until the Finance module exists, so the "Belum Direalisasi" KPI reads as the full amount of every approved budget. |
| Budget report has no export | The picker is complete; "Unduh XLSX" is disabled by agreement (§12). |
| The Cash Bank Book has no UI write path of its own | Entries are created by registering a resource with an opening balance, and — once Finance exists — by posting. There is deliberately no manual entry form yet. |
| No fiscal-period generator | A fiscal year's twelve periods are created one at a time through the registry form. Workable but tedious on a fresh install. |
| `zod` unused | Installed; validation is hand-written in the services. |
| Tests cover security, Accounting, Budget and the Cash Bank Book | No tests for the Master module's own write path or the registry forms. |
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
