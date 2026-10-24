import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { BASE_CURRENCY_LABEL } from "../src/lib/siba/currency";
import {
  applyItemAdjustment,
  checkItemAdjustmentHeader,
  checkItemAdjustmentLines,
  nextItemAdjustmentNo,
  valueItemAdjustmentDraft,
  type ResolvedItemAdjustmentHeader,
} from "../src/lib/siba/item-adjustment";
import {
  adjustmentDirection,
  adjustmentKind,
  effectOfChange,
  type ItemAdjustmentEffect,
} from "../src/lib/siba/item-adjustment-workflow";
import { lockSubledgerPosition, recordSubledgerEntry, subledgerItemsByIds } from "../src/lib/siba/subledger";
import { subledgerPosition } from "../src/lib/siba/subledger-reports";
import {
  subledgerForCategory,
  subledgerMovement,
  type SubledgerDef,
} from "../src/lib/siba/subledger-catalogue";
import { loadSubledgers } from "../src/lib/siba/subledger-data";
import type { SystemAccountKey } from "../src/lib/siba/system-accounts";
import { checkSystemAccountValue } from "../src/lib/siba/system-account-data";
import {
  FIXTURE_PREFIX,
  budgetCategoryId,
  childCompanyId,
  cleanupFiscalYear,
  cleanupFixtures,
  closeYearFor,
  disconnect,
  makeAccount,
  makeMapping,
  makePartner,
  mappingAccountId,
  openFiscalYear,
  parentCompanyId,
  getSystemAccount,
  prisma,
  setSystemAccount,
  systemUserId,
} from "./helpers";

/**
 * Penyesuaian Open Item — a Debit Note and a Credit Note against existing open
 * items, under SIBA's own name, stated as the value each item should now hold.
 *
 * What the feature lives or dies by, none of it visible on a screen:
 *
 *   1. **The direction is read, never chosen.** A new value above what the
 *      item holds is a Penambahan, below it a Pengurangan, equal to it nothing
 *      — and one document may hold both.
 *   2. **One rule signs every book.** The book's own `raises` turns each
 *      line's effect into a side of the journal. Nothing per book.
 *   3. **It changes items that exist, never opens one**, each moved at its
 *      own kurs — a new ledger line on the same item, never an average.
 *   4. **A new value holds only against the balance it was typed for.** Post
 *      refuses an item that moved since the draft, because the same value
 *      would move it by a difference nobody saw.
 *   5. **The book and the journal agree**, and **nothing goes below zero** —
 *      refused at save, and again at Post under a lock.
 *   6. **A draft states what Post writes.**
 */

let induk = 0;
let anak = 0;
let actor = 0;
let fiscalYear = 0;
let idr = 0;
let foreign = 0;
let books: SubledgerDef[] = [];
let piutang: SubledgerDef;
let hutang: SubledgerDef;
let piutangAccount = 0;
let hutangAccount = 0;
let incomeAccount = 0;
let expenseAccount = 0;

const COUNTER_KEYS: ["induk" | "anak", SystemAccountKey][] = [
  ["induk", "adjustment_income"],
  ["induk", "adjustment_expense"],
  ["anak", "adjustment_income"],
  ["anak", "adjustment_expense"],
];
/** What the database held before this run, so it is put back rather than lost. */
const saved = new Map<string, number | null>();

const docs: number[] = [];
const today = () => new Date().toISOString().slice(0, 10);

/** A position that already stands — one open item, written straight into the book. */
async function seedItem(
  book: SubledgerDef,
  partnerId: number,
  currencyId: number,
  amount: number,
  rate = 1
): Promise<number> {
  const entry = await prisma.$transaction((tx) =>
    recordSubledgerEntry(tx, {
      book,
      partnerId,
      currencyId,
      date: today(),
      type: "Transaction",
      // Whichever cash direction raises this book.
      direction: book.raises,
      amount,
      rate,
      note: `${FIXTURE_PREFIX} seed`,
      actorId: actor,
    })
  );
  return entry.balance_id;
}

