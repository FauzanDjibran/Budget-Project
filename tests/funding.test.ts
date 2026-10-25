import test, { after, before, describe } from "node:test";
import { realizationOf } from "../src/lib/siba/realization";
import assert from "node:assert/strict";

import { fundingRoute, valueDraft } from "../src/lib/siba/finance";
import { budgetDocTypeId } from "../src/lib/siba/finance-rows";
import {
  confirmFundingRequest,
  fundingRequestDocTypeId,
  previewFundingConfirmation,
  raiseFundingRequest,
  withdrawFundingRequest,
} from "../src/lib/siba/funding";
import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import { openCashBankBook } from "../src/lib/siba/cash-bank";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import { SYSTEM_ACCOUNTS } from "../src/lib/siba/system-accounts";
import {
  checkSystemAccountValue,
  intercompanyBridge,
} from "../src/lib/siba/system-account-data";
import {
  FIXTURE_PREFIX,
  bookId,
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
  setSystemAccount,
  systemAccountFixture,
} from "./helpers";

/**
 * Funding Request — the intercompany bridge.
 *
 * The anak has no Cash & Bank of its own, so its realization is executed by the
 * induk confirming a request (concept doc §26.2–§30). Three things must hold:
 *
 *  1. **Pending is as inert as Draft.** Submitting moves no cash, no book and
 *     no `realized_amount` — only the induk's confirmation does.
 *  2. **Confirmation is atomic and symmetrical.** One induk cash entry, the
 *     anak's own subject book where its Purpose keeps one, every Budget's
 *     realization, and one balanced journal per Company carrying the two
 *     Companies' positions against each other — all of it, or none of it.
 *  3. **A refusal leaves nothing behind.** An unfinished bridge, a resource in
 *     the wrong currency and a Budget that has closed since each refuse before
 *     anything is written.
 *
 * The suite builds its own business fixtures and removes them, and it restores
 * whatever the System Defaults held before it ran: the seed carries system data
 * only, and this database may belong to somebody.
 */

const today = new Date().toISOString().slice(0, 10);

let induk = 0;
let anak = 0;
let actor = 0;
let fiscalYear = 0;
let currency = 0;
let otherCurrency = 0;
/** A foreign currency of the suite's own, for the funded FX cases. */
let usd = 0;
let anakFxAccount = 0;

/** The bridge accounts, as this suite sets them up. */
let indukArAccount = 0;
let anakApAccount = 0;

const cashBanks: number[] = [];
const budgets: number[] = [];
const transactions: number[] = [];
const requests: number[] = [];

const systemAccounts = systemAccountFixture();

async function makeCashBank(options: {
  companyId?: number;
  currencyId?: number;
  opening?: number;
  /** The kurs a foreign opening is valued at; it opens the first layer. */
  rate?: number;
}): Promise<number> {
  const companyId = options.companyId ?? induk;
  const account = await makeAccount({
    companyId,
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
  });
  const key = `${FIXTURE_PREFIX}FCB${cashBanks.length + 1}${Date.now() % 100000}`;
  const row = await prisma.mCashBank.create({
    data: {
      cash_bank_code: `test.${key}`,
      cash_bank_label: key,
      cash_bank_name: `Fixture ${key}`,
      company_id: companyId,
      cash_bank_type: "Cash",
      currency_id: options.currencyId ?? currency,
      account_id: account,
      created_by: actor,
    },
    select: { id: true },
  });
  await openCashBankBook(prisma, {
    cashBankId: row.id,
    openingBalance: options.opening ?? 0,
    rate: options.rate ?? 1,
    date: today,
    actorId: actor,
    layered: options.rate != null,
  });
  cashBanks.push(row.id);
  return row.id;
}

/** An approved Budget of the anak's — the only kind a request may realize. */
async function makeBudget(options: {
  companyId?: number;
  currencyId?: number;
  type?: "In" | "Out";
  categoryLabel: string;
  partnerId?: number | null;
  amount: number;
  status?: "Open" | "Closed";
}): Promise<number> {
  const key = `${FIXTURE_PREFIX}FB${budgets.length + 1}${Date.now() % 100000}`;
  const row = await prisma.budBudget.create({
    data: {
      budget_no: `TSF-${key}`,
      budget_date: new Date(`${today}T00:00:00Z`),
      company_id: options.companyId ?? anak,
      currency_id: options.currencyId ?? currency,
      budget_type: options.type ?? "Out",
      category_id: await budgetCategoryId(options.categoryLabel),
      partner_id: options.partnerId ?? null,
      description: `Fixture ${key}`,
      budget_amount: options.amount,
      realized_amount: 0,
      status: options.status ?? "Open",
      created_by: actor,
    },
    select: { id: true },
  });
  budgets.push(row.id);
  return row.id;
}

/**
 * A Draft document of the anak's: no Cash & Bank, an explicit currency.
 *
 * Written through Prisma for the same reason `finance.test.ts` does it — a
 * Server Action resolves its caller from a session cookie a test process does
 * not have. The rules themselves are called directly.
 */
async function makeAnakDraft(options: {
  purpose: string;
  partnerId?: number | null;
  currencyId?: number;
  /** A lowering line names the open items it settles, as the draft form does. */
  lines: { budgetId: number; amount: number; items?: { itemId: number; amount: number }[] }[];
}): Promise<number> {
  // `purpose` is the historical mnemonic; its suffix is the direction.
  const direction = options.purpose.endsWith("_IN") ? "In" : "Out";
  const docType = await budgetDocTypeId();
  const total = options.lines.reduce((t, l) => t + l.amount, 0);

  const row = await prisma.finCashBankTransaction.create({
    data: {
      transaction_no: `TSF-CBT${transactions.length + 1}${Date.now() % 100000}`,
      transaction_type: direction,
      company_id: anak,
      cash_bank_id: null,
      currency_id: options.currencyId ?? currency,
      transaction_amount: total,
      transaction_base_amount: total,
      status: "Draft",
      created_by: actor,
      lines: {
        create: options.lines.map((l, i) => ({
          sequence_no: i + 1,
          source_doc_type_id: docType,
          source_doc_id: l.budgetId,
          outstanding_amount: l.amount,
          settlement_amount: l.amount,
          settlement_base_amount: l.amount,
          transaction_amount: l.amount,
          transaction_base_amount: l.amount,
          created_by: actor,
          items: l.items
            ? {
                create: l.items.map((it, k) => ({
                  sequence_no: k + 1,
                  sub_ledger_balance_id: it.itemId,
                  amount: it.amount,
                  created_by: actor,
                })),
              }
            : undefined,
        })),
      },
    },
    select: { id: true },
  });
  transactions.push(row.id);
  return row.id;
}

