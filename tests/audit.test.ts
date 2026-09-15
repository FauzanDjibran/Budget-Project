import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma, disconnect } from "./helpers";
import { knownAuditSubjects, recentActivity } from "../src/lib/siba/audit";

/**
 * The audit log says what changed, in words.
 *
 * `audit_log` stores `(entity_key, row_id)`, so the panel used to render
 * `m_partner` — which names neither the kind of record nor the record. The
 * catalogue in `audit.ts` resolves both, and its one real failure mode is
 * going stale: a module that starts writing a new `entity_key` without adding
 * a subject would silently print the raw table name again. The first test is a
 * source scan that catches exactly that, and needs no database.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "generated") continue;
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("every audited subject can be named", () => {
  test("no entity_key is written that the catalogue cannot describe", () => {
    const written = new Set<string>();
    for (const path of sourceFiles(SRC)) {
      const text = readFileSync(path, "utf8");
      for (const m of text.matchAll(/entity_key:\s*"([a-z_]+)"/g)) {
        written.add(m[1]);
      }
    }

    assert.ok(written.size > 0, "found no entity_key literals — the scan is broken");

    const known = new Set(knownAuditSubjects());
    const undescribed = [...written].filter((k) => !known.has(k)).sort();

    assert.deepEqual(
      undescribed,
      [],
      "Add a subject to EXTRA_SUBJECTS in lib/siba/audit.ts, or register the entity. " +
        "An unknown key falls back to the raw table name, which is the state this " +
        "catalogue exists to fix."
    );
  });

  test("a registry entity is described by its own singular name", () => {
    const known = knownAuditSubjects();
    assert.ok(known.includes("m_partner"), "the registry should supply m_partner");
    assert.ok(known.includes("sys_user"), "User is outside the registry and needs a line");
    assert.ok(known.includes("bud_budget"), "Budget is outside the registry and needs a line");
  });
});

describe("an entry reads as a record, not a table", () => {
  let auditId: number | null = null;

  after(async () => {
    if (auditId !== null) {
      await prisma.auditLog.delete({ where: { id: auditId } }).catch(() => {});
    }
    await disconnect();
  });

  test("a Company change names the Company", async () => {
    // Companies are system data and always present (CLAUDE.md §12), so this
    // needs no business fixture of its own.
    const company = await prisma.sysCompany.findFirstOrThrow();
    const row = await prisma.auditLog.create({
      data: {
        entity_key: "sys_company",
        row_id: company.id,
        action: "UPDATE",
        by: 0,
      },
    });
    auditId = row.id;

    const entries = await recentActivity(1);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, row.id);
    assert.notEqual(
      entries[0].subject,
      "sys_company",
      "the subject should be the entity's name, not its table"
    );
    assert.ok(
      entries[0].title?.includes(company.company_name),
      `expected the Company's name in the title, got ${entries[0].title}`
    );
  });

  test("an unknown key still reports, rather than throwing", async () => {
    const row = await prisma.auditLog.create({
      data: { entity_key: "nope_not_a_table", row_id: 1, action: "UPDATE", by: 0 },
    });
    try {
      const entries = await recentActivity(1);
      assert.equal(entries[0].subject, "nope_not_a_table");
      assert.equal(entries[0].title, null);
    } finally {
      await prisma.auditLog.delete({ where: { id: row.id } }).catch(() => {});
    }
  });
});
