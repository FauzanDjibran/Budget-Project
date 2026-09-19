import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { postJournal, readDraftJournal } from "../src/lib/siba/journal";
import {
  JOURNAL_TRANSITIONS,
  availableJournalActions,
  journalAbilities,
  journalIsEditable,
} from "../src/lib/siba/journal-workflow";
import {
  cancelManualJournal,
  checkManualJournal,
  createManualJournal,
  manualJournalOptions,
  postManualJournal,
  updateManualJournal,
} from "../src/lib/siba/manual-journal";
import { generalLedgerReport, trialBalanceReport } from "../src/lib/siba/ledger";
import {
  CASH_BANK_SUBCATEGORY,
  controlAccountReasons,
  syncControlAccounts,
} from "../src/lib/siba/records";
import { systemDefaultAccountIds } from "../src/lib/siba/system-settings";
import { knownAuditEvents } from "../src/lib/siba/audit-events";
import {
  childCompanyId,
  cleanupFixtures,
  disconnect,
  makeAccount,
  makeMapping,
  mappingAccountId,
  makePartner,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The manual journal, and the one thing it must never be able to do.
 *
 * A hand-written journal line touching an account that a book outside the
 * General Ledger reconciles against would move one and leave the other behind,
 * and **nothing would error** — the application would simply stop being able to
 * prove its own figures. Every refusal below is pushed at from the side it
 * could be got round: the Server Action is reachable directly, so the picker
 * narrowing its list is not the protection.
 *
 * The second theme is that a draft is not accounting. It has no posting date,
 * the General Ledger cannot see it, the Trial Balance does not count it, and it
 * is allowed not to balance — the balance is a rule about posting, not about
 * saving.
 */

let company = 0;
let otherCompany = 0;
let actor = 0;
let scope: number[] = [];

/** Freely writable: an expense account reconciles against nothing but the GL. */
let expense = 0;
let expenseB = 0;
let baseCurrency = 0;
let foreignCurrency = 0;

const made: number[] = [];

before(async () => {
  company = await parentCompanyId();
  otherCompany = await childCompanyId();
  actor = await systemUserId();
  scope = [company, otherCompany];

  expense = await makeAccount({ companyId: company, subcategoryLabel: "5.3.1" });
  expenseB = await makeAccount({ companyId: company, subcategoryLabel: "5.3.1" });

  baseCurrency = (
    await prisma.refCurrency.findFirstOrThrow({
      where: { currency_label: "IDR" },
      select: { id: true },
    })
  ).id;
  const foreign = await prisma.refCurrency.findFirst({
    where: { currency_label: { not: "IDR" }, status: "Active" },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  foreignCurrency = foreign?.id ?? 0;
});

after(async () => {
  // Drafts and cancelled journals are fixtures of this run, written against
  // accounts that are about to stop existing. `cleanupFixtures` removes the
  // journals reached through those accounts; anything created without one is
  // removed here.
  for (const id of made) {
    await prisma.accJournalLine.deleteMany({ where: { journal_id: id } });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "acc_journal", row_id: id },
    });
    await prisma.accJournal.deleteMany({ where: { id } });
  }
  await cleanupFixtures();
  await disconnect();
});

const line = (
  accountId: number,
  debit: number,
  credit: number,
  extra: Partial<{
    partner_id: number | null;
    currency_id: number | null;
    exchange_rate: number | null;
  }> = {}
) => ({
  account_id: accountId,
  partner_id: extra.partner_id ?? null,
  currency_id:
    extra.currency_id === undefined ? baseCurrency : extra.currency_id,
  exchange_rate: extra.exchange_rate ?? null,
  debit,
  credit,
  description: "",
});

const header = { company_id: 0, description: "Fixture journal manual" };
const headerFor = () => ({ ...header, company_id: company });

async function draft(lines: ReturnType<typeof line>[]) {
  const result = await createManualJournal(headerFor(), lines, actor);
  assert.ok(result.ok, `draft was refused: ${JSON.stringify(result)}`);
  made.push(result.id);
  return result;
}

/** Whether the account currently carries the flag the manual journal reads. */
async function isControl(accountId: number): Promise<boolean> {
  const row = await prisma.accAccount.findUniqueOrThrow({
    where: { id: accountId },
    select: { is_control_account: true },
  });
  return row.is_control_account;
}

