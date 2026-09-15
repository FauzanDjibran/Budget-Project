import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { disconnect, prisma } from "./helpers";

/**
 * The schema, the generated client and the database still describe one thing.
 *
 * `prisma/schema.prisma` is the source, but neither of the two things built
 * from it updates itself. `npx prisma generate` rewrites the client and
 * `npx prisma migrate dev` rewrites the database, and a schema change that
 * skips either leaves the application reading a model that is not there:
 * `prisma.<model>` comes back `undefined`, and the first page that touches it
 * dies with "Cannot read properties of undefined (reading 'findMany')" — a
 * runtime failure the typechecker cannot see, because the types come from the
 * same stale client that is missing the model.
 *
 * That is exactly how every create page broke once: `SysSetting` was added to
 * the schema and migrated, but the long-running dev server held a client
 * generated before it. `src/lib/prisma.ts` now retires a client whose class has
 * been regenerated underneath it; this suite is the other half, and fails loudly
 * on a checkout where `prisma generate` or `migrate` has simply not been run.
 */

/** Every `model X { ... @@map("table") }` declared in the schema. */
function declaredModels(): { model: string; table: string }[] {
  const schema = readFileSync(
    join(process.cwd(), "prisma", "schema.prisma"),
    "utf8"
  );

  const out: { model: string; table: string }[] = [];
  const blocks = schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm);
  for (const [, model, body] of blocks) {
    const mapped = body.match(/@@map\("([^"]+)"\)/);
    out.push({ model, table: mapped ? mapped[1] : model });
  }
  return out;
}

/** `SysSetting` -> `sysSetting`, which is how the client names its delegates. */
function delegateName(model: string): string {
  return model[0].toLowerCase() + model.slice(1);
}

after(async () => {
  await disconnect();
});

describe("the schema, the client and the database agree", () => {
  const models = declaredModels();

  test("the schema declares models at all", () => {
    // Guards the parser itself: a regex that silently matched nothing would
    // make every assertion below vacuously true.
    assert.ok(models.length > 20, `parsed only ${models.length} models`);
  });

  test("every model in the schema has a delegate on the generated client", () => {
    // Delegates cannot be indexed by a runtime string on the typed client —
    // the same reason `records.ts` keeps its one deliberate escape hatch.
    const client = prisma as unknown as Record<string, unknown>;
    const missing = models
      .map((m) => delegateName(m.model))
      .filter((name) => typeof client[name] !== "object");

    assert.deepEqual(
      missing,
      [],
      `generated client is behind prisma/schema.prisma — run \`npx prisma generate\`. Missing: ${missing.join(", ")}`
    );
  });

  test("every model in the schema has a table in the database", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const present = new Set(rows.map((r) => r.table_name));

    const missing = models.map((m) => m.table).filter((t) => !present.has(t));

    assert.deepEqual(
      missing,
      [],
      `database is behind prisma/schema.prisma — run \`npx prisma migrate dev\`. Missing: ${missing.join(", ")}`
    );
  });

  test("every applied migration is still on disk", async () => {
    const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;
    const { readdirSync } = await import("node:fs");
    const onDisk = new Set(
      readdirSync(join(process.cwd(), "prisma", "migrations"), {
        withFileTypes: true,
      })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    );

    const vanished = applied
      .map((a) => a.migration_name)
      .filter((name) => !onDisk.has(name));

    assert.deepEqual(
      vanished,
      [],
      `applied migrations are missing from prisma/migrations: ${vanished.join(", ")}`
    );
  });
});
