import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { cashFlowReport, openCashBankBook, recordCashBankEntry, type NewEntry } from "../src/lib/siba/cash-bank";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import {
  FIXTURE_PREFIX,
  anyCashflowGroupId,
  cleanupFixtures,
  disconnect,
  makeAccount,
  makeBudgetCategory,
  makePartner,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The Laporan Arus Kas reads the Cash Bank Book alone. Its one property is the
 * money report's: per column, Saldo Awal + every row listed + a registration =
 * Saldo Akhir. Dated 1981, which nothing real touches.
 */

let company = 0;
let actor = 0;
let currency = 0;
let group = 0;
const made: number[] = [];

async function resource(): Promise<number> {
  const account = await makeAccount({ companyId: company, subcategoryLabel: CASH_BANK_SUBCATEGORY });
  const key = `${FIXTURE_PREFIX}CF${made.length + 1}${Date.now() % 100000}`;
  const row = await prisma.mCashBank.create({
    data: {
      cash_bank_code: `test.${key}`,
      cash_bank_label: key,
      cash_bank_name: `Fixture ${key}`,
      company_id: company,
      cash_bank_type: "Cash",
      currency_id: currency,
      account_id: account,
      created_by: actor,
    },
    select: { id: true },
  });
  await openCashBankBook(prisma, { cashBankId: row.id, openingBalance: 0, rate: 1, date: "1981-01-01", actorId: actor });
  made.push(row.id);
  return row.id;
}

const entry = (cashBankId: number, date: string, o: Partial<NewEntry>) =>
  recordCashBankEntry(prisma, { cashBankId, date, type: "Realization", direction: "In", amount: 0, rate: 1, actorId: actor, ...o });

before(async () => {
  company = await parentCompanyId();
  actor = await systemUserId();
  currency = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" }, select: { id: true } })).id;
  group = await anyCashflowGroupId();
});

after(async () => {
  if (made.length) {
    await prisma.cashBankLedger.deleteMany({ where: { cash_bank_id: { in: made } } });
    await prisma.cashBankBalance.deleteMany({ where: { cash_bank_id: { in: made } } });
    await prisma.cashBankPeriod.deleteMany({ where: { cash_bank_id: { in: made } } });
    await prisma.mCashBank.deleteMany({ where: { id: { in: made } } });
  }
  await cleanupFixtures();
  await disconnect();
});

describe("Laporan Arus Kas", () => {
  test("reconciles per column, lists gross by Partner, and leaves out a transfer", async () => {
    const a = await resource();
    const b = await resource();
    const partner = await makePartner({ companyId: company, categoryLabel: "Lainnya" });
    const biaya = await makeBudgetCategory({ label: "CF Biaya", directions: ["Out"] });

    await entry(a, "1981-01-02", { type: "Register", amount: 1_000_000 });
    await entry(a, "1981-02-03", { amount: 500_000, partnerId: partner, cashflowGroupId: group });
    await entry(a, "1981-02-04", { direction: "Out", amount: 200_000, partnerId: partner, cashflowGroupId: group });
    await entry(a, "1981-02-05", { direction: "Out", amount: 50_000, budgetCategoryId: biaya, cashflowGroupId: group });
    await entry(a, "1981-02-06", { type: "Funding", direction: "Out", amount: 70_000, partnerId: partner, cashflowGroupId: group });
    await entry(a, "1981-02-07", { type: "Transfer", direction: "Out", amount: 100_000 });
    await entry(b, "1981-02-07", { type: "Transfer", amount: 100_000 });
    await entry(b, "1981-02-08", { type: "Register", amount: 30_000 });

    const report = await cashFlowReport([company], currency, [
      { label: "Jan", from: "1981-01-01", to: "1981-01-31" },
      { label: "Feb", from: "1981-02-01", to: "1981-02-28" },
    ]);

    const flows = report.groups.flatMap((g) => [...g.receipts, ...g.payments]);
    for (const col of [0, 1]) {
      const listed = flows.reduce((t, r) => t + r.values[col], 0);
      assert.equal(report.opening[col] + listed + report.registered[col], report.closing[col], `column ${col}`);
    }
    assert.equal(report.closing[1] - report.opening[1], 500_000 - 200_000 - 50_000 - 70_000 + 30_000);

    const g = report.groups.find((x) => x.id === group)!;
    const name = `${(await prisma.mPartner.findUniqueOrThrow({ where: { id: partner } })).partner_label}`;
    assert.equal(g.receipts.find((r) => r.name.startsWith(name))?.values[1], 500_000, "gross receipt");
    assert.equal(g.payments.find((r) => r.name.startsWith(name))?.values[1], -200_000, "gross payment");
    assert.ok(g.payments.some((r) => r.key.startsWith("c:") && r.values[1] === -50_000), "a row without Partner is its category");
    assert.equal(g.payments.find((r) => r.key === "intercompany")?.values[1], -70_000, "Funding is one Intercompany row");
    assert.ok(!flows.some((r) => r.key === "t:Transfer"), "a transfer is not a cash flow");
    assert.equal(report.registered[1], 30_000);
  });

  test("an entry written before it carried a group is surfaced, never dropped", async () => {
    const a = await resource();
    await entry(a, "1981-03-02", { type: "Register", amount: 100_000 });
    // As a row from before the column existed: written, then its group cleared.
    await entry(a, "1981-03-03", { direction: "Out", amount: 10_000, cashflowGroupId: group });
    await prisma.cashBankLedger.updateMany({ where: { cash_bank_id: a, accounting_date: new Date("1981-03-03") }, data: { cashflow_group_id: null } });

    const report = await cashFlowReport([company], currency, [{ label: "Mar", from: "1981-03-01", to: "1981-03-31" }]);
    const none = report.groups.find((g) => g.id === null);
    assert.ok(none, "Belum Dikelompokkan");
    assert.equal(none.payments.reduce((t, r) => t + r.values[0], 0), -10_000);
  });
});