/** A Cash & Bank resource on an account, which is what claims it for the book. */
async function makeCashBank(accountId: number, label: string): Promise<number> {
  const row = await prisma.mCashBank.create({
    data: {
      cash_bank_code: `test.${label}`,
      cash_bank_label: label,
      cash_bank_name: `Fixture ${label}`,
      company_id: company,
      cash_bank_type: "Cash",
      currency_id: baseCurrency,
      account_id: accountId,
      created_by: actor,
    },
    select: { id: true },
  });
  return row.id;
}

// ------------------------------------------------------- control accounts

describe("a manual journal may not touch a control account", () => {
  test("an account a Cash & Bank resource posts to is refused, by name", async () => {
    const account = await makeAccount({
      companyId: company,
      subcategoryLabel: CASH_BANK_SUBCATEGORY,
    });
    const resource = await prisma.mCashBank.create({
      data: {
        cash_bank_code: `test.ZZMJ1`,
        cash_bank_label: "ZZMJ1",
        cash_bank_name: "Fixture Kas Manual Journal",
        company_id: company,
        cash_bank_type: "Cash",
        currency_id: baseCurrency,
        account_id: account,
        created_by: actor,
      },
      select: { id: true },
    });

    const reasons = await controlAccountReasons(account);
    assert.ok(
      reasons.some((r) => r.includes("Kas & Bank")),
      "the Cash Bank Book is what this account reconciles against"
    );

    // The flag the check reads is not set by this fixture — the structure is
    // what makes it a control account, and the application sets the flag when
    // a resource is registered through it. Setting it here is what the
    // Server Action's own path would have done.
    await prisma.accAccount.update({
      where: { id: account },
      data: { is_control_account: true },
    });

    const refused = await checkManualJournal(headerFor(), [
      line(account, 100_000, 0),
      line(expense, 0, 100_000),
    ]);
    assert.equal(refused.ok, false);
    assert.match(
      refused.ok ? "" : refused.errors["lines.0.account_id"],
      /control account/i
    );
    assert.match(
      refused.ok ? "" : refused.errors["lines.0.account_id"],
      /Kas & Bank/,
      "the refusal names the book, so the user knows which document to raise"
    );

    await prisma.mCashBank.delete({ where: { id: resource.id } });
  });

  test("a subledger-bearing mapping makes its target a control account", async () => {
    const hutang = await makeAccount({
      companyId: company,
      subcategoryLabel: "2.1.1",
      normalBalance: "Kredit",
    });
    const mapping = await makeMapping({
      companyId: company,
      budgetCategoryLabel: "Hutang",
      partnerCategoryLabel: "Cabang",
      accountId: hutang,
    });

    // The account the mapping actually points at, which is not necessarily
    // the one just made: a Company may already hold a mapping for this
    // combination, and makeMapping reuses it rather than repointing it.
    const target = await mappingAccountId(mapping);
    const reasons = await controlAccountReasons(target);
    assert.deepEqual(
      reasons,
      ["Buku Hutang"],
      "Hutang keeps a subject book, so its mapping target reconciles against it"
    );
  });

  test("a Biaya mapping target is NOT a control account", async () => {
    // The distinction the whole feature turns on: Biaya keeps no subject book,
    // so its account reconciles against the General Ledger alone. If this
    // became a control account, a manual journal could reach almost nothing —
    // depreciation and accruals are exactly this kind of entry.
    const biaya = await makeAccount({
      companyId: company,
      subcategoryLabel: "5.3.1",
    });
    await makeMapping({
      companyId: company,
      budgetCategoryLabel: "Biaya",
      partnerCategoryLabel: null,
      accountId: biaya,
    });

    assert.deepEqual(await controlAccountReasons(biaya), []);
  });

  test("the flag follows the structure in both directions", async () => {
    // The property the recompute exists for, and the one that cannot be seen
    // by looking at the screen: a Cash & Bank resource repointed at another
    // account has to release the one it left behind. While claiming was
    // automatic and releasing was not, the old account stayed closed to manual
    // entry for good — and the only way back was a checkbox that no longer
    // exists.
    const first = await makeAccount({
      companyId: company,
      subcategoryLabel: CASH_BANK_SUBCATEGORY,
    });
    const second = await makeAccount({
      companyId: company,
      subcategoryLabel: CASH_BANK_SUBCATEGORY,
    });
    const resource = await makeCashBank(first, "ZZMJ2");

    const defaults = await systemDefaultAccountIds();
    await syncControlAccounts([first, second], defaults, actor);
    assert.equal(await isControl(first), true, "the Cash Bank Book claims it");
    assert.equal(await isControl(second), false, "nothing claims this one yet");

    await prisma.mCashBank.update({
      where: { id: resource },
      data: { account_id: second },
    });
    await syncControlAccounts([first, second], defaults, actor);

    assert.equal(
      await isControl(first),
      false,
      "nothing reconciles against it any more, so it re-opens to manual entry"
    );
    assert.equal(await isControl(second), true, "the resource's new account is claimed");

    // And the refusal follows the flag rather than lagging a step behind it.
    const allowed = await checkManualJournal(headerFor(), [
      line(first, 40_000, 0),
      line(expense, 0, 40_000),
    ]);
    assert.equal(allowed.ok, true, "a released account is writable by hand again");

    await prisma.mCashBank.delete({ where: { id: resource } });
  });

  test("a second claim holds an account even when the first lets go", async () => {
    // Why the release re-asks the structure rather than assuming: two things
    // can reconcile against one account, and the one that moves away must not
    // release it for the one that is still there.
    const shared = await makeAccount({
      companyId: company,
      subcategoryLabel: CASH_BANK_SUBCATEGORY,
    });
    const elsewhere = await makeAccount({
      companyId: company,
      subcategoryLabel: CASH_BANK_SUBCATEGORY,
    });
    const moving = await makeCashBank(shared, "ZZMJ3");
    const staying = await makeCashBank(shared, "ZZMJ4");

    const defaults = await systemDefaultAccountIds();
    await syncControlAccounts([shared], defaults, actor);
    assert.equal(await isControl(shared), true);

    await prisma.mCashBank.update({
      where: { id: moving },
      data: { account_id: elsewhere },
    });
    await syncControlAccounts([shared, elsewhere], defaults, actor);

    assert.equal(
      await isControl(shared),
      true,
      "the second resource still reconciles against it"
    );

    await prisma.mCashBank.deleteMany({ where: { id: { in: [moving, staying] } } });
  });

  test("the flag alone is enough, with no structure behind it", async () => {
    const declared = await makeAccount({
      companyId: company,
      subcategoryLabel: "5.3.1",
      controlAccount: true,
    });
    const refused = await checkManualJournal(headerFor(), [
      line(declared, 50_000, 0),
      line(expense, 0, 50_000),
    ]);
    assert.equal(refused.ok, false);
    assert.match(
      refused.ok ? "" : refused.errors["lines.0.account_id"],
      /control account/i
    );
  });

  test("the picker offers exactly what the check accepts", async () => {
    const controlled = await makeAccount({
      companyId: company,
      subcategoryLabel: "5.3.1",
      controlAccount: true,
    });
    const inactive = await makeAccount({
      companyId: company,
      subcategoryLabel: "5.3.1",
      active: false,
    });
    const parent = await makeAccount({
      companyId: company,
      subcategoryLabel: "5.3.1",
    });
    await makeAccount({
      companyId: company,
      subcategoryLabel: "5.3.1",
      parentId: parent,
    });

    const { accounts } = await manualJournalOptions(company);
    const offered = new Set(accounts.map((a) => a.id));

    assert.ok(offered.has(expense), "an ordinary expense account is offered");
    assert.ok(!offered.has(controlled), "a control account is not offered");
    assert.ok(!offered.has(inactive), "an inactive account is not offered");
    assert.ok(
      !offered.has(parent),
      "an account with a sub-account is a heading, not a destination"
    );
  });
});

