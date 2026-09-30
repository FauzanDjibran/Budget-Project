import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  applyPosting,
  previewPosting,
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
import { loadClassification } from "../src/lib/siba/classification-data";
import {
  openCashBankBook,
  rebuildCashBankBalance,
  recordCashBankEntry,
} from "../src/lib/siba/cash-bank";
import { openLayer, openLayersOf } from "../src/lib/siba/cash-bank-layers";
import { subledgerPosition } from "../src/lib/siba/subledger";
import { checkTransactionDate, lockFiscalPeriod } from "../src/lib/siba/fiscal";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import {
  FIXTURE_PREFIX,
  bookKey,
  budgetCategoryId,
  childCompanyId,
  cleanupFiscalYear,
  cleanupFixtures,
  closeYearFor,
  openFiscalYear,
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
let fiscalYear = 0;
let currency = 0;
let otherCurrency = 0;
let fxAccount = 0;

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
    rate: 1,
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
  status?: "Open" | "Draft" | "Submitted" | "Approved" | "Closed";
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
  /** The menu the document is raised from. */
  transaction_type: "In" | "Out";
  cashBankId: number;
  /** The document's own currency; defaults to the resource's. */
  currencyId?: number;
  /** The kurs, where the user types one. */
  rate?: number;
  /** The layer a payment out of a foreign resource draws on. */
  layerId?: number;
  /** `YYYY-MM-DD`; omitted, the draft carries none and posts as today. */
  documentDate?: string;
  /**
   * `itemId` is shorthand for a line lowering a position that settles one open
   * item for its whole amount; `items` names several, each for its own amount.
   */
  lines: {
    budgetId: number;
    amount: number;
    outstanding: number;
    itemId?: number;
    items?: { itemId: number; amount: number }[];
  }[];
}): Promise<number> {
  const cashBank = await prisma.mCashBank.findUniqueOrThrow({
    where: { id: options.cashBankId },
    select: { currency_id: true, company_id: true },
  });
  const docType = await budgetDocTypeId();
  const total = options.lines.reduce((t, l) => t + l.amount, 0);
  const rate = options.rate ?? 1;

  const row = await prisma.finCashBankTransaction.create({
    data: {
      transaction_no: `TST-CBT${transactions.length + 1}${Date.now() % 100000}`,
      transaction_type: options.transaction_type,
      company_id: cashBank.company_id,
      cash_bank_id: options.cashBankId,
      currency_id: options.currencyId ?? cashBank.currency_id,
      exchange_rate: rate,
      cash_bank_layer_id: options.layerId ?? null,
      document_date: options.documentDate
        ? new Date(`${options.documentDate}T00:00:00Z`)
        : null,
      transaction_amount: total,
      transaction_base_amount: total * rate,
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
          items: {
            create: (l.items ?? (l.itemId ? [{ itemId: l.itemId, amount: l.amount }] : [])).map(
              (it, k) => ({
                sequence_no: k + 1,
                sub_ledger_balance_id: it.itemId,
                amount: it.amount,
                created_by: actor,
              })
            ),
          },
        })),
      },
    },
    select: { id: true },
  });
  transactions.push(row.id);
  return row.id;
}

