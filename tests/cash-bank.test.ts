import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  cashBankBalanceMap,
  cashBookSummary,
  openCashBankBook,
  rebuildCashBankBalance,
  recordCashBankEntry,
} from "../src/lib/siba/cash-bank";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
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
 * The Cash Bank Book.
 *
 * The balance a user sees is a materialised total, and the ledger is what it is
 * materialised from. The cases below are about the one thing that must never
 * drift: the two always agree, and every change to the balance leaves an entry
 * behind explaining it.
 */

const today = new Date().toISOString().slice(0, 10);

let company = 0;
let actor = 0;
let currency = 0;
const made: number[] = [];

async function makeCashBank(openingBalance: number): Promise<number> {
  const account = await makeAccount({ companyId: company, subcategoryLabel: CASH_BANK_SUBCATEGORY });
  const key = `${FIXTURE_PREFIX}CB${made.length + 1}${Date.now() % 100000}`;
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
  await openCashBankBook(prisma, {
    cashBankId: row.id,
    openingBalance,
    date: today,
    actorId: actor,
  });
  made.push(row.id);
  return row.id;
}

before(async () => {
  company = await parentCompanyId();
  actor = await systemUserId();
  const base = await prisma.refCurrency.findFirstOrThrow({ select: { id: true } });
  currency = base.id;
});

after(async () => {
  if (made.length) {
    await prisma.cashBankLedger.deleteMany({ where: { cash_bank_id: { in: made } } });
    await prisma.cashBankBalance.deleteMany({ where: { cash_bank_id: { in: made } } });
    await prisma.mCashBank.deleteMany({ where: { id: { in: made } } });
  }
  await cleanupFixtures();
  await disconnect();
});

describe("a resource always has a book", () => {
  test("registering one with no opening balance still opens its book at zero", async () => {
    const id = await makeCashBank(0);
    const balance = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: id },
    });
    assert.equal(balance.balance.toNumber(), 0);
    assert.equal(balance.entry_count, 0);
    assert.equal(
      await prisma.cashBankLedger.count({ where: { cash_bank_id: id } }),
      0,
      "a zero opening balance is not a movement and must not invent an entry"
    );
  });

  test("an opening balance becomes the book's first entry, not a column", async () => {
    const id = await makeCashBank(5_000_000);

    const entries = await prisma.cashBankLedger.findMany({
      where: { cash_bank_id: id },
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].entry_type, "Opening");
    assert.equal(entries[0].direction, "In");
    assert.equal(entries[0].movement.toNumber(), 5_000_000);
    assert.equal(entries[0].balance_after.toNumber(), 5_000_000);
    assert.match(entries[0].entry_no, /^CBL-\d{4}$/);

    const balances = await cashBankBalanceMap();
    assert.equal(balances.get(id), 5_000_000);
  });

  test("m_cash_bank carries no balance column of its own", async () => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'm_cash_bank'
    `;
    const names = rows.map((r) => r.column_name);
    for (const forbidden of ["balance", "opening_balance", "current_balance"]) {
      assert.ok(
        !names.includes(forbidden),
        `m_cash_bank must not carry ${forbidden} — the balance comes from the book`
      );
    }
  });
});

describe("the balance never disagrees with the ledger", () => {
  test("each entry moves the balance by exactly its own movement", async () => {
    const id = await makeCashBank(1_000_000);

    await recordCashBankEntry(prisma, {
      cashBankId: id,
      date: today,
      type: "Transaction",
      direction: "Out",
      amount: 250_000,
      actorId: actor,
    });
    await recordCashBankEntry(prisma, {
      cashBankId: id,
      date: today,
      type: "Transaction",
      direction: "In",
      amount: 80_000,
      actorId: actor,
    });

    const entries = await prisma.cashBankLedger.findMany({
      where: { cash_bank_id: id },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(
      entries.map((e) => e.movement.toNumber()),
      [1_000_000, -250_000, 80_000]
    );
    assert.deepEqual(
      entries.map((e) => e.balance_after.toNumber()),
      [1_000_000, 750_000, 830_000]
    );

    const stored = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: id },
    });
    assert.equal(stored.balance.toNumber(), 830_000);
    assert.equal(stored.entry_count, 3);
    assert.equal(stored.last_entry_id, entries.at(-1)!.id);
  });

  test("recomputing from the ledger reproduces the stored balance", async () => {
    const id = await makeCashBank(2_400_000);
    await recordCashBankEntry(prisma, {
      cashBankId: id,
      date: today,
      type: "Adjustment",
      direction: "Out",
      amount: 400_000,
      actorId: actor,
    });

    // Corrupt the materialised total the way a stray write would, then prove
    // the ledger is what repairs it.
    await prisma.cashBankBalance.update({
      where: { cash_bank_id: id },
      data: { balance: 999 },
    });
    assert.equal(await rebuildCashBankBalance(id), 2_000_000);

    const stored = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: id },
    });
    assert.equal(stored.balance.toNumber(), 2_000_000);
  });

  test("an amount is stored positive whichever way the money went", async () => {
    const id = await makeCashBank(0);
    await recordCashBankEntry(prisma, {
      cashBankId: id,
      date: today,
      type: "Transaction",
      direction: "Out",
      amount: 125_000,
      actorId: actor,
    });
    const entry = await prisma.cashBankLedger.findFirstOrThrow({
      where: { cash_bank_id: id },
    });
    assert.equal(entry.amount.toNumber(), 125_000, "amount carries no sign");
    assert.equal(entry.movement.toNumber(), -125_000, "direction carries the sign");
  });
});

describe("the summary reports per currency and never combines them", () => {
  test("a resource's balance appears under its own currency", async () => {
    const id = await makeCashBank(3_000_000);
    const summary = await cashBookSummary([company]);

    const mine = summary.rows.find((r) => r.cashBankId === id);
    assert.ok(mine, "an active resource must appear in the summary");
    assert.equal(mine.balance, 3_000_000);

    const group = summary.byCurrency.find((c) => c.currencyId === mine.currencyId);
    assert.ok(group, "its currency must be represented");
    assert.equal(
      group.balance,
      summary.rows
        .filter((r) => r.currencyId === mine.currencyId)
        .reduce((t, r) => t + r.balance, 0),
      "a currency group is the sum of its own resources and nothing else"
    );
  });

  test("an inactive resource is left out of spendable capacity", async () => {
    const id = await makeCashBank(7_000_000);
    await prisma.mCashBank.update({ where: { id }, data: { status: "Inactive" } });
    const summary = await cashBookSummary([company]);
    assert.equal(
      summary.rows.some((r) => r.cashBankId === id),
      false
    );
    await prisma.mCashBank.update({ where: { id }, data: { status: "Active" } });
  });

  test("a resource outside the reader's Companies is not summarised", async () => {
    const id = await makeCashBank(11_000_000);
    const summary = await cashBookSummary([]);
    assert.equal(
      summary.rows.some((r) => r.cashBankId === id),
      false,
      "an empty scope summarises nothing, never everything — a cash balance " +
        "belongs to a Company, and this reader may see none of them"
    );
    assert.equal(summary.resources, 0);
  });
});
