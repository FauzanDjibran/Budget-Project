import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { executeClosing } from "../src/lib/siba/closing";
import {
  buildBalanceSheet,
  type StatementAccount,
  type StatementPair,
} from "../src/lib/siba/statement-layout";
import {
  balanceSheetReport,
  profitLossReport,
  type StatementColumn,
} from "../src/lib/siba/statements";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import {
  cleanupFixtures,
  disconnect,
  makeAccount,
  makePartner,
  parentCompanyId,
  prisma,
  systemUserId,
  systemAccountFixture,
} from "./helpers";

/**
 * The Neraca.
 *
 * The layout half is pure and driven directly. The engine half runs a whole
 * year-end on fixture years **1980 and 1981** — nothing real is dated then —
 * with journals inserted directly for the reason `tests/closing.test.ts`
 * gives, and a real close through `executeClosing` in the middle, because the
 * property that matters most is what the Neraca does on either side of it.
 */

// ------------------------------------------------------------- the layout

const type = (id: number, label: string, name: string, credit: boolean) => ({ id, label, name, credit });
const AKTIVA = type(1, "1", "AKTIVA", false);
const PASIVA = type(2, "2", "PASIVA", true);
const EKUITAS = type(3, "3", "EKUITAS", true);

const acc = (id: number, label: string, t: typeof AKTIVA, cat: number, sub: number): StatementAccount => ({
  id,
  label,
  name: `Account ${label}`,
  parentId: null,
  subcategory: { id: sub, label: label.split(".").slice(0, 3).join("."), name: `SUB ${sub}` },
  category: { id: cat, label: label.split(".").slice(0, 2).join("."), name: `CAT ${cat}`, step: null },
  type: t,
});

const CHART = [
  acc(1, "1.1.1.1", AKTIVA, 11, 111),
  acc(2, "1.3.2.1", AKTIVA, 13, 132),
  acc(3, "1.3.9.1", AKTIVA, 13, 139), // accumulated depreciation: a Kredit account inside AKTIVA
  acc(4, "2.2.1.1", PASIVA, 22, 221),
  acc(5, "3.1.1.1", EKUITAS, 31, 311),
  acc(6, "3.4.1.1", EKUITAS, 34, 341),
];

const pair = (accountId: number, debit: number, credit: number): StatementPair => ({
  accountId,
  partnerId: null,
  debit,
  credit,
});

