import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import {
  BUDGET_TRANSITIONS,
  availableActions,
  budgetAbilities,
  budgetIsEditable,
  transitionAllowed,
  type BudgetAction,
  type BudgetStatus,
} from "../src/lib/siba/budget-workflow";
import {
  budgetMonths,
  checkClassification,
  listBudgets,
  nextBudgetNo,
} from "../src/lib/siba/budget";
import {
  budgetCategoryId,
  childCompanyId,
  cleanupFixtures,
  disconnect,
  makePartner,
  parentCompanyId,
  prisma,
} from "./helpers";

/**
 * The Budget module's enforcement points, checked against a real database.
 *
 * Two things have to hold no matter how a request arrives. A transition must be
 * legal from the budget's current status, and a classification must satisfy the
 * whole chain Budget Category -> allowed Partner Categories -> Partner. The row
 * menu and the approval dialog narrow themselves to the same rules, but a
 * Server Action is reachable directly with any id and any pair of ids.
 *
 * Partners are business data a real user creates, so the classification cases
 * below build the ones they need and remove them afterwards.
 */

after(async () => {
  await cleanupFixtures();
  await disconnect();
});

const ALL_STATUSES: BudgetStatus[] = [
  "Draft",
  "Submitted",
  "Rejected",
  "Open",
  "Closed",
  "Cancelled",
];

const categoryId = budgetCategoryId;

let parent = 0;
let child = 0;
/** Partners of each category the classification rules distinguish. */
let parentCabang = 0;
let parentStakeholder = 0;
let childCabang = 0;

before(async () => {
  parent = await parentCompanyId();
  child = await childCompanyId();
  parentCabang = await makePartner({ companyId: parent, categoryLabel: "Cabang" });
  parentStakeholder = await makePartner({
    companyId: parent,
    categoryLabel: "Stakeholder",
  });
  childCabang = await makePartner({ companyId: child, categoryLabel: "Cabang" });
});

// ------------------------------------------------------------- the lifecycle

describe("the budget lifecycle is a closed transition table", () => {
  test("every transition names a permission that exists in the catalogue", () => {
    for (const [action, t] of Object.entries(BUDGET_TRANSITIONS)) {
      assert.ok(
        PERMISSION_CODES.includes(t.permission),
        `${action} names ${t.permission}, which is not in the catalogue`
      );
    }
  });

  test("Draft and Rejected are the only editable statuses", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(
        budgetIsEditable(status),
        status === "Draft" || status === "Rejected",
        `${status} disagrees about being editable`
      );
    }
  });

  test("an approved budget can never be edited", () => {
    // Concept doc §6.4: "Open membuat Budget immutable".
    assert.equal(budgetIsEditable("Open"), false);
    assert.equal(budgetIsEditable("Closed"), false);
  });

  test("submit is legal only from Draft and Rejected", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(
        transitionAllowed("submit", status),
        status === "Draft" || status === "Rejected",
        `submit from ${status}`
      );
    }
  });

  test("approve and reject are legal only from Submitted", () => {
    for (const action of ["approve", "reject"] as BudgetAction[]) {
      for (const status of ALL_STATUSES) {
        assert.equal(
          transitionAllowed(action, status),
          status === "Submitted",
          `${action} from ${status}`
        );
      }
    }
  });

  test("a final status accepts no transition at all", () => {
    for (const status of ["Open", "Closed", "Cancelled"] as BudgetStatus[]) {
      for (const action of Object.keys(BUDGET_TRANSITIONS) as BudgetAction[]) {
        assert.equal(
          transitionAllowed(action, status),
          false,
          `${action} should be refused from ${status}`
        );
      }
    }
  });

  test("Close and Delete are not part of the lifecycle", () => {
    // Closing belongs to realization (V2) and the catalogue carries neither
    // BUDGET_CLOSE nor BUDGET_DELETE. Adding one means adding a catalogue entry
    // first — it must never appear here alone.
    const actions = Object.keys(BUDGET_TRANSITIONS);
    assert.deepEqual(actions.sort(), ["approve", "cancel", "reject", "submit"]);
    assert.ok(!PERMISSION_CODES.includes("BUDGET_CLOSE" as never));
    assert.ok(!PERMISSION_CODES.includes("BUDGET_DELETE" as never));
  });
});

describe("a permission is required for every transition offered", () => {
  test("a user holding nothing is offered no action from any status", () => {
    const can = budgetAbilities([]);
    for (const status of ALL_STATUSES) {
      assert.deepEqual(availableActions(status, can), []);
    }
  });

  test("holding only BUDGET_APPROVE offers approve and nothing else", () => {
    const can = budgetAbilities(["BUDGET_APPROVE"]);
    assert.deepEqual(availableActions("Submitted", can), ["approve"]);
    assert.deepEqual(availableActions("Draft", can), []);
  });

  test("holding every budget permission still cannot act on a final status", () => {
    const can = budgetAbilities(PERMISSION_CODES);
    assert.deepEqual(availableActions("Open", can), []);
    assert.deepEqual(availableActions("Cancelled", can), []);
    assert.deepEqual(availableActions("Submitted", can), [
      "approve",
      "reject",
      "cancel",
    ]);
  });

  test("a menu permission grants nothing inside the module", () => {
    const can = budgetAbilities(["MENU_BUDGET_ACCESS", "BUDGET_VIEW"]);
    assert.equal(can.create, false);
    assert.equal(can.approve, false);
    for (const status of ALL_STATUSES) {
      assert.deepEqual(availableActions(status, can), []);
    }
  });
});

