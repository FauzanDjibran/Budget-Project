import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  cashBankEntriesPage,
  cashBankLedgerReport,
  openCashBankBook,
  recordCashBankEntry,
} from "../src/lib/siba/cash-bank";
import { recordSubledgerEntry } from "../src/lib/siba/subledger";
import { loadSubledgers } from "../src/lib/siba/subledger-data";
import { subledgerEntriesPage, subledgerReport } from "../src/lib/siba/subledger-reports";
import type { SubledgerDef } from "../src/lib/siba/subledger-catalogue";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import {
  FIXTURE_PREFIX,
  childCompanyId,
  cleanupFixtures,
  disconnect,
  makeAccount,
  makePartner,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The books' reports opened a page at a time.
 *
 * Same property as the General Ledger's: the rollup the page states from the
 * database's own sums equals what summing the entries gives, and the pages put
 * end to end are the whole book — in the book's own order, with entries that
 * share a day kept in the order they were written.
 */

const RANGE = { from: "2020-02-01", to: "2020-08-31" };
const ENTRIES = 130;

let induk = 0;
let anak = 0;
let actor = 0;
let currency = 0;
let cashBank = 0;
let books: SubledgerDef[] = [];
let titipan: SubledgerDef;
let partner = 0;
let otherPartner = 0;

const cents = (n: number) => Math.round(n * 100);

before(async () => {
  induk = await parentCompanyId();
  anak = await childCompanyId();
  actor = await systemUserId();
  currency = (
    await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" }, select: { id: true } })
  ).id;

  // ----------------------------------------------------------- the cash book
  const account = await makeAccount({ companyId: induk, subcategoryLabel: CASH_BANK_SUBCATEGORY });
  const key = `${FIXTURE_PREFIX}BP${Date.now() % 100000}`;
  cashBank = (
    await prisma.mCashBank.create({
      data: {
        cash_bank_code: `test.${key}`,
        cash_bank_label: key,
        cash_bank_name: `Fixture ${key}`,
        company_id: induk,
        cash_bank_type: "Cash",
        currency_id: currency,
        account_id: account,
        status: "Active",
        created_by: actor,
      },
      select: { id: true },
    })
  ).id;
  await openCashBankBook(prisma, {
    cashBankId: cashBank,
    openingBalance: 500_000_000,
    rate: 1,
    date: "2020-01-01",
    actorId: actor,
  });
  // Several entries share a day, so the cursor has to order within one.
  for (let i = 0; i < ENTRIES; i++) {
    await recordCashBankEntry(prisma, {
      cashBankId: cashBank,
      date: `2020-0${2 + (i % 5)}-${String(1 + (i % 9)).padStart(2, "0")}`,
      type: "Transaction",
      direction: i % 3 === 0 ? "Out" : "In",
      amount: 1_000 + i,
      rate: 1,
      note: `fixture paging ${i}`,
      actorId: actor,
    });
  }

  // ---------------------------------------------------------- a subject book
  books = await loadSubledgers();
  titipan = books.find((b) => b.budgetCategory === "Titipan")!;
  partner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
  otherPartner = await makePartner({ companyId: induk, categoryLabel: "Cabang" });

  const entry = (
    who: number,
    date: string,
    direction: "In" | "Out",
    amount: number,
    itemId?: number
  ) =>
    prisma.$transaction((tx) =>
      recordSubledgerEntry(tx, {
        book: titipan,
        partnerId: who,
        currencyId: currency,
        date,
        type: "Transaction",
        direction,
        amount,
        rate: 1,
        itemId,
        note: `${FIXTURE_PREFIX} paging ${amount}`,
        actorId: actor,
      })
    );

  const first = await entry(partner, "2020-02-02", "In", 5_000);
  for (let i = 0; i < ENTRIES - 2; i++) {
    await entry(partner, `2020-0${2 + (i % 5)}-${String(2 + (i % 9)).padStart(2, "0")}`, "In", 100 + i);
  }
  // A lowering of the first item, so the book has both sides.
  await entry(partner, "2020-08-01", "Out", 1_200, first.balance_id);
  await entry(otherPartner, "2020-03-03", "In", 777);
});

after(async () => {
  await prisma.subLedger.deleteMany({ where: { note: { startsWith: FIXTURE_PREFIX } } });
  await prisma.subLedgerBalance.deleteMany({ where: { partner_id: { in: [partner, otherPartner] } } });
  await cleanupFixtures();
  await prisma.cashBankLedger.deleteMany({ where: { cash_bank_id: cashBank } });
  await prisma.cashBankPeriod.deleteMany({ where: { cash_bank_id: cashBank } });
  await prisma.cashBankBalance.deleteMany({ where: { cash_bank_id: cashBank } });
  await prisma.mCashBank.deleteMany({ where: { id: cashBank } });
  await cleanupFixtures();
  await disconnect();
});

describe("Buku Kas & Bank opened a page at a time", () => {
  test("the rollup from the database equals the sum of the entries", async () => {
    const full = (await cashBankLedgerReport(cashBank, RANGE, [induk]))!;
    const rollup = (await cashBankLedgerReport(cashBank, RANGE, [induk], { entries: false }))!;

    assert.equal(rollup.entries.length, 0, "a summary run reads no entry");
    assert.equal(rollup.entryCount, ENTRIES);
    assert.equal(rollup.entryCount, full.entryCount);
    for (const f of ["opening", "totalIn", "totalOut", "closing", "baseTotalIn", "baseTotalOut", "baseClosing"] as const) {
      assert.equal(cents(rollup[f]), cents(full[f]), `${f} differs`);
    }
    assert.equal(rollup.reconciles, full.reconciles);
  });

  test("pages end to end are the whole book, in its order", async () => {
    const full = (await cashBankLedgerReport(cashBank, RANGE, [induk]))!;
    const first = await cashBankEntriesPage(cashBank, RANGE, [induk], null);
    assert.ok(first);
    assert.equal(first.entries.length, 100);
    assert.ok(first.next);

    const second = await cashBankEntriesPage(cashBank, RANGE, [induk], first.next);
    assert.ok(second);
    assert.equal(second.entries.length, ENTRIES - 100);
    assert.equal(second.next, null);

    assert.deepEqual(
      [...first.entries, ...second.entries].map((e) => e.id),
      full.entries.map((e) => e.id)
    );
  });

  test("a resource outside the reader's Companies is not found", async () => {
    assert.equal(await cashBankEntriesPage(cashBank, RANGE, [anak], null), null);
  });
});

describe("Buku Subjek opened a page at a time", () => {
  const options = () => ({ partnerIds: [partner], companyIds: [induk] });

  test("the rollup from the database equals the sum of the entries", async () => {
    const full = (await subledgerReport(books, titipan.categoryId, RANGE, options()))!.subjects[0];
    const rollup = (
      await subledgerReport(books, titipan.categoryId, RANGE, { ...options(), entries: false })
    )!.subjects[0];

    assert.equal(rollup.entries.length, 0);
    assert.equal(rollup.entryCount, ENTRIES);
    assert.equal(rollup.entryCount, full.entryCount);
    for (const f of ["opening", "raised", "lowered", "closing", "baseRaised", "baseLowered", "baseClosing"] as const) {
      assert.equal(cents(rollup[f]), cents(full[f]), `${f} differs`);
    }
    assert.ok(full.lowered > 0, "the lowering is counted on its own side");
    assert.equal(rollup.reconciles, full.reconciles);
  });

  test("pages end to end are the whole subject, and nobody else's", async () => {
    const full = (await subledgerReport(books, titipan.categoryId, RANGE, options()))!.subjects[0];
    const first = await subledgerEntriesPage(books, titipan.categoryId, partner, currency, RANGE, [induk], null);
    assert.ok(first);
    assert.equal(first.entries.length, 100);
    assert.ok(first.next);

    const second = await subledgerEntriesPage(books, titipan.categoryId, partner, currency, RANGE, [induk], first.next);
    assert.ok(second);
    assert.equal(second.entries.length, ENTRIES - 100);
    assert.equal(second.next, null);

    assert.deepEqual(
      [...first.entries, ...second.entries].map((e) => e.id),
      full.entries.map((e) => e.id)
    );
  });

  test("a subject outside the reader's Companies has no entries to give", async () => {
    const page = await subledgerEntriesPage(books, titipan.categoryId, partner, currency, RANGE, [anak], null);
    assert.ok(page);
    assert.deepEqual(page.entries, []);
  });
});