describe("the Neraca layout", () => {
  const built = buildBalanceSheet(
    CHART,
    [[pair(1, 700, 0), pair(2, 500, 0), pair(3, 0, 100), pair(4, 0, 600), pair(5, 0, 400)]],
    new Map(),
    new Map([[6, [100]]])
  );
  const row = (key: string) => built.rows.find((r) => r.key === key);

  test("a type signs everything beneath it, so a contra account prints negative", () => {
    assert.deepEqual(row("a3")?.values, [-100], "Akumulasi Penyusutan is a deduction inside AKTIVA");
    assert.deepEqual(row("t1")?.values, [1_100]);
  });

  test("a computed figure lands on its account, marked, and balances the statement", () => {
    assert.deepEqual(row("a6")?.values, [100]);
    assert.equal(row("a6")?.computed, true);
    assert.equal(row("a5")?.computed, undefined);
    assert.deepEqual(built.debitTotal, [1_100]);
    assert.deepEqual(built.creditTotal, [1_100]);
  });

  test("each type closes with its total, and the credit side is totalled once more", () => {
    assert.deepEqual(row("t2")?.values, [600]);
    assert.deepEqual(row("t3")?.values, [500]);
    assert.equal(row("tcredit")?.name, "Total PASIVA dan EKUITAS", "named from the types, not from code");
    assert.deepEqual(row("tcredit")?.values, [1_100]);
  });

  test("a section heading carries no figure — its total line follows", () => {
    assert.deepEqual(row("s1")?.values, []);
  });

  test("year lines print directly after their account and count towards everything above it", () => {
    const withLines = buildBalanceSheet(
      CHART,
      [[pair(1, 450, 0), pair(5, 0, 400)]],
      new Map(),
      new Map(),
      new Map([
        [
          5,
          [
            { key: "y25", name: "Laba/Rugi 2025", values: [50], profitLoss: { yearId: 25, periodId: 250 } },
            { key: "y26", name: "Laba/Rugi 2026", values: [0] },
          ],
        ],
      ])
    );
    const keys = withLines.rows.map((r) => r.key);
    const at = keys.indexOf("a5");
    assert.deepEqual(keys.slice(at, at + 3), ["a5", "y25", "y26"], "in year order, beneath the account");
    const y25 = withLines.rows.find((r) => r.key === "y25")!;
    assert.equal(y25.computed, true);
    assert.equal(y25.depth, withLines.rows[at].depth, "a sibling of the account, not a child");
    assert.deepEqual(y25.profitLoss, { yearId: 25, periodId: 250 });
    assert.ok(keys.includes("y26"), "a year whose result is nil is still stated");
    assert.deepEqual(withLines.rows[at].values, [400], "the account keeps its own figure");
    assert.deepEqual(withLines.rows.find((r) => r.key === "t3")?.values, [450]);
    assert.deepEqual(withLines.creditTotal, withLines.debitTotal);
  });

  test("an account with year lines shows even at nil", () => {
    const quiet = buildBalanceSheet(
      CHART,
      [[]],
      new Map(),
      new Map(),
      new Map([[5, [{ key: "y25", name: "Laba/Rugi 2025", values: [0] }]]])
    );
    assert.ok(quiet.rows.some((r) => r.key === "a5"));
    assert.ok(quiet.rows.some((r) => r.key === "c31"), "and so does its category");
  });
});

// ------------------------------------------------------------- the engine

const YEAR_PREFIX = "test.nrc.";
let actor = 0;
let induk = 0;
let year1980 = 0;
let year1981 = 0;
let year1982 = 0;
let baseCurrency = 0;

const a = {
  cash: 0,
  equipment: 0,
  depreciation: 0,
  loan: 0,
  capital: 0,
  accumulated: 0,
  current: 0,
  revenue: 0,
  expense: 0,
};
let branch = 0;

const accounts = systemAccountFixture();
async function makeYear(year: number): Promise<number> {
  return (
    await prisma.accFiscalYear.create({
      data: {
        year_code: `${YEAR_PREFIX}${year}`,
        year_label: String(year),
        year_name: `Tahun Buku ${year}`,
        start_date: new Date(Date.UTC(year, 0, 1)),
        end_date: new Date(Date.UTC(year, 11, 31)),
        status: "Open",
        created_by: actor,
      },
      select: { id: true },
    })
  ).id;
}

