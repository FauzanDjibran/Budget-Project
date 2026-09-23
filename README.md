# SIBA 3.0

Multi-company budgeting and accounting system. Budget plans, Finance executes, and
on Post a single business event writes to several independent books in parallel.

Built from the reference material in [`Initialization/`](./Initialization):

| File | Role |
| --- | --- |
| `Konsep SIBA 3.0 v3.md` | Concept / behaviour spec |
| `SIBA 3.0 DBML.txt` | Source database schema |
| `SIBA Mockup 2.0.html` | UI reference (a self-contained JS prototype) |
| `akui_proto_ui_reference.md` | UI/UX benchmark study behind the interface design |

The mockup is a reference for **interface and behaviour only**. Its data was
demo content baked into a file with no database; this application keeps none of
it.

## Scope

**Built.** Authentication and role-based access control, Master data, the
Accounting module (chart of accounts, budget-category mapping, fiscal calendar),
Budget planning through approval, and the Cash Bank Book — the append-only
ledger each cash and bank resource's balance is derived from.

**Not yet built.** The posting engine that fans a Finance transaction out into
the journal and the subject books (Prive / Titipan / Hutang / Piutang), the
General Ledger, Opening Balance, and the intercompany Funding Request flow.

## Stack

- **Next.js 16** (App Router) + TypeScript
- **Prisma 7** + **PostgreSQL**
- Email/password authentication with database-backed sessions, and role-based
  access control — built on the framework's own primitives, no auth library
- Plain CSS on a fixed set of design tokens — no utility framework

## Running locally

### 1. Prerequisites

