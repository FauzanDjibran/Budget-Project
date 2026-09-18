/**
 * Runs a command against the deployed Neon database instead of the local one.
 *
 * Plain JavaScript rather than TypeScript, deliberately: this is a process
 * launcher, so it has to set the environment before the real command and its
 * `tsx` loader start. It cannot itself be loaded by `tsx`.
 *
 * The connection lives in `.env.neon`, which the `.env*` rule already gitignores.
 * Create it by hand from Vercel's own snippet — Storage -> siba-postgres ->
 * Show Metadata & Quickstart -> Show secret -> Copy Snippet — and paste the
 * whole thing in. Nothing here ever prints a secret.
 *
 * Three rules it enforces, because each one has already cost an hour:
 *
 *   1. It connects through DATABASE_URL_UNPOOLED, never DATABASE_URL. Neon's
 *      pooled endpoint runs pgbouncer in transaction mode and cannot execute
 *      DDL, so a migration against it fails partway and leaves the schema in
 *      the half-applied state `startup-check.ts` exists to refuse.
 *   2. It parses `.env.neon` itself rather than letting a shell source it. The
 *      connection strings contain `&` (from `?sslmode=require&channel_binding=
 *      require`), which a shell reads as "run the rest in the background" —
 *      silently setting only half the variables.
 *   3. A destructive command needs `--confirm` spelled out, the same protection
 *      `scripts/truncate-transactions.ts` already uses. The local `db:reset`
 *      drops a database somebody can rebuild in a minute; this one drops the
 *      books of a running deployment.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ENV_FILE = ".env.neon";

function die(message, hint) {
  console.error(`\n  ${message}\n`);
  if (hint) console.error(`  ${hint}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- arguments
let argv = process.argv.slice(2);

const destructive = argv[0] === "--destructive";
if (destructive) argv = argv.slice(1);

// npm forwards `npm run x -- --confirm` as a trailing argument, so the flag is
// stripped here rather than passed on to Prisma, which would reject it.
const confirmed = argv.includes("--confirm");
argv = argv.filter((a) => a !== "--confirm");

if (!argv.length) die("Nothing to run.", "Usage: node scripts/with-remote.js [--destructive] <command...>");

// ------------------------------------------------------------- the database
const envPath = path.resolve(process.cwd(), ENV_FILE);
if (!fs.existsSync(envPath)) {
  die(
    `${ENV_FILE} not found.`,
    "Create it from Vercel: Storage -> siba-postgres -> Show Metadata & Quickstart\n" +
      "  -> Show secret -> Copy Snippet, and paste the whole snippet into it.\n" +
      "  (Vercel's copy button does not work inside an embedded browser; use a normal one.)"
  );
}

const env = { ...process.env };
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
}

const direct = env.DATABASE_URL_UNPOOLED;
if (!direct) {
  die(
    `DATABASE_URL_UNPOOLED is not set in ${ENV_FILE}.`,
    "Paste the whole Vercel snippet, not just one line — the unpooled URL is what\n" +
      "  migrations need, and it is a separate entry from DATABASE_URL."
  );
}
if (direct.includes("-pooler")) {
  die(
    "DATABASE_URL_UNPOOLED points at the POOLED endpoint.",
    "Its host must not contain '-pooler'. pgbouncer in transaction mode cannot run\n" +
      "  the DDL a migration is made of."
  );
}

env.DATABASE_URL = direct;

// ------------------------------------------------------------------- safety
const host = (direct.match(/@([^/?]+)/) || [])[1] || "unknown host";
const shown = host.replace(/^[^.]+/, "<endpoint>");

if (destructive && !confirmed) {
  console.error(`
  This would run against the DEPLOYED database, not your local one.

      target : ${shown}
      command: ${argv.join(" ")}

  It destroys every row the application holds — partners, the chart of accounts,
  mappings, fiscal years, budgets, transactions, and all three books. The books
  are append-only and the application has no delete anywhere, so nothing here is
  recoverable from inside the app. A Cash & Bank opening balance in particular is
  create-only: it is written as a ledger entry when the resource is registered,
  and the only way back is to create the resource again.

  Nothing has been changed. To go ahead:

      npm run ${env.npm_lifecycle_event || "db:neon-reset"} -- --confirm
`);
  process.exit(1);
}

console.log(`[remote] ${shown}`);

const result = spawnSync(argv[0], argv.slice(1), { stdio: "inherit", env, shell: true });
process.exit(result.status === null ? 1 : result.status);
