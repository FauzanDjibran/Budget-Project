import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  cashBankBalanceReport,
  cashBankLedgerReport,
  openCashBankBook,
  recordCashBankEntry,
} from "../src/lib/siba/cash-bank";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import { REPORTS, reportBySlug, reportHref } from "../src/lib/siba/reports";
import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import { MODULES, resolvePath, visibleModules } from "../src/lib/siba/nav";
import {
  FIXTURE_PREFIX,
  cleanupFixtures,
  disconnect,
  makeAccount,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The two Cash Bank Report Views.
 *
 * A money report has one property that matters more than anything it displays:
 * **opening + in − out = closing**, for every subject and every period. A report
 * that cannot be checked on its own page is not evidence of anything, so most
 * of what follows is that identity, pushed at from the edges — entries exactly
 * on the boundaries, entries before the period, a period with nothing in it,
 * and a resource that was deactivated after it had already moved money.
 *
 * Fixtures are built here and removed again: the seed carries system data only.
 */

let company = 0;
let actor = 0;
let currency = 0;
let otherCurrency = 0;

const cashBanks: number[] = [];

async function makeCashBank(options: {
  opening?: number;
  openingDate?: string;
  currencyId?: number;
  status?: "Active" | "Inactive";
}): Promise<number> {
  const account = await makeAccount({ companyId: company, subcategoryLabel: CASH_BANK_SUBCATEGORY });
  const key = `${FIXTURE_PREFIX}R${cashBanks.length + 1}${Date.now() % 100000}`;
  const row = await prisma.mCashBank.create({
    data: {
      cash_bank_code: `test.${key}`,
      cash_bank_label: key,
      cash_bank_name: `Fixture ${key}`,
      company_id: company,
      cash_bank_type: "Cash",
      currency_id: options.currencyId ?? currency,
      account_id: account,
      status: "Active",
      created_by: actor,
    },
    select: { id: true },
  });
  cashBanks.push(row.id);

  await openCashBankBook(prisma, {
    cashBankId: row.id,
    openingBalance: options.opening ?? 0,
    date: options.openingDate ?? "2026-01-01",
    actorId: actor,
  });

  // Deactivated only after its book exists, which is the case the balance
  // report has to keep visible.
  if (options.status === "Inactive") {
    await prisma.mCashBank.update({
      where: { id: row.id },
      data: { status: "Inactive" },
    });
  }
  return row.id;
}

const move = (
  cashBankId: number,
  date: string,
  direction: "In" | "Out",
  amount: number
) =>
  recordCashBankEntry(prisma, {
    cashBankId,
    date,
    type: "Transaction",
    direction,
    amount,
    note: `fixture ${direction} ${date}`,
    actorId: actor,
  });

before(async () => {
  company = await parentCompanyId();
  actor = await systemUserId();

  const currencies = await prisma.refCurrency.findMany({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  currency = currencies[0].id;
  if (currencies.length > 1) {
    otherCurrency = currencies[1].id;
  } else {
    const made = await prisma.refCurrency.create({
      data: {
        currency_code: `test.${FIXTURE_PREFIX}RCUR`,
        currency_label: `${FIXTURE_PREFIX}Y`,
        currency_name: "Fixture currency",
        created_by: actor,
      },
      select: { id: true },
    });
    otherCurrency = made.id;
  }
});

after(async () => {
  if (cashBanks.length) {
    await prisma.cashBankLedger.deleteMany({
      where: { cash_bank_id: { in: cashBanks } },
    });
    await prisma.cashBankBalance.deleteMany({
      where: { cash_bank_id: { in: cashBanks } },
    });
    await prisma.mCashBank.deleteMany({ where: { id: { in: cashBanks } } });
  }
  await prisma.refCurrency.deleteMany({
    where: { currency_label: { startsWith: FIXTURE_PREFIX } },
  });
  await cleanupFixtures();
  await disconnect();
});

// ------------------------------------------------------------- the catalogue

describe("the report catalogue is the index of every Report View", () => {
  test("every report names a permission that exists", () => {
    const codes: string[] = PERMISSION_CODES;
    for (const r of REPORTS) {
      assert.ok(
        codes.includes(r.permission),
        `${r.key} names ${r.permission}, which is not in the catalogue`
      );
    }
  });

  test("every report is reachable by its slug", () => {
    for (const r of REPORTS) {
      assert.equal(reportBySlug(r.slug)?.key, r.key);
    }
    assert.equal(reportBySlug("not-a-report"), undefined);
  });

  test("every report in the menu exists in the catalogue, and vice versa", () => {
    // Report Views live in more than one module now — Finance has the cash
    // books, Accounting the General Ledger and the Trial Balance — so the menu
    // side is gathered by slug shape rather than from one module.
    const menu = MODULES.flatMap((m) =>
      (m.groups ?? []).flatMap((g) =>
        g.entities.filter((e) => e.slug.startsWith("report/"))
      )
    );

    assert.equal(menu.length, REPORTS.length);
    for (const entry of menu) {
      const slug = entry.slug.replace(/^report\//, "");
      const report = reportBySlug(slug);
      assert.ok(report, `menu entry ${entry.slug} has no catalogue entry`);
      assert.equal(
        entry.permission,
        report.permission,
        `${entry.slug} and its report must ask for the same permission`
      );
    }
  });

  test("a report is hidden from someone without its permission", () => {
    const visible = visibleModules(["MENU_FINANCE_ACCESS"]);
    const finance = visible.find((m) => m.key === "finance");
    assert.ok(
      !finance?.groups?.some((g) => g.key === "report"),
      "the Laporan group must disappear when no report is permitted"
    );
  });

  test("a report URL carries its parameters and drops the empty ones", () => {
    assert.equal(
      reportHref("cash-bank-ledger", { cashBank: 4, from: "2026-01-01", to: "2026-01-31" }),
      "/finance/report/cash-bank-ledger?cashBank=4&from=2026-01-01&to=2026-01-31"
    );
    assert.equal(
      reportHref("cash-bank-balance", { cashBank: null, from: "", to: undefined }),
      "/finance/report/cash-bank-balance"
    );
  });
});

describe("navigation still resolves every route shape", () => {
  test("a two-segment report slug resolves to its entry", () => {
    const { module, group, entity } = resolvePath(
      "/finance/report/cash-bank-ledger"
    );
    assert.equal(module?.key, "finance");
    assert.equal(group?.key, "report");
    assert.equal(entity?.key, "report_cash_bank_ledger");
  });

  test("existing entity routes are unaffected", () => {
    assert.equal(resolvePath("/master/partner").entity?.key, "m_partner");
    assert.equal(resolvePath("/master/partner/12").entity?.key, "m_partner");
    assert.equal(
      resolvePath("/master/cash-bank/12/edit").entity?.key,
      "m_cash_bank"
    );
    assert.equal(
      resolvePath("/budget/budget/month/5").entity?.key,
      "bud_budget_month"
    );
    assert.equal(
      resolvePath("/finance/cash-bank-transaction/7").entity?.key,
      "fin_cash_bank_transaction"
    );
  });

  test("an unknown path inside a real module resolves to no entity", () => {
    const { module, entity } = resolvePath("/finance/nothing-here");
    assert.equal(module?.key, "finance");
    assert.equal(entity, undefined);
  });
});

// ------------------------------------------------------------ ledger report

describe("the ledger report reconciles", () => {
  test("opening + masuk - keluar = saldo akhir", async () => {
    const cb = await makeCashBank({ opening: 1_000_000, openingDate: "2026-01-01" });
    await move(cb, "2026-02-10", "In", 500_000);
    await move(cb, "2026-02-20", "Out", 200_000);

    const report = await cashBankLedgerReport(cb, {
      from: "2026-02-01",
      to: "2026-02-28",
    });
    assert.ok(report);
    assert.equal(report.opening, 1_000_000);
    assert.equal(report.totalIn, 500_000);
    assert.equal(report.totalOut, 200_000);
    assert.equal(report.closing, 1_300_000);
    assert.equal(
      report.opening + report.totalIn - report.totalOut,
      report.closing
    );
    assert.ok(report.reconciles, "the stored running balance must agree");
  });

  test("an entry before the period moves the opening and is not listed", async () => {
    const cb = await makeCashBank({ opening: 2_000_000, openingDate: "2026-01-01" });
    await move(cb, "2026-01-15", "Out", 500_000);
    await move(cb, "2026-03-05", "In", 100_000);

    const report = await cashBankLedgerReport(cb, {
      from: "2026-03-01",
      to: "2026-03-31",
    });
    assert.ok(report);
    assert.equal(report.opening, 1_500_000, "everything before March is carried in");
    assert.equal(report.entries.length, 1);
    assert.equal(report.entries[0].date, "2026-03-05");
    assert.equal(report.closing, 1_600_000);
  });

  test("both boundary dates are inside the period", async () => {
    const cb = await makeCashBank({ opening: 0, openingDate: "2026-01-01" });
    await move(cb, "2026-04-01", "In", 10_000);
    await move(cb, "2026-04-30", "In", 20_000);
    await move(cb, "2026-05-01", "In", 40_000);

    const report = await cashBankLedgerReport(cb, {
      from: "2026-04-01",
      to: "2026-04-30",
    });
    assert.ok(report);
    assert.equal(report.entries.length, 2, "the first and last day both count");
    assert.equal(report.totalIn, 30_000);
    assert.equal(report.closing, 30_000);
  });

  test("a period with no movement still reports its balances", async () => {
    const cb = await makeCashBank({ opening: 750_000, openingDate: "2026-01-01" });

    const report = await cashBankLedgerReport(cb, {
      from: "2026-06-01",
      to: "2026-06-30",
    });
    assert.ok(report);
    assert.equal(report.entries.length, 0);
    assert.equal(report.opening, 750_000);
    assert.equal(
      report.closing,
      750_000,
      "no movement is an answer, not an absence"
    );
    assert.ok(report.reconciles);
  });

  test("entries read oldest first, and their stored balance is what is shown", async () => {
    const cb = await makeCashBank({ opening: 100_000, openingDate: "2026-01-01" });
    await move(cb, "2026-07-02", "In", 50_000);
    await move(cb, "2026-07-03", "Out", 30_000);

    const report = await cashBankLedgerReport(cb, {
      from: "2026-07-01",
      to: "2026-07-31",
    });
    assert.ok(report);
    assert.deepEqual(
      report.entries.map((e) => e.date),
      ["2026-07-02", "2026-07-03"]
    );
    assert.deepEqual(
      report.entries.map((e) => e.balanceAfter),
      [150_000, 120_000]
    );
    assert.equal(report.entries.at(-1)!.balanceAfter, report.closing);
  });

  test("an entry names the document that caused it", async () => {
    const cb = await makeCashBank({ opening: 0, openingDate: "2026-01-01" });
    const docType = await prisma.sysDocType.findFirstOrThrow({
      where: { doc_table: "fin_cash_bank_transaction" },
      select: { id: true },
    });
    const doc = await prisma.finCashBankTransaction.create({
      data: {
        transaction_no: `TST-REF${Date.now() % 100000}`,
        transaction_type: "Out",
        company_id: company,
        purpose: "BYA_OUT",
        cash_bank_id: cb,
        currency_id: currency,
        transaction_amount: 75_000,
        transaction_base_amount: 75_000,
        status: "Posted",
        created_by: actor,
      },
      select: { id: true, transaction_no: true },
    });
    await recordCashBankEntry(prisma, {
      cashBankId: cb,
      date: "2026-05-12",
      type: "Transaction",
      direction: "Out",
      amount: 75_000,
      sourceDocTypeId: docType.id,
      sourceDocId: doc.id,
      note: doc.transaction_no,
      actorId: actor,
    });

    const report = await cashBankLedgerReport(cb, {
      from: "2026-05-01",
      to: "2026-05-31",
    });
    assert.ok(report);
    const entry = report.entries[0];
    assert.equal(entry.sourceDocTable, "fin_cash_bank_transaction");
    assert.equal(entry.sourceDocId, doc.id);
    assert.equal(
      entry.sourceDocNo,
      doc.transaction_no,
      "a ledger row must be traceable back to the document that moved the money"
    );

    await prisma.finCashBankTransaction.delete({ where: { id: doc.id } });
  });

  test("an opening entry carries no document reference", async () => {
    const cb = await makeCashBank({ opening: 400_000, openingDate: "2026-05-02" });
    const report = await cashBankLedgerReport(cb, {
      from: "2026-05-01",
      to: "2026-05-31",
    });
    assert.ok(report);
    assert.equal(report.entries[0].type, "Opening");
    assert.equal(report.entries[0].sourceDocTable, null);
    assert.equal(report.entries[0].sourceDocNo, null);
  });

  test("an unknown resource has no report at all", async () => {
    assert.equal(
      await cashBankLedgerReport(0, { from: "2026-01-01", to: "2026-12-31" }),
      null
    );
  });
});

// ----------------------------------------------------------- balance report

describe("the balance report summarises every resource", () => {
  test("each row reconciles, and the currency total is the sum of its rows", async () => {
    const a = await makeCashBank({ opening: 1_000_000, openingDate: "2026-01-01" });
    const b = await makeCashBank({ opening: 4_000_000, openingDate: "2026-01-01" });
    await move(a, "2026-08-05", "Out", 250_000);
    await move(b, "2026-08-06", "In", 600_000);

    const report = await cashBankBalanceReport({
      from: "2026-08-01",
      to: "2026-08-31",
    });

    const group = report.groups.find((g) => g.currencyId === currency);
    assert.ok(group);

    for (const row of group.rows) {
      assert.equal(
        row.opening + row.totalIn - row.totalOut,
        row.closing,
        `${row.label} does not reconcile`
      );
    }

    const mine = group.rows.filter((r) => r.cashBankId === a || r.cashBankId === b);
    assert.equal(mine.length, 2);
    assert.equal(mine.find((r) => r.cashBankId === a)!.closing, 750_000);
    assert.equal(mine.find((r) => r.cashBankId === b)!.closing, 4_600_000);

    assert.equal(
      group.closing,
      group.rows.reduce((t, r) => t + r.closing, 0),
      "the currency total must be its own rows"
    );
  });

  test("currencies are grouped and never added together", async () => {
    const idr = await makeCashBank({ opening: 1_000_000, openingDate: "2026-01-01" });
    const other = await makeCashBank({
      opening: 2_000,
      openingDate: "2026-01-01",
      currencyId: otherCurrency,
    });

    const report = await cashBankBalanceReport({
      from: "2026-09-01",
      to: "2026-09-30",
    });

    const groupOf = (id: number) =>
      report.groups.find((g) => g.rows.some((r) => r.cashBankId === id));

    const one = groupOf(idr);
    const two = groupOf(other);
    assert.ok(one && two);
    assert.notEqual(
      one.currencyId,
      two.currencyId,
      "two currencies must never share a group"
    );

    // Each group totals its own rows and nothing else — which is what makes a
    // combined figure across currencies impossible rather than merely absent.
    for (const g of report.groups) {
      assert.equal(g.opening, g.rows.reduce((t, r) => t + r.opening, 0));
      assert.equal(g.totalIn, g.rows.reduce((t, r) => t + r.totalIn, 0));
      assert.equal(g.totalOut, g.rows.reduce((t, r) => t + r.totalOut, 0));
      assert.equal(g.closing, g.rows.reduce((t, r) => t + r.closing, 0));
    }

    // And the report exposes no total spanning them.
    assert.ok(
      !Object.keys(report).some((k) => /total|grand|sum/i.test(k)),
      "a report-wide money total would have to invent an exchange rate"
    );
  });

  test("a deactivated resource still appears when it holds or moved money", async () => {
    const cb = await makeCashBank({
      opening: 900_000,
      openingDate: "2026-01-01",
      status: "Inactive",
    });
    await move(cb, "2026-10-04", "Out", 100_000);

    const report = await cashBankBalanceReport({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    const row = report.groups
      .flatMap((g) => g.rows)
      .find((r) => r.cashBankId === cb);

    assert.ok(
      row,
      "omitting it would leave a report that does not match its own ledger"
    );
    assert.equal(row.active, false);
    assert.equal(row.closing, 800_000);
  });

  test("narrowing to one resource reports only that resource", async () => {
    const cb = await makeCashBank({ opening: 300_000, openingDate: "2026-01-01" });

    const report = await cashBankBalanceReport(
      { from: "2026-11-01", to: "2026-11-30" },
      cb
    );
    assert.equal(report.resources, 1);
    assert.equal(report.groups.length, 1);
    assert.equal(report.groups[0].rows[0].cashBankId, cb);
    assert.equal(report.groups[0].rows[0].opening, 300_000);
  });

  test("the two reports agree with each other for the same subject and period", async () => {
    const cb = await makeCashBank({ opening: 5_000_000, openingDate: "2026-01-01" });
    await move(cb, "2026-12-03", "In", 1_000_000);
    await move(cb, "2026-12-09", "Out", 250_000);
    const range = { from: "2026-12-01", to: "2026-12-31" };

    const ledger = await cashBankLedgerReport(cb, range);
    const balance = await cashBankBalanceReport(range, cb);
    const row = balance.groups[0].rows[0];

    assert.ok(ledger);
    assert.equal(row.opening, ledger.opening);
    assert.equal(row.totalIn, ledger.totalIn);
    assert.equal(row.totalOut, ledger.totalOut);
    assert.equal(row.closing, ledger.closing);
  });
});
