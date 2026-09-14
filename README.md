# SIBA 3.0

Multi-company budgeting and accounting system. Budget plans, Finance executes, and
on Post a single business event writes to several independent books in parallel.

Built from the reference material in [`Initialization/`](./Initialization):

| File | Role |
| --- | --- |
| `Konsep SIBA 3.0 v3.md` | Concept / behaviour spec |
| `SIBA 3.0 DBML.txt` | Source database schema |
| `SIBA Mockup 2.0.html` | UI mockup (a self-contained JS prototype) |
| `akui_proto_ui_reference.md` | UI/UX benchmark study behind the mockup's design |

## Scope

**V1 — in progress.** Parity with `SIBA Mockup 2.0.html`: Master data, Budget
planning and approval, and Finance execution through Post. Plus real
authentication, which the mockup stubs out.

**V2 — deferred.** The concept doc's posting engine (Journal, General Ledger, and
the Cash Bank / Prive / Titipan / Hutang / Piutang books), Opening Balance, and
the intercompany Funding Request flow. None of these exist in the mockup, and
most have no tables in the source DBML.

## Stack

- **Next.js 16** (App Router) + TypeScript
- **Prisma 7** + **PostgreSQL**
- Email/password authentication with database-backed sessions, and role-based
  access control — built on the framework's own primitives, no auth library
- Plain CSS, lifted from the mockup's design tokens — no utility framework

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

The seed mirrors the mockup's fixtures: 2 companies, 10 partners, 4 cash/bank
accounts, 36 accounts, 41 budgets, and 8 transactions.

It also seeds the access model — the permission catalogue, the `ADMIN` and
`STAFF` roles, and three accounts:

| Email | Role | Notes |
| --- | --- | --- |
| `admin@siba.app` | Administrator | Bootstrap account. Address and password come from `SIBA_ADMIN_*`. |
| `meehun@siba.app` | Staff | The mockup's everyday user. `STAFF` is seeded **empty**, so this account can sign in and reach only its own profile. |
| `sistem@siba.app` | — | Owns seeded records. Seeded **inactive**, so it cannot sign in. |

The two fixture accounts use the password `siba123`. These are development
fixtures — change them before deploying anywhere reachable.

### 6. Run

```bash
npm run dev
```

http://localhost:3000

## Useful commands

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm test` | Security test suite (needs a seeded database) |
| `npm run db:seed` | Reseed (wipes transactional tables first) |
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
Postgres-native types, `Int` ids, normalised money precision, and several columns
the mockup needs that the DBML never declared (`is_parent`,
`partner_category_id`, `balance`, and the user, role, permission and session
tables, none of which the DBML models at all). Each is commented inline in
[`prisma/schema.prisma`](./prisma/schema.prisma).
