import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  cashBankBalanceMap,
  cashBankBalanceReport,
  cashBankLedgerReport,
  cashBookSummary,
  openCashBankBook,
  rebuildCashBankBalance,
  recordCashBankEntry,
} from "../src/lib/siba/cash-bank";
import { drawFromLayer, openLayer } from "../src/lib/siba/cash-bank-layers";
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
    rate: 1,
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
    await prisma.cashBankPeriod.deleteMany({ where: { cash_bank_id: { in: made } } });
    await prisma.cashBankLayer.deleteMany({ where: { cash_bank_id: { in: made } } });
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
    assert.equal(entries[0].movement.toNumber(), 5_000_000);
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
      rate: 1,
      actorId: actor,
    });
    await recordCashBankEntry(prisma, {
      cashBankId: id,
      date: today,
      type: "Transaction",
      direction: "In",
      amount: 80_000,
      rate: 1,
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
      rate: 1,
      actorId: actor,
    });

    // Corrupt the materialised total the way a stray write would, then prove
    // the ledger is what repairs it.
    await prisma.cashBankBalance.update({
      where: { cash_bank_id: id },
      data: { balance: 999 },
    });
    assert.deepEqual(await rebuildCashBankBalance(id), {
      balance: 2_000_000,
      baseBalance: 2_000_000,
    });

    const stored = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: id },
    });
    assert.equal(stored.balance.toNumber(), 2_000_000);
  });

  test("an entry is one signed figure per measure, the sign its direction", async () => {
    // Opened with enough to cover the movement: a resource may no longer be
    // driven below zero, so a payment out of an empty book is refused before
    // it can demonstrate anything about signs.
    const id = await makeCashBank(500_000);
    await recordCashBankEntry(prisma, {
      cashBankId: id,
      date: today,
      type: "Transaction",
      direction: "Out",
      amount: 125_000,
      rate: 1,
      actorId: actor,
    });
    // The payment, not the opening entry that had to precede it.
    const entry = await prisma.cashBankLedger.findFirstOrThrow({
      where: { cash_bank_id: id, entry_type: "Transaction" },
    });
    // One signed figure per measure: the sign is the direction.
    assert.equal(entry.movement.toNumber(), -125_000, "money out is negative");
    assert.equal(
      entry.base_movement.toNumber(),
      -125_000,
      "and the base measure is signed the same way the foreign one is"
    );
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

// -------------------------------------------------------- the base measure

describe("every entry carries what it was worth in base currency", () => {
  test("a rate is required, and must be a real one", async () => {
    const id = await makeCashBank(1_000_000);
    for (const rate of [0, -1, Number.NaN]) {
      await assert.rejects(
        () =>
          recordCashBankEntry(prisma, {
            cashBankId: id,
            date: today,
            type: "Transaction",
            direction: "In",
            amount: 1_000,
            rate,
            actorId: actor,
          }),
        /Kurs/,
        `a rate of ${rate} should be refused outright`
      );
    }
  });

  test("base is the foreign amount at the entry's own rate", async () => {
    const id = await makeCashBank(0);
    await recordCashBankEntry(prisma, {
      cashBankId: id,
      date: today,
      type: "Transaction",
      direction: "In",
      amount: 300,
      rate: 15_500,
      actorId: actor,
    });
    const entry = await prisma.cashBankLedger.findFirstOrThrow({
      where: { cash_bank_id: id, entry_type: "Transaction" },
    });
    assert.equal(entry.movement.toNumber(), 300);
    assert.equal(entry.rate.toNumber(), 15_500);
    assert.equal(entry.base_movement.toNumber(), 4_650_000);
    // The property that makes a book independently checkable: every row's own
    // arithmetic holds, without reference to any other book.
    assert.equal(
      entry.base_movement.toNumber() / entry.movement.toNumber(),
      entry.rate.toNumber(),
      "base / foreign equals the rate recorded on the row"
    );
  });

  test("the caller's exact base wins over the product", async () => {
    // A layer drawn to nothing releases its remaining base exactly rather than
    // as a recomputed product, so the two can differ by a rounding unit and the
    // caller's figure is the true one.
    const id = await makeCashBank(0);
    await recordCashBankEntry(prisma, {
      cashBankId: id,
      date: today,
      type: "Transaction",
      direction: "In",
      amount: 3,
      rate: 3_333.333333,
      baseAmount: 10_000,
      actorId: actor,
    });
    const entry = await prisma.cashBankLedger.findFirstOrThrow({
      where: { cash_bank_id: id, entry_type: "Transaction" },
    });
    assert.equal(Math.abs(entry.base_movement.toNumber()), 10_000);
    assert.notEqual(Math.abs(entry.base_movement.toNumber()), 9_999.99);
  });

  test("both measures rebuild from their own column, and agree with the total", async () => {
    const id = await makeCashBank(0);
    for (const [amount, rate] of [
      [200, 15_000],
      [300, 15_500],
      [100, 16_100],
    ] as const) {
      await recordCashBankEntry(prisma, {
        cashBankId: id,
        date: today,
        type: "Transaction",
        direction: "In",
        amount,
        rate,
        actorId: actor,
      });
    }

    const stored = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: id },
    });
    assert.equal(stored.balance.toNumber(), 600);
    assert.equal(stored.base_balance.toNumber(), 3_000_000 + 4_650_000 + 1_610_000);

    // Corrupt both, then prove the entries repair both.
    await prisma.cashBankBalance.update({
      where: { cash_bank_id: id },
      data: { balance: 1, base_balance: 1 },
    });
    const rebuilt = await rebuildCashBankBalance(id);
    assert.equal(rebuilt.balance, 600);
    assert.equal(rebuilt.baseBalance, 9_260_000);

    // The account's own carrying rate is the weighted average of what it holds
    // — a figure that appeared in none of the three movements above. It is
    // derived here and stored nowhere.
    assert.equal(
      Math.round((rebuilt.baseBalance / rebuilt.balance) * 100) / 100,
      15_433.33
    );
  });
});