/** Raise a request and remember it, so teardown can find it. */
async function raise(transactionId: number) {
  const result = await raiseFundingRequest(transactionId, actor);
  if (result.ok) requests.push(result.id);
  return result;
}

/** Cash from one induk resource; the layer and kurs are the FX cases' own. */
const viaCash = (cashBankId: number) => ({ cashBankId, layerId: null, rate: null });

/** Raise and confirm in one go — for a position a later case settles. */
async function fundAndConfirm(doc: number, cashBankId: number, rate: number | null = null) {
  const raised = await raise(doc);
  assert.ok(raised.ok, JSON.stringify(raised));
  const result = await confirmFundingRequest(
    raised.ok ? raised.id : 0,
    { cashBankId, layerId: null, rate },
    actor
  );
  assert.equal(result.ok, true, JSON.stringify(result));
}

/** A Partner's open items in one book, oldest first. */
const openItems = (book: number, partnerId: number, currencyId = currency) =>
  prisma.subLedgerBalance.findMany({
    where: { budget_category_id: book, partner_id: partnerId, currency_id: currencyId, status: "Open" },
    orderBy: { id: "asc" },
  });

const bookBalance = async (cashBankId: number) =>
  (
    await prisma.cashBankBalance.findUnique({
      where: { cash_bank_id: cashBankId },
      select: { balance: true },
    })
  )?.balance.toNumber() ?? 0;

const subledgerBalance = async (book: number, partnerId: number) =>
  (
    await prisma.subLedgerBalance.aggregate({
      where: { budget_category_id: book, partner_id: partnerId, currency_id: currency },
      _sum: { balance: true },
    })
  )._sum.balance?.toNumber() ?? 0;

const subledgerEntries = async (docId: number) =>
  prisma.subLedger.count({
    where: { source_doc_type_id: await transactionDocType(), source_doc_id: docId },
  });

const journalsFor = async (docTypeId: number, docId: number) =>
  prisma.accJournal.findMany({
    where: { source_doc_type_id: docTypeId, source_doc_id: docId },
    include: { lines: true },
  });

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
  // The suite's own foreign currencies, never whichever row sits second in the
  // table (§17). Upserted: nothing deletes a currency.
  const fixtureCurrency = async (suffix: string) =>
    (
      await prisma.refCurrency.upsert({
        where: { currency_code: `test.${FIXTURE_PREFIX}F${suffix}` },
        update: { status: "Active" },
        create: {
          currency_code: `test.${FIXTURE_PREFIX}F${suffix}`,
          currency_label: `${FIXTURE_PREFIX}${suffix}`,
          currency_name: `Fixture currency ${suffix}`,
          created_by: actor,
        },
        select: { id: true },
      })
    ).id;
  otherCurrency = await fixtureCurrency("Y");
  usd = await fixtureCurrency("U");

  // Posting journals both Companies, and the anak's side needs the mapping its
  // Purpose resolves to.
  for (const companyId of [induk, anak]) {
    const account = await makeAccount({ companyId, subcategoryLabel: "5.3.1" });
    for (const [label, partnerCategory] of [
      ["Biaya", null],
      ["Hutang", "Stakeholder"],
      ["Piutang", "Stakeholder"],
    ] as const) {
      await makeMapping({
        companyId,
        budgetCategoryLabel: label,
        partnerCategoryLabel: partnerCategory,
        accountId: account,
      });
    }
  }

  // The bridge itself: one account per Company per direction, and nothing else.
  // The position between the Companies is journal, never subject book — a book's
  // subject is a Partner, and the other Company is not one.
  indukArAccount = await makeAccount({ companyId: induk, subcategoryLabel: "1.1.3" });
  anakApAccount = await makeAccount({ companyId: anak, subcategoryLabel: "2.1.1" });

  await systemAccounts.set("induk", "bridge_ar", indukArAccount);
  await systemAccounts.set(
    "induk",
    "bridge_ap",
    await makeAccount({ companyId: induk, subcategoryLabel: "2.1.1" })
  );
  await systemAccounts.set(
    "anak",
    "bridge_ar",
    await makeAccount({ companyId: anak, subcategoryLabel: "1.1.3" })
  );
  await systemAccounts.set("anak", "bridge_ap", anakApAccount);

  // A difference on the funded route is the anak's, on its own account.
  anakFxAccount = await makeAccount({ companyId: anak, subcategoryLabel: "5.3.1" });
  await systemAccounts.set("anak", "fx", anakFxAccount);
});

after(async () => {
  await systemAccounts.restore();

  if (requests.length) {
    await prisma.auditLog.deleteMany({
      where: { entity_key: "fin_funding_request", row_id: { in: requests } },
    });
    await prisma.finFundingRequest.deleteMany({ where: { id: { in: requests } } });
  }
  if (transactions.length) {
    await prisma.auditLog.deleteMany({
      where: {
        entity_key: "fin_cash_bank_transaction",
        row_id: { in: transactions },
      },
    });
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
    await prisma.cashBankPeriod.deleteMany({ where: { cash_bank_id: { in: cashBanks } } });
    await prisma.mCashBank.deleteMany({ where: { id: { in: cashBanks } } });
  }

  await cleanupFiscalYear();
  await cleanupFixtures();
  await disconnect();
});

// --------------------------------------------------------------- the model

