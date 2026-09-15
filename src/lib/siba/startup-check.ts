import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

/**
 * Is the database actually the one this build expects?
 *
 * The failure worth catching at boot is a deploy whose migrations have not run:
 * the code knows about a table the database does not have, and the first page
 * to touch it fails at runtime rather than at deploy time. `tests/schema.test.ts`
 * proves the same property in CI; this is the last line of defence in front of
 * a real database, and it also catches the cruder cases — an empty database, or
 * a DATABASE_URL pointing somewhere unexpected.
 *
 * Prisma 7 exposes no DMMF at runtime, so the model list comes from
 * `prisma/schema.prisma` when that file ships alongside the build (it does for
 * an ordinary deployment, because `prisma migrate deploy` needs it). When it is
 * absent — a standalone bundle copied on its own — the check falls back to a
 * small set of tables the application cannot run without at all.
 */

/** Tables with no plausible working deployment behind them. */
const CORE_TABLES = ["sys_user", "sys_session", "sys_role", "sys_company"];

export type SchemaReport =
  | { ok: true; checked: number }
  | { ok: false; problem: string; checked: number };

/** Every `model X { ... @@map("table") }` in the schema, or null if unreadable. */
function tablesFromSchema(): string[] | null {
  try {
    const text = readFileSync(
      join(process.cwd(), "prisma", "schema.prisma"),
      "utf8"
    );
    const out: string[] = [];
    for (const [, model, body] of text.matchAll(
      /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
    )) {
      const mapped = body.match(/@@map\("([^"]+)"\)/);
      out.push(mapped ? mapped[1] : model);
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export async function assertSchemaIsCurrent(): Promise<SchemaReport> {
  const expected = tablesFromSchema() ?? CORE_TABLES;

  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  const present = new Set(rows.map((r) => r.table_name));

  const missing = expected.filter((t) => !present.has(t));
  if (missing.length) {
    return {
      ok: false,
      checked: expected.length,
      problem:
        `the database is missing ${missing.length} table(s) this build expects ` +
        `(${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}). ` +
        "Run `npx prisma migrate deploy` before starting the server.",
    };
  }

  // A migration row that started and never finished means `migrate deploy` was
  // interrupted; the schema is then in an unknown state and serving from it
  // would be worse than refusing to start.
  const unfinished = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NULL AND rolled_back_at IS NULL
  `;
  if (unfinished.length) {
    return {
      ok: false,
      checked: expected.length,
      problem:
        `migration ${unfinished[0].migration_name} started and did not finish. ` +
        "Resolve it with `npx prisma migrate resolve` before starting the server.",
    };
  }

  return { ok: true, checked: expected.length };
}
