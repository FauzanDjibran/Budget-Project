import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { openCashBankBook, recordCashBankEntry } from "../src/lib/siba/cash-bank";
import {
  LayerNotAvailable,
  drawFromLayer,
  openLayer,
  reconcileLayers,
} from "../src/lib/siba/cash-bank-layers";
import {
  applyRevaluation,
  checkRevaluationHeader,
  nextRevaluationNo,
  previewRevaluation,
  revaluationClosedLayers,
} from "../src/lib/siba/cash-bank-revaluation";
import { BASE_CURRENCY_LABEL } from "../src/lib/siba/currency";
import { revalue } from "../src/lib/siba/fx";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import {
  FIXTURE_PREFIX,
  cleanupFiscalYear,
  cleanupFixtures,
  disconnect,
  makeAccount,
  openFiscalYear,
  parentCompanyId,
  prisma,
  systemAccountFixture,
  systemUserId,
} from "./helpers";

/**
 * Revaluasi Kurs.
 *
 * The properties the document lives by, none visible on a screen: the foreign
 * balance never moves, every open layer is replaced by **one** at the stated
 * kurs, the book's base and the layers' base agree to the cent afterwards,
 * and the difference is journalled on the side its sign says. The first test
 * is the user's own example: $1.000 held at 15.000 (Rp 15.000.000) revalued
 * at 14.000 closes the old layer, opens one of $1.000 / Rp 14.000.000, and
 * journals a loss of Rp 1.000.000.
 */

const today = new Date().toISOString().slice(0, 10);
// The day before, inside the same year — on 1 January it is today, because the
// fixture opens only the year covering today.
const dayBefore = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const yesterday = dayBefore.slice(0, 4) === today.slice(0, 4) ? dayBefore : today;

let induk = 0;
let actor = 0;
let idr = 0;
let usd = 0;
let revaluationAccount = 0;
const accounts = systemAccountFixture();

const resources: number[] = [];
const revaluations: number[] = [];

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

/** A resource, its book opened with a first layer where it is foreign. */
async function makeResource(options: {
  currencyId: number;
  opening?: number;
  rate?: number;
}): Promise<{ id: number; accountId: number }> {
  const accountId = await makeAccount({ companyId: induk, subcategoryLabel: CASH_BANK_SUBCATEGORY });
  const key = `${FIXTURE_PREFIX}RV${resources.length + 1}${Date.now() % 100000}`;
  const row = await prisma.mCashBank.create({
    data: {
      cash_bank_code: `test.${key}`,
      cash_bank_label: key,
      cash_bank_name: `Fixture ${key}`,
      company_id: induk,
      cash_bank_type: "Bank",
      currency_id: options.currencyId,
      account_id: accountId,
      created_by: actor,
    },
    select: { id: true },
  });
  await openCashBankBook(prisma, {
    cashBankId: row.id,
    openingBalance: options.opening ?? 0,
    rate: options.rate ?? 1,
    layered: options.currencyId !== idr,
    date: yesterday,
    actorId: actor,
  });
  resources.push(row.id);
  return { id: row.id, accountId };
}

/** A further receipt: a book entry and the new layer it opens, as a posting writes them. */
async function receive(cashBankId: number, foreign: number, rate: number, date = today) {
  await prisma.$transaction(async (tx) => {
    const layer = await openLayer(tx, { cashBankId, date, rate, foreign, actorId: actor });
    await recordCashBankEntry(tx, {
      cashBankId,
      date,
      type: "Transaction",
      direction: "In",
      amount: foreign,
      rate,
      baseAmount: layer.base_original.toNumber(),
      note: `${FIXTURE_PREFIX} receipt`,
      actorId: actor,
    });
  });
}

/** A Draft, written the way `createRevaluation` writes one. */
async function makeRevaluation(cashBankId: number, rate: number, date = today): Promise<number> {
  const row = await prisma.finCashBankRevaluation.create({
    data: {
      revaluation_no: await nextRevaluationNo(),
      document_date: new Date(`${date}T00:00:00Z`),
      company_id: induk,
      cash_bank_id: cashBankId,
      currency_id: usd,
      exchange_rate: rate,
      status: "Draft",
      created_by: actor,
    },
    select: { id: true },
  });
  revaluations.push(row.id);
  return row.id;
}