async function journal(
  date: Date,
  lines: { accountId: number; debit: number; credit: number; partnerId?: number | null }[]
) {
  await prisma.accJournal.create({
    data: {
      journal_no: `ZZN-${Date.now() % 100000}-${Math.floor(Math.random() * 100000)}`,
      posting_date: date,
      company_id: induk,
      description: "Fixture",
      status: "Posted",
      created_by: actor,
      lines: {
        create: lines.map((l, i) => ({
          sequence_no: i + 1,
          account_id: l.accountId,
          partner_id: l.partnerId ?? null,
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

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

const column = (yearId: number, from: string, to: string): StatementColumn => ({
  yearId,
  yearName: "Fixture",
  periodId: 0,
  periodName: "Fixture",
  range: { from, to },
});
const march1981 = () => column(year1981, "1981-01-01", "1981-03-31");
const december1980 = () => column(year1980, "1980-01-01", "1980-12-31");
const march1982 = () => column(year1982, "1982-01-01", "1982-03-31");

const run = (columns: StatementColumn[]) =>
  balanceSheetReport({ id: induk, isParent: true }, columns, []);

async function neraca(columns: StatementColumn[]) {
  const report = await run(columns);
  assert.equal(report.ok, true, JSON.stringify(report));
  if (!report.ok) throw new Error("refused");
  return report;
}

type Neraca = Awaited<ReturnType<typeof neraca>>;
const valueOf = (report: Neraca, accountId: number, col = 0) =>
  report.rows.find((r) => r.accountId === accountId)?.values[col] ?? 0;
const lineOf = (report: Neraca, yearId: number) => report.rows.find((r) => r.key === `y${yearId}`);

async function wipeFixtureYears() {
  const ids = (
    await prisma.accFiscalYear.findMany({ where: { year_code: { startsWith: YEAR_PREFIX } }, select: { id: true } })
  ).map((y) => y.id);
  if (!ids.length) return;
  const openings = (
    await prisma.accOpeningBalance.findMany({
      where: { OR: [{ fiscal_year_id: { in: ids } }, { source_fiscal_year_id: { in: ids } }] },
      select: { id: true },
    })
  ).map((o) => o.id);
  if (openings.length) {
    await prisma.accOpeningBalanceLine.deleteMany({ where: { opening_id: { in: openings } } });
    await prisma.auditLog.deleteMany({ where: { entity_key: "acc_opening_balance", row_id: { in: openings } } });
    await prisma.accOpeningBalance.deleteMany({ where: { id: { in: openings } } });
  }
  const closings = (
    await prisma.accFiscalClosing.findMany({ where: { fiscal_year_id: { in: ids } }, select: { id: true } })
  ).map((c) => c.id);
  if (closings.length) {
    await prisma.auditLog.deleteMany({ where: { entity_key: "acc_fiscal_closing", row_id: { in: closings } } });
    await prisma.accFiscalClosing.deleteMany({ where: { id: { in: closings } } });
  }
  await prisma.auditLog.deleteMany({ where: { entity_key: "acc_fiscal_year", row_id: { in: ids } } });
  await prisma.accFiscalPeriod.deleteMany({ where: { fiscal_year_id: { in: ids } } });
  await prisma.accFiscalYear.deleteMany({ where: { id: { in: ids } } });
}

before(async () => {
  actor = await systemUserId();
  induk = await parentCompanyId();
  baseCurrency = (await prisma.refCurrency.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } })).id;

  await wipeFixtureYears();
  year1980 = await makeYear(1980);
  year1981 = await makeYear(1981);
  year1982 = await makeYear(1982);

  const mk = (subcategoryLabel: string, normalBalance: "Debit" | "Kredit" = "Debit") =>
    makeAccount({ companyId: induk, subcategoryLabel, normalBalance });
  a.cash = await mk(CASH_BANK_SUBCATEGORY);
  a.equipment = await mk("1.3.2");
  a.depreciation = await mk("1.3.9", "Kredit");
  a.loan = await mk("2.2.1", "Kredit");
  a.capital = await mk("3.1.1", "Kredit");
  a.accumulated = await mk("3.3.1", "Kredit");
  a.current = await mk("3.4.1", "Kredit");
  a.revenue = await mk("4.1.1", "Kredit");
  a.expense = await mk("5.3.1");
  branch = await makePartner({ companyId: induk, categoryLabel: "Cabang" });

  await accounts.set("induk", "accumulated_pl", a.accumulated);
  await accounts.set("induk", "current_pl", a.current);

  // 1980: capital in, a loan, equipment bought and depreciated, one sale and
  // one expense naming a branch. Result: 400.000 − 100.000 − 50.000 = 250.000.
  await journal(d(1980, 1, 2), [
    { accountId: a.cash, debit: 1_000_000, credit: 0 },
    { accountId: a.capital, debit: 0, credit: 1_000_000 },
  ]);
  await journal(d(1980, 2, 1), [
    { accountId: a.cash, debit: 200_000, credit: 0 },
    { accountId: a.loan, debit: 0, credit: 200_000, partnerId: branch },
  ]);
  await journal(d(1980, 3, 1), [
    { accountId: a.equipment, debit: 300_000, credit: 0 },
    { accountId: a.cash, debit: 0, credit: 300_000 },
  ]);
  await journal(d(1980, 6, 30), [
    { accountId: a.cash, debit: 400_000, credit: 0 },
    { accountId: a.revenue, debit: 0, credit: 400_000 },
  ]);
  await journal(d(1980, 7, 15), [
    { accountId: a.expense, debit: 100_000, credit: 0 },
    { accountId: a.cash, debit: 0, credit: 100_000 },
  ]);
  await journal(d(1980, 12, 31), [
    { accountId: a.expense, debit: 50_000, credit: 0 },
    { accountId: a.depreciation, debit: 0, credit: 50_000 },
  ]);

  // 1981, while 1980 is still open: 200.000 in, 30.000 out — 170.000.
  await journal(d(1981, 3, 10), [
    { accountId: a.cash, debit: 200_000, credit: 0 },
    { accountId: a.revenue, debit: 0, credit: 200_000 },
  ]);
  await journal(d(1981, 3, 20), [
    { accountId: a.expense, debit: 30_000, credit: 0 },
    { accountId: a.cash, debit: 0, credit: 30_000 },
  ]);

  // 1982, with both earlier years still open: 10.000 in by March.
  await journal(d(1982, 2, 5), [
    { accountId: a.cash, debit: 10_000, credit: 0 },
    { accountId: a.revenue, debit: 0, credit: 10_000 },
  ]);
});

after(async () => {
  await wipeFixtureYears();
  await accounts.restore();
  await cleanupFixtures();
  await disconnect();
});

describe("the Neraca while earlier years are still open", () => {
  test("1981 runs as an extension of 1980, and balances", async () => {
    const report = await neraca([march1981()]);
    // Cash 1.000 + 200 − 300 + 400 − 100 + 200 − 30 = 1.370; equipment 300,
    // less 50 depreciation: AKTIVA 1.620.000.
    assert.deepEqual(report.debitTotal, [1_620_000]);
    assert.deepEqual(report.creditTotal, [1_620_000]);
    assert.equal(valueOf(report, a.depreciation), -50_000, "a deduction inside AKTIVA");
  });

  test("equity splits at the year's first day: a line for 1980, 1981 to date", async () => {
    const report = await neraca([march1981()]);
    const line = lineOf(report, year1980);
    assert.equal(line?.name, "Laba/Rugi 1980");
    assert.deepEqual(line?.values, [250_000], "1980's result, not yet closed into equity");
    assert.equal(line?.computed, true);
    assert.equal(valueOf(report, a.current), 170_000, "1981 to the end of March");
    assert.equal(valueOf(report, a.accumulated), 0, "nothing has been closed into it yet");
    assert.equal(report.rows.find((r) => r.accountId === a.current)?.computed, true);
    assert.deepEqual(report.carried.map((y) => y.name), ["Tahun Buku 1980"]);

    const keys = report.rows.map((r) => r.key);
    assert.equal(
      keys.indexOf(`y${year1980}`),
      keys.indexOf(`a${a.accumulated}`) + 1,
      "printed directly beneath Laba/Rugi Tahun Sebelumnya"
    );
  });

  test("several open years each keep a line of their own", async () => {
    const report = await neraca([march1982()]);
    assert.deepEqual(lineOf(report, year1980)?.values, [250_000]);
    assert.deepEqual(lineOf(report, year1981)?.values, [170_000]);
    assert.equal(valueOf(report, a.current), 10_000);
    const keys = report.rows.map((r) => r.key);
    assert.ok(keys.indexOf(`y${year1980}`) < keys.indexOf(`y${year1981}`), "oldest first");
    assert.deepEqual(report.debitTotal, report.creditTotal);
    assert.deepEqual(report.unattributed, [], "the year lines account for every earlier result");
  });

  test("a comparison column carries only the years before its own", async () => {
    const report = await neraca([march1982(), march1981()]);
    assert.deepEqual(lineOf(report, year1980)?.values, [250_000, 250_000]);
    assert.deepEqual(lineOf(report, year1981)?.values, [170_000, 0], "1981 is the comparison's own year");
    assert.deepEqual(report.debitTotal, report.creditTotal);
  });

  test("Tahun Berjalan is exactly the Laba Rugi's year to date", async () => {
    const pl = await profitLossReport(induk, [march1981()]);
    const report = await neraca([march1981()]);
    assert.equal(valueOf(report, a.current), pl.result[0]);
  });

  test("the Partner split is carried on a balance-sheet account", async () => {
    const report = await neraca([march1981()]);
    const loan = report.rows.find((r) => r.accountId === a.loan)!;
    assert.equal(loan.hasPartners, true);
    const lines = report.rows.filter((r) => r.partnerOf === loan.key);
    assert.deepEqual(lines.map((l) => l.values[0]), [200_000]);
  });

  test("no Tahun Berjalan account: the Neraca is not produced, and says which setting", async () => {
    await accounts.set("induk", "current_pl", null);
    try {
      const refused = await run([march1981()]);
      assert.equal(refused.ok, false);
      assert.deepEqual(!refused.ok && refused.missing, ["Account Laba/Rugi Tahun Berjalan — Induk"]);
    } finally {
      await accounts.set("induk", "current_pl", a.current);
    }
  });

  test("no Tahun Sebelumnya account while a year is carried: refused by name", async () => {
    await accounts.set("induk", "accumulated_pl", null);
    try {
      const refused = await run([march1981()]);
      assert.deepEqual(!refused.ok && refused.missing, ["Account Laba/Rugi Tahun Sebelumnya — Induk"]);
    } finally {
      await accounts.set("induk", "accumulated_pl", a.accumulated);
    }
  });
});

describe("the Neraca across the close", () => {
  let before1980: Neraca;
  let before1981: Neraca;
  let before1982: Neraca;

  test("closing 1980 goes through the real engine", async () => {
    before1980 = await neraca([december1980()]);
    before1981 = await neraca([march1981()]);
    before1982 = await neraca([march1982()]);
    const result = await executeClosing(induk, year1980, actor);
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("1981 now opens from the snapshot, and 1980's line has moved into equity", async () => {
    const report = await neraca([march1981()]);
    assert.ok(report.openingFrom[0]?.openingNo.startsWith("OPB-"), "stood on the 1981 snapshot");
    assert.equal(valueOf(report, a.accumulated), 250_000, "the close moved 1980's result here");
    assert.equal(lineOf(report, year1980), undefined, "and nothing is carried any more");
    assert.equal(valueOf(report, a.current), 170_000);
    assert.deepEqual(report.creditTotal, before1981.creditTotal, "total equity did not move");
    assert.deepEqual(report.debitTotal, before1981.debitTotal);
  });

  test("1982 still carries 1981, and only 1981", async () => {
    const report = await neraca([march1982()]);
    assert.equal(lineOf(report, year1980), undefined);
    assert.deepEqual(lineOf(report, year1981)?.values, [170_000]);
    assert.equal(valueOf(report, a.accumulated), 250_000);
    assert.deepEqual(report.creditTotal, before1982.creditTotal);
  });

  test("Tahun Sebelumnya is still needed while a later year is carried", async () => {
    await accounts.set("induk", "accumulated_pl", null);
    try {
      assert.equal((await run([march1982()])).ok, false, "1981 is still carried");
    } finally {
      await accounts.set("induk", "accumulated_pl", a.accumulated);
    }
  });

  test("Desember 1980 reads the same before and after the close", async () => {
    // Its own closing journal is left out, so the year's result stays in
    // Tahun Berjalan rather than jumping into Tahun Sebelumnya overnight.
    const after = await neraca([december1980()]);
    assert.deepEqual(
      after.rows.map((r) => [r.key, r.values]),
      before1980.rows.map((r) => [r.key, r.values])
    );
    assert.equal(valueOf(after, a.current), 250_000);
  });

  test("two columns side by side agree with each run on its own", async () => {
    const both = await neraca([march1981(), december1980()]);
    const one = await neraca([december1980()]);
    assert.deepEqual(both.debitTotal, [1_620_000, one.debitTotal[0]]);
    assert.equal(valueOf(both, a.current, 1), valueOf(one, a.current));
  });
});
