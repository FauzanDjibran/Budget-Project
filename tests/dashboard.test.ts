import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { dashboardData } from "../src/lib/siba/dashboard";
import {
  FIXTURE_PREFIX,
  budgetCategoryId,
  childCompanyId,
  cleanupFiscalYear,
  cleanupFixtures,
  disconnect,
  openFiscalYear,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The dashboard's one rule about Budgets: **the month's plan is what was
 * committed in it**. The two plan tiles read every Budget dated in the chosen
 * month that was submitted and not refused or withdrawn — Submitted, Approved,
 * Open and Closed — and never a Draft, which is a preparation record that may
 * never happen.
 *
 * The suite builds its own fixtures in **its own currency**, so nothing else
 * the database holds can land in its figures, and removes them afterwards.
 * The seed carries system data only; nothing here assumes a row.
 */

const today = new Date().toISOString().slice(0, 10);

let induk = 0;
let anak = 0;
let actor = 0;
let currency = 0;

const budgets: number[] = [];

async function makeBudget(options: {
  companyId: number;
  status: "Draft" | "Submitted" | "Rejected" | "Cancelled" | "Approved" | "Open" | "Closed";
  amount: number;
}): Promise<number> {
  const key = `${FIXTURE_PREFIX}DSH${budgets.length + 1}${Date.now() % 100000}`;
  const row = await prisma.budBudget.create({
    data: {
      budget_no: `TST-${key}`,
      budget_date: new Date(`${today}T00:00:00Z`),
      company_id: options.companyId,
      currency_id: currency,
      budget_type: "Out",
      // An Approved Budget is waiting for its classification, so it has none.
      category_id:
        options.status === "Approved" ? null : await budgetCategoryId("Biaya"),
      description: `Fixture ${key}`,
      budget_amount: options.amount,
      realized_amount: 0,
      status: options.status,
      created_by: actor,
    },
    select: { id: true },
  });
  budgets.push(row.id);
  return row.id;
}

/** The fixture Budgets the dashboard returned, by id. */
const mineIn = (ids: number[]) => ids.filter((id) => budgets.includes(id)).sort();

const planned: number[] = [];
let draftId = 0;
let rejectedId = 0;
let cancelledId = 0;
let anakId = 0;

before(async () => {
  induk = await parentCompanyId();
  anak = await childCompanyId();
  actor = await systemUserId();
  // Budget Month is read off the fiscal periods, so today needs one.
  await openFiscalYear();

  const made = await prisma.refCurrency.create({
    data: {
      currency_code: `test.${FIXTURE_PREFIX}DSHC`,
      currency_label: `${FIXTURE_PREFIX}D`,
      currency_name: "Fixture dashboard currency",
      created_by: actor,
    },
    select: { id: true },
  });
  currency = made.id;

  for (const status of ["Submitted", "Approved", "Open", "Closed"] as const) {
    planned.push(await makeBudget({ companyId: induk, status, amount: 100_000 }));
  }
  draftId = await makeBudget({ companyId: induk, status: "Draft", amount: 700_000 });
  rejectedId = await makeBudget({ companyId: induk, status: "Rejected", amount: 300_000 });
  cancelledId = await makeBudget({ companyId: induk, status: "Cancelled", amount: 200_000 });
  anakId = await makeBudget({ companyId: anak, status: "Open", amount: 400_000 });
});

after(async () => {
  if (budgets.length) {
    await prisma.budBudget.deleteMany({ where: { id: { in: budgets } } });
  }
  if (currency) {
    await prisma.refCurrency.deleteMany({ where: { id: currency } });
  }
  await cleanupFiscalYear();
  await cleanupFixtures();
  await disconnect();
});

describe("the month's plan", () => {
  test("counts what was committed, and never a Draft, a rejection or a withdrawal", async () => {
    const data = await dashboardData([induk]);
    assert.ok(data.month?.current, "the dashboard opens on the current month");
    const ids = mineIn(data.budgets.map((b) => b.id));
    assert.deepEqual(ids, [...planned].sort());
    for (const id of [draftId, rejectedId, cancelledId]) {
      assert.equal(ids.includes(id), false);
    }
  });

  test("the anak's Budgets are absent from an induk-only dashboard", async () => {
    const indukOnly = await dashboardData([induk]);
    assert.equal(indukOnly.budgets.some((b) => b.id === anakId), false);
    const both = await dashboardData([induk, anak]);
    assert.equal(both.budgets.some((b) => b.id === anakId), true);
  });

  test("every Budget's currency and category can be named", async () => {
    const data = await dashboardData([induk]);
    const currencies = new Set(data.currencies.map((c) => c.id));
    const categories = new Set(data.categories.map((c) => c.id));
    for (const b of data.budgets) {
      assert.ok(currencies.has(b.currency_id));
      if (b.category_id != null) assert.ok(categories.has(b.category_id));
    }
  });
});

describe("the reader's Companies", () => {
  test("no Company at all summarises nothing rather than everything", async () => {
    const data = await dashboardData([]);
    assert.equal(data.cash.rows.length, 0);
    assert.deepEqual(data.books, []);
    assert.deepEqual(data.profitLoss, []);
    assert.deepEqual(data.budgets, []);
    assert.equal(data.layers.resources, 0);
  });

  test("a Laba Rugi tile is offered for every Company the reader may see", async () => {
    const data = await dashboardData([induk, anak]);
    assert.deepEqual(
      data.profitLoss.map((p) => p.companyId).sort(),
      [induk, anak].sort()
    );
  });
});
