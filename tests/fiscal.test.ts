import test, { after, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES, YEAR_OPTIONS, entityBySlug } from "../src/lib/siba/entities";
import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import { hasEntityPermissions } from "../src/lib/siba/entity-access";
import { MODULES } from "../src/lib/siba/nav";
import {
  checkPostingPeriod,
  checkYearOpenable,
  ensureFiscalPeriods,
  fiscalYearPeriods,
  fiscalYearShape,
  openFiscalYears,
  parseYear,
} from "../src/lib/siba/fiscal";
import {
  FISCAL_YEAR_TRANSITIONS,
  MAX_OPEN_FISCAL_YEARS,
  availableActions,
  fiscalYearAbilities,
  openLimitRefusal,
  transitionAllowed,
  type FiscalYearStatus,
} from "../src/lib/siba/fiscal-workflow";
import { formatDate, formatTimestamp, toDisplayDate, toIsoDate } from "../src/lib/format";
import {
  childCompanyId,
  closeYearFor,
  disconnect,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The fiscal calendar, and the date format the whole application reads in.
 *
 * Three things have to hold. A Fiscal Period is never authored — it has no
 * menu, no route and no permissions of its own, and opening a Fiscal Year is
 * what produces exactly twelve of them, one per calendar month. A Fiscal Year
 * has a lifecycle rather than a status field, so Draft -> Open is a deliberate
 * act and nothing goes back. And every date shown anywhere is `dd/mm/yyyy`,
 * which is one function's job.
 */

const FIXTURE_YEAR = 2087; // Far enough out that no real data uses it.

// The lock's own years, each one state it has to tell apart.
const LOCK_DRAFT_YEAR = 2081;
const LOCK_CLOSED_YEAR = 2082;
const LOCK_OPEN_YEAR = 2083;
const LOCK_THIRD_YEAR = 2084;
const LOCK_FILLER_YEAR = 2085;

after(async () => {
  // Keyed on the code this file writes rather than on a list of labels: the
  // lock cases added several more years, and a list is a thing to forget.
  const years = await prisma.accFiscalYear.findMany({
    where: { year_code: { startsWith: "test.fyr." } },
    select: { id: true },
  });
  const ids = years.map((y) => y.id);
  if (ids.length) {
    await prisma.accFiscalClosing.deleteMany({ where: { fiscal_year_id: { in: ids } } });
    await prisma.accFiscalPeriod.deleteMany({ where: { fiscal_year_id: { in: ids } } });
    await prisma.accFiscalYear.deleteMany({ where: { id: { in: ids } } });
  }
  await disconnect();
});

async function makeYear(year: number, status: "Draft" | "Open" | "Closed") {
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

// ---------------------------------------------------- the year has a lifecycle

describe("a Fiscal Year is activated, not edited into Open", () => {
  test("status is not an isian on the form", () => {
    const field = entityBySlug("fiscal-year")!.fields.find((f) => f.name === "status")!;
    assert.equal(field.derived, true, "status must never be offered as an input");
    assert.equal(
      field.locked,
      true,
      "and an update must drop it, so a submitted value cannot move the year"
    );
  });

  test("the entity has no activate/deactivate toggle either", () => {
    const entity = entityBySlug("fiscal-year")!;
    assert.equal(entity.statusModel?.toggle, false);
    assert.deepEqual(entity.statusModel?.options, ["Draft", "Open", "Closed"]);
  });

  test("opening is its own permission, separate from editing", () => {
    assert.equal(FISCAL_YEAR_TRANSITIONS.open.permission, "FISCAL_YEAR_OPEN");
    assert.ok(PERMISSION_CODES.includes("FISCAL_YEAR_OPEN" as never));
    assert.notEqual(
      FISCAL_YEAR_TRANSITIONS.open.permission,
      "FISCAL_YEAR_EDIT",
      "editing a year's note is not permission to start it"
    );
  });

  test("Draft is the only status a year can be opened from", () => {
    assert.deepEqual(FISCAL_YEAR_TRANSITIONS.open.from, ["Draft"]);
    assert.equal(FISCAL_YEAR_TRANSITIONS.open.to, "Open");
    assert.equal(transitionAllowed("open", "Draft"), true);
    assert.equal(transitionAllowed("open", "Open"), false, "reopening is not a move");
    assert.equal(transitionAllowed("open", "Closed"), false);
  });

  test("nothing returns a year to Draft", () => {
    for (const transition of Object.values(FISCAL_YEAR_TRANSITIONS)) {
      assert.notEqual(transition.to, "Draft", "Open is a one-way door");
    }
  });

  test("Closed is reached only by the closing process", () => {
    // Closing exists now, and it is still not a status change: the one
    // transition that produces Closed carries a `runAt`, so it is run on a
    // screen that checks the year, previews the journal and asks once — never
    // as a value anybody picks.
    const producing = Object.entries(FISCAL_YEAR_TRANSITIONS).filter(
      ([, t]) => t.to === "Closed"
    );
    assert.deepEqual(
      producing.map(([key]) => key),
      ["close"],
      "exactly one transition closes a year"
    );
    assert.deepEqual(FISCAL_YEAR_TRANSITIONS.close.from, ["Open"]);
    assert.equal(FISCAL_YEAR_TRANSITIONS.close.permission, "FISCAL_YEAR_CLOSE");
    assert.ok(
      PERMISSION_CODES.includes("FISCAL_YEAR_CLOSE" as never),
      "the permission lands in the change that builds the process, never before"
    );
    assert.equal(
      FISCAL_YEAR_TRANSITIONS.close.runAt,
      "/accounting/closing",
      "a step that needs a Company, a checklist and a preview is not a confirm button"
    );
  });

  test("the button appears only for someone holding the permission", () => {
    const allowed = fiscalYearAbilities(["FISCAL_YEAR_OPEN"]);
    const editorOnly = fiscalYearAbilities(["FISCAL_YEAR_EDIT", "FISCAL_YEAR_VIEW"]);

    assert.deepEqual(availableActions("Draft" as FiscalYearStatus, allowed), ["open"]);
    assert.deepEqual(
      availableActions("Draft" as FiscalYearStatus, editorOnly),
      [],
      "seeing and editing a year is not permission to start it"
    );
    assert.deepEqual(availableActions("Open" as FiscalYearStatus, allowed), []);
  });

  test("closing is never offered as a header button", () => {
    // It has its own screen. Offering it here as well would be a one-click
    // version of a step that has to state its Company and show its journal.
    const everything = fiscalYearAbilities([
      "FISCAL_YEAR_OPEN",
      "FISCAL_YEAR_CLOSE",
    ]);
    for (const status of ["Draft", "Open", "Closed"] as FiscalYearStatus[]) {
      assert.ok(
        !availableActions(status, everything).includes("close"),
        `close must not be a header action on a ${status} year`
      );
    }
  });
});

// --------------------------------------------------- the calendar is the lock

/**
 * A book is writable only inside an Open year its Company has not closed.
 *
 * Every posting date in SIBA is today, so a closed past year is currently
 * unreachable by arithmetic alone. The guard exists anyway, deliberately: the
 * rule has to be *enforced* rather than incidental before the no-back-dating
 * rule is ever relaxed, and it is what refuses a second close.
 */
describe("the calendar decides what may be posted into it", () => {
  test("a date inside no fiscal year at all is refused, and says so", async () => {
    const refusal = await checkPostingPeriod(await parentCompanyId(), "2075-06-15");
    assert.equal(refusal.ok, false);
    assert.match(
      (refusal as { message: string }).message,
      /15\/06\/2075/,
      "the refusal names the date, because the reader has to know which one is outside"
    );
    assert.match((refusal as { message: string }).message, /tahun buku/i);
  });

  test("a Draft year is not yet, and is refused by name", async () => {
    const id = await makeYear(LOCK_DRAFT_YEAR, "Draft");
    const refusal = await checkPostingPeriod(
      await parentCompanyId(),
      `${LOCK_DRAFT_YEAR}-03-10`
    );
    assert.equal(refusal.ok, false);
    assert.match(
      (refusal as { message: string }).message,
      new RegExp(`Tahun Buku ${LOCK_DRAFT_YEAR}`),
      "a refusal that does not name the year leaves the reader nothing to act on"
    );
    assert.match((refusal as { message: string }).message, /Draft/);
    assert.ok(id);
  });

  test("a Closed year is never again", async () => {
    await makeYear(LOCK_CLOSED_YEAR, "Closed");
    const refusal = await checkPostingPeriod(
      await parentCompanyId(),
      `${LOCK_CLOSED_YEAR}-07-01`
    );
    assert.equal(refusal.ok, false);
    assert.match(
      (refusal as { message: string }).message,
      new RegExp(`Tahun Buku ${LOCK_CLOSED_YEAR}`)
    );
  });

  test("an Open year nobody has closed admits both Companies", async () => {
    const id = await makeYear(LOCK_OPEN_YEAR, "Open");
    for (const companyId of [await parentCompanyId(), await childCompanyId()]) {
      const allowed = await checkPostingPeriod(companyId, `${LOCK_OPEN_YEAR}-05-20`);
      assert.equal(allowed.ok, true);
      assert.equal((allowed as { fiscalYearId: number }).fiscalYearId, id);
    }
  });

  test("one Company closing a year does not close it for the other", async () => {
    const year = await prisma.accFiscalYear.findFirstOrThrow({
      where: { year_label: String(LOCK_OPEN_YEAR) },
      select: { id: true },
    });
    const induk = await parentCompanyId();
    const anak = await childCompanyId();

    // The closing process itself is Phase 4. What the lock reads is this row,
    // so this is what a test writes — which is the point of the state being a
    // record rather than an inference from somewhere else.
    const reopen = await closeYearFor(year.id, induk);

    const refused = await checkPostingPeriod(induk, `${LOCK_OPEN_YEAR}-05-20`);
    assert.equal(refused.ok, false, "the Company that closed the year may not post into it");
    assert.match((refused as { message: string }).message, /menutup/);

    const allowed = await checkPostingPeriod(anak, `${LOCK_OPEN_YEAR}-05-20`);
    assert.equal(
      allowed.ok,
      true,
      "the calendar is shared; closing it is not — the anak is still working in the year"
    );

    await reopen();
    assert.equal((await checkPostingPeriod(induk, `${LOCK_OPEN_YEAR}-05-20`)).ok, true);
  });

  test("an Open row is not a Closed one", async () => {
    const year = await prisma.accFiscalYear.findFirstOrThrow({
      where: { year_label: String(LOCK_OPEN_YEAR) },
      select: { id: true },
    });
    const induk = await parentCompanyId();
    const row = await prisma.accFiscalClosing.create({
      data: {
        fiscal_year_id: year.id,
        company_id: induk,
        status: "Open",
        created_by: await systemUserId(),
      },
      select: { id: true },
    });
    assert.equal(
      (await checkPostingPeriod(induk, `${LOCK_OPEN_YEAR}-05-20`)).ok,
      true,
      "a row exists for every year a Company is working in; only Closed shuts it"
    );
    await prisma.accFiscalClosing.delete({ where: { id: row.id } });
  });
});

describe("at most two fiscal years stand Open", () => {
  test("the limit is two, and the refusal names the year to close", () => {
    assert.equal(MAX_OPEN_FISCAL_YEARS, 2);
    assert.equal(openLimitRefusal([]), null);
    assert.equal(
      openLimitRefusal([{ id: 1, label: "2026", name: "Tahun Buku 2026" }]),
      null,
      "one open year is the ordinary case; the second is the year-end overlap"
    );

    const refusal = openLimitRefusal([
      { id: 2, label: "2027", name: "Tahun Buku 2027" },
      { id: 1, label: "2026", name: "Tahun Buku 2026" },
    ]);
    assert.ok(refusal);
    assert.match(
      refusal!,
      /Tutup Tahun Buku 2026/,
      "the oldest is the only one that can be closed next — a newer one would " +
        "leave an Open year with no successor to inherit into"
    );
    // Ordered by the rule, not by the caller: the list above is newest-first.
    assert.ok(!/Tutup Tahun Buku 2027/.test(refusal!));
  });

  test("activating a third year is refused", async () => {
    const candidate = await makeYear(LOCK_THIRD_YEAR, "Draft");

    // The years this file opened earlier are this file's to stand down, and
    // standing them down is what makes the count start from the database's own
    // rather than from whatever ran before. Nothing else is touched: a real
    // Open year belongs to whoever uses the database.
    await prisma.accFiscalYear.updateMany({
      where: { year_code: { startsWith: "test.fyr." }, id: { not: candidate } },
      data: { status: "Draft" },
    });

    const filler: number[] = [];
    let open = (await openFiscalYears()).filter((y) => y.id !== candidate);
    assert.ok(
      open.length < MAX_OPEN_FISCAL_YEARS,
      "the database itself holds fewer than the limit, so the rule can be reached from both sides"
    );
    while (open.length < MAX_OPEN_FISCAL_YEARS) {
      assert.equal(
        (await checkYearOpenable(candidate)).ok,
        true,
        "below the limit, a year opens"
      );
      filler.push(await makeYear(LOCK_FILLER_YEAR + filler.length, "Open"));
      open = (await openFiscalYears()).filter((y) => y.id !== candidate);
    }

    const refused = await checkYearOpenable(candidate);
    assert.equal(refused.ok, false, "at the limit, it does not");
    assert.match(
      (refused as { message: string }).message,
      /Tutup Tahun Buku/,
      "the refusal has to say which year to close; \"too many\" is not actionable"
    );

    await prisma.accFiscalYear.updateMany({
      where: { id: { in: filler } },
      data: { status: "Draft" },
    });
    assert.equal(
      (await checkYearOpenable(candidate)).ok,
      true,
      "and with room again, the same year opens"
    );
  });
});