/** The oldest open item of one subject — what a clerk settling it would pick. */
async function openItem(book: string, partnerId: number, currencyId: number): Promise<number> {
  const item = await prisma.subLedgerBalance.findFirstOrThrow({
    where: { book, partner_id: partnerId, currency_id: currencyId, status: "Open" },
    orderBy: [{ opened_date: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return item.id;
}

before(async () => {
  // Posting is refused outside an Open fiscal year (`checkPostingPeriod`),
  // and the seed opens none — a calendar is business data. Reused when the
  // database already has one; removed again only if this run made it.
  fiscalYear = await openFiscalYear();
  induk = await parentCompanyId();
  anak = await childCompanyId();
  actor = await systemUserId();

  const currencies = await prisma.refCurrency.findMany({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  currency = currencies[0].id;
  // A second currency is only needed to prove amounts are never mixed, and it
  // is **always this suite's own** rather than whichever row happens to sit
  // second in the table. Taking `currencies[1]` made the fixture depend on what
  // the database already held, and the row it eventually landed on was
  // `curr.TESTEUR` — a fixture this same file creates and never removes. The
  // third-currency test then built its resource and its document in the same
  // currency, which is a perfectly legal settlement, so the refusal it asserts
  // could not arise. Upserted, because nothing deletes a currency: the
  // application never hard-deletes master data and `cleanupFixtures` follows it.
  const made = await prisma.refCurrency.upsert({
    where: { currency_code: `test.${FIXTURE_PREFIX}CUR` },
    update: { status: "Active" },
    create: {
      currency_code: `test.${FIXTURE_PREFIX}CUR`,
      currency_label: `${FIXTURE_PREFIX}X`,
      currency_name: "Fixture currency",
      created_by: actor,
    },
    select: { id: true },
  });
  otherCurrency = made.id;

  // Posting journals the document, and a journal needs an account to post
  // against — so every Budget Category the tests exercise needs a mapping.
  // Approval tolerates a missing one (§10 rule 28); posting does not, and the
  // case below proves the refusal.
  for (const companyId of [induk, anak]) {
    const account = await makeAccount({
      companyId,
      subcategoryLabel: "5.3.1",
    });
    for (const rule of await loadClassification()) {
      const label = rule.label;
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

  // An FX difference has to land in a named account, and posting refuses by
  // name until one is set. Configured here so the settlement cases can post at
  // all; cleared again in `after`, because a setting pointing at a deleted
  // fixture account would outlive this run.
  fxAccount = await makeAccount({ companyId: induk, subcategoryLabel: "5.3.1" });
  await prisma.sysSetting.upsert({
    where: { setting_key: "induk_fx_account" },
    update: { setting_value: String(fxAccount) },
    create: { setting_key: "induk_fx_account", setting_value: String(fxAccount) },
  });
});

after(async () => {
  await prisma.sysSetting.deleteMany({ where: { setting_key: "induk_fx_account" } });
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
    await prisma.cashBankLayer.deleteMany({
      where: { cash_bank_id: { in: cashBanks } },
    });
    await prisma.cashBankLedger.deleteMany({
      where: { cash_bank_id: { in: cashBanks } },
    });
    await prisma.cashBankBalance.deleteMany({
      where: { cash_bank_id: { in: cashBanks } },
    });
    await prisma.mCashBank.deleteMany({ where: { id: { in: cashBanks } } });
  }
  // Fixtures first: a subledger entry points at both a Partner and a
  // currency, so the books have to be cleared before either can go.
  await cleanupFiscalYear();
  await cleanupFixtures();
  await prisma.refCurrency.deleteMany({
    where: { currency_label: { startsWith: FIXTURE_PREFIX } },
  });
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

  test("the table holds exactly submit, post and cancel", () => {
    // Submit is the funded route's way out of Draft (concept doc §26.2), and
    // there is deliberately no "reject": the induk always complies, so its side
    // is a confirmation of the request rather than a transition of this
    // document. Post stays the direct route's, and nothing returns to Draft.
    assert.deepEqual(Object.keys(TRANSACTION_TRANSITIONS).sort(), [
      "cancel",
      "post",
      "submit",
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

    const poster = transactionAbilities(["REALIZATION_POST"]);
    assert.deepEqual(availableTransactionActions("Draft", poster), ["post"]);
    assert.deepEqual(availableTransactionActions("Posted", poster), []);
  });
});

// ------------------------------------------------------------------- header

describe("the document header is enforced, not merely narrowed", () => {
  test("a direction that is neither menu's is refused", async () => {
    const result = await checkHeader({
      transaction_type: "Sideways" as "In",
      company_id: induk,
      cash_bank_id: await makeCashBank({}),
    });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors._form);
  });

  test("an anak document naming a Cash & Bank is refused", async () => {
    // The anak has no resource of its own by design, and this is the
    // submission the rule exists to stop: naming one anyway — the induk's, or
    // a stray row of its own — would be a way to spend money directly.
    const cashBank = await makeCashBank({ companyId: anak });
    const result = await checkHeader({
      transaction_type: "Out" as const,
      company_id: anak,
      cash_bank_id: cashBank,
      currency_id: currency,
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.ok === false && /Funding Request/.test(result.errors.cash_bank_id),
      "the refusal must say where the anak's money actually comes from"
    );
  });

  test("an anak document takes a Currency instead, and routes to treasury", async () => {
    const result = await checkHeader({
      transaction_type: "Out" as const,
      company_id: anak,
      cash_bank_id: null,
      currency_id: currency,
    });
    assert.equal(result.ok, true);
    assert.ok(result.ok === true && result.route === "treasury");
    assert.equal(result.ok === true && result.cashBankId, null);
    assert.equal(result.ok === true && result.currencyId, currency);
  });

  test("an anak document without a Currency is refused", async () => {
    const result = await checkHeader({
      transaction_type: "Out" as const,
      company_id: anak,
      cash_bank_id: null,
      currency_id: null,
    });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors.currency_id);
  });

  test("the document names its own currency on both routes", async () => {
    // It used to be read off the Cash & Bank on the self route, and a submitted
    // value was ignored. That only worked while the two could not differ — a
    // foreign document paid from a rupiah account is the case that separated
    // them, so the document says what it is denominated in and the resource
    // says what it holds.
    const result = await checkHeader({
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: await makeCashBank({}),
      currency_id: currency,
    });
    assert.equal(result.ok, true);
    assert.ok(result.ok === true && result.route === "self");
    assert.equal(result.ok === true && result.currencyId, currency);
  });

  test("a currency the resource cannot settle is refused by name", async () => {
    // Crossing goes through the base currency only. A foreign document paid
    // from a *different* foreign resource is the combination that does not
    // exist in this system, and it is refused rather than silently narrowed.
    const eur = await prisma.refCurrency.upsert({
      where: { currency_code: "curr.TESTEUR" },
      // Reasserted, not left alone: a run that deactivated this fixture would
      // otherwise make `checkHeader` refuse on `currency_id` for ever after, and
      // the settlement rule this test is about would never be reached at all.
      update: { status: "Active" },
      create: {
        currency_code: "curr.TESTEUR",
        currency_label: "TEU",
        currency_name: "Fixture Third Currency",
        created_by: actor,
      },
      select: { id: true },
    });
    const foreignResource = await makeCashBank({ currencyId: otherCurrency });
    const result = await checkHeader({
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: foreignResource,
      currency_id: eur.id,
    });
    assert.equal(result.ok, false);
    assert.match(
      result.ok === false ? result.errors.cash_bank_id ?? "" : "",
      /hanya dapat|tidak dapat/
    );
  });

  test("the transacting company is resolved from is_parent, never hardcoded", async () => {
    const company = await transactingCompany();
    assert.ok(company);
    assert.equal(company.id, induk);
  });

  test("an inactive cash & bank cannot be transacted on", async () => {
    const cashBank = await makeCashBank({ status: "Inactive" });
    const result = await checkHeader({
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: cashBank,
      currency_id: currency,
    });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors.cash_bank_id);
  });

  test("a base-currency document may be paid from a base-currency resource", async () => {
    const cashBank = await makeCashBank({ currencyId: currency });
    const result = await checkHeader({
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: cashBank,
      currency_id: currency,
    });
    assert.ok(result.ok);
    assert.equal(result.ok && result.currencyId, currency);
    assert.equal(result.ok && result.rate, 1, "rupiah on rupiah is the identity");
    assert.equal(result.ok && result.layerId, null, "and no layer is involved");
  });

  test("a foreign document paid from base currency needs a kurs typed", async () => {
    const rupiahResource = await makeCashBank({ currencyId: currency });
    const header = {
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: rupiahResource,
      currency_id: otherCurrency,
    };

    const missing = await checkHeader(header);
    assert.equal(missing.ok, false);
    assert.ok(
      missing.ok === false && missing.errors.exchange_rate,
      "the bank converted at some rate, and only the user knows which"
    );

    const withRate = await checkHeader({ ...header, exchange_rate: 16_000 });
    assert.ok(withRate.ok);
    assert.equal(withRate.ok && withRate.rate, 16_000);
    assert.equal(withRate.ok && withRate.layerId, null);
  });

  test("a payment out of a foreign resource must name a layer", async () => {
    const foreignResource = await makeCashBank({ currencyId: otherCurrency });
    const header = {
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: foreignResource,
      currency_id: otherCurrency,
    };

    const missing = await checkHeader(header);
    assert.equal(missing.ok, false);
    assert.ok(missing.ok === false && missing.errors.cash_bank_layer_id);

    const layer = await prisma.$transaction((tx) =>
      openLayer(tx, {
        cashBankId: foreignResource,
        date: today,
        rate: 15_500,
        foreign: 1_000,
        actorId: actor,
      })
    );
    const chosen = await checkHeader({
      ...header,
      cash_bank_layer_id: layer.id,
    });
    assert.ok(chosen.ok);
    assert.equal(
      chosen.ok && chosen.rate,
      15_500,
      "the kurs is the layer's own — read, never typed"
    );
    assert.equal(chosen.ok && chosen.layerId, layer.id);
  });

  test("a layer belonging to another resource is refused", async () => {
    const mine = await makeCashBank({ currencyId: otherCurrency });
    const theirs = await makeCashBank({ currencyId: otherCurrency });
    const layer = await prisma.$transaction((tx) =>
      openLayer(tx, {
        cashBankId: theirs,
        date: today,
        rate: 15_000,
        foreign: 500,
        actorId: actor,
      })
    );
    const result = await checkHeader({
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: mine,
      currency_id: otherCurrency,
      cash_bank_layer_id: layer.id,
    });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors.cash_bank_layer_id);
  });
});

// -------------------------------------------------------------- eligibility

describe("only a budget the header admits is eligible", () => {
  test("an approved budget matching every criterion is offered", async () => {
    const cashBank = await makeCashBank({});
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 1_000_000 });

    const pool = await eligibleBudgets({
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: cashBank,
      currency_id: currency,
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
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: cashBank,
      currency_id: currency,
    });
    assert.ok(!pool.some((b) => b.id === draft));
  });

  test("an approved budget still waiting for its classification is never offered", async () => {
    // Approval no longer classifies: until Klasifikasi Budget gives it a
    // Category, there is no book and no account for a line to post by.
    const cashBank = await makeCashBank({});
    const awaiting = await makeBudget({
      categoryLabel: "Biaya",
      amount: 450_000,
      status: "Approved",
    });

    const pool = await eligibleBudgets({
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: cashBank,
      currency_id: currency,
    });
    assert.ok(!pool.some((b) => b.id === awaiting));
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
      transaction_type: "In" as const,
      company_id: induk,
      cash_bank_id: cashBank,
      currency_id: currency,
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
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: cashBank,
      currency_id: currency,
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
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: cashBank,
      currency_id: currency,
    });
    assert.ok(!pool.some((b) => b.id === spent));
  });

  test("every category and every partner is offered in one pool", async () => {
    // A realization is not narrowed by classification: the header names no
    // Budget Category and no Partner, so one document may settle all of them.
    const cashBank = await makeCashBank({});
    const mine = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const theirs = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const prive = await makeBudget({ categoryLabel: "Prive", amount: 2_000_000, partnerId: mine });
    const advance = await makeBudget({ categoryLabel: "Piutang", amount: 500_000, partnerId: theirs });
    const expense = await makeBudget({ categoryLabel: "Biaya", amount: 300_000 });

    const pool = await eligibleBudgets({
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: cashBank,
      currency_id: currency,
    });
    for (const id of [prive, advance, expense]) {
      assert.ok(pool.some((b) => b.id === id), `budget ${id} should be offered`);
    }
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
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: cashBank,
      currency_id: currency,
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
        transaction_type: "Out" as const,
        company_id: induk,
        cash_bank_id: cashBank,
        currency_id: currency,
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
        transaction_type: "Out" as const,
        company_id: induk,
        cash_bank_id: cashBank,
        currency_id: currency,
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
        transaction_type: "Out" as const,
        company_id: induk,
        cash_bank_id: cashBank,
        currency_id: currency,
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
        transaction_type: "Out" as const,
        company_id: induk,
        cash_bank_id: cashBank,
        currency_id: currency,
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
        transaction_type: "Out" as const,
        company_id: induk,
        cash_bank_id: cashBank,
        currency_id: currency,
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
      transaction_type: "Out" as const,
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
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 400_000, outstanding: 1_000_000 }],
    });

    const pool = await eligibleBudgets({
      transaction_type: "Out" as const,
      company_id: induk,
      cash_bank_id: cashBank,
      currency_id: currency,
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
      transaction_type: "Out" as const,
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
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 600_000, outstanding: 600_000 }],
    });
    await post(doc);

    const stored = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: cashBank },
    });
    const rebuilt = await rebuildCashBankBalance(cashBank);
    assert.equal(rebuilt.balance, stored.balance.toNumber());
    assert.equal(rebuilt.baseBalance, stored.base_balance.toNumber());
    assert.equal(rebuilt.balance, 1_400_000);
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
      transaction_type: "In" as const,
      cashBankId: cashBank,
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
      transaction_type: "Out" as const,
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
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 400_000, outstanding: 1_000_000 }],
    });
    await post(first);

    const second = await makeDraft({
      transaction_type: "Out" as const,
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
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 500_000, outstanding: 500_000 }],
    });
    const second = await makeDraft({
      transaction_type: "Out" as const,
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
      transaction_type: "Out" as const,
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
      transaction_type: "Out" as const,
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
      transaction_type: "Out" as const,
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
      transaction_type: "Out" as const,
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
      transaction_type: "Out" as const,
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

  test("the Post preview is the journal Post writes, and writes nothing itself", async () => {
    // Consequences before commitment: the confirmation shows this preview, so
    // it has to be the journal and not an estimate of it — and opening the
    // confirmation must move nothing.
    const cashBank = await makeCashBank({ opening: 5_000_000 });
    const budget = await makeBudget({
      type: "Out",
      categoryLabel: "Biaya",
      amount: 640_000,
    });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 640_000, outstanding: 640_000 }],
    });

    const preview = await previewPosting(doc);
    assert.ok(preview.ok, JSON.stringify(preview));
    assert.equal(await prisma.accJournal.count({ where: { source_doc_id: doc } }), 0);
    assert.equal(
      (await prisma.finCashBankTransaction.findUniqueOrThrow({ where: { id: doc } })).status,
      "Draft",
      "a preview is not a Post"
    );

    await post(doc);
    const written = await prisma.accJournal.findFirstOrThrow({
      where: { source_doc_id: doc },
      include: { lines: { orderBy: { sequence_no: "asc" } } },
    });
    const labelOf = new Map(
      (
        await prisma.accAccount.findMany({
          where: { id: { in: written.lines.map((l) => l.account_id) } },
          select: { id: true, account_label: true },
        })
      ).map((a) => [a.id, a.account_label])
    );
    assert.deepEqual(
      preview.lines.map((l) => [l.accountLabel, l.debit, l.credit]),
      written.lines.map((l) => [
        labelOf.get(l.account_id),
        l.debit_amount.toNumber(),
        l.kredit_amount.toNumber(),
      ]),
      "the same accounts, sides and base figures, in the same order"
    );
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
      transaction_type: "Out" as const,
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
      transaction_type: "Out" as const,
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
        transaction_type: "Out" as const,
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
      await prisma.accBudgetCategoryAccount.create({
        data: {
          bca_code: mapping.bca_code,
          company_id: mapping.company_id,
          budget_category_id: mapping.budget_category_id,
          partner_category_id: mapping.partner_category_id,
          account_id: mapping.account_id,
          created_by: mapping.created_by,
          updated_by: mapping.updated_by,
        },
      });
    }
  });
});