const openLayers = (cashBankId: number) =>
  prisma.cashBankLayer.findMany({
    where: { cash_bank_id: cashBankId, status: "Open" },
    orderBy: { id: "asc" },
  });

const journalOf = (revaluationId: number) =>
  prisma.accJournal.findFirst({
    where: {
      source_doc_id: revaluationId,
      source_doc_type: { doc_table: "fin_cash_bank_revaluation" },
    },
    include: { lines: { orderBy: { id: "asc" } } },
  });

const num = (d: { toNumber(): number }) => d.toNumber();

before(async () => {
  await openFiscalYear();
  induk = await parentCompanyId();
  actor = await systemUserId();
  idr = (
    await prisma.refCurrency.findFirstOrThrow({
      where: { currency_label: BASE_CURRENCY_LABEL },
      select: { id: true },
    })
  ).id;
  usd = await fixtureCurrency("RVKA");
  revaluationAccount = await makeAccount({ companyId: induk, subcategoryLabel: "5.3.1" });
  await accounts.set("induk", "fx_revaluation", revaluationAccount);
});

after(async () => {
  await accounts.restore();
  if (revaluations.length) {
    await prisma.finCashBankRevaluationLayer.deleteMany({
      where: { revaluation_id: { in: revaluations } },
    });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "fin_cash_bank_revaluation", row_id: { in: revaluations } },
    });
    await prisma.finCashBankRevaluation.deleteMany({ where: { id: { in: revaluations } } });
  }
  if (resources.length) {
    await prisma.cashBankLayer.deleteMany({ where: { cash_bank_id: { in: resources } } });
    await prisma.cashBankLedger.deleteMany({ where: { cash_bank_id: { in: resources } } });
    await prisma.cashBankBalance.deleteMany({ where: { cash_bank_id: { in: resources } } });
    await prisma.cashBankPeriod.deleteMany({ where: { cash_bank_id: { in: resources } } });
    await prisma.mCashBank.deleteMany({ where: { id: { in: resources } } });
  }
  await cleanupFiscalYear();
  await cleanupFixtures();
  await disconnect();
});

// --------------------------------------------------------------- the kernel

describe("revalue restates base and nothing else", () => {
  test("$1.000 at 15.000 restated at 14.000 is a loss of 1.000.000", () => {
    const r = revalue({ foreign: 1000, base: 15_000_000 }, 14000);
    assert.deepEqual(r.balance, { foreign: 1000, base: 14_000_000 });
    assert.deepEqual(r.difference, { amount: -1_000_000, side: "loss" });
  });

  test("the concept's month-end: $300 / 4.500.000 at 16.200 is a gain of 360.000", () => {
    const r = revalue({ foreign: 300, base: 4_500_000 }, 16200);
    assert.equal(r.balance.base, 4_860_000);
    assert.deepEqual(r.difference, { amount: 360_000, side: "gain" });
  });

  test("the kurs a balance is already carried at restates nothing", () => {
    assert.deepEqual(revalue({ foreign: 300, base: 4_500_000 }, 15000).difference, {
      amount: 0,
      side: null,
    });
  });
});

// ------------------------------------------------------------------ posting

