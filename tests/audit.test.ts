import test, { before, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma, disconnect } from "./helpers";
import {
  knownAuditSubjects,
  recentActivity,
  recordHistory,
} from "../src/lib/siba/audit";
import { BUDGET_TRANSITIONS } from "../src/lib/siba/budget-workflow";
import { FISCAL_YEAR_TRANSITIONS } from "../src/lib/siba/fiscal-workflow";
import { TRANSACTION_TRANSITIONS } from "../src/lib/siba/transaction-workflow";
import { auditEventLabel, knownAuditEvents } from "../src/lib/siba/audit-events";
import { withdrawFundingRequest } from "../src/lib/siba/funding";
import { childCompanyId, systemUserId } from "./helpers";

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


// ------------------------------------- fixtures for the per-record history

const ENTITY = "zztest_audit";

let actor = 0;
let anak = 0;
const rows: number[] = [];
const transactions: number[] = [];
const requests: number[] = [];

before(async () => {
  actor = await systemUserId();
  anak = await childCompanyId();
});

/**
 * One teardown for the whole file.
 *
 * `disconnect()` is deliberately here and nowhere else: a suite that closed the
 * client inside its own `after` would take the client away from every case
 * declared below it in the file.
 */
after(async () => {
  if (rows.length) {
    await prisma.auditLog.deleteMany({ where: { id: { in: rows } } });
  }
  if (requests.length) {
    await prisma.auditLog.deleteMany({
      where: { entity_key: "fin_funding_request", row_id: { in: requests } },
    });
    await prisma.finFundingRequest.deleteMany({ where: { id: { in: requests } } });
  }
  if (transactions.length) {
    await prisma.auditLog.deleteMany({
      where: {
        entity_key: "fin_cash_bank_transaction",
        row_id: { in: transactions },
      },
    });
    await prisma.finCashBankTransaction.deleteMany({
      where: { id: { in: transactions } },
    });
  }
  await disconnect();
});

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

/** One audit row, remembered so teardown can remove it. */
async function writeEntry(
  rowId: number,
  event: string | null,
  at: Date,
  action: "TAMBAH" | "UPDATE" = "UPDATE"
): Promise<number> {
  const created = await prisma.auditLog.create({
    data: { entity_key: ENTITY, row_id: rowId, action, event, at, by: actor },
    select: { id: true },
  });
  rows.push(created.id);
  return created.id;
}

// ----------------------------------------------------- the catalogue is whole

describe("every lifecycle transition can be named in a history", () => {
  const TABLES: [string, string, Record<string, unknown>][] = [
    ["bud_budget", "Budget", BUDGET_TRANSITIONS],
    ["fin_cash_bank_transaction", "Cash Bank Transaction", TRANSACTION_TRANSITIONS],
    ["acc_fiscal_year", "Fiscal Year", FISCAL_YEAR_TRANSITIONS],
  ];

  for (const [entityKey, name, table] of TABLES) {
    test(`${name} labels every transition it declares`, () => {
      const known = knownAuditEvents()[entityKey] ?? [];
      const missing = Object.keys(table).filter((a) => !known.includes(a));

      assert.deepEqual(
        missing,
        [],
        `Every transition must be nameable in a record's history, or the panel ` +
          `reports it as a bare "Diubah". Add ${missing.join(", ")} to ` +
          `lib/siba/audit-events.ts beside the other ${name} events.`
      );
    });
  }

  test("a labelled event reads as something that already happened", () => {
    // The transition table's own label is an imperative, because it is written
    // on a button. A history entry reports the past, so the two must differ.
    assert.equal(auditEventLabel("bud_budget", "UPDATE", "approve").label, "Disetujui");
    assert.equal(auditEventLabel("bud_budget", "UPDATE", "reject").label, "Ditolak");
    assert.equal(
      auditEventLabel("fin_cash_bank_transaction", "UPDATE", "post").label,
      "Diposting"
    );
  });

  test("a transition's tone carries into its history entry", () => {
    // A rejection is drawn as danger on the button, so it is drawn as danger in
    // the trace — one table decides both.
    assert.equal(auditEventLabel("bud_budget", "UPDATE", "reject").tone, "danger");
    assert.equal(auditEventLabel("bud_budget", "UPDATE", "approve").tone, "primary");
  });

  test("a consequence is marked as one, not attributed to a decision", () => {
    // Nobody closes a Budget by hand — it closes because a posting reached its
    // planned amount (CLAUDE.md §10 rule 36).
    assert.equal(auditEventLabel("bud_budget", "UPDATE", "close").systemDriven, true);
    assert.notEqual(
      auditEventLabel("bud_budget", "UPDATE", "approve").systemDriven,
      true
    );
  });
});

describe("an unnameable row still says something true", () => {
  test("a row written before `event` existed reports the coarse verb", () => {
    assert.equal(auditEventLabel("bud_budget", "UPDATE", null).label, "Diubah");
    assert.equal(auditEventLabel("bud_budget", "TAMBAH", null).label, "Dibuat");
  });

  test("an event this build does not know falls back rather than inventing", () => {
    // A row written by a newer build, read by an older one. It must not claim
    // to know which transition it was.
    assert.equal(
      auditEventLabel("bud_budget", "UPDATE", "teleport").label,
      "Diubah"
    );
  });

  test("a table with no lifecycle still names create, edit and the toggle", () => {
    // Every master record: created, edited, deactivated. `m_partner` has no
    // entry of its own and falls through to the shared vocabulary.
    assert.equal(auditEventLabel("m_partner", "TAMBAH", "create").label, "Dibuat");
    assert.equal(
      auditEventLabel("m_partner", "UPDATE", "deactivate").label,
      "Dinonaktifkan"
    );
    assert.equal(auditEventLabel("m_partner", "UPDATE", "activate").label, "Diaktifkan");
  });
});