describe("a resource can never hold less than nothing", () => {
  test("a payment larger than the balance is refused", async () => {
    const id = await makeCashBank(500_000);
    await assert.rejects(
      () =>
        recordCashBankEntry(prisma, {
          cashBankId: id,
          date: today,
          type: "Transaction",
          direction: "Out",
          amount: 500_001,
          rate: 1,
          actorId: actor,
        }),
      /Saldo Cash & Bank tidak mencukupi/
    );
  });

  test("a refusal leaves nothing behind", async () => {
    const id = await makeCashBank(500_000);
    const before = await prisma.cashBankLedger.count({ where: { cash_bank_id: id } });
    await assert.rejects(() =>
      recordCashBankEntry(prisma, {
        cashBankId: id,
        date: today,
        type: "Transaction",
        direction: "Out",
        amount: 900_000,
        rate: 1,
        actorId: actor,
      })
    );
    assert.equal(
      await prisma.cashBankLedger.count({ where: { cash_bank_id: id } }),
      before,
      "no entry is written for a movement that was refused"
    );
    const stored = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: id },
    });
    assert.equal(stored.balance.toNumber(), 500_000, "and the balance is untouched");
  });

  test("spending the balance exactly is allowed", async () => {
    // The boundary is zero, not "nearly zero" — emptying an account is an
    // ordinary thing to do.
    const id = await makeCashBank(500_000);
    await recordCashBankEntry(prisma, {
      cashBankId: id,
      date: today,
      type: "Transaction",
      direction: "Out",
      amount: 500_000,
      rate: 1,
      actorId: actor,
    });
    const stored = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: id },
    });
    assert.equal(stored.balance.toNumber(), 0);
    assert.equal(stored.base_balance.toNumber(), 0);
  });

  test("a resource cannot be opened with a negative balance", async () => {
    const account = await makeAccount({
      companyId: company,
      subcategoryLabel: CASH_BANK_SUBCATEGORY,
    });
    const key = `${FIXTURE_PREFIX}CBNEG${Date.now() % 100000}`;
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
    made.push(row.id);
    await assert.rejects(
      () =>
        openCashBankBook(prisma, {
          cashBankId: row.id,
          openingBalance: -1_000,
          rate: 1,
          date: today,
          actorId: actor,
        }),
      /tidak boleh negatif/,
      "the one path that used to reach a negative balance is closed too"
    );
  });
});

