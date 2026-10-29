import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { BASE_CURRENCY_LABEL } from "../src/lib/siba/currency";
import { checkReclassHeader, checkReclassLines, nextReclassNo, reclassTrail, type ReclassLineInput, type ResolvedReclassHeader } from "../src/lib/siba/item-reclass";
import { applyReclass, previewReclass } from "../src/lib/siba/item-reclass-post";
import { reclassEffect, valueReclassLine } from "../src/lib/siba/item-reclass-valuation";
import { recordSubledgerEntry } from "../src/lib/siba/subledger";
import { subledgerForCategory, type SubledgerDef } from "../src/lib/siba/subledger-catalogue";
import { loadSubledgers } from "../src/lib/siba/subledger-data";
import {
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
 * Reklasifikasi Open Item.
 *
 * The properties the document lives or dies by, none of which a screen shows:
 *
 *   - **The target is posted as the original movement would have been.** A
 *     target running the same way as the source opens one item per source
 *     item at that item's own kurs and base — value carried, so no difference
 *     can arise. One running the other way has its own items settled.
 *   - **A settled item states its own difference, signed from the source's
 *     side.** A held receipt carried at 15.000 applied to a Piutang carried at
 *     16.000 is a loss of 1.000 per dollar; a held payment at 15.000 applied to
 *     a Hutang at 16.000 is a gain of the same.
 *   - **Nothing moves until everything does.**
 */

const today = new Date().toISOString().slice(0, 10);

let induk = 0;
let anak = 0;
let actor = 0;
let idr = 0;
let usd = 0;
let fxAccount = 0;
let heldFxAccount: number | null = null;

let held: SubledgerDef; // Penerimaan Belum Teridentifikasi — raises In
let heldOut: SubledgerDef; // Pengeluaran Belum Teridentifikasi — raises Out
let hutang: SubledgerDef;
let titipan: SubledgerDef;
let piutang: SubledgerDef;

let heldAccount = 0;
let heldOutAccount = 0;
let hutangAccount = 0;
let piutangAccount = 0;

async function fixtureCurrency(label: string): Promise<number> {
  const existing = await prisma.refCurrency.findFirst({
    where: { currency_label: label },
    select: { id: true },
  });
  if (existing) return existing.id;
  const row = await prisma.refCurrency.create({
    data: {
      currency_code: `curr.${label}`,
      currency_label: label,
      currency_name: `Fixture ${label}`,
      created_by: actor,
    },
    select: { id: true },
  });
  return row.id;
}

/** An open item, written straight into the book — the position that stands. */
async function makeItem(
  book: SubledgerDef,
  partnerId: number,
  amount: number,
  rate: number,
  currencyId = usd
): Promise<number> {
  const entry = await prisma.$transaction((tx) =>
    recordSubledgerEntry(tx, {
      book,
      partnerId,
      currencyId,
      date: today,
      type: "Transaction",
      direction: book.raises,
      amount,
      rate,
      note: "ZZTEST held",
      actorId: actor,
    })
  );
  return entry.balance_id;
}

type LineSpec = {
  book: SubledgerDef;
  partnerId: number;
  sources: [itemId: number, amount: number][];
  targets?: [itemId: number, amount: number][];
};

/** A Draft, written the way `createReclass` writes one. */
async function makeReclass(options: {
  book: SubledgerDef;
  partnerId: number;
  currencyId?: number;
  lines: LineSpec[];
}): Promise<number> {
  const sum = (rows: [number, number][]) => rows.reduce((t, [, a]) => t + a, 0);
  const row = await prisma.finItemReclass.create({
    data: {
      reclass_no: await nextReclassNo(),
      accounting_date: new Date(`${today}T00:00:00Z`),
      company_id: induk,
      budget_category_id: options.book.categoryId,
      partner_id: options.partnerId,
      currency_id: options.currencyId ?? usd,
      reclass_amount: options.lines.reduce((t, l) => t + sum(l.sources), 0),
      status: "Draft",
      created_by: actor,
      lines: {
        create: options.lines.map((l, i) => ({
          sequence_no: i + 1,
          target_budget_category_id: l.book.categoryId,
          target_partner_id: l.partnerId,
          amount: sum(l.sources),
          created_by: actor,
          sources: {
            create: l.sources.map(([itemId, amount], k) => ({
              sequence_no: k + 1,
              sub_ledger_balance_id: itemId,
              amount,
              created_by: actor,
            })),
          },
          targets: {
            create: (l.targets ?? []).map(([itemId, amount], k) => ({
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
  return row.id;
}

const journalOf = (reclassId: number) =>
  prisma.accJournal.findFirstOrThrow({
    where: { source_doc_id: reclassId, source_doc_type: { doc_table: "fin_item_reclass" } },
    include: { lines: { orderBy: { id: "asc" } } },
  });

const num = (d: { toNumber(): number }) => d.toNumber();

const itemOf = (id: number) => prisma.subLedgerBalance.findUniqueOrThrow({ where: { id } });

async function mapped(
  bookLabel: string,
  partnerCategory: string,
  subcategoryLabel: string,
  normalBalance: "Debit" | "Kredit"
): Promise<number> {
  return mappingAccountId(
    await makeMapping({
      companyId: induk,
      budgetCategoryLabel: bookLabel,
      partnerCategoryLabel: partnerCategory,
      accountId: await makeAccount({
        companyId: induk,
        subcategoryLabel,
        normalBalance,
        partnerCategoryLabel: partnerCategory,
      }),
    })
  );
}

const header = async (book: SubledgerDef, partnerId: number, currencyId = usd) => {
  const h = await checkReclassHeader(
    { budget_category_id: book.categoryId, partner_id: partnerId, currency_id: currencyId },
    [induk, anak]
  );
  assert.ok(h.ok, JSON.stringify(!h.ok && h.errors));
  return h as ResolvedReclassHeader & { ok: true };
};

const line = (
  book: SubledgerDef,
  partnerId: number,
  sources: [number, number][],
  targets: [number, number][] = []
): ReclassLineInput => ({
  target_budget_category_id: book.categoryId,
  target_partner_id: partnerId,
  description: null,
  sources: sources.map(([item_id, amount]) => ({ item_id, amount })),
  targets: targets.map(([item_id, amount]) => ({ item_id, amount })),
});

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
  usd = await fixtureCurrency("RKLA");

  const books = await loadSubledgers();
  const bookOf = async (label: string) => subledgerForCategory(books, await budgetCategoryId(label))!;
  held = await bookOf("Penerimaan Belum Teridentifikasi");
  heldOut = await bookOf("Pengeluaran Belum Teridentifikasi");
  hutang = await bookOf("Hutang");
  titipan = await bookOf("Titipan");
  piutang = await bookOf("Piutang");

  heldAccount = await mapped("Penerimaan Belum Teridentifikasi", "Lainnya", "2.1.1", "Kredit");
  heldOutAccount = await mapped("Pengeluaran Belum Teridentifikasi", "Lainnya", "1.1.4", "Debit");
  hutangAccount = await mapped("Hutang", "Stakeholder", "2.1.1", "Kredit");
  await mapped("Titipan", "Stakeholder", "2.1.1", "Kredit");
  piutangAccount = await mapped("Piutang", "Stakeholder", "1.1.4", "Debit");

  fxAccount = await makeAccount({ companyId: induk, subcategoryLabel: "5.3.1" });
  heldFxAccount = await setSystemAccount("induk", "fx", fxAccount);
});

after(async () => {
  await setSystemAccount("induk", "fx", heldFxAccount);
  await cleanupFiscalYear();
  await cleanupFixtures();
  await disconnect();
});

// --------------------------------------------------------------- the kernel

describe("the target is posted as the original movement would have been", () => {
  test("a book running the same way opens; the other way settles", () => {
    assert.equal(reclassEffect("In", "In"), "open", "held receipt → Hutang");
    assert.equal(reclassEffect("In", "Out"), "settle", "held receipt → Piutang");
    assert.equal(reclassEffect("Out", "Out"), "open", "held payment → Piutang");
    assert.equal(reclassEffect("Out", "In"), "settle", "held payment → Hutang");
  });

  test("a held receipt at 15.000 applied to a Piutang at 16.000 is a loss", () => {
    const v = valueReclassLine({
      sourceRaises: "In",
      effect: "settle",
      amount: 1_000,
      sourceReleased: [15_000_000],
      targets: [{ amount: 1_000, releasedBase: 16_000_000 }],
    });
    assert.deepEqual(v.fx, [-1_000_000]);
  });

  test("a held payment at 15.000 applied to a Hutang at 16.000 is a gain", () => {
    const v = valueReclassLine({
      sourceRaises: "Out",
      effect: "settle",
      amount: 1_000,
      sourceReleased: [15_000_000],
      targets: [{ amount: 1_000, releasedBase: 16_000_000 }],
    });
    assert.deepEqual(v.fx, [1_000_000]);
  });

  test("opening carries the value, so no difference arises", () => {
    const v = valueReclassLine({
      sourceRaises: "In",
      effect: "open",
      amount: 1_000,
      sourceReleased: [15_000_000],
      targets: [],
    });
    assert.equal(v.releasedBase, 15_000_000);
    assert.equal(v.fxTotal, 0);
  });

  test("settled items share what the source released exactly", () => {
    const v = valueReclassLine({
      sourceRaises: "In",
      effect: "settle",
      amount: 100,
      sourceReleased: [100, 200.01],
      targets: [
        { amount: 33.33, releasedBase: 100 },
        { amount: 66.67, releasedBase: 200 },
      ],
    });
    assert.equal(Math.round((v.shares[0] + v.shares[1]) * 100), Math.round(v.releasedBase * 100));
  });
});

// ------------------------------------------------------------------ posting

describe("Post", () => {
  test("a held receipt moved to a Hutang opens an item at its own kurs", async () => {
    const unknown = await makePartner({ companyId: induk, categoryLabel: "Lainnya" });
    const owner = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const source = await makeItem(held, unknown, 1_000, 15_000);

    const id = await makeReclass({
      book: held,
      partnerId: unknown,
      lines: [{ book: hutang, partnerId: owner, sources: [[source, 1_000]] }],
    });
    const result = await applyReclass(id, actor);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
    assert.equal(result.fxDifference, 0);

    const journal = await journalOf(id);
    assert.deepEqual(
      journal.lines.map((l) => [l.account_id, l.partner_id, num(l.debit_amount), num(l.kredit_amount)]),
      [
        [heldAccount, unknown, 15_000_000, 0],
        [hutangAccount, owner, 0, 15_000_000],
      ]
    );

    assert.equal((await itemOf(source)).status, "Cleared");
    const row = await prisma.finItemReclassLineSource.findFirstOrThrow({
      where: { line: { reclass_id: id } },
    });
    assert.ok(row.opened_item_id, "the clearing link names the item it became");
    const opened = await itemOf(row.opened_item_id!);
    assert.equal(opened.budget_category_id, hutang.categoryId);
    assert.equal(opened.partner_id, owner);
    assert.equal(opened.currency_id, usd);
    assert.equal(num(opened.rate), 15_000, "the source item's kurs, carried");
    assert.equal(num(opened.base_balance), 15_000_000);

    const entries = await prisma.subLedger.findMany({
      where: { source_doc_id: id, source_doc_type: { doc_table: "fin_item_reclass" } },
    });
    assert.equal(entries.length, 2);
    assert.ok(entries.every((e) => e.entry_type === "Reclass"));

    const doc = await prisma.finItemReclass.findUniqueOrThrow({ where: { id } });
    assert.equal(doc.status, "Posted");
    assert.equal(num(doc.reclass_base_amount), 15_000_000);

    // Read forwards from the held item: where its value went.
    const trail = await reclassTrail([source]);
    assert.equal(trail.length, 1);
    assert.equal(trail[0].reclassId, id);
    assert.equal(trail[0].targetBook, hutang.name);
    assert.equal(trail[0].openedItemNo, opened.item_no);
  });

  test("a held receipt applied to a Piutang settles it, with its own loss line", async () => {
    const unknown = await makePartner({ companyId: induk, categoryLabel: "Lainnya" });
    const customer = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const source = await makeItem(held, unknown, 1_000, 15_000);
    const receivable = await makeItem(piutang, customer, 1_000, 16_000);

    const id = await makeReclass({
      book: held,
      partnerId: unknown,
      lines: [
        { book: piutang, partnerId: customer, sources: [[source, 1_000]], targets: [[receivable, 1_000]] },
      ],
    });
    const result = await applyReclass(id, actor);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
    assert.equal(result.fxDifference, -1_000_000);

    const journal = await journalOf(id);
    assert.deepEqual(
      journal.lines.map((l) => [l.account_id, num(l.debit_amount), num(l.kredit_amount)]),
      [
        [heldAccount, 15_000_000, 0],
        [piutangAccount, 0, 16_000_000],
        [fxAccount, 1_000_000, 0],
      ]
    );
    assert.equal((await itemOf(source)).status, "Cleared");
    assert.equal((await itemOf(receivable)).status, "Cleared");
    const target = await prisma.finItemReclassLineTarget.findFirstOrThrow({
      where: { line: { reclass_id: id } },
    });
    assert.equal(num(target.allocated_base_amount), 15_000_000);
    assert.equal(num(target.settlement_base_amount), 16_000_000);
    assert.equal(num(target.fx_difference), -1_000_000);
  });

  test("a held payment applied to a Hutang settles it, with its own gain line", async () => {
    const unknown = await makePartner({ companyId: induk, categoryLabel: "Lainnya" });
    const supplier = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const source = await makeItem(heldOut, unknown, 1_000, 15_000);
    const payable = await makeItem(hutang, supplier, 1_000, 16_000);

    const id = await makeReclass({
      book: heldOut,
      partnerId: unknown,
      lines: [{ book: hutang, partnerId: supplier, sources: [[source, 1_000]], targets: [[payable, 1_000]] }],
    });
    const result = await applyReclass(id, actor);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
    assert.equal(result.fxDifference, 1_000_000);

    const journal = await journalOf(id);
    assert.deepEqual(
      journal.lines.map((l) => [l.account_id, num(l.debit_amount), num(l.kredit_amount)]),
      [
        [heldOutAccount, 0, 15_000_000],
        [hutangAccount, 16_000_000, 0],
        [fxAccount, 0, 1_000_000],
      ]
    );
  });

  test("one held item split across two books opens one item in each", async () => {
    const unknown = await makePartner({ companyId: induk, categoryLabel: "Lainnya" });
    const a = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const b = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const source = await makeItem(held, unknown, 1_000, 15_000);

    const id = await makeReclass({
      book: held,
      partnerId: unknown,
      lines: [
        { book: hutang, partnerId: a, sources: [[source, 600]] },
        { book: titipan, partnerId: b, sources: [[source, 400]] },
      ],
    });
    const result = await applyReclass(id, actor);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));

    const item = await itemOf(source);
    assert.equal(item.status, "Cleared");
    assert.equal(num(item.base_balance), 0, "released to nothing on both measures");
    const opened = await prisma.subLedgerBalance.findMany({
      where: { source_doc_id: id, source_doc_type_id: { not: null }, budget_category_id: { in: [hutang.categoryId, titipan.categoryId] } },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(
      opened.map((o) => [o.budget_category_id, num(o.base_balance)]),
      [
        [hutang.categoryId, 9_000_000],
        [titipan.categoryId, 6_000_000],
      ]
    );
  });

  test("moving within one book to another Partner opens there", async () => {
    const unknown = await makePartner({ companyId: induk, categoryLabel: "Lainnya" });
    const known = await makePartner({ companyId: induk, categoryLabel: "Lainnya" });
    const source = await makeItem(held, unknown, 500, 1, idr);
    const id = await makeReclass({
      book: held,
      partnerId: unknown,
      currencyId: idr,
      lines: [{ book: held, partnerId: known, sources: [[source, 500]] }],
    });
    const result = await applyReclass(id, actor);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
    const journal = await journalOf(id);
    assert.deepEqual(
      journal.lines.map((l) => [l.account_id, l.partner_id, num(l.debit_amount), num(l.kredit_amount)]),
      [
        [heldAccount, unknown, 500, 0],
        [heldAccount, known, 0, 500],
      ]
    );
  });
});

describe("the preview is the journal", () => {
  test("a dry run returns the journal Post writes, and writes nothing", async () => {
    const unknown = await makePartner({ companyId: induk, categoryLabel: "Lainnya" });
    const customer = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const source = await makeItem(held, unknown, 1_000, 15_000);
    const receivable = await makeItem(piutang, customer, 1_000, 16_000);
    const id = await makeReclass({
      book: held,
      partnerId: unknown,
      lines: [
        { book: piutang, partnerId: customer, sources: [[source, 1_000]], targets: [[receivable, 1_000]] },
      ],
    });
    const before = {
      entries: await prisma.subLedger.count(),
      journals: await prisma.accJournal.count(),
    };
    const preview = await previewReclass(id);
    assert.ok(preview.ok, JSON.stringify(!preview.ok && preview.errors));
    assert.equal(await prisma.subLedger.count(), before.entries);
    assert.equal(await prisma.accJournal.count(), before.journals);
    assert.equal(num((await itemOf(source)).balance), 1_000);

    assert.ok((await applyReclass(id, actor)).ok);
    const journal = await journalOf(id);
    assert.deepEqual(
      preview.lines.map((l) => [l.debit, l.credit]),
      journal.lines.map((l) => [num(l.debit_amount), num(l.kredit_amount)])
    );
  });
});

// ---------------------------------------------------------------- refusals

describe("refusals", () => {
  test("every line rule refuses on its own", async () => {
    const unknown = await makePartner({ companyId: induk, categoryLabel: "Lainnya" });
    const owner = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const anakPartner = await makePartner({ companyId: anak, categoryLabel: "Stakeholder" });
    const other = await makePartner({ companyId: induk, categoryLabel: "Lainnya" });
    const source = await makeItem(held, unknown, 1_000, 15_000);
    const otherItem = await makeItem(held, other, 1_000, 15_000);
    const idrItem = await makeItem(held, unknown, 1_000, 1, idr);
    const receivable = await makeItem(piutang, owner, 1_000, 16_000);
    const h = await header(held, unknown);

    const refused = async (lines: ReclassLineInput[], pattern: RegExp, why: string) => {
      const r = await checkReclassLines(h, lines);
      assert.equal(r.ok, false, why);
      assert.match(String(!r.ok && r.errors._lines), pattern, why);
    };

    const biaya = await budgetCategoryId("Biaya");
    await refused(
      [{ ...line(hutang, owner, [[source, 1_000]]), target_budget_category_id: biaya }],
      /buku subjek/,
      "a category that names no Partner keeps no book"
    );
    const investasi = subledgerForCategory(await loadSubledgers(), await budgetCategoryId("Investasi"))!;
    await refused(
      [line(investasi, owner, [[source, 1_000]])],
      /tidak menerima arah penerimaan/,
      "Investasi allows only Pengeluaran, and the held receipt was a Penerimaan"
    );
    await refused(
      [line(hutang, unknown, [[source, 1_000]])],
      /Partner Category Lainnya/,
      "Hutang does not admit Lainnya"
    );
    await refused([line(held, unknown, [[source, 1_000]])], /sama dengan posisi sumber/, "the source itself");
    await refused([line(hutang, anakPartner, [[source, 1_000]])], /Company lain/, "the other Company");
    await refused([line(hutang, owner, [[otherItem, 1_000]])], /bukan milik/, "another Partner's item");
    await refused([line(hutang, owner, [[idrItem, 1_000]])], /bukan milik/, "another currency's item");
    await refused([line(hutang, owner, [[source, 1_001]])], /tinggal/, "more than the item holds");
    await refused(
      [line(hutang, owner, [[source, 600]]), line(titipan, owner, [[source, 600]])],
      /tinggal/,
      "more than the item holds, across lines"
    );
    await refused(
      [line(hutang, owner, [[source, 1_000]], [[receivable, 1_000]])],
      /open item baru/,
      "an opening target names no item to settle"
    );
    await refused([line(piutang, owner, [[source, 1_000]])], /Pilih open item/, "a settling target needs its items");
    await refused(
      [line(piutang, owner, [[source, 1_000]], [[receivable, 900]])],
      /harus sama/,
      "settled items add up to the source"
    );
    await refused([line(hutang, owner, [])], /open item sumber/, "a line with nothing to move");

    const fine = await checkReclassLines(h, [line(hutang, owner, [[source, 1_000]])]);
    assert.ok(fine.ok, JSON.stringify(!fine.ok && fine.errors));
    assert.equal(fine.ok && fine.lines[0].effect, "open");
  });

  test("a missing Selisih Kurs account refuses after the items were relieved, and rolls back", async () => {
    const unknown = await makePartner({ companyId: induk, categoryLabel: "Lainnya" });
    const customer = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const source = await makeItem(held, unknown, 1_000, 15_000);
    const receivable = await makeItem(piutang, customer, 1_000, 16_000);
    const id = await makeReclass({
      book: held,
      partnerId: unknown,
      lines: [
        { book: piutang, partnerId: customer, sources: [[source, 1_000]], targets: [[receivable, 1_000]] },
      ],
    });
    await setSystemAccount("induk", "fx", null);
    try {
      const result = await applyReclass(id, actor);
      assert.equal(result.ok, false);
      assert.match(String(!result.ok && result.errors._form), /Selisih Kurs/);
    } finally {
      await setSystemAccount("induk", "fx", fxAccount);
    }
    assert.equal(num((await itemOf(source)).balance), 1_000);
    assert.equal(num((await itemOf(receivable)).balance), 1_000);
    const doc = await prisma.finItemReclass.findUniqueOrThrow({ where: { id } });
    assert.equal(doc.status, "Draft");
  });

  test("an unmapped target book refuses by name before anything opens", async () => {
    const unknown = await makePartner({ companyId: induk, categoryLabel: "Lainnya" });
    const karyawan = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const source = await makeItem(held, unknown, 1_000, 15_000);
    const id = await makeReclass({
      book: held,
      partnerId: unknown,
      lines: [{ book: hutang, partnerId: karyawan, sources: [[source, 1_000]] }],
    });
    const hutangKaryawan = await prisma.accAccountBook.findFirst({
      where: {
        status: "Active",
        budget_category_id: hutang.categoryId,
        account: { company_id: induk, ledger: "category", partner_category: { category_label: "Karyawan" } },
      },
    });
    const result = await applyReclass(id, actor);
    // A mapping somebody made is theirs, and then there is nothing to refuse.
    if (hutangKaryawan) {
      assert.ok(result.ok);
    } else {
      assert.equal(result.ok, false);
      assert.match(String(!result.ok && result.errors._form), /Belum ada Account yang memegang Buku Hutang/);
    }
  });
});