/**
 * Post writes the subject book too, and by the book's own direction.
 *
 * The third store a posting fans out to (concept doc §13): the Cash Bank Book
 * records which resource moved, the Journal records the accounting, and the
 * subledger records where the Partner now stands. All three are written from
 * the document, in one transaction, and none is derived from another.
 */
describe("posting writes the subject book alongside the cash book", () => {
  test("a Hutang receipt raises the partner's position", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const budget = await makeBudget({
      type: "In",
      categoryLabel: "Hutang",
      partnerId: partner,
      amount: 3_000_000,
    });
    const doc = await makeDraft({
      transaction_type: "In" as const,
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 3_000_000, outstanding: 3_000_000 }],
    });
    await post(doc);

    const entries = await prisma.subLedger.findMany({
      where: { source_doc_id: doc, book: await bookKey("Hutang") },
    });
    assert.equal(entries.length, 1, "one document, one entry in its subject book");
    assert.equal(entries[0].partner_id, partner);
    assert.equal(entries[0].direction, "In");
    assert.equal(
      entries[0].movement.toNumber(),
      3_000_000,
      "receiving a loan raises the obligation"
    );

    // The receipt opened one open item, and the entry names it.
    const items = await prisma.subLedgerBalance.findMany({
      where: { book: await bookKey("Hutang"), partner_id: partner, currency_id: currency },
    });
    assert.equal(items.length, 1, "a raising line opens exactly one open item");
    assert.equal(items[0].balance.toNumber(), 3_000_000);
    assert.equal(items[0].original.toNumber(), 3_000_000);
    assert.equal(items[0].entry_count, 1);
    assert.equal(entries[0].balance_id, items[0].id);
  });

  test("a Piutang payment out raises the position while cash falls", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const cashBank = await makeCashBank({ opening: 9_000_000 });
    const budget = await makeBudget({
      type: "Out",
      categoryLabel: "Piutang",
      partnerId: partner,
      amount: 2_000_000,
    });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 2_000_000, outstanding: 2_000_000 }],
    });
    await post(doc);

    const entry = await prisma.subLedger.findFirstOrThrow({
      where: { source_doc_id: doc, book: await bookKey("Piutang") },
    });
    assert.equal(entry.direction, "Out", "the money left");
    assert.equal(
      entry.movement.toNumber(),
      2_000_000,
      "and lending raises what is owed to us — the book signs by its own direction"
    );

    assert.equal(
      (await rebuildCashBankBalance(cashBank)).balance,
      7_000_000,
      "while the cash resource itself falls"
    );
  });

  test("a draft writes nothing into any subject book", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const cashBank = await makeCashBank({ opening: 4_000_000 });
    const budget = await makeBudget({
      type: "Out",
      categoryLabel: "Prive",
      partnerId: partner,
      amount: 500_000,
    });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 500_000, outstanding: 500_000 }],
    });

    assert.equal(
      await prisma.subLedger.count({ where: { source_doc_id: doc } }),
      0,
      "a draft is inert in every book"
    );
  });

  test("a category with no partner keeps no book", async () => {
    const cashBank = await makeCashBank({ opening: 2_000_000 });
    const budget = await makeBudget({
      type: "Out",
      categoryLabel: "Biaya",
      amount: 250_000,
    });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 250_000, outstanding: 250_000 }],
    });
    await post(doc);

    assert.equal(
      await prisma.subLedger.count({ where: { source_doc_id: doc } }),
      0,
      "Biaya names no Partner, so there is no subject whose position moved"
    );
    assert.equal(
      await prisma.cashBankLedger.count({ where: { source_doc_id: doc } }),
      1,
      "the cash book and the journal still record it"
    );
  });
});

/**
 * Valuing a document, now that there is something to value it with.
 *
 * The temporary refusal these tests replaced is gone: a foreign document posts,
 * because the kurs now has somewhere to come from. What is asserted instead is
 * the thing that refusal was protecting — that no movement is ever written at a
 * rate nobody transacted at.
 */
