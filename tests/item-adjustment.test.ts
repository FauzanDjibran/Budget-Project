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
  type ItemAdjustmentEffect,
} from "../src/lib/siba/item-adjustment-workflow";
import {
  lockSubledgerPosition,
  recordSubledgerEntry,
  subledgerPosition,
} from "../src/lib/siba/subledger";
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
 * Penyesuaian Open Item — the adjustment document that replaced Debit / Credit
 * Note.
 *
 * What the feature lives or dies by, none of it visible on a screen:
 *
 *   1. **One rule signs every book.** Tambah raises and Kurangi lowers, in
 *      every book; the book's own `raises` turns that into a side of the
 *      journal. Nothing per book.
 *   2. **Tambah opens, Kurangi settles.** A Tambah line opens one open item at
 *      the entered kurs; a Kurangi line settles the items it names, each at its
 *      own kurs — never an average of the position.
 *   3. **The book and the journal agree**, with the Pendapatan Penyesuaian
 *      account credited and the Beban Penyesuaian account debited.
 *   4. **Nothing goes below zero** — refused at save, and again at Post under a
 *      lock, so two writers cannot both spend one item.
 *   5. **A draft states what Post writes.**
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

/**
 * A Draft, written straight into the table — so a test can also hold one the
 * save path would refuse, the way a draft looks once an item it chose has been
 * settled since.
 */
async function makeAdjustment(options: {
  effect: ItemAdjustmentEffect;
  book: SubledgerDef;
  partnerId: number;
  companyId?: number;
  currencyId?: number;
  rate?: number | null;
  lines: { description: string; amount?: number; items?: [number, number][] }[];
}): Promise<number> {
  const currencyId = options.currencyId ?? idr;
  const amounts = options.lines.map((l) =>
    l.items ? l.items.reduce((t, [, a]) => t + a, 0) : l.amount ?? 0
  );
  const row = await prisma.finItemAdjustment.create({
    data: {
      adjustment_no: await nextItemAdjustmentNo(),
      effect: options.effect,
      document_date: new Date(`${today()}T00:00:00Z`),
      company_id: options.companyId ?? induk,
      budget_category_id: options.book.categoryId,
      partner_id: options.partnerId,
      currency_id: currencyId,
      exchange_rate:
        options.rate !== undefined
          ? options.rate
          : options.effect === "Increase" && currencyId === idr
            ? 1
            : null,
      adjustment_amount: amounts.reduce((t, a) => t + a, 0),
      status: "Draft",
      created_by: actor,
      lines: {
        create: options.lines.map((l, i) => ({
          sequence_no: i + 1,
          description: l.description,
          amount: amounts[i],
          created_by: actor,
          items: {
            create: (l.items ?? []).map(([itemId, amount], k) => ({
              sequence_no: k + 1,
              sub_ledger_balance_id: itemId,
              amount,
              created_by: actor,
            })),
          },
        })),
      },
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
  test("Tambah raises and Kurangi lowers, in a book money leaving raises and one it lowers", () => {
    const moves = (book: SubledgerDef, effect: ItemAdjustmentEffect) =>
      subledgerMovement(book, adjustmentDirection(effect, book.raises), 100);
    assert.equal(moves(piutang, "Increase"), 100);
    assert.equal(moves(piutang, "Decrease"), -100);
    assert.equal(moves(hutang, "Increase"), 100);
    assert.equal(moves(hutang, "Decrease"), -100);
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
        effect: "Increase",
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
    effect: "Decrease",
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

  test("a foreign Tambah needs a kurs; a Kurangi takes none", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });

    const noRate = await checkItemAdjustmentHeader(
      header(partner, { effect: "Increase", currency_id: foreign }) as never,
      [induk]
    );
    assert.ok(!noRate.ok && noRate.errors.exchange_rate);

    const raise = await checkItemAdjustmentHeader(
      header(partner, { effect: "Increase", currency_id: foreign, exchange_rate: 16000 }) as never,
      [induk]
    );
    assert.ok(raise.ok && raise.direction === "Out" && raise.rate === 16000);

    const lowerWithRate = await checkItemAdjustmentHeader(
      header(partner, { currency_id: foreign, exchange_rate: 16000 }) as never,
      [induk]
    );
    assert.ok(!lowerWithRate.ok && lowerWithRate.errors.exchange_rate);

    const lower = await checkItemAdjustmentHeader(header(partner) as never, [induk]);
    assert.ok(lower.ok && lower.rate === null && lower.direction === "In");
  });
});

// ------------------------------------------------------------------- lines

describe("the lines", () => {
  const resolved = async (effect: ItemAdjustmentEffect, partner: number) => {
    const h = await checkItemAdjustmentHeader(
      {
        effect,
        budget_category_id: piutang.categoryId,
        partner_id: partner,
        currency_id: idr,
        exchange_rate: null,
      },
      [induk]
    );
    assert.ok(h.ok);
    return h as ResolvedItemAdjustmentHeader;
  };

  test("a Tambah line needs a reason and a positive amount, and chooses no item", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const h = await resolved("Increase", partner);
    assert.equal((await checkItemAdjustmentLines(h, [])).ok, false);
    assert.equal((await checkItemAdjustmentLines(h, [{ description: "", amount: 10 }])).ok, false);
    assert.equal((await checkItemAdjustmentLines(h, [{ description: "Denda", amount: 0 }])).ok, false);
    const withItem = await checkItemAdjustmentLines(h, [
      { description: "Denda", amount: 10, items: [{ item_id: 1, amount: 10 }] },
    ]);
    assert.equal(withItem.ok, false);
    const ok = await checkItemAdjustmentLines(h, [
      { description: "Denda", amount: 100 },
      { description: "Bunga", amount: 250.5 },
    ]);
    assert.ok(ok.ok && ok.total === 350.5);
  });

  test("a Kurangi line is worth its items, and must name at least one", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 100_000);
    const h = await resolved("Decrease", partner);
    const none = await checkItemAdjustmentLines(h, [{ description: "Diskon", amount: 5_000 }]);
    assert.equal(none.ok, false);
    const ok = await checkItemAdjustmentLines(h, [
      // A typed amount is ignored: the line is what its items add up to.
      { description: "Diskon", amount: 1, items: [{ item_id: a, amount: 30_000 }] },
    ]);
    assert.ok(ok.ok && ok.total === 30_000 && ok.lines[0].amount === 30_000);
  });

  test("an item of another position, an item twice, or more than an item holds is refused", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const other = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const mine = await seedItem(piutang, partner, idr, 100_000);
    const theirs = await seedItem(piutang, other, idr, 100_000);
    const h = await resolved("Decrease", partner);

    const wrong = await checkItemAdjustmentLines(h, [
      { description: "X", amount: 0, items: [{ item_id: theirs, amount: 10 }] },
    ]);
    assert.ok(!wrong.ok && /bukan milik/.test(wrong.errors._lines));

    const twice = await checkItemAdjustmentLines(h, [
      { description: "X", amount: 0, items: [{ item_id: mine, amount: 10 }, { item_id: mine, amount: 10 }] },
    ]);
    assert.equal(twice.ok, false);

    // Two lines may take one item, but not more than it holds between them.
    const over = await checkItemAdjustmentLines(h, [
      { description: "X", amount: 0, items: [{ item_id: mine, amount: 60_000 }] },
      { description: "Y", amount: 0, items: [{ item_id: mine, amount: 60_000 }] },
    ]);
    assert.ok(!over.ok && /tidak cukup/.test(over.errors._lines));
  });
});

