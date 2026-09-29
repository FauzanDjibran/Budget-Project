import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { postJournal } from "../src/lib/siba/journal";
import { trialBalanceReport } from "../src/lib/siba/ledger";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import {
  buildTrialBalance,
  type StatementAccount,
} from "../src/lib/siba/statement-layout";
import { trialBalanceStatement } from "../src/lib/siba/statements";
import {
  cleanupFixtures,
  disconnect,
  makeAccount,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The Trial Balance on the chart's tree.
 *
 * The layout is pure and driven directly: which column is signed by the type,
 * which is a plain sum of one side, and what a heading adds up to. The engine
 * half checks the one thing the toggle must never do — change the totals — and
 * that the tree states the same figures the flat report the close reads does.
 */

// ------------------------------------------------------------- the layout

const type = (id: number, label: string, name: string, credit: boolean) => ({ id, label, name, credit });
const AKTIVA = type(1, "1", "AKTIVA", false);
const PASIVA = type(2, "2", "PASIVA", true);

const acc = (
  id: number,
  label: string,
  t: typeof AKTIVA,
  cat: number,
  sub: number,
  parentId: number | null = null
): StatementAccount => ({
  id,
  label,
  name: `Account ${label}`,
  parentId,
  subcategory: { id: sub, label: label.split(".").slice(0, 3).join("."), name: `SUB ${sub}` },
  category: { id: cat, label: label.split(".").slice(0, 2).join("."), name: `CAT ${cat}`, step: null },
  type: t,
});

const CHART = [
  acc(1, "1.1.1.1", AKTIVA, 11, 111),
  acc(2, "1.3.9.1", AKTIVA, 13, 139), // accumulated depreciation: credit-side inside AKTIVA
  acc(3, "2.1.1.1", PASIVA, 21, 211),
  acc(4, "2.1.1.2", PASIVA, 21, 211),
  acc(5, "2.1.1.2.1", PASIVA, 21, 211, 4),
];

describe("the Trial Balance layout", () => {
  const built = buildTrialBalance(
    CHART,
    [
      { accountId: 1, opening: 1_000, debit: 300, credit: 100 },
      { accountId: 2, opening: -200, debit: 0, credit: 50 },
      { accountId: 3, opening: -800, debit: 100, credit: 250 },
    ],
    false
  );
  const row = (key: string) => built.rows.find((r) => r.key === key);

  test("saldo is signed by the type, the movement columns are one side each", () => {
    assert.deepEqual(row("a1")?.values, [1_000, 300, 100, 1_200]);
    assert.deepEqual(row("a2")?.values, [-200, 0, 50, -250], "a contra account is a deduction inside AKTIVA");
    assert.deepEqual(row("a3")?.values, [800, 100, 250, 950], "a credit-side type reads its balance positive");
  });

  test("a type heading adds up what sits beneath it", () => {
    assert.deepEqual(row("s1")?.values, [800, 300, 150, 950]);
    assert.deepEqual(row("s2")?.values, [800, 100, 250, 950]);
    assert.equal(row("s1")?.code, "1");
  });

  test("a silent account is left out, unless every account is asked for", () => {
    assert.equal(row("a4"), undefined);
    const all = buildTrialBalance(CHART, [], true);
    const keys = all.rows.map((r) => r.key);
    for (const k of ["s1", "s2", "a1", "a2", "a3", "a4", "a5"]) assert.ok(keys.includes(k), k);
    assert.ok(all.rows.every((r) => r.values.every((v) => v === 0)));
  });

  test("a sub-account sits beneath its parent, which carries its total", () => {
    const withChild = buildTrialBalance(CHART, [{ accountId: 5, opening: -40, debit: 0, credit: 10 }], false);
    const keys = withChild.rows.map((r) => r.key);
    assert.ok(keys.indexOf("a4") < keys.indexOf("a5"));
    assert.deepEqual(withChild.rows.find((r) => r.key === "a4")?.values, [40, 0, 10, 50]);
  });
});

// ------------------------------------------------------------- the engine

let company = 0;
let cash = 0;
let expense = 0;
let silent = 0;
const today = new Date().toISOString().slice(0, 10);
const RANGE = { from: today, to: today };

before(async () => {
  company = await parentCompanyId();
  const actor = await systemUserId();
  cash = await makeAccount({ companyId: company, subcategoryLabel: CASH_BANK_SUBCATEGORY });
  expense = await makeAccount({ companyId: company, subcategoryLabel: "5.3.1" });
  silent = await makeAccount({ companyId: company, subcategoryLabel: "5.3.1" });
  const currency = (
    await prisma.refCurrency.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } })
  ).id;
  const line = (accountId: number, debit: number, credit: number) => ({
    accountId,
    currencyId: currency,
    rate: 1,
    debit,
    credit,
    description: "Fixture",
  });
  await postJournal(prisma, {
    companyId: company,
    description: "Fixture journal",
    lines: [line(expense, 125_000, 0), line(cash, 0, 125_000)],
    actorId: actor,
  });
});

after(async () => {
  await cleanupFixtures();
  await disconnect();
});

describe("the Trial Balance statement", () => {
  test("its totals are the flat report's, whichever accounts are listed", async () => {
    const flat = await trialBalanceReport(RANGE, [company]);
    const moving = await trialBalanceStatement(company, RANGE, false);
    const all = await trialBalanceStatement(company, RANGE, true);
    for (const s of [moving, all]) {
      assert.equal(s.totalDebit, flat.totalDebit);
      assert.equal(s.totalCredit, flat.totalCredit);
      assert.equal(s.balanced, true);
    }
  });

  test("an account that moved is on it, with its movement", async () => {
    const s = await trialBalanceStatement(company, RANGE, false);
    const row = s.rows.find((r) => r.accountId === expense);
    assert.ok(row, "the expense moved today");
    assert.equal(row.values[1], 125_000);
    assert.equal(row.values[2], 0);
  });

  test("a silent account takes a row only when every account is asked for", async () => {
    const moving = await trialBalanceStatement(company, RANGE, false);
    assert.equal(moving.rows.find((r) => r.accountId === silent), undefined);

    const all = await trialBalanceStatement(company, RANGE, true);
    const row = all.rows.find((r) => r.accountId === silent);
    assert.ok(row, "listed with nothing on it");
    assert.deepEqual(row.values, [0, 0, 0, 0]);
  });

  test("an inactive silent account stays off even when every account is asked for", async () => {
    await prisma.accAccount.update({ where: { id: silent }, data: { is_active: false } });
    try {
      const all = await trialBalanceStatement(company, RANGE, true);
      assert.equal(all.rows.find((r) => r.accountId === silent), undefined);
    } finally {
      await prisma.accAccount.update({ where: { id: silent }, data: { is_active: true } });
    }
  });

  test("it reads one Company's chart", async () => {
    const s = await trialBalanceStatement(company, RANGE, true);
    const ids = s.rows.flatMap((r) => (r.accountId ? [r.accountId] : []));
    const foreign = await prisma.accAccount.count({
      where: { id: { in: ids }, company_id: { not: company } },
    });
    assert.equal(foreign, 0);
  });
});