// ----------------------------------------------------------- the line rules

describe("a line states enough to be accounting", () => {
  test("a header account is refused even when its flag says postable", async () => {
    const parent = await makeAccount({
      companyId: company,
      subcategoryLabel: "5.3.1",
    });
    await makeAccount({
      companyId: company,
      subcategoryLabel: "5.3.1",
      parentId: parent,
    });
    // The tree is the enforcement, not the flag: an account that somehow still
    // carried `is_postable` has to be refused anyway.
    await prisma.accAccount.update({
      where: { id: parent },
      data: { is_postable: true },
    });

    const refused = await checkManualJournal(headerFor(), [
      line(parent, 10_000, 0),
      line(expense, 0, 10_000),
    ]);
    assert.equal(refused.ok, false);
    assert.match(
      refused.ok ? "" : refused.errors["lines.0.account_id"],
      /header/i
    );
  });

  test("an account of another Company is refused", async () => {
    const foreignAccount = await makeAccount({
      companyId: otherCompany,
      subcategoryLabel: "5.3.1",
    });
    const refused = await checkManualJournal(headerFor(), [
      line(foreignAccount, 10_000, 0),
      line(expense, 0, 10_000),
    ]);
    assert.equal(refused.ok, false);
    assert.match(
      refused.ok ? "" : refused.errors["lines.0.account_id"],
      /Company lain/
    );
  });

  test("an account that names a Partner Category demands a matching Partner", async () => {
    const withPartner = await makeAccount({
      companyId: company,
      subcategoryLabel: "5.3.1",
      partnerCategoryLabel: "Cabang",
    });

    const missing = await checkManualJournal(headerFor(), [
      line(withPartner, 10_000, 0),
      line(expense, 0, 10_000),
    ]);
    assert.equal(missing.ok, false);
    assert.ok(missing.ok || missing.errors["lines.0.partner_id"]);

    const wrongCategory = await makePartner({
      companyId: company,
      categoryLabel: "Karyawan",
    });
    const mismatched = await checkManualJournal(headerFor(), [
      line(withPartner, 10_000, 0, { partner_id: wrongCategory }),
      line(expense, 0, 10_000),
    ]);
    assert.equal(mismatched.ok, false);
    assert.match(
      mismatched.ok ? "" : mismatched.errors["lines.0.partner_id"],
      /Partner Category/
    );

    const right = await makePartner({
      companyId: company,
      categoryLabel: "Cabang",
    });
    const accepted = await checkManualJournal(headerFor(), [
      line(withPartner, 10_000, 0, { partner_id: right }),
      line(expense, 0, 10_000),
    ]);
    assert.equal(accepted.ok, true);
  });

  test("a line fills exactly one side", async () => {
    const both = await checkManualJournal(headerFor(), [
      line(expense, 10_000, 10_000),
      line(expenseB, 0, 10_000),
    ]);
    assert.equal(both.ok, false);
    assert.ok(both.ok || both.errors["lines.0.amount"]);

    const neither = await checkManualJournal(headerFor(), [
      line(expense, 0, 0),
      line(expenseB, 0, 10_000),
    ]);
    assert.equal(neither.ok, false);
    assert.ok(neither.ok || neither.errors["lines.0.amount"]);
  });

  test("a journal of one line is refused", async () => {
    const one = await checkManualJournal(headerFor(), [line(expense, 10_000, 0)]);
    assert.equal(one.ok, false);
    assert.ok(one.ok || one.errors._form);
  });

  test("a foreign line states its kurs; a base line is never asked for one", async (t) => {
    if (!foreignCurrency) return t.skip("no non-base currency on this database");

    const missingRate = await checkManualJournal(headerFor(), [
      line(expense, 100, 0, { currency_id: foreignCurrency }),
      line(expenseB, 0, 1_600_000),
    ]);
    assert.equal(missingRate.ok, false);
    assert.ok(missingRate.ok || missingRate.errors["lines.0.exchange_rate"]);

    const valued = await checkManualJournal(headerFor(), [
      line(expense, 100, 0, {
        currency_id: foreignCurrency,
        exchange_rate: 16_000,
      }),
      line(expenseB, 0, 1_600_000),
    ]);
    assert.ok(valued.ok);
    assert.equal(
      valued.debit,
      1_600_000,
      "debit and kredit are base currency; the foreign face is extra information"
    );
    assert.equal(valued.credit, 1_600_000);

    // A base-currency line is valued at the identity, and that is the only
    // case where a rate of 1 is right (CLAUDE.md §10 rule 68).
    assert.equal(valued.lines[1].rate, 1);
  });
});

