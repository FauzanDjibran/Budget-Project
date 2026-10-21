import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { dashboardData, type StageKey } from "../src/lib/siba/dashboard";
import {
  approvedCommitments,
  realizationOutcomes,
  submittedCommitments,
} from "../src/lib/siba/budget";
import { budgetDocTypeId } from "../src/lib/siba/finance";
import {
  FIXTURE_PREFIX,
  budgetCategoryId,
  childCompanyId,
  cleanupFixtures,
  disconnect,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The dashboard's one load-bearing property: **the funnel is a partition**.
 *
 * Every rupiah of committed money sits in exactly one stage, and the stages
 * together are the whole of it. That is not free. `realized_amount` is written
 * only at Post, so an approved Budget still reports its full outstanding while
 * a `Pending` document is already holding part of it and waiting on the induk.
 * Stating both unadjusted prints the same money twice, which is exactly the
 * defect this suite exists to prevent.
 *
 * Everything else here is the second rule: a Draft — of a Budget or of a
 * document — is a preparation record that may never happen, and must not
 * inflate a single figure on the page.
 *
 * The suite builds its own fixtures in **its own currency**, so its totals are
 * isolated from whatever else the database happens to hold, and removes them
 * afterwards. The seed carries system data only; nothing here assumes a row.
 */

const today = new Date().toISOString().slice(0, 10);

let induk = 0;
let anak = 0;
let actor = 0;
let currency = 0;

const budgets: number[] = [];
const transactions: number[] = [];
const requests: number[] = [];

/** Every amount below is in the fixture currency, so nothing else lands in it. */
const AMOUNT = {
  submitted: 500_000,
  openPlain: 1_000_000,
  openClaimed: 400_000,
  claim: 250_000,
  draft: 700_000,
  rejected: 300_000,
  awaiting: 600_000,
  closedMatch: 800_000,
  closedOver: 300_000,
  overBy: 150_000,
  /** Already realized against the plain Open plan. */
  realized: 200_000,
};

async function makeBudget(options: {
  companyId: number;
  status: "Draft" | "Submitted" | "Rejected" | "Approved" | "Open" | "Closed";
  amount: number;
  realized?: number;
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
      realized_amount: options.realized ?? 0,
      status: options.status,
      created_by: actor,
    },
    select: { id: true },
  });
  budgets.push(row.id);
  return row.id;
}

/**
 * A document frozen at `Pending` with its Funding Request, written straight
 * through Prisma.
 *
 * The real path is the anak submitting and `raiseFundingRequest` opening the
 * request; both resolve a caller from a session cookie that a test process
 * does not have. What matters here is the resulting *state*, which is what the
 * dashboard reads.
 */
async function makePendingDocument(budgetId: number, amount: number) {
  const docType = await budgetDocTypeId();
  const key = `${FIXTURE_PREFIX}DSH${transactions.length + 1}${Date.now() % 100000}`;
  const doc = await prisma.finCashBankTransaction.create({
    data: {
      transaction_no: `TST-CBT${key}`,
      transaction_type: "Out",
      company_id: anak,
      cash_bank_id: null,
      currency_id: currency,
      transaction_amount: amount,
      transaction_base_amount: amount,
      status: "Pending",
      created_by: actor,
      lines: {
        create: [
          {
            sequence_no: 1,
            source_doc_type_id: docType,
            source_doc_id: budgetId,
            outstanding_amount: amount,
            settlement_amount: amount,
            settlement_base_amount: amount,
            transaction_amount: amount,
            transaction_base_amount: amount,
            created_by: actor,
          },
        ],
      },
    },
    select: { id: true },
  });
  transactions.push(doc.id);

  const request = await prisma.finFundingRequest.create({
    data: {
      funding_request_no: `TST-FR${key}`,
      request_date: new Date(`${today}T00:00:00Z`),
      transaction_id: doc.id,
      currency_id: currency,
      request_amount: amount,
      status: "Open",
      created_by: actor,
    },
    select: { id: true },
  });
  requests.push(request.id);
  return { documentId: doc.id, requestId: request.id };
}

/** Amounts in the fixture currency only, so other data cannot disturb a sum. */
const mine = (totals: { currencyId: number; amount: number }[]) =>
  totals.filter((t) => t.currencyId === currency).reduce((n, t) => n + t.amount, 0);

const stageOf = (
  stages: { key: StageKey; totals: { currencyId: number; amount: number }[] }[],
  key: StageKey
) => stages.find((s) => s.key === key)!;

const OUTSTANDING = AMOUNT.openPlain - AMOUNT.realized + AMOUNT.openClaimed;

let openClaimedId = 0;
let submittedId = 0;
let draftId = 0;
let rejectedId = 0;
let awaitingId = 0;

before(async () => {
  induk = await parentCompanyId();
  anak = await childCompanyId();
  actor = await systemUserId();

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

  submittedId = await makeBudget({
    companyId: induk,
    status: "Submitted",
    amount: AMOUNT.submitted,
  });
  await makeBudget({
    companyId: induk,
    status: "Open",
    amount: AMOUNT.openPlain,
    realized: AMOUNT.realized,
  });
  draftId = await makeBudget({
    companyId: induk,
    status: "Draft",
    amount: AMOUNT.draft,
  });
  rejectedId = await makeBudget({
    companyId: induk,
    status: "Rejected",
    amount: AMOUNT.rejected,
  });
  awaitingId = await makeBudget({
    companyId: induk,
    status: "Approved",
    amount: AMOUNT.awaiting,
  });
  await makeBudget({
    companyId: induk,
    status: "Closed",
    amount: AMOUNT.closedMatch,
    realized: AMOUNT.closedMatch,
  });
  await makeBudget({
    companyId: induk,
    status: "Closed",
    amount: AMOUNT.closedOver,
    realized: AMOUNT.closedOver + AMOUNT.overBy,
  });
  // The anak's, because a Pending document is one the anak raised.
  openClaimedId = await makeBudget({
    companyId: anak,
    status: "Open",
    amount: AMOUNT.openClaimed,
  });
  await makePendingDocument(openClaimedId, AMOUNT.claim);
});