// ----------------------------------------------------------- classification

describe("approval classification is enforced, not merely offered", () => {
  const outBudget = async () => ({
    company_id: parent,
    budget_type: "Out",
  });

  test("a budget cannot be approved without a Budget Category", async () => {
    const problems = await checkClassification(await outBudget(), null, null);
    assert.ok(problems.category_id, "a missing category must be refused");
  });

  test("a category is refused when the direction does not apply to it", async () => {
    // Hasil Investasi is In-only; approving an Out budget with it would put the
    // amount on the wrong side of the balance sheet.
    const budget = { company_id: parent, budget_type: "Out" };
    const problems = await checkClassification(
      budget,
      await categoryId("Hasil Investasi"),
      null
    );
    assert.ok(problems.category_id, "an In-only category must be refused for Out");
  });

  test("the same category is accepted in the direction it does apply to", async () => {
    const budget = { company_id: parent, budget_type: "In" };
    const problems = await checkClassification(
      budget,
      await categoryId("Hasil Investasi"),
      parentCabang
    );
    assert.deepEqual(problems, {});
  });

  test("a category requiring a subject is refused without one", async () => {
    const problems = await checkClassification(
      await outBudget(),
      await categoryId("Hutang"),
      null
    );
    assert.ok(problems.partner_id, "Hutang requires a Partner");
  });

  test("a category taking no subject is refused when given one", async () => {
    // Otherwise a subledger would later be opened against a partner the
    // classification never meant to name.
    const problems = await checkClassification(
      await outBudget(),
      await categoryId("Biaya"),
      parentCabang
    );
    assert.ok(problems.partner_id, "Biaya takes no Partner");
  });

  test("a partner of a category the budget category does not admit is refused", async () => {
    // Prive admits Stakeholder only.
    const problems = await checkClassification(
      await outBudget(),
      await categoryId("Prive"),
      parentCabang
    );
    assert.ok(problems.partner_id, "Prive must not accept a Cabang partner");
  });

  test("a partner belonging to another Company is refused", async () => {
    const budget = { company_id: parent, budget_type: "Out" };
    const problems = await checkClassification(
      budget,
      await categoryId("Hutang"),
      childCabang
    );
    assert.ok(problems.partner_id, "a partner of another Company must be refused");
  });

  test("a valid combination is accepted", async () => {
    const problems = await checkClassification(
      await outBudget(),
      await categoryId("Hutang"),
      parentCabang
    );
    assert.deepEqual(problems, {});
  });

  test("Prive accepts the one Partner Category it admits", async () => {
    const problems = await checkClassification(
      await outBudget(),
      await categoryId("Prive"),
      parentStakeholder
    );
    assert.deepEqual(problems, {});
  });

  test("an unknown category id is refused rather than trusted", async () => {
    const problems = await checkClassification(await outBudget(), 999_999, null);
    assert.ok(problems.category_id);
  });

  test("an unknown partner id is refused rather than trusted", async () => {
    const problems = await checkClassification(
      await outBudget(),
      await categoryId("Hutang"),
      999_999
    );
    assert.ok(problems.partner_id);
  });
});

// -------------------------------------------------------- derived month

describe("Budget Month is derived from Fiscal Period, never stored", () => {
  test("no bud_budget_month table exists", async () => {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'bud_budget_month'
    `;
    assert.equal(Number(rows[0].count), 0, "Budget Month must not be a table");
  });

  test("bud_budget carries no month column of its own", async () => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'bud_budget'
    `;
    const names = rows.map((r) => r.column_name);
    for (const forbidden of ["month_id", "budget_month_id", "fiscal_period_id"]) {
      assert.ok(
        !names.includes(forbidden),
        `bud_budget must not carry ${forbidden} — the month comes from budget_date`
      );
    }
  });

  test("every month's rollup matches the budgets in its own date range", async () => {
    // Fiscal periods are business data now, so an installation may legitimately
    // have none. The rule under test is the rollup, which holds for however
    // many periods exist.
    const months = await budgetMonths();

    for (const month of months) {
      const inRange = await listBudgets({
        startDate: month.startDate,
        endDate: month.endDate,
      });
      assert.equal(
        month.count,
        inRange.length,
        `${month.label} rolled up ${month.count} but the range holds ${inRange.length}`
      );
    }
  });

  test("the months together account for no more budgets than exist", async () => {
    const months = await budgetMonths();
    const grouped = months.reduce((t, m) => t + m.count, 0);
    const total = (await listBudgets(null)).length;
    assert.ok(
      grouped <= total,
      `months claim ${grouped} budgets out of ${total} — periods must not overlap`
    );
  });
});

// ------------------------------------------------------------- numbering

describe("budget numbering", () => {
  test("the next number is the document form BGT-0000, not a system code", async () => {
    const next = await nextBudgetNo();
    assert.match(next, /^BGT-\d{4}$/, `${next} is not a document number`);
  });

  test("the next number is not already taken", async () => {
    const next = await nextBudgetNo();
    const clash = await prisma.budBudget.findUnique({
      where: { budget_no: next },
      select: { id: true },
    });
    assert.equal(clash, null, `${next} is already in use`);
  });
});