/** Another writer lowering an item, outside any adjustment. */
async function lowerItem(book: SubledgerDef, partnerId: number, currencyId: number, itemId: number, amount: number) {
  await prisma.$transaction((tx) =>
    recordSubledgerEntry(tx, {
      book,
      partnerId,
      currencyId,
      date: today(),
      type: "Transaction",
      direction: book.raises === "Out" ? "In" : "Out",
      amount,
      rate: 1,
      itemId,
      note: `${FIXTURE_PREFIX} other writer`,
      actorId: actor,
    })
  );
}

/**
 * A Draft, written straight into the table as the save would write it — each
 * line naming an item and its new value, against what the item holds now — so
 * a test can then move an item under it.
 */
async function makeAdjustment(options: {
  book: SubledgerDef;
  partnerId: number;
  companyId?: number;
  currencyId?: number;
  /** [item id, new value] */
  lines: [number, number][];
}): Promise<number> {
  const currencyId = options.currencyId ?? idr;
  const held = new Map(
    (await subledgerItemsByIds(options.lines.map(([id]) => id))).map((i) => [i.id, i])
  );
  const lines = options.lines.map(([itemId, newAmount], i) => {
    const before = held.get(itemId)!.remaining;
    const effect = effectOfChange(before, newAmount)!;
    return {
      sequence_no: i + 1,
      description: `${FIXTURE_PREFIX} baris ${i + 1}`,
      sub_ledger_balance_id: itemId,
      effect,
      balance_before: before,
      new_amount: newAmount,
      amount: Math.abs(newAmount - before),
      created_by: actor,
    };
  });
  const row = await prisma.finItemAdjustment.create({
    data: {
      adjustment_no: await nextItemAdjustmentNo(),
      accounting_date: new Date(`${today()}T00:00:00Z`),
      company_id: options.companyId ?? induk,
      budget_category_id: options.book.categoryId,
      partner_id: options.partnerId,
      currency_id: currencyId,
      exchange_rate: null,
      adjustment_amount: lines.reduce((t, l) => t + (l.effect === "Increase" ? l.amount : -l.amount), 0),
      status: "Draft",
      created_by: actor,
      lines: { create: lines },
    },
    select: { id: true },
  });
  docs.push(row.id);
  return row.id;
}

const position = (book: SubledgerDef, partnerId: number, currencyId = idr) =>
  subledgerPosition(book.categoryId, partnerId, currencyId);

const journalOf = (id: number) =>
  prisma.accJournal.findFirstOrThrow({
    where: { source_doc_id: id, source_doc_type: { doc_table: "fin_item_adjustment" } },
    include: { lines: { orderBy: { id: "asc" } } },
  });

const balanced = async (id: number) => {
  const journal = await journalOf(id);
  const debit = journal.lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0);
  const credit = journal.lines.reduce((t, l) => t + l.kredit_amount.toNumber(), 0);
  return Math.round(debit * 100) === Math.round(credit * 100);
};

const item = (id: number) => prisma.subLedgerBalance.findUniqueOrThrow({ where: { id } });