// -------------------------------------------------------------- the draft

describe("a draft is not accounting", () => {
  test("an unbalanced draft saves, and refuses to post", async () => {
    const created = await draft([
      line(expense, 100_000, 0),
      line(expenseB, 0, 60_000),
    ]);

    const posted = await postManualJournal(created.id, actor, scope);
    assert.equal(posted.ok, false);
    assert.match(posted.ok ? "" : posted.errors._form, /tidak seimbang/i);

    const row = await prisma.accJournal.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true, posting_date: true },
    });
    assert.equal(row.status, "Draft", "a refused post leaves the draft alone");
    assert.equal(row.posting_date, null);
  });

  test("a draft has no posting date and is invisible to both ledger reports", async () => {
    const created = await draft([
      line(expense, 250_000, 0),
      line(expenseB, 0, 250_000),
    ]);

    const range = { from: "2000-01-01", to: "2100-12-31" };
    const ledger = await generalLedgerReport([expense], range, [company]);
    const seen = ledger.accounts[0]?.entries.some(
      (e) => e.journalId === created.id
    );
    assert.equal(seen, false, "the General Ledger reads posted journals only");

    const trial = await trialBalanceReport(range, [company]);
    assert.equal(
      trial.unbalanced.some((j) => j.id === created.id),
      false,
      "a draft that does not balance yet is not a system fault"
    );
  });

  test("an edit replaces the draft's content", async () => {
    const created = await draft([
      line(expense, 10_000, 0),
      line(expenseB, 0, 10_000),
    ]);

    const updated = await updateManualJournal(
      created.id,
      { ...headerFor(), description: "Diubah" },
      [line(expense, 25_000, 0), line(expenseB, 0, 25_000)],
      actor,
      scope
    );
    assert.ok(updated.ok);

    const read = await readDraftJournal(created.id, scope);
    assert.equal(read?.description, "Diubah");
    assert.equal(read?.lines.length, 2);
    assert.equal(read?.lines[0].debit, 25_000);
  });

  test("a draft of a Company the caller may not see reads as not found", async () => {
    const created = await draft([
      line(expense, 10_000, 0),
      line(expenseB, 0, 10_000),
    ]);
    const refused = await postManualJournal(created.id, actor, [otherCompany]);
    assert.equal(refused.ok, false);
    assert.match(refused.ok ? "" : refused.errors._form, /tidak ditemukan/i);
  });
});