describe("a backdated movement is checked on every day from its date on", () => {
  async function emptyResource(): Promise<number> {
    const account = await makeAccount({ companyId: company, subcategoryLabel: CASH_BANK_SUBCATEGORY });
    const key = `${FIXTURE_PREFIX}CBP${made.length + 1}${Date.now() % 100000}`;
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
    await openCashBankBook(prisma, { cashBankId: row.id, openingBalance: 0, rate: 1, date: today, actorId: actor });
    made.push(row.id);
    return row.id;
  }
  const move = (id: number, date: string, signed: number) =>
    recordCashBankEntry(prisma, {
      cashBankId: id,
      date,
      type: "Transaction",
      direction: signed > 0 ? "In" : "Out",
      amount: Math.abs(signed),
      rate: 1,
      actorId: actor,
    });

  /** Every month row equals what the entries, read in date order, say it is. */
  async function assertChainMatchesBook(id: number) {
    const [periods, entries] = await Promise.all([
      prisma.cashBankPeriod.findMany({ where: { cash_bank_id: id }, orderBy: { period: "asc" } }),
      prisma.cashBankLedger.findMany({
        where: { cash_bank_id: id },
        orderBy: [{ entry_date: "asc" }, { id: "asc" }],
      }),
    ]);
    let run = 0;
    for (const p of periods) {
      const next = new Date(Date.UTC(p.period.getUTCFullYear(), p.period.getUTCMonth() + 1, 1));
      const inMonth = entries.filter((e) => e.entry_date >= p.period && e.entry_date < next);
      assert.equal(p.opening.toNumber(), run, `opening ${p.period.toISOString()}`);
      let min = run;
      let tin = 0;
      let tout = 0;
      for (const e of inMonth) {
        const m = e.movement.toNumber();
        run += m;
        min = Math.min(min, run);
        if (m > 0) tin += m;
        else tout -= m;
      }
      assert.equal(p.total_in.toNumber(), tin);
      assert.equal(p.total_out.toNumber(), tout);
      assert.equal(p.closing.toNumber(), run);
      assert.equal(p.min_balance.toNumber(), min, `min ${p.period.toISOString()}`);
    }
    const months = new Set(entries.map((e) => e.entry_date.toISOString().slice(0, 7)));
    for (const m of months) {
      assert.ok(periods.some((p) => p.period.toISOString().startsWith(m)), `month ${m} has a row`);
    }
  }

  test("a payment that would take an earlier day below nothing is refused, though the month closes positive", async () => {
    const id = await emptyResource();
    await move(id, "2020-01-01", 100);
    await move(id, "2020-01-05", -80);
    await move(id, "2020-01-20", 200);
    await assert.rejects(() => move(id, "2020-01-03", -50), /tidak mencukupi pada 05\/01\/2020: tersedia 20/);
    await move(id, "2020-01-03", -20);
    await assertChainMatchesBook(id);
  });

  test("a payment that would take a later month's lowest point below nothing is refused", async () => {
    const id = await emptyResource();
    await move(id, "2020-01-01", 220);
    await move(id, "2020-02-02", -210);
    await move(id, "2020-02-25", 500);
    await assert.rejects(() => move(id, "2020-01-15", -50), /tidak mencukupi pada bulan 02\/2020: tersedia 10/);
    await move(id, "2020-01-15", -10);
    await assertChainMatchesBook(id);
  });

  test("a movement dated before the first entry extends the chain backwards", async () => {
    const id = await emptyResource();
    await move(id, "2020-03-10", 100);
    await assert.rejects(() => move(id, "2020-01-10", -1), /tidak mencukupi pada 10\/01\/2020: tersedia 0/);
    await move(id, "2020-01-10", 40);
    await move(id, "2020-02-10", -30);
    await move(id, "2020-06-10", -100);
    await assertChainMatchesBook(id);
    const rows = await prisma.cashBankPeriod.count({ where: { cash_bank_id: id } });
    assert.equal(rows, 6, "January to June, unbroken");
  });

  test("backdated money in lifts every later month, and a payment it covers then passes", async () => {
    const id = await emptyResource();
    await move(id, "2020-01-10", 100);
    await move(id, "2020-03-10", -100);
    await move(id, "2020-04-10", 20);
    await assert.rejects(() => move(id, "2020-02-15", -50), /tidak mencukupi/);
    await move(id, "2020-01-20", 70);
    const march = await prisma.cashBankPeriod.findUniqueOrThrow({
      where: { cash_bank_id_period: { cash_bank_id: id, period: new Date("2020-03-01") } },
    });
    assert.equal(march.opening.toNumber(), 170);
    assert.equal(march.min_balance.toNumber(), 70, "March's lowest point moved with the money");
    await move(id, "2020-02-15", -50);
    await assertChainMatchesBook(id);
  });

  test("the reports open from the month row and agree with the full scan", async () => {
    const id = await emptyResource();
    await move(id, "2020-01-05", 1_000);
    await move(id, "2020-02-03", -300);
    await move(id, "2020-02-20", 50);
    await move(id, "2020-01-25", -100);
    const ledger = await cashBankLedgerReport(id, { from: "2020-02-10", to: "2020-02-28" }, [company]);
    assert.equal(ledger?.opening, 600);
    assert.equal(ledger?.closing, 650);
    const later = await cashBankLedgerReport(id, { from: "2020-05-01", to: "2020-05-31" }, [company]);
    assert.equal(later?.opening, 650, "a month after the chain carries its last closing");
    const earlier = await cashBankLedgerReport(id, { from: "2019-12-01", to: "2019-12-31" }, [company]);
    assert.equal(earlier?.opening, 0);
    const summary = await cashBankBalanceReport({ from: "2020-02-10", to: "2020-02-28" }, [company], id);
    assert.equal(summary.groups[0]?.rows[0]?.opening, 600);
  });
});