describe("a foreign document is valued rather than refused", () => {
  test("a payment out of a foreign resource takes the layer's kurs", async () => {
    const cashBank = await makeCashBank({ currencyId: otherCurrency });
    const layer = await prisma.$transaction((tx) =>
      openLayer(tx, {
        cashBankId: cashBank,
        date: today,
        rate: 15_500,
        foreign: 1_000,
        actorId: actor,
      })
    );
    // The book has to hold what the layer says it holds, or the two disagree
    // from the start — which is what `reconcileLayers` exists to catch.
    await recordCashBankEntry(prisma, {
      cashBankId: cashBank,
      date: today,
      type: "Opening",
      direction: "In",
      amount: 1_000,
      rate: 15_500,
      actorId: actor,
    });

    const budget = await makeBudget({
      categoryLabel: "Biaya",
      amount: 900,
      currencyId: otherCurrency,
    });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      layerId: layer.id,
      lines: [{ budgetId: budget, amount: 400, outstanding: 900 }],
    });
    await post(doc);

    const entry = await prisma.cashBankLedger.findFirstOrThrow({
      where: { cash_bank_id: cashBank, entry_type: "Transaction" },
    });
    assert.equal(entry.amount.toNumber(), 400, "the resource gave up 400");
    assert.equal(entry.rate.toNumber(), 15_500, "at the layer's own kurs");
    assert.equal(entry.base_amount.toNumber(), 6_200_000);

    // The layer is drawn down by exactly what left it.
    const after = await prisma.cashBankLayer.findUniqueOrThrow({
      where: { id: layer.id },
    });
    assert.equal(after.foreign_remaining.toNumber(), 600);
    assert.equal(after.base_remaining.toNumber(), 9_300_000);
    assert.equal(
      after.base_remaining.toNumber() / after.foreign_remaining.toNumber(),
      15_500,
      "and the layer's rate is unmoved by being spent"
    );

    const posted = await prisma.finCashBankTransaction.findUniqueOrThrow({
      where: { id: doc },
    });
    assert.equal(posted.exchange_rate.toNumber(), 15_500);
    assert.equal(posted.transaction_base_amount.toNumber(), 6_200_000);
  });

  test("a foreign document paid from rupiah converts at the rate typed", async () => {
    const rupiah = await makeCashBank({ opening: 50_000_000 });
    const budget = await makeBudget({
      categoryLabel: "Biaya",
      amount: 1_000,
      currencyId: otherCurrency,
    });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: rupiah,
      currencyId: otherCurrency,
      rate: 16_000,
      lines: [{ budgetId: budget, amount: 500, outstanding: 1_000 }],
    });
    await post(doc);

    const entry = await prisma.cashBankLedger.findFirstOrThrow({
      where: { cash_bank_id: rupiah, entry_type: "Transaction" },
    });
    // What left the bank is rupiah, because that is what the bank holds.
    assert.equal(entry.amount.toNumber(), 8_000_000, "500 at 16.000");
    assert.equal(entry.rate.toNumber(), 1, "a rupiah account is worth its face");
    assert.equal(entry.base_amount.toNumber(), 8_000_000);

    // And the journal holds two currencies at once, balancing only in base.
    const journal = await prisma.accJournal.findFirstOrThrow({
      where: { source_doc_id: doc },
      include: { lines: true },
      orderBy: { id: "desc" },
    });
    assert.equal(
      new Set(journal.lines.map((l) => l.currency_id)).size,
      2,
      "a rupiah cash line and a foreign counter line"
    );
    assert.equal(
      journal.lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0),
      journal.lines.reduce((t, l) => t + l.kredit_amount.toNumber(), 0)
    );
  });

  test("money arriving into a foreign resource opens a layer", async () => {
    const cashBank = await makeCashBank({ currencyId: otherCurrency });
    const partner = await makePartner({
      companyId: induk,
      categoryLabel: "Stakeholder",
    });
    const budget = await makeBudget({
      categoryLabel: "Hutang",
      type: "In",
      partnerId: partner,
      amount: 2_000,
      currencyId: otherCurrency,
    });
    const doc = await makeDraft({
      transaction_type: "In" as const,
      cashBankId: cashBank,
      rate: 15_800,
      lines: [{ budgetId: budget, amount: 2_000, outstanding: 2_000 }],
    });
    await post(doc);

    const layers = await openLayersOf(cashBank);
    assert.equal(layers.length, 1, "currency arriving is currency acquired");
    assert.equal(layers[0].rate, 15_800);
    assert.equal(layers[0].foreignRemaining, 2_000);
    assert.equal(layers[0].baseRemaining, 31_600_000);
  });

  test("relieving a position releases what it was carried at, and the gap is recognised", async () => {
    // The case the whole phase exists for. A debt taken on when a dollar cost
    // 15.000 and settled with dollars that cost 16.000 releases at 15.000; the
    // million-rupiah gap is a real loss and lands in the journal, not in either
    // book.
    const partner = await makePartner({
      companyId: induk,
      categoryLabel: "Stakeholder",
    });
    const borrowInto = await makeCashBank({ currencyId: otherCurrency });
    const borrowed = await makeBudget({
      categoryLabel: "Hutang",
      type: "In",
      partnerId: partner,
      amount: 1_000,
      currencyId: otherCurrency,
    });
    await post(
      await makeDraft({
        transaction_type: "In" as const,
        cashBankId: borrowInto,
        rate: 15_000,
        lines: [{ budgetId: borrowed, amount: 1_000, outstanding: 1_000 }],
      })
    );

    const position = await subledgerPosition(await bookKey("Hutang"), partner, otherCurrency);
    assert.deepEqual(position, { foreign: 1_000, base: 15_000_000 });

    // Repay from a layer that cost more.
    const payFrom = await makeCashBank({ currencyId: otherCurrency });
    const dear = await prisma.$transaction((tx) =>
      openLayer(tx, {
        cashBankId: payFrom,
        date: today,
        rate: 16_000,
        foreign: 1_000,
        actorId: actor,
      })
    );
    await recordCashBankEntry(prisma, {
      cashBankId: payFrom,
      date: today,
      type: "Opening",
      direction: "In",
      amount: 1_000,
      rate: 16_000,
      actorId: actor,
    });

    const repayment = await makeBudget({
      categoryLabel: "Hutang",
      type: "Out",
      partnerId: partner,
      amount: 1_000,
      currencyId: otherCurrency,
    });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: payFrom,
      layerId: dear.id,
      lines: [
        {
          budgetId: repayment,
          amount: 1_000,
          outstanding: 1_000,
          itemId: await openItem(await bookKey("Hutang"), partner, otherCurrency),
        },
      ],
    });
    await post(doc);

    // The book released what it was carrying, not what the cash cost.
    const relief = await prisma.subLedger.findFirstOrThrow({
      where: { book: await bookKey("Hutang"), partner_id: partner, direction: "Out" },
      orderBy: { id: "desc" },
    });
    assert.equal(relief.amount.toNumber(), 1_000);
    assert.equal(relief.base_amount.toNumber(), 15_000_000, "at 15.000");
    assert.equal(relief.rate.toNumber(), 15_000);

    // And the position closes at nothing on both measures.
    assert.deepEqual(await subledgerPosition(await bookKey("Hutang"), partner, otherCurrency), {
      foreign: 0,
      base: 0,
    });

    // The gap is a loss, and it is in the journal.
    const line = await prisma.finCashBankTransactionLine.findFirstOrThrow({
      where: { transaction_id: doc },
    });
    assert.equal(line.settlement_base_amount.toNumber(), 15_000_000);
    assert.equal(line.transaction_base_amount.toNumber(), 16_000_000);
    assert.equal(line.fx_difference.toNumber(), -1_000_000, "a loss");

    const journal = await prisma.accJournal.findFirstOrThrow({
      where: { source_doc_id: doc },
      include: { lines: true },
      orderBy: { id: "desc" },
    });
    assert.equal(journal.lines.length, 3, "cash, the obligation, and the gap");
    assert.equal(
      journal.lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0),
      journal.lines.reduce((t, l) => t + l.kredit_amount.toNumber(), 0),
      "and it balances, in base"
    );
    assert.ok(
      journal.lines.some(
        (l) => l.debit_amount.toNumber() === 1_000_000 && l.trx_amount.toNumber() === 1_000_000
      ),
      "the loss sits on the debit side, as the balancing figure"
    );
  });

  test("a document larger than its layer is refused", async () => {
    const cashBank = await makeCashBank({ currencyId: otherCurrency });
    const layer = await prisma.$transaction((tx) =>
      openLayer(tx, {
        cashBankId: cashBank,
        date: today,
        rate: 15_000,
        foreign: 300,
        actorId: actor,
      })
    );
    const budget = await makeBudget({
      categoryLabel: "Biaya",
      amount: 1_000,
      currencyId: otherCurrency,
    });

    const result = await checkLines(
      {
        transaction_type: "Out" as const,
        company_id: induk,
        cash_bank_id: cashBank,
        currency_id: otherCurrency,
        cash_bank_layer_id: layer.id,
      },
      [{ budget_id: budget, amount: 400 }]
    );
    assert.equal(result.ok, false);
    assert.match(
      result.ok === false ? result.errors._lines ?? "" : "",
      /melebihi sisa layer/,
      "one transaction, one layer — the cap is the layer, not the account"
    );
  });

  test("a base-currency posting still values everything at 1", async () => {
    const cashBank = await makeCashBank({ opening: 5_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 1_000_000 });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 250_000, outstanding: 1_000_000 }],
    });
    await post(doc);

    const entry = await prisma.cashBankLedger.findFirstOrThrow({
      where: { cash_bank_id: cashBank, entry_type: "Transaction" },
    });
    assert.equal(entry.rate.toNumber(), 1, "base currency, so the rate is 1");
    assert.equal(entry.base_amount.toNumber(), entry.amount.toNumber());
    assert.equal(entry.base_movement.toNumber(), entry.movement.toNumber());
    assert.equal(
      entry.base_balance_after.toNumber(),
      entry.balance_after.toNumber(),
      "both measures move together while everything is rupiah"
    );
  });
});

// ------------------------------------------------------------- the period lock

// ------------------------------------------------------ several Budgets

/**
 * One realization, many Budgets, many books.
 *
 * What the split into Realisasi Penerimaan / Pengeluaran bought: a document
 * settles Budgets of every category and every Partner at once, and **every
 * book writes one entry per Budget** — six Budgets are six Cash Bank Book
 * entries and six subject-book entries, never one summed entry — each reading
 * its Budget's own description. The journal is one cash line, then a counter
 * line per Budget on the account its own classification maps to, then an FX
 * line per Budget whose two base values disagree.
 */
