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
  Funding Request flow.

### Current status

| Area | State |
| --- | --- |
| Scaffold, DB, migration, seed | Done |
| Design system port | Done |
| App shell (topbar, rail, submenu) | Done |
| Dashboard | Done |
| Master module (Company, Partner, Cash & Bank, Currency) | Done — list, detail, create, edit, status toggle |
| Accounting module (COA tree, mapping, fiscal period) | Not started |
| Budget module | Not started |
| Finance module | Not started |
| Authentication | **Not started** — `next-auth` installed but unused |
| Tests | None — no test framework installed |

---

## 2. Core Principles

1. **The mockup drives the UI. The concept doc drives behaviour. The DBML drives the
   data model.** When they conflict, surface the conflict — do not silently pick one.
2. **V1 means mockup parity.** Do not build V2 features (journals, ledgers, funding
   requests) without explicit instruction.
3. **The design system is finished work.** Reuse its class names; do not restyle.
4. **Registry over pages.** New entities are added as config, not as new page files.
5. **Validate on the server.** Client-side checks are convenience, never the guarantee.
6. **Every write is audited.** Creates and updates append to `audit_log`.
7. **Indonesian UI, English code.** User-facing strings are Indonesian; identifiers,
   comments and commit messages are English.

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

### Major components

| Layer | Location | Responsibility |
| --- | --- | --- |
| Entity registry | `src/lib/siba/entities.ts` | Field + column config driving list, detail and form |
| Navigation model | `src/lib/siba/nav.ts` | Modules → groups → entities; rail and submenu |
| Business rules | `src/lib/siba/rules.ts` | Budget categories, 22 transaction purposes, FX rates |
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
| Auth | `next-auth` v5 beta — **installed, not wired** | |
| Validation | Hand-written in Server Actions; `zod` installed but **unused** | |
| Hashing | `bcryptjs` (seed only so far) | |
| Lint | ESLint 9 + `eslint-config-next` | |
| Seed runner | `tsx` | |
| Tests | **None configured** | |

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
  app/
    layout.tsx           Root layout: fonts, metadata
    page.tsx             Redirects to /dashboard
    globals.css          Design system, lifted from the mockup (see §12)
    (app)/               Route group carrying the shell
      layout.tsx         Shell + ToastProvider; fetches companies and user
      dashboard/
      master/[entity]/   Dynamic: list, /new, /[id], /[id]/edit
    actions/master.ts    Server Actions for the Master module
  components/
    icon.tsx             <Icon name size /> renderer
    icon-paths.ts        SVG path map lifted from the mockup
    shell/               App shell
    master/              EntityList, EntityForm
    ui/                  Combobox, ConfirmDialog, ToastProvider
  lib/
    prisma.ts            Client singleton with adapter + dev hot-reload guard
    format.ts            Date/number/money formatting (UTC-based)
    siba/                entities, nav, rules, records, users
  generated/prisma/      Prisma client output — gitignored, never edit
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
npm run db:seed              # wipe + reseed to the mockup baseline
npx prisma generate          # regenerate client after schema changes
npx prisma migrate dev       # create + apply a migration
npx prisma studio            # browse the database
```

**First-time setup:** install PostgreSQL, `cp .env.example .env`, set `DATABASE_URL`,
create the database (`createdb -U postgres siba30`), then `npx prisma migrate dev` and
`npm run db:seed`. Full instructions are in `README.md`.

**There is no test suite.** "Validate" currently means: `npm run build`, `npm run lint`,
and exercising the feature in a browser. State plainly when something is unverified.

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

**Anti-patterns explicitly rejected** (from the UI reference study, §9 and §11):

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
| System codes | `<prefix>.<4 digits>` — `comp.0001`, `part.0011`. Generated by `nextCode()`, never user-entered. |
| Document numbers | `BGT-0001`, `CBT-0001` |
| Audit | Every create/update appends to `audit_log` (`entity_key`, `row_id`, `action`, `by`, `at`) |

**Identity triple.** Master records carry three identifiers, and the distinction matters:

- `*_code` — system-generated, immutable, shown as a technical reference
- `*_label` — short human identifier (`Holding`, `IDR`, `1101`); dropdowns show `label - name`
- `*_name` — full name

**Migrations:** always `npx prisma migrate dev`. Never hand-edit an applied migration.
Never use `prisma db push` on this project.

**Seed:** `prisma/seed.ts` is the canonical first initialization — it mirrors the
mockup's fixtures exactly (2 companies, 10 partners, 4 cash/bank, 36 accounts, 26
mappings, 12 periods, 41 budgets, 8 transactions + 9 lines). It **deletes all data**
first and resets sequences. Keep it the source of truth for baseline data.

---

## 10. Business / Domain Rules

Implemented and enforced:

1. **One parent company.** Exactly one `sys_company.is_parent = true`. It acts as
   treasury provider for the others. Enforced in `master.ts`.
2. **Cash bank ↔ account ownership.** A cash/bank resource must post to an account
   owned by the same company. Enforced in `master.ts`, and the account picker filters
   by the chosen company.
3. **Cash/bank accounts.** Only `is_postable` accounts in the `Kas` or `Bank`
   subcategories may back a cash/bank resource.
4. **Uniqueness is case-insensitive** on identity labels.
5. **Locked fields.** `company_id` on Partner and Cash & Bank is immutable after
   creation — ledger history is tied to the company.
6. **Inactive records** disappear from new-transaction pickers but remain visible when
   already selected, and all history stays intact.
7. **Account numbers** are unique per company, not globally (`@@unique([company_id, account_label])`).

Defined in `rules.ts`, not yet exercised by UI:

8. **Budget category → partner category → account.** Each budget category declares
   which partner categories are valid and which directions (In/Out) make sense.
   Direction follows balance-sheet logic, not cash direction.
9. **22 transaction purposes.** A purpose is exactly one budget category × one partner
   category × one direction, which is what lets it resolve to a single account.

Specified in the concept doc, **not yet implemented** (V2):

10. Post fans out into Cash Bank Book, subject ledgers, and Journal → General Ledger.
11. Operational books are independent append-only stores — **never** views over
    journal lines. Only the General Ledger derives from journals.
12. A child company's realization emits a Funding Request; the parent confirms it and
    one atomic event produces two journals linked by an Intercompany Event.
13. No partial funding: realization = request = funding amount.

---

## 11. Security Rules

- **Never commit secrets.** `.env` is gitignored; `.env.example` holds placeholders only.
  Never write real credentials into this file, the README, or commit messages.
- **Authentication is not implemented yet.** Every route is currently open and writes are
  attributed to a hardcoded `CURRENT_USER = 2`. This is a known gap, not a design choice —
  see §16. Do not ship this beyond local development.
- When auth lands: replace `CURRENT_USER` in `src/app/actions/master.ts` and the `TODO`
  in `src/app/(app)/layout.tsx`; both are marked.
- **Validate in Server Actions**, not only in the browser — actions are reachable directly.
- Passwords are bcrypt-hashed. The seed's development password is intentionally weak and
  must not survive into any deployed environment.
- Prisma parameterises queries; the one raw call (`$executeRawUnsafe` for sequence resets
  in the seed) takes no user input. Do not introduce raw SQL with interpolated user input.

---

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

### Company has a create button
- **Decision:** Company is creatable, unlike the mockup which sets `noCreate`.
- **Reason:** Requested explicitly; nothing in the data model forbids a third company, and
  the single-parent rule guards the only real constraint.
- **Impact:** A deliberate divergence from mockup parity.
- **Do not change unless:** the user asks to restore the lock. **Flagged for confirmation (§17).**

### Language convention
- **Decision:** UI strings Indonesian; code, comments, commit messages English. Technical
  accounting terms stay English inside Indonesian copy (Budget, Cash Bank, Journal).
- **Reason:** Matches the mockup and the reference study's §12.4 convention.

---

## 13. Do Not Do

- Do **not** put project context in `AGENTS.md`, and do **not** delete it — `next dev`
  manages it, and its presence is what stops this file being reset to a one-line stub.
- Do **not** edit `Initialization/` — it is immutable source material.
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

## 14. Change Discipline

1. **Read before writing.** Inspect the mockup's implementation of a feature before
   building it; it is the specification. Its own comments flag what is mock-only.
2. **Smallest change that works.** No speculative abstraction.
3. **Reuse existing patterns** — registry config, Server Action shape, CSS classes.
4. **Keep commits small and per-feature**, with the established message style.
5. **Validate before reporting done:** `npm run build` (typechecks) and `npm run lint`.
   For UI work, exercise it in a browser; for write paths, verify the row in Postgres.
6. **Report** files changed, what was verified, what was not, and anything unresolved.
7. **Surface conflicts** between the concept doc, the DBML and the mockup — do not
   resolve them silently.
8. **Restore the baseline** (`npm run db:seed`) after generating throwaway test data.

---

## 15. Git / Version Control Conventions

- Single branch `main`; remote `origin` on GitHub.
- Commits are small and per-feature.
- Message style (established over the existing history): a short imperative subject line,
  then a body explaining **why** and calling out deliberate deviations.
- Attribution trailers are appended per the session's instructions.
- Never commit `.env`, `node_modules/`, `.next/`, or `src/generated/`.

---

## 16. Current Known Issues

| Issue | Detail |
| --- | --- |
| No authentication | Every route is open; writes hardcode `CURRENT_USER = 2`. `next-auth` installed but unwired. |
| Company context selector is inert | The topbar dropdown is local state and filters nothing. `Entity.scope` exists in the registry but is unused. |
| Audit log shows raw table keys | Dashboard renders `m_partner` rather than the mockup's `Partner / Cabang Medan`; needs entity display names + record lookup. |
| Audit log author hardcoded in dashboard | The activity list prints a fixed email instead of resolving `by`. |
| `zod` unused | Installed; validation is currently hand-written in the action. |
| No tests | No framework, no test script. |
| Dashboard integrity checks reduced | Two of the mockup's checks (missing account, dangling FKs) were dropped — Postgres now makes them unrepresentable. This is intentional, recorded so it is not "restored" by mistake. |

---

## 17. Needs Confirmation

Do not assume answers to these; ask.

1. **Company create button** — kept enabled against the mockup's `noCreate`. Should the
   lock be restored?
2. **Treasury provider modelling** — implemented as a single `sys_company.is_parent`
   flag (as the mockup does). The concept doc implies a per-company
   `treasury_provider_company_id` FK. Which is correct for V2?
3. **Purpose storage** — the 22 purposes live in `rules.ts` as a constant, matching the
   mockup and the DBML's `varchar`. The mockup's own comment recommends a `fin_purpose`
   config table. Promote in V2?
4. **`m_cash_bank.balance`** — mock-only running balance. The concept says balance must
   derive from `cash_bank_book`. Confirm removal when V2 lands.
5. **Delete policy** — no delete is implemented anywhere. Is "master data is never
   deleted, only deactivated" the standing rule? (`akui_proto_ui_reference.md` §12.2 left
   this open.)
6. **Exchange rates** — hardcoded in `rules.ts` (IDR/USD/SGD). No rate master exists.
7. **`Transfer` transaction type** — mentioned in a DBML comment but absent from the enum
   and the mockup.
8. **Budget Month** — a menu item and container in the concept, but no table; the mockup
   derives it from `acc_fiscal_period`. Confirm that derivation is correct.
9. **`Initialization/` in the repo** — currently committed. Keep, or move out once the
   conversion is complete?

---

## 18. Context Maintenance Rules

- Read `CLAUDE.md` before beginning substantial work; treat it as authoritative unless the
  user explicitly overrides it.
- Update it when a **durable** architectural, business, technical or UX decision changes —
  in the same change that introduces it.
- Record new frozen decisions in §12 using the Decision / Reason / Impact / Do-not-change
  format.
- Move items out of §17 into §12 or §10 once confirmed, rather than leaving both.
- Keep §16 accurate: remove issues when fixed; do not promote every TODO comment into one.
- **Do not** add task history, session narration, or temporary instructions.
- **Do not** silently remove or overwrite an established decision. If new work conflicts
  with this file, surface the conflict to the user first.
- Keep it high-signal: prefer rules that change decisions over descriptions discoverable
  from the code.