// --------------------------------------------------------------- posting

describe("post is the boundary, and it is the same engine", () => {
  test("a balanced draft posts, is dated today, and reaches the General Ledger", async () => {
    const created = await draft([
      line(expense, 400_000, 0),
      line(expenseB, 0, 400_000),
    ]);

    const posted = await postManualJournal(created.id, actor, scope);
    assert.ok(posted.ok);

    const row = await prisma.accJournal.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true, posting_date: true, is_manual: true, journal_no: true },
    });
    assert.equal(row.status, "Posted");
    assert.equal(row.is_manual, true);
    assert.equal(
      row.posting_date?.toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10),
      "a journal is dated the day it was posted, never back-dated"
    );
    assert.match(row.journal_no, /^JUR-\d{4}/, "manual journals keep their own series");

    const ledger = await generalLedgerReport(
      [expense],
      { from: "2000-01-01", to: "2100-12-31" },
      [company]
    );
    assert.ok(
      ledger.accounts[0].entries.some((e) => e.journalId === created.id),
      "a posted manual journal is ordinary accounting from that moment"
    );
  });

  test("a posted journal cannot be edited, posted again or cancelled", async () => {
    const created = await draft([
      line(expense, 70_000, 0),
      line(expenseB, 0, 70_000),
    ]);
    assert.ok((await postManualJournal(created.id, actor, scope)).ok);

    const edited = await updateManualJournal(
      created.id,
      headerFor(),
      [line(expense, 1, 0), line(expenseB, 0, 1)],
      actor,
      scope
    );
    assert.equal(edited.ok, false);
    assert.match(edited.ok ? "" : edited.errors._form, /Draft/);

    assert.equal((await postManualJournal(created.id, actor, scope)).ok, false);
    assert.equal((await cancelManualJournal(created.id, actor, scope)).ok, false);
  });

  test("an account that became a control account since refuses at post", async () => {
    // The plan can be complete and still be refused: the chart moved on. This
    // is the same reasoning `applyPosting` uses for re-reading its Budgets.
    const account = await makeAccount({
      companyId: company,
      subcategoryLabel: "5.3.1",
    });
    const created = await draft([
      line(account, 30_000, 0),
      line(expenseB, 0, 30_000),
    ]);

    await prisma.accAccount.update({
      where: { id: account },
      data: { is_control_account: true },
    });

    const refused = await postManualJournal(created.id, actor, scope);
    assert.equal(refused.ok, false);
    assert.match(refused.ok ? "" : refused.errors._form, /control account/i);

    const row = await prisma.accJournal.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true },
    });
    assert.equal(row.status, "Draft", "a refused post writes nothing at all");
  });

  test("a cancelled draft is retired rather than deleted", async () => {
    const created = await draft([
      line(expense, 15_000, 0),
      line(expenseB, 0, 15_000),
    ]);
    assert.ok((await cancelManualJournal(created.id, actor, scope)).ok);

    const row = await prisma.accJournal.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true, journal_no: true },
    });
    assert.equal(row.status, "Cancelled");
    assert.ok(row.journal_no, "the number stays behind as a trace");

    assert.equal((await postManualJournal(created.id, actor, scope)).ok, false);
  });

  test("an automatic journal is not reachable from the manual path", async () => {
    const automatic = await postJournal(prisma, {
      companyId: company,
      description: "Fixture posting",
      lines: [
        {
          accountId: expense,
          currencyId: baseCurrency,
          rate: 1,
          debit: 5_000,
          credit: 0,
          description: "d",
        },
        {
          accountId: expenseB,
          currencyId: baseCurrency,
          rate: 1,
          debit: 0,
          credit: 5_000,
          description: "c",
        },
      ],
      actorId: actor,
    });
    made.push(automatic.id);

    assert.match(automatic.journalNo, /^JRN-/);
    const refused = await updateManualJournal(
      automatic.id,
      headerFor(),
      [line(expense, 1, 0), line(expenseB, 0, 1)],
      actor,
      scope
    );
    assert.equal(refused.ok, false);
    assert.match(
      refused.ok ? "" : refused.errors._form,
      /posting dokumen/,
      "a journal a document produced is final from the moment it exists"
    );
  });
});