describe("one document realizes Budgets of several categories and partners", () => {
  test("each Budget writes its own entry in every book, under its own words", async () => {
    const karyawan = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const cashBank = await makeCashBank({ opening: 10_000_000 });
    const expense = await makeBudget({ categoryLabel: "Biaya", amount: 400_000 });
    const firstAdvance = await makeBudget({
      categoryLabel: "Piutang",
      partnerId: karyawan,
      amount: 250_000,
    });
    const secondAdvance = await makeBudget({
      categoryLabel: "Piutang",
      partnerId: karyawan,
      amount: 150_000,
    });

    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      lines: [
        { budgetId: expense, amount: 400_000, outstanding: 400_000 },
        { budgetId: firstAdvance, amount: 250_000, outstanding: 250_000 },
        { budgetId: secondAdvance, amount: 150_000, outstanding: 150_000 },
      ],
    });
    await post(doc);

    const descriptions = new Map(
      (
        await prisma.budBudget.findMany({
          where: { id: { in: [expense, firstAdvance, secondAdvance] } },
          select: { id: true, description: true },
        })
      ).map((b) => [b.id, b.description])
    );

    // The Cash Bank Book: three entries, one per Budget, each its own amount
    // and its own description — not one entry of 800.000.
    const cash = await prisma.cashBankLedger.findMany({
      where: { cash_bank_id: cashBank, source_doc_id: doc },
      orderBy: { id: "asc" },
    });
    assert.equal(cash.length, 3, "one Cash Bank Book entry per Budget");
    assert.deepEqual(
      cash.map((e) => [e.amount.toNumber(), e.note]),
      [
        [400_000, descriptions.get(expense)],
        [250_000, descriptions.get(firstAdvance)],
        [150_000, descriptions.get(secondAdvance)],
      ]
    );
    const balance = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: cashBank },
    });
    assert.equal(balance.balance.toNumber(), 9_200_000);

    // The subject book: two Piutang entries for the same Partner, never one
    // summed entry, each under its own Budget's description.
    const book = await prisma.subLedger.findMany({
      where: { source_doc_id: doc, book: await bookKey("Piutang") },
      orderBy: { id: "asc" },
    });
    assert.equal(book.length, 2, "two Budgets against one Partner are two entries");
    assert.deepEqual(
      book.map((e) => [e.partner_id, e.movement.toNumber(), e.note]),
      [
        [karyawan, 250_000, descriptions.get(firstAdvance)],
        [karyawan, 150_000, descriptions.get(secondAdvance)],
      ]
    );
    assert.deepEqual(
      await subledgerPosition(await bookKey("Piutang"), karyawan, currency),
      { foreign: 400_000, base: 400_000 }
    );

    // The journal: one cash line and one counter line per Budget, each
    // carrying its own Partner and its own description.
    const journal = await prisma.accJournal.findFirstOrThrow({
      where: { source_doc_id: doc },
      include: { lines: { orderBy: { id: "asc" } } },
    });
    assert.equal(journal.lines.length, 4, "cash, then one line per Budget");
    const counters = journal.lines.slice(1);
    assert.deepEqual(
      counters.map((l) => [l.partner_id, l.debit_amount.toNumber(), l.description]),
      [
        [null, 400_000, descriptions.get(expense)],
        [karyawan, 250_000, descriptions.get(firstAdvance)],
        [karyawan, 150_000, descriptions.get(secondAdvance)],
      ]
    );
    assert.equal(journal.lines[0].kredit_amount.toNumber(), 800_000, "the cash left once");

    // Every Budget is realized by its own line.
    const realized = await prisma.budBudget.findMany({
      where: { id: { in: [expense, firstAdvance, secondAdvance] } },
      select: { status: true },
    });
    assert.ok(realized.every((b) => b.status === "Closed"));
  });

  test("an FX difference is recognised per Budget, never summed", async () => {
    // Two debts in foreign currency, carried at two different rates, settled
    // in one payment drawn from one layer. Each line releases its own debt at
    // its own carrying rate, so each has its own loss — and each loss is its
    // own journal line.
    const lender = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const other = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });

    for (const [partner, rate] of [
      [lender, 15_000],
      [other, 15_500],
    ] as const) {
      const into = await makeCashBank({ currencyId: otherCurrency });
      const borrowed = await makeBudget({
        categoryLabel: "Hutang",
        type: "In",
        partnerId: partner,
        amount: 1_000,
        currencyId: otherCurrency,
      });
      await post(
        await makeDraft({
          transaction_type: "In" as const,
          cashBankId: into,
          rate,
          lines: [{ budgetId: borrowed, amount: 1_000, outstanding: 1_000 }],
        })
      );
    }

    const payFrom = await makeCashBank({ currencyId: otherCurrency });
    const layer = await prisma.$transaction((tx) =>
      openLayer(tx, { cashBankId: payFrom, date: today, rate: 16_000, foreign: 2_000, actorId: actor })
    );
    await recordCashBankEntry(prisma, {
      cashBankId: payFrom,
      date: today,
      type: "Opening",
      direction: "In",
      amount: 2_000,
      rate: 16_000,
      actorId: actor,
    });

    const repayLender = await makeBudget({
      categoryLabel: "Hutang",
      type: "Out",
      partnerId: lender,
      amount: 1_000,
      currencyId: otherCurrency,
    });
    const repayOther = await makeBudget({
      categoryLabel: "Hutang",
      type: "Out",
      partnerId: other,
      amount: 1_000,
      currencyId: otherCurrency,
    });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: payFrom,
      layerId: layer.id,
      lines: [
        {
          budgetId: repayLender,
          amount: 1_000,
          outstanding: 1_000,
          itemId: await openItem(await bookKey("Hutang"), lender, otherCurrency),
        },
        {
          budgetId: repayOther,
          amount: 1_000,
          outstanding: 1_000,
          itemId: await openItem(await bookKey("Hutang"), other, otherCurrency),
        },
      ],
    });
    await post(doc);

    const lines = await prisma.finCashBankTransactionLine.findMany({
      where: { transaction_id: doc },
      orderBy: { sequence_no: "asc" },
    });
    assert.deepEqual(
      lines.map((l) => [
        l.transaction_base_amount.toNumber(),
        l.settlement_base_amount.toNumber(),
        l.fx_difference.toNumber(),
      ]),
      [
        [16_000_000, 15_000_000, -1_000_000],
        [16_000_000, 15_500_000, -500_000],
      ],
      "each line settles its own debt at its own carrying rate"
    );

    const journal = await prisma.accJournal.findFirstOrThrow({
      where: { source_doc_id: doc },
      include: { lines: { orderBy: { id: "asc" } } },
    });
    const fxLines = journal.lines.filter((l) => l.account_id === fxAccount);
    assert.deepEqual(
      fxLines.map((l) => l.debit_amount.toNumber()),
      [1_000_000, 500_000],
      "one loss line per Budget, not one line of 1.500.000"
    );
    assert.equal(journal.lines.length, 5, "cash, two counters, two differences");
    assert.equal(
      journal.lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0),
      journal.lines.reduce((t, l) => t + l.kredit_amount.toNumber(), 0),
      "and it balances, in base"
    );

    // One Cash Bank Book entry per Budget, both drawn from the one layer.
    const cash = await prisma.cashBankLedger.findMany({
      where: { cash_bank_id: payFrom, source_doc_id: doc },
    });
    assert.equal(cash.length, 2);
    assert.deepEqual(
      cash.map((e) => e.base_amount.toNumber()),
      [16_000_000, 16_000_000]
    );
    const spent = await prisma.cashBankLayer.findUniqueOrThrow({ where: { id: layer.id } });
    assert.equal(spent.status, "Exhausted");
  });

  test("a line whose classification has no mapping refuses the post, by Budget", async () => {
    const mapping = await prisma.accBudgetCategoryAccount.findFirstOrThrow({
      where: { company_id: induk, budget_category: { category_label: "Asset" } },
    });
    await prisma.accBudgetCategoryAccount.delete({ where: { id: mapping.id } });

    try {
      const cashBank = await makeCashBank({ opening: 2_000_000 });
      const mapped = await makeBudget({ categoryLabel: "Biaya", amount: 100_000 });
      const unmapped = await makeBudget({ categoryLabel: "Asset", amount: 200_000 });
      const doc = await makeDraft({
        transaction_type: "Out" as const,
        cashBankId: cashBank,
        lines: [
          { budgetId: mapped, amount: 100_000, outstanding: 100_000 },
          { budgetId: unmapped, amount: 200_000, outstanding: 200_000 },
        ],
      });

      const result = await applyPosting(doc, actor);
      assert.equal(result.ok, false);
      const { budget_no } = await prisma.budBudget.findUniqueOrThrow({
        where: { id: unmapped },
        select: { budget_no: true },
      });
      assert.ok(
        String(result.errors?._form).includes(budget_no),
        "the refusal names the Budget whose classification has no account"
      );
      assert.equal(
        await prisma.cashBankLedger.count({ where: { source_doc_id: doc, cash_bank_id: cashBank } }),
        0,
        "and the mapped line did not move money on its own"
      );
    } finally {
      await prisma.accBudgetCategoryAccount.create({
        data: {
          bca_code: mapping.bca_code,
          company_id: mapping.company_id,
          budget_category_id: mapping.budget_category_id,
          partner_category_id: mapping.partner_category_id,
          account_id: mapping.account_id,
          created_by: mapping.created_by,
          updated_by: mapping.updated_by,
        },
      });
    }
  });
});

describe("posting is refused outside an open period", () => {
  test("a Company that has closed the year cannot post into it", async () => {
    const cashBank = await makeCashBank({ opening: 5_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 1_000_000 });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 400_000, outstanding: 1_000_000 }],
    });

    const reopen = await closeYearFor(fiscalYear, induk);
    try {
      const refused = await applyPosting(doc, actor);
      assert.equal(refused.ok, false, "a closed year takes no new transactions");
      assert.match(refused.ok === false ? refused.errors._form ?? "" : "", /menutup/);

      // And nothing was written on the way to refusing.
      const balance = await prisma.cashBankBalance.findUniqueOrThrow({
        where: { cash_bank_id: cashBank },
      });
      assert.equal(balance.balance.toNumber(), 5_000_000);
      const plan = await prisma.budBudget.findUniqueOrThrow({ where: { id: budget } });
      assert.equal(plan.realized_amount.toNumber(), 0);
      assert.equal(
        (await prisma.finCashBankTransaction.findUniqueOrThrow({ where: { id: doc } }))
          .status,
        "Draft"
      );
    } finally {
      await reopen();
    }

    // The same document posts once the year is open again, which is what makes
    // the refusal the lock rather than something else about the document.
    await post(doc);
  });
});