describe("a foreign resource: the month chain checks the account, the layer only its own remainder", () => {
  // The chain is kept in the resource's own currency, so a USD account is
  // checked in USD. A layer carries no per-day check: it may be drawn by a
  // payment dated before it was acquired, as long as the account held the
  // dollars that day (CLAUDE.md §12, "A document may be backdated").
  async function usdResource(): Promise<number> {
    const usd = (
      await prisma.refCurrency.upsert({
        where: { currency_code: `test.${FIXTURE_PREFIX}CBPU` },
        update: { status: "Active" },
        create: {
          currency_code: `test.${FIXTURE_PREFIX}CBPU`,
          currency_label: `${FIXTURE_PREFIX}CBPU`,
          currency_name: "Fixture USD",
          created_by: actor,
        },
        select: { id: true },
      })
    ).id;
    const account = await makeAccount({ companyId: company, subcategoryLabel: CASH_BANK_SUBCATEGORY });
    const key = `${FIXTURE_PREFIX}CBU${made.length + 1}${Date.now() % 100000}`;
    const row = await prisma.mCashBank.create({
      data: {
        cash_bank_code: `test.${key}`,
        cash_bank_label: key,
        cash_bank_name: `Fixture ${key}`,
        company_id: company,
        cash_bank_type: "Bank",
        currency_id: usd,
        account_id: account,
        created_by: actor,
      },
      select: { id: true },
    });
    await openCashBankBook(prisma, { cashBankId: row.id, openingBalance: 0, rate: 1, date: today, actorId: actor });
    made.push(row.id);
    return row.id;
  }
  /** Money in: a new layer and its book entry, as a posting writes them. */
  const receive = (id: number, date: string, foreign: number, rate: number) =>
    prisma.$transaction(async (tx) => {
      const layer = await openLayer(tx, { cashBankId: id, date, rate, foreign, actorId: actor });
      await recordCashBankEntry(tx, {
        cashBankId: id, date, type: "Transaction", direction: "In", amount: foreign, rate,
        baseAmount: layer.base_original.toNumber(), actorId: actor,
      });
      return layer.id;
    });
  /** Money out of one chosen layer, at that layer's kurs. */
  const pay = (id: number, layerId: number, date: string, foreign: number) =>
    prisma.$transaction(async (tx) => {
      const drawn = await drawFromLayer(tx, { layerId, cashBankId: id, foreign, date, actorId: actor });
      await recordCashBankEntry(tx, {
        cashBankId: id, date, type: "Transaction", direction: "Out", amount: foreign, rate: drawn.rate,
        baseAmount: drawn.base, actorId: actor,
      });
    });
  const remaining = async (layerId: number) =>
    (await prisma.cashBankLayer.findUniqueOrThrow({ where: { id: layerId } })).foreign_remaining.toNumber();

  test("the 03 Jan case in USD: a layer acquired later cannot pay for an earlier day", async () => {
    const id = await usdResource();
    const a = await receive(id, "2020-01-01", 100, 15_000);
    await pay(id, a, "2020-01-05", 80);
    const b = await receive(id, "2020-01-20", 200, 17_000);

    // Layer B did not exist on 03/01, however much it holds now: drawing it
    // would release 17.000 rupiah per dollar the account never held that day.
    await assert.rejects(() => pay(id, b, "2020-01-03", 20), /baru diperoleh pada 20\/01\/2020/);
    assert.equal(await remaining(b), 200, "the refused draw rolled back with the posting");

    // Layer A existed, but holds only USD 20 — so every layer, and with it the
    // account, stays at or above nothing on every day.
    await assert.rejects(() => pay(id, a, "2020-01-03", 50), /hanya menyisakan 20/);
    assert.equal(await remaining(a), 20);

    // USD 20 from layer A covers every day.
    await pay(id, a, "2020-01-03", 20);
    assert.equal(await remaining(a), 0);

    // From 05/01 to 19/01 the account holds USD 0, and so Rp 0: A was drawn to
    // nothing, and a layer drawn to nothing hands back exactly the base it held.
    const upTo19 = await prisma.cashBankLedger.aggregate({
      where: { cash_bank_id: id, entry_date: { lte: new Date("2020-01-19") } },
      _sum: { movement: true, base_movement: true },
    });
    assert.equal(upTo19._sum.movement?.toNumber(), 0);
    assert.equal(upTo19._sum.base_movement?.toNumber(), 0);

    // A layer may still be drawn on its own acquisition day.
    await pay(id, b, "2020-01-20", 50);
    assert.equal(await remaining(b), 150);
  });

  test("a layer cannot pay more than it holds, however much the account holds", async () => {
    const id = await usdResource();
    const a = await receive(id, "2020-01-01", 100, 15_000);
    await pay(id, a, "2020-01-05", 80);
    await receive(id, "2020-01-20", 200, 17_000);
    // The account holds USD 220 on 25/01; layer A holds 20.
    await assert.rejects(() => pay(id, a, "2020-01-25", 30), /hanya menyisakan 20/);
  });
});
