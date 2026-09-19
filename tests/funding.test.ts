import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { budgetDocTypeId, fundingRoute } from "../src/lib/siba/finance";
import {
  confirmFundingRequest,
  fundingRequestDocTypeId,
  raiseFundingRequest,
  withdrawFundingRequest,
} from "../src/lib/siba/funding";
import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import { purposeByKey } from "../src/lib/siba/purposes";
import { openCashBankBook } from "../src/lib/siba/cash-bank";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import { MODULES } from "../src/lib/siba/nav";
import {
  SYSTEM_DEFAULTS,
  type SystemDefaultDef,
  type SystemDefaultKey,
} from "../src/lib/siba/system-defaults";
import {
  intercompanyBridge,
  systemDefaults,
  writeSystemDefaults,
} from "../src/lib/siba/system-settings";
import {
  FIXTURE_PREFIX,
  bookKey,
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
let currency = 0;
let otherCurrency = 0;

/** The bridge accounts, as this suite sets them up. */
let indukArAccount = 0;
let anakApAccount = 0;

const cashBanks: number[] = [];
const budgets: number[] = [];
const transactions: number[] = [];
const requests: number[] = [];

let savedDefaults: Record<string, string | null> = {};

async function makeCashBank(options: {
  companyId?: number;
  currencyId?: number;
  opening?: number;
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
    rate: 1,
    date: today,
    actorId: actor,
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
  lines: { budgetId: number; amount: number }[];
}): Promise<number> {
  const purpose = (await purposeByKey(options.purpose))!;
  const docType = await budgetDocTypeId();
  const total = options.lines.reduce((t, l) => t + l.amount, 0);

  const row = await prisma.finCashBankTransaction.create({
    data: {
      transaction_no: `TSF-CBT${transactions.length + 1}${Date.now() % 100000}`,
      transaction_type: purpose.direction,
      company_id: anak,
      purpose: purpose.key,
      cash_bank_id: null,
      currency_id: options.currencyId ?? currency,
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
          outstanding_amount: l.amount,
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

/** Raise a request and remember it, so teardown can find it. */
async function raise(transactionId: number) {
  const result = await raiseFundingRequest(transactionId, actor);
  if (result.ok) requests.push(result.id);
  return result;
}

const bookBalance = async (cashBankId: number) =>
  (
    await prisma.cashBankBalance.findUnique({
      where: { cash_bank_id: cashBankId },
      select: { balance: true },
    })
  )?.balance.toNumber() ?? 0;

const subledgerBalance = async (book: string, partnerId: number) =>
  (
    await prisma.subLedgerBalance.findUnique({
      where: {
        book_partner_id_currency_id: {
          book,
          partner_id: partnerId,
          currency_id: currency,
        },
      },
      select: { balance: true },
    })
  )?.balance.toNumber() ?? 0;

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
  induk = await parentCompanyId();
  anak = await childCompanyId();
  actor = await systemUserId();

  const currencies = await prisma.refCurrency.findMany({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  currency = currencies[0].id;
  if (currencies.length > 1) {
    otherCurrency = currencies[1].id;
  } else {
    const made = await prisma.refCurrency.create({
      data: {
        currency_code: `test.${FIXTURE_PREFIX}FCUR`,
        currency_label: `${FIXTURE_PREFIX}Y`,
        currency_name: "Fixture currency",
        created_by: actor,
      },
      select: { id: true },
    });
    otherCurrency = made.id;
  }

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

  savedDefaults = { ...(await systemDefaults()) };

  await writeSystemDefaults(
    {
      induk_bridge_ar_account: String(indukArAccount),
      induk_bridge_ap_account: String(
        await makeAccount({ companyId: induk, subcategoryLabel: "2.1.1" })
      ),
      anak_bridge_ar_account: String(
        await makeAccount({ companyId: anak, subcategoryLabel: "1.1.3" })
      ),
      anak_bridge_ap_account: String(anakApAccount),
    },
    actor
  );
});

after(async () => {
  await writeSystemDefaults(
    savedDefaults as Partial<Record<SystemDefaultKey, string | null>>,
    actor
  );

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
    await prisma.cashBankLedger.deleteMany({
      where: { cash_bank_id: { in: cashBanks } },
    });
    await prisma.cashBankBalance.deleteMany({
      where: { cash_bank_id: { in: cashBanks } },
    });
    await prisma.mCashBank.deleteMany({ where: { id: { in: cashBanks } } });
  }

  await cleanupFixtures();
  await prisma.refCurrency.deleteMany({
    where: { currency_label: { startsWith: FIXTURE_PREFIX } },
  });
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
      "CASH_BANK_TRANSACTION_SUBMIT",
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

  test("the menu entry has a route, and asks for the view permission", () => {
    const leaf = MODULES.find((m) => m.key === "finance")
      ?.groups?.flatMap((g) => g.entities)
      .find((e) => e.slug === "funding-request");
    assert.ok(leaf, "Funding Request must be reachable from the Finance menu");
    assert.equal(leaf!.permission, "FUNDING_REQUEST_VIEW");
  });

  test("the bridge is four settings, two per Company, all accounts", () => {
    // Filtered by group, not merely by "has a Company": the FX difference
    // accounts are Company-scoped too, and counting every Company-scoped
    // setting would make this assertion drift every time one is added.
    const bridge = (SYSTEM_DEFAULTS as readonly SystemDefaultDef[]).filter(
      (d) => d.group === "bridge_induk" || d.group === "bridge_anak"
    );
    assert.equal(bridge.length, 4);
    assert.equal(bridge.filter((d) => d.company === "induk").length, 2);
    assert.equal(bridge.filter((d) => d.company === "anak").length, 2);
    assert.ok(
      bridge.every((d) => d.ref === "acc_account"),
      "the intercompany position is journal, so the bridge names accounts only"
    );
  });

  test("every Company-scoped setting names an account of that Company", () => {
    const scoped = (SYSTEM_DEFAULTS as readonly SystemDefaultDef[]).filter(
      (d) => d.company
    );
    assert.ok(
      scoped.every((d) => d.ref === "acc_account"),
      "a setting scoped to a Company points into that Company's chart"
    );
    assert.deepEqual(
      scoped.filter((d) => d.company === "induk").length,
      scoped.filter((d) => d.company === "anak").length,
      "whatever the induk names, the anak names too — the two Companies keep " +
        "their own charts and neither posts into the other's"
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
      select: { status: true, document_date: true, posting_date: true },
    });
    assert.equal(after.status, "Pending");
    assert.equal(after.document_date, null, "a Pending document has no date yet");
    assert.equal(after.posting_date, null);

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
        purpose: "BYA_OUT",
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
        purpose: "BYA_OUT",
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

describe("confirmation posts both Companies, at once", () => {
  test("an anak expense: induk cash out, and a journal each carrying the position", async () => {
    const supplier = await makePartner({
      companyId: anak,
      categoryLabel: "Stakeholder",
    });
    const budget = await makeBudget({
      categoryLabel: "Hutang",
      partnerId: supplier,
      amount: 300_000,
    });
    const doc = await makeAnakDraft({
      purpose: "HTG_SH_OUT",
      partnerId: supplier,
      lines: [{ budgetId: budget, amount: 300_000 }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok);

    const cashBank = await makeCashBank({ opening: 1_000_000 });
    const result = await confirmFundingRequest(
      raised.ok ? raised.id : 0,
      cashBank,
      actor
    );
    assert.equal(result.ok, true, JSON.stringify(result));

    // 1. the induk's cash actually moved, and only the induk's
    assert.equal(await bookBalance(cashBank), 700_000);
    const entries = await prisma.cashBankLedger.findMany({
      where: {
        source_doc_type_id: await transactionDocType(),
        source_doc_id: doc,
        entry_type: "Transaction",
      },
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].cash_bank_id, cashBank);
    assert.equal(entries[0].direction, "Out");

    // 2. the anak's own supplier position, and *only* that: the two Companies'
    //    positions against each other are accounts, not subjects, so the
    //    confirmation writes exactly one subject-book entry.
    assert.equal(
      await subledgerBalance(await bookKey("Hutang"), supplier),
      -300_000,
      "paying a supplier lowers what the anak owes it"
    );
    assert.equal(
      await subledgerEntries(doc),
      1,
      "no subject book entry is written for the intercompany leg"
    );

    // 3. one journal each, each balanced, each pointing at its own Company's
    //    document — neither is the source of the other (concept doc §31)
    const anakJournals = await journalsFor(await transactionDocType(), doc);
    assert.equal(anakJournals.length, 1);
    assert.equal(anakJournals[0].company_id, anak);

    const indukJournals = await journalsFor(
      await fundingRequestDocTypeId(),
      raised.ok ? raised.id : 0
    );
    assert.equal(indukJournals.length, 1);
    assert.equal(indukJournals[0].company_id, induk);

    for (const journal of [...anakJournals, ...indukJournals]) {
      const debit = journal.lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0);
      const credit = journal.lines.reduce(
        (t, l) => t + l.kredit_amount.toNumber(),
        0
      );
      assert.equal(debit, credit, `${journal.journal_no} must balance`);
      assert.equal(debit, 300_000);
    }

    // 3b. the position itself: the induk's claim is debited, the anak's
    //     obligation credited, and the two agree — which is the whole of what
    //     concept doc §38 reconciles, read from the General Ledger.
    const indukClaim = indukJournals[0].lines.find(
      (l) => l.account_id === indukArAccount
    );
    const anakObligation = anakJournals[0].lines.find(
      (l) => l.account_id === anakApAccount
    );
    assert.ok(indukClaim, "the induk journals its receivable from the anak");
    assert.ok(anakObligation, "the anak journals its payable to the induk");
    assert.equal(indukClaim!.debit_amount.toNumber(), 300_000);
    assert.equal(anakObligation!.kredit_amount.toNumber(), 300_000);

    // 4. the plan is realized and closed, the document posted, the request shut
    const plan = await prisma.budBudget.findUniqueOrThrow({
      where: { id: budget },
      select: { realized_amount: true, status: true },
    });
    assert.equal(plan.realized_amount.toNumber(), 300_000);
    assert.equal(plan.status, "Closed");

    const after = await prisma.finCashBankTransaction.findUniqueOrThrow({
      where: { id: doc },
      select: { status: true, document_date: true, posting_date: true },
    });
    assert.equal(after.status, "Posted");
    assert.ok(after.document_date);
    assert.ok(after.posting_date);

    const request = await prisma.finFundingRequest.findFirstOrThrow({
      where: { transaction_id: doc },
    });
    assert.equal(request.status, "Closed");
    assert.equal(request.provider_cash_bank_id, cashBank);
    assert.ok(request.confirmed_at);
  });

  test("each journal names its own cause, and names each part once", async () => {
    const supplier = await makePartner({
      companyId: anak,
      categoryLabel: "Stakeholder",
    });
    const budget = await makeBudget({
      categoryLabel: "Hutang",
      partnerId: supplier,
      amount: 120_000,
    });
    const doc = await makeAnakDraft({
      purpose: "HTG_SH_OUT",
      partnerId: supplier,
      lines: [{ budgetId: budget, amount: 120_000 }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok);
    const requestNo = raised.ok ? raised.funding_request_no : "";

    const cashBank = await makeCashBank({ opening: 500_000 });
    const result = await confirmFundingRequest(
      raised.ok ? raised.id : 0,
      cashBank,
      actor
    );
    assert.equal(result.ok, true, JSON.stringify(result));

    const { transaction_no } = await prisma.finCashBankTransaction.findUniqueOrThrow({
      where: { id: doc },
      select: { transaction_no: true },
    });
    const label = (await purposeByKey("HTG_SH_OUT"))!.label;

    // The anak performed an ordinary realization that happened to be funded,
    // so its journal names its own document and nothing else.
    const [anakJournal] = await journalsFor(await transactionDocType(), doc);
    assert.equal(anakJournal.description, `${transaction_no} — ${label}`);

    // The induk acted on a Funding Request, so its journal names the request,
    // the realization it funded, and what that was for — §10 rule 60.
    const [indukJournal] = await journalsFor(
      await fundingRequestDocTypeId(),
      raised.ok ? raised.id : 0
    );
    assert.equal(
      indukJournal.description,
      `${requestNo} — ${transaction_no} — ${label}`
    );

    // The property that actually broke, stated on its own: the description was
    // accreted across two modules — Funding composed a phrase ending in the
    // label, Finance appended the label again — so it read the purpose twice on
    // the Journal register and in both ledger reports. Nothing errored, and the
    // suite passed. Counting is what catches it.
    assert.equal(
      indukJournal.description!.split(label).length - 1,
      1,
      "the purpose is named once, not once per module that composed the string"
    );

    // And every line of both, for the same reason.
    for (const journal of [anakJournal, indukJournal]) {
      for (const line of journal.lines) {
        assert.equal(
          (line.description ?? "").split(label).length - 1 <= 1,
          true,
          `${journal.journal_no}: a line names the purpose at most once`
        );
      }
    }
  });

  test("an anak receipt mirrors it: induk cash in, induk Hutang, anak Piutang", async () => {
    const debtor = await makePartner({
      companyId: anak,
      categoryLabel: "Stakeholder",
    });
    const budget = await makeBudget({
      categoryLabel: "Piutang",
      type: "In",
      partnerId: debtor,
      amount: 200_000,
    });
    const doc = await makeAnakDraft({
      purpose: "PTG_SH_IN",
      partnerId: debtor,
      lines: [{ budgetId: budget, amount: 200_000 }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok);

    const cashBank = await makeCashBank({ opening: 50_000 });
    const result = await confirmFundingRequest(
      raised.ok ? raised.id : 0,
      cashBank,
      actor
    );
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.equal(await bookBalance(cashBank), 250_000, "the induk holds it now");
    assert.equal(
      await subledgerBalance(await bookKey("Piutang"), debtor),
      -200_000,
      "being repaid lowers what the debtor owes the anak"
    );

    // The mirror of the expense case, and it is the *other* side of each
    // bridge: money taken in on the anak's behalf is owed to the anak, and the
    // anak may claim it back.
    const indukJournal = (await journalsFor(
      await fundingRequestDocTypeId(),
      raised.ok ? raised.id : 0
    ))[0];
    const anakJournal = (await journalsFor(await transactionDocType(), doc))[0];
    assert.ok(
      indukJournal.lines.some((l) => l.kredit_amount.toNumber() === 200_000),
      "the induk credits what it now owes the anak"
    );
    assert.ok(
      anakJournal.lines.some((l) => l.debit_amount.toNumber() === 200_000),
      "the anak debits what it may claim from the induk"
    );
  });

  test("a Purpose with no Partner writes no subject book at all", async () => {
    const budget = await makeBudget({ categoryLabel: "Biaya", amount: 40_000 });
    const doc = await makeAnakDraft({
      purpose: "BYA_OUT",
      lines: [{ budgetId: budget, amount: 40_000 }],
    });
    const raised = await raise(doc);
    assert.ok(raised.ok);

    const cashBank = await makeCashBank({ opening: 100_000 });
    assert.equal(await subledgerEntries(doc), 0);

    const result = await confirmFundingRequest(
      raised.ok ? raised.id : 0,
      cashBank,
      actor
    );
    assert.equal(result.ok, true, JSON.stringify(result));

    // None: Biaya names no Partner and keeps no book, and the intercompany
    // position is journal rather than subject book. The Cash Bank Book and both
    // journals still record the movement.
    assert.equal(await subledgerEntries(doc), 0);
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
    const result = await confirmFundingRequest(
      raised.ok ? raised.id : 0,
      foreign,
      actor
    );
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
    const result = await confirmFundingRequest(
      raised.ok ? raised.id : 0,
      stray,
      actor
    );
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
    const result = await confirmFundingRequest(
      raised.ok ? raised.id : 0,
      cashBank,
      actor
    );
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
    const first = await confirmFundingRequest(
      raised.ok ? raised.id : 0,
      cashBank,
      actor
    );
    assert.equal(first.ok, true, JSON.stringify(first));

    const second = await confirmFundingRequest(
      raised.ok ? raised.id : 0,
      cashBank,
      actor
    );
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

    const held = (await systemDefaults()).induk_bridge_ar_account;
    await writeSystemDefaults({ induk_bridge_ar_account: null }, actor);
    try {
      const bridge = await intercompanyBridge();
      assert.equal(bridge.ok, false);
      assert.ok(
        bridge.ok === false &&
          bridge.missing.includes("Account Piutang ke Anak")
      );

      const cashBank = await makeCashBank({ opening: 100_000 });
      const result = await confirmFundingRequest(
        raised.ok ? raised.id : 0,
        cashBank,
        actor
      );
      assert.equal(result.ok, false);
      assert.ok(
        result.ok === false && /Account Piutang ke Anak/.test(result.errors._form)
      );
      assert.equal(await bookBalance(cashBank), 100_000);
    } finally {
      await writeSystemDefaults({ induk_bridge_ar_account: held }, actor);
    }
  });

  test("a bridge account of the wrong Company is never stored", async () => {
    const anakAccount = await makeAccount({
      companyId: anak,
      subcategoryLabel: "1.1.3",
    });
    const { checkSystemDefaultValue } = await import(
      "../src/lib/siba/system-settings"
    );
    const refusal = await checkSystemDefaultValue(
      "induk_bridge_ar_account",
      anakAccount
    );
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
