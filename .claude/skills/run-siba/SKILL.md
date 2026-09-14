---
name: run-siba
description: Run the SIBA app locally so it is reachable at http://localhost:3000 in a browser. Use when the user says "Run SIBA", "start SIBA", "run the app", "start the dev server", or otherwise asks to have the application up on their own machine. Brings up the local PostgreSQL, prepares the database (migrate, and seed only when empty), and starts `npm run dev`.
---

# Run SIBA locally

Bring the app up on **this machine** at <http://localhost:3000>.

> **Refuse if you are not on the user's machine.** This skill is only meaningful
> in a local Claude Code session. If you are running in a remote/cloud container
> (Claude Code on the web, a CI runner, a sandbox), say so plainly and stop —
> `localhost` there is not the user's `localhost`, and starting a server would
> produce a URL they cannot open. Do not pretend otherwise.

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

## 5. Seed — only when the database is empty

`npm run db:seed` **deletes every row** before inserting the baseline.

- Empty database (no `sys_user` rows) → seed without asking.
- Existing data → **ask first**, and say plainly that it wipes everything. Skip
  it on anything but a clear yes; the app runs fine against data already there.

Reseed anyway when the permission catalogue changed in code, since the tests and
the app read it from the database — but still ask if there is real data.

## 6. Start the dev server

Run `npm run dev` in the background and wait for it to report ready. If port 3000
is taken, find out what holds it and tell the user rather than silently moving to
another port — they are expecting 3000.

Confirm it actually serves before reporting success: fetch `/login` and check for
a 200. Fetching `/` returns a redirect to `/login` when signed out, which is also
a healthy sign.

## 7. Report

Give the user:

- the URL, <http://localhost:3000>
- the sign-in credentials the seed printed, and what each account demonstrates:
  - `admin@siba.app` — Administrator, holds every permission
  - `meehun@siba.app` — Staff, holds a role with **no** permissions, so it signs
    in and is refused everywhere except its own profile
- how to stop it (Ctrl-C, or the background task id)

Keep the server running afterwards. Do not tear it down at the end of the turn.
