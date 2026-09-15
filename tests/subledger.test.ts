import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  SUBLEDGERS,
  subledgerByKey,
  subledgerBySlug,
  subledgerForCategory,
  subledgerMovement,
} from "../src/lib/siba/subledger-catalogue";
import {
  recordSubledgerEntry,
  rebuildSubledgerBalance,
  subledgerReport,
  subledgerSubjects,
} from "../src/lib/siba/subledger";
import { BUDGET_CATEGORY_RULES, PURPOSES } from "../src/lib/siba/rules";
import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import { REPORTS, reportBySlug } from "../src/lib/siba/reports";
import { MODULES } from "../src/lib/siba/nav";
import {
  FIXTURE_PREFIX,
  cleanupFixtures,
  disconnect,
  makePartner,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The subject books — Titipan, Hutang, Piutang, Prive, Investasi and Hasil
 * Investasi.
 *
 * A subledger is the Cash Bank Book with a Partner as its subject: an
 * independent, append-only historical store written straight from the business
 * transaction at Post, never derived from a journal line (concept doc §11,
 * §13, §14). Three things have to hold, and each is tested below.
 *
 *  1. The catalogue and the categories agree — every category that names a
 *     Partner keeps a book, and every book knows which way it moves.
 *  2. A book signs by **its own** direction, not by the cash direction. Money
 *     leaving the company raises a Piutang and lowers a Hutang; a book that
 *     mirrored the cash flow would report every position backwards.
 *  3. The report reconciles: `opening + naik − turun = closing`, per subject
 *     and per currency, with the period inclusive at both ends.
 *
 * The suite builds its own fixtures and removes them: the seed carries system
 * data only, so nothing here may assume a particular row exists.
 */

let induk = 0;
let actor = 0;
let currency = 0;

before(async () => {
  induk = await parentCompanyId();
  actor = await systemUserId();
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

// ----------------------------------------------------------- the catalogue

describe("a category keeps a book exactly when it names a Partner", () => {
  test("every book names a real Budget Category", () => {
    for (const book of SUBLEDGERS) {
      assert.ok(
        BUDGET_CATEGORY_RULES[book.budgetCategory],
        `${book.name} names Budget Category "${book.budgetCategory}", which rules.ts does not declare`
      );
    }
  });

  test("every category that takes a Partner has a book, and no other does", () => {
    for (const [label, rule] of Object.entries(BUDGET_CATEGORY_RULES)) {
      const book = subledgerForCategory(label);
      if (rule.partnerCategories.length) {
        assert.ok(
          book,
          `${label} names a Partner, so its postings move a subject — that subject needs a book`
        );
      } else {
        assert.equal(
          book,
          null,
          `${label} takes no Partner, so a book of it would have no subject`
        );
      }
    }
  });

  test("a book rises in a direction its category actually allows", () => {
    for (const book of SUBLEDGERS) {
      const rule = BUDGET_CATEGORY_RULES[book.budgetCategory];
      assert.ok(
        rule.directions.includes(book.raises),
        `${book.name} claims to rise on ${book.raises}, which ${book.budgetCategory} never does`
      );
    }
  });

  test("every Purpose that names a Partner posts into a book", () => {
    for (const purpose of PURPOSES) {
      if (!purpose.partnerCategory) continue;
      assert.ok(
        subledgerForCategory(purpose.budgetCategory),
        `${purpose.label} moves a Partner but lands in no subject book`
      );
    }
  });

  test("keys, slugs and permissions are unique and catalogued", () => {
    const keys = new Set<string>();
    const slugs = new Set<string>();
    for (const book of SUBLEDGERS) {
      assert.ok(!keys.has(book.key), `duplicate book key ${book.key}`);
      assert.ok(!slugs.has(book.slug), `duplicate book slug ${book.slug}`);
      keys.add(book.key);
      slugs.add(book.slug);

      assert.ok(
        PERMISSION_CODES.includes(book.permission),
        `${book.permission} is not in the permission catalogue — a capability is a catalogue entry first`
      );
      assert.equal(subledgerByKey(book.key)?.key, book.key);
      assert.equal(subledgerBySlug(book.slug)?.key, book.key);
    }
  });

  test("every book has a Report View and a menu entry that reaches it", () => {
    const menu = MODULES.find((m) => m.key === "finance")!
      .groups!.find((g) => g.key === "report")!.entities;

    for (const book of SUBLEDGERS) {
      const report = reportBySlug(book.slug);
      assert.ok(report, `${book.name} has no entry in reports.ts`);
      assert.equal(report.module, "finance");
      assert.equal(report.permission, book.permission);
      assert.equal(report.params, "subledger-period");
      assert.equal(report.subledger, book.key);

      const entry = menu.find((e) => e.slug === `report/${book.slug}`);
      assert.ok(entry, `${book.name} is not in Finance › Laporan`);
      assert.equal(entry.permission, book.permission);
    }

    assert.equal(
      REPORTS.filter((r) => r.subledger).length,
      SUBLEDGERS.length,
      "one Report View per book, no more and no fewer"
    );
  });
});

// ------------------------------------------------------------------ signing

describe("a book signs by its own direction, not by the cash direction", () => {
  const cases: [key: string, direction: "In" | "Out", expected: number][] = [
    // Liabilities: money received raises what is owed.
    ["hutang", "In", 100],
    ["hutang", "Out", -100],
    ["titipan", "In", 100],
    ["titipan", "Out", -100],
    // Assets and contra-equity: money paid out raises the position.
    ["piutang", "Out", 100],
    ["piutang", "In", -100],
    ["prive", "Out", 100],
    ["prive", "In", -100],
    ["investasi", "Out", 100],
    ["hasil-investasi", "In", 100],
  ];

  for (const [key, direction, expected] of cases) {
    test(`${key} ${direction} moves ${expected}`, () => {
      const book = subledgerByKey(key)!;
      assert.equal(subledgerMovement(book, direction, 100), expected);
    });
  }

  test("an amount's sign never comes from the caller", () => {
    const book = subledgerByKey("hutang")!;
    assert.equal(
      subledgerMovement(book, "In", -100),
      100,
      "direction carries the sign; a negative amount is still an amount"
    );
  });
});

// --------------------------------------------------------------- the book

describe("the book is append-only, and its total is derived", () => {
  test("no source file updates or deletes a subledger entry", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === "generated") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(join(process.cwd(), "src"));

    const forbidden = /\b(?:prisma|tx|db)\.subLedger\.(?:update|updateMany|delete|deleteMany|upsert)\b/;
    const offenders = files
      .filter((f) => forbidden.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(process.cwd().length + 1).replaceAll("\\", "/"));

    assert.deepEqual(
      offenders,
      [],
      "a subledger entry is never rewritten: a correction is a further entry, " +
        "which is the only reason the balance can always be re-derived"
    );
  });

  test("entries accumulate and the stored balance follows them", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    const entry = (date: string, direction: "In" | "Out", amount: number) =>
      prisma.$transaction((tx) =>
        recordSubledgerEntry(tx, {
          book: "hutang",
          partnerId: partner,
          currencyId: currency,
          date,
          type: "Transaction",
          direction,
          amount,
          note: `${FIXTURE_PREFIX} ${direction} ${amount}`,
          actorId: actor,
        })
      );

    await entry("2026-01-10", "In", 10_000_000);
    await entry("2026-02-05", "Out", 4_000_000);
    const third = await entry("2026-02-20", "In", 1_500_000);

    assert.equal(
      third.balance_after.toNumber(),
      7_500_000,
      "10.000.000 borrowed, 4.000.000 repaid, 1.500.000 borrowed again"
    );
    assert.equal(
      await rebuildSubledgerBalance("hutang", partner, currency),
      7_500_000,
      "and recomputing from the entries agrees with the stored total"
    );
  });

  test("an unknown book is refused rather than written", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    await assert.rejects(
      () =>
        prisma.$transaction((tx) =>
          recordSubledgerEntry(tx, {
            book: "tidak-ada",
            partnerId: partner,
            currencyId: currency,
            date: "2026-01-01",
            type: "Transaction",
            direction: "In",
            amount: 1_000,
            actorId: actor,
          })
        ),
      /katalog/i
    );
    assert.equal(await prisma.subLedger.count({ where: { partner_id: partner } }), 0);
  });

  test("two currencies are two positions, never one blended figure", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    const other = await prisma.refCurrency.create({
      data: {
        currency_code: `test.${FIXTURE_PREFIX}SUBCUR`,
        currency_label: `${FIXTURE_PREFIX}S`,
        currency_name: "Fixture currency",
        created_by: actor,
      },
      select: { id: true },
    });

    try {
      for (const [currencyId, amount] of [
        [currency, 5_000_000],
        [other.id, 700],
      ] as const) {
        await prisma.$transaction((tx) =>
          recordSubledgerEntry(tx, {
            book: "titipan",
            partnerId: partner,
            currencyId,
            date: "2026-03-01",
            type: "Transaction",
            direction: "In",
            amount,
            actorId: actor,
          })
        );
      }

      const report = await subledgerReport(
        "titipan",
        { from: "2026-01-01", to: "2026-12-31" },
        { partnerIds: [partner], companyIds: [induk] }
      );
      assert.equal(report!.subjects.length, 2, "one block per currency");
      assert.deepEqual(
        report!.subjects.map((s) => s.closing).sort((a, b) => a - b),
        [700, 5_000_000]
      );
    } finally {
      await prisma.subLedgerBalance.deleteMany({ where: { currency_id: other.id } });
      await prisma.subLedger.deleteMany({ where: { currency_id: other.id } });
      await prisma.refCurrency.delete({ where: { id: other.id } });
    }
  });
});