describe("Post collapses every open layer into one", () => {
  test("the user's example: one layer at 14.000 and a loss of 1.000.000", async () => {
    const bank = await makeResource({ currencyId: usd, opening: 1000, rate: 15000 });
    const [old] = await openLayers(bank.id);
    const id = await makeRevaluation(bank.id, 14000);

    const result = await applyRevaluation(id, actor);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));

    const closed = await prisma.cashBankLayer.findUniqueOrThrow({ where: { id: old.id } });
    assert.equal(closed.status, "ClosedByRevaluation");
    assert.equal(num(closed.foreign_remaining), 0);
    assert.equal(num(closed.base_remaining), 0);

    const layers = await openLayers(bank.id);
    assert.equal(layers.length, 1);
    assert.equal(num(layers[0].rate), 14000);
    assert.equal(num(layers[0].foreign_remaining), 1000);
    assert.equal(num(layers[0].base_remaining), 14_000_000);
    assert.equal(layers[0].acquisition_date.toISOString().slice(0, 10), today);

    // The book moved base only, and agrees with the layers to the cent.
    const entry = await prisma.cashBankLedger.findFirstOrThrow({
      where: { cash_bank_id: bank.id, entry_type: "Revaluation" },
    });
    assert.equal(num(entry.movement), 0);
    assert.equal(num(entry.base_movement), -1_000_000);
    const rec = await reconcileLayers(bank.id);
    assert.ok(rec.reconciles);
    assert.equal(rec.bookBalance, 1000);
    assert.equal(rec.bookBaseBalance, 14_000_000);

    // A loss: the revaluation account debited, the cash account credited.
    const journal = await journalOf(id);
    assert.ok(journal);
    assert.equal(journal.lines.length, 2);
    const [debit, credit] = journal.lines;
    assert.equal(debit.account_id, revaluationAccount);
    assert.equal(num(debit.debit_amount), 1_000_000);
    assert.equal(credit.account_id, bank.accountId);
    assert.equal(num(credit.kredit_amount), 1_000_000);

    const doc = await prisma.finCashBankRevaluation.findUniqueOrThrow({ where: { id } });
    assert.equal(doc.status, "Posted");
    assert.equal(num(doc.fx_difference), -1_000_000);
    assert.equal(doc.opened_layer_id, layers[0].id);
    const record = await revaluationClosedLayers(id);
    assert.deepEqual(
      record.map((l) => [l.layerId, l.foreign, l.base, l.rate]),
      [[old.id, 1000, 15_000_000, 15000]]
    );
  });

  test("two layers at two kurs become one, and a gain lands on the credit side", async () => {
    const bank = await makeResource({ currencyId: usd, opening: 200, rate: 15000 });
    await receive(bank.id, 100, 15000);
    const id = await makeRevaluation(bank.id, 16200);

    const result = await applyRevaluation(id, actor);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
    assert.equal(result.valuation.difference, 360_000);

    const layers = await openLayers(bank.id);
    assert.equal(layers.length, 1);
    assert.equal(num(layers[0].foreign_remaining), 300);
    assert.equal(num(layers[0].base_remaining), 4_860_000);
    assert.equal((await revaluationClosedLayers(id)).length, 2);

    const journal = await journalOf(id);
    const [debit, credit] = journal!.lines;
    assert.equal(debit.account_id, bank.accountId);
    assert.equal(num(debit.debit_amount), 360_000);
    assert.equal(credit.account_id, revaluationAccount);
    assert.equal(num(credit.kredit_amount), 360_000);
    assert.ok((await reconcileLayers(bank.id)).reconciles);
  });

  test("an odd kurs rounds once, and book and layers still agree", async () => {
    const bank = await makeResource({ currencyId: usd, opening: 333.33, rate: 15000 });
    const id = await makeRevaluation(bank.id, 15123.456789);
    const result = await applyRevaluation(id, actor);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
    const [layer] = await openLayers(bank.id);
    assert.equal(num(layer.base_remaining), revalue({ foreign: 333.33, base: 4_999_950 }, 15123.456789).balance.base);
    assert.ok((await reconcileLayers(bank.id)).reconciles);
  });

  test("a revaluation at the kurs already carried collapses the layers and writes no journal", async () => {
    const bank = await makeResource({ currencyId: usd, opening: 200, rate: 15000 });
    await receive(bank.id, 100, 15000);
    const id = await makeRevaluation(bank.id, 15000);
    const preview = await previewRevaluation(id);
    assert.ok(preview.ok);
    assert.equal(preview.lines.length, 0);

    const result = await applyRevaluation(id, actor);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
    assert.equal((await openLayers(bank.id)).length, 1);
    assert.equal(await journalOf(id), null);
    assert.equal(
      await prisma.cashBankLedger.count({ where: { cash_bank_id: bank.id, entry_type: "Revaluation" } }),
      0
    );
  });
});

