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
Indonesian for Indonesian accounting practice.

Governing principle from the concept doc:

> Budget plans → Finance executes → on Post, one business event writes to several
> **independent** books in parallel → those books reconcile against the General Ledger.

The project is a **conversion of a finished HTML prototype into a real app**. All
source material lives in `Initialization/` (committed, treated as read-only reference):

| File | Role |
| --- | --- |
| `Konsep SIBA 3.0 v3.md` | Concept / behaviour spec (42 sections) |
| `SIBA 3.0 DBML.txt` | Source database schema (MySQL-flavoured DBML, 19 tables) |
| `SIBA Mockup 2.0.html` | The mockup — a working ~4.7k-line JS SPA, not static HTML |
| `akui_proto_ui_reference.md` | UI/UX benchmark study that produced the mockup's design |

**Scope split (frozen — see §12):**

- **V1 (current)** — parity with `SIBA Mockup 2.0.html`: Master, Budget planning and
  approval, Finance execution through Post. Plus real authentication, which the
  mockup stubs out.
- **V2 (deferred)** — the posting engine (Journal, General Ledger, and the Cash Bank /
  Prive / Titipan / Hutang / Piutang books), Opening Balance, and the intercompany
  Funding Request flow. Full list in §13.

### Current status

| Area | State |
| --- | --- |
| Scaffold, DB, migration, seed | Done |
| Design system port | Done |
| App shell (topbar, rail, submenu) | Done |
| Dashboard | Done |
| Master module (Partner, Cash & Bank, Currency) | Done — list, detail, create, edit, status toggle |
| Company master | List + detail done. Create and edit are locked at both the routes and the Server Actions. |
| Accounting module (COA tree, mapping, fiscal period) | Not started |
| Budget module | Not started |
| Finance module | Not started |
| Authentication | Done — email/password, database-backed sessions, login/logout |
| Authorization (RBAC) | Done — permission catalogue, roles, server-side enforcement on every route and action |
| User & role management, profile | Done — Admin-only user/role administration; own profile for everyone |
| Tests | Security suite via `node:test` (`npm test`). No other tests. |

---

## 2. Core Principles

1. **The mockup drives the UI. The concept doc drives behaviour. The DBML drives the
   data model.** When they conflict, surface the conflict — do not silently pick one.
2. **V1 means mockup parity.** Do not build V2 features (journals, ledgers, funding
   requests) without explicit instruction.
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
| Business rules | `src/lib/siba/rules.ts` | Budget categories, 22 transaction purposes, FX rates |
| Permission catalogue | `src/lib/siba/permissions.ts` | Every capability in the system; client-safe |
| Seeded roles | `src/lib/siba/roles.ts` | ADMIN / STAFF and their grants |
| Authorization gate | `src/lib/siba/auth.ts` | `requireAuth`, `requirePermission`, `authorizeAction` |
| Access resolution | `src/lib/siba/access.ts` | User -> active roles -> permissions, read per request |
| Sessions | `src/lib/siba/session.ts` | Issue, validate, revoke; opaque token, SHA-256 at rest |
| Credentials | `src/lib/siba/login.ts` | bcrypt verification, password rules |
| User/role admin | `src/lib/siba/user-admin.ts` | Guarded service; all admin-protection rules |
| Own account | `src/lib/siba/profile.ts` | Profile read/edit, own password change |
| Entity permissions | `src/lib/siba/entity-access.ts` | Registry entity -> permission per operation |
| Data access | `src/lib/siba/records.ts` | Generic list/get/options/computed; `server-only` |
| Write path | `src/app/actions/master.ts` | Validation, create, update, status toggle, audit |
| Shell | `src/components/shell/app-shell.tsx` | Topbar, icon rail, collapsible submenu |
| Generic UI | `src/components/master/`, `src/components/ui/` | Table, form, combobox, dialog, toast |

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
  seed.ts                Mockup fixtures — the canonical "first initialization" data
