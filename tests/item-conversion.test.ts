import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { openCashBankBook } from "../src/lib/siba/cash-bank";
import { BASE_CURRENCY_LABEL } from "../src/lib/siba/currency";
import {
  applyConversion,
  checkConversionHeader,
  checkConversionLines,
  nextConversionNo,
  previewConversion,
} from "../src/lib/siba/item-conversion";
import { valueConversionLine } from "../src/lib/siba/item-conversion-valuation";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import { recordSubledgerEntry } from "../src/lib/siba/subledger";
import {
  subledgerForCategory,
  type SubledgerDef,
} from "../src/lib/siba/subledger-catalogue";
import { loadSubledgers } from "../src/lib/siba/subledger-data";
import {
  FIXTURE_PREFIX,
  budgetCategoryId,
  childCompanyId,
  cleanupFiscalYear,
  cleanupFixtures,
  disconnect,
  makeAccount,
  makeMapping,
  makePartner,
  mappingAccountId,
  openFiscalYear,
  parentCompanyId,
  prisma,
  setSystemAccount,
  systemUserId,
} from "./helpers";

/**
 * Pencairan Open Item.
 *
 * The property the document exists for, which no screen shows: **one kurs
 * values both legs, so the journal carries one Selisih Kurs line equal to the
 * gap between what the cash and the items were each carried at.** The first
 * test is the user's own worked example, figure for figure:
 *
 *   25/08  $500.000 received from Jeddah into BCA Cholid USD @ 17.100
 *   03/09  $300.000 Titipan of Adib Food                    @ 17.150
 *   10/09  $100.000 of Adib's Titipan cashed, sold out of BCA Cholid @ 17.300
 *
 *   BCA Cholid USD          Kr 1.710.000.000
 *   BCA Cholid IDR    Db 1.730.000.000
 *   Hutang Titipan    Db 1.715.000.000   (Adib, $100.000 @ 17.150)
 *   Hutang Titipan                       Kr 1.730.000.000   (Adib, Rupiah)
 *   Selisih                              Kr     5.000.000
 *
 * Beside it: the mirror for a book money leaving raises (a Piutang), the
 * preview being the journal, the refusals, and the rollback.
 */

const today = new Date().toISOString().slice(0, 10);

let induk = 0;
let anak = 0;
let actor = 0;
let idr = 0;
let usd = 0;
let fxAccount = 0;
let heldFxAccount: number | null = null;
let books: SubledgerDef[] = [];
let titipan: SubledgerDef;
let piutang: SubledgerDef;
let titipanAccount = 0;
let piutangAccount = 0;

const resources: number[] = [];
const conversions: number[] = [];

async function fixtureCurrency(label: string): Promise<{ id: number; currency_label: string }> {
  const existing = await prisma.refCurrency.findFirst({
    where: { currency_label: label },
    select: { id: true, currency_label: true },
  });
  if (existing) return existing;
  return prisma.refCurrency.create({
    data: {
      currency_code: `curr.${label}`,
      currency_label: label,
      currency_name: `Fixture ${label}`,
      created_by: actor,
    },
    select: { id: true, currency_label: true },
  });
}

async function makeResource(options: {
  currencyId: number;
  opening?: number;
  rate?: number;
  companyId?: number;
}): Promise<number> {
  const companyId = options.companyId ?? induk;
  const account = await makeAccount({ companyId, subcategoryLabel: CASH_BANK_SUBCATEGORY });
  const key = `${FIXTURE_PREFIX}PO${resources.length + 1}${Date.now() % 100000}`;
  const row = await prisma.mCashBank.create({
    data: {
      cash_bank_code: `test.${key}`,
      cash_bank_label: key,
      cash_bank_name: `Fixture ${key}`,
      company_id: companyId,
      cash_bank_type: "Bank",
      currency_id: options.currencyId,
      account_id: account,
      created_by: actor,
    },
    select: { id: true },
  });
  await openCashBankBook(prisma, {
    cashBankId: row.id,
    openingBalance: options.opening ?? 0,
    rate: options.rate ?? 1,
    layered: options.currencyId !== idr,
    date: today,
    actorId: actor,
  });
  resources.push(row.id);
  return row.id;
}