describe("the preview is the journal, and writes nothing", () => {
  test("preview lines equal what Post writes; the layers are untouched in between", async () => {
    const bank = await makeResource({ currencyId: usd, opening: 500, rate: 15500 });
    const id = await makeRevaluation(bank.id, 15800);

    const preview = await previewRevaluation(id);
    assert.ok(preview.ok, JSON.stringify(!preview.ok && preview.errors));
    assert.equal((await openLayers(bank.id)).length, 1);
    assert.equal(num((await openLayers(bank.id))[0].rate), 15500);
    assert.equal(await journalOf(id), null);

    const result = await applyRevaluation(id, actor);
    assert.ok(result.ok);
    const journal = await journalOf(id);
    assert.deepEqual(
      preview.lines.map((l) => [l.debit, l.credit]),
      journal!.lines.map((l) => [num(l.debit_amount), num(l.kredit_amount)])
    );
  });
});

describe("it reads the present", () => {
  test("a revaluation dated before a receipt still collapses that receipt's layer", async () => {
    const bank = await makeResource({ currencyId: usd, opening: 100, rate: 15000 });
    await receive(bank.id, 50, 15500, today);
    const id = await makeRevaluation(bank.id, 16000, yesterday);
    const result = await applyRevaluation(id, actor);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
    const layers = await openLayers(bank.id);
    assert.equal(layers.length, 1);
    assert.equal(num(layers[0].foreign_remaining), 150);
  });

  test("a payment naming a layer the revaluation closed is refused", async () => {
    const bank = await makeResource({ currencyId: usd, opening: 100, rate: 15000 });
    const [old] = await openLayers(bank.id);
    const id = await makeRevaluation(bank.id, 16000);
    assert.ok((await applyRevaluation(id, actor)).ok);
    await assert.rejects(
      prisma.$transaction((tx) =>
        drawFromLayer(tx, { date: today, layerId: old.id, cashBankId: bank.id, foreign: 10, actorId: actor })
      ),
      LayerNotAvailable
    );
  });
});

describe("refusals leave everything as it was", () => {
  test("a base-currency resource has nothing to revalue", async () => {
    const bank = await makeResource({ currencyId: idr, opening: 1_000_000 });
    const check = await checkRevaluationHeader({ cash_bank_id: bank.id, exchange_rate: 1 }, [induk]);
    assert.equal(check.ok, false);
  });

  test("a resource holding nothing is refused", async () => {
    const bank = await makeResource({ currencyId: usd });
    const id = await makeRevaluation(bank.id, 16000);
    const result = await applyRevaluation(id, actor);
    assert.equal(result.ok, false);
  });

  test("without a revaluation account the post is refused, by name, and nothing moves", async () => {
    const bank = await makeResource({ currencyId: usd, opening: 100, rate: 15000 });
    const id = await makeRevaluation(bank.id, 16000);
    await accounts.set("induk", "fx_revaluation", null);
    try {
      const result = await applyRevaluation(id, actor);
      assert.equal(result.ok, false);
      assert.match(!result.ok ? result.errors._form : "", /Laba\/Rugi Revaluasi Kurs/);
      const layers = await openLayers(bank.id);
      assert.equal(layers.length, 1);
      assert.equal(num(layers[0].rate), 15000);
      const doc = await prisma.finCashBankRevaluation.findUniqueOrThrow({ where: { id } });
      assert.equal(doc.status, "Draft");
    } finally {
      await accounts.set("induk", "fx_revaluation", revaluationAccount);
    }
  });

  test("a posted revaluation cannot be posted again", async () => {
    const bank = await makeResource({ currencyId: usd, opening: 100, rate: 15000 });
    const id = await makeRevaluation(bank.id, 16000);
    assert.ok((await applyRevaluation(id, actor)).ok);
    const again = await applyRevaluation(id, actor);
    assert.equal(again.ok, false);
  });
});
