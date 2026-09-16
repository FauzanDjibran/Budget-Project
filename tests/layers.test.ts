import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  LayerNotAvailable,
  drawFromLayer,
  layerReport,
  openLayer,
  openLayersOf,
  reconcileLayers,
} from "../src/lib/siba/cash-bank-layers";
import { openCashBankBook, recordCashBankEntry } from "../src/lib/siba/cash-bank";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import {
  FIXTURE_PREFIX,
  cleanupFixtures,
  disconnect,
  makeAccount,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * Rate layers.
 *
 * A layer is a parcel of foreign currency bought at a known price. The rules
 * that matter are the ones nobody notices being broken: a layer's rate must not
 * drift as it is spent, drawing one to nothing must release its base exactly,
 * two receipts at the same kurs must stay two layers, and the layers of an
 * account must always add up to what its book says it holds.
 */

const today = new Date().toISOString().slice(0, 10);

let company = 0;
let actor = 0;
let baseCurrency = 0;
let foreignCurrency = 0;
let foreignLabel = "";
const made: number[] = [];

async function makeResource(options: {
  currencyId: number;
  opening?: number;
  rate?: number;
  layered?: boolean;
}): Promise<number> {
  const account = await makeAccount({
    companyId: company,
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
  });
  const key = `${FIXTURE_PREFIX}LY${made.length + 1}${Date.now() % 100000}`;
  const row = await prisma.mCashBank.create({
    data: {
      cash_bank_code: `test.${key}`,
      cash_bank_label: key,
      cash_bank_name: `Fixture ${key}`,
      company_id: company,
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
    layered: options.layered ?? options.currencyId === foreignCurrency,
    date: today,
    actorId: actor,
  });
  made.push(row.id);
  return row.id;
}

before(async () => {
  company = await parentCompanyId();
  actor = await systemUserId();
  baseCurrency = (
    await prisma.refCurrency.findFirstOrThrow({
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;
  // Reuse a non-base currency where the installation has one; currency labels
  // are unique, so a fixture must not plant a second "USD" beside the real one.
  const existing = await prisma.refCurrency.findFirst({
    where: { id: { not: baseCurrency } },
    orderBy: { id: "asc" },
    select: { id: true, currency_label: true },
  });
  const chosen =
    existing ??
    (await prisma.refCurrency.create({
      data: {
        currency_code: "curr.TESTFX",
        currency_label: "TFX",
        currency_name: "Fixture Foreign Currency",
        created_by: actor,
      },
      select: { id: true, currency_label: true },
    }));
  foreignCurrency = chosen.id;
  foreignLabel = chosen.currency_label;
});

after(async () => {
  if (made.length) {
    await prisma.cashBankLayer.deleteMany({ where: { cash_bank_id: { in: made } } });
    await prisma.cashBankLedger.deleteMany({ where: { cash_bank_id: { in: made } } });
    await prisma.cashBankBalance.deleteMany({ where: { cash_bank_id: { in: made } } });
    await prisma.mCashBank.deleteMany({ where: { id: { in: made } } });
  }
  await cleanupFixtures();
  await disconnect();
});

// ------------------------------------------------------------- acquisition

describe("a layer is created by an acquisition, and never merged", () => {
  test("an opening balance opens the resource's first layer", async () => {
    const id = await makeResource({
      currencyId: foreignCurrency,
      opening: 20_000,
      rate: 15_000,
    });

    const layers = await openLayersOf(id);
    assert.equal(layers.length, 1);
    assert.equal(layers[0].rate, 15_000);
    assert.equal(layers[0].foreignRemaining, 20_000);
    assert.equal(layers[0].baseRemaining, 300_000_000);
    assert.match(layers[0].layerNo, /^CBLY-\d{4}$/);

    // The book and the layer are written together, or the account would hold
    // currency of unknown value from the moment it was registered.
    const check = await reconcileLayers(id);
    assert.equal(check.layered, true);
    assert.equal(check.bookBalance, 20_000);
    assert.equal(check.bookBaseBalance, 300_000_000);
    assert.ok(check.reconciles);
  });

  test("a base-currency resource has no layers at all", async () => {
    const id = await makeResource({ currencyId: baseCurrency, opening: 5_000_000 });
    assert.deepEqual(await openLayersOf(id), []);

    const check = await reconcileLayers(id);
    assert.equal(check.layered, false);
    assert.ok(check.reconciles, "an unlayered resource reconciles trivially");
  });

  test("two receipts at the same kurs stay two layers", async () => {
    // Layer identity is per acquisition event, never per rate. This is what
    // makes "the layer from the 28th" name something and "the 15.000" not.
    const id = await makeResource({ currencyId: foreignCurrency });
    for (const note of ["first receipt", "second receipt"]) {
      await openLayer(prisma, {
        cashBankId: id,
        date: today,
        rate: 15_000,
        foreign: 200,
        note,
        actorId: actor,
      });
    }
    const layers = await openLayersOf(id);
    assert.equal(layers.length, 2, "identical rates are still two parcels");
    assert.notEqual(layers[0].id, layers[1].id);
    assert.deepEqual(
      layers.map((l) => l.note),
      ["first receipt", "second receipt"],
      "and each is named by the event that created it"
    );
  });

  test("layers are ordered chronologically, with a tiebreaker within a day", async () => {
    const id = await makeResource({ currencyId: foreignCurrency });
    await openLayer(prisma, {
      cashBankId: id, date: "2026-03-10", rate: 15_500, foreign: 100,
      note: "later", actorId: actor,
    });
    await openLayer(prisma, {
      cashBankId: id, date: "2026-01-05", rate: 15_000, foreign: 100,
      note: "earliest", actorId: actor,
    });
    await openLayer(prisma, {
      cashBankId: id, date: "2026-03-10", rate: 16_000, foreign: 100,
      note: "latest", actorId: actor,
    });

    assert.deepEqual(
      (await openLayersOf(id)).map((l) => l.note),
      ["earliest", "later", "latest"],
      "chronological, never by rate value — ordering is display, not selection"
    );
  });

  test("a layer of nothing, or at no rate, is refused", async () => {
    const id = await makeResource({ currencyId: foreignCurrency });
    for (const foreign of [0, -100]) {
      await assert.rejects(
        () => openLayer(prisma, { cashBankId: id, date: today, rate: 15_000, foreign, actorId: actor }),
        /nominal positif/
      );
    }
    for (const rate of [0, -1]) {
      await assert.rejects(
        () => openLayer(prisma, { cashBankId: id, date: today, rate, foreign: 100, actorId: actor }),
        /Kurs layer/
      );
    }
  });
});

// ------------------------------------------------------------- consumption

describe("a layer is drawn down, and its rate does not move", () => {
  test("a partial draw releases base in proportion", async () => {
    const id = await makeResource({ currencyId: foreignCurrency });
    const layer = await openLayer(prisma, {
      cashBankId: id, date: today, rate: 15_500, foreign: 300, actorId: actor,
    });

    const drawn = await drawFromLayer(prisma, {
      layerId: layer.id, cashBankId: id, foreign: 100, actorId: actor,
    });
    assert.equal(drawn.base, 1_550_000);
    assert.equal(drawn.rate, 15_500);
    assert.equal(drawn.exhausted, false);

    const after = await prisma.cashBankLayer.findUniqueOrThrow({
      where: { id: layer.id },
    });
    assert.equal(after.foreign_remaining.toNumber(), 200);
    assert.equal(after.base_remaining.toNumber(), 3_100_000);
    assert.equal(
      after.base_remaining.toNumber() / after.foreign_remaining.toNumber(),
      15_500,
      "the load-bearing property: a layer's rate is fixed for its life"
    );
    assert.equal(after.status, "Open");
  });

  test("drawing a layer to nothing releases its remaining base exactly", async () => {
    // Not `foreign × rate` recomputed — a sequence of rounded partial draws
    // leaves a residue, and the last draw is where it belongs.
    const id = await makeResource({ currencyId: foreignCurrency });
    const layer = await openLayer(prisma, {
      cashBankId: id, date: today, rate: 3_333.333333, foreign: 3, actorId: actor,
    });
    const opened = await prisma.cashBankLayer.findUniqueOrThrow({
      where: { id: layer.id },
    });
    const total = opened.base_original.toNumber();

    let released = 0;
    for (let i = 0; i < 3; i += 1) {
      released += (
        await drawFromLayer(prisma, {
          layerId: layer.id, cashBankId: id, foreign: 1, actorId: actor,
        })
      ).base;
    }

    const after = await prisma.cashBankLayer.findUniqueOrThrow({
      where: { id: layer.id },
    });
    assert.equal(after.foreign_remaining.toNumber(), 0);
    assert.equal(after.base_remaining.toNumber(), 0, "zero foreign means zero base");
    assert.equal(after.status, "Exhausted");
    assert.equal(released, total, "every rupiah of the layer was released");
  });

  test("a layer cannot be drawn past what it holds", async () => {
    const id = await makeResource({ currencyId: foreignCurrency });
    const layer = await openLayer(prisma, {
      cashBankId: id, date: today, rate: 15_000, foreign: 200, actorId: actor,
    });
    await assert.rejects(
      () =>
        drawFromLayer(prisma, {
          layerId: layer.id, cashBankId: id, foreign: 201, actorId: actor,
        }),
      LayerNotAvailable
    );
    // This is the cap: one transaction uses one layer, so a document is limited
    // to what its chosen layer still holds, whatever the account holds overall.
    const untouched = await prisma.cashBankLayer.findUniqueOrThrow({
      where: { id: layer.id },
    });
    assert.equal(untouched.foreign_remaining.toNumber(), 200);
  });

  test("an exhausted layer is never offered again", async () => {
    const id = await makeResource({ currencyId: foreignCurrency });
    const layer = await openLayer(prisma, {
      cashBankId: id, date: today, rate: 15_000, foreign: 100, actorId: actor,
    });
    await drawFromLayer(prisma, {
      layerId: layer.id, cashBankId: id, foreign: 100, actorId: actor,
    });

    assert.deepEqual(await openLayersOf(id), []);
    await assert.rejects(
      () =>
        drawFromLayer(prisma, {
          layerId: layer.id, cashBankId: id, foreign: 1, actorId: actor,
        }),
      /sudah habis/
    );
  });

  test("a layer belonging to another resource is refused", async () => {
    // The id arrives from a form, and a payment drawing on another account's
    // currency would be invisible in both books.
    const mine = await makeResource({ currencyId: foreignCurrency });
    const theirs = await makeResource({ currencyId: foreignCurrency });
    const layer = await openLayer(prisma, {
      cashBankId: theirs, date: today, rate: 15_000, foreign: 500, actorId: actor,
    });
    await assert.rejects(
      () =>
        drawFromLayer(prisma, {
          layerId: layer.id, cashBankId: mine, foreign: 100, actorId: actor,
        }),
      /bukan milik Cash & Bank/
    );
  });

  test("an unknown layer is refused", async () => {
    const id = await makeResource({ currencyId: foreignCurrency });
    await assert.rejects(
      () =>
        drawFromLayer(prisma, {
          layerId: -1, cashBankId: id, foreign: 1, actorId: actor,
        }),
      LayerNotAvailable
    );
  });
});

// -------------------------------------------------------------- the report

describe("the layers of an account are what it holds", () => {
  test("the weighted average is a rate nobody transacted at", async () => {
    const id = await makeResource({ currencyId: foreignCurrency });
    await openLayer(prisma, {
      cashBankId: id, date: today, rate: 15_000, foreign: 200, actorId: actor,
    });
    await openLayer(prisma, {
      cashBankId: id, date: today, rate: 15_500, foreign: 300, actorId: actor,
    });

    const report = await layerReport([company], id);
    const block = report.blocks[0];
    assert.equal(block.foreignRemaining, 500);
    assert.equal(block.baseRemaining, 3_000_000 + 4_650_000);
    assert.equal(block.averageRate, 15_300);
    assert.equal(block.currencyLabel, foreignLabel);
  });

  test("an exhausted layer stays on the report, marked", async () => {
    const id = await makeResource({ currencyId: foreignCurrency });
    const spent = await openLayer(prisma, {
      cashBankId: id, date: today, rate: 15_000, foreign: 100, actorId: actor,
    });
    await openLayer(prisma, {
      cashBankId: id, date: today, rate: 16_000, foreign: 100, actorId: actor,
    });
    await drawFromLayer(prisma, {
      layerId: spent.id, cashBankId: id, foreign: 100, actorId: actor,
    });

    const block = (await layerReport([company], id)).blocks[0];
    assert.equal(block.layers.length, 2, "a spent layer is part of the history");
    assert.equal(
      block.layers.find((l) => l.id === spent.id)!.status,
      "Exhausted"
    );
    assert.equal(block.foreignRemaining, 100, "but it counts towards nothing");
  });

  test("a base-currency resource is not a block on this report", async () => {
    const id = await makeResource({ currencyId: baseCurrency, opening: 1_000_000 });
    const report = await layerReport([company]);
    assert.ok(
      !report.blocks.some((b) => b.cashBankId === id),
      "rupiah is the measure, so it has nothing to choose between"
    );
  });

  test("a resource outside the reader's Companies is not reported", async () => {
    const id = await makeResource({ currencyId: foreignCurrency, opening: 500, rate: 15_000 });
    const report = await layerReport([]);
    assert.ok(!report.blocks.some((b) => b.cashBankId === id));
  });

  test("layers and the book agree, and the report says when they do not", async () => {
    const id = await makeResource({
      currencyId: foreignCurrency, opening: 1_000, rate: 15_000,
    });
    assert.ok((await layerReport([company], id)).blocks[0].reconciles);

    // Move the book without touching the layers — which nothing in the
    // application does, and which is exactly why the check exists.
    await recordCashBankEntry(prisma, {
      cashBankId: id,
      date: today,
      type: "Adjustment",
      direction: "In",
      amount: 500,
      rate: 15_000,
      actorId: actor,
    });

    const check = await reconcileLayers(id);
    assert.equal(check.bookBalance, 1_500);
    assert.equal(check.layerForeign, 1_000);
    assert.equal(
      check.reconciles,
      false,
      "a resource's balance IS the sum of its layers — a gap is a system fault"
    );
    assert.equal((await layerReport([company], id)).blocks[0].reconciles, false);
  });
});
