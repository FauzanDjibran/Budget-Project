import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { statementMovements } from "../src/lib/siba/ledger";
import {
  buildProfitLoss,
  columnRange,
  type StatementAccount,
  type StatementPair,
} from "../src/lib/siba/statement-layout";
import { profitLossReport, type StatementColumn } from "../src/lib/siba/statements";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import {
  childCompanyId,
  cleanupFixtures,
  disconnect,
  makeAccount,
  makePartner,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The Laba Rugi.
 *
 * Two halves. The layout rules — which figure lands on which row, how a step
 * is signed, what folds, what hides — are pure (`statement-layout.ts`) and are
 * driven directly. The figures themselves come from the real engine, against
 * journals this file writes **in 1980**: nothing real is dated then, so the
 * statement for that year is this file's fixtures and nothing else, whatever
 * database it runs against. The journals are inserted directly for the reason
 * `tests/closing.test.ts` gives — the posting engine refuses to back-date, and
 * building history is exactly what it exists to refuse.
 */

// ------------------------------------------------------------- the layout

const cat = (id: number, label: string, step: StatementAccount["category"]["step"]) => ({
  id,
  label,
  name: `CAT ${label}`,
  step,
});
const sub = (id: number, label: string) => ({ id, label, name: `SUB ${label}` });

/** A small chart covering every step, one contra account and two kelompok in Beban Usaha. */
const CHART: StatementAccount[] = [
  { id: 1, label: "4.1.1.1", name: "Penjualan", parentId: null, subcategory: sub(11, "4.1.1"), category: cat(1, "4.1", "OperatingRevenue") },
  { id: 2, label: "4.1.8.1", name: "Retur", parentId: null, subcategory: sub(18, "4.1.8"), category: cat(1, "4.1", "OperatingRevenue") },
  { id: 3, label: "5.1.1.1", name: "HPP", parentId: null, subcategory: sub(51, "5.1.1"), category: cat(5, "5.1", "CostOfSales") },
  { id: 4, label: "5.2.1.1", name: "Iklan", parentId: null, subcategory: sub(52, "5.2.1"), category: cat(6, "5.2", "OperatingExpense") },
  { id: 5, label: "5.3.1.1", name: "Gaji", parentId: null, subcategory: sub(53, "5.3.1"), category: cat(7, "5.3", "OperatingExpense") },
  { id: 6, label: "4.9.1.1", name: "Bunga", parentId: null, subcategory: sub(49, "4.9.1"), category: cat(9, "4.9", "OtherIncome") },
  { id: 7, label: "5.9.1.1", name: "Denda", parentId: null, subcategory: sub(59, "5.9.1"), category: cat(10, "5.9", "OtherExpense") },
];

const pair = (accountId: number, debit: number, credit: number, partnerId: number | null = null): StatementPair => ({
  accountId,
  partnerId,
  debit,
  credit,
});

const COLUMN: StatementPair[] = [
  pair(1, 0, 1_000_000),
  pair(2, 50_000, 0),
  pair(3, 400_000, 0),
  pair(4, 100_000, 0),
  pair(5, 150_000, 0),
  pair(6, 0, 30_000),
  pair(7, 20_000, 0),
];

const valueOf = (rows: ReturnType<typeof buildProfitLoss>["rows"], key: string) =>
  rows.find((r) => r.key === key)?.values;

describe("the multi-step layout", () => {
  const built = buildProfitLoss(CHART, [COLUMN], new Map());

  test("each result line closes the steps above it", () => {
    // Revenue 1.000.000 less a 50.000 return is 950.000; HPP 400.000.
    assert.deepEqual(valueOf(built.rows, "tCostOfSales"), [550_000], "Laba Kotor");
    assert.deepEqual(valueOf(built.rows, "tOperatingExpense"), [300_000], "Laba Usaha");
    assert.deepEqual(valueOf(built.rows, "tOtherExpense"), [310_000], "Laba Bersih");
    assert.deepEqual(built.result, [310_000]);
  });

  test("Laba Bersih equals single-step Pendapatan minus Biaya exactly", () => {
    const revenue = COLUMN.filter((p) => [1, 2, 6].includes(p.accountId)).reduce((s, p) => s + p.credit - p.debit, 0);
    const cost = COLUMN.filter((p) => [3, 4, 5, 7].includes(p.accountId)).reduce((s, p) => s + p.debit - p.credit, 0);
    assert.equal(built.result[0], revenue - cost, "the layout never changes the bottom line");
  });

  test("a contra account inside revenue prints negative where it sits", () => {
    assert.deepEqual(valueOf(built.rows, "a2"), [-50_000]);
    assert.deepEqual(valueOf(built.rows, "sOperatingRevenue"), [950_000]);
  });

  test("a category with one kelompok showing folds it, two kelompok do not", () => {
    // 4.1 shows 4.1.1 and 4.1.8, so both are rows; 5.1 shows only 5.1.1.
    assert.ok(valueOf(built.rows, "u11"));
    assert.ok(valueOf(built.rows, "u18"));
    assert.equal(valueOf(built.rows, "u51"), undefined, "one kelompok would repeat its category");
    assert.equal(built.rows.find((r) => r.key === "a3")?.depth, 2, "its accounts move up a level");
  });

  test("every step shows even when nothing moved; nothing below it does", () => {
    const quiet = buildProfitLoss(CHART, [[pair(1, 0, 10)]], new Map());
    const kinds = quiet.rows.map((r) => r.kind);
    assert.equal(kinds.filter((k) => k === "step").length, 5);
    assert.equal(kinds.filter((k) => k === "subtotal").length, 3);
    assert.deepEqual(
      quiet.rows.filter((r) => r.kind === "account").map((r) => r.key),
      ["a1"]
    );
  });

  test("a sub-account rolls up into its parent", () => {
    const chart: StatementAccount[] = [
      ...CHART,
      { id: 8, label: "5.3.1.1.1", name: "Gaji Kantor", parentId: 5, subcategory: sub(53, "5.3.1"), category: cat(7, "5.3", "OperatingExpense") },
    ];
    const withChild = buildProfitLoss(chart, [[...COLUMN, pair(8, 25_000, 0)]], new Map());
    assert.deepEqual(valueOf(withChild.rows, "a5"), [175_000], "the parent carries what is beneath it");
    const parent = withChild.rows.find((r) => r.key === "a5")!;
    assert.equal(withChild.rows.find((r) => r.key === "a8")!.depth, parent.depth + 1);
  });

  test("Partner rows add up exactly to their account, including Tanpa Partner", () => {
    const partners = new Map([
      [70, { id: 70, label: "CBG-A", name: "Cabang A" }],
      [71, { id: 71, label: "CBG-B", name: "Cabang B" }],
    ]);
    const split = buildProfitLoss(
      CHART,
      [[pair(5, 60_000, 0, 70), pair(5, 40_000, 0, 71), pair(5, 50_000, 0, null)]],
      partners
    );
    const account = split.rows.find((r) => r.key === "a5")!;
    assert.equal(account.hasPartners, true);
    const lines = split.rows.filter((r) => r.partnerOf === "a5");
    assert.deepEqual(lines.map((l) => l.name), ["Cabang A", "Cabang B", "Tanpa Partner"]);
    assert.equal(
      lines.reduce((s, l) => s + l.values[0], 0),
      account.values[0],
      "a breakdown is the same figure regrouped, never a second one"
    );
  });

  test("an account with no Partner lines carries no arrow", () => {
    assert.equal(built.rows.find((r) => r.key === "a1")!.hasPartners, false);
  });

  test("a category with no step is reported, not silently dropped", () => {
    const orphan: StatementAccount = { id: 9, label: "4.7.1.1", name: "Lain", parentId: null, subcategory: sub(47, "4.7.1"), category: cat(47, "4.7", null) };
    const out = buildProfitLoss([...CHART, orphan], [[pair(9, 0, 5_000)]], new Map());
    assert.deepEqual(out.unplaced, ["4.7.1.1 Lain"]);
  });

  test("two columns are laid out side by side, row for row", () => {
    const two = buildProfitLoss(CHART, [COLUMN, [pair(1, 0, 400_000)]], new Map());
    assert.deepEqual(two.result, [310_000, 400_000]);
    assert.deepEqual(valueOf(two.rows, "a3"), [400_000, 0], "a row one column lacks shows as zero there");
  });
});

describe("a column's range", () => {
  const year = { startDate: "2026-01-01" };
  const march = { startDate: "2026-03-01", endDate: "2026-03-31" };

  test("Periode ini is the period alone", () => {
    assert.deepEqual(columnRange(year, march, "mtd"), { from: "2026-03-01", to: "2026-03-31" });
  });

  test("s.d. Periode ini runs from the year's first day", () => {
    assert.deepEqual(columnRange(year, march, "ytd"), { from: "2026-01-01", to: "2026-03-31" });
  });
});

// ------------------------------------------------------------- the engine

const YEAR = 1980;
const YEAR_CODE = "test.pl.1980";

let actor = 0;
let induk = 0;
let anak = 0;
let fiscalYear = 0;
let baseCurrency = 0;
let closingDocType = 0;

let cash = 0;
let revenue = 0;
let expense = 0;
let anakRevenue = 0;
let anakCash = 0;
let branch = 0;

const day = (m: number, d: number) => new Date(Date.UTC(YEAR, m - 1, d));

async function journal(
  companyId: number,
  date: Date,
  lines: { accountId: number; debit: number; credit: number; partnerId?: number | null }[],
  extra: { status?: "Posted" | "Draft"; closingOf?: number } = {}
) {
  const status = extra.status ?? "Posted";
  await prisma.accJournal.create({
    data: {
      journal_no: `ZZP-${Date.now() % 100000}-${Math.floor(Math.random() * 100000)}`,
      posting_date: status === "Posted" ? date : null,
      company_id: companyId,
      description: "Fixture",
      status,
      is_manual: status === "Draft",
      source_doc_type_id: extra.closingOf ? closingDocType : null,
      source_doc_id: extra.closingOf ?? null,
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

const column = (from: string, to: string, yearId = fiscalYear): StatementColumn => ({
  yearId,
  yearName: `Tahun Buku ${YEAR}`,
  periodId: 0,
  periodName: "Fixture",
  range: { from, to },
});

const net = async (from: string, to: string, companyId = induk, yearId = fiscalYear) =>
  (await profitLossReport(companyId, [column(from, to, yearId)])).result[0];

before(async () => {
  actor = await systemUserId();
  induk = await parentCompanyId();
  anak = await childCompanyId();
  baseCurrency = (await prisma.refCurrency.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } })).id;
  closingDocType = (
    await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "acc_fiscal_year" }, select: { id: true } })
  ).id;

  await prisma.accFiscalYear.deleteMany({ where: { year_code: YEAR_CODE } });
  fiscalYear = (
    await prisma.accFiscalYear.create({
      data: {
        year_code: YEAR_CODE,
        year_label: String(YEAR),
        year_name: `Tahun Buku ${YEAR}`,
        start_date: day(1, 1),
        end_date: day(12, 31),
        status: "Open",
        created_by: actor,
      },
      select: { id: true },
    })
  ).id;

  cash = await makeAccount({ companyId: induk, subcategoryLabel: CASH_BANK_SUBCATEGORY });
  revenue = await makeAccount({ companyId: induk, subcategoryLabel: "4.1.1", normalBalance: "Kredit" });
  expense = await makeAccount({ companyId: induk, subcategoryLabel: "5.3.1" });
  anakCash = await makeAccount({ companyId: anak, subcategoryLabel: CASH_BANK_SUBCATEGORY });
  anakRevenue = await makeAccount({ companyId: anak, subcategoryLabel: "4.1.1", normalBalance: "Kredit" });
  branch = await makePartner({ companyId: induk, categoryLabel: "Cabang" });

  const sale = (date: Date, amount: number) =>
    journal(induk, date, [
      { accountId: cash, debit: amount, credit: 0 },
      { accountId: revenue, debit: 0, credit: amount },
    ]);
  const spend = (date: Date, amount: number, partnerId: number | null = null) =>
    journal(induk, date, [
      { accountId: expense, debit: amount, credit: 0, partnerId },
      { accountId: cash, debit: 0, credit: amount },
    ]);

  // The previous year's last day: never part of 1980.
  await journal(induk, new Date(Date.UTC(YEAR - 1, 11, 31)), [
    { accountId: cash, debit: 7_000, credit: 0 },
    { accountId: revenue, debit: 0, credit: 7_000 },
  ]);
  await sale(day(2, 28), 100_000); //   February
  await sale(day(3, 1), 200_000); //    the first day of March
  await sale(day(3, 31), 300_000); //   the last day of March
  await spend(day(3, 15), 120_000, branch);
  await spend(day(3, 20), 30_000);
  await sale(day(4, 1), 400_000); //    April

  // A draft is not accounting.
  await journal(
    induk,
    day(3, 10),
    [
      { accountId: cash, debit: 999_000, credit: 0 },
      { accountId: revenue, debit: 0, credit: 999_000 },
    ],
    { status: "Draft" }
  );

  // The other Company's sale, the same month.
  await journal(anak, day(3, 5), [
    { accountId: anakCash, debit: 55_000, credit: 0 },
    { accountId: anakRevenue, debit: 0, credit: 55_000 },
  ]);

  // 1980's own closing journal, dated its last day, emptying the Laba Rugi
  // accounts into equity exactly as a close would. Profit to 31/12 is
  // 1.000.000 − 150.000 = 850.000.
  const equity = await makeAccount({ companyId: induk, subcategoryLabel: "3.3.1", normalBalance: "Kredit" });
  await journal(
    induk,
    day(12, 31),
    [
      { accountId: revenue, debit: 1_000_000, credit: 0 },
      { accountId: expense, debit: 0, credit: 150_000 },
      { accountId: equity, debit: 0, credit: 850_000 },
    ],
    { closingOf: fiscalYear }
  );
});

