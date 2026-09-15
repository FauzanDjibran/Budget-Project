import test, { after, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES, YEAR_OPTIONS, entityBySlug } from "../src/lib/siba/entities";
import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import { hasEntityPermissions } from "../src/lib/siba/entity-access";
import { MODULES } from "../src/lib/siba/nav";
import {
  ensureFiscalPeriods,
  fiscalYearPeriods,
  fiscalYearShape,
  parseYear,
} from "../src/lib/siba/fiscal";
import { formatDate, formatTimestamp, toDisplayDate, toIsoDate } from "../src/lib/format";
import { disconnect, prisma, systemUserId } from "./helpers";

/**
 * The fiscal calendar, and the date format the whole application reads in.
 *
 * Two things have to hold. A Fiscal Period is never authored — it has no menu,
 * no route and no permissions of its own, and opening a Fiscal Year is what
 * produces exactly twelve of them, one per calendar month. And every date shown
 * anywhere is `dd/mm/yyyy`, which is one function's job.
 */

const FIXTURE_YEAR = 2087; // Far enough out that no real data uses it.

after(async () => {
  const years = await prisma.accFiscalYear.findMany({
    where: { year_label: { in: [String(FIXTURE_YEAR), String(FIXTURE_YEAR + 1)] } },
    select: { id: true },
  });
  const ids = years.map((y) => y.id);
  if (ids.length) {
    await prisma.accFiscalPeriod.deleteMany({ where: { fiscal_year_id: { in: ids } } });
    await prisma.accFiscalYear.deleteMany({ where: { id: { in: ids } } });
  }
  await disconnect();
});

async function makeYear(year: number, status: "Draft" | "Open") {
  const shape = fiscalYearShape(year);
  const row = await prisma.accFiscalYear.create({
    data: {
      year_code: `test.fyr.${year}`,
      year_label: String(year),
      ...shape,
      status,
      created_by: await systemUserId(),
    },
    select: { id: true },
  });
  return row.id;
}

// ------------------------------------------------------------- date format

describe("every date reads dd/mm/yyyy", () => {
  test("a calendar date formats day first", () => {
    assert.equal(formatDate("2026-09-02"), "02/09/2026");
    assert.equal(formatDate("2026-12-31"), "31/12/2026");
    // The case that gives the format away: a day that cannot be a month.
    assert.equal(formatDate("2026-01-25"), "25/01/2026");
  });

  test("a timestamp keeps the same date format", () => {
    assert.match(formatTimestamp("2026-09-02T14:05:00Z"), /^02\/09\/2026 • 14:05$/);
  });

  test("an empty value formats to nothing rather than to today", () => {
    assert.equal(formatDate(null), "");
    assert.equal(formatDate(undefined), "");
    assert.equal(formatDate(""), "");
  });

  test("the field's two directions round-trip", () => {
    assert.equal(toDisplayDate("2026-09-02"), "02/09/2026");
    assert.equal(toIsoDate("02/09/2026"), "2026-09-02");
    assert.equal(toIsoDate(toDisplayDate("2028-02-29")), "2028-02-29");
  });

  test("a date that does not exist is refused, not rolled forward", () => {
    // 31/02 parses arithmetically as 3 March; accepting it would save a date
    // nobody typed.
    assert.equal(toIsoDate("31/02/2026"), "");
    assert.equal(toIsoDate("29/02/2026"), "", "2026 is not a leap year");
    assert.equal(toIsoDate("29/02/2028"), "2028-02-29", "2028 is");
    assert.equal(toIsoDate("00/01/2026"), "");
    assert.equal(toIsoDate("01/13/2026"), "");
    assert.equal(toIsoDate("2026-09-02"), "", "ISO is not the input format");
  });
});

// ------------------------------------------------- fiscal period has no home

describe("Fiscal Period is reachable only through Fiscal Year", () => {
  test("it is not a registry entity, so it has no route", () => {
    assert.equal(entityBySlug("fiscal-period"), undefined);
    assert.ok(!ENTITIES.some((e) => e.key === "acc_fiscal_period"));
  });

  test("it appears in no menu", () => {
    const leaves = MODULES.flatMap((m) =>
      (m.groups ?? []).flatMap((g) => g.entities.map((e) => e.slug))
    );
    assert.ok(!leaves.includes("fiscal-period"), "Fiscal Period must not be a menu item");
    assert.ok(leaves.includes("fiscal-year"), "Fiscal Year is the top-level entity");
  });

  test("it declares no permissions, because it has nothing to authorize", () => {
    assert.equal(hasEntityPermissions("acc_fiscal_period"), false);
    for (const code of PERMISSION_CODES) {
      assert.ok(
        !code.startsWith("FISCAL_PERIOD"),
        `${code} governs a screen that no longer exists`
      );
    }
  });
});

// ------------------------------------------------------ the year is a choice