after(async () => {
  if (requests.length) {
    await prisma.finFundingRequest.deleteMany({ where: { id: { in: requests } } });
  }
  if (transactions.length) {
    await prisma.finCashBankTransactionLine.deleteMany({
      where: { transaction_id: { in: transactions } },
    });
    await prisma.finCashBankTransaction.deleteMany({
      where: { id: { in: transactions } },
    });
  }
  if (budgets.length) {
    await prisma.budBudget.deleteMany({ where: { id: { in: budgets } } });
  }
  if (currency) {
    await prisma.refCurrency.deleteMany({ where: { id: currency } });
  }
  await cleanupFixtures();
  await disconnect();
});

describe("the three Budget stages are a partition", () => {
  test("each stage holds its own money, and together they are everything committed", async () => {
    const both = [induk, anak];
    const data = await dashboardData(both);
    const approval = mine(stageOf(data.stages, "approval").totals);
    const classification = mine(stageOf(data.stages, "classification").totals);
    const execution = mine(stageOf(data.stages, "execution").totals);

    assert.equal(approval, AMOUNT.submitted);
    assert.equal(classification, AMOUNT.awaiting, "the whole plan, nothing realizable yet");
    assert.equal(
      execution,
      OUTSTANDING,
      "an Open plan states what is left to realize"
    );
    assert.equal(
      execution,
      mine((await approvedCommitments(both)).totals),
      "the realization stage is exactly Budget's own outstanding — no subtraction, no gap"
    );
    assert.equal(
      approval,
      mine((await submittedCommitments(both)).totals)
    );
  });

  test("a pending Funding Request does not move a Budget out of the realization stage", async () => {
    const data = await dashboardData([induk, anak]);
    const claimed = data.stages
      .find((s) => s.key === "execution")!
      .rows.find((r) => r.id === openClaimedId);
    assert.equal(
      claimed?.amount,
      AMOUNT.openClaimed,
      "the stage reads the Budget table alone: what is not realized yet"
    );
  });
});

describe("a draft never reaches the dashboard", () => {
  test("Draft and Rejected budgets are in no stage", async () => {
    const data = await dashboardData([induk, anak]);
    const ids = data.stages.flatMap((s) => s.rows.map((r) => r.id));
    assert.equal(ids.includes(draftId), false, "a Draft budget");
    assert.equal(ids.includes(rejectedId), false, "a Rejected budget");
    assert.equal(
      new Set(ids).size,
      ids.length,
      "a Budget in two stages would be the same money twice"
    );
    assert.ok(ids.includes(submittedId));
    assert.ok(ids.includes(awaitingId));
    for (const stage of data.stages) {
      const ages = stage.rows.map((r) => r.since);
      assert.deepEqual([...ages].sort(), ages, `${stage.key} is longest-waiting first`);
    }
  });
});

describe("a stage never reaches outside the reader's Companies", () => {
  test("the anak's commitments are absent from an induk-only dashboard", async () => {
    const data = await dashboardData([induk]);
    const ids = data.stages.flatMap((s) => s.rows.map((r) => r.id));
    assert.equal(ids.includes(openClaimedId), false);
    assert.equal(
      mine(stageOf(data.stages, "execution").totals),
      AMOUNT.openPlain - AMOUNT.realized
    );
  });

  test("no Company at all summarises nothing rather than everything", async () => {
    const data = await dashboardData([]);
    assert.equal(data.cash.rows.length, 0);
    assert.deepEqual(data.books, []);
    assert.deepEqual(data.profitLoss, []);
    for (const stage of data.stages) assert.equal(stage.count, 0);
  });
});

describe("plan against realization", () => {
  test("each realizable Budget lands in one outcome: kurang, sesuai or lebih", async () => {
    const [row] = (await realizationOutcomes([induk, anak], today, today)).filter(
      (r) => r.currencyId === currency
    );
    assert.ok(row, "the fixture currency has its own row");
    assert.deepEqual(
      row.under,
      { count: 2, amount: AMOUNT.openPlain - AMOUNT.realized + AMOUNT.openClaimed },
      "Open Budgets are short by what is left to realize"
    );
    assert.deepEqual(row.match, { count: 1, amount: AMOUNT.closedMatch });
    assert.deepEqual(row.over, { count: 1, amount: AMOUNT.overBy }, "Lebih states the excess");
    assert.equal(
      row.budgets.length,
      4,
      "Approved, Submitted, Draft and Rejected Budgets cannot be realized and are not counted"
    );
  });

  test("a Laba Rugi tile is offered for every Company the reader may see", async () => {
    const data = await dashboardData([induk, anak]);
    assert.deepEqual(
      data.profitLoss.map((p) => p.companyId).sort(),
      [induk, anak].sort()
    );
  });
});
