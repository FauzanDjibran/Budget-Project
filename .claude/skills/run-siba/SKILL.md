---
name: run-siba
description: Run the SIBA app so it serves at http://localhost:3010. Use whenever the user says "Run SIBA", "start SIBA", "run the app", "restart SIBA", or otherwise asks to have the application up. Starts PostgreSQL, prepares the database (migrate and seed system data), and leaves the production build serving with `npm start`.
---

# Run SIBA

Bring the app up at <http://localhost:3010> and leave it running.

Run it wherever this session is — a local machine or a remote/cloud container.
In a container, note once that `localhost:3010` is the container's own and may
not be reachable from the user's browser, then start it anyway; the user asked
for it running and may be reaching it another way.

Work through the steps in order. Stop at the first one that fails and report the
actual error rather than guessing past it.

## 1. PostgreSQL

The app needs the PostgreSQL installation already on this machine — do not
install a new one, and do not substitute SQLite or a container unless the user
asks.

Check it is accepting connections (`pg_isready`). If it is down, start it the
way this platform does:

| Platform | Start |
| --- | --- |
| Windows | `Start-Service postgresql-x64-18` (adjust the version), or start it from Services |
| macOS (Homebrew) | `brew services start postgresql@16` |
| Linux (systemd) | `sudo systemctl start postgresql` |
| Linux (sysv) | `sudo service postgresql start` |

On Windows the CLI tools are not on `PATH`; they live in
`C:\Program Files\PostgreSQL\<version>\bin`.

## 2. Environment

`.env` is gitignored, so a fresh clone has none. If it is missing, copy
`.env.example` to `.env`, then make sure `DATABASE_URL` matches this machine's
Postgres password. Ask the user for the password rather than guessing it.

`.env.example` documents the rest. `SIBA_ADMIN_PASSWORD` is optional in
development — without it the seed falls back to the weak shared password and
prints it.

## 3. Dependencies and the Prisma client

- `npm install` if `node_modules/` is missing.
- `npx prisma generate` if `src/generated/prisma/` is missing. It is gitignored,
  so it never survives a clone, and nothing typechecks or connects without it.

## 4. Database

Create the database if it does not exist: `createdb -U postgres siba30` (the name
must match `DATABASE_URL`).

Then apply migrations with `npx prisma migrate deploy`. Use `deploy`, not
`migrate dev` — this is a run task, not a schema change, and `dev` is
interactive and can offer to reset.

## 5. Seed — always safe to run

`npm run db:seed` syncs **system data only**: the permission catalogue, the
seeded roles, the bootstrap administrator, the two Companies, the reference
tables (account types, document types, budget and partner categories, the
account category / subcategory skeleton) and the base reporting currency.

It is idempotent and deletes nothing a user entered, so run it every time. It
creates what is missing and leaves everything else alone — which is also how a
new permission added in code reaches the database.

Business data — partners, cash & bank resources, accounts, mappings, fiscal
years and periods, budgets — is never seeded. A fresh installation starts empty
and the user builds it through the application.

If the user explicitly asks to start over from nothing, `npm run db:reset` drops
the database, reapplies every migration and re-seeds. **It destroys all data** —
only run it on a clear, specific yes.

## 6. Build and start

Run `npm run build`, then `npm start` in the background and wait for it to
report ready. A local run is the **production build**, not the development
server, and it serves on **3010**. Every way of running SIBA has a fixed port so
several can run at once:

| Run | Command | Port |
| --- | --- | --- |
| Development server (hot reload) | `npm run dev` | 3000 |
| Local run — production build | `npm run build`, then `npm start` | 3010 |
| Local run of a temporary branch worktree | `npm run build`, then `npm run start:branch` | 3020 |
| Vercel-style run | `npm run build`, then `npm run start:vercel` | 3030 |

If 3010 is taken, find out what holds it and tell the user rather than silently
moving to another port — they are expecting 3010. A build that fails is reported
as it is; do not fall back to `npm run dev`.

Confirm it actually serves before reporting success: fetch `/login` and check for
a 200. Fetching `/` returns a redirect to `/login` when signed out, which is also
a healthy sign.

## 7. Report

Give the user:

- the URL, <http://localhost:3010>
- the administrator sign-in the seed printed (`admin@siba.app` by default, or
  whatever `SIBA_ADMIN_EMAIL` is set to). It is the only account the seed
  creates, and it holds every permission
- if the database is newly seeded, that the app starts with system data only:
  the chart of accounts, partners, cash & bank resources, mappings and the
  fiscal calendar are set up through the UI, and the dashboard's "Perlu
  Perhatian" card lists what to do first
- how to stop it (Ctrl-C, or the background task id)

Keep the server running afterwards. Do not tear it down at the end of the turn.