// -------------------------------------------------------- reading one history

describe("a record's history", () => {
  test("reads newest first", async () => {
    const rowId = 900_001;
    await writeEntry(rowId, "create", new Date("2026-01-01T08:00:00Z"), "TAMBAH");
    await writeEntry(rowId, "submit", new Date("2026-01-02T08:00:00Z"));
    await writeEntry(rowId, "approve", new Date("2026-01-03T08:00:00Z"));

    const history = await recordHistory(ENTITY, rowId);

    assert.deepEqual(
      history.entries.map((e) => e.event),
      ["approve", "submit", "create"],
      "The entry a reader opened the panel for is the most recent one; oldest " +
        "first would push it below the fold on a long-lived record."
    );
  });

  test("breaks a tie by id, so one transaction's writes keep their order", async () => {
    // A confirmation writes several rows inside one transaction, and they can
    // share a timestamp to the millisecond. Without the id tiebreak the order
    // they render in is whatever the database happens to return.
    const rowId = 900_002;
    const at = new Date("2026-02-01T08:00:00Z");
    await writeEntry(rowId, "create", at, "TAMBAH");
    await writeEntry(rowId, "submit", at);
    await writeEntry(rowId, "confirm", at);

    const history = await recordHistory(ENTITY, rowId);

    assert.deepEqual(
      history.entries.map((e) => e.event),
      ["confirm", "submit", "create"]
    );
  });

  test("caps what it returns and still counts what it did not", async () => {
    const rowId = 900_003;
    for (let i = 0; i < 14; i += 1) {
      await writeEntry(rowId, "update", new Date(Date.UTC(2026, 2, i + 1)));
    }

    const history = await recordHistory(ENTITY, rowId, 10);

    assert.equal(history.entries.length, 10);
    assert.equal(
      history.total,
      14,
      "The cap has to be visible, or a slice is presented as the whole story."
    );
  });

  test("names the actor", async () => {
    const rowId = 900_004;
    await writeEntry(rowId, "create", new Date("2026-04-01T08:00:00Z"), "TAMBAH");

    const history = await recordHistory(ENTITY, rowId);

    assert.ok(
      history.entries[0].by,
      "An entry without a name answers 'when' but not 'who', which is half the question."
    );
  });

  test("a record nothing has happened to reports no entries and no total", async () => {
    const history = await recordHistory(ENTITY, 900_999);
    assert.deepEqual(history.entries, []);
    assert.equal(history.total, 0);
  });

  test("one record's history is not another's", async () => {
    const mine = 900_005;
    const theirs = 900_006;
    await writeEntry(mine, "create", new Date("2026-05-01T08:00:00Z"), "TAMBAH");
    await writeEntry(theirs, "create", new Date("2026-05-01T08:00:00Z"), "TAMBAH");
    await writeEntry(theirs, "cancel", new Date("2026-05-02T08:00:00Z"));

    assert.equal((await recordHistory(ENTITY, mine)).total, 1);
    assert.equal((await recordHistory(ENTITY, theirs)).total, 2);
  });
});

// ------------------------------------------------- the gap that had no record

describe("withdrawing a funding request leaves a trace", () => {
  test("the request records who took it back, and the document that it was cancelled", async () => {
    const currency = await prisma.refCurrency.findFirstOrThrow({
      orderBy: { id: "asc" },
      select: { id: true },
    });

    // The anak's document waiting on the induk. Withdrawal needs only that it
    // is Pending and that a request is open against it.
    const doc = await prisma.finCashBankTransaction.create({
      data: {
        transaction_no: `ZZTEST-AUD${Date.now() % 1_000_000}`,
        transaction_type: "Out",
        company_id: anak,
        purpose: "HUTANG_BAYAR",
        cash_bank_id: null,
        currency_id: currency.id,
        transaction_amount: 1000,
        transaction_base_amount: 1000,
        status: "Pending",
        created_by: actor,
      },
      select: { id: true },
    });
    transactions.push(doc.id);

    const request = await prisma.finFundingRequest.create({
      data: {
        funding_request_no: `ZZTEST-FR${Date.now() % 1_000_000}`,
        request_date: new Date("2026-06-01T00:00:00Z"),
        transaction_id: doc.id,
        currency_id: currency.id,
        request_amount: 1000,
        status: "Open",
        created_by: actor,
      },
      select: { id: true },
    });
    requests.push(request.id);

    const result = await withdrawFundingRequest(doc.id, actor);
    assert.equal(result.ok, true);

    const onRequest = await recordHistory("fin_funding_request", request.id);
    assert.deepEqual(
      onRequest.entries.map((e) => e.event),
      ["withdraw"],
      "Withdrawal used to write no audit row at all, so a request that was " +
        "taken back left no trace of who took it back or when."
    );

    const onDocument = await recordHistory("fin_cash_bank_transaction", doc.id);
    assert.deepEqual(
      onDocument.entries.map((e) => e.event),
      ["cancel"],
      "The document is cancelled by the same act, and says so in its own history."
    );
  });
});