/** A foreign open item, written straight into the book — the deposit that stands. */
async function makeItem(
  book: SubledgerDef,
  partnerId: number,
  amount: number,
  rate: number
): Promise<number> {
  const entry = await prisma.$transaction((tx) =>
    recordSubledgerEntry(tx, {
      book,
      partnerId,
      currencyId: usd,
      date: today,
      type: "Transaction",
      direction: book.raises,
      amount,
      rate,
      note: `${FIXTURE_PREFIX} seed`,
      actorId: actor,
    })
  );
  return entry.balance_id;
}

const layerOf = (cashBankId: number) =>
  prisma.cashBankLayer.findFirstOrThrow({
    where: { cash_bank_id: cashBankId, status: "Open" },
    orderBy: { id: "asc" },
  });

/** A Draft, written the way `createConversion` writes one. */
async function makeConversion(options: {
  from: number;
  book: SubledgerDef;
  partnerId: number;
  lines: { to: number; rate: number; items: [itemId: number, amount: number][] }[];
}): Promise<number> {
  const layer = await layerOf(options.from);
  const total = options.lines.reduce(
    (t, l) => t + l.items.reduce((s, [, a]) => s + a, 0),
    0
  );
  const row = await prisma.finItemConversion.create({
    data: {
      conversion_no: await nextConversionNo(),
      document_date: new Date(`${today}T00:00:00Z`),
      company_id: induk,
      from_cash_bank_id: options.from,
      currency_id: usd,
      cash_bank_layer_id: layer.id,
      budget_category_id: options.book.categoryId,
      partner_id: options.partnerId,
      conversion_amount: total,
      conversion_base_amount: 0,
      status: "Draft",
      created_by: actor,
      lines: {
        create: options.lines.map((l, i) => ({
          sequence_no: i + 1,
          to_cash_bank_id: l.to,
          amount: l.items.reduce((s, [, a]) => s + a, 0),
          exchange_rate: l.rate,
          created_by: actor,
          items: {
            create: l.items.map(([itemId, amount], k) => ({
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
  conversions.push(row.id);
  return row.id;
}

const journalOf = (conversionId: number) =>
  prisma.accJournal.findFirstOrThrow({
    where: {
      source_doc_id: conversionId,
      source_doc_type: { doc_table: "fin_item_conversion" },
    },
    include: { lines: { orderBy: { id: "asc" } } },
  });

const num = (d: { toNumber(): number }) => d.toNumber();

/** The book, the induk's two resources, and a Partner holding a Titipan. */
async function scenario(book: SubledgerDef, itemRate = 17150) {
  const partnerId = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
  const itemId = await makeItem(book, partnerId, 300_000, itemRate);
  const usdBank = await makeResource({ currencyId: usd, opening: 500_000, rate: 17100 });
  const idrBank = await makeResource({ currencyId: idr });
  return { partnerId, itemId, usdBank, idrBank };
}

before(async () => {
  await openFiscalYear();
  induk = await parentCompanyId();
  anak = await childCompanyId();
  actor = await systemUserId();
  idr = (
    await prisma.refCurrency.findFirstOrThrow({
      where: { currency_label: BASE_CURRENCY_LABEL },
      select: { id: true },
    })
  ).id;
  const foreign = await fixtureCurrency("POIA");
  usd = foreign.id;

  books = await loadSubledgers();
  titipan = subledgerForCategory(books, await budgetCategoryId("Titipan"))!;
  piutang = subledgerForCategory(books, await budgetCategoryId("Piutang"))!;

  titipanAccount = await mappingAccountId(
    await makeMapping({
      companyId: induk,
      budgetCategoryLabel: "Titipan",
      partnerCategoryLabel: "Stakeholder",
      accountId: await makeAccount({
        companyId: induk,
        subcategoryLabel: "2.1.1",
        normalBalance: "Kredit",
        partnerCategoryLabel: "Stakeholder",
      }),
    })
  );
  piutangAccount = await mappingAccountId(
    await makeMapping({
      companyId: induk,
      budgetCategoryLabel: "Piutang",
      partnerCategoryLabel: "Stakeholder",
      accountId: await makeAccount({
        companyId: induk,
        subcategoryLabel: "1.1.4",
        partnerCategoryLabel: "Stakeholder",
      }),
    })
  );

  fxAccount = await makeAccount({ companyId: induk, subcategoryLabel: "5.3.1" });
  heldFxAccount = await setSystemAccount("induk", "fx", fxAccount);
});

after(async () => {
  await setSystemAccount("induk", "fx", heldFxAccount);
  if (conversions.length) {
    await prisma.auditLog.deleteMany({
      where: { entity_key: "fin_item_conversion", row_id: { in: conversions } },
    });
    await prisma.finItemConversion.deleteMany({ where: { id: { in: conversions } } });
  }
  if (resources.length) {
    await prisma.cashBankLayer.deleteMany({ where: { cash_bank_id: { in: resources } } });
    await prisma.cashBankLedger.deleteMany({ where: { cash_bank_id: { in: resources } } });
    await prisma.cashBankBalance.deleteMany({ where: { cash_bank_id: { in: resources } } });
    await prisma.mCashBank.deleteMany({ where: { id: { in: resources } } });
  }
  await cleanupFiscalYear();
  await cleanupFixtures();
  await disconnect();
});

// --------------------------------------------------------------- the kernel

describe("one kurs values both legs", () => {
  test("the user's example: one Selisih line of 5.000.000, a gain", () => {
    const v = valueConversionLine({
      amount: 100_000,
      rate: 17300,
      layerReleasedBase: 1_710_000_000,
      layerRate: 17100,
      raisesOnIn: true,
      items: [{ amount: 100_000, releasedBase: 1_715_000_000 }],
    });
    assert.equal(v.inAmount, 1_730_000_000);
    assert.equal(v.cashFx, 20_000_000, "the cash sold above its layer");
    assert.equal(v.itemFxTotal, -15_000_000, "the Titipan now owed at more than it was carried");
    assert.equal(v.fxDifference, 5_000_000);
  });

  test("a book money leaving raises is the mirror: the item side is a gain too", () => {
    const v = valueConversionLine({
      amount: 100_000,
      rate: 17300,
      layerReleasedBase: 1_710_000_000,
      layerRate: 17100,
      raisesOnIn: false,
      items: [{ amount: 100_000, releasedBase: 1_715_000_000 }],
    });
    assert.equal(v.itemFxTotal, 15_000_000);
    assert.equal(v.fxDifference, 35_000_000);
  });

  test("two items share the new item exactly, the last taking the rounding", () => {
    const v = valueConversionLine({
      amount: 100,
      rate: 3.333333,
      layerReleasedBase: 300,
      layerRate: 3,
      raisesOnIn: true,
      items: [
        { amount: 33.33, releasedBase: 100 },
        { amount: 66.67, releasedBase: 200 },
      ],
    });
    assert.equal(
      Math.round((v.shares[0] + v.shares[1]) * 100),
      Math.round(v.inAmount * 100)
    );
  });
});

// ------------------------------------------------------------------ posting

describe("Post writes the journal of the worked example", () => {
  test("Titipan: five lines, one Selisih Kurs credit of 5.000.000", async () => {
    const s = await scenario(titipan);
    const id = await makeConversion({
      from: s.usdBank,
      book: titipan,
      partnerId: s.partnerId,
      lines: [{ to: s.idrBank, rate: 17300, items: [[s.itemId, 100_000]] }],
    });

    const result = await applyConversion(id, actor);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
    assert.equal(result.fxDifference, 5_000_000);

    const journal = await journalOf(id);
    const lines = journal.lines.map((l) => ({
      account: l.account_id,
      partner: l.partner_id,
      debit: num(l.debit_amount),
      kredit: num(l.kredit_amount),
    }));
    assert.equal(lines.length, 5, "cash out, cash in, release, new item, one Selisih");

    const fx = lines.filter((l) => l.account === fxAccount);
    assert.equal(fx.length, 1, "exactly one Selisih Kurs line");
    assert.deepEqual([fx[0].debit, fx[0].kredit], [0, 5_000_000]);

    const partnerLines = lines.filter((l) => l.account === titipanAccount);
    assert.deepEqual(
      partnerLines.map((l) => [l.partner, l.debit, l.kredit]),
      [
        [s.partnerId, 1_715_000_000, 0],
        [s.partnerId, 0, 1_730_000_000],
      ],
      "one account for both currencies, released at 17.150 and owed at 17.300"
    );

    const debit = lines.reduce((t, l) => t + l.debit, 0);
    const kredit = lines.reduce((t, l) => t + l.kredit, 0);
    assert.equal(debit, 3_445_000_000);
    assert.equal(kredit, 3_445_000_000);

    // The books, beside the journal.
    const usdItem = await prisma.subLedgerBalance.findUniqueOrThrow({ where: { id: s.itemId } });
    assert.equal(num(usdItem.balance), 200_000);
    assert.equal(num(usdItem.base_balance), 3_430_000_000, "the rest still at 17.150");

    const line = await prisma.finItemConversionLine.findFirstOrThrow({
      where: { conversion_id: id },
    });
    const opened = await prisma.subLedgerBalance.findUniqueOrThrow({
      where: { id: line.opened_item_id! },
    });
    assert.equal(opened.book, titipan.key, "the same book");
    assert.equal(opened.partner_id, s.partnerId);
    assert.equal(opened.currency_id, idr);
    assert.equal(num(opened.balance), 1_730_000_000);
    assert.equal(num(opened.rate), 1);

    const entries = await prisma.subLedger.findMany({
      where: { source_doc_id: id, source_doc_type: { doc_table: "fin_item_conversion" } },
    });
    assert.equal(entries.length, 2);
    assert.ok(entries.every((e) => e.entry_type === "Conversion"));

    const usdBalance = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: s.usdBank },
    });
    assert.equal(num(usdBalance.balance), 400_000);
    const idrBalance = await prisma.cashBankBalance.findUniqueOrThrow({
      where: { cash_bank_id: s.idrBank },
    });
    assert.equal(num(idrBalance.balance), 1_730_000_000);

    const doc = await prisma.finItemConversion.findUniqueOrThrow({ where: { id } });
    assert.equal(doc.status, "Posted");
    assert.equal(num(doc.fx_difference), 5_000_000);
    assert.equal(num(doc.conversion_base_amount), 1_710_000_000);
  });

  test("Piutang: the release is a credit, the new item a debit, Selisih 35.000.000", async () => {
    const s = await scenario(piutang);
    const id = await makeConversion({
      from: s.usdBank,
      book: piutang,
      partnerId: s.partnerId,
      lines: [{ to: s.idrBank, rate: 17300, items: [[s.itemId, 100_000]] }],
    });
    const result = await applyConversion(id, actor);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
    assert.equal(result.fxDifference, 35_000_000);

    const journal = await journalOf(id);
    const partnerLines = journal.lines
      .filter((l) => l.account_id === piutangAccount)
      .map((l) => [num(l.debit_amount), num(l.kredit_amount)]);
    assert.deepEqual(partnerLines, [
      [0, 1_715_000_000],
      [1_730_000_000, 0],
    ]);
    const fx = journal.lines.filter((l) => l.account_id === fxAccount);
    assert.equal(fx.length, 1);
    assert.equal(num(fx[0].kredit_amount), 35_000_000);
  });

  test("an item split across two destinations still makes one Selisih line", async () => {
    const s = await scenario(titipan);
    const idrBank2 = await makeResource({ currencyId: idr });
    const id = await makeConversion({
      from: s.usdBank,
      book: titipan,
      partnerId: s.partnerId,
      lines: [
        { to: s.idrBank, rate: 17300, items: [[s.itemId, 60_000]] },
        { to: idrBank2, rate: 17250, items: [[s.itemId, 40_000]] },
      ],
    });
    const result = await applyConversion(id, actor);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
    // 60.000 × (17.150 − 17.100) + 40.000 × (17.150 − 17.100): each line's
    // kurs cancels between its two legs.
    assert.equal(result.fxDifference, 5_000_000);
    const journal = await journalOf(id);
    assert.equal(journal.lines.filter((l) => l.account_id === fxAccount).length, 1);
    const item = await prisma.subLedgerBalance.findUniqueOrThrow({ where: { id: s.itemId } });
    assert.equal(num(item.balance), 200_000);
  });
});

describe("the preview is the journal", () => {
  test("a dry run returns the journal Post writes, and writes nothing", async () => {
    const s = await scenario(titipan);
    const id = await makeConversion({
      from: s.usdBank,
      book: titipan,
      partnerId: s.partnerId,
      lines: [{ to: s.idrBank, rate: 17300, items: [[s.itemId, 100_000]] }],
    });
    const before = {
      entries: await prisma.subLedger.count(),
      journals: await prisma.accJournal.count(),
      layer: num((await layerOf(s.usdBank)).foreign_remaining),
    };
    const preview = await previewConversion(id);
    assert.ok(preview.ok);
    assert.equal(await prisma.subLedger.count(), before.entries);
    assert.equal(await prisma.accJournal.count(), before.journals);
    assert.equal(num((await layerOf(s.usdBank)).foreign_remaining), before.layer);

    const posted = await applyConversion(id, actor);
    assert.ok(posted.ok);
    const journal = await journalOf(id);
    assert.deepEqual(
      preview.lines.map((l) => [l.debit, l.credit]),
      journal.lines.map((l) => [num(l.debit_amount), num(l.kredit_amount)])
    );
  });
});

// ---------------------------------------------------------------- refusals

describe("refusals", () => {
  test("a base-currency source is refused by the header", async () => {
    const idrBank = await makeResource({ currencyId: idr });
    const partnerId = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const checked = await checkConversionHeader(
      {
        from_cash_bank_id: idrBank,
        cash_bank_layer_id: null,
        budget_category_id: titipan.categoryId,
        partner_id: partnerId,
      },
      [induk, anak]
    );
    assert.equal(checked.ok, false);
    assert.match(String(!checked.ok && checked.errors.from_cash_bank_id), /valuta asing/);
  });

  test("another Partner's item, a foreign destination and an over-conversion are refused", async () => {
    const s = await scenario(titipan);
    const other = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const otherItem = await makeItem(titipan, other, 1_000, 17000);
    const layer = await layerOf(s.usdBank);
    const header = await checkConversionHeader(
      {
        from_cash_bank_id: s.usdBank,
        cash_bank_layer_id: layer.id,
        budget_category_id: titipan.categoryId,
        partner_id: s.partnerId,
      },
      [induk]
    );
    assert.ok(header.ok);

    const foreignItem = await checkConversionLines(header, [
      { to_cash_bank_id: s.idrBank, exchange_rate: 17300, items: [{ item_id: otherItem, amount: 1_000 }] },
    ]);
    assert.equal(foreignItem.ok, false, "another Partner's item");

    const usdDest = await makeResource({ currencyId: usd, opening: 1, rate: 17000 });
    const foreignDest = await checkConversionLines(header, [
      { to_cash_bank_id: usdDest, exchange_rate: 17300, items: [{ item_id: s.itemId, amount: 1_000 }] },
    ]);
    assert.equal(foreignDest.ok, false, "a destination in the foreign currency");

    const over = await checkConversionLines(header, [
      { to_cash_bank_id: s.idrBank, exchange_rate: 17300, items: [{ item_id: s.itemId, amount: 300_001 }] },
    ]);
    assert.equal(over.ok, false, "more than the item holds");

    const none = await checkConversionLines(header, [
      { to_cash_bank_id: s.idrBank, exchange_rate: 17300, items: [] },
    ]);
    assert.equal(none.ok, false, "a line with no item");

    const fine = await checkConversionLines(header, [
      { to_cash_bank_id: s.idrBank, exchange_rate: 17300, items: [{ item_id: s.itemId, amount: 100_000 }] },
    ]);
    assert.ok(fine.ok);
    assert.equal(fine.ok && fine.lines[0].amount, 100_000, "the line is worth its items");
  });

  test("a missing Selisih Kurs account refuses after the layer was drawn, and rolls it back", async () => {
    const s = await scenario(titipan);
    const id = await makeConversion({
      from: s.usdBank,
      book: titipan,
      partnerId: s.partnerId,
      lines: [{ to: s.idrBank, rate: 17300, items: [[s.itemId, 100_000]] }],
    });
    const layerBefore = num((await layerOf(s.usdBank)).foreign_remaining);
    await setSystemAccount("induk", "fx", null);
    try {
      const result = await applyConversion(id, actor);
      assert.equal(result.ok, false);
      assert.match(String(!result.ok && result.errors._form), /Selisih Kurs/);
    } finally {
      await setSystemAccount("induk", "fx", fxAccount);
    }
    assert.equal(num((await layerOf(s.usdBank)).foreign_remaining), layerBefore);
    const item = await prisma.subLedgerBalance.findUniqueOrThrow({ where: { id: s.itemId } });
    assert.equal(num(item.balance), 300_000);
    const doc = await prisma.finItemConversion.findUniqueOrThrow({ where: { id } });
    assert.equal(doc.status, "Draft");
  });
});