describe("the funded route is decided by the Company, not by a setting", () => {
  test("the induk funds itself and the anak does not", async () => {
    assert.equal(await fundingRoute(induk), "self");
    assert.equal(await fundingRoute(anak), "treasury");
  });

  test("both capabilities are catalogue entries", () => {
    for (const code of [
      "REALIZATION_SUBMIT",
      "FUNDING_REQUEST_VIEW",
      "FUNDING_REQUEST_CONFIRM",
    ]) {
      assert.ok(PERMISSION_CODES.includes(code as never), `${code} is missing`);
    }
  });

  test("there is no reject capability, because the induk never rejects", () => {
    const codes: string[] = PERMISSION_CODES;
    assert.ok(!codes.includes("FUNDING_REQUEST_REJECT"));
  });

  test("the bridge is two accounts per Company — four in all", () => {
    // Mapping Account System is one row per Company and key, so two bridge
    // keys are the four accounts: whatever the induk names, the anak names too.
    const bridge = SYSTEM_ACCOUNTS.filter((d) => d.group === "bridge");
    assert.deepEqual(
      bridge.map((d) => d.key),
      ["bridge_ar", "bridge_ap"]
    );
  });
});

// ------------------------------------------------------------- raising one

describe("submitting raises a request and moves nothing", () => {
  test("a Draft becomes Pending, and the request carries the whole amount", async () => {
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 500_000 });
    const doc = await makeAnakDraft({
      purpose: "BYA_OUT",
      lines: [{ budgetId: budget, amount: 500_000 }],
    });

    const result = await raise(doc);
    assert.equal(result.ok, true);
    assert.ok(result.ok === true && /^FR-\d{4,}$/.test(result.funding_request_no));

    const after = await prisma.finCashBankTransaction.findUniqueOrThrow({
      where: { id: doc },
      select: { status: true, accounting_date: true, posted_at: true },
    });
    assert.equal(after.status, "Pending");
    assert.equal(after.accounting_date, null, "a Pending document has no date yet");
    assert.equal(after.posted_at, null);

    const request = await prisma.finFundingRequest.findFirstOrThrow({
      where: { transaction_id: doc },
    });
    assert.equal(request.status, "Open");
    assert.equal(request.request_amount.toNumber(), 500_000);
    assert.equal(
      request.provider_cash_bank_id,
      null,
      "no resource is named until the induk names one"
    );

    // Nothing else moved: no realization, no book entry anywhere.
    const plan = await prisma.budBudget.findUniqueOrThrow({
      where: { id: budget },
      select: { realized_amount: true, status: true },
    });
    assert.equal(plan.realized_amount.toNumber(), 0);
    assert.equal(plan.status, "Open");
    const docType = await transactionDocType();
    assert.equal(
      await prisma.cashBankLedger.count({
        where: {
          source_doc_type_id: docType,
          source_doc_id: doc,
          entry_type: "Transaction",
        },
      }),
      0
    );
    assert.equal(
      await prisma.accJournal.count({
        where: { source_doc_type_id: docType, source_doc_id: doc },
      }),
      0
    );
  });

  test("an induk document cannot be submitted — it posts directly", async () => {
    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const budget = await makeBudget({
      companyId: induk,
      categoryLabel: "Biaya",
      amount: 100_000,
    });
    const docType = await budgetDocTypeId();
    const row = await prisma.finCashBankTransaction.create({
      data: {
        transaction_no: `TSF-IND${Date.now() % 1_000_000}`,
        transaction_type: "Out",
        company_id: induk,
        cash_bank_id: cashBank,
        currency_id: currency,
        transaction_amount: 100_000,
        transaction_base_amount: 100_000,
        status: "Draft",
        created_by: actor,
        lines: {
          create: [
            {
              sequence_no: 1,
              source_doc_type_id: docType,
              source_doc_id: budget,
              outstanding_amount: 100_000,
              settlement_amount: 100_000,
              settlement_base_amount: 100_000,
              transaction_amount: 100_000,
              transaction_base_amount: 100_000,
              created_by: actor,
            },
          ],
        },
      },
      select: { id: true },
    });
    transactions.push(row.id);

    const result = await raise(row.id);
    assert.equal(result.ok, false);
    assert.ok(
      result.ok === false && /Cash & Bank sendiri/.test(result.errors._form)
    );
  });

  test("a document with no Budget is refused", async () => {
    const row = await prisma.finCashBankTransaction.create({
      data: {
        transaction_no: `TSF-EMP${Date.now() % 1_000_000}`,
        transaction_type: "Out",
        company_id: anak,
        currency_id: currency,
        transaction_amount: 0,
        transaction_base_amount: 0,
        status: "Draft",
        created_by: actor,
      },
      select: { id: true },
    });
    transactions.push(row.id);

    const result = await raise(row.id);
    assert.equal(result.ok, false);
    assert.equal(
      (await prisma.finFundingRequest.count({ where: { transaction_id: row.id } })),
      0
    );
  });

  test("a document already waiting cannot raise a second request", async () => {
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 90_000 });
    const doc = await makeAnakDraft({
      purpose: "BYA_OUT",
      lines: [{ budgetId: budget, amount: 90_000 }],
    });
    assert.equal((await raise(doc)).ok, true);

    const again = await raise(doc);
    assert.equal(again.ok, false);
    assert.equal(
      await prisma.finFundingRequest.count({ where: { transaction_id: doc } }),
      1
    );
  });

  test("withdrawing closes the request and the document together", async () => {
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 70_000 });
    const doc = await makeAnakDraft({
      purpose: "BYA_OUT",
      lines: [{ budgetId: budget, amount: 70_000 }],
    });
    await raise(doc);

    const result = await withdrawFundingRequest(doc, actor);
    assert.equal(result.ok, true);

    const after = await prisma.finCashBankTransaction.findUniqueOrThrow({
      where: { id: doc },
      select: { status: true },
    });
    assert.equal(after.status, "Cancelled");
    const request = await prisma.finFundingRequest.findFirstOrThrow({
      where: { transaction_id: doc },
    });
    assert.equal(request.status, "Cancelled");
  });
});

