import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { postJournal } from "../src/lib/siba/journal";
import { generalLedgerReport, ledgerEntriesPage } from "../src/lib/siba/ledger";
import type { LedgerEntry } from "../src/lib/siba/ledger";
import {
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
 * A General Ledger account opened a hundred entries at a time.
 *
 * The page states the rollup from the database's own sums and fetches rows when
 * an account is opened, so the property that has to hold is that the two roads
 * agree: the rollup equals what summing every line gives, and the pages put end
 * to end are the full ledger, Saldo included — a page opened in the middle of a
 * year must print the figure the whole ledger prints beside it.
 */

const RANGE = { from: "1991-01-01", to: "1991-12-31" };
const JOURNALS = 130;

let induk = 0;
let anak = 0;
let expense = 0;
let equity = 0;
let currency = 0;

before(async () => {
  const actor = await systemUserId();
  induk = await parentCompanyId();
  anak = await childCompanyId();
  currency = (
    await prisma.refCurrency.findFirstOrThrow({
      where: { currency_label: "IDR" },
      select: { id: true },
    })
  ).id;

  expense = await makeAccount({ companyId: induk, subcategoryLabel: "5.3.1" });
  equity = await makeAccount({ companyId: induk, subcategoryLabel: "3.3.1", normalBalance: "Kredit" });
  const branch = await makePartner({ companyId: induk, categoryLabel: "Cabang" });

  const line = (accountId: number, debit: number, credit: number, partnerId?: number) => ({
    accountId,
    partnerId: partnerId ?? null,
    currencyId: currency,
    rate: 1,
    debit,
    credit,
    description: "Fixture",
  });

  // Several journals share a day, so the cursor has to order within one.
  for (let i = 0; i < JOURNALS; i++) {
    const day = 1 + (i % 20);
    const month = 1 + (i % 6);
    const amount = 1_000 + i;
    await postJournal(prisma, {
      companyId: induk,
      description: `Fixture ledger paging ${i}`,
      accountingDate: new Date(Date.UTC(1991, month - 1, day)),
      lines:
        i === 7
          ? // One line naming a Partner on an account that takes none.
            [line(expense, amount, 0, branch), line(equity, 0, amount)]
          : [line(expense, amount, 0), line(equity, 0, amount)],
      actorId: actor,
    });
  }
});

after(async () => {
  await cleanupFixtures();
  await disconnect();
});

const same = (a: LedgerEntry, b: LedgerEntry) =>
  a.journalId === b.journalId &&
  a.date === b.date &&
  Math.round(a.debit * 100) === Math.round(b.debit * 100) &&
  Math.round(a.credit * 100) === Math.round(b.credit * 100) &&
  Math.round(a.balance * 100) === Math.round(b.balance * 100);

describe("a ledger account opened a page at a time", () => {
  test("the rollup from the database equals the sum of the lines", async () => {
    const full = (await generalLedgerReport([expense], RANGE, [induk])).accounts[0];
    const rollup = (await generalLedgerReport([expense], RANGE, [induk], { entries: false }))
      .accounts[0];

    assert.equal(rollup.entries.length, 0, "a summary run reads no line");
    assert.equal(rollup.entryCount, JOURNALS);
    assert.equal(rollup.entryCount, full.entryCount);
    assert.equal(Math.round(rollup.debit * 100), Math.round(full.debit * 100));
    assert.equal(Math.round(rollup.credit * 100), Math.round(full.credit * 100));
    assert.equal(Math.round(rollup.closing * 100), Math.round(full.closing * 100));
    assert.equal(rollup.mismatchCount, 1, "the Partner on an account that takes none is counted");
    assert.equal(rollup.mismatchCount, full.mismatchCount);
    assert.deepEqual(rollup.foreignCurrencies, full.foreignCurrencies);
  });

  test("pages end to end are the whole ledger, Saldo included", async () => {
    const full = (await generalLedgerReport([expense], RANGE, [induk])).accounts[0];

    const first = await ledgerEntriesPage(expense, RANGE, [induk], null);
    assert.ok(first);
    assert.equal(first.entries.length, 100);
    assert.ok(first.next, "more remain after a hundred");

    const second = await ledgerEntriesPage(expense, RANGE, [induk], first.next);
    assert.ok(second);
    assert.equal(second.entries.length, JOURNALS - 100);
    assert.equal(second.next, null, "the last page says so");

    const joined = [...first.entries, ...second.entries];
    assert.equal(joined.length, full.entries.length);
    joined.forEach((e, i) => assert.ok(same(e, full.entries[i]), `entry ${i} differs`));
    assert.equal(
      Math.round(second.entries[second.entries.length - 1].balance * 100),
      Math.round(full.closing * 100),
      "the last Saldo is the closing balance"
    );
  });

  test("an account outside the reader's Companies is not found", async () => {
    assert.equal(await ledgerEntriesPage(expense, RANGE, [anak], null), null);
  });

  test("a period with no lines has no pages", async () => {
    const page = await ledgerEntriesPage(expense, { from: "1992-01-01", to: "1992-12-31" }, [induk], null);
    assert.ok(page);
    assert.deepEqual(page.entries, []);
    assert.equal(page.next, null);
  });
});