- **Node.js 20+** (built against v24)
- **PostgreSQL 16+** — install from
  [postgresql.org/download/windows](https://www.postgresql.org/download/windows/),
  keep the default port `5432`

### 2. Install

```bash
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` to match your Postgres password.

Set `SIBA_ADMIN_PASSWORD` too if you want to choose the first administrator's
password; in development the seed falls back to a weak shared password and
prints it. Outside development that variable is required and the seed refuses to
run without it. Sessions need no secret — the cookie carries an opaque random
token and everything else lives in the database.

### 4. Create the database

```bash
createdb -U postgres siba30
```

On Windows, `createdb` lives in `C:\Program Files\PostgreSQL\<version>\bin` and
may not be on your PATH. If it isn't, either add it or create the database with
pgAdmin.

### 5. Migrate and seed

```bash
npx prisma migrate dev
npm run db:seed
```

**The seed creates system data only.** It syncs the permission catalogue, the
`ADMIN` and `STAFF` roles, the bootstrap administrator, the two Companies, the
reference tables application logic reads by label (account types, document
types, budget and partner categories, and the account category / subcategory
skeleton), and the base reporting currency.

| Email | Role | Notes |
| --- | --- | --- |
| `admin@siba.app` | Administrator | Bootstrap account. Address and password come from `SIBA_ADMIN_*`; in development the password defaults to `siba123`. |
| `sistem@siba.app` | — | Owns seeded rows. Seeded **inactive** with an unusable password hash, so it can never sign in. |

Everything else — partners, cash & bank resources, currencies beyond the base,
the chart of accounts, budget-category mappings, fiscal years, budgets — is
business data you create through the application. A fresh installation therefore
starts empty, and the dashboard's **Perlu Perhatian** card lists what to set up
first, in the order the modules depend on each other.

A **Fiscal Year** is the exception to "you create it": you choose a year, and the
name, the 01/01 start and the 31/12 end follow. Setting its status to `Open`
generates its twelve monthly periods, which are shown inside the year and are not
editable one by one — a calendar month is not a judgement call.

The seed is idempotent and deletes nothing: run it again after any release that
adds a permission. To start over from scratch, `npm run db:reset` drops the
database, reapplies every migration and reseeds — it destroys all data.

### 6. Run

```bash
npm run build
npm start
```

http://localhost:3010

Each way of running SIBA has its own fixed port, so two can run side by side:

| Run | Command | Port |
| --- | --- | --- |
| Development server (hot reload) | `npm run dev` | 3000 |
| Local run — production build | `npm run build`, then `npm start` | 3010 |
| Local run of a temporary branch worktree | `npm run build`, then `npm run start:branch` | 3020 |
| Vercel-style run | `npm run build`, then `npm run start:vercel` | 3030 |

## Useful commands

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server, port 3000 |
| `npm start` | Local run of the production build, port 3010 |
| `npm run start:branch` | A branch worktree's production build, port 3020 |
| `npm run start:vercel` | Vercel-style production run, port 3030 |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm test` | Test suite (needs a migrated, seeded database) |
| `npm run db:seed` | Sync system data — idempotent, destroys nothing |
| `npm run db:reset` | **Destructive.** Drop, re-migrate and reseed |
| `npx prisma studio` | Browse the database |
| `npx prisma migrate dev` | Create and apply a migration |

## Access control

Every route and every Server Action requires a session, and each operation
requires a named permission. The model is deliberately small:

```
USER  ──►  ROLE  ──►  PERMISSION
```

A permission is one atomic capability (`PARTNER_CREATE`, `BUDGET_APPROVE`,
`USER_ROLE_ASSIGN`). A role bundles permissions. A user's access is exactly the
union of their active roles' permissions — there is no direct user-to-permission
grant, so there is one authoritative answer to "may this user do this?".

**There are no default permissions.** Every role but `ADMIN` is created empty,
and nothing reads a role's name to decide access. A user with no roles — or with
a role that holds nothing — signs in successfully and can reach their own profile
and nothing else. Access is granted by an administrator putting permissions in a
role, never by what the role is called.

Menu access and actions are separate permissions: seeing the Budget menu is not
permission to approve a budget. The catalogue lives in
[`src/lib/siba/permissions.ts`](./src/lib/siba/permissions.ts); the enforcement
lives in [`src/lib/siba/auth.ts`](./src/lib/siba/auth.ts) and the service modules
beside it. The UI hides what a user cannot use, but that is presentation — the
server refuses the same request whether or not the button was there.

`npm test` covers the security paths: login, session revocation, deactivated
accounts, staff restrictions, self-escalation attempts, and the guarantee that
the application can never be left without an active administrator.

## Deployment

Nothing here is host-specific. Set `DATABASE_URL` and `SIBA_ADMIN_PASSWORD` in
the host's environment, run `npx prisma migrate deploy` on release, and
`npm run build`. Sessions are database-backed, so no shared secret needs
distributing. Serve over HTTPS: the session cookie is issued `Secure` when
`NODE_ENV=production`. Works as-is on Vercel, Railway, or a plain VPS behind
Node.

## Notes on the data model

The Prisma schema deviates from the source DBML in a few deliberate places —
Postgres-native types, `Int` ids, normalised money precision, and several
columns the application needs that the DBML never declared (`is_parent`,
`partner_category_id`, the Cash Bank Book tables, and the user, role, permission
and session tables, none of which the DBML models at all). Each is commented
inline in [`prisma/schema.prisma`](./prisma/schema.prisma).

**A cash or bank balance is never a column on the master.** `cash_bank_ledger`
is append-only — entries are never edited or deleted, and a mistake is corrected
by a further entry — and `cash_bank_balance` is the running total, written in
the same transaction as the entry that moved it and recomputable from the ledger
at any time. A resource's opening balance is entered when it is registered and
becomes the first entry in its book.

**Amounts in different currencies are never added together.** Totals are
reported per currency throughout, because the system has no authoritative
exchange-rate source yet and a combined figure would be a guess presented as a
fact.

**Dates are `dd/mm/yyyy` everywhere**, and the application draws its own date
field and dropdowns rather than using `<input type="date">` or `<select>`. Both
of those are rendered by the operating system, in the viewer's locale and the
OS's own styling — which meant the same form read `mm/dd/yyyy` to one person and
`dd/mm/yyyy` to another. ISO (`yyyy-mm-dd`) remains the storage and wire format;
only the display is Indonesian.