// ------------------------------------------------------- confirming one

describe("confirmation writes what a Realisasi Post writes, for both Companies", () => {
  test("an anak expense across categories: a cash entry and a counter line per Budget", async () => {
    const supplier = await makePartner({ companyId: anak, categoryLabel: "Stakeholder" });
    const cashBank = await makeCashBank({ opening: 2_000_000 });

    // The anak first owes the supplier — a funded receipt raises the Hutang
    // and opens its item, exactly as an induk receipt would.
    const loan = await makeBudget({ categoryLabel: "Hutang", type: "In", partnerId: supplier, amount: 300_000 });
    await fundAndConfirm(
      await makeAnakDraft({ purpose: "HTG_SH_IN", lines: [{ budgetId: loan, amount: 300_000 }] }),
      cashBank
    );
    const [item] = await openItems(await bookId("Hutang"), supplier);
    assert.ok(item, "the receipt opened an item");

    // Then one document settles that item and pays an expense beside it.
    const expense = await makeBudget({ categoryLabel: "Biaya", amount: 100_000 });
    const repay = await makeBudget({ categoryLabel: "Hutang", partnerId: supplier, amount: 300_000 });
    const doc = await makeAnakDraft({
      purpose: "HTG_SH_OUT",
      lines: [
        { budgetId: expense, amount: 100_000 },
        { budgetId: repay, amount: 300_000, items: [{ itemId: item.id, amount: 300_000 }] },
      ],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok, JSON.stringify(raised));
    const result = await confirmFundingRequest(raised.ok ? raised.id : 0, viaCash(cashBank), actor);
    assert.equal(result.ok, true, JSON.stringify(result));

    // 1. one Cash Bank Book entry per Budget, on the induk's resource, each
    //    reading its Budget's own description (§10 rule 54)
    assert.equal(await bookBalance(cashBank), 2_000_000 + 300_000 - 400_000);
    const entries = await prisma.cashBankLedger.findMany({
      where: { source_doc_type_id: await transactionDocType(), source_doc_id: doc },
      orderBy: { id: "asc" },
    });
    assert.equal(entries.length, 2);
    assert.ok(entries.every((e) => e.cash_bank_id === cashBank));
    const descriptions = await prisma.budBudget.findMany({
      where: { id: { in: [expense, repay] } },
      orderBy: { id: "asc" },
      select: { description: true },
    });
    assert.deepEqual(entries.map((e) => e.note), descriptions.map((d) => d.description));

    // 2. the chosen item is settled, by one entry that names it; Biaya keeps no book
    const settled = await prisma.subLedgerBalance.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(settled.balance.toNumber(), 0);
    assert.equal(settled.status, "Cleared");
    assert.equal(await subledgerEntries(doc), 1);

    // 3. the anak's journal: its payable to the induk where the cash line would
    //    be, then one counter line per Budget — on its own account and Partner
    const [anakJournal] = await journalsFor(await transactionDocType(), doc);
    assert.equal(anakJournal.company_id, anak);
    const bridge = anakJournal.lines.find((l) => l.account_id === anakApAccount);
    assert.equal(bridge?.kredit_amount.toNumber(), 400_000);
    const counters = anakJournal.lines.filter((l) => l.debit_amount.toNumber() > 0);
    assert.deepEqual(
      counters.map((l) => [l.debit_amount.toNumber(), l.partner_id]),
      [
        [100_000, null],
        [300_000, supplier],
      ]
    );

    // 4. the induk's journal: its claim on the anak against its cash
    const [indukJournal] = await journalsFor(await fundingRequestDocTypeId(), raised.ok ? raised.id : 0);
    assert.equal(indukJournal.company_id, induk);
    assert.equal(indukJournal.lines.length, 2);
    assert.equal(
      indukJournal.lines.find((l) => l.account_id === indukArAccount)?.debit_amount.toNumber(),
      400_000
    );

    // 5. both plans realized and closed, the document posted, the request shut
    for (const id of [expense, repay]) {
      const plan = await prisma.budBudget.findUniqueOrThrow({ where: { id }, select: { status: true } });
      assert.equal(plan.status, "Closed");
    }
    const request = await prisma.finFundingRequest.findFirstOrThrow({ where: { transaction_id: doc } });
    assert.equal(request.status, "Closed");
    assert.equal(request.provider_cash_bank_id, cashBank);
  });

  test("each journal names its own cause, and names each part once", async () => {
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 120_000 });
    const doc = await makeAnakDraft({
      purpose: "BYA_OUT",
      lines: [{ budgetId: budget, amount: 120_000 }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok);
    const requestNo = raised.ok ? raised.funding_request_no : "";

    const cashBank = await makeCashBank({ opening: 500_000 });
    const result = await confirmFundingRequest(raised.ok ? raised.id : 0, viaCash(cashBank), actor);
    assert.equal(result.ok, true, JSON.stringify(result));

    const { transaction_no } = await prisma.finCashBankTransaction.findUniqueOrThrow({
      where: { id: doc },
      select: { transaction_no: true },
    });
    const label = realizationOf("Out").title;

    // The anak performed an ordinary realization that happened to be funded,
    // so its journal names its own document and nothing else.
    const [anakJournal] = await journalsFor(await transactionDocType(), doc);
    assert.equal(anakJournal.description, `${transaction_no} — ${label}`);

    // The induk acted on a Funding Request, so its journal names the request,
    // the realization it funded, and what that was for — §10 rule 60.
    const [indukJournal] = await journalsFor(await fundingRequestDocTypeId(), raised.ok ? raised.id : 0);
    assert.equal(indukJournal.description, `${requestNo} — ${transaction_no} — ${label}`);

    // Composed once: a description accreted across two modules used to name
    // the purpose twice, and only counting catches it.
    for (const journal of [anakJournal, indukJournal]) {
      assert.equal(journal.description!.split(label).length - 1, 1);
      for (const line of journal.lines) {
        assert.ok(
          (line.description ?? "").split(label).length - 1 <= 1,
          `${journal.journal_no}: a line names the purpose at most once`
        );
      }
    }
  });

  test("an anak receipt mirrors it: induk cash in, induk Hutang, anak Piutang", async () => {
    const debtor = await makePartner({ companyId: anak, categoryLabel: "Stakeholder" });
    const cashBank = await makeCashBank({ opening: 500_000 });

    // Lent out first, through a funded payment: the Piutang opens an item.
    const lend = await makeBudget({ categoryLabel: "Piutang", partnerId: debtor, amount: 200_000 });
    await fundAndConfirm(
      await makeAnakDraft({ purpose: "PTG_SH_OUT", lines: [{ budgetId: lend, amount: 200_000 }] }),
      cashBank
    );
    const [item] = await openItems(await bookId("Piutang"), debtor);
    assert.ok(item);

    const budget = await makeBudget({ categoryLabel: "Piutang", type: "In", partnerId: debtor, amount: 200_000 });
    const doc = await makeAnakDraft({
      purpose: "PTG_SH_IN",
      lines: [{ budgetId: budget, amount: 200_000, items: [{ itemId: item.id, amount: 200_000 }] }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok, JSON.stringify(raised));
    const result = await confirmFundingRequest(raised.ok ? raised.id : 0, viaCash(cashBank), actor);
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.equal(await bookBalance(cashBank), 500_000, "out and back in again");
    assert.equal(await subledgerBalance(await bookId("Piutang"), debtor), 0, "repaid in full");

    // The mirror: money taken in on the anak's behalf is owed to the anak.
    const [indukJournal] = await journalsFor(await fundingRequestDocTypeId(), raised.ok ? raised.id : 0);
    const [anakJournal] = await journalsFor(await transactionDocType(), doc);
    assert.ok(indukJournal.lines.some((l) => l.kredit_amount.toNumber() === 200_000));
    assert.ok(anakJournal.lines.some((l) => l.debit_amount.toNumber() === 200_000));
  });

  test("a raising line records the item it opened, as on the direct route", async () => {
    const supplier = await makePartner({ companyId: anak, categoryLabel: "Stakeholder" });
    const budget = await makeBudget({ categoryLabel: "Hutang", type: "In", partnerId: supplier, amount: 80_000 });
    const doc = await makeAnakDraft({ purpose: "HTG_SH_IN", lines: [{ budgetId: budget, amount: 80_000 }] });
    await fundAndConfirm(doc, await makeCashBank({ opening: 0 }));

    const line = await prisma.finCashBankTransactionLine.findFirstOrThrow({
      where: { transaction_id: doc },
      select: { opened_item_id: true },
    });
    const [item] = await openItems(await bookId("Hutang"), supplier);
    assert.equal(line.opened_item_id, item.id);
  });

  test("a category with no Partner writes no subject book at all", async () => {
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 40_000 });
    const doc = await makeAnakDraft({
      purpose: "BYA_OUT",
      lines: [{ budgetId: budget, amount: 40_000 }],
    });
    await fundAndConfirm(doc, await makeCashBank({ opening: 100_000 }));
    assert.equal(await subledgerEntries(doc), 0);
  });

  test("the preview is the two journals the confirmation writes, and writes nothing", async () => {
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 75_000 });
    const doc = await makeAnakDraft({ purpose: "BYA_OUT", lines: [{ budgetId: budget, amount: 75_000 }] });
    const raised = await raise(doc);
    assert.ok(raised.ok);
    const requestId = raised.ok ? raised.id : 0;
    const cashBank = await makeCashBank({ opening: 100_000 });

    const preview = await previewFundingConfirmation(requestId, viaCash(cashBank));
    assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.equal(await bookBalance(cashBank), 100_000, "a preview moves nothing");
    assert.equal((await journalsFor(await transactionDocType(), doc)).length, 0);

    const result = await confirmFundingRequest(requestId, viaCash(cashBank), actor);
    assert.equal(result.ok, true, JSON.stringify(result));
    const written = [
      ...(await journalsFor(await fundingRequestDocTypeId(), requestId)),
      ...(await journalsFor(await transactionDocType(), doc)),
    ];
    assert.deepEqual(
      preview.ok ? preview.journals.map((j) => j.lines.map((l) => [l.debit, l.credit])) : [],
      written.map((j) =>
        j.lines
          .sort((a, b) => a.sequence_no - b.sequence_no)
          .map((l) => [l.debit_amount.toNumber(), l.kredit_amount.toNumber()])
      )
    );
  });
});