after(async () => {
  await cleanupFixtures();
  await prisma.accFiscalYear.deleteMany({ where: { year_code: YEAR_CODE } });
  await disconnect();
});

describe("the figures, from the real engine", () => {
  test("Periode ini holds both boundary days and nothing outside them", async () => {
    // March: 200.000 + 300.000 in, 150.000 out. February and April stay out.
    assert.equal(await net("1980-03-01", "1980-03-31"), 350_000);
  });

  test("s.d. Periode ini adds the months before it, and not the year before", async () => {
    // January–March: 100.000 + 500.000 − 150.000. The 31/12/1979 sale belongs
    // to another year and cannot fall inside a range starting on 1 January.
    assert.equal(await net("1980-01-01", "1980-03-31"), 450_000);
  });

  test("the year's own closing journal is left out, so a full year shows its result", async () => {
    assert.equal(await net("1980-01-01", "1980-12-31"), 850_000);
  });

  test("only that year's closing journal is left out", async () => {
    // Asked as if the range belonged to another year, the close is an ordinary
    // posted journal and the Laba Rugi accounts net to nil — which is exactly
    // the useless report excluding it prevents.
    const moves = await statementMovements(induk, { from: "1980-01-01", to: "1980-12-31" }, {
      section: "ProfitLoss",
      excludeClosingOf: fiscalYear + 100_000,
    });
    const total = moves.reduce((s, m) => s + m.credit - m.debit, 0);
    assert.equal(total, 0);
  });

  test("a draft never reaches the statement", async () => {
    const moves = await statementMovements(induk, { from: "1980-03-10", to: "1980-03-10" }, { section: "ProfitLoss" });
    assert.equal(moves.length, 0, "the draft on 10/03 is the only journal that day");
  });

  test("one Company's statement never reads the other's journals", async () => {
    assert.equal(await net("1980-03-01", "1980-03-31", anak), 55_000);
    assert.equal(await net("1980-03-01", "1980-03-31"), 350_000, "and the induk's excludes it");
  });

  test("a comparison column equals running that period on its own", async () => {
    const both = await profitLossReport(induk, [
      column("1980-03-01", "1980-03-31"),
      column("1980-02-01", "1980-02-29"),
    ]);
    assert.deepEqual(both.result, [350_000, await net("1980-02-01", "1980-02-29")]);
    assert.equal(both.result[1], 100_000);
  });

  test("the Partner breakdown adds up to the account, with the rest as Tanpa Partner", async () => {
    const report = await profitLossReport(induk, [column("1980-03-01", "1980-03-31")]);
    const account = report.rows.find((r) => r.accountId === expense)!;
    assert.equal(account.values[0], 150_000);
    const lines = report.rows.filter((r) => r.partnerOf === account.key);
    assert.deepEqual(lines.map((l) => l.values[0]), [120_000, 30_000]);
    assert.equal(lines[1].name, "Tanpa Partner");
  });
});