// -------------------------------------------------------------- lifecycle

describe("the lifecycle is one table, read by both sides", () => {
  test("only a Draft offers anything, and only to whoever may", () => {
    const all = journalAbilities([
      "JOURNAL_CREATE",
      "JOURNAL_EDIT",
      "JOURNAL_POST",
      "JOURNAL_CANCEL",
    ]);
    assert.deepEqual(availableJournalActions("Draft", all), ["post", "cancel"]);
    assert.deepEqual(availableJournalActions("Posted", all), []);
    assert.deepEqual(availableJournalActions("Cancelled", all), []);

    const readOnly = journalAbilities(["JOURNAL_VIEW"]);
    assert.deepEqual(availableJournalActions("Draft", readOnly), []);
  });

  test("editing is confined to Draft", () => {
    assert.equal(journalIsEditable("Draft"), true);
    assert.equal(journalIsEditable("Posted"), false);
    assert.equal(journalIsEditable("Cancelled"), false);
  });

  test("nothing in the table produces a Draft, so Posted is one-way", () => {
    for (const t of Object.values(JOURNAL_TRANSITIONS)) {
      assert.notEqual(t.to, "Draft", `${t.label} would re-open a posted journal`);
    }
  });

  test("every transition can be named in a record's history", () => {
    const known = knownAuditEvents()["acc_journal"] ?? [];
    for (const key of Object.keys(JOURNAL_TRANSITIONS)) {
      assert.ok(
        known.includes(key),
        `${key} would read as a bare "Diubah" in the history panel`
      );
    }
  });
});