before(async () => {
  fiscalYear = await openFiscalYear();
  induk = await parentCompanyId();
  anak = await childCompanyId();
  actor = await systemUserId();

  idr = (
    await prisma.refCurrency.findFirstOrThrow({
      where: { currency_label: BASE_CURRENCY_LABEL },
      select: { id: true },
    })
  ).id;
  foreign = (
    (await prisma.refCurrency.findFirst({
      where: { currency_label: "DNCA" },
      select: { id: true },
    })) ??
    (await prisma.refCurrency.create({
      data: {
        currency_code: "curr.DNCA",
        currency_label: "DNCA",
        currency_name: "Fixture Penyesuaian Currency",
        created_by: actor,
      },
      select: { id: true },
    }))
  ).id;

  books = await loadSubledgers();
  piutang = subledgerForCategory(books, await budgetCategoryId("Piutang"))!;
  hutang = subledgerForCategory(books, await budgetCategoryId("Hutang"))!;

  // The Partner's side: the account each position is mapped to. Reused when
  // the database already maps the combination.
  piutangAccount = await mappingAccountId(
    await makeMapping({
      companyId: induk,
      budgetCategoryLabel: "Piutang",
      partnerCategoryLabel: "Karyawan",
      accountId: await makeAccount({
        companyId: induk,
        subcategoryLabel: "1.1.4",
        partnerCategoryLabel: "Karyawan",
      }),
    })
  );
  hutangAccount = await mappingAccountId(
    await makeMapping({
      companyId: induk,
      budgetCategoryLabel: "Hutang",
      partnerCategoryLabel: "Karyawan",
      accountId: await makeAccount({
        companyId: induk,
        subcategoryLabel: "2.1.1",
        normalBalance: "Kredit",
        partnerCategoryLabel: "Karyawan",
      }),
    })
  );

  // The counter side: Pendapatan and Beban Penyesuaian, per Company.
  incomeAccount = await makeAccount({ companyId: induk, subcategoryLabel: "5.3.1" });
  expenseAccount = await makeAccount({ companyId: induk, subcategoryLabel: "5.3.1" });
  for (const [side, key] of COUNTER_KEYS) {
    saved.set(`${side}:${key}`, await getSystemAccount(side, key));
  }
  await setSystemAccount("induk", "adjustment_income", incomeAccount);
  await setSystemAccount("induk", "adjustment_expense", expenseAccount);
});

after(async () => {
  for (const [key, value] of saved) {
    const [side, k] = key.split(":") as ["induk" | "anak", SystemAccountKey];
    await setSystemAccount(side, k, value);
  }
  if (docs.length) {
    await prisma.finItemAdjustmentLine.deleteMany({ where: { adjustment_id: { in: docs } } });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "fin_item_adjustment", row_id: { in: docs } },
    });
    await prisma.finItemAdjustment.deleteMany({ where: { id: { in: docs } } });
  }
  await cleanupFiscalYear();
  await cleanupFixtures();
  await disconnect();
});

// ------------------------------------------------------------------ the rule

describe("one rule signs every book", () => {
  test("Penambahan raises and Pengurangan lowers, in a book money leaving raises and one it lowers", () => {
    const moves = (book: SubledgerDef, effect: ItemAdjustmentEffect) =>
      subledgerMovement(book, adjustmentDirection(effect, book.raises), 100);
    assert.equal(moves(piutang, "Increase"), 100);
    assert.equal(moves(piutang, "Decrease"), -100);
    assert.equal(moves(hutang, "Increase"), 100);
    assert.equal(moves(hutang, "Decrease"), -100);
  });

  test("the effect is the sign of the difference, and a document's kind follows its lines", () => {
    assert.equal(effectOfChange(10_000_000, 12_000_000), "Increase");
    assert.equal(effectOfChange(10_000_000, 8_000_000), "Decrease");
    assert.equal(effectOfChange(600, 0), "Decrease");
    assert.equal(effectOfChange(600.004, 600), null, "a difference below a cent is none");
    assert.equal(adjustmentKind(["Increase", "Increase"]), "Increase");
    assert.equal(adjustmentKind(["Increase", "Decrease"]), "Mixed");
    assert.equal(adjustmentKind([]), null);
  });

  test("only books carrying allows_item_adjustment are adjustable, and the seed flags three", async () => {
    const flagged = await prisma.sysBudgetCategory.findMany({
      where: { allows_item_adjustment: true },
      select: { category_label: true },
    });
    const labels = flagged.map((f) => f.category_label);
    for (const off of ["Prive", "Investasi", "Hasil Investasi", "Asset", "Biaya"]) {
      assert.ok(!labels.includes(off), `${off} must not allow a Penyesuaian Open Item`);
    }

    const partner = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const checked = await checkItemAdjustmentHeader(
      {
        budget_category_id: await budgetCategoryId("Prive"),
        partner_id: partner,
        currency_id: idr,
        exchange_rate: null,
      },
      [induk, anak]
    );
    assert.equal(checked.ok, false);
    assert.ok(!checked.ok && checked.errors.budget_category_id);
  });

  test("the flag cannot be set on a category that keeps no book", async () => {
    await assert.rejects(
      prisma.sysBudgetCategory.update({
        where: { id: await budgetCategoryId("Biaya") },
        data: { allows_item_adjustment: true },
      }),
      /sys_budget_category_item_adjustment_needs_book/
    );
  });

  test("every adjustment is numbered in the one PYO- series", async () => {
    assert.match(await nextItemAdjustmentNo(), /^PYO-\d{4,}$/);
  });
});

