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
- **Auth.js v5** (credentials)
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

Edit `.env` and set `DATABASE_URL` to match your Postgres password. Then generate
a session secret:

```bash
npx auth secret
```

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
| `npm run db:seed` | Reseed (wipes transactional tables first) |
| `npx prisma studio` | Browse the database |
| `npx prisma migrate dev` | Create and apply a migration |

## Deployment

Nothing here is host-specific. Set `DATABASE_URL` and `AUTH_SECRET` in the host's
environment, run `npx prisma migrate deploy` on release, and `npm run build`.
Works as-is on Vercel, Railway, or a plain VPS behind Node.

## Notes on the data model

The Prisma schema deviates from the source DBML in a few deliberate places —
Postgres-native types, `Int` ids, normalised money precision, and several columns
the mockup needs that the DBML never declared (`is_parent`,
`partner_category_id`, `balance`, a user table). Each is commented inline in
[`prisma/schema.prisma`](./prisma/schema.prisma).