/**
 * A document may be dated back, never forward.
 *
 * The date is chosen on the draft and every book the posting writes is dated
 * by it — the Cash Bank Book, the journal, the document itself — while
 * `posting_date` keeps the moment the posting actually happened. What decides
 * whether a day may be written is the fiscal calendar, asked when the draft is
 * saved, again before the posting transaction opens, and a third time inside
 * it under a lock a close also takes.
 */
describe("a document may be backdated inside an open year", () => {
  // The first of January of this year is always inside the open fixture year
  // and earlier than today — except on the first of January itself.
  const backdate = `${today.slice(0, 4)}-01-01`;
  const canBackdate = backdate < today;

  test("every book is dated by the document, not by the day it was posted", { skip: !canBackdate }, async () => {
    const cashBank = await makeCashBank({ opening: 2_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 300_000 });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      documentDate: backdate,
      lines: [{ budgetId: budget, amount: 300_000, outstanding: 300_000 }],
    });
    await post(doc);

    const entry = await prisma.cashBankLedger.findFirstOrThrow({
      where: { cash_bank_id: cashBank, source_doc_id: doc },
      select: { entry_date: true },
    });
    assert.equal(entry.entry_date.toISOString().slice(0, 10), backdate);

    const journal = await prisma.accJournal.findFirstOrThrow({
      where: { source_doc_id: doc, journal_no: { startsWith: "JRN-" } },
      select: { posting_date: true, created_at: true },
    });
    assert.equal(journal.posting_date?.toISOString().slice(0, 10), backdate);
    assert.equal(
      journal.created_at.toISOString().slice(0, 10),
      today,
      "when it was actually written is kept"
    );

    const row = await prisma.finCashBankTransaction.findUniqueOrThrow({
      where: { id: doc },
      select: { document_date: true, posting_date: true },
    });
    assert.equal(row.document_date?.toISOString().slice(0, 10), backdate);
    assert.equal(row.posting_date?.toISOString().slice(0, 10), today);
  });

  test("a day that has not happened yet is refused, and nothing moves", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 100_000 });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      documentDate: tomorrow,
      lines: [{ budgetId: budget, amount: 100_000, outstanding: 100_000 }],
    });

    const refused = await applyPosting(doc, actor);
    assert.equal(refused.ok, false);
    assert.match(refused.ok ? "" : refused.errors._form ?? "", /masa depan/);
    const balance = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: cashBank },
    });
    assert.equal(balance.balance.toNumber(), 1_000_000);
  });

  test("a date inside no fiscal year is refused", async () => {
    const dated = await checkTransactionDate("1901-06-15", [induk]);
    assert.equal(dated.ok, false);
    assert.match(dated.ok ? "" : dated.message, /tidak berada dalam tahun buku/);
  });

  test("a date that is not a date is refused", async () => {
    for (const raw of ["", "2026-02-30", "23/09/2026", null]) {
      const dated = await checkTransactionDate(raw, [induk]);
      assert.equal(dated.ok, false, `${String(raw)} must be refused`);
    }
  });

  test("a year the Company has closed takes no backdated posting", { skip: !canBackdate }, async () => {
    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 100_000 });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      documentDate: backdate,
      lines: [{ budgetId: budget, amount: 100_000, outstanding: 100_000 }],
    });

    const reopen = await closeYearFor(fiscalYear, induk);
    try {
      const refused = await applyPosting(doc, actor);
      assert.equal(refused.ok, false);
      assert.match(refused.ok ? "" : refused.errors._form ?? "", /menutup/);
    } finally {
      await reopen();
    }
  });

  test("a close committed while a posting waits on the lock wins, and the posting writes nothing", { skip: !canBackdate }, async () => {
    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 100_000 });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      documentDate: backdate,
      lines: [{ budgetId: budget, amount: 100_000, outstanding: 100_000 }],
    });

    // A close in progress: it holds the year and has written its closing row,
    // but has not committed. The posting passes its early check (the row is
    // not visible yet), then has to wait for the hold — and once the close
    // commits, its re-check under the hold must find the year shut.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    let closingId = 0;
    const closer = prisma.$transaction(
      async (tx) => {
        await lockFiscalPeriod(tx, fiscalYear, induk);
        const row = await tx.accFiscalClosing.create({
          data: {
            fiscal_year_id: fiscalYear,
            company_id: induk,
            status: "Closed",
            closed_at: new Date(),
            closed_by: actor,
            created_by: actor,
          },
          select: { id: true },
        });
        closingId = row.id;
        held();
        await gate;
      },
      { timeout: 30_000 }
    );

    try {
      await holding;
      const posting = applyPosting(doc, actor);
      await new Promise((r) => setTimeout(r, 500));
      release();
      await closer;

      const result = await posting;
      assert.equal(result.ok, false, "the close committed first, so the year is shut");
      assert.match(result.ok ? "" : result.errors._form ?? "", /menutup/);

      const balance = await prisma.cashBankBalance.findUniqueOrThrow({
        where: { cash_bank_id: cashBank },
      });
      assert.equal(balance.balance.toNumber(), 1_000_000, "nothing was written");
      assert.equal(
        await prisma.accJournal.count({ where: { source_doc_id: doc, journal_no: { startsWith: "JRN-" } } }),
        0
      );
    } finally {
      release();
      await closer.catch(() => {});
      if (closingId) await prisma.accFiscalClosing.deleteMany({ where: { id: closingId } });
    }
  });
});

/**
 * A subject book is kept in open items, and a line lowering a position
 * settles the one it names.
 *
 * Every movement that raises a position opens an item at the kurs it moved
 * at; a return, a repayment or a collection names the item it settles and
 * releases it at **that item's** rate, never at an average of the position.
 * Which item is chosen decides the gain or loss — and nothing may take an item,
 * and so a position, below nothing.
 */