describe("open items are chosen on the anak's draft", () => {
  test("a line lowering a position with no item is refused at Ajukan Dana", async () => {
    const supplier = await makePartner({ companyId: anak, categoryLabel: "Stakeholder" });
    const budget = await makeBudget({ categoryLabel: "Hutang", partnerId: supplier, amount: 50_000 });
    const doc = await makeAnakDraft({ purpose: "HTG_SH_OUT", lines: [{ budgetId: budget, amount: 50_000 }] });

    const result = await raise(doc);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.errors._form : "", /open item/);
    const after = await prisma.finCashBankTransaction.findUniqueOrThrow({
      where: { id: doc },
      select: { status: true },
    });
    assert.equal(after.status, "Draft", "still the anak's to fix");
  });

  test("an item settled by another document since the request refuses the confirmation", async () => {
    const supplier = await makePartner({ companyId: anak, categoryLabel: "Stakeholder" });
    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const loan = await makeBudget({ categoryLabel: "Hutang", type: "In", partnerId: supplier, amount: 90_000 });
    await fundAndConfirm(
      await makeAnakDraft({ purpose: "HTG_SH_IN", lines: [{ budgetId: loan, amount: 90_000 }] }),
      cashBank
    );
    const [item] = await openItems(await bookId("Hutang"), supplier);

    // Two requests, each settling the whole item. The first is confirmed.
    const drafts = [];
    for (let i = 0; i < 2; i++) {
      const budget = await makeBudget({ categoryLabel: "Hutang", partnerId: supplier, amount: 90_000 });
      const doc = await makeAnakDraft({
        purpose: "HTG_SH_OUT",
        lines: [{ budgetId: budget, amount: 90_000, items: [{ itemId: item.id, amount: 90_000 }] }],
      });
      const raised = await raise(doc);
      assert.ok(raised.ok, JSON.stringify(raised));
      drafts.push(raised.ok ? raised.id : 0);
    }
    const first = await confirmFundingRequest(drafts[0], viaCash(cashBank), actor);
    assert.equal(first.ok, true, JSON.stringify(first));

    const balance = await bookBalance(cashBank);
    const second = await confirmFundingRequest(drafts[1], viaCash(cashBank), actor);
    assert.equal(second.ok, false);
    assert.match(second.ok === false ? second.errors._form : "", new RegExp(item.item_no));
    assert.equal(await bookBalance(cashBank), balance, "nothing moved");
  });
});

