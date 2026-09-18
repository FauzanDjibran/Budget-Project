import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  type SubledgerDef,
  subledgerByKey,
  subledgerForCategory,
  subledgerMovement,
} from "../src/lib/siba/subledger-catalogue";
import { loadSubledgers } from "../src/lib/siba/subledger-data";
import {
  recordSubledgerEntry,
  rebuildSubledgerBalance,
  subledgerReport,
  subledgerSubjects,
} from "../src/lib/siba/subledger";
import { allPurposes } from "../src/lib/siba/purposes";
import { loadClassification } from "../src/lib/siba/classification-data";
import { directionsOf, ruleFor } from "../src/lib/siba/classification";
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
/**
 * The books, loaded once. They are Budget Categories now rather than a constant,
 * so the suite reads them the same way the application does.
 */
let books: SubledgerDef[] = [];

/** A book by the category it belongs to. Tests name categories, not codes. */
const bookOf = (categoryLabel: string): SubledgerDef => {
  const book = books.find((b) => b.budgetCategory === categoryLabel);
  assert.ok(book, `no subject book for Budget Category "${categoryLabel}"`);
  return book;
};

before(async () => {
  induk = await parentCompanyId();
  actor = await systemUserId();
  books = await loadSubledgers();
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

// The rules these three assertions read used to be a constant in rules.ts and
// are now rows. The properties are unchanged — a book still exists exactly where
// a category names a subject — but they are now checked against what the
// database actually holds, which is also what the application reads.
describe("a category keeps a book exactly when it names a Partner", () => {
  test("every book names a real Budget Category", async () => {
    const catalogue = await loadClassification();
    for (const book of books) {
      assert.ok(
        ruleFor(catalogue, book.budgetCategory),
        `${book.name} names Budget Category "${book.budgetCategory}", which no row declares`
      );
    }
  });

  test("every category that takes a Partner has a book, and no other does", async () => {
    for (const rule of await loadClassification()) {
      const book = subledgerForCategory(books, rule.id);
      if (rule.requirePartner) {
        assert.ok(
          book,
          `${rule.label} names a Partner, so its postings move a subject — that subject needs a book`
        );
      } else {
        assert.equal(
          book,
          null,
          `${rule.label} takes no Partner, so a book of it would have no subject`
        );
      }
    }
  });

  test("a book rises in a direction its category actually allows", async () => {
    const catalogue = await loadClassification();
    for (const book of books) {
      const rule = ruleFor(catalogue, book.budgetCategory);
      assert.ok(rule, `${book.budgetCategory} has no row`);
      assert.ok(
        directionsOf(rule!).includes(book.raises),
        `${book.name} claims to rise on ${book.raises}, which ${book.budgetCategory} never does`
      );
    }
  });

  test("every Purpose that names a Partner posts into a book", async () => {
    // The Purpose names a Budget Category; the **category** owns the book, so
    // this resolves through the category's id rather than through the label the
    // Purpose carries a copy of.
    const catalogue = await loadClassification();
    for (const purpose of await allPurposes()) {
      if (!purpose.partnerCategory) continue;
      const rule = ruleFor(catalogue, purpose.budgetCategory);
      assert.ok(rule, `${purpose.label} names an unknown Budget Category`);
      assert.ok(
        subledgerForCategory(books, rule.id),
        `${purpose.label} moves a Partner but lands in no subject book`
      );
    }
  });

  test("a book is identified by its category, on both keys", () => {
    const keys = new Set<string>();
    const ids = new Set<number>();
    for (const book of books) {
      assert.ok(!keys.has(book.key), `duplicate book key ${book.key}`);
      assert.ok(!ids.has(book.categoryId), `duplicate category id ${book.categoryId}`);
      keys.add(book.key);
      ids.add(book.categoryId);

      // The stored key is the category's immutable code, which is what makes a
      // rename unable to orphan a book.
      assert.match(book.key, /^bcat\./);
      assert.equal(subledgerByKey(books, book.key)?.key, book.key);
      assert.equal(subledgerForCategory(books, book.categoryId)?.key, book.key);
    }
  });

  test("one Report View covers every book, and one menu entry reaches it", () => {
    // This is the property the whole arrangement rests on: a book added through
    // Master › Klasifikasi needs no report, no permission and no menu entry
    // written for it. If this ever becomes one-report-per-book again, a new
    // category silently has no way to be read.
    const subledgerReports = REPORTS.filter((r) => r.subledger);
    assert.equal(
      subledgerReports.length,
      1,
      "one Report View for every book — the book is a parameter, not a report"
    );

    const report = reportBySlug("subledger");
    assert.ok(report, "the Buku Subjek report is missing from reports.ts");
    assert.equal(report.module, "finance");
    assert.equal(report.params, "subledger-period");
    assert.equal(report.subledger, true);
    assert.equal(report.permission, "REPORT_SUBLEDGER_VIEW");
    assert.ok(
      PERMISSION_CODES.includes(report.permission),
      "a capability is a catalogue entry first"
    );

    const menu = MODULES.find((m) => m.key === "finance")!
      .groups!.find((g) => g.key === "report")!.entities;
    const entries = menu.filter((e) => e.slug === "report/subledger");
    assert.equal(entries.length, 1, "exactly one menu entry reaches the books");
    assert.equal(entries[0].permission, report.permission);

    // And no menu entry still points at a per-book report that no longer exists.
    for (const e of menu) {
      assert.ok(
        ![
          "report/titipan",
          "report/hutang",
          "report/piutang",
          "report/prive",
          "report/investasi",
          "report/hasil-investasi",
        ].includes(e.slug),
        `${e.slug} is a per-book report route that no longer exists`
      );
    }
  });
});

// ------------------------------------------------------------------ signing

describe("a book signs by its own direction, not by the cash direction", () => {
  const cases: [category: string, direction: "In" | "Out", expected: number][] = [
    // Liabilities: money received raises what is owed.
    ["Hutang", "In", 100],
    ["Hutang", "Out", -100],
    ["Titipan", "In", 100],
    ["Titipan", "Out", -100],
    // Assets and contra-equity: money paid out raises the position.
    ["Piutang", "Out", 100],
    ["Piutang", "In", -100],
    ["Prive", "Out", 100],
    ["Prive", "In", -100],
    ["Investasi", "Out", 100],
    ["Hasil Investasi", "In", 100],
  ];

  for (const [category, direction, expected] of cases) {
    test(`${category} ${direction} moves ${expected}`, () => {
      assert.equal(subledgerMovement(bookOf(category), direction, 100), expected);
    });
  }

  test("an amount's sign never comes from the caller", () => {
    const book = bookOf("Hutang");
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
          book: bookOf("Hutang"),
          partnerId: partner,
          currencyId: currency,
          date,
          type: "Transaction",
          direction,
          amount,
          rate: 1,
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
      (await rebuildSubledgerBalance(bookOf("Hutang").key, partner, currency)).balance,
      7_500_000,
      "and recomputing from the entries agrees with the stored total"
    );
  });

  test("a category that keeps no book yields none to write to", async () => {
    // The writer used to take a key and throw on one it did not recognise.
    // It takes the book itself now, so an unwritable book is unrepresentable
    // rather than refused — the check moved to where the book is resolved.
    const catalogue = await loadClassification();
    for (const label of ["Asset", "Biaya"]) {
      const rule = ruleFor(catalogue, label);
      assert.ok(rule, `${label} has no row`);
      assert.equal(
        subledgerForCategory(books, rule.id),
        null,
        `${label} names no Partner, so there is no book to post its subject into`
      );
    }
    assert.equal(
      subledgerForCategory(books, -1),
      null,
      "an unknown category resolves to no book rather than to the first one"
    );
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
            book: bookOf("Titipan"),
            partnerId: partner,
            currencyId,
            date: "2026-03-01",
            type: "Transaction",
            direction: "In",
            amount,
            rate: 1,
            actorId: actor,
          })
        );
      }

      const report = await subledgerReport(
        books,
        bookOf("Titipan").key,
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
          book: bookOf("Prive"),
          partnerId: partner,
          currencyId: currency,
          date,
          type: "Transaction",
          direction,
          amount,
          rate: 1,
          actorId: actor,
        })
      );
    }
  });

  const january = { from: "2026-01-01", to: "2026-01-31" };

  test("opening + naik − turun = closing", async () => {
    const report = await subledgerReport(books, bookOf("Prive").key, january, {
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
    const report = await subledgerReport(books, bookOf("Prive").key, january, {
      partnerIds: [partner],
      companyIds: [induk],
    });
    const dates = report!.subjects[0].entries.map((e) => e.date);
    assert.deepEqual(dates, ["2026-01-01", "2026-01-15", "2026-01-31"]);
  });

  test("the stored running balance agrees with the report's arithmetic", async () => {
    const report = await subledgerReport(books, bookOf("Prive").key, january, {
      partnerIds: [partner],
      companyIds: [induk],
    });
    assert.equal(report!.subjects[0].reconciles, true);
  });

  test("a period with no movement still reports its position", async () => {
    const report = await subledgerReport(
      books,
      bookOf("Prive").key,
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
    const report = await subledgerReport(books, bookOf("Prive").key, january, {
      partnerIds: [partner],
      companyIds: [-1],
    });
    assert.deepEqual(report!.subjects, [], "scope is applied in the query, not the UI");
  });

  test("the filter offers only subjects the book actually holds", async () => {
    const subjects = await subledgerSubjects(books, bookOf("Prive").key, [induk]);
    assert.ok(
      subjects.some((s) => s.id === partner),
      "a Partner with entries is offered"
    );
    const hutang = await subledgerSubjects(books, bookOf("Hutang").key, [induk]);
    assert.ok(
      !hutang.some((s) => s.id === partner),
      "and is not offered by a book it never moved in"
    );
  });

  test("an unknown book answers with nothing rather than guessing", async () => {
    assert.equal(
      await subledgerReport(books, "bcat.9999", january, { companyIds: [induk] }),
      null
    );
    assert.deepEqual(await subledgerSubjects(books, "bcat.9999", [induk]), []);
  });
});

// --------------------------------------------------- the position's own rate

describe("a position carries a rate, and it is derived from what built it", () => {
  test("a rate is required, and must be a real one", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    for (const rate of [0, -1, Number.NaN]) {
      await assert.rejects(
        () =>
          prisma.$transaction((tx) =>
            recordSubledgerEntry(tx, {
              book: bookOf("Hutang"),
              partnerId: partner,
              currencyId: currency,
              date: "2026-03-01",
              type: "Transaction",
              direction: "In",
              amount: 1_000,
              rate,
              actorId: actor,
            })
          ),
        /Kurs/,
        `a rate of ${rate} should be refused outright`
      );
    }
  });

  test("the base measure is signed by the book's direction, like the foreign one", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    // Hutang rises on In and falls on Out. Both measures follow that together,
    // or a position could reach zero foreign against a base nobody can explain.
    await prisma.$transaction((tx) =>
      recordSubledgerEntry(tx, {
        book: bookOf("Hutang"),
        partnerId: partner,
        currencyId: currency,
        date: "2026-03-01",
        type: "Transaction",
        direction: "In",
        amount: 1_000,
        rate: 15_000,
        actorId: actor,
      })
    );
    const raised = await prisma.subLedger.findFirstOrThrow({
      where: { book: bookOf("Hutang").key, partner_id: partner },
    });
    assert.equal(raised.movement.toNumber(), 1_000);
    assert.equal(raised.base_movement.toNumber(), 15_000_000);

    await prisma.$transaction((tx) =>
      recordSubledgerEntry(tx, {
        book: bookOf("Hutang"),
        partnerId: partner,
        currencyId: currency,
        date: "2026-03-02",
        type: "Transaction",
        direction: "Out",
        amount: 400,
        rate: 15_000,
        actorId: actor,
      })
    );
    const lowered = await prisma.subLedger.findFirstOrThrow({
      where: { book: bookOf("Hutang").key, partner_id: partner, direction: "Out" },
    });
    assert.equal(lowered.movement.toNumber(), -400);
    assert.equal(lowered.base_movement.toNumber(), -6_000_000);
    assert.equal(
      lowered.base_amount.toNumber(),
      6_000_000,
      "the amount itself stays positive on both measures"
    );

    const rebuilt = await rebuildSubledgerBalance(bookOf("Hutang").key, partner, currency);
    assert.deepEqual(rebuilt, { balance: 600, baseBalance: 9_000_000 });
  });

  test("the report derives a carrying rate, and none at a nil position", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    // Two borrowings at different rates. The position then carries at a
    // weighted average that appeared in neither — which is exactly why the
    // figure is derived on read and stored nowhere.
    for (const [amount, rate] of [
      [200, 15_000],
      [300, 15_500],
    ] as const) {
      await prisma.$transaction((tx) =>
        recordSubledgerEntry(tx, {
          book: bookOf("Hutang"),
          partnerId: partner,
          currencyId: currency,
          date: "2026-03-05",
          type: "Transaction",
          direction: "In",
          amount,
          rate,
          actorId: actor,
        })
      );
    }

    const march = { from: "2026-03-01", to: "2026-03-31" };
    const report = await subledgerReport(books, bookOf("Hutang").key, march, {
      partnerIds: [partner],
      companyIds: [induk],
    });
    const subject = report!.subjects[0];
    assert.equal(subject.closing, 500);
    assert.equal(subject.baseClosing, 3_000_000 + 4_650_000);
    assert.equal(subject.carryingRate, 15_300, "weighted, not either rate quoted");
    assert.ok(subject.reconciles, "both measures agree with the stored total");

    // Settle it to nothing. The position then has no rate at all.
    await prisma.$transaction((tx) =>
      recordSubledgerEntry(tx, {
        book: bookOf("Hutang"),
        partnerId: partner,
        currencyId: currency,
        date: "2026-03-20",
        type: "Transaction",
        direction: "Out",
        amount: 500,
        rate: 15_300,
        baseAmount: 7_650_000,
        actorId: actor,
      })
    );
    const cleared = await subledgerReport(books, bookOf("Hutang").key, march, {
      partnerIds: [partner],
      companyIds: [induk],
    });
    const closed = cleared!.subjects[0];
    assert.equal(closed.closing, 0);
    assert.equal(closed.baseClosing, 0, "zero foreign means zero base");
    assert.equal(
      closed.carryingRate,
      null,
      "a position holding nothing has no rate — null, never zero"
    );
  });

  test("opening + naik - turun = closing holds on the base measure too", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    for (const [date, direction, amount, rate] of [
      ["2026-01-10", "In", 1_000, 15_000],
      ["2026-02-14", "In", 500, 16_000],
      ["2026-02-20", "Out", 300, 15_333.333333],
    ] as const) {
      await prisma.$transaction((tx) =>
        recordSubledgerEntry(tx, {
          book: bookOf("Hutang"),
          partnerId: partner,
          currencyId: currency,
          date,
          type: "Transaction",
          direction,
          amount,
          rate,
          actorId: actor,
        })
      );
    }

    // February only, so January folds into the opening on both measures.
    const february = { from: "2026-02-01", to: "2026-02-28" };
    const report = await subledgerReport(books, bookOf("Hutang").key, february, {
      partnerIds: [partner],
      companyIds: [induk],
    });
    const s = report!.subjects[0];

    assert.equal(s.opening, 1_000);
    assert.equal(s.baseOpening, 15_000_000);
    assert.equal(
      s.baseOpening + s.baseRaised - s.baseLowered,
      s.baseClosing,
      "the report's own base arithmetic closes"
    );
    assert.equal(
      s.opening + s.raised - s.lowered,
      s.closing,
      "and so does its foreign arithmetic"
    );
    assert.ok(s.reconciles, "both agree with the running balance the book stored");
  });
});