// ------------------------------------------------------------------ the header

describe("the header", () => {
  const header = (partner: number, overrides: Record<string, unknown> = {}) => ({
    budget_category_id: piutang.categoryId,
    partner_id: partner,
    currency_id: idr,
    exchange_rate: null,
    ...overrides,
  });

  test("an inactive Partner is refused", async () => {
    const partner = await makePartner({
      companyId: induk,
      categoryLabel: "Karyawan",
      status: "Inactive",
    });
    const checked = await checkItemAdjustmentHeader(header(partner) as never, [induk]);
    assert.ok(!checked.ok && checked.errors.partner_id);
  });

  test("a Partner outside the reader's Companies reads as not found", async () => {
    const partner = await makePartner({ companyId: anak, categoryLabel: "Karyawan" });
    const checked = await checkItemAdjustmentHeader(header(partner) as never, [induk]);
    assert.ok(!checked.ok && /tidak ditemukan/.test(checked.errors.partner_id));
  });

  test("a Partner of a category the book does not admit is refused", async () => {
    // Titipan admits Cabang and Stakeholder, never Karyawan.
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const titipan = subledgerForCategory(books, await budgetCategoryId("Titipan"))!;
    const checked = await checkItemAdjustmentHeader(
      header(partner, { budget_category_id: titipan.categoryId }) as never,
      [induk]
    );
    assert.ok(!checked.ok && checked.errors.partner_id);
  });

  test("no kurs is taken: each item moves at its own", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const plain = await checkItemAdjustmentHeader(
      header(partner, { currency_id: foreign }) as never,
      [induk]
    );
    assert.ok(plain.ok);
    const withRate = await checkItemAdjustmentHeader(
      header(partner, { currency_id: foreign, exchange_rate: 16000 }) as never,
      [induk]
    );
    assert.ok(!withRate.ok && withRate.errors.exchange_rate);
  });
});

// ------------------------------------------------------------------- lines