src/
  proxy.ts               Optimistic redirect to /login (NOT a security boundary)
  app/
    layout.tsx           Root layout: fonts, metadata
    page.tsx             Sends a signed-in user to their first permitted page
    forbidden.tsx        403 outside the shell
    globals.css          Design system, lifted from the mockup (see §12)
    (auth)/login/        The only page reachable without a session
    (app)/               Route group carrying the shell
      layout.tsx         requireAuth + shell; nav filtered by permission
      forbidden.tsx      403 inside the shell — the refusal screen
      error.tsx          Generic failure screen (authz never lands here)
      dashboard/
      master/[entity]/   Dynamic: list, /new, /[id], /[id]/edit
      settings/user/     Admin-only user management (bespoke, not registry)
      settings/role/     Admin-only roles + permission matrix
      settings/profile/  Own account — authentication only, no permission
    actions/
      master.ts          Master module writes
      auth.ts            login / logout
      users.ts           User and role administration
      profile.ts         Own profile and password
  components/
    icon.tsx             <Icon name size /> renderer
    icon-paths.ts        SVG path map lifted from the mockup
    shell/               App shell
    master/              EntityList, EntityForm
    settings/            UserList, UserForm, RoleList, RoleForm, ProfileView
    auth/                LoginForm, AccessDenied
    ui/                  Combobox, ConfirmDialog, ToastProvider
  lib/
    prisma.ts            Client singleton with adapter + dev hot-reload guard
    format.ts            Date/number/money formatting (UTC-based)
    siba/                entities, nav, rules, records, users,
                         permissions, roles, access, auth, auth-errors,
                         session, login, user-admin, profile, entity-access
  generated/prisma/      Prisma client output — gitignored, never edit
