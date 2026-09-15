import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  JournalImbalance,
  postJournal,
  unbalancedJournals,
} from "../src/lib/siba/journal";
import {
  generalLedgerReport,
  signedMovement,
  trialBalanceReport,
} from "../src/lib/siba/ledger";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import { MODULES } from "../src/lib/siba/nav";
import { REPORTS } from "../src/lib/siba/reports";
import {
  cleanupFixtures,
  disconnect,
  makeAccount,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The journal's one guarantee: every journal balances.
 *
 * Everything the General Ledger and the Trial Balance claim rests on it. If a
 * journal could be written with debits and credits that differ, a trial balance
 * that failed to add up would say nothing about whether the books were wrong —
 * so the refusal is pushed at from every side it could be got round.
 */

let company = 0;
let actor = 0;
let cash = 0;
let expense = 0;
let currency = 0;

before(async () => {
  company = await parentCompanyId();
  actor = await systemUserId();
  cash = await makeAccount({
    companyId: company,
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
  });
  expense = await makeAccount({ companyId: company, subcategoryLabel: "5.3.1" });
  currency = (
    await prisma.refCurrency.findFirstOrThrow({
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;
});

after(async () => {
  await cleanupFixtures();
  await disconnect();
});

const line = (accountId: number, debit: number, credit: number) => ({
  accountId,
  currencyId: currency,
  debit,
  credit,
  description: "Fixture",
});

const journal = (lines: ReturnType<typeof line>[]) => ({
  companyId: company,
  description: "Fixture journal",
  lines,
  actorId: actor,
});

const WHOLE_TIME = { from: "2000-01-01", to: "2999-12-31" };

describe("a journal is refused unless its two sides agree", () => {
  test("a balanced journal is written", async () => {
    const result = await postJournal(
      prisma,
      journal([line(expense, 1_000_000, 0), line(cash, 0, 1_000_000)])
    );
    assert.match(result.journalNo, /^JRN-\d{4}$/);

    const written = await prisma.accJournal.findUniqueOrThrow({
      where: { id: result.id },
      include: { lines: true },
    });
    assert.equal(written.lines.length, 2);
    assert.equal(written.status, "Posted");
  });

  test("an unbalanced journal is refused and writes nothing", async () => {
    const before = await prisma.accJournal.count();

    await assert.rejects(
      postJournal(
        prisma,
        journal([line(expense, 1_000_000, 0), line(cash, 0, 999_999)])
      ),
      JournalImbalance
    );

    assert.equal(
      await prisma.accJournal.count(),
      before,
      "a refused journal must leave no header behind"
    );
  });

  test("a one-sided journal is refused", async () => {
    await assert.rejects(
      postJournal(prisma, journal([line(expense, 1_000_000, 0)])),
      JournalImbalance
    );
  });

  test("a journal with no lines is refused", async () => {
    await assert.rejects(postJournal(prisma, journal([])), /tanpa baris/);
  });

  test("a line carrying both sides is refused", async () => {
    await assert.rejects(
      postJournal(
        prisma,
        journal([line(expense, 500_000, 500_000), line(cash, 0, 500_000)])
      ),
      /tepat satu sisi/
    );
  });

  test("a line carrying neither side is refused", async () => {
    await assert.rejects(
      postJournal(
        prisma,
        journal([
          line(expense, 1_000_000, 0),
          line(cash, 0, 1_000_000),
          line(cash, 0, 0),
        ])
      ),
      /tepat satu sisi/
    );
  });

  test("a negative amount is refused", async () => {
    await assert.rejects(
      postJournal(
        prisma,
        journal([line(expense, -1_000, 0), line(cash, 0, -1_000)])
      ),
      /negatif/
    );
  });

  test("cents are compared, so floating point cannot fail a sound journal", async () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. These two sides are
    // arithmetically equal and must be accepted.
    const result = await postJournal(
      prisma,
      journal([line(expense, 0.1, 0), line(expense, 0.2, 0), line(cash, 0, 0.3)])
    );
    assert.ok(result.id > 0);
  });

  test("nothing in the database is unbalanced", async () => {
    assert.deepEqual(
      await unbalancedJournals([company]),
      [],
      "every journal goes through postJournal, which refuses the alternative"
    );
  });
});

describe("a posting date is the day it was posted", () => {
  test("the journal is dated today, never back-dated", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = await postJournal(
      prisma,
      journal([line(expense, 250_000, 0), line(cash, 0, 250_000)])
    );
    const row = await prisma.accJournal.findUniqueOrThrow({
      where: { id: result.id },
      select: { posting_date: true },
    });
    assert.equal(row.posting_date.toISOString().slice(0, 10), today);
  });

  test("journal numbers are the document form and never repeat", async () => {
    const a = await postJournal(
      prisma,
      journal([line(expense, 10, 0), line(cash, 0, 10)])
    );
    const b = await postJournal(
      prisma,
      journal([line(expense, 10, 0), line(cash, 0, 10)])
    );
    assert.notEqual(a.journalNo, b.journalNo);
    assert.match(b.journalNo, /^JRN-\d{4}$/);
  });
});

describe("the ledger reads journal lines the way an accountant does", () => {
  test("a Debit account rises on the debit side", () => {
    assert.equal(signedMovement("Debit", 100, 0), 100);
    assert.equal(signedMovement("Debit", 0, 100), -100);
  });

  test("a Kredit account rises on the credit side", () => {
    assert.equal(signedMovement("Kredit", 0, 100), 100);
    assert.equal(signedMovement("Kredit", 100, 0), -100);
  });

  test("opening plus movement is the closing balance, in the account's direction", async () => {
    const report = await generalLedgerReport([cash, expense], WHOLE_TIME, [company]);

    for (const a of report.accounts) {
      assert.equal(
        Math.round(a.closing * 100),
        Math.round(
          (a.opening + signedMovement(a.normalBalance, a.debit, a.credit)) * 100
        ),
        `${a.label} must close where its opening plus its movement lands`
      );
    }
  });

  test("the running balance of the last entry is the closing balance", async () => {
    const report = await generalLedgerReport([cash, expense], WHOLE_TIME, [company]);

    for (const a of report.accounts) {
      if (!a.entries.length) continue;
      assert.equal(
        Math.round(a.entries[a.entries.length - 1].balance * 100),
        Math.round(a.closing * 100)
      );
    }
  });

  test("an account of a Company the reader cannot see is not reported", async () => {
    const report = await generalLedgerReport([cash], WHOLE_TIME, [-1]);
    assert.deepEqual(report.accounts, [], "the query is scoped, not the picker");
  });

  test("asking for no account reports nothing", async () => {
    const report = await generalLedgerReport([], WHOLE_TIME, [company]);
    assert.deepEqual(report.accounts, []);
  });
});

describe("the trial balance balances", () => {
  test("total debits equal total credits, per currency", async () => {
    const report = await trialBalanceReport(WHOLE_TIME, [company]);
    assert.ok(report.groups.length > 0, "the cases above posted journals");

    for (const g of report.groups) {
      assert.equal(
        Math.round(g.totalDebit * 100),
        Math.round(g.totalCredit * 100),
        `${g.currencyLabel} must balance — every journal in it does`
      );
      assert.equal(g.balanced, true);
    }
  });

  test("it reports no unbalanced journal, because none can exist", async () => {
    const report = await trialBalanceReport(WHOLE_TIME, [company]);
    assert.deepEqual(report.unbalanced, []);
  });

  test("a period before any journal still answers, with nothing in it", async () => {
    const report = await trialBalanceReport(
      { from: "1990-01-01", to: "1990-12-31" },
      [company]
    );
    assert.deepEqual(report.groups, [], "no line was posted by 1990");
  });
});

describe("the Journal has no write capability of its own", () => {
  test("the catalogue grants viewing and nothing else", () => {
    const journalPermissions = PERMISSION_CODES.filter((c) =>
      c.startsWith("JOURNAL_")
    );
    assert.deepEqual(
      journalPermissions,
      ["JOURNAL_VIEW"],
      "a journal is written by posting; there is nothing to create, edit or delete"
    );
  });

  test("the new reports are in the catalogue and in the menu", () => {
    for (const key of ["general_ledger", "trial_balance"]) {
      const report = REPORTS.find((r) => r.key === key);
      assert.ok(report, `${key} must be a catalogue entry`);
      assert.equal(report.module, "accounting");

      const inMenu = MODULES.flatMap((m) =>
        (m.groups ?? []).flatMap((g) => g.entities)
      ).find((e) => e.slug === `report/${report.slug}`);
      assert.ok(inMenu, `${report.slug} must have a menu entry`);
      assert.equal(inMenu.permission, report.permission);
    }
  });

  test("Journal itself has a menu entry pointing at a real route", () => {
    const entry = MODULES.flatMap((m) =>
      (m.groups ?? []).flatMap((g) => g.entities)
    ).find((e) => e.key === "acc_journal");
    assert.ok(entry, "a menu destination always renders (§12)");
    assert.equal(entry.slug, "journal");
    assert.equal(entry.permission, "JOURNAL_VIEW");
  });
});