describe("the lines", () => {
  const resolved = async (partner: number, currencyId = idr) => {
    const h = await checkItemAdjustmentHeader(
      {
        budget_category_id: piutang.categoryId,
        partner_id: partner,
        currency_id: currencyId,
        exchange_rate: null,
      },
      [induk]
    );
    assert.ok(h.ok);
    return h as ResolvedItemAdjustmentHeader;
  };

  test("a new value reads as a Penambahan or a Pengurangan, and the line describes itself", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 10_000_000);
    const b = await seedItem(piutang, partner, idr, 4_000_000);
    const h = await resolved(partner);
    const checked = await checkItemAdjustmentLines(h, [
      { item_id: a, new_amount: 12_000_000 },
      { item_id: b, new_amount: 1_000_000 },
    ]);
    assert.ok(checked.ok, JSON.stringify(checked));
    const [up, down] = checked.lines;
    const [ia, ib] = await subledgerItemsByIds([a, b]).then((xs) =>
      [a, b].map((id) => xs.find((x) => x.id === id)!)
    );
    assert.deepEqual(
      [up.effect, up.amount, up.balanceBefore, up.newAmount],
      ["Increase", 2_000_000, 10_000_000, 12_000_000]
    );
    assert.deepEqual([down.effect, down.amount], ["Decrease", 3_000_000]);
    assert.equal(checked.total, -1_000_000, "the net change: raised less lowered");
    assert.match(up.description, new RegExp(`^Penambahan .*2\\.000\\.000.* atas ${ia.itemNo}$`));
    assert.match(down.description, new RegExp(`^Pengurangan .*3\\.000\\.000.* atas ${ib.itemNo}$`));
  });

  test("a value equal to the item's, below nil, or missing is refused; nil itself is allowed", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 100_000);
    const h = await resolved(partner);
    assert.equal((await checkItemAdjustmentLines(h, [])).ok, false);
    const same = await checkItemAdjustmentLines(h, [{ item_id: a, new_amount: 100_000 }]);
    assert.ok(!same.ok && /sama dengan/.test(same.errors._lines));
    const negative = await checkItemAdjustmentLines(h, [{ item_id: a, new_amount: -1 }]);
    assert.ok(!negative.ok && /di bawah nol/.test(negative.errors._lines));
    const blank = await checkItemAdjustmentLines(h, [{ item_id: a, new_amount: null }]);
    assert.ok(!blank.ok && /Nilai Baru/.test(blank.errors._lines));
    const noItem = await checkItemAdjustmentLines(h, [{ item_id: null, new_amount: 5 }]);
    assert.equal(noItem.ok, false, "a line never opens an item of its own");
    const nil = await checkItemAdjustmentLines(h, [{ item_id: a, new_amount: 0 }]);
    assert.ok(nil.ok && nil.lines[0].effect === "Decrease" && nil.lines[0].amount === 100_000);
  });

  test("an item of another position, or an item twice, is refused", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const other = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const mine = await seedItem(piutang, partner, idr, 100_000);
    const theirs = await seedItem(piutang, other, idr, 100_000);
    const h = await resolved(partner);

    const wrong = await checkItemAdjustmentLines(h, [{ item_id: theirs, new_amount: 10 }]);
    assert.ok(!wrong.ok && /bukan milik/.test(wrong.errors._lines));

    const twice = await checkItemAdjustmentLines(h, [
      { item_id: mine, new_amount: 50_000 },
      { item_id: mine, new_amount: 20_000 },
    ]);
    assert.ok(!twice.ok && /sekali per dokumen/.test(twice.errors._lines));
  });

  test("a settled item cannot be adjusted either way", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 50_000);
    const settle = await makeAdjustment({ book: piutang, partnerId: partner, lines: [[a, 0]] });
    assert.ok((await applyItemAdjustment(settle, actor)).ok);
    for (const value of [10_000, 0]) {
      const checked = await checkItemAdjustmentLines(await resolved(partner), [
        { item_id: a, new_amount: value },
      ]);
      assert.ok(!checked.ok && /sudah selesai/.test(checked.errors._lines), String(value));
    }
  });

  test("a line stated against another balance is refused", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 100_000);
    const stale = await checkItemAdjustmentLines(await resolved(partner), [
      { item_id: a, new_amount: 80_000, balance_before: 90_000 },
    ]);
    assert.ok(!stale.ok && /berubah sejak/.test(stale.errors._lines));
  });
});

// ------------------------------------------------------------------ posting