tests/                   Security suite (node:test); helpers.ts holds fixtures
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
npm test                     # security suite — needs a seeded database
npm run db:seed              # wipe + reseed to the mockup baseline
npx prisma generate          # regenerate client after schema changes
npx prisma migrate dev       # create + apply a migration
npx prisma studio            # browse the database
```

**First-time setup:** install PostgreSQL, `cp .env.example .env`, set `DATABASE_URL`,
create the database (`createdb -U postgres siba30`), then `npx prisma migrate dev` and
`npm run db:seed`. Full instructions are in `README.md`.

**"Run SIBA"** — the `run-siba` skill (`.claude/skills/run-siba/`) does the whole
local bring-up: starts PostgreSQL, prepares `.env`, installs, generates the Prisma
client, migrates, seeds *only* when the database is empty, and leaves `npm run dev`
serving on port 3000. It refuses to run in a remote/cloud session, where `localhost`
is not the user's machine.

**Tests cover the security paths only.** `npm test` runs `tests/*.test.ts` against a
real, seeded database — authentication, sessions, RBAC, the admin protections, and a
structural audit that every Server Action resolves its caller before acting. Nothing
else has tests, so "validate" still means `npm run build`, `npm run lint`, `npm test`,
and exercising the feature in a browser. State plainly when something is unverified.

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

**`m_cash_bank.balance` is not authoritative.** It is a mock-only running balance carried
over for V1 parity and is read by nothing in the app. The real balance will come from
`cash_bank_ledger` / `cash_bank_balance` in V2, at which point this column is dropped.
Never treat it as the source of truth, and never add another running-balance field to a
master table.

**Migrations:** always `npx prisma migrate dev`. Never hand-edit an applied migration.
Never use `prisma db push` on this project.

**Seed:** `prisma/seed.ts` is the canonical first initialization — it mirrors the
mockup's fixtures exactly (2 companies, 10 partners, 4 cash/bank, 36 accounts, 26
mappings, 12 periods, 41 budgets, 8 transactions + 9 lines). It **deletes all data**
first and resets sequences. Keep it the source of truth for baseline data.

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

3. **Cash bank ↔ account ownership.** A cash/bank resource must post to an account
   owned by the same company. Enforced in `master.ts`, and the account picker filters
   by the chosen company.
4. **Cash/bank accounts.** Only `is_postable` accounts in the `Kas` or `Bank`
   subcategories may back a cash/bank resource.
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

Defined in `rules.ts`, not yet exercised by UI:

14. **Budget category → partner category → account.** Each budget category declares
   which partner categories are valid and which directions (In/Out) make sense.
   Direction follows balance-sheet logic, not cash direction.
15. **22 transaction purposes.** A purpose is exactly one budget category × one partner
    category × one direction, which is what lets it resolve to a single account.
    Purposes are **application logic, never a master table** — see §12.
16. **Budget Month is derived, not stored.** It groups budgets by `acc_fiscal_period`
    and has no independent lifecycle or table.

Specified in the concept doc, **not yet implemented** (V2 — see §13):

17. Post fans out into the cash/bank ledger, subject ledgers, and Journal → General Ledger.
18. Operational books are independent append-only stores — **never** views over
    journal lines. Only the General Ledger derives from journals.
19. The child company's realization emits a Funding Request; the parent confirms it and
    one atomic event produces two journals linked by an Intercompany Event.
20. No partial funding: realization = request = funding amount.

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
- Prisma parameterises queries; the one raw call (`$executeRawUnsafe` for sequence resets
  in the seed) takes no user input. Do not introduce raw SQL with interpolated user input.

## 12. Important Decisions / Frozen Decisions

### V1 = mockup parity
- **Decision:** V1 ships exactly what the mockup demonstrates, plus real auth. Journals,
  ledgers, opening balance and funding requests are V2.
- **Reason:** The concept doc's posting engine has no tables in the DBML and no UI in the
  mockup; designing it from prose belongs in its own scoped iteration.
- **Impact:** V2 tables are absent from the schema deliberately.
- **Do not change unless:** the user explicitly opens the V2 scope.

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
  dynamic (`/master/[entity]`).
- **Reason:** Mirrors the mockup's `ENTITIES` map; ~15 entities would otherwise be ~45 pages.
- **Impact:** Add an entity by adding config, not pages.
- **Do not change unless:** an entity needs behaviour the registry genuinely cannot express
  — then give that one a bespoke route and leave the registry intact.

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
  `m_cash_bank.balance`, `audit_log`, and dropped `acc_account.partner_type`.
- **Reason:** The DBML lacks columns the mockup demonstrably needs; the mockup annotates
  most of these itself.
- **Impact:** The DBML is reference, not gospel.
- **Caveat:** `m_cash_bank.balance` is the one addition with an expiry date — it is
  mock-only and gets dropped in V2. See §9.
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
  **Do not assume this becomes configurable in V2 or later.**
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

### Cash/bank balance is never stored on the master
- **Decision:** No running-balance field on `m_cash_bank`. Balance derives from
  `cash_bank_ledger` / `cash_bank_balance` once V2 lands; the existing mock-only
  `balance` column is dropped then.
- **Reason:** A stored master balance duplicates ledger truth and drifts from it.
- **Impact:** See §9. Nothing in the app reads the column today.
- **Do not change unless:** explicitly instructed.
- **Status:** Frozen. Column removal is a V2 task (§13).

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
- **Impact:** Matches the mockup, which treats Budget Month as virtual.
- **Do not change unless:** Budget Month gains real independent state.
- **Status:** Frozen, current.

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

## 13. V2 / Planned Changes

Deferred by design. Do not build these without explicit instruction, and do not make
V1 decisions that foreclose them.

| Item | Planned behaviour |
| --- | --- |
| Posting engine | On Post, one event writes the cash/bank ledger, the subject ledgers (Prive / Titipan / Hutang / Piutang) and the Journal → General Ledger, in parallel |
| `cash_bank_ledger` / `cash_bank_balance` | New tables; become the authoritative source of cash/bank balance |
| Drop `m_cash_bank.balance` | Remove the mock-only column once the ledger exists (§9) |
| Exchange rate | Move from the placeholder constants in `rules.ts` to deriving from `cash_bank_balance`. **Do not create a standalone exchange-rate master table.** |
| `Transfer` transaction type | Extend the transaction-type enum, UI and logic. Note `transaction_type` currently shares the `FlowDirection` enum with `budget_type`, so this likely needs a separate enum rather than a third member. Not part of the current MVP — do not force it in early. |
| Opening Balance | `acc_opening_balance(_line)` tables and UI |
| Funding Request | `fin_funding_request` + the atomic two-company posting and Intercompany Event |

**Exchange rate — current state.** `RATES` in `src/lib/siba/rules.ts` holds temporary
placeholder values (IDR / USD / SGD). This is a stopgap, **not** the intended
architecture. Keep using the placeholder until the V2 source exists; do not mistake it
for a finalised design and do not build a rate master.

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
- Do **not** store a running balance on `m_cash_bank` or any other master table.
- Do **not** edit `src/generated/prisma/` — regenerate it.
- Do **not** rewrite `globals.css` or introduce a utility CSS framework.
- Do **not** rename Prisma fields to camelCase.
- Do **not** build V2 features without explicit instruction.
- Do **not** add an API route layer for internal CRUD.
- Do **not** hand-edit applied migrations or use `prisma db push`.
- Do **not** run `npm run db:seed` against data the user cares about — it deletes everything.
  Ask first outside local development.
- Do **not** make operational books derive from journal lines (V2 constraint, but decide
  nothing now that forecloses it).
- Do **not** add dependencies without saying why; several installed ones are still unused.
- Do **not** refactor working modules while implementing an unrelated feature.
- Do **not** commit `.env` or any real credential.
- Do **not** claim a feature works without having exercised it — there are no tests to lean on.

---

## 15. Change Discipline

1. **Read before writing.** Inspect the mockup's implementation of a feature before
   building it; it is the specification. Its own comments flag what is mock-only.
2. **Smallest change that works.** No speculative abstraction.
3. **Reuse existing patterns** — registry config, Server Action shape, CSS classes.
4. **Keep commits small and per-feature**, with the established message style.
5. **Validate before reporting done:** `npm run build` (typechecks), `npm run lint`, and
   `npm test`. For UI work, exercise it in a browser; for write paths, verify the row in
   Postgres. Anything touching authentication or authorization needs a test in
   `tests/` — that is the one area with a suite, and it should stay that way.
6. **Report** files changed, what was verified, what was not, and anything unresolved.
7. **Surface conflicts** between the concept doc, the DBML and the mockup — do not
   resolve them silently.
8. **Restore the baseline** (`npm run db:seed`) after generating throwaway test data.

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
| Audit log shows raw table keys | Dashboard renders `m_partner` rather than the mockup's `Partner / Cabang Medan`; needs entity display names + record lookup. (The author column now resolves correctly.) |
| `m_cash_bank.balance` still present | Mock-only column, read by nothing in the app. Dropped in V2 (§13). |
| `zod` unused | Installed; validation is hand-written in the services. |
| Tests cover security only | No tests for the Master module or anything else. |
| `authInterrupts` is experimental | `next.config.ts` enables it so `forbidden()` returns a real 403 instead of a generic error. If a Next upgrade changes the API, the fallback is to render the refusal from each page instead. |
| Dashboard integrity checks reduced | Two of the mockup's checks (missing account, dangling FKs) were dropped — Postgres now makes them unrepresentable. This is intentional, recorded so it is not "restored" by mistake. |

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
logic, cash/bank balance, delete policy, exchange-rate placeholder, `Transfer`, Budget
Month, and keeping `Initialization/`.

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
