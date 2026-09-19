import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { dashboardData, type StageKey } from "../src/lib/siba/dashboard";
import { approvedCommitments, submittedCommitments } from "../src/lib/siba/budget";
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
};

async function makeBudget(options: {
  companyId: number;
  status: "Draft" | "Submitted" | "Rejected" | "Open";
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
      category_id: await budgetCategoryId("Biaya"),
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
      purpose: "BYA_OUT",
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

let openPlainId = 0;
let openClaimedId = 0;
let submittedId = 0;
let draftId = 0;
let rejectedId = 0;
let requestId = 0;
let pendingDocumentId = 0;

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
  openPlainId = await makeBudget({
    companyId: induk,
    status: "Open",
    amount: AMOUNT.openPlain,
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
  // The anak's, because a Pending document is one the anak raised.
  openClaimedId = await makeBudget({
    companyId: anak,
    status: "Open",
    amount: AMOUNT.openClaimed,
  });
  ({ requestId, documentId: pendingDocumentId } = await makePendingDocument(
    openClaimedId,
    AMOUNT.claim
  ));
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

describe("the funnel is a partition", () => {
  test("approved money is split between execution and funding, never counted twice", async () => {
    const both = [induk, anak];
    const data = await dashboardData(both);

    const execution = mine(stageOf(data.funnel.stages, "execution").totals);
    const funding = mine(stageOf(data.funnel.stages, "funding").totals);

    // What is approved and not yet cash, read straight from Budget.
    const approved = mine((await approvedCommitments(both)).totals);

    assert.equal(
      approved,
      AMOUNT.openPlain + AMOUNT.openClaimed,
      "the raw approved figure still holds the whole of both plans"
    );
    assert.equal(
      execution,
      AMOUNT.openPlain + (AMOUNT.openClaimed - AMOUNT.claim),
      "what a pending document holds is taken out of the execution stage"
    );
    assert.equal(funding, AMOUNT.claim, "and is stated once, in the funding stage");
    assert.equal(
      execution + funding,
      approved,
      "the two stages together are exactly the approved pool — no gap, no overlap"
    );
  });

  test("the approval stage is separate money, not part of the approved pool", async () => {
    const data = await dashboardData([induk, anak]);
    assert.equal(
      mine(stageOf(data.funnel.stages, "approval").totals),
      AMOUNT.submitted
    );
    assert.equal(
      mine((await submittedCommitments([induk, anak])).totals),
      AMOUNT.submitted
    );
  });

  test("only approved money reduces the cash projection", async () => {
    const data = await dashboardData([induk, anak]);
    assert.equal(
      mine(data.funnel.committedOut),
      AMOUNT.openPlain + (AMOUNT.openClaimed - AMOUNT.claim) + AMOUNT.claim,
      "committed cash is the approved pool: stages two and three, once each"
    );
    assert.equal(
      mine(data.funnel.committedIn),
      0,
      "every fixture here is an Out budget"
    );
  });
});

describe("a draft never reaches the dashboard", () => {
  test("Draft and Rejected budgets are in no stage and no queue", async () => {
    const data = await dashboardData([induk, anak]);
    const keys = data.funnel.tasks.map((t) => t.key);

    assert.equal(keys.includes(`budget-${draftId}`), false, "a Draft budget");
    assert.equal(keys.includes(`budget-${rejectedId}`), false, "a Rejected budget");

    const counted =
      mine(stageOf(data.funnel.stages, "approval").totals) +
      mine(stageOf(data.funnel.stages, "execution").totals) +
      mine(stageOf(data.funnel.stages, "funding").totals);
    assert.equal(
      counted,
      AMOUNT.submitted + AMOUNT.openPlain + AMOUNT.openClaimed,
      "and neither amount is anywhere in the totals"
    );
  });
});

describe("the queue names records, and names them once", () => {
  test("each stage's records appear exactly once, oldest first", async () => {
    const data = await dashboardData([induk, anak]);
    const keys = data.funnel.tasks.map((t) => t.key);

    assert.equal(
      new Set(keys).size,
      keys.length,
      "a record in two stages would be the same defect in another form"
    );
    assert.ok(keys.includes(`budget-${submittedId}`));
    assert.ok(keys.includes(`budget-${openPlainId}`));
    assert.ok(keys.includes(`budget-${openClaimedId}`));

    const ages = data.funnel.tasks.map((t) => t.since);
    assert.deepEqual([...ages].sort(), ages, "longest-waiting first");
  });

  test("a funding task opens the request, which is what the induk answers", async () => {
    const data = await dashboardData([induk, anak]);
    // By this fixture’s own document, never "the first funding task": a
    // database that already holds a pending document — the showcase seed
    // leaves one — would otherwise hand back somebody else’s.
    const task = data.funnel.tasks.find((t) => t.key === `funding-${pendingDocumentId}`);
    assert.ok(task, "the pending document must be in the queue");
    assert.equal(task.stage, "funding");
    assert.equal(task.href, `/finance/funding-request/${requestId}`);
  });
});

describe("a queue never reaches outside the reader's Companies", () => {
  test("the anak's commitments are absent from an induk-only dashboard", async () => {
    const data = await dashboardData([induk]);
    const keys = data.funnel.tasks.map((t) => t.key);

    assert.equal(keys.includes(`budget-${openClaimedId}`), false);
    assert.equal(
      mine(stageOf(data.funnel.stages, "funding").totals),
      0,
      "and so is the request raised against them"
    );
    assert.equal(
      mine(stageOf(data.funnel.stages, "execution").totals),
      AMOUNT.openPlain,
      "leaving only the induk's own"
    );
  });

  test("no Company at all summarises nothing rather than everything", async () => {
    const data = await dashboardData([]);
    assert.deepEqual(data.funnel.tasks, []);
    assert.equal(data.cash.rows.length, 0);
    for (const stage of data.funnel.stages) assert.equal(stage.count, 0);
  });

  test("a pending claim is only subtracted inside the same scope", async () => {
    // The anak alone: its one approved plan, minus what its own pending
    // document holds, plus that document stated once in the funding stage.
    const data = await dashboardData([anak]);
    assert.equal(
      mine(stageOf(data.funnel.stages, "execution").totals),
      AMOUNT.openClaimed - AMOUNT.claim
    );
    assert.equal(mine(stageOf(data.funnel.stages, "funding").totals), AMOUNT.claim);
  });
});