// ------------------------------------------------------------------ posting

describe("posting", () => {
  test("a Draft adjusts nothing", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 500_000);
    await makeAdjustment({
      effect: "Decrease",
      book: piutang,
      partnerId: partner,
      lines: [{ description: "X", items: [[a, 200_000]] }],
    });
    assert.deepEqual(await position(piutang, partner), { foreign: 500_000, base: 500_000 });
  });

  test("a Tambah opens one item per line, and credits Pendapatan Penyesuaian on a Piutang", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const id = await makeAdjustment({
      effect: "Increase",
      book: piutang,
      partnerId: partner,
      lines: [
        { description: "Denda keterlambatan", amount: 75_000 },
        { description: "Bunga", amount: 25_000 },
      ],
    });
    const posted = await applyItemAdjustment(id, actor);
    assert.ok(posted.ok && posted.baseAmount === 100_000, JSON.stringify(posted));
    assert.deepEqual(await position(piutang, partner), { foreign: 100_000, base: 100_000 });

    const lines = await prisma.finItemAdjustmentLine.findMany({
      where: { adjustment_id: id },
      orderBy: { sequence_no: "asc" },
    });
    assert.ok(lines.every((l) => l.opened_item_id), "each line records the item it opened");
    const opened = await Promise.all(lines.map((l) => item(l.opened_item_id!)));
    assert.deepEqual(
      opened.map((o) => o.balance.toNumber()),
      [75_000, 25_000],
      "one open item per line"
    );

    const journal = await journalOf(id);
    const partnerLines = journal.lines.filter((l) => l.account_id === piutangAccount);
    assert.deepEqual(partnerLines.map((l) => l.debit_amount.toNumber()), [75_000, 25_000]);
    assert.ok(partnerLines.every((l) => l.partner_id === partner));
    const counter = journal.lines.filter((l) => l.account_id === incomeAccount);
    assert.deepEqual(counter.map((l) => l.kredit_amount.toNumber()), [75_000, 25_000]);
  });

  test("a Kurangi settles the chosen items, and debits Beban Penyesuaian on a Piutang", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 600_000);
    const b = await seedItem(piutang, partner, idr, 400_000);
    const id = await makeAdjustment({
      effect: "Decrease",
      book: piutang,
      partnerId: partner,
      lines: [
        { description: "Diskon pelunasan", items: [[a, 100_000]] },
        { description: "Retur barang", items: [[a, 200_000], [b, 400_000]] },
      ],
    });

    const posted = await applyItemAdjustment(id, actor);
    assert.ok(posted.ok, JSON.stringify(posted));
    assert.deepEqual(await position(piutang, partner), { foreign: 300_000, base: 300_000 });
    assert.equal((await item(a)).balance.toNumber(), 300_000);
    assert.equal((await item(b)).status, "Cleared");

    const entries = await prisma.subLedger.findMany({
      where: { source_doc_id: id, source_doc_type: { doc_table: "fin_item_adjustment" } },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(
      entries.map((e) => [e.balance_id, e.entry_type, e.movement.toNumber()]),
      [
        [a, "Adjustment", -100_000],
        [a, "Adjustment", -200_000],
        [b, "Adjustment", -400_000],
      ],
      "one entry per item settled, each naming its item"
    );

    const journal = await journalOf(id);
    const partnerLines = journal.lines.filter((l) => l.account_id === piutangAccount);
    assert.deepEqual(partnerLines.map((l) => l.kredit_amount.toNumber()), [100_000, 600_000]);
    const counter = journal.lines.filter((l) => l.account_id === expenseAccount);
    assert.deepEqual(counter.map((l) => l.debit_amount.toNumber()), [100_000, 600_000]);

    const doc = await prisma.finItemAdjustment.findUniqueOrThrow({ where: { id } });
    assert.equal(doc.status, "Posted");
    assert.equal(doc.adjustment_base_amount.toNumber(), 700_000);
    assert.equal((await applyItemAdjustment(id, actor)).ok, false, "a posted adjustment is final");
  });

  test("a Kurangi lowers a Hutang to nil, debiting it and crediting Pendapatan Penyesuaian", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(hutang, partner, idr, 500_000);
    const id = await makeAdjustment({
      effect: "Decrease",
      book: hutang,
      partnerId: partner,
      lines: [{ description: "Klaim", items: [[a, 500_000]] }],
    });
    assert.ok((await applyItemAdjustment(id, actor)).ok);
    assert.deepEqual(await position(hutang, partner), { foreign: 0, base: 0 });
    const journal = await journalOf(id);
    assert.equal(
      journal.lines.find((l) => l.account_id === hutangAccount)!.debit_amount.toNumber(),
      500_000
    );
    assert.equal(
      journal.lines.find((l) => l.account_id === incomeAccount)!.kredit_amount.toNumber(),
      500_000
    );
  });

  test("a foreign item is relieved at its own kurs, never the position's average", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    // 1.000 at 15.500, then 1.000 at 16.000 — an average of 15.750 nothing reads.
    await seedItem(piutang, partner, foreign, 1_000, 15_500);
    const second = await seedItem(piutang, partner, foreign, 1_000, 16_000);

    const id = await makeAdjustment({
      effect: "Decrease",
      book: piutang,
      partnerId: partner,
      currencyId: foreign,
      lines: [{ description: "Potongan", items: [[second, 200]] }],
    });
    const posted = await applyItemAdjustment(id, actor);
    assert.ok(posted.ok && posted.baseAmount === 3_200_000, JSON.stringify(posted));

    const journal = await journalOf(id);
    const debit = journal.lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0);
    const credit = journal.lines.reduce((t, l) => t + l.kredit_amount.toNumber(), 0);
    assert.equal(debit, credit, "no FX difference: both sides carry the released base");

    const rest = await makeAdjustment({
      effect: "Decrease",
      book: piutang,
      partnerId: partner,
      currencyId: foreign,
      lines: [{ description: "Pelunasan sisa", items: [[second, 800]] }],
    });
    assert.ok((await applyItemAdjustment(rest, actor)).ok);
    const left = await item(second);
    assert.deepEqual(
      [left.balance.toNumber(), left.base_balance.toNumber(), left.status],
      [0, 0, "Cleared"],
      "emptying an item releases its remaining base exactly"
    );
  });

  test("a foreign Tambah originates at the stated kurs", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const id = await makeAdjustment({
      effect: "Increase",
      book: piutang,
      partnerId: partner,
      currencyId: foreign,
      rate: 16_250,
      lines: [{ description: "Tagihan tambahan", amount: 100 }],
    });
    const posted = await applyItemAdjustment(id, actor);
    assert.ok(posted.ok && posted.baseAmount === 1_625_000);
    assert.deepEqual(await position(piutang, partner, foreign), {
      foreign: 100,
      base: 1_625_000,
    });
  });

  test("a saved draft already states what Post writes", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, foreign, 1_000, 15_500);
    const b = await seedItem(piutang, partner, foreign, 1_000, 16_000);
    const id = await makeAdjustment({
      effect: "Decrease",
      book: piutang,
      partnerId: partner,
      currencyId: foreign,
      lines: [{ description: "Diskon", items: [[a, 100], [b, 300]] }],
    });
    const h = await checkItemAdjustmentHeader(
      {
        effect: "Decrease",
        budget_category_id: piutang.categoryId,
        partner_id: partner,
        currency_id: foreign,
        exchange_rate: null,
      },
      [induk]
    );
    assert.ok(h.ok);
    const checked = await checkItemAdjustmentLines(h as ResolvedItemAdjustmentHeader, [
      { description: "Diskon", amount: 0, items: [{ item_id: a, amount: 100 }, { item_id: b, amount: 300 }] },
    ]);
    assert.ok(checked.ok);
    await prisma.$transaction((tx) =>
      valueItemAdjustmentDraft(tx, id, h as ResolvedItemAdjustmentHeader, checked.lines, actor)
    );

    const figures = async () => {
      const doc = await prisma.finItemAdjustment.findUniqueOrThrow({
        where: { id },
        include: { lines: { include: { items: { orderBy: { sequence_no: "asc" } } } } },
      });
      return {
        total: doc.adjustment_base_amount.toNumber(),
        line: doc.lines[0].base_amount.toNumber(),
        items: doc.lines[0].items.map((i) => i.base_amount.toNumber()),
      };
    };
    const drafted = await figures();
    assert.deepEqual(drafted, {
      total: 6_350_000,
      line: 6_350_000,
      items: [1_550_000, 4_800_000],
    });
    assert.ok((await applyItemAdjustment(id, actor)).ok);
    assert.deepEqual(await figures(), drafted, "Post writes what the draft stated");
  });

  test("an item settled since the draft refuses at Post and writes nothing", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 50_000);
    const id = await makeAdjustment({
      effect: "Decrease",
      book: piutang,
      partnerId: partner,
      lines: [{ description: "X", items: [[a, 60_000]] }],
    });
    const refused = await applyItemAdjustment(id, actor);
    assert.ok(!refused.ok && /tidak cukup/.test(refused.errors._form));
    assert.deepEqual(await position(piutang, partner), { foreign: 50_000, base: 50_000 });
    const doc = await prisma.finItemAdjustment.findUniqueOrThrow({ where: { id } });
    assert.equal(doc.status, "Draft");
  });

  test("an adjustment waits for the position, and sees what the writer before it left", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const a = await seedItem(piutang, partner, idr, 100_000);
    const id = await makeAdjustment({
      effect: "Decrease",
      book: piutang,
      partnerId: partner,
      lines: [{ description: "B", items: [[a, 100_000]] }],
    });

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
    const id = await makeAdjustment({
      effect: "Decrease",
      book: piutang,
      partnerId: partner,
      lines: [{ description: "X", items: [[a, 10_000]] }],
    });
    await setSystemAccount("induk", "adjustment_expense", null);
    try {
      const refused = await applyItemAdjustment(id, actor);
      assert.ok(!refused.ok && /Beban Penyesuaian/.test(refused.errors._form));
      assert.deepEqual(await position(piutang, partner), { foreign: 100_000, base: 100_000 });
    } finally {
      await setSystemAccount("induk", "adjustment_expense", expenseAccount);
    }
  });

  test("a closed year refuses the adjustment", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const id = await makeAdjustment({
      effect: "Increase",
      book: piutang,
      partnerId: partner,
      lines: [{ description: "X", amount: 10_000 }],
    });
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
    const id = await makeAdjustment({
      effect: "Decrease",
      book: piutang,
      partnerId: partner,
      companyId: anak,
      lines: [{ description: "Diskon", items: [[a, 40_000]] }],
    });
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
