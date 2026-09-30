import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import {
  BUDGET_TRANSITIONS,
  availableActions,
  budgetAbilities,
  budgetIsEditable,
  commonActions,
  transitionAllowed,
  type BudgetAction,
  type BudgetStatus,
} from "../src/lib/siba/budget-workflow";
import {
  applyBudgetTransition,
  applyClassification,
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
  FIXTURE_PREFIX,
  makePartner,
  parentCompanyId,
  prisma,
  systemUserId,
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

/** Budgets the bulk cases create; removed with their audit rows afterwards. */
const made: number[] = [];

after(async () => {
  if (made.length) {
    await prisma.auditLog.deleteMany({
      where: { entity_key: "bud_budget", row_id: { in: made } },
    });
    await prisma.budBudget.deleteMany({ where: { id: { in: made } } });
  }
  await cleanupFixtures();
  await disconnect();
});

const ALL_STATUSES: BudgetStatus[] = [
  "Draft",
  "Submitted",
  "Rejected",
  "Approved",
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

  test("Draft is the only editable status", () => {
    // A rejection is final: the plan is corrected as a new Budget.
    for (const status of ALL_STATUSES) {
      assert.equal(
        budgetIsEditable(status),
        status === "Draft",
        `${status} disagrees about being editable`
      );
    }
  });

  test("an approved budget can never be edited", () => {
    // Concept doc §6.4: "Open membuat Budget immutable".
    assert.equal(budgetIsEditable("Approved"), false);
    assert.equal(budgetIsEditable("Open"), false);
    assert.equal(budgetIsEditable("Closed"), false);
  });

  test("submit is legal only from Draft — a rejected plan is never resubmitted", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(
        transitionAllowed("submit", status),
        status === "Draft",
        `submit from ${status}`
      );
    }
  });

  test("approval leads to the classification stage, and only classifying opens a budget", () => {
    assert.equal(BUDGET_TRANSITIONS.approve.to, "Approved");
    assert.equal(BUDGET_TRANSITIONS.classify.to, "Open");
    for (const status of ALL_STATUSES) {
      assert.equal(
        transitionAllowed("classify", status),
        status === "Approved",
        `classify from ${status}`
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
    for (const status of ["Rejected", "Open", "Closed", "Cancelled"] as BudgetStatus[]) {
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
    assert.deepEqual(actions.sort(), ["approve", "cancel", "classify", "reject", "submit"]);
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
    assert.deepEqual(availableActions("Approved", can), ["classify"]);
  });

  test("approving does not carry the right to classify, nor the reverse", () => {
    assert.deepEqual(availableActions("Approved", budgetAbilities(["BUDGET_APPROVE"])), []);
    assert.deepEqual(
      availableActions("Submitted", budgetAbilities(["BUDGET_CLASSIFY"])),
      []
    );
  });

  test("a selection is offered only what every one of its statuses allows", () => {
    const can = budgetAbilities(PERMISSION_CODES);
    assert.deepEqual(commonActions(["Draft", "Draft"], can), ["submit", "cancel"]);
    assert.deepEqual(commonActions(["Submitted", "Submitted"], can), [
      "approve",
      "reject",
      "cancel",
    ]);
    assert.deepEqual(commonActions(["Draft", "Submitted"], can), ["cancel"]);
    assert.deepEqual(commonActions(["Draft", "Approved"], can), []);
    assert.deepEqual(commonActions([], can), []);
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
    //
    // The Company is passed in rather than read from a cookie: these readers
    // take their scope as an argument precisely so a test can call them.
    const companies = [await parentCompanyId()];
    const months = await budgetMonths(companies);

    for (const month of months) {
      const inRange = await listBudgets(
        { startDate: month.startDate, endDate: month.endDate },
        companies
      );
      assert.equal(
        month.count,
        inRange.length,
        `${month.label} rolled up ${month.count} but the range holds ${inRange.length}`
      );
    }
  });

  test("the months together account for no more budgets than exist", async () => {
    const companies = [await parentCompanyId()];
    const months = await budgetMonths(companies);
    const grouped = months.reduce((t, m) => t + m.count, 0);
    const total = (await listBudgets(null, companies)).length;
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

// ------------------------------------------------------------ bulk writes

/** A Budget written straight through Prisma, at whatever status a case needs. */
async function makeBudget(options: {
  status: BudgetStatus;
  companyId?: number;
  type?: "In" | "Out";
}): Promise<{ id: number; no: string }> {
  const actor = await systemUserId();
  const currency = await prisma.refCurrency.findFirstOrThrow({
    where: { currency_label: "IDR" },
    select: { id: true },
  });
  const no = `TST-${FIXTURE_PREFIX}BK${made.length + 1}${Date.now() % 100000}`;
  const row = await prisma.budBudget.create({
    data: {
      budget_no: no,
      budget_date: new Date(),
      company_id: options.companyId ?? parent,
      currency_id: currency.id,
      budget_type: options.type ?? "Out",
      description: `Fixture ${no}`,
      budget_amount: 100_000,
      status: options.status,
      created_by: actor,
    },
    select: { id: true },
  });
  made.push(row.id);
  return { id: row.id, no };
}

const statusOf = async (id: number) =>
  (await prisma.budBudget.findUniqueOrThrow({ where: { id } })).status;

describe("a bulk transition moves every selected budget, or none", () => {
  test("a selection of Drafts is submitted together, each with its own history", async () => {
    const actor = await systemUserId();
    const a = await makeBudget({ status: "Draft" });
    const b = await makeBudget({ status: "Draft" });

    const result = await applyBudgetTransition([a.id, b.id], "submit", actor);
    assert.deepEqual(result, { ok: true, count: 2 });
    assert.equal(await statusOf(a.id), "Submitted");
    assert.equal(await statusOf(b.id), "Submitted");

    const events = await prisma.auditLog.count({
      where: { entity_key: "bud_budget", row_id: { in: [a.id, b.id] }, event: "submit" },
    });
    assert.equal(events, 2, "one audit row per budget, naming the step");
  });

  test("one budget the transition does not fit refuses the whole batch, by name", async () => {
    const actor = await systemUserId();
    const a = await makeBudget({ status: "Draft" });
    const b = await makeBudget({ status: "Submitted" });

    const result = await applyBudgetTransition([a.id, b.id], "submit", actor);
    assert.equal(result.ok, false);
    assert.ok(
      result.ok === false && result.errors._form.includes(b.no),
      "the refusal names the budget that stopped it"
    );
    assert.equal(await statusOf(a.id), "Draft", "and nothing else moved");
  });

  test("approving leaves a budget Approved and unclassified", async () => {
    const actor = await systemUserId();
    const a = await makeBudget({ status: "Submitted" });
    const result = await applyBudgetTransition([a.id], "approve", actor);
    assert.equal(result.ok, true);
    const row = await prisma.budBudget.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(row.status, "Approved");
    assert.equal(row.category_id, null);
  });

  test("a rejected budget cannot be resubmitted", async () => {
    const actor = await systemUserId();
    const a = await makeBudget({ status: "Rejected" });
    const result = await applyBudgetTransition([a.id], "submit", actor);
    assert.equal(result.ok, false);
    assert.equal(await statusOf(a.id), "Rejected");
  });

  test("classify is not a plain transition — it has its own path", async () => {
    const actor = await systemUserId();
    const a = await makeBudget({ status: "Approved" });
    const result = await applyBudgetTransition(
      [a.id],
      "classify" as never,
      actor
    );
    assert.equal(result.ok, false);
    assert.equal(await statusOf(a.id), "Approved");
  });

  test("an empty selection is refused rather than reported as done", async () => {
    const result = await applyBudgetTransition([], "submit", await systemUserId());
    assert.equal(result.ok, false);
  });
});

describe("a bulk classification fits every budget, or none", () => {
  test("one classification opens every selected budget", async () => {
    const actor = await systemUserId();
    const a = await makeBudget({ status: "Approved" });
    const b = await makeBudget({ status: "Approved" });
    const hutang = await categoryId("Hutang");

    const result = await applyClassification([a.id, b.id], hutang, parentCabang, actor);
    assert.deepEqual(result, { ok: true, count: 2 });
    for (const id of [a.id, b.id]) {
      const row = await prisma.budBudget.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, "Open");
      assert.equal(row.category_id, hutang);
      assert.equal(row.partner_id, parentCabang);
    }
    const events = await prisma.auditLog.count({
      where: { entity_key: "bud_budget", row_id: { in: [a.id, b.id] }, event: "classify" },
    });
    assert.equal(events, 2);
  });

  test("a budget of another direction refuses the batch, by name", async () => {
    // Biaya is Out-only, so it fits the Out budget and not the In one.
    const actor = await systemUserId();
    const out = await makeBudget({ status: "Approved", type: "Out" });
    const inn = await makeBudget({ status: "Approved", type: "In" });

    const result = await applyClassification(
      [out.id, inn.id],
      await categoryId("Biaya"),
      null,
      actor
    );
    assert.equal(result.ok, false);
    const message = result.ok ? "" : Object.values(result.errors)[0];
    assert.ok(message.includes(inn.no), `"${message}" should name ${inn.no}`);
    assert.equal(await statusOf(out.id), "Approved", "and nothing was classified");
  });

  test("a budget of another Company refuses a Partner that is not its own", async () => {
    const actor = await systemUserId();
    const mine = await makeBudget({ status: "Approved", companyId: parent });
    const theirs = await makeBudget({ status: "Approved", companyId: child });

    const result = await applyClassification(
      [mine.id, theirs.id],
      await categoryId("Hutang"),
      parentCabang,
      actor
    );
    assert.equal(result.ok, false);
    const message = result.ok ? "" : Object.values(result.errors)[0];
    assert.ok(message.includes(theirs.no), `"${message}" should name ${theirs.no}`);
    assert.equal(await statusOf(mine.id), "Approved");
    assert.equal(await statusOf(theirs.id), "Approved");
  });

  test("only an Approved budget can be classified — never reclassified", async () => {
    const actor = await systemUserId();
    const submitted = await makeBudget({ status: "Submitted" });
    const open = await makeBudget({ status: "Open" });
    for (const b of [submitted, open]) {
      const result = await applyClassification(
        [b.id],
        await categoryId("Biaya"),
        null,
        actor
      );
      assert.equal(result.ok, false, `${b.no} must be refused`);
    }
    assert.equal(await statusOf(submitted.id), "Submitted");
    assert.equal(await statusOf(open.id), "Open");
  });
});
