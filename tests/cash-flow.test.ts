import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { openCashBankBook, recordCashBankEntry, type NewEntry } from "../src/lib/siba/cash-bank";
import { buildCashFlowReport } from "../src/lib/siba/cash-flow-run";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import {
  FIXTURE_PREFIX,
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
 * The Laporan Arus Kas reads the Cash Bank Book's Partner and Budget Category
 * and resolves each sum's group through Mapping Cash Flow when it is built.
 * Its money property: per column, Saldo Awal + every row + a registration =
 * Saldo Akhir. Dated 1981, which nothing real touches.
 */

let company = 0;
let actor = 0;
let currency = 0;
const made: number[] = [];
const groups: number[] = [];

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

async function group(label: string): Promise<number> {
  const row = await prisma.sysCashflowGroup.create({
    data: {
      group_code: `test.${FIXTURE_PREFIX}${groups.length}${Date.now() % 100000}`,
      group_label: `${FIXTURE_PREFIX} ${label}`,
      group_name: `${FIXTURE_PREFIX} ${label}`,
      created_by: actor,
    },
    select: { id: true },
  });
  groups.push(row.id);
  return row.id;
}

const entry = (cashBankId: number, date: string, o: Partial<NewEntry>) =>
  recordCashBankEntry(prisma, { cashBankId, date, type: "Realization", direction: "In", amount: 0, rate: 1, actorId: actor, ...o });

before(async () => {
  company = await parentCompanyId();
  actor = await systemUserId();
  currency = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" }, select: { id: true } })).id;
});

after(async () => {
  if (made.length) {
    await prisma.cashBankLedger.deleteMany({ where: { cash_bank_id: { in: made } } });
    await prisma.cashBankBalance.deleteMany({ where: { cash_bank_id: { in: made } } });
    await prisma.cashBankPeriod.deleteMany({ where: { cash_bank_id: { in: made } } });
    await prisma.mCashBank.deleteMany({ where: { id: { in: made } } });
  }
  await cleanupFixtures();
  await prisma.sysCashflowGroup.deleteMany({ where: { id: { in: groups } } });
  await disconnect();
});

describe("Laporan Arus Kas", () => {
  test("reconciles per column; group → category → Partner or keterangan; a transfer is left out", async () => {
    const a = await resource();
    const b = await resource();
    const partner = await makePartner({ companyId: company, categoryLabel: "Lainnya" });
    const piutang = await makeBudgetCategory({ label: "CF Piutang", directions: ["In", "Out"] });
    const biaya = await makeBudgetCategory({ label: "CF Biaya", directions: ["Out"] });

    await entry(a, "1981-01-02", { type: "Register", amount: 1_000_000 });
    await entry(a, "1981-02-03", { amount: 500_000, partnerId: partner, budgetCategoryId: piutang });
    await entry(a, "1981-02-04", { direction: "Out", amount: 200_000, partnerId: partner, budgetCategoryId: piutang });
    await entry(a, "1981-02-05", { direction: "Out", amount: 50_000, budgetCategoryId: biaya, note: "Listrik Februari" });
    await entry(a, "1981-02-06", { type: "Funding", direction: "Out", amount: 70_000, partnerId: partner, budgetCategoryId: biaya });
    await entry(a, "1981-02-07", { type: "Transfer", direction: "Out", amount: 100_000 });
    await entry(b, "1981-02-07", { type: "Transfer", amount: 100_000 });
    await entry(b, "1981-02-08", { type: "Register", amount: 30_000 });

    const report = await buildCashFlowReport(company, currency, [
      { label: "Jan", from: "1981-01-01", to: "1981-01-31" },
      { label: "Feb", from: "1981-02-01", to: "1981-02-28" },
    ]);

    const cats = report.groups.flatMap((g) => [...g.receipts, ...g.payments]);
    for (const col of [0, 1]) {
      const listed = cats.reduce((t, c) => t + c.values[col], 0);
      assert.equal(report.opening[col] + listed + report.registered[col], report.closing[col], `column ${col}`);
    }
    for (const c of cats) {
      assert.equal(c.children.reduce((t, l) => t + l.values[1], 0), c.values[1], `${c.name} adds up to its rows`);
    }

    // The fixture categories are mapped by `makeBudgetCategory`, to a seeded group.
    const label = (await prisma.mPartner.findUniqueOrThrow({ where: { id: partner } })).partner_label;
    const inPiutang = cats.filter((c) => c.key === `c:${piutang}`);
    assert.deepEqual(inPiutang.map((c) => c.values[1]).sort(), [-200_000, 500_000], "gross on both sides");
    assert.ok(inPiutang.every((c) => c.children[0].name.startsWith(label)), "the Partner is the detail");
    const biayaRow = cats.find((c) => c.key === `c:${biaya}`)!;
    assert.equal(biayaRow.children[0].name, "Listrik Februari", "no Partner: its keterangan is the detail");
    assert.equal(cats.find((c) => c.key === "intercompany")?.values[1], -70_000, "Funding is one Intercompany line");
    assert.ok(!cats.some((c) => c.key === "t:Transfer"), "a transfer is not a cash flow");
  });

  test("remapping a category moves its history to the new group", async () => {
    const a = await resource();
    const category = await makeBudgetCategory({ label: "CF Remap", directions: ["Out"] });
    await entry(a, "1981-03-02", { type: "Register", amount: 100_000 });
    await entry(a, "1981-03-03", { direction: "Out", amount: 10_000, budgetCategoryId: category, note: "Sewa" });

    const columns = [{ label: "Mar", from: "1981-03-01", to: "1981-03-31" }];
    const where = (r: Awaited<ReturnType<typeof buildCashFlowReport>>) =>
      r.groups.find((g) => g.payments.some((c) => c.key === `c:${category}`))?.id;

    const moved = await group("Pindahan");
    await prisma.accCashflowMapping.update({ where: { budget_category_id: category }, data: { cashflow_group_id: moved } });
    assert.equal(where(await buildCashFlowReport(company, currency, columns)), moved);

    await prisma.accCashflowMapping.delete({ where: { budget_category_id: category } });
    assert.equal(where(await buildCashFlowReport(company, currency, columns)), null, "unmapped: Belum Dikelompokkan");
  });
});