describe("posting", () => {
  test("a Draft adjusts nothing", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 500_000);
    await makeAdjustment({ book: piutang, partnerId: partner, lines: [[a, 300_000]] });
    assert.deepEqual(await position(piutang, partner), { foreign: 500_000, base: 500_000 });
  });

  test("10m typed as 12m raises the item itself, and credits Pendapatan Penyesuaian on a Piutang", async () => {
    // The user's case: the same item, a new ledger line on it, no second item.
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 10_000_000);
    const id = await makeAdjustment({ book: piutang, partnerId: partner, lines: [[a, 12_000_000]] });
    const posted = await applyItemAdjustment(id, actor);
    assert.ok(posted.ok && posted.baseAmount === 2_000_000, JSON.stringify(posted));
    assert.deepEqual(await position(piutang, partner), { foreign: 12_000_000, base: 12_000_000 });

    const raised = await item(a);
    assert.deepEqual(
      [raised.balance.toNumber(), raised.original.toNumber(), raised.status, raised.entry_count],
      [12_000_000, 10_000_000, "Open", 2],
      "the item grows; what it was raised by stays its history"
    );
    const count = await prisma.subLedgerBalance.count({
      where: { budget_category_id: piutang.categoryId, partner_id: partner },
    });
    assert.equal(count, 1, "no new open item");

    const journal = await journalOf(id);
    const partnerLine = journal.lines.find((l) => l.account_id === piutangAccount)!;
    assert.equal(partnerLine.debit_amount.toNumber(), 2_000_000);
    assert.equal(partnerLine.partner_id, partner);
    assert.equal(journal.lines.find((l) => l.account_id === incomeAccount)!.kredit_amount.toNumber(), 2_000_000);
  });

  test("10m typed as 8m lowers it, and an item typed as nil clears, debiting Beban Penyesuaian", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 10_000_000);
    const b = await seedItem(piutang, partner, idr, 400_000);
    const id = await makeAdjustment({
      book: piutang,
      partnerId: partner,
      lines: [
        [a, 8_000_000],
        [b, 0],
      ],
    });

    const posted = await applyItemAdjustment(id, actor);
    assert.ok(posted.ok && posted.baseAmount === -2_400_000, JSON.stringify(posted));
    assert.deepEqual(await position(piutang, partner), { foreign: 8_000_000, base: 8_000_000 });
    assert.equal((await item(a)).balance.toNumber(), 8_000_000);
    assert.equal((await item(b)).status, "Cleared");

    const entries = await prisma.subLedger.findMany({
      where: { source_doc_id: id, source_doc_type: { doc_table: "fin_item_adjustment" } },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(
      entries.map((e) => [e.balance_id, e.entry_type, e.movement.toNumber()]),
      [
        [a, "Adjustment", -2_000_000],
        [b, "Adjustment", -400_000],
      ],
      "one entry per line, each naming its item"
    );
    assert.match(entries[0].note ?? "", /PYO-\d+ — Pengurangan .* atas SBI-/);

    const journal = await journalOf(id);
    const partnerLines = journal.lines.filter((l) => l.account_id === piutangAccount);
    assert.deepEqual(partnerLines.map((l) => l.kredit_amount.toNumber()), [2_000_000, 400_000]);
    const counter = journal.lines.filter((l) => l.account_id === expenseAccount);
    assert.deepEqual(counter.map((l) => l.debit_amount.toNumber()), [2_000_000, 400_000]);

    const doc = await prisma.finItemAdjustment.findUniqueOrThrow({ where: { id } });
    assert.equal(doc.status, "Posted");
    assert.equal(doc.adjustment_amount.toNumber(), -2_400_000, "the net change, signed");
    assert.equal((await applyItemAdjustment(id, actor)).ok, false, "a posted adjustment is final");
  });

  test("one document may raise one item and lower another, each against its own counter account", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 1_000_000);
    const b = await seedItem(piutang, partner, idr, 1_000_000);
    const id = await makeAdjustment({
      book: piutang,
      partnerId: partner,
      lines: [
        [a, 1_300_000],
        [b, 900_000],
      ],
    });
    const posted = await applyItemAdjustment(id, actor);
    assert.ok(posted.ok && posted.baseAmount === 200_000, JSON.stringify(posted));
    assert.deepEqual(await position(piutang, partner), { foreign: 2_200_000, base: 2_200_000 });
    assert.ok(await balanced(id));
    const journal = await journalOf(id);
    assert.equal(journal.lines.find((l) => l.account_id === incomeAccount)!.kredit_amount.toNumber(), 300_000);
    assert.equal(journal.lines.find((l) => l.account_id === expenseAccount)!.debit_amount.toNumber(), 100_000);
  });

  test("a Hutang typed as nil is debited, crediting Pendapatan Penyesuaian", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(hutang, partner, idr, 500_000);
    const id = await makeAdjustment({ book: hutang, partnerId: partner, lines: [[a, 0]] });
    assert.ok((await applyItemAdjustment(id, actor)).ok);
    assert.deepEqual(await position(hutang, partner), { foreign: 0, base: 0 });
    const journal = await journalOf(id);
    assert.equal(journal.lines.find((l) => l.account_id === hutangAccount)!.debit_amount.toNumber(), 500_000);
    assert.equal(journal.lines.find((l) => l.account_id === incomeAccount)!.kredit_amount.toNumber(), 500_000);
  });

  test("a foreign item moves at its own kurs both ways — USD 600 @ 15.000 to 800, then to 450, then nil", async () => {
    // The worked example agreed with the user, beside an item at another kurs
    // so an average of the two would show.
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    await seedItem(piutang, partner, foreign, 1_000, 16_000);
    const a = await seedItem(piutang, partner, foreign, 600, 15_000);

    const up = await makeAdjustment({ book: piutang, partnerId: partner, currencyId: foreign, lines: [[a, 800]] });
    const raised = await applyItemAdjustment(up, actor);
    assert.ok(raised.ok && raised.baseAmount === 3_000_000, JSON.stringify(raised));
    assert.ok(await balanced(up), "no FX difference");
    let held = await item(a);
    assert.deepEqual(
      [held.balance.toNumber(), held.base_balance.toNumber(), held.rate.toNumber()],
      [800, 12_000_000, 15_000]
    );

    const down = await makeAdjustment({ book: piutang, partnerId: partner, currencyId: foreign, lines: [[a, 450]] });
    const lowered = await applyItemAdjustment(down, actor);
    assert.ok(lowered.ok && lowered.baseAmount === -5_250_000, JSON.stringify(lowered));
    held = await item(a);
    assert.deepEqual([held.balance.toNumber(), held.base_balance.toNumber()], [450, 6_750_000]);

    const nil = await makeAdjustment({ book: piutang, partnerId: partner, currencyId: foreign, lines: [[a, 0]] });
    assert.ok((await applyItemAdjustment(nil, actor)).ok);
    held = await item(a);
    assert.deepEqual(
      [held.balance.toNumber(), held.base_balance.toNumber(), held.status],
      [0, 0, "Cleared"],
      "taking an item to nil releases its remaining base exactly"
    );
  });

  test("a saved draft already states what Post writes", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, foreign, 1_000, 15_500);
    const b = await seedItem(piutang, partner, foreign, 1_000, 16_000);
    const id = await makeAdjustment({
      book: piutang,
      partnerId: partner,
      currencyId: foreign,
      lines: [
        [a, 900],
        [b, 1_300],
      ],
    });
    const h = await checkItemAdjustmentHeader(
      { budget_category_id: piutang.categoryId, partner_id: partner, currency_id: foreign, exchange_rate: null },
      [induk]
    );
    assert.ok(h.ok);
    const checked = await checkItemAdjustmentLines(h as ResolvedItemAdjustmentHeader, [
      { item_id: a, new_amount: 900 },
      { item_id: b, new_amount: 1_300 },
    ]);
    assert.ok(checked.ok);
    await prisma.$transaction((tx) =>
      valueItemAdjustmentDraft(tx, id, h as ResolvedItemAdjustmentHeader, checked.lines, actor)
    );

    const figures = async () => {
      const doc = await prisma.finItemAdjustment.findUniqueOrThrow({
        where: { id },
        include: { lines: { orderBy: { sequence_no: "asc" } } },
      });
      return {
        total: doc.adjustment_base_amount.toNumber(),
        lines: doc.lines.map((l) => l.base_amount.toNumber()),
      };
    };
    const drafted = await figures();
    assert.deepEqual(drafted, { total: 3_250_000, lines: [1_550_000, 4_800_000] });
    assert.ok((await applyItemAdjustment(id, actor)).ok);
    assert.deepEqual(await figures(), drafted, "Post writes what the draft stated");
  });

  test("an item that moved since the draft refuses at Post and writes nothing", async () => {
    // 10m typed as 8m; someone settles 3m meanwhile. Posting would now *raise*
    // the item from 7m to 8m — the opposite of what was typed.
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 10_000_000);
    const id = await makeAdjustment({ book: piutang, partnerId: partner, lines: [[a, 8_000_000]] });
    await lowerItem(piutang, partner, idr, a, 3_000_000);
    const refused = await applyItemAdjustment(id, actor);
    assert.ok(!refused.ok && /berubah sejak/.test(refused.errors._form), JSON.stringify(refused));
    assert.deepEqual(await position(piutang, partner), { foreign: 7_000_000, base: 7_000_000 });
    const doc = await prisma.finItemAdjustment.findUniqueOrThrow({ where: { id } });
    assert.equal(doc.status, "Draft");
  });

  test("an adjustment waits for the position, and refuses what the writer before it changed", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 100_000);
    const id = await makeAdjustment({ book: piutang, partnerId: partner, lines: [[a, 0]] });

    // Another writer holds the position and settles the whole item, slowly.
    // Racing two posts against each other proved nothing — they rarely
    // overlap — so the overlap is made certain: Post starts while this
    // transaction is open, and must wait for it and then find the item spent.
    const holder = prisma.$transaction(
      async (tx) => {
        await lockSubledgerPosition(tx, piutang.categoryId, partner, idr);
        await new Promise((r) => setTimeout(r, 500));
        await recordSubledgerEntry(tx, {
          book: piutang,
          partnerId: partner,
          currencyId: idr,
          date: today(),
          type: "Transaction",
          direction: piutang.raises === "Out" ? "In" : "Out",
          amount: 100_000,
          rate: 1,
          itemId: a,
          note: `${FIXTURE_PREFIX} other writer`,
          actorId: actor,
        });
      },
      { timeout: 10_000 }
    );
    await new Promise((r) => setTimeout(r, 100));

    const result = await applyItemAdjustment(id, actor);
    await holder;

    assert.equal(result.ok, false, "the adjustment must see the item already spent");
    assert.deepEqual(await position(piutang, partner), { foreign: 0, base: 0 });
  });

  test("a missing counter account refuses by name, and nothing moves", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 100_000);
    const id = await makeAdjustment({ book: piutang, partnerId: partner, lines: [[a, 90_000]] });
    await setSystemAccount("induk", "adjustment_expense", null);
    try {
      const refused = await applyItemAdjustment(id, actor);
      assert.ok(!refused.ok && /Beban Penyesuaian/.test(refused.errors._form));
      assert.deepEqual(await position(piutang, partner), { foreign: 100_000, base: 100_000 });
    } finally {
      await setSystemAccount("induk", "adjustment_expense", expenseAccount);
    }
  });

  test("a line saved before new values existed refuses until it is restated", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 100_000);
    const id = await makeAdjustment({ book: piutang, partnerId: partner, lines: [[a, 90_000]] });
    await prisma.finItemAdjustmentLine.updateMany({
      where: { adjustment_id: id },
      data: { balance_before: null, new_amount: null },
    });
    const refused = await applyItemAdjustment(id, actor);
    assert.ok(!refused.ok && /Nilai Baru/.test(refused.errors._form));
  });

  test("a closed year refuses the adjustment", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 100_000);
    const id = await makeAdjustment({ book: piutang, partnerId: partner, lines: [[a, 110_000]] });
    const reopen = await closeYearFor(fiscalYear, induk);
    try {
      assert.equal((await applyItemAdjustment(id, actor)).ok, false);
    } finally {
      await reopen();
    }
  });

  test("the anak adjusts its own book directly — no funding route", async () => {
    await makeMapping({
      companyId: anak,
      budgetCategoryLabel: "Piutang",
      partnerCategoryLabel: "Karyawan",
      accountId: await makeAccount({
        companyId: anak,
        subcategoryLabel: "1.1.4",
        partnerCategoryLabel: "Karyawan",
      }),
    });
    await setSystemAccount(
      "anak",
      "adjustment_expense",
      await makeAccount({ companyId: anak, subcategoryLabel: "5.3.1" })
    );
    const partner = await makePartner({ companyId: anak, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 40_000);
    const id = await makeAdjustment({ book: piutang, partnerId: partner, companyId: anak, lines: [[a, 0]] });
    const posted = await applyItemAdjustment(id, actor);
    assert.ok(posted.ok, JSON.stringify(posted));
    assert.equal((await journalOf(id)).company_id, anak);
  });
});

// ------------------------------------------------------------------ settings

describe("the counter accounts", () => {
  test("an account a book already reconciles against is refused as a counter account", async () => {
    const refusal = await checkSystemAccountValue(induk, "adjustment_income", piutangAccount);
    assert.ok(refusal && /direkonsiliasi/.test(refusal), String(refusal));
    assert.equal(await checkSystemAccountValue(induk, "adjustment_income", incomeAccount), null);
  });
});
