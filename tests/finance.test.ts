import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  applyPosting,
  budgetDocTypeId,
  checkHeader,
  checkLines,
  eligibleBudgets,
  transactingCompany,
} from "../src/lib/siba/finance";
import {
  TRANSACTION_TRANSITIONS,
  availableTransactionActions,
  transactionAbilities,
  transactionIsEditable,
  transactionTransitionAllowed,
  type TransactionAction,
  type TransactionStatus,
} from "../src/lib/siba/transaction-workflow";
import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import { BUDGET_CATEGORY_RULES, PURPOSES, purposeOf } from "../src/lib/siba/rules";
import { openCashBankBook, rebuildCashBankBalance } from "../src/lib/siba/cash-bank";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import {
  FIXTURE_PREFIX,
  budgetCategoryId,
  childCompanyId,
  cleanupFixtures,
  disconnect,
  makeAccount,
  makeMapping,
  makePartner,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The Finance module — the execution layer.
 *
 * Two things must hold no matter how a request arrives. A document may only
 * realize a Budget its own header admits (concept doc §9), and Post must move
 * the Cash Bank Book, the balance, and `realized_amount` together or not at
 * all (§2.3, §13.1). Everything below is one of those two, plus the scope
 * decision that keeps the anak's realization out of this document until the
 * Funding Request flow exists.
 *
 * The suite builds its own business fixtures and removes them: the seed
 * carries system data only, so nothing here may assume a particular row.
 */

const today = new Date().toISOString().slice(0, 10);

let induk = 0;
let anak = 0;
let actor = 0;
let currency = 0;
let otherCurrency = 0;

const cashBanks: number[] = [];
const budgets: number[] = [];
const transactions: number[] = [];

async function makeCashBank(options: {
  companyId?: number;
  currencyId?: number;
  opening?: number;
  status?: "Active" | "Inactive";
}): Promise<number> {
  const companyId = options.companyId ?? induk;
  const account = await makeAccount({ companyId, subcategoryLabel: CASH_BANK_SUBCATEGORY });
  const key = `${FIXTURE_PREFIX}CBT${cashBanks.length + 1}${Date.now() % 100000}`;
  const row = await prisma.mCashBank.create({
    data: {
      cash_bank_code: `test.${key}`,
      cash_bank_label: key,
      cash_bank_name: `Fixture ${key}`,
      company_id: companyId,
      cash_bank_type: "Cash",
      currency_id: options.currencyId ?? currency,
      account_id: account,
      status: options.status ?? "Active",
      created_by: actor,
    },
    select: { id: true },
  });
  await openCashBankBook(prisma, {
    cashBankId: row.id,
    openingBalance: options.opening ?? 0,
    date: today,
    actorId: actor,
  });
  cashBanks.push(row.id);
  return row.id;
}

/** An approved budget — the only kind Finance may realize. */
async function makeBudget(options: {
  companyId?: number;
  currencyId?: number;
  type?: "In" | "Out";
  categoryLabel: string;
  partnerId?: number | null;
  amount: number;
  realized?: number;
  status?: "Open" | "Draft" | "Submitted" | "Closed";
}): Promise<number> {
  const key = `${FIXTURE_PREFIX}B${budgets.length + 1}${Date.now() % 100000}`;
  const row = await prisma.budBudget.create({
    data: {
      budget_no: `TST-${key}`,
      budget_date: new Date(`${today}T00:00:00Z`),
      company_id: options.companyId ?? induk,
      currency_id: options.currencyId ?? currency,
      budget_type: options.type ?? "Out",
      category_id: await budgetCategoryId(options.categoryLabel),
      partner_id: options.partnerId ?? null,
      description: `Fixture ${key}`,
      budget_amount: options.amount,
      realized_amount: options.realized ?? 0,
      status: options.status ?? "Open",
      created_by: actor,
    },
    select: { id: true },
  });
  budgets.push(row.id);
  return row.id;
}

/**
 * Writes a Draft document straight through Prisma.
 *
 * The Server Action is what the UI calls, but it resolves the caller from a
 * session cookie that does not exist in a test process. The rules the action
 * delegates to — `checkHeader`, `checkLines` — are exercised directly, and the
 * posting arithmetic is reproduced here against the same helpers the action
 * uses, so what is asserted is the behaviour and not a mock.
 */
async function makeDraft(options: {
  purpose: string;
  cashBankId: number;
  partnerId?: number | null;
  lines: { budgetId: number; amount: number; outstanding: number }[];
}): Promise<number> {
  const purpose = purposeOf(options.purpose)!;
  const cashBank = await prisma.mCashBank.findUniqueOrThrow({
    where: { id: options.cashBankId },
    select: { currency_id: true, company_id: true },
  });
  const docType = await budgetDocTypeId();
  const total = options.lines.reduce((t, l) => t + l.amount, 0);

  const row = await prisma.finCashBankTransaction.create({
    data: {
      transaction_no: `TST-CBT${transactions.length + 1}${Date.now() % 100000}`,
      transaction_type: purpose.direction,
      company_id: cashBank.company_id,
      purpose: purpose.key,
      cash_bank_id: options.cashBankId,
      currency_id: cashBank.currency_id,
      partner_id: options.partnerId ?? null,
      transaction_amount: total,
      transaction_base_amount: total,
      status: "Draft",
      created_by: actor,
      lines: {
        create: options.lines.map((l, i) => ({
          sequence_no: i + 1,
          source_doc_type_id: docType,
          source_doc_id: l.budgetId,
          outstanding_amount: l.outstanding,
          settlement_amount: l.amount,
          settlement_base_amount: l.amount,
          transaction_amount: l.amount,
          transaction_base_amount: l.amount,
          created_by: actor,
        })),
      },
    },
    select: { id: true },
  });
  transactions.push(row.id);
  return row.id;
}

before(async () => {
  induk = await parentCompanyId();
  anak = await childCompanyId();
  actor = await systemUserId();

  const currencies = await prisma.refCurrency.findMany({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  currency = currencies[0].id;
  // A second currency is only needed to prove amounts are never mixed. The
  // seed guarantees one currency, not two, so this creates its own.
  if (currencies.length > 1) {
    otherCurrency = currencies[1].id;
  } else {
    const made = await prisma.refCurrency.create({
      data: {
        currency_code: `test.${FIXTURE_PREFIX}CUR`,
        currency_label: `${FIXTURE_PREFIX}X`,
        currency_name: "Fixture currency",
        created_by: actor,
      },
      select: { id: true },
    });
    otherCurrency = made.id;
  }

  // Posting journals the document, and a journal needs an account to post
  // against — so every Budget Category the tests exercise needs a mapping.
  // Approval tolerates a missing one (§10 rule 28); posting does not, and the
  // case below proves the refusal.
  for (const companyId of [induk, anak]) {
    const account = await makeAccount({
      companyId,
      subcategoryLabel: "5.3.1",
    });
    for (const [label, rule] of Object.entries(BUDGET_CATEGORY_RULES)) {
      const partnerCategories = rule.partnerCategories.length
        ? rule.partnerCategories
        : [null];
      for (const partnerCategory of partnerCategories) {
        await makeMapping({
          companyId,
          budgetCategoryLabel: label,
          partnerCategoryLabel: partnerCategory,
          accountId: account,
        });
      }
    }
  }
});

after(async () => {
  if (transactions.length) {
    await prisma.finCashBankTransactionLine.deleteMany({
      where: { transaction_id: { in: transactions } },
    });
    await prisma.finCashBankTransaction.deleteMany({
      where: { id: { in: transactions } },
    });
  }
  if (budgets.length) {
    await prisma.auditLog.deleteMany({
      where: { entity_key: "bud_budget", row_id: { in: budgets } },
    });
    await prisma.budBudget.deleteMany({ where: { id: { in: budgets } } });
  }
  if (cashBanks.length) {
    await prisma.cashBankLedger.deleteMany({
      where: { cash_bank_id: { in: cashBanks } },
    });
    await prisma.cashBankBalance.deleteMany({
      where: { cash_bank_id: { in: cashBanks } },
    });
    await prisma.mCashBank.deleteMany({ where: { id: { in: cashBanks } } });
  }
  await prisma.refCurrency.deleteMany({
    where: { currency_label: { startsWith: FIXTURE_PREFIX } },
  });
  await cleanupFixtures();
  await disconnect();
});

// --------------------------------------------------------------- lifecycle

describe("the transaction lifecycle is a closed transition table", () => {
  test("every transition names a permission that exists in the catalogue", () => {
    for (const [action, t] of Object.entries(TRANSACTION_TRANSITIONS)) {
      assert.ok(
        PERMISSION_CODES.includes(t.permission),
        `${action} names ${t.permission}, which is not in the catalogue`
      );
    }
  });

  test("the table holds exactly post and cancel", () => {
    assert.deepEqual(Object.keys(TRANSACTION_TRANSITIONS).sort(), [
      "cancel",
      "post",
    ]);
  });

  test("there is no delete, and no permission for one", () => {
    const codes: string[] = PERMISSION_CODES;
    assert.ok(
      !codes.includes("CASH_BANK_TRANSACTION_DELETE"),
      "a delete capability must be a catalogue entry before it is an action"
    );
  });

  test("only a Draft is editable", () => {
    assert.ok(transactionIsEditable("Draft"));
    assert.equal(transactionIsEditable("Posted"), false);
    assert.equal(transactionIsEditable("Cancelled"), false);
  });

  test("a final status accepts no transition at all", () => {
    for (const status of ["Posted", "Cancelled"] as TransactionStatus[]) {
      for (const action of Object.keys(
        TRANSACTION_TRANSITIONS
      ) as TransactionAction[]) {
        assert.equal(
          transactionTransitionAllowed(action, status),
          false,
          `${action} must not be legal from ${status}`
        );
      }
    }
  });

  test("nothing produces Draft — a posted document is never reopened", () => {
    for (const t of Object.values(TRANSACTION_TRANSITIONS)) {
      assert.notEqual(t.to, "Draft");
    }
  });

  test("a transition is offered only to a caller holding its permission", () => {
    const none = transactionAbilities([]);
    assert.deepEqual(availableTransactionActions("Draft", none), []);

    const poster = transactionAbilities(["CASH_BANK_TRANSACTION_POST"]);
    assert.deepEqual(availableTransactionActions("Draft", poster), ["post"]);
    assert.deepEqual(availableTransactionActions("Posted", poster), []);
  });
});

// ------------------------------------------------------------------ purpose

describe("a purpose resolves to exactly one classification", () => {
  test("every purpose names a budget category that exists", async () => {
    const labels = new Set(
      (
        await prisma.sysBudgetCategory.findMany({
          select: { category_label: true },
        })
      ).map((c) => c.category_label)
    );
    for (const p of PURPOSES) {
      assert.ok(
        labels.has(p.budgetCategory),
        `${p.key} names budget category ${p.budgetCategory}, which is not seeded`
      );
    }
  });

  test("every purpose that takes a partner names a real partner category", async () => {
    const labels = new Set(
      (
        await prisma.sysPartnerCategory.findMany({
          select: { category_label: true },
        })
      ).map((c) => c.category_label)
    );
    for (const p of PURPOSES) {
      if (!p.partnerCategory) continue;
      assert.ok(
        labels.has(p.partnerCategory),
        `${p.key} names partner category ${p.partnerCategory}, which is not seeded`
      );
    }
  });

  test("purposes stay application logic — there is no fin_purpose table", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'fin_purpose'
    `;
    assert.equal(rows.length, 0, "fin_purpose must not exist — CLAUDE.md §12");
  });
});

// ------------------------------------------------------------------- header

describe("the document header is enforced, not merely narrowed", () => {
  test("an unknown purpose is refused", async () => {
    const result = await checkHeader({
      purpose: "NOT_A_PURPOSE",
      company_id: induk,
      partner_id: null,
      cash_bank_id: await makeCashBank({}),
    });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors.purpose);
  });

  test("the anak is refused — its realization is a Funding Request", async () => {
    const cashBank = await makeCashBank({ companyId: anak });
    const result = await checkHeader({
      purpose: "BYA_OUT",
      company_id: anak,
      partner_id: null,
      cash_bank_id: cashBank,
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.ok === false && /Funding Request/.test(result.errors.company_id),
      "the refusal must say where the anak's realization actually goes"
    );
  });

  test("the transacting company is resolved from is_parent, never hardcoded", async () => {
    const company = await transactingCompany();
    assert.ok(company);
    assert.equal(company.id, induk);
  });

  test("a purpose that takes no partner must not carry one", async () => {
    const partner = await makePartner({
      companyId: induk,
      categoryLabel: "Stakeholder",
    });
    const result = await checkHeader({
      purpose: "BYA_OUT",
      company_id: induk,
      partner_id: partner,
      cash_bank_id: await makeCashBank({}),
    });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors.partner_id);
  });

  test("a purpose that takes a partner refuses the wrong partner category", async () => {
    // PRV_SH_OUT admits Stakeholder only.
    const wrong = await makePartner({
      companyId: induk,
      categoryLabel: "Karyawan",
    });
    const result = await checkHeader({
      purpose: "PRV_SH_OUT",
      company_id: induk,
      partner_id: wrong,
      cash_bank_id: await makeCashBank({}),
    });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && /Stakeholder/.test(result.errors.partner_id));
  });

  test("an inactive cash & bank cannot be transacted on", async () => {
    const cashBank = await makeCashBank({ status: "Inactive" });
    const result = await checkHeader({
      purpose: "BYA_OUT",
      company_id: induk,
      partner_id: null,
      cash_bank_id: cashBank,
    });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors.cash_bank_id);
  });

  test("a valid header resolves its currency from the cash & bank", async () => {
    const cashBank = await makeCashBank({ currencyId: otherCurrency });
    const result = await checkHeader({
      purpose: "BYA_OUT",
      company_id: induk,
      partner_id: null,
      cash_bank_id: cashBank,
    });
    assert.ok(result.ok);
    assert.equal(result.ok && result.currencyId, otherCurrency);
  });
});

// -------------------------------------------------------------- eligibility

describe("only a budget the header admits is eligible", () => {
  test("an approved budget matching every criterion is offered", async () => {
    const cashBank = await makeCashBank({});
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 1_000_000 });

    const pool = await eligibleBudgets({
      purpose: "BYA_OUT",
      company_id: induk,
      partner_id: null,
      cash_bank_id: cashBank,
    });
    const mine = pool.find((b) => b.id === budget);
    assert.ok(mine, "the budget must be eligible");
    assert.equal(mine.outstanding, 1_000_000);
  });

  test("a budget that is not yet approved is never offered", async () => {
    const cashBank = await makeCashBank({});
    const draft = await makeBudget({
      categoryLabel: "Biaya",
      amount: 500_000,
      status: "Submitted",
    });

    const pool = await eligibleBudgets({
      purpose: "BYA_OUT",
      company_id: induk,
      partner_id: null,
      cash_bank_id: cashBank,
    });
    assert.ok(!pool.some((b) => b.id === draft));
  });

  test("a budget pointing the other way is never offered", async () => {
    const cashBank = await makeCashBank({});
    // HIN_CAB_IN is an In purpose; this budget is an Out plan.
    const outward = await makeBudget({
      categoryLabel: "Hasil Investasi",
      type: "Out",
      amount: 400_000,
      partnerId: await makePartner({ companyId: induk, categoryLabel: "Cabang" }),
    });

    const pool = await eligibleBudgets({
      purpose: "HIN_CAB_IN",
      company_id: induk,
      partner_id: null,
      cash_bank_id: cashBank,
    });
    assert.ok(!pool.some((b) => b.id === outward));
  });

  test("a budget in another currency is never offered — nothing converts", async () => {
    const cashBank = await makeCashBank({ currencyId: currency });
    const foreign = await makeBudget({
      categoryLabel: "Biaya",
      amount: 900_000,
      currencyId: otherCurrency,
    });

    const pool = await eligibleBudgets({
      purpose: "BYA_OUT",
      company_id: induk,
      partner_id: null,
      cash_bank_id: cashBank,
    });
    assert.ok(
      !pool.some((b) => b.id === foreign),
      "settling across currencies would need an exchange rate the system does not have"
    );
  });

  test("a fully realized budget drops out", async () => {
    const cashBank = await makeCashBank({});
    const spent = await makeBudget({
      categoryLabel: "Biaya",
      amount: 300_000,
      realized: 300_000,
    });

    const pool = await eligibleBudgets({
      purpose: "BYA_OUT",
      company_id: induk,
      partner_id: null,
      cash_bank_id: cashBank,
    });
    assert.ok(!pool.some((b) => b.id === spent));
  });

  test("a purpose with a partner only offers that partner's budgets", async () => {
    const cashBank = await makeCashBank({});
    const mine = await makePartner({
      companyId: induk,
      categoryLabel: "Stakeholder",
    });
    const theirs = await makePartner({
      companyId: induk,
      categoryLabel: "Stakeholder",
    });
    const ours = await makeBudget({
      categoryLabel: "Prive",
      amount: 2_000_000,
      partnerId: mine,
    });
    const other = await makeBudget({
      categoryLabel: "Prive",
      amount: 2_000_000,
      partnerId: theirs,
    });

    const pool = await eligibleBudgets({
      purpose: "PRV_SH_OUT",
      company_id: induk,
      partner_id: mine,
      cash_bank_id: cashBank,
    });
    assert.ok(pool.some((b) => b.id === ours));
    assert.ok(!pool.some((b) => b.id === other));
  });

  test("budget date is not a filter — an older plan stays realizable", async () => {
    const cashBank = await makeCashBank({});
    const old = await prisma.budBudget.create({
      data: {
        budget_no: `TST-${FIXTURE_PREFIX}OLD${Date.now() % 100000}`,
        budget_date: new Date("2020-01-15T00:00:00Z"),
        company_id: induk,
        currency_id: currency,
        budget_type: "Out",
        category_id: await budgetCategoryId("Biaya"),
        description: "Fixture old plan",
        budget_amount: 750_000,
        status: "Open",
        created_by: actor,
      },
      select: { id: true },
    });
    budgets.push(old.id);

    const pool = await eligibleBudgets({
      purpose: "BYA_OUT",
      company_id: induk,
      partner_id: null,
      cash_bank_id: cashBank,
    });
    assert.ok(
      pool.some((b) => b.id === old.id),
      "concept doc §9 makes the month a reporting dimension, not a gate"
    );
  });
});

// -------------------------------------------------------------------- lines

describe("lines are re-derived, never trusted", () => {
  test("a document with no line is refused", async () => {
    const cashBank = await makeCashBank({});
    const result = await checkLines(
      {
        purpose: "BYA_OUT",
        company_id: induk,
        partner_id: null,
        cash_bank_id: cashBank,
      },
      []
    );
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors._lines);
  });

  test("a budget the header does not admit is refused even when submitted directly", async () => {
    const cashBank = await makeCashBank({});
    const foreign = await makeBudget({
      categoryLabel: "Biaya",
      amount: 500_000,
      companyId: anak,
    });

    const result = await checkLines(
      {
        purpose: "BYA_OUT",
        company_id: induk,
        partner_id: null,
        cash_bank_id: cashBank,
      },
      [{ budget_id: foreign, amount: 100_000 }]
    );
    assert.equal(result.ok, false, "the picker is not the enforcement");
  });

  test("the same budget twice in one document is refused", async () => {
    const cashBank = await makeCashBank({});
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 800_000 });

    const result = await checkLines(
      {
        purpose: "BYA_OUT",
        company_id: induk,
        partner_id: null,
        cash_bank_id: cashBank,
      },
      [
        { budget_id: budget, amount: 100_000 },
        { budget_id: budget, amount: 200_000 },
      ]
    );
    assert.equal(result.ok, false);
  });

  test("over-realization is allowed — concept doc §6.5", async () => {
    const cashBank = await makeCashBank({});
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 100_000 });

    const result = await checkLines(
      {
        purpose: "BYA_OUT",
        company_id: induk,
        partner_id: null,
        cash_bank_id: cashBank,
      },
      [{ budget_id: budget, amount: 150_000 }]
    );
    assert.ok(result.ok);
    assert.equal(result.ok && result.total, 150_000);
  });

  test("several budgets settle in one document, and the total is their sum", async () => {
    const cashBank = await makeCashBank({});
    const a = await makeBudget({ categoryLabel: "Biaya", amount: 300_000 });
    const b = await makeBudget({ categoryLabel: "Biaya", amount: 700_000 });

    const result = await checkLines(
      {
        purpose: "BYA_OUT",
        company_id: induk,
        partner_id: null,
        cash_bank_id: cashBank,
      },
      [
        { budget_id: a, amount: 300_000 },
        { budget_id: b, amount: 200_000 },
      ]
    );
    assert.ok(result.ok);
    assert.equal(result.ok && result.total, 500_000);
  });
});

// --------------------------------------------------------------------- post

describe("a draft moves nothing; posting moves everything at once", () => {
  test("a draft leaves the book and the budget untouched", async () => {
    const cashBank = await makeCashBank({ opening: 5_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 1_000_000 });
    await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 1_000_000, outstanding: 1_000_000 }],
    });

    const balance = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: cashBank },
    });
    const plan = await prisma.budBudget.findUniqueOrThrow({ where: { id: budget } });

    assert.equal(balance.balance.toNumber(), 5_000_000);
    assert.equal(plan.realized_amount.toNumber(), 0);
    assert.equal(plan.status, "Open");
  });

  test("a draft's allocation is reported but never reserved", async () => {
    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 1_000_000 });
    await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 400_000, outstanding: 1_000_000 }],
    });

    const pool = await eligibleBudgets({
      purpose: "BYA_OUT",
      company_id: induk,
      partner_id: null,
      cash_bank_id: cashBank,
    });
    const mine = pool.find((b) => b.id === budget);
    assert.ok(mine);
    assert.equal(mine.draftAllocated, 400_000);
    assert.equal(
      mine.outstanding,
      1_000_000,
      "a draft has moved nothing, so outstanding is untouched"
    );
  });

  test("posting writes the ledger entry, the balance and the realization together", async () => {
    const cashBank = await makeCashBank({ opening: 5_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 1_000_000 });
    const doc = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 400_000, outstanding: 1_000_000 }],
    });

    await post(doc);

    const entries = await prisma.cashBankLedger.findMany({
      where: { cash_bank_id: cashBank, entry_type: "Transaction" },
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].direction, "Out");
    assert.equal(entries[0].amount.toNumber(), 400_000);
    assert.equal(entries[0].movement.toNumber(), -400_000);
    assert.equal(entries[0].balance_after.toNumber(), 4_600_000);

    const balance = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: cashBank },
    });
    assert.equal(balance.balance.toNumber(), 4_600_000);

    const plan = await prisma.budBudget.findUniqueOrThrow({ where: { id: budget } });
    assert.equal(plan.realized_amount.toNumber(), 400_000);
    assert.equal(plan.status, "Open", "a partial realization leaves the plan open");

    const after = await prisma.finCashBankTransaction.findUniqueOrThrow({
      where: { id: doc },
    });
    assert.equal(after.status, "Posted");
    assert.ok(after.document_date, "a document acquires its date at Post");
    assert.ok(after.posting_date);
  });

  test("the materialised balance still matches the ledger after posting", async () => {
    const cashBank = await makeCashBank({ opening: 2_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 600_000 });
    const doc = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 600_000, outstanding: 600_000 }],
    });
    await post(doc);

    const stored = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: cashBank },
    });
    const rebuilt = await rebuildCashBankBalance(cashBank);
    assert.equal(rebuilt, stored.balance.toNumber());
    assert.equal(rebuilt, 1_400_000);
  });

  test("an In purpose increases the balance", async () => {
    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    const budget = await makeBudget({
      categoryLabel: "Hasil Investasi",
      type: "In",
      partnerId: partner,
      amount: 750_000,
    });
    const doc = await makeDraft({
      purpose: "HIN_CAB_IN",
      cashBankId: cashBank,
      partnerId: partner,
      lines: [{ budgetId: budget, amount: 750_000, outstanding: 750_000 }],
    });
    await post(doc);

    const balance = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: cashBank },
    });
    assert.equal(balance.balance.toNumber(), 1_750_000);
  });

  test("a budget realized to the full amount closes itself", async () => {
    const cashBank = await makeCashBank({ opening: 3_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 900_000 });
    const doc = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 900_000, outstanding: 900_000 }],
    });
    await post(doc);

    const plan = await prisma.budBudget.findUniqueOrThrow({ where: { id: budget } });
    assert.equal(plan.status, "Closed", "concept doc §6.5 — realization closes the plan");
  });

  test("one budget can be realized by several documents", async () => {
    const cashBank = await makeCashBank({ opening: 10_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 1_000_000 });

    const first = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 400_000, outstanding: 1_000_000 }],
    });
    await post(first);

    const second = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 600_000, outstanding: 600_000 }],
    });
    await post(second);

    const plan = await prisma.budBudget.findUniqueOrThrow({ where: { id: budget } });
    assert.equal(plan.realized_amount.toNumber(), 1_000_000);
    assert.equal(plan.status, "Closed");

    const balance = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: cashBank },
    });
    assert.equal(balance.balance.toNumber(), 9_000_000);
  });

  test("a budget closed by another document blocks the post", async () => {
    const cashBank = await makeCashBank({ opening: 5_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 500_000 });

    // Two documents drafted against the same plan; the first closes it.
    const first = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 500_000, outstanding: 500_000 }],
    });
    const second = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 500_000, outstanding: 500_000 }],
    });

    await post(first);
    const result = await applyPosting(second, actor);

    assert.equal(result.ok, false, "the second post must be refused");
    const balance = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: cashBank },
    });
    assert.equal(
      balance.balance.toNumber(),
      4_500_000,
      "a refused post must leave the balance exactly where the first one left it"
    );
    const entries = await prisma.cashBankLedger.count({
      where: { cash_bank_id: cashBank, source_doc_id: second },
    });
    assert.equal(entries, 0, "a refused post must write no ledger entry");
  });

  test("a posted document cannot be posted twice", async () => {
    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 200_000 });
    const doc = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 200_000, outstanding: 200_000 }],
    });
    await post(doc);

    const again = await applyPosting(doc, actor);
    assert.equal(again.ok, false);

    const balance = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: cashBank },
    });
    assert.equal(balance.balance.toNumber(), 800_000);
  });

  test("the ledger entry names the document that caused it", async () => {
    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 250_000 });
    const doc = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 250_000, outstanding: 250_000 }],
    });
    await post(doc);

    const entry = await prisma.cashBankLedger.findFirstOrThrow({
      where: { cash_bank_id: cashBank, entry_type: "Transaction" },
      include: { source_doc_type: true },
    });
    assert.equal(entry.source_doc_id, doc);
    assert.equal(entry.source_doc_type?.doc_table, "fin_cash_bank_transaction");
  });

  test("the book is append-only — posting adds an entry, never rewrites one", async () => {
    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const a = await makeBudget({ categoryLabel: "Biaya", amount: 100_000 });
    const b = await makeBudget({ categoryLabel: "Biaya", amount: 200_000 });

    const first = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: a, amount: 100_000, outstanding: 100_000 }],
    });
    await post(first);
    const afterFirst = await prisma.cashBankLedger.findMany({
      where: { cash_bank_id: cashBank },
      orderBy: { id: "asc" },
      select: { id: true, balance_after: true },
    });

    const second = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: b, amount: 200_000, outstanding: 200_000 }],
    });
    await post(second);
    const afterSecond = await prisma.cashBankLedger.findMany({
      where: { cash_bank_id: cashBank },
      orderBy: { id: "asc" },
      select: { id: true, balance_after: true },
    });

    assert.equal(afterSecond.length, afterFirst.length + 1);
    for (const [i, row] of afterFirst.entries()) {
      assert.equal(afterSecond[i].id, row.id);
      assert.equal(
        afterSecond[i].balance_after.toNumber(),
        row.balance_after.toNumber(),
        "an existing entry must never be rewritten"
      );
    }
  });
});

/**
 * Posts a draft through the very code the Server Action runs.
 *
 * `transitionTransaction` resolves its caller from a session cookie, which does
 * not exist in a test process, so it authorizes and then delegates the writes
 * to `applyPosting`. That is what is called here — the assertions below are
 * about the real posting path, not a reimplementation of it.
 */
async function post(transactionId: number): Promise<void> {
  const result = await applyPosting(transactionId, actor);
  assert.ok(
    result.ok,
    `posting ${transactionId} failed: ${result.ok ? "" : JSON.stringify(result.errors)}`
  );
}

/**
 * Post writes the Journal alongside the Cash Bank Book — never from it.
 *
 * The book is an independent historical store and only the General Ledger
 * derives from journal lines (concept doc §2.5). What matters here is that a
 * posting produces both, in one transaction, and that the journal it produces
 * balances.
 */
describe("posting writes a balanced journal alongside the book", () => {
  test("a posted document produces one journal, and it balances", async () => {
    const cashBank = await makeCashBank({ opening: 5_000_000 });
    const budget = await makeBudget({
      type: "Out",
      categoryLabel: "Biaya",
      amount: 750_000,
    });
    const doc = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 750_000, outstanding: 750_000 }],
    });
    await post(doc);

    const journals = await prisma.accJournal.findMany({
      where: { source_doc_id: doc },
      include: { lines: true },
    });
    assert.equal(journals.length, 1, "one posting, one journal");

    const j = journals[0];
    assert.equal(j.status, "Posted");
    const debit = j.lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0);
    const credit = j.lines.reduce((t, l) => t + l.kredit_amount.toNumber(), 0);
    assert.equal(Math.round(debit * 100), Math.round(credit * 100));
    assert.equal(Math.round(debit * 100), 750_000 * 100);
  });

  test("money out credits the cash account and debits its counterpart", async () => {
    const cashBank = await makeCashBank({ opening: 5_000_000 });
    const resource = await prisma.mCashBank.findUniqueOrThrow({
      where: { id: cashBank },
      select: { account_id: true },
    });
    const budget = await makeBudget({
      type: "Out",
      categoryLabel: "Biaya",
      amount: 400_000,
    });
    const doc = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 400_000, outstanding: 400_000 }],
    });
    await post(doc);

    const lines = await prisma.accJournalLine.findMany({
      where: { journal: { source_doc_id: doc } },
    });
    const cashLine = lines.find((l) => l.account_id === resource.account_id);
    assert.ok(cashLine, "the resource's own account must be on the journal");
    assert.equal(
      cashLine.kredit_amount.toNumber(),
      400_000,
      "money leaving credits the cash account"
    );
    assert.equal(cashLine.debit_amount.toNumber(), 0);

    const counter = lines.filter((l) => l.account_id !== resource.account_id);
    assert.ok(counter.length > 0);
    assert.equal(
      counter.reduce((t, l) => t + l.debit_amount.toNumber(), 0),
      400_000
    );
  });

  test("a Draft has no journal at all", async () => {
    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const budget = await makeBudget({
      type: "Out",
      categoryLabel: "Biaya",
      amount: 100_000,
    });
    const doc = await makeDraft({
      purpose: "BYA_OUT",
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 100_000, outstanding: 100_000 }],
    });

    assert.equal(
      await prisma.accJournal.count({ where: { source_doc_id: doc } }),
      0,
      "a draft touches nothing, accounting included"
    );
  });

  test("a document whose category has no mapping cannot be posted", async () => {
    // Approval tolerates a missing mapping (§10 rule 28) because that gap
    // belongs to Accounting. Posting cannot: there is no account to journal
    // against, and money must not move unaccounted for.
    // Taken whole and put back whole. This row may be one a real user created
    // through the application, and restoring it through the fixture helper
    // would hand it a fixture code that `cleanupFixtures` then deletes — the
    // suite would quietly destroy a mapping it only meant to borrow.
    const mapping = await prisma.accBudgetCategoryAccount.findFirstOrThrow({
      where: { company_id: induk, budget_category: { category_label: "Asset" } },
    });
    await prisma.accBudgetCategoryAccount.delete({ where: { id: mapping.id } });

    try {
      const cashBank = await makeCashBank({ opening: 2_000_000 });
      const budget = await makeBudget({
        type: "Out",
        categoryLabel: "Asset",
        amount: 300_000,
      });
      const doc = await makeDraft({
        purpose: "AST_OUT",
        cashBankId: cashBank,
        lines: [{ budgetId: budget, amount: 300_000, outstanding: 300_000 }],
      });

      const result = await applyPosting(doc, actor);
      assert.equal(result.ok, false);
      assert.match(String(result.errors?._form), /Mapping Budget ke Account/);

      const doc2 = await prisma.finCashBankTransaction.findUniqueOrThrow({
        where: { id: doc },
        select: { status: true },
      });
      assert.equal(doc2.status, "Draft", "a refused post leaves the draft alone");
      assert.equal(
        await prisma.cashBankLedger.count({ where: { source_doc_id: doc } }),
        0,
        "and moves no money"
      );
    } finally {
      const { id: _id, created_at: _c, updated_at: _u, ...row } = mapping;
      await prisma.accBudgetCategoryAccount.create({ data: row });
    }
  });
});