// -------------------------------------------------------------- the report

describe("a subledger report reconciles on its own page", () => {
  let partner = 0;

  before(async () => {
    partner = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const entries: [date: string, direction: "In" | "Out", amount: number][] = [
      ["2025-12-31", "Out", 2_000_000], // before the period: the opening
      ["2026-01-01", "Out", 1_000_000], // exactly `from`: inside
      ["2026-01-15", "In", 400_000],
      ["2026-01-31", "Out", 600_000], // exactly `to`: inside
      ["2026-02-01", "Out", 999_999], // after the period: excluded
    ];
    for (const [date, direction, amount] of entries) {
      await prisma.$transaction((tx) =>
        recordSubledgerEntry(tx, {
          book: "prive",
          partnerId: partner,
          currencyId: currency,
          date,
          type: "Transaction",
          direction,
          amount,
          actorId: actor,
        })
      );
    }
  });

  const january = { from: "2026-01-01", to: "2026-01-31" };

  test("opening + naik − turun = closing", async () => {
    const report = await subledgerReport("prive", january, {
      partnerIds: [partner],
      companyIds: [induk],
    });
    const subject = report!.subjects[0];

    assert.equal(subject.opening, 2_000_000, "everything before the period, folded");
    assert.equal(subject.raised, 1_600_000);
    assert.equal(subject.lowered, 400_000);
    assert.equal(
      subject.closing,
      subject.opening + subject.raised - subject.lowered
    );
    assert.equal(subject.closing, 3_200_000);
  });

  test("both ends of the range are inside it, and earlier rows are not listed", async () => {
    const report = await subledgerReport("prive", january, {
      partnerIds: [partner],
      companyIds: [induk],
    });
    const dates = report!.subjects[0].entries.map((e) => e.date);
    assert.deepEqual(dates, ["2026-01-01", "2026-01-15", "2026-01-31"]);
  });

  test("the stored running balance agrees with the report's arithmetic", async () => {
    const report = await subledgerReport("prive", january, {
      partnerIds: [partner],
      companyIds: [induk],
    });
    assert.equal(report!.subjects[0].reconciles, true);
  });

  test("a period with no movement still reports its position", async () => {
    const report = await subledgerReport(
      "prive",
      { from: "2026-06-01", to: "2026-06-30" },
      { partnerIds: [partner], companyIds: [induk] }
    );
    const subject = report!.subjects[0];
    assert.equal(subject.entries.length, 0);
    assert.equal(
      subject.closing,
      subject.opening,
      "empty is not zero — a quiet month still has a balance"
    );
    assert.equal(subject.closing, 4_199_999);
  });

  test("a Company the reader may not see is not reported", async () => {
    const report = await subledgerReport("prive", january, {
      partnerIds: [partner],
      companyIds: [-1],
    });
    assert.deepEqual(report!.subjects, [], "scope is applied in the query, not the UI");
  });

  test("the filter offers only subjects the book actually holds", async () => {
    const subjects = await subledgerSubjects("prive", [induk]);
    assert.ok(
      subjects.some((s) => s.id === partner),
      "a Partner with entries is offered"
    );
    const hutang = await subledgerSubjects("hutang", [induk]);
    assert.ok(
      !hutang.some((s) => s.id === partner),
      "and is not offered by a book it never moved in"
    );
  });

  test("an unknown book answers with nothing rather than guessing", async () => {
    assert.equal(
      await subledgerReport("tidak-ada", january, { companyIds: [induk] }),
      null
    );
    assert.deepEqual(await subledgerSubjects("tidak-ada", [induk]), []);
  });
});