describe("foreign currency on the funded route", () => {
  test("a USD request paid from a USD layer: both bridges carry what the layer gave up", async () => {
    const usdBank = await makeCashBank({ currencyId: usd, opening: 10_000, rate: 15_000 });
    const layer = await prisma.cashBankLayer.findFirstOrThrow({
      where: { cash_bank_id: usdBank, status: "Open" },
      select: { id: true },
    });
    const budget = await makeBudget({ categoryLabel: "Biaya", currencyId: usd, amount: 1_000 });
    const doc = await makeAnakDraft({
      purpose: "BYA_OUT",
      currencyId: usd,
      lines: [{ budgetId: budget, amount: 1_000 }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok, JSON.stringify(raised));
    const requestId = raised.ok ? raised.id : 0;

    const result = await confirmFundingRequest(
      requestId,
      { cashBankId: usdBank, layerId: layer.id, rate: null },
      actor
    );
    assert.equal(result.ok, true, JSON.stringify(result));

    const [entry] = await prisma.cashBankLedger.findMany({
      where: { source_doc_type_id: await transactionDocType(), source_doc_id: doc },
    });
    assert.equal(entry.base_movement.toNumber(), -15_000_000);

    const [indukJournal] = await journalsFor(await fundingRequestDocTypeId(), requestId);
    const [anakJournal] = await journalsFor(await transactionDocType(), doc);
    const indukBridge = indukJournal.lines.find((l) => l.account_id === indukArAccount)!;
    const anakBridge = anakJournal.lines.find((l) => l.account_id === anakApAccount)!;
    for (const line of [indukBridge, anakBridge]) {
      assert.equal(line.currency_id, usd, "the bridge is in the currency the induk moved");
      assert.equal(line.trx_amount.toNumber(), 1_000);
    }
    assert.equal(indukBridge.debit_amount.toNumber(), 15_000_000);
    assert.equal(anakBridge.kredit_amount.toNumber(), 15_000_000);
    assert.equal(anakJournal.lines.length, 2, "an expense raises nothing, so no Selisih Kurs");

    const request = await prisma.finFundingRequest.findUniqueOrThrow({ where: { id: requestId } });
    assert.equal(request.provider_cash_bank_layer_id, layer.id);
  });

  test("a USD Hutang settled from rupiah at a new kurs: the difference is the anak's", async () => {
    const supplier = await makePartner({ companyId: anak, categoryLabel: "Stakeholder" });
    const idrBank = await makeCashBank({ opening: 100_000_000 });

    // Borrowed at 15.000 — the rupiah the induk received is the item's base.
    const loan = await makeBudget({ categoryLabel: "Hutang", type: "In", currencyId: usd, partnerId: supplier, amount: 1_000 });
    await fundAndConfirm(
      await makeAnakDraft({ purpose: "HTG_SH_IN", currencyId: usd, lines: [{ budgetId: loan, amount: 1_000 }] }),
      idrBank,
      15_000
    );
    const [item] = await openItems(await bookId("Hutang"), supplier, usd);
    assert.equal(item.base_balance.toNumber(), 15_000_000);

    // Repaid at 16.000: the cash cost a million more than the item released.
    const repay = await makeBudget({ categoryLabel: "Hutang", currencyId: usd, partnerId: supplier, amount: 1_000 });
    const doc = await makeAnakDraft({
      purpose: "HTG_SH_OUT",
      currencyId: usd,
      lines: [{ budgetId: repay, amount: 1_000, items: [{ itemId: item.id, amount: 1_000 }] }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok, JSON.stringify(raised));
    const requestId = raised.ok ? raised.id : 0;
    const result = await confirmFundingRequest(
      requestId,
      { cashBankId: idrBank, layerId: null, rate: 16_000 },
      actor
    );
    assert.equal(result.ok, true, JSON.stringify(result));

    const [anakJournal] = await journalsFor(await transactionDocType(), doc);
    const fx = anakJournal.lines.filter((l) => l.account_id === anakFxAccount);
    assert.equal(fx.length, 1, "one Selisih Kurs line, for the one item settled");
    assert.equal(fx[0].debit_amount.toNumber(), 1_000_000, "a loss, on the debit side");
    assert.equal(
      anakJournal.lines.find((l) => l.account_id === anakApAccount)?.kredit_amount.toNumber(),
      16_000_000,
      "the anak owes the induk what the cash actually cost"
    );

    const [indukJournal] = await journalsFor(await fundingRequestDocTypeId(), requestId);
    assert.equal(indukJournal.lines.length, 2, "the induk recognises no difference");
    assert.equal(
      indukJournal.lines.find((l) => l.account_id === indukArAccount)?.debit_amount.toNumber(),
      16_000_000
    );
  });

  test("a foreign anak draft states its settlement side, and leaves the cash to the induk", async () => {
    const supplier = await makePartner({ companyId: anak, categoryLabel: "Stakeholder" });
    const idrBank = await makeCashBank({ opening: 100_000_000 });
    const loan = await makeBudget({ categoryLabel: "Hutang", type: "In", currencyId: usd, partnerId: supplier, amount: 1_000 });
    await fundAndConfirm(
      await makeAnakDraft({ purpose: "HTG_SH_IN", currencyId: usd, lines: [{ budgetId: loan, amount: 1_000 }] }),
      idrBank,
      15_000
    );
    const [item] = await openItems(await bookId("Hutang"), supplier, usd);

    // One line settles the item raised at 15.000; one opens a Piutang, whose
    // base only the induk's cash can originate.
    const repay = await makeBudget({ categoryLabel: "Hutang", currencyId: usd, partnerId: supplier, amount: 1_000 });
    const lend = await makeBudget({ categoryLabel: "Piutang", currencyId: usd, partnerId: supplier, amount: 500 });
    const doc = await makeAnakDraft({
      purpose: "HTG_SH_OUT",
      currencyId: usd,
      lines: [
        { budgetId: repay, amount: 1_000, items: [{ itemId: item.id, amount: 1_000 }] },
        { budgetId: lend, amount: 500 },
      ],
    });
    await prisma.$transaction((tx) => valueDraft(tx, doc, actor));

    const read = () =>
      prisma.finCashBankTransaction.findUniqueOrThrow({
        where: { id: doc },
        include: { lines: { orderBy: { sequence_no: "asc" }, include: { items: true } } },
      });
    const drafted = await read();
    assert.equal(drafted.exchange_rate.toNumber(), 0, "no kurs until the induk states one");
    assert.equal(drafted.transaction_base_amount.toNumber(), 0);
    const [settles, opens] = drafted.lines;
    assert.equal(settles.settlement_base_amount.toNumber(), 15_000_000, "the item's own kurs");
    assert.equal(settles.settlement_exchange_rate?.toNumber(), 15_000);
    assert.equal(settles.transaction_base_amount.toNumber(), 0);
    assert.equal(settles.fx_difference.toNumber(), 0);
    assert.deepEqual(
      settles.items.map((it) => [it.settlement_base_amount.toNumber(), it.transaction_base_amount.toNumber()]),
      [[15_000_000, 0]]
    );
    assert.equal(opens.settlement_base_amount.toNumber(), 0, "the cash originates it");
    assert.equal(opens.settlement_exchange_rate, null);

    await fundAndConfirm(doc, idrBank, 16_000);
    const posted = await read();
    assert.equal(posted.exchange_rate.toNumber(), 16_000);
    assert.equal(posted.lines[0].settlement_base_amount.toNumber(), 15_000_000);
    assert.equal(posted.lines[0].transaction_base_amount.toNumber(), 16_000_000);
    assert.equal(posted.lines[0].fx_difference.toNumber(), -1_000_000);
    assert.equal(posted.lines[1].settlement_base_amount.toNumber(), 8_000_000);
  });

  test("a rupiah anak draft is drafted the same way, at a kurs of 1", async () => {
    const supplier = await makePartner({ companyId: anak, categoryLabel: "Stakeholder" });
    const idrBank = await makeCashBank({ opening: 100_000_000 });
    const loan = await makeBudget({ categoryLabel: "Hutang", type: "In", partnerId: supplier, amount: 400_000 });
    await fundAndConfirm(
      await makeAnakDraft({ purpose: "HTG_SH_IN", lines: [{ budgetId: loan, amount: 400_000 }] }),
      idrBank
    );
    const [item] = await openItems(await bookId("Hutang"), supplier);

    const repay = await makeBudget({ categoryLabel: "Hutang", partnerId: supplier, amount: 400_000 });
    const expense = await makeBudget({ categoryLabel: "Biaya", amount: 250_000 });
    const doc = await makeAnakDraft({
      purpose: "HTG_SH_OUT",
      lines: [
        { budgetId: repay, amount: 400_000, items: [{ itemId: item.id, amount: 400_000 }] },
        { budgetId: expense, amount: 250_000 },
      ],
    });
    await prisma.$transaction((tx) => valueDraft(tx, doc, actor));
    const drafted = await prisma.finCashBankTransaction.findUniqueOrThrow({
      where: { id: doc },
      include: { lines: { orderBy: { sequence_no: "asc" }, include: { items: true } } },
    });
    assert.equal(drafted.exchange_rate.toNumber(), 0, "the cash side waits, as for a foreign draft");
    assert.equal(drafted.transaction_base_amount.toNumber(), 0);
    const [settles, spends] = drafted.lines;
    assert.equal(settles.settlement_base_amount.toNumber(), 400_000);
    assert.equal(settles.settlement_exchange_rate?.toNumber(), 1);
    assert.equal(settles.transaction_base_amount.toNumber(), 0);
    assert.deepEqual(
      settles.items.map((it) => [it.settlement_base_amount.toNumber(), it.transaction_base_amount.toNumber()]),
      [[400_000, 0]]
    );
    assert.equal(spends.settlement_base_amount.toNumber(), 0, "the cash originates it");
    assert.equal(spends.settlement_exchange_rate, null);
  });

  test("a layer of another resource is refused", async () => {
    const usdBank = await makeCashBank({ currencyId: usd, opening: 500, rate: 15_000 });
    const otherBank = await makeCashBank({ currencyId: usd, opening: 500, rate: 15_500 });
    const stranger = await prisma.cashBankLayer.findFirstOrThrow({
      where: { cash_bank_id: otherBank },
      select: { id: true },
    });
    const budget = await makeBudget({ categoryLabel: "Biaya", currencyId: usd, amount: 100 });
    const raised = await raise(
      await makeAnakDraft({ purpose: "BYA_OUT", currencyId: usd, lines: [{ budgetId: budget, amount: 100 }] })
    );
    assert.ok(raised.ok);
    const result = await confirmFundingRequest(
      raised.ok ? raised.id : 0,
      { cashBankId: usdBank, layerId: stranger.id, rate: null },
      actor
    );
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors.cash_bank_layer_id);
  });
});

// ------------------------------------------------------------- refusals

describe("a refused confirmation leaves nothing behind", () => {
  test("a resource in another currency is refused", async () => {
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 60_000 });
    const doc = await makeAnakDraft({
      purpose: "BYA_OUT",
      lines: [{ budgetId: budget, amount: 60_000 }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok);

    const foreign = await makeCashBank({
      currencyId: otherCurrency,
      opening: 900_000,
    });
    const result = await confirmFundingRequest(raised.ok ? raised.id : 0, viaCash(foreign), actor);
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors.cash_bank_id);

    assert.equal(await bookBalance(foreign), 900_000);
    assert.equal(
      await prisma.finFundingRequest.findFirstOrThrow({
        where: { id: raised.ok ? raised.id : 0 },
        select: { status: true },
      }).then((r) => r.status),
      "Open"
    );
  });

  test("an anak resource cannot answer a request", async () => {
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 30_000 });
    const doc = await makeAnakDraft({
      purpose: "BYA_OUT",
      lines: [{ budgetId: budget, amount: 30_000 }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok);

    // The anak is not supposed to have one at all; if a row exists anyway, the
    // money must still leave an induk resource.
    const stray = await makeCashBank({ companyId: anak, opening: 500_000 });
    const result = await confirmFundingRequest(raised.ok ? raised.id : 0, viaCash(stray), actor);
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors.cash_bank_id);
    assert.equal(await bookBalance(stray), 500_000);
  });

  test("a Budget closed since the request refuses the whole confirmation", async () => {
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 80_000 });
    const doc = await makeAnakDraft({
      purpose: "BYA_OUT",
      lines: [{ budgetId: budget, amount: 80_000 }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok);

    await prisma.budBudget.update({
      where: { id: budget },
      data: { status: "Closed" },
    });

    const cashBank = await makeCashBank({ opening: 400_000 });
    const result = await confirmFundingRequest(raised.ok ? raised.id : 0, viaCash(cashBank), actor);
    assert.equal(result.ok, false);
    assert.equal(await bookBalance(cashBank), 400_000);
    assert.equal(await subledgerEntries(doc), 0);
  });

  test("a request already confirmed cannot be confirmed twice", async () => {
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 20_000 });
    const doc = await makeAnakDraft({
      purpose: "BYA_OUT",
      lines: [{ budgetId: budget, amount: 20_000 }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok);

    const cashBank = await makeCashBank({ opening: 100_000 });
    const first = await confirmFundingRequest(raised.ok ? raised.id : 0, viaCash(cashBank), actor);
    assert.equal(first.ok, true, JSON.stringify(first));

    const second = await confirmFundingRequest(raised.ok ? raised.id : 0, viaCash(cashBank), actor);
    assert.equal(second.ok, false);
    assert.equal(
      await bookBalance(cashBank),
      80_000,
      "the second attempt must not move the balance again"
    );
  });

  test("an unfinished bridge refuses, and names what is missing", async () => {
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 10_000 });
    const doc = await makeAnakDraft({
      purpose: "BYA_OUT",
      lines: [{ budgetId: budget, amount: 10_000 }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok);

    const held = await setSystemAccount("induk", "bridge_ar", null);
    try {
      const bridge = await intercompanyBridge();
      assert.equal(bridge.ok, false);
      assert.ok(
        bridge.ok === false &&
          bridge.missing.includes("Account Piutang ke Anak")
      );

      const cashBank = await makeCashBank({ opening: 100_000 });
      const result = await confirmFundingRequest(raised.ok ? raised.id : 0, viaCash(cashBank), actor);
      assert.equal(result.ok, false);
      assert.ok(
        result.ok === false && /Account Piutang ke Anak/.test(result.errors._form)
      );
      assert.equal(await bookBalance(cashBank), 100_000);
    } finally {
      await setSystemAccount("induk", "bridge_ar", held);
    }
  });

  test("a bridge account of the wrong Company is never stored", async () => {
    const anakAccount = await makeAccount({
      companyId: anak,
      subcategoryLabel: "1.1.3",
    });
    const refusal = await checkSystemAccountValue(induk, "bridge_ar", anakAccount);
    assert.ok(refusal, "an induk setting must refuse an anak account");
  });
});

/** The `sys_doc_type` row a Cash Bank Transaction is referenced by. */
async function transactionDocType(): Promise<number> {
  const row = await prisma.sysDocType.findFirstOrThrow({
    where: { doc_table: "fin_cash_bank_transaction" },
    select: { id: true },
  });
  return row.id;
}

// ------------------------------------------------------------- the period lock

describe("a confirmation is refused outside an open period", () => {
  test("either Company having closed the year refuses it, and the refusal says which", async () => {
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 50_000 });
    const doc = await makeAnakDraft({
      purpose: "BYA_OUT",
      lines: [{ budgetId: budget, amount: 50_000 }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok);
    const requestId = raised.ok ? raised.id : 0;
    const cashBank = await makeCashBank({ opening: 400_000 });

    // One confirmation writes both Companies' books, so both are asked. The
    // anak is the interesting half: its year is closed, the induk's is not,
    // and the induk is the one holding the cash.
    for (const companyId of [anak, induk]) {
      const reopen = await closeYearFor(fiscalYear, companyId);
      try {
        const refused = await confirmFundingRequest(requestId, viaCash(cashBank), actor);
        assert.equal(refused.ok, false, "a closed year on either side refuses");
        assert.match(
          refused.ok === false ? refused.errors._form ?? "" : "",
          /menutup/
        );

        assert.equal(await bookBalance(cashBank), 400_000, "no cash moved");
        assert.equal(await subledgerEntries(doc), 0);
        assert.equal(
          (
            await prisma.finFundingRequest.findUniqueOrThrow({
              where: { id: requestId },
              select: { status: true },
            })
          ).status,
          "Open",
          "and the request is still waiting to be answered"
        );
      } finally {
        await reopen();
      }
    }

    const confirmed = await confirmFundingRequest(requestId, viaCash(cashBank), actor);
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  });
});
