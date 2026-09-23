import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { executeClosing } from "../src/lib/siba/closing";
import { generalLedgerReport, trialBalanceReport } from "../src/lib/siba/ledger";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import type { SystemDefaultKey } from "../src/lib/siba/system-defaults";
import {
  cleanupFixtures,
  disconnect,
  makeAccount,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The General Ledger and the Trial Balance compute their openings from the
 * Opening Balance snapshot instead of scanning a Company's whole history.
 *
 * This is the riskiest read change in the Opening Balance work: it alters how
 * two reports arrive at a figure they already produce. The property that makes
 * it safe is **equivalence** — for the same account and the same date, the
 * snapshot-based opening equals the full-scan opening to the cent — and that
 * is what almost every case here asserts.
 *
 * `fullScanOpening` is the reference: the pre-change algorithm, written out in
 * the test rather than imported, so the two implementations cannot drift into
 * agreement by sharing code. If it and the report ever disagree, the report is
 * wrong.
 *
 * Three boundaries matter and each is pushed at directly: a date *before* any
 * snapshot, where the scan must still run over everything; a date exactly *on*
 * a snapshot, where nothing is left to add; and a date well after one, where
 * the snapshot plus the lines since must come to the same figure as the lot.
 */

const FY = 1980;
const YEAR_PREFIX = "test.eqv.";

let actor = 0;
let company = 0;
let baseCurrency = 0;
let year1980 = 0;
let year1981 = 0;

let cash = 0;
let income = 0;
let expense = 0;
let equity = 0;
/** Carries an opening into 1981 and never moves again. */
let dormant = 0;

const savedSettings = new Map<SystemDefaultKey, string | null>();

async function makeYear(
  year: number,
  status: "Draft" | "Open" | "Closed"
): Promise<number> {
  const row = await prisma.accFiscalYear.create({
    data: {
      year_code: `${YEAR_PREFIX}${year}`,
      year_label: String(year),
      year_name: `Tahun Buku ${year}`,
      start_date: new Date(Date.UTC(year, 0, 1)),
      end_date: new Date(Date.UTC(year, 11, 31)),
      status,
      created_by: actor,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * A posted journal dated in the past.
 *
 * Inserted directly, because `postJournal` refuses to back-date anything but a
 * closing entry — and building the history a report reads over is exactly what
 * that refusal is there to prevent anyone doing through the engine.
 */
async function postFixtureJournal(
  date: string,
  lines: { accountId: number; debit: number; credit: number }[]
): Promise<void> {
  await prisma.accJournal.create({
    data: {
      journal_no: `ZZE-${Date.now() % 100000}-${Math.floor(Math.random() * 10000)}`,
      posting_date: new Date(`${date}T00:00:00Z`),
      created_at: new Date(`${date}T00:00:00Z`),
      company_id: company,
      description: "Fixture",
      status: "Posted",
      created_by: actor,
      lines: {
        create: lines.map((l, i) => ({
          sequence_no: i + 1,
          account_id: l.accountId,
          currency_id: baseCurrency,
          exchange_rate: 1,
          debit_amount: l.debit,
          kredit_amount: l.credit,
          trx_amount: l.debit || l.credit,
          description: "Fixture",
          created_by: actor,
        })),
      },
    },
  });
}

async function setSetting(key: SystemDefaultKey, value: string | null) {
  if (!savedSettings.has(key)) {
    const row = await prisma.sysSetting.findUnique({
      where: { setting_key: key },
      select: { setting_value: true },
    });
    savedSettings.set(key, row?.setting_value ?? null);
  }
  await prisma.sysSetting.upsert({
    where: { setting_key: key },
    update: { setting_value: value, updated_by: actor },
    create: { setting_key: key, setting_value: value, updated_by: actor },
  });
}

/**
 * The opening as the reports computed it before the snapshot existed: every
 * posted line strictly before the date, signed by the account's own direction.
 */
async function fullScanOpening(accountId: number, from: string): Promise<number> {
  const account = await prisma.accAccount.findUniqueOrThrow({
    where: { id: accountId },
    select: { normal_balance: true },
  });
  const lines = await prisma.accJournalLine.findMany({
    where: {
      account_id: accountId,
      journal: {
        status: "Posted",
        company_id: company,
        posting_date: { lt: new Date(`${from}T00:00:00Z`) },
      },
    },
    select: { debit_amount: true, kredit_amount: true },
  });
  // Signed **per line**, by subtraction, exactly as `signedMovement` does it.
  // Summing the raw net and negating afterwards would agree everywhere except
  // at zero, where it yields `-0` — and this is the reference, so it has to be
  // the old algorithm rather than a paraphrase of it.
  return lines.reduce((t, l) => {
    const debit = l.debit_amount.toNumber();
    const credit = l.kredit_amount.toNumber();
    return t + (account.normal_balance === "Kredit" ? credit - debit : debit - credit);
  }, 0);
}

async function wipeFixtureYears() {
  const ids = (
    await prisma.accFiscalYear.findMany({
      where: { year_code: { startsWith: YEAR_PREFIX } },
      select: { id: true },
    })
  ).map((y) => y.id);
  if (!ids.length) return;

  const openings = (
    await prisma.accOpeningBalance.findMany({
      where: {
        OR: [
          { fiscal_year_id: { in: ids } },
          { source_fiscal_year_id: { in: ids } },
        ],
      },
      select: { id: true },
    })
  ).map((o) => o.id);
  if (openings.length) {
    await prisma.accOpeningBalanceLine.deleteMany({
      where: { opening_id: { in: openings } },
    });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "acc_opening_balance", row_id: { in: openings } },
    });
    await prisma.accOpeningBalance.deleteMany({ where: { id: { in: openings } } });
  }

  const closings = (
    await prisma.accFiscalClosing.findMany({
      where: { fiscal_year_id: { in: ids } },
      select: { id: true },
    })
  ).map((c) => c.id);
  if (closings.length) {
    await prisma.auditLog.deleteMany({
      where: { entity_key: "acc_fiscal_closing", row_id: { in: closings } },
    });
    await prisma.accFiscalClosing.deleteMany({
      where: { fiscal_year_id: { in: ids } },
    });
  }

  await prisma.auditLog.deleteMany({
    where: { entity_key: "acc_fiscal_year", row_id: { in: ids } },
  });
  await prisma.accFiscalPeriod.deleteMany({ where: { fiscal_year_id: { in: ids } } });
  await prisma.accFiscalYear.deleteMany({ where: { id: { in: ids } } });
}

before(async () => {
  actor = await systemUserId();
  company = await parentCompanyId();
  baseCurrency = (
    await prisma.refCurrency.findFirstOrThrow({
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;

  await wipeFixtureYears();

  year1980 = await makeYear(FY, "Open");
  year1981 = await makeYear(FY + 1, "Draft");
  // 1982 exists so that closing 1981 has somewhere to put its snapshot; the
  // test never names it, it only reads what lands in it.
  await makeYear(FY + 2, "Draft");

  cash = await makeAccount({
    companyId: company,
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
    normalBalance: "Debit",
  });
  income = await makeAccount({
    companyId: company,
    subcategoryLabel: "4.1.1",
    normalBalance: "Kredit",
  });
  expense = await makeAccount({
    companyId: company,
    subcategoryLabel: "5.3.1",
    normalBalance: "Debit",
  });
  equity = await makeAccount({
    companyId: company,
    subcategoryLabel: "3.3.1",
    normalBalance: "Kredit",
  });
  dormant = await makeAccount({
    companyId: company,
    subcategoryLabel: "1.1.4",
    normalBalance: "Debit",
  });

  await setSetting("induk_accumulated_pl_account", String(equity));

  // 1980: the history the snapshot will fold away.
  await postFixtureJournal(`${FY}-03-15`, [
    { accountId: cash, debit: 9_000_000, credit: 0 },
    { accountId: income, debit: 0, credit: 9_000_000 },
  ]);
  await postFixtureJournal(`${FY}-07-20`, [
    { accountId: expense, debit: 2_400_000, credit: 0 },
    { accountId: cash, debit: 0, credit: 2_400_000 },
  ]);
  // A balance that will carry forward and then never move again, so the Trial
  // Balance has to find it without a line in the period to find it by.
  await postFixtureJournal(`${FY}-09-01`, [
    { accountId: dormant, debit: 1_500_000, credit: 0 },
    { accountId: cash, debit: 0, credit: 1_500_000 },
  ]);

  // Closing 1980 writes the snapshot dated 01/01/1981.
  const closed = await executeClosing(company, year1980, actor);
  assert.equal(closed.ok, true, JSON.stringify(closed));

  // 1981: movement after the snapshot, which the reports must still add.
  await postFixtureJournal(`${FY + 1}-02-10`, [
    { accountId: expense, debit: 800_000, credit: 0 },
    { accountId: cash, debit: 0, credit: 800_000 },
  ]);
  await postFixtureJournal(`${FY + 1}-11-05`, [
    { accountId: cash, debit: 3_200_000, credit: 0 },
    { accountId: income, debit: 0, credit: 3_200_000 },
  ]);
});

after(async () => {
  await wipeFixtureYears();
  for (const [key, value] of savedSettings) {
    if (value === null) {
      await prisma.sysSetting.deleteMany({ where: { setting_key: key } });
    } else {
      await prisma.sysSetting.update({
        where: { setting_key: key },
        data: { setting_value: value },
      });
    }
  }
  await cleanupFixtures();
  await disconnect();
});

const accounts = () => [cash, income, expense, equity, dormant];

/** Every account's opening, from the report and from the reference. */
async function comparedAt(from: string, to: string) {
  const report = await generalLedgerReport(accounts(), { from, to }, [company]);
  const rows: { label: string; reported: number; scanned: number }[] = [];
  for (const account of report.accounts) {
    rows.push({
      label: account.label,
      reported: account.opening,
      scanned: await fullScanOpening(account.id, from),
    });
  }
  return { report, rows };
}

// ------------------------------------------------------------ equivalence

describe("a snapshot-based opening equals the full scan, to the cent", () => {
  test("exactly on the snapshot's own date", async () => {
    const { report, rows } = await comparedAt(`${FY + 1}-01-01`, `${FY + 1}-12-31`);
    assert.ok(report.openingFrom, "a snapshot covers this date");
    assert.equal(report.openingFrom.date, `${FY + 1}-01-01`);

    for (const r of rows) {
      assert.equal(
        Math.round(r.reported * 100),
        Math.round(r.scanned * 100),
        `${r.label}: reported ${r.reported}, scanned ${r.scanned}`
      );
    }
    // And the figures are not all zero, or the comparison proves nothing.
    assert.ok(rows.some((r) => Math.round(r.scanned * 100) !== 0));
  });

  test("well inside the year the snapshot opened", async () => {
    const { report, rows } = await comparedAt(`${FY + 1}-06-30`, `${FY + 1}-12-31`);
    assert.ok(report.openingFrom, "the snapshot still covers it");
    for (const r of rows) {
      assert.equal(Math.round(r.reported * 100), Math.round(r.scanned * 100), r.label);
    }
  });

  test("a year later still, with a whole year to add on top", async () => {
    const { report, rows } = await comparedAt(`${FY + 2}-01-01`, `${FY + 2}-12-31`);
    assert.ok(report.openingFrom);
    for (const r of rows) {
      assert.equal(Math.round(r.reported * 100), Math.round(r.scanned * 100), r.label);
    }
  });

  test("inside the closed year itself, where no snapshot covers the date", async () => {
    // 01/07/1980 is before the snapshot's own date, so there is nothing to
    // stand on and the scan must run over everything — the fallback, exercised.
    const { report, rows } = await comparedAt(`${FY}-07-01`, `${FY}-12-31`);
    assert.equal(
      report.openingFrom,
      null,
      "a snapshot dated after the question cannot answer it"
    );
    for (const r of rows) {
      assert.equal(Math.round(r.reported * 100), Math.round(r.scanned * 100), r.label);
    }
  });

  test("before the Company had any history at all", async () => {
    const { report, rows } = await comparedAt(`${FY - 5}-01-01`, `${FY - 5}-12-31`);
    assert.equal(report.openingFrom, null);
    for (const r of rows) {
      assert.equal(Math.round(r.reported * 100), 0, r.label);
      assert.equal(Math.round(r.scanned * 100), 0, r.label);
    }
  });

  test("the closing journal itself is inside the snapshot, not after it", async () => {
    // Dated 31/12/1980, so it belongs to the year that was closed. If the
    // snapshot excluded it, the equity account would open at nil and the
    // profit would appear twice.
    const { rows } = await comparedAt(`${FY + 1}-01-01`, `${FY + 1}-12-31`);
    const equityRow = rows.find((r) => r.label.startsWith("3.3.1"))!;
    // 9.000.000 in, 2.400.000 out: a profit of 6.600.000 on a Kredit account.
    assert.equal(equityRow.reported, 6_600_000);
    assert.equal(equityRow.scanned, 6_600_000);
  });
});

// -------------------------------------------------------- the trial balance

describe("the Trial Balance opening comes from the same place", () => {
  test("every row's opening equals the full scan", async () => {
    const report = await trialBalanceReport(
      { from: `${FY + 1}-01-01`, to: `${FY + 1}-12-31` },
      [company]
    );
    assert.ok(report.openingFrom, "a snapshot covers this date");

    const mine = report.rows.filter((r) => accounts().includes(r.id));
    assert.ok(mine.length >= 4, "the fixture accounts are in the report");
    for (const row of mine) {
      assert.equal(
        Math.round(row.opening * 100),
        Math.round((await fullScanOpening(row.id, `${FY + 1}-01-01`)) * 100),
        row.label
      );
    }
  });

  test("an account that carries an opening and never moves is still a row", async () => {
    // The regression this change could most easily have caused: the opening
    // used to arrive as a by-product of scanning every historical line, so an
    // account with no line inside the period was still found. Now the rows
    // have to be seeded from the snapshot as well.
    const report = await trialBalanceReport(
      { from: `${FY + 1}-01-01`, to: `${FY + 1}-12-31` },
      [company]
    );
    const row = report.rows.find((r) => r.id === dormant);
    assert.ok(row, "an account with an opening and no movement must still appear");
    assert.equal(row.opening, 1_500_000);
    assert.equal(row.debit, 0);
    assert.equal(row.credit, 0);
    assert.equal(row.closing, 1_500_000);
  });

  test("opening plus movement is still the closing balance", async () => {
    const report = await trialBalanceReport(
      { from: `${FY + 1}-01-01`, to: `${FY + 1}-12-31` },
      [company]
    );
    for (const row of report.rows) {
      const movement =
        row.normalBalance === "Kredit"
          ? row.credit - row.debit
          : row.debit - row.credit;
      assert.equal(
        Math.round((row.opening + movement) * 100),
        Math.round(row.closing * 100),
        `${row.label} does not reconcile on its own row`
      );
    }
  });

  test("the period's two sides still agree", async () => {
    const report = await trialBalanceReport(
      { from: `${FY + 1}-01-01`, to: `${FY + 1}-12-31` },
      [company]
    );
    assert.equal(report.balanced, true);
    assert.deepEqual(report.unbalanced, []);
  });

  test("no snapshot means no provenance, and the old arithmetic", async () => {
    const report = await trialBalanceReport(
      { from: `${FY}-07-01`, to: `${FY}-12-31` },
      [company]
    );
    assert.equal(report.openingFrom, null);
    const row = report.rows.find((r) => r.id === cash);
    assert.ok(row);
    assert.equal(
      Math.round(row.opening * 100),
      Math.round((await fullScanOpening(cash, `${FY}-07-01`)) * 100)
    );
  });
});

// ------------------------------------------------- the later snapshot wins

describe("the latest snapshot on or before the date is the one used", () => {
  test("closing a second year moves the basis forward", async () => {
    await prisma.accFiscalYear.update({
      where: { id: year1981 },
      data: { status: "Open" },
    });
    // 1980 has to be out of the way, or it is still the oldest Open year.
    await prisma.accFiscalYear.update({
      where: { id: year1980 },
      data: { status: "Closed" },
    });

    const closed = await executeClosing(company, year1981, actor);
    assert.equal(closed.ok, true, JSON.stringify(closed));

    const report = await generalLedgerReport(
      accounts(),
      { from: `${FY + 2}-01-01`, to: `${FY + 2}-12-31` },
      [company]
    );
    assert.ok(report.openingFrom);
    assert.equal(
      report.openingFrom.date,
      `${FY + 2}-01-01`,
      "the 1982 snapshot, not the 1981 one — the later basis leaves less to scan"
    );

    for (const account of report.accounts) {
      assert.equal(
        Math.round(account.opening * 100),
        Math.round((await fullScanOpening(account.id, `${FY + 2}-01-01`)) * 100),
        account.label
      );
    }
  });

  test("and the earlier date still uses the earlier snapshot", async () => {
    const report = await generalLedgerReport(
      accounts(),
      { from: `${FY + 1}-06-30`, to: `${FY + 1}-12-31` },
      [company]
    );
    assert.equal(report.openingFrom?.date, `${FY + 1}-01-01`);
    for (const account of report.accounts) {
      assert.equal(
        Math.round(account.opening * 100),
        Math.round((await fullScanOpening(account.id, `${FY + 1}-06-30`)) * 100),
        account.label
      );
    }
  });

  test("two closes leave the books balanced across the boundary", async () => {
    const report = await trialBalanceReport(
      { from: `${FY + 2}-01-01`, to: `${FY + 2}-12-31` },
      [company]
    );
    const mine = report.rows.filter((r) => accounts().includes(r.id));
    const openingSum = mine.reduce(
      (t, r) =>
        t + (r.normalBalance === "Kredit" ? -r.opening : r.opening),
      0
    );
    assert.equal(
      Math.round(openingSum * 100),
      0,
      "a balance sheet carried into a new year has two equal sides"
    );
  });
});