describe("a Fiscal Year is created by choosing a year", () => {
  test("the form offers years, not free text", () => {
    const entity = entityBySlug("fiscal-year")!;
    const field = entity.fields.find((f) => f.name === "year_label")!;
    assert.equal(field.type, "select");
    assert.deepEqual(field.options, YEAR_OPTIONS);
    assert.ok(YEAR_OPTIONS.includes(String(new Date().getUTCFullYear())));
  });

  test("name and date range are derived, never typed", () => {
    const entity = entityBySlug("fiscal-year")!;
    for (const name of ["year_name", "start_date", "end_date"]) {
      const field = entity.fields.find((f) => f.name === name)!;
      assert.equal(field.derived, true, `${name} must not be an input`);
      assert.ok(!field.required, `${name} cannot be required of the user`);
    }
  });

  test("choosing a year fixes 01/01 to 31/12 of it", () => {
    const shape = fiscalYearShape(2028);
    assert.equal(shape.year_name, "Tahun Buku 2028");
    assert.equal(formatDate(shape.start_date), "01/01/2028");
    assert.equal(formatDate(shape.end_date), "31/12/2028");
  });

  test("a label that is not a year is refused", () => {
    assert.equal(parseYear("2028"), 2028);
    assert.equal(parseYear("28"), null);
    assert.equal(parseYear("Tahun Buku 2028"), null);
    assert.equal(parseYear(""), null);
    assert.equal(parseYear(null), null);
  });
});

// ------------------------------------------------------ opening generates 12

describe("opening a Fiscal Year generates its twelve months", () => {
  test("exactly twelve periods, one per calendar month, with real end dates", async () => {
    const id = await makeYear(FIXTURE_YEAR, "Open");
    const made = await ensureFiscalPeriods(prisma, {
      fiscalYearId: id,
      year: FIXTURE_YEAR,
      actorId: await systemUserId(),
    });
    assert.equal(made, 12);

    const periods = await fiscalYearPeriods(id);
    assert.equal(periods.length, 12, "a year has twelve months, no more and no fewer");

    assert.deepEqual(
      periods.map((p) => p.sequence),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    );
    assert.deepEqual(
      periods.map((p) => p.label),
      Array.from({ length: 12 }, (_, i) => `${FIXTURE_YEAR}-${String(i + 1).padStart(2, "0")}`)
    );

    assert.equal(periods[0].name, `Januari ${FIXTURE_YEAR}`);
    assert.equal(periods[11].name, `Desember ${FIXTURE_YEAR}`);

    // Each period starts on the first and ends on the real last day — the
    // 30/31-day months and February included.
    const expectedEnds = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (const [i, p] of periods.entries()) {
      const month = String(i + 1).padStart(2, "0");
      assert.equal(p.startDate, `${FIXTURE_YEAR}-${month}-01`, `${p.label} starts on the 1st`);
      assert.equal(
        p.endDate,
        `${FIXTURE_YEAR}-${month}-${expectedEnds[i]}`,
        `${p.label} ends on the last day of the month`
      );
    }

    // And the whole year is covered exactly once: no gap, no overlap.
    assert.equal(periods[0].startDate, `${FIXTURE_YEAR}-01-01`);
    assert.equal(periods[11].endDate, `${FIXTURE_YEAR}-12-31`);
    for (let i = 1; i < periods.length; i += 1) {
      const previousEnd = new Date(`${periods[i - 1].endDate}T00:00:00Z`);
      previousEnd.setUTCDate(previousEnd.getUTCDate() + 1);
      assert.equal(
        periods[i].startDate,
        previousEnd.toISOString().slice(0, 10),
        `${periods[i].label} must start the day after the previous period ends`
      );
    }
  });

  test("February gets 29 days in a leap year", async () => {
    const leap = FIXTURE_YEAR + 1; // 2088 is a leap year.
    assert.equal(leap % 4, 0);
    const id = await makeYear(leap, "Open");
    await ensureFiscalPeriods(prisma, {
      fiscalYearId: id,
      year: leap,
      actorId: await systemUserId(),
    });
    const periods = await fiscalYearPeriods(id);
    assert.equal(periods[1].endDate, `${leap}-02-29`);
  });

  test("re-opening a year does not duplicate its months", async () => {
    const year = await prisma.accFiscalYear.findFirstOrThrow({
      where: { year_label: String(FIXTURE_YEAR) },
      select: { id: true },
    });
    const again = await ensureFiscalPeriods(prisma, {
      fiscalYearId: year.id,
      year: FIXTURE_YEAR,
      actorId: await systemUserId(),
    });
    assert.equal(again, 0, "a year that already has periods is left alone");
    assert.equal((await fiscalYearPeriods(year.id)).length, 12);
  });

  test("a Draft year has no periods until it is opened", async () => {
    const id = await makeYear(FIXTURE_YEAR + 100, "Draft");
    assert.deepEqual(await fiscalYearPeriods(id), []);
    await prisma.accFiscalYear.delete({ where: { id } });
  });
});