describe("a line lowering a position settles the open item it names", () => {
  /** A foreign resource holding `foreign` at `rate`, in the book and its layer. */
  async function foreignCash(rate: number, foreign: number) {
    const cashBank = await makeCashBank({ currencyId: otherCurrency });
    const layer = await prisma.$transaction((tx) =>
      openLayer(tx, { cashBankId: cashBank, date: today, rate, foreign, actorId: actor })
    );
    await recordCashBankEntry(prisma, {
      cashBankId: cashBank,
      date: today,
      type: "Opening",
      direction: "In",
      amount: foreign,
      rate,
      actorId: actor,
    });
    return { cashBank, layer: layer.id };
  }

  /** A posted Titipan receipt of `amount`, into `cashBank` at `rate`. */
  async function receive(partner: number, cashBank: number, amount: number, rate: number) {
    const budget = await makeBudget({
      categoryLabel: "Titipan",
      type: "In",
      partnerId: partner,
      amount,
      currencyId: otherCurrency,
    });
    await post(
      await makeDraft({
        transaction_type: "In" as const,
        cashBankId: cashBank,
        rate,
        lines: [{ budgetId: budget, amount, outstanding: amount }],
      })
    );
  }

  const fxLine = async (doc: number) =>
    prisma.accJournalLine.findFirst({
      where: { journal: { source_doc_id: doc }, account_id: fxAccount },
      orderBy: { id: "desc" },
    });

  test("two receipts are two items, and each return releases its own item's kurs", async () => {
    // The worked example: Titipan 1 at 15.000 and Titipan 2 at 13.000 into Bank
    // A, both returned out of Bank B's dollars bought at 14.000. Settling the
    // 15.000 item first is a gain; the 13.000 item afterwards is the mirror
    // loss; the lifetime total is nil.
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    const bankA = await makeCashBank({ currencyId: otherCurrency });
    await receive(partner, bankA, 1_000, 15_000);
    await receive(partner, bankA, 1_000, 13_000);

    const titipan = await bookKey("Titipan");
    const items = await prisma.subLedgerBalance.findMany({
      where: { book: titipan, partner_id: partner, currency_id: otherCurrency },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(
      items.map((i) => [i.rate.toNumber(), i.balance.toNumber(), i.base_balance.toNumber()]),
      [
        [15_000, 1_000, 15_000_000],
        [13_000, 1_000, 13_000_000],
      ],
      "never merged into one averaged position row"
    );

    const results: number[] = [];
    for (const item of items) {
      const bankB = await foreignCash(14_000, 1_000);
      const budget = await makeBudget({
        categoryLabel: "Titipan",
        type: "Out",
        partnerId: partner,
        amount: 1_000,
        currencyId: otherCurrency,
      });
      const doc = await makeDraft({
        transaction_type: "Out" as const,
        cashBankId: bankB.cashBank,
        layerId: bankB.layer,
        lines: [{ budgetId: budget, amount: 1_000, outstanding: 1_000, itemId: item.id }],
      });
      await post(doc);
      const line = await prisma.finCashBankTransactionLine.findFirstOrThrow({
        where: { transaction_id: doc },
      });
      assert.equal(line.transaction_base_amount.toNumber(), 14_000_000, "the cash cost 14.000");
      assert.equal(
        line.settlement_base_amount.toNumber(),
        item.base_balance.toNumber(),
        "the Titipan released what its own item was raised at"
      );
      results.push(line.fx_difference.toNumber());

      const fx = await fxLine(doc);
      assert.ok(fx, "a difference is journaled");
      const gain = line.fx_difference.toNumber() > 0;
      assert.equal(
        gain ? fx.kredit_amount.toNumber() : fx.debit_amount.toNumber(),
        1_000_000,
        gain ? "a gain on the credit side" : "a loss on the debit side"
      );
    }
    assert.deepEqual(results, [1_000_000, -1_000_000]);
    assert.equal(results[0] + results[1], 0, "over the deposit's life the total is nil");

    const cleared = await prisma.subLedgerBalance.findMany({
      where: { id: { in: items.map((i) => i.id) } },
    });
    assert.ok(
      cleared.every((i) => i.status === "Cleared" && i.balance.toNumber() === 0),
      "both items are settled to nothing, and stay on the book as Cleared"
    );
  });

  test("a receipt settling an item states its difference on the side that balances", async () => {
    // A Piutang lent out at 15.000 and 16.000, collected at 13.000 (a loss:
    // the receivable gave up more than the cash brought in) and at 17.000 (a
    // gain). Money arriving turns the kernel's residual over; before it did,
    // both collections wrote the difference on the wrong side and the journal
    // refused to balance, so no foreign receipt at another kurs could post.
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    const rupiah = await makeCashBank({ opening: 50_000_000 });
    const valas = await makeCashBank({ currencyId: otherCurrency });
    for (const rate of [15_000, 16_000]) {
      const budget = await makeBudget({
        categoryLabel: "Piutang",
        type: "Out",
        partnerId: partner,
        amount: 1_000,
        currencyId: otherCurrency,
      });
      await post(
        await makeDraft({
          transaction_type: "Out" as const,
          cashBankId: rupiah,
          currencyId: otherCurrency,
          rate,
          lines: [{ budgetId: budget, amount: 1_000, outstanding: 1_000 }],
        })
      );
    }
    const piutang = await bookKey("Piutang");
    const items = await prisma.subLedgerBalance.findMany({
      where: { book: piutang, partner_id: partner, currency_id: otherCurrency },
      orderBy: { id: "asc" },
    });

    for (const [item, rate, fx] of [
      [items[0], 13_000, -2_000_000],
      [items[1], 17_000, 1_000_000],
    ] as const) {
      const budget = await makeBudget({
        categoryLabel: "Piutang",
        type: "In",
        partnerId: partner,
        amount: 1_000,
        currencyId: otherCurrency,
      });
      const doc = await makeDraft({
        transaction_type: "In" as const,
        cashBankId: valas,
        rate,
        lines: [{ budgetId: budget, amount: 1_000, outstanding: 1_000, itemId: item.id }],
      });
      await post(doc);
      const line = await prisma.finCashBankTransactionLine.findFirstOrThrow({
        where: { transaction_id: doc },
      });
      assert.equal(line.fx_difference.toNumber(), fx, "signed as a gain, from the receipt's side");
      const fxRow = await fxLine(doc);
      assert.ok(fxRow, "a difference is journaled");
      assert.equal(
        fx > 0 ? fxRow.kredit_amount.toNumber() : fxRow.debit_amount.toNumber(),
        Math.abs(fx),
        fx > 0 ? "a gain on the credit side" : "a loss on the debit side"
      );
    }
  });

  test("a payment larger than the resource holds is refused, not thrown", async () => {
    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const budget = await makeBudget({ categoryLabel: "Biaya", type: "Out", amount: 2_000_000 });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      lines: [{ budgetId: budget, amount: 2_000_000, outstanding: 2_000_000 }],
    });
    const result = await applyPosting(doc, actor);
    assert.equal(result.ok, false, "the Server Action gets a refusal to show, not an error screen");
    assert.match(result.ok ? "" : result.errors._form ?? "", /tidak mencukupi/);
  });

  test("one line settles several items, and each difference is its own journal line", async () => {
    // The worked example again, on ONE Budget line: Titipan at 15.000 and at
    // 13.000, both returned out of dollars bought at 14.000. Netted, the line
    // shows nil and hides a gain and a loss; kept per item it is a credit and a
    // debit on the Selisih Kurs account, and the journal still balances.
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    const bankA = await makeCashBank({ currencyId: otherCurrency });
    await receive(partner, bankA, 1_000, 15_000);
    await receive(partner, bankA, 1_000, 13_000);
    const titipan = await bookKey("Titipan");
    const [i15, i13] = await prisma.subLedgerBalance.findMany({
      where: { book: titipan, partner_id: partner, currency_id: otherCurrency },
      orderBy: { id: "asc" },
    });

    const bankB = await foreignCash(14_000, 2_000);
    const budget = await makeBudget({
      categoryLabel: "Titipan",
      type: "Out",
      partnerId: partner,
      amount: 2_000,
      currencyId: otherCurrency,
    });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: bankB.cashBank,
      layerId: bankB.layer,
      lines: [
        {
          budgetId: budget,
          amount: 2_000,
          outstanding: 2_000,
          items: [
            { itemId: i15.id, amount: 1_000 },
            { itemId: i13.id, amount: 1_000 },
          ],
        },
      ],
    });
    await post(doc);

    const line = await prisma.finCashBankTransactionLine.findFirstOrThrow({
      where: { transaction_id: doc },
      include: { items: { orderBy: { sequence_no: "asc" } } },
    });
    assert.deepEqual(
      line.items.map((a) => [a.settlement_base_amount.toNumber(), a.transaction_base_amount.toNumber(), a.fx_difference.toNumber()]),
      [
        [15_000_000, 14_000_000, 1_000_000],
        [13_000_000, 14_000_000, -1_000_000],
      ],
      "each item released at its own kurs against its share of the cash"
    );
    assert.equal(line.fx_difference.toNumber(), 0, "the line's figure is only the sum");
    assert.equal(
      line.items.reduce((t, a) => t + a.transaction_base_amount.toNumber(), 0),
      line.transaction_base_amount.toNumber(),
      "the shares add up to what left the bank"
    );

    const entries = await prisma.subLedger.findMany({
      where: { source_doc_id: doc, book: titipan },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(
      entries.map((e) => [e.balance_id, e.movement.toNumber(), e.base_movement.toNumber()]),
      [
        [i15.id, -1_000, -15_000_000],
        [i13.id, -1_000, -13_000_000],
      ],
      "one subject-book entry per item, each naming it"
    );
    const cleared = await prisma.subLedgerBalance.findMany({ where: { id: { in: [i15.id, i13.id] } } });
    assert.ok(cleared.every((i) => i.status === "Cleared"));

    const journal = await prisma.accJournal.findFirstOrThrow({
      where: { source_doc_id: doc, journal_no: { startsWith: "JRN-" } },
      include: { lines: true },
    });
    const fx = journal.lines.filter((l) => l.account_id === fxAccount);
    assert.deepEqual(
      fx.map((l) => [l.debit_amount.toNumber(), l.kredit_amount.toNumber()]).sort(),
      [
        [0, 1_000_000],
        [1_000_000, 0],
      ],
      "a gain on the credit side and a loss on the debit side, never netted"
    );
    const debit = journal.lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0);
    const credit = journal.lines.reduce((t, l) => t + l.kredit_amount.toNumber(), 0);
    assert.equal(debit, credit);
  });

  test("a receipt settling several items states each one's gain or loss", async () => {
    // Piutang lent at 15.000 and 18.000, collected together at 16.000: the
    // first gains 1 jt (credit), the second loses 2 jt (debit).
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    const rupiah = await makeCashBank({ opening: 50_000_000 });
    const valas = await makeCashBank({ currencyId: otherCurrency });
    for (const rate of [15_000, 18_000]) {
      const lent = await makeBudget({
        categoryLabel: "Piutang",
        type: "Out",
        partnerId: partner,
        amount: 1_000,
        currencyId: otherCurrency,
      });
      await post(
        await makeDraft({
          transaction_type: "Out" as const,
          cashBankId: rupiah,
          currencyId: otherCurrency,
          rate,
          lines: [{ budgetId: lent, amount: 1_000, outstanding: 1_000 }],
        })
      );
    }
    const piutang = await bookKey("Piutang");
    const [i15, i18] = await prisma.subLedgerBalance.findMany({
      where: { book: piutang, partner_id: partner, currency_id: otherCurrency },
      orderBy: { id: "asc" },
    });
    const collected = await makeBudget({
      categoryLabel: "Piutang",
      type: "In",
      partnerId: partner,
      amount: 2_000,
      currencyId: otherCurrency,
    });
    const doc = await makeDraft({
      transaction_type: "In" as const,
      cashBankId: valas,
      rate: 16_000,
      lines: [
        {
          budgetId: collected,
          amount: 2_000,
          outstanding: 2_000,
          items: [
            { itemId: i15.id, amount: 1_000 },
            { itemId: i18.id, amount: 1_000 },
          ],
        },
      ],
    });
    await post(doc);

    const allocations = await prisma.finCashBankTransactionLineItem.findMany({
      where: { line: { transaction_id: doc } },
      orderBy: { sequence_no: "asc" },
    });
    assert.deepEqual(
      allocations.map((a) => a.fx_difference.toNumber()),
      [1_000_000, -2_000_000]
    );
    const fx = await prisma.accJournalLine.findMany({
      where: { journal: { source_doc_id: doc }, account_id: fxAccount },
    });
    assert.deepEqual(
      fx.map((l) => [l.debit_amount.toNumber(), l.kredit_amount.toNumber()]).sort(),
      [
        [0, 1_000_000],
        [2_000_000, 0],
      ]
    );
  });

  test("items are chosen once per line, and never over what they hold", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const cashBank = await makeCashBank({ opening: 10_000_000 });
    const advance = await makeBudget({ categoryLabel: "Piutang", partnerId: partner, amount: 400_000 });
    await post(
      await makeDraft({
        transaction_type: "Out" as const,
        cashBankId: cashBank,
        lines: [{ budgetId: advance, amount: 400_000, outstanding: 400_000 }],
      })
    );
    const item = await openItem(await bookKey("Piutang"), partner, currency);
    const header = {
      transaction_type: "In" as const,
      company_id: induk,
      cash_bank_id: cashBank,
      currency_id: currency,
    };
    const first = await makeBudget({ categoryLabel: "Piutang", type: "In", partnerId: partner, amount: 400_000 });
    const second = await makeBudget({ categoryLabel: "Piutang", type: "In", partnerId: partner, amount: 400_000 });

    const twice = await checkLines(header, [
      {
        budget_id: first,
        amount: 0,
        items: [
          { item_id: item, amount: 100_000 },
          { item_id: item, amount: 100_000 },
        ],
      },
    ]);
    assert.ok(!twice.ok && /sekali/.test(twice.errors._lines), "one item, once per line");

    const across = await checkLines(header, [
      { budget_id: first, amount: 0, items: [{ item_id: item, amount: 300_000 }] },
      { budget_id: second, amount: 0, items: [{ item_id: item, amount: 200_000 }] },
    ]);
    assert.ok(!across.ok && /melebihi sisa/.test(across.errors._lines), "two lines together may not over-draw it");

    const summed = await checkLines(header, [
      { budget_id: first, amount: 999, items: [{ item_id: item, amount: 250_000 }] },
    ]);
    assert.ok(summed.ok);
    assert.equal(summed.ok && summed.lines[0].amount, 250_000, "the line is worth its items, not the figure sent");
  });

  test("a partial return keeps the item open at its own kurs", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    const bankA = await makeCashBank({ currencyId: otherCurrency });
    await receive(partner, bankA, 1_000, 15_000);
    const item = await openItem(await bookKey("Titipan"), partner, otherCurrency);

    const bankB = await foreignCash(14_000, 500);
    const budget = await makeBudget({
      categoryLabel: "Titipan",
      type: "Out",
      partnerId: partner,
      amount: 500,
      currencyId: otherCurrency,
    });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: bankB.cashBank,
      layerId: bankB.layer,
      lines: [{ budgetId: budget, amount: 500, outstanding: 500, itemId: item }],
    });
    await post(doc);

    const after = await prisma.subLedgerBalance.findUniqueOrThrow({ where: { id: item } });
    assert.equal(after.status, "Open");
    assert.equal(after.balance.toNumber(), 500);
    assert.equal(after.base_balance.toNumber(), 7_500_000);
    assert.equal(
      after.base_balance.toNumber() / after.balance.toNumber(),
      15_000,
      "relief keeps the item at the kurs it was raised at"
    );
    assert.equal((await fxLine(doc))?.kredit_amount.toNumber(), 500_000);
  });

  test("two Budgets raising one position at once open two items", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const cashBank = await makeCashBank({ opening: 10_000_000 });
    const first = await makeBudget({ categoryLabel: "Piutang", partnerId: partner, amount: 300_000 });
    const second = await makeBudget({ categoryLabel: "Piutang", partnerId: partner, amount: 200_000 });
    const doc = await makeDraft({
      transaction_type: "Out" as const,
      cashBankId: cashBank,
      lines: [
        { budgetId: first, amount: 300_000, outstanding: 300_000 },
        { budgetId: second, amount: 200_000, outstanding: 200_000 },
      ],
    });
    await post(doc);

    const items = await prisma.subLedgerBalance.findMany({
      where: { book: await bookKey("Piutang"), partner_id: partner },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(
      items.map((i) => [i.balance.toNumber(), i.rate.toNumber()]),
      [
        [300_000, 1],
        [200_000, 1],
      ],
      "one item per Budget line; rupiah items are itemised at a kurs of 1"
    );
  });

  test("a lowering line is refused without an item, with another subject's, or past its remainder", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const stranger = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const cashBank = await makeCashBank({ opening: 10_000_000 });
    for (const who of [partner, stranger]) {
      const advance = await makeBudget({ categoryLabel: "Piutang", partnerId: who, amount: 400_000 });
      await post(
        await makeDraft({
          transaction_type: "Out" as const,
          cashBankId: cashBank,
          lines: [{ budgetId: advance, amount: 400_000, outstanding: 400_000 }],
        })
      );
    }
    const piutang = await bookKey("Piutang");
    const mine = await openItem(piutang, partner, currency);
    const theirs = await openItem(piutang, stranger, currency);

    const collection = await makeBudget({
      categoryLabel: "Piutang",
      type: "In",
      partnerId: partner,
      amount: 900_000,
    });
    const header = {
      transaction_type: "In" as const,
      company_id: induk,
      cash_bank_id: cashBank,
      currency_id: currency,
    };
    const check = (amount: number, item_id: number | null) =>
      checkLines(header, [
        { budget_id: collection, amount, items: item_id ? [{ item_id, amount }] : [] },
      ]);

    const none = await check(100_000, null);
    assert.ok(!none.ok && /Pilih open item/.test(none.errors._lines));
    const foreignItem = await check(100_000, theirs);
    assert.ok(!foreignItem.ok && /bukan milik/.test(foreignItem.errors._lines));
    const tooMuch = await check(500_000, mine);
    assert.ok(!tooMuch.ok && /tidak boleh di bawah nol/.test(tooMuch.errors._lines));
    const exact = await check(400_000, mine);
    assert.ok(exact.ok, "the whole item, to the rupiah, is allowed");
    assert.deepEqual(exact.ok && exact.lines[0].items, [{ itemId: mine, amount: 400_000 }]);

    // A line that raises a position opens its own item and may not name one.
    const advance = await makeBudget({ categoryLabel: "Piutang", partnerId: partner, amount: 100_000 });
    const raising = await checkLines({ ...header, transaction_type: "Out" }, [
      { budget_id: advance, amount: 100_000, items: [{ item_id: mine, amount: 100_000 }] },
    ]);
    assert.ok(!raising.ok && /membuka item baru/.test(raising.errors._lines));
  });

  test("an item settled since the draft refuses the post, and nothing moves", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const cashBank = await makeCashBank({ opening: 10_000_000 });
    const advance = await makeBudget({ categoryLabel: "Piutang", partnerId: partner, amount: 400_000 });
    await post(
      await makeDraft({
        transaction_type: "Out" as const,
        cashBankId: cashBank,
        lines: [{ budgetId: advance, amount: 400_000, outstanding: 400_000 }],
      })
    );
    const item = await openItem(await bookKey("Piutang"), partner, currency);

    const drafts: number[] = [];
    for (let i = 0; i < 2; i++) {
      const collection = await makeBudget({
        categoryLabel: "Piutang",
        type: "In",
        partnerId: partner,
        amount: 300_000,
      });
      drafts.push(
        await makeDraft({
          transaction_type: "In" as const,
          cashBankId: cashBank,
          lines: [{ budgetId: collection, amount: 300_000, outstanding: 300_000, itemId: item }],
        })
      );
    }
    await post(drafts[0]);

    const entriesBefore = await prisma.subLedger.count({ where: { balance_id: item } });
    const refused = await applyPosting(drafts[1], actor);
    assert.ok(!refused.ok && /tinggal/.test(refused.errors._form));
    assert.equal(
      await prisma.subLedger.count({ where: { balance_id: item } }),
      entriesBefore,
      "a refused post writes nothing to the item"
    );
    const held = await prisma.subLedgerBalance.findUniqueOrThrow({ where: { id: item } });
    assert.equal(held.balance.toNumber(), 100_000, "and never takes it below nothing");
  });
});
