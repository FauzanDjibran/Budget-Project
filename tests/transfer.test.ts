import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { openCashBankBook } from "../src/lib/siba/cash-bank";
import { BASE_CURRENCY_LABEL } from "../src/lib/siba/currency";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import {
  applyTransfer,
  checkTransferHeader,
  checkTransferLines,
  nextTransferNo,
  type TransferLineInput,
} from "../src/lib/siba/transfer";
import {
  transferDestinationRefusal,
  transferPurposeForPair,
  transferSourceRefusal,
  type TransferPurposeKey,
} from "../src/lib/siba/transfer-catalogue";
import {
  FIXTURE_PREFIX,
  childCompanyId,
  cleanupFiscalYear,
  cleanupFixtures,
  closeYearFor,
  openFiscalYear,
  disconnect,
  makeAccount,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * Cash Bank Transfer.
 *
 * Three properties carry this feature, and none of them is visible by looking
 * at the screen:
 *
 *   1. **Base value is conserved.** A transfer creates no value, so what the
 *      destinations receive in base is exactly what the source released — to
 *      the cent, including when a layer is drawn to nothing and its remainder
 *      is released rather than recomputed.
 *   2. **A difference arises on a Pencairan and nowhere else.** Selling foreign
 *      currency resolves two independently determined base values; a Transfer
 *      and a Pembelian Valas cannot disagree with themselves.
 *   3. **Layers propagate one-for-one.** Three destinations out of one source
 *      layer make three destination layers at the source's rate, never one
 *      blended layer.
 *
 * Everything the suite touches is a fixture it made and tears down: no test
 * here assumes a particular business row exists.
 */

const today = new Date().toISOString().slice(0, 10);

let induk = 0;
let anak = 0;
let actor = 0;
let fiscalYear = 0;
let baseCurrency = 0;
let foreignCurrency = 0;
let foreignLabel = "";
let thirdCurrency = 0;
let thirdLabel = "";
let fxAccount = 0;

const resources: number[] = [];
const transfers: number[] = [];

async function makeResource(options: {
  currencyId: number;
  companyId?: number;
  opening?: number;
  rate?: number;
}): Promise<number> {
  const companyId = options.companyId ?? induk;
  const account = await makeAccount({
    companyId,
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
  });
  const key = `${FIXTURE_PREFIX}TR${resources.length + 1}${Date.now() % 100000}`;
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
    layered: options.currencyId !== baseCurrency,
    date: today,
    actorId: actor,
  });
  resources.push(row.id);
  return row.id;
}

/** A Draft transfer, written the way the Server Action writes one. */
async function makeTransfer(options: {
  purpose: TransferPurposeKey;
  from: number;
  currencyId: number;
  layerId?: number | null;
  lines: { to: number; amount: number; rate?: number }[];
}): Promise<number> {
  const row = await prisma.finCashBankTransfer.create({
    data: {
      transfer_no: await nextTransferNo(),
      company_id: induk,
      purpose: options.purpose,
      from_cash_bank_id: options.from,
      currency_id: options.currencyId,
      cash_bank_layer_id: options.layerId ?? null,
      transfer_amount: options.lines.reduce((t, l) => t + l.amount, 0),
      transfer_base_amount: 0,
      status: "Draft",
      created_by: actor,
      lines: {
        create: options.lines.map((l, i) => ({
          sequence_no: i + 1,
          to_cash_bank_id: l.to,
          amount: l.amount,
          exchange_rate: l.rate ?? 1,
          out_amount: 0,
          out_base_amount: 0,
          in_amount: 0,
          in_base_amount: 0,
          fx_difference: 0,
          created_by: actor,
        })),
      },
    },
    select: { id: true },
  });
  transfers.push(row.id);
  return row.id;
}

/**
 * A currency this suite owns, created once and reused on later runs.
 *
 * `currency_label` is unique but not a Prisma unique *key*, so this is a read
 * followed by a create rather than an upsert. Like every other suite's, these
 * rows are left behind — the application never hard-deletes master data, and a
 * test tearing that rule up for a `ref_currency` row would be pretending the
 * rule is weaker than it is (CLAUDE.md §17).
 */
async function fixtureCurrency(
  label: string,
  name: string
): Promise<{ id: number; currency_label: string }> {
  const existing = await prisma.refCurrency.findFirst({
    where: { currency_label: label },
    select: { id: true, currency_label: true },
  });
  if (existing) return existing;
  return prisma.refCurrency.create({
    data: {
      currency_code: `curr.${label}`,
      currency_label: label,
      currency_name: name,
      created_by: actor,
    },
    select: { id: true, currency_label: true },
  });
}

const openLayerOf = (cashBankId: number) =>
  prisma.cashBankLayer.findFirstOrThrow({
    where: { cash_bank_id: cashBankId, status: "Open" },
    orderBy: { id: "asc" },
  });

const balanceOf = (cashBankId: number) =>
  prisma.cashBankBalance.findUniqueOrThrow({ where: { cash_bank_id: cashBankId } });

const layersOf = (cashBankId: number) =>
  prisma.cashBankLayer.findMany({
    where: { cash_bank_id: cashBankId },
    orderBy: { id: "asc" },
  });

before(async () => {
  // Posting is refused outside an Open fiscal year (`checkPostingPeriod`),
  // and the seed opens none — a calendar is business data. Reused when the
  // database already has one; removed again only if this run made it.
  fiscalYear = await openFiscalYear();
  induk = await parentCompanyId();
  anak = await childCompanyId();
  actor = await systemUserId();

  baseCurrency = (
    await prisma.refCurrency.findFirstOrThrow({
      where: { currency_label: BASE_CURRENCY_LABEL },
      select: { id: true },
    })
  ).id;

  // Two distinct non-base currencies: one to transfer in, one to prove that a
  // third currency is refused. Both are the suite's own rows — picking up
  // whatever the installation happens to hold is what once let a leftover
  // fixture silently disable the third-currency case (CLAUDE.md §17).
  const foreign = await fixtureCurrency("TRFA", "Fixture Transfer Currency A");
  foreignCurrency = foreign.id;
  foreignLabel = foreign.currency_label;

  const third = await fixtureCurrency("TRFB", "Fixture Transfer Currency B");
  thirdCurrency = third.id;
  thirdLabel = third.currency_label;

  // A Pencairan's difference has to land in a named account, and posting
  // refuses by name until one is set. Cleared again in `after`, because a
  // setting pointing at a deleted fixture account would outlive this run.
  fxAccount = await makeAccount({ companyId: induk, subcategoryLabel: "5.3.1" });
  await prisma.sysSetting.upsert({
    where: { setting_key: "induk_fx_account" },
    update: { setting_value: String(fxAccount) },
    create: { setting_key: "induk_fx_account", setting_value: String(fxAccount) },
  });
});

after(async () => {
  await prisma.sysSetting.deleteMany({ where: { setting_key: "induk_fx_account" } });
  if (transfers.length) {
    await prisma.finCashBankTransferLine.deleteMany({
      where: { transfer_id: { in: transfers } },
    });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "fin_cash_bank_transfer", row_id: { in: transfers } },
    });
    await prisma.finCashBankTransfer.deleteMany({ where: { id: { in: transfers } } });
  }
  if (resources.length) {
    await prisma.cashBankLayer.deleteMany({
      where: { cash_bank_id: { in: resources } },
    });
    await prisma.cashBankLedger.deleteMany({
      where: { cash_bank_id: { in: resources } },
    });
    await prisma.cashBankBalance.deleteMany({
      where: { cash_bank_id: { in: resources } },
    });
    await prisma.mCashBank.deleteMany({ where: { id: { in: resources } } });
  }
  await cleanupFiscalYear();
  await cleanupFixtures();
  await disconnect();
});

// ------------------------------------------------------------- the catalogue

describe("a Purpose states how the two currencies relate", () => {
  test("each pair of currencies describes exactly one Purpose", () => {
    assert.equal(transferPurposeForPair("IDR", "IDR"), "Transfer");
    assert.equal(transferPurposeForPair("USD", "USD"), "Transfer");
    assert.equal(transferPurposeForPair("USD", "IDR"), "Pencairan");
    assert.equal(transferPurposeForPair("IDR", "USD"), "PembelianValas");
  });

  test("one foreign currency to another describes none", () => {
    // Crossing goes through the base currency only (§10 rule 67). There is no
    // fourth Purpose for it, deliberately.
    assert.equal(transferPurposeForPair("USD", "EUR"), null);
  });

  test("a Purpose refuses a source whose currency contradicts it", () => {
    assert.ok(transferSourceRefusal("Pencairan", "IDR"));
    assert.ok(transferSourceRefusal("PembelianValas", "USD"));
    assert.equal(transferSourceRefusal("Pencairan", "USD"), null);
    assert.equal(transferSourceRefusal("PembelianValas", "IDR"), null);
    assert.equal(transferSourceRefusal("Transfer", "USD"), null);
  });

  test("a Purpose refuses a destination whose currency contradicts it", () => {
    assert.ok(transferDestinationRefusal("Transfer", "USD", "IDR"));
    assert.ok(transferDestinationRefusal("Pencairan", "USD", "USD"));
    assert.ok(transferDestinationRefusal("PembelianValas", "USD", "EUR"));
    assert.equal(transferDestinationRefusal("Transfer", "USD", "USD"), null);
    assert.equal(transferDestinationRefusal("Pencairan", "USD", "IDR"), null);
    assert.equal(transferDestinationRefusal("PembelianValas", "USD", "USD"), null);
  });
});

// -------------------------------------------------------------------- draft

describe("a Draft moves nothing", () => {
  test("drafting a transfer leaves both balances and the layer untouched", async () => {
    const from = await makeResource({
      currencyId: foreignCurrency,
      opening: 10_000,
      rate: 15_000,
    });
    const to = await makeResource({ currencyId: foreignCurrency });
    const layer = await openLayerOf(from);

    await makeTransfer({
      purpose: "Transfer",
      from,
      currencyId: foreignCurrency,
      layerId: layer.id,
      lines: [{ to, amount: 4_000 }],
    });

    assert.equal((await balanceOf(from)).balance.toNumber(), 10_000);
    assert.equal((await balanceOf(to)).balance.toNumber(), 0);
    assert.equal(
      (await openLayerOf(from)).foreign_remaining.toNumber(),
      10_000,
      "a Draft must not draw on the layer it names"
    );
    assert.equal((await layersOf(to)).length, 0);
  });
});

// ----------------------------------------------------------------- transfer

describe("Transfer moves money without changing what it is worth", () => {
  test("base to base: both balances move and nothing is layered", async () => {
    const from = await makeResource({ currencyId: baseCurrency, opening: 50_000_000 });
    const a = await makeResource({ currencyId: baseCurrency });
    const b = await makeResource({ currencyId: baseCurrency });

    const id = await makeTransfer({
      purpose: "Transfer",
      from,
      currencyId: baseCurrency,
      lines: [
        { to: a, amount: 30_000_000 },
        { to: b, amount: 20_000_000 },
      ],
    });

    const posted = await applyTransfer(id, actor);
    assert.ok(posted.ok, JSON.stringify(posted));
    assert.equal(posted.fxDifference, 0);

    assert.equal((await balanceOf(from)).balance.toNumber(), 0);
    assert.equal((await balanceOf(a)).balance.toNumber(), 30_000_000);
    assert.equal((await balanceOf(b)).balance.toNumber(), 20_000_000);
    assert.equal((await layersOf(a)).length, 0, "rupiah is unlayered");
  });

  test("the source gives up once, however many destinations there are", async () => {
    const from = await makeResource({ currencyId: baseCurrency, opening: 9_000_000 });
    const a = await makeResource({ currencyId: baseCurrency });
    const b = await makeResource({ currencyId: baseCurrency });

    const id = await makeTransfer({
      purpose: "Transfer",
      from,
      currencyId: baseCurrency,
      lines: [
        { to: a, amount: 4_000_000 },
        { to: b, amount: 5_000_000 },
      ],
    });
    assert.ok((await applyTransfer(id, actor)).ok);

    const out = await prisma.cashBankLedger.findMany({
      where: { cash_bank_id: from, entry_type: "Transaction" },
    });
    assert.equal(out.length, 1, "one withdrawal, not one per destination");
    assert.equal(out[0].amount.toNumber(), 9_000_000);
  });

  test("foreign to foreign: base is conserved and layers propagate one-for-one", async () => {
    const from = await makeResource({
      currencyId: foreignCurrency,
      opening: 10_000,
      rate: 15_500,
    });
    const a = await makeResource({ currencyId: foreignCurrency });
    const b = await makeResource({ currencyId: foreignCurrency });
    const c = await makeResource({ currencyId: foreignCurrency });
    const layer = await openLayerOf(from);

    const id = await makeTransfer({
      purpose: "Transfer",
      from,
      currencyId: foreignCurrency,
      layerId: layer.id,
      lines: [
        { to: a, amount: 3_000, rate: 15_500 },
        { to: b, amount: 3_000, rate: 15_500 },
        { to: c, amount: 4_000, rate: 15_500 },
      ],
    });

    const posted = await applyTransfer(id, actor);
    assert.ok(posted.ok, JSON.stringify(posted));
    assert.equal(posted.fxDifference, 0, "a same-currency transfer cannot differ");

    // One layer each, never one blended layer (SIBA multi-currency §6).
    for (const to of [a, b, c]) {
      assert.equal((await layersOf(to)).length, 1);
    }

    // Base conserved, exactly. The source's whole base value is now spread
    // across the three destinations and none of it evaporated in rounding.
    const released = (await balanceOf(from)).base_balance.toNumber();
    assert.equal(released, 0, "the source was emptied");
    const received =
      (await balanceOf(a)).base_balance.toNumber() +
      (await balanceOf(b)).base_balance.toNumber() +
      (await balanceOf(c)).base_balance.toNumber();
    assert.equal(received, 10_000 * 15_500);

    // Each destination layer carries the source layer's rate exactly.
    for (const to of [a, b, c]) {
      const [only] = await layersOf(to);
      assert.equal(only.rate.toNumber(), 15_500);
    }
  });

  test("a layer drawn to nothing releases its remainder rather than a product", async () => {
    // 1/3 of a layer rounds; taking the rest must absorb the residue, or the
    // source would end up holding zero foreign against a non-zero base.
    const from = await makeResource({
      currencyId: foreignCurrency,
      opening: 1_000,
      rate: 15_333.333333,
    });
    const a = await makeResource({ currencyId: foreignCurrency });
    const b = await makeResource({ currencyId: foreignCurrency });
    const layer = await openLayerOf(from);
    const startingBase = layer.base_remaining.toNumber();

    const id = await makeTransfer({
      purpose: "Transfer",
      from,
      currencyId: foreignCurrency,
      layerId: layer.id,
      lines: [
        { to: a, amount: 333, rate: 15_333.333333 },
        { to: b, amount: 667, rate: 15_333.333333 },
      ],
    });
    assert.ok((await applyTransfer(id, actor)).ok);

    const source = await balanceOf(from);
    assert.equal(source.balance.toNumber(), 0);
    assert.equal(
      source.base_balance.toNumber(),
      0,
      "zero foreign against a non-zero base is the state this rule prevents"
    );
    assert.equal(
      (await balanceOf(a)).base_balance.toNumber() +
        (await balanceOf(b)).base_balance.toNumber(),
      startingBase
    );
  });
});

// ---------------------------------------------------------------- pencairan

describe("Pencairan recognises the gain or loss on selling currency", () => {
  test("selling above the carrying rate is a gain, on the credit side", async () => {
    const from = await makeResource({
      currencyId: foreignCurrency,
      opening: 5_000,
      rate: 15_000,
    });
    const to = await makeResource({ currencyId: baseCurrency });
    const layer = await openLayerOf(from);

    const id = await makeTransfer({
      purpose: "Pencairan",
      from,
      currencyId: foreignCurrency,
      layerId: layer.id,
      lines: [{ to, amount: 5_000, rate: 16_000 }],
    });

    const posted = await applyTransfer(id, actor);
    assert.ok(posted.ok, JSON.stringify(posted));

    // Carried at 15.000, sold at 16.000: five million rupiah of realized gain.
    assert.equal(posted.fxDifference, 5_000 * (16_000 - 15_000));
    assert.equal((await balanceOf(to)).balance.toNumber(), 5_000 * 16_000);
    assert.equal((await layersOf(to)).length, 0, "rupiah opens no layer");

    const journal = await prisma.accJournal.findFirstOrThrow({
      where: {
        source_doc_id: id,
        source_doc_type: { doc_table: "fin_cash_bank_transfer" },
      },
      include: { lines: true },
    });
    const fx = journal.lines.find((l) => l.account_id === fxAccount);
    assert.ok(fx, "a difference must reach the named FX account");
    assert.equal(fx.kredit_amount.toNumber(), 5_000 * 1_000);
    assert.equal(fx.debit_amount.toNumber(), 0);
  });

  test("selling below the carrying rate is a loss, on the debit side", async () => {
    const from = await makeResource({
      currencyId: foreignCurrency,
      opening: 2_000,
      rate: 16_000,
    });
    const to = await makeResource({ currencyId: baseCurrency });
    const layer = await openLayerOf(from);

    const id = await makeTransfer({
      purpose: "Pencairan",
      from,
      currencyId: foreignCurrency,
      layerId: layer.id,
      lines: [{ to, amount: 2_000, rate: 15_600 }],
    });

    const posted = await applyTransfer(id, actor);
    assert.ok(posted.ok, JSON.stringify(posted));
    assert.equal(posted.fxDifference, 2_000 * (15_600 - 16_000));

    const journal = await prisma.accJournal.findFirstOrThrow({
      where: {
        source_doc_id: id,
        source_doc_type: { doc_table: "fin_cash_bank_transfer" },
      },
      include: { lines: true },
    });
    const fx = journal.lines.find((l) => l.account_id === fxAccount);
    assert.ok(fx);
    assert.equal(fx.debit_amount.toNumber(), 2_000 * 400);
    assert.equal(fx.kredit_amount.toNumber(), 0);
  });

  test("selling at the carrying rate writes no difference line at all", async () => {
    const from = await makeResource({
      currencyId: foreignCurrency,
      opening: 1_000,
      rate: 15_000,
    });
    const to = await makeResource({ currencyId: baseCurrency });
    const layer = await openLayerOf(from);

    const id = await makeTransfer({
      purpose: "Pencairan",
      from,
      currencyId: foreignCurrency,
      layerId: layer.id,
      lines: [{ to, amount: 1_000, rate: 15_000 }],
    });

    const posted = await applyTransfer(id, actor);
    assert.ok(posted.ok);
    assert.equal(posted.fxDifference, 0);

    const journal = await prisma.accJournal.findFirstOrThrow({
      where: {
        source_doc_id: id,
        source_doc_type: { doc_table: "fin_cash_bank_transfer" },
      },
      include: { lines: true },
    });
    assert.equal(journal.lines.length, 2, "exactly zero writes no third line");
  });
});

// ---------------------------------------------------------- pembelian valas

describe("Pembelian Valas originates value rather than resolving it", () => {
  test("rupiah spent is the foreign amount at the purchase kurs, and no difference arises", async () => {
    const from = await makeResource({
      currencyId: baseCurrency,
      opening: 200_000_000,
    });
    const to = await makeResource({ currencyId: foreignCurrency });

    const id = await makeTransfer({
      purpose: "PembelianValas",
      from,
      currencyId: foreignCurrency,
      lines: [{ to, amount: 10_000, rate: 16_000 }],
    });

    const posted = await applyTransfer(id, actor);
    assert.ok(posted.ok, JSON.stringify(posted));
    assert.equal(posted.fxDifference, 0, "origination has nothing to disagree with");

    assert.equal(
      (await balanceOf(from)).balance.toNumber(),
      200_000_000 - 10_000 * 16_000
    );
    const arrived = await balanceOf(to);
    assert.equal(arrived.balance.toNumber(), 10_000);
    assert.equal(arrived.base_balance.toNumber(), 10_000 * 16_000);

    const [layer] = await layersOf(to);
    assert.ok(layer, "currency bought is currency acquired, so a layer opens");
    assert.equal(layer.rate.toNumber(), 16_000);
    assert.equal(layer.base_original.toNumber(), 10_000 * 16_000);
  });

  test("two purchases at two rates open two layers, never one blended", async () => {
    const from = await makeResource({
      currencyId: baseCurrency,
      opening: 400_000_000,
    });
    const a = await makeResource({ currencyId: foreignCurrency });
    const b = await makeResource({ currencyId: foreignCurrency });

    const id = await makeTransfer({
      purpose: "PembelianValas",
      from,
      currencyId: foreignCurrency,
      lines: [
        { to: a, amount: 5_000, rate: 15_900 },
        { to: b, amount: 5_000, rate: 16_100 },
      ],
    });
    assert.ok((await applyTransfer(id, actor)).ok);

    assert.equal((await layersOf(a))[0].rate.toNumber(), 15_900);
    assert.equal((await layersOf(b))[0].rate.toNumber(), 16_100);
    assert.equal(
      (await balanceOf(from)).balance.toNumber(),
      400_000_000 - (5_000 * 15_900 + 5_000 * 16_100)
    );
  });
});

// ------------------------------------------------------------------ journal

describe("every transfer journals, and every journal balances", () => {
  test("a transfer writes one balanced journal against both resources' accounts", async () => {
    const from = await makeResource({ currencyId: baseCurrency, opening: 7_000_000 });
    const to = await makeResource({ currencyId: baseCurrency });

    const id = await makeTransfer({
      purpose: "Transfer",
      from,
      currencyId: baseCurrency,
      lines: [{ to, amount: 7_000_000 }],
    });
    assert.ok((await applyTransfer(id, actor)).ok);

    const journal = await prisma.accJournal.findFirstOrThrow({
      where: {
        source_doc_id: id,
        source_doc_type: { doc_table: "fin_cash_bank_transfer" },
      },
      include: { lines: true },
    });
    assert.equal(journal.status, "Posted");

    const debit = journal.lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0);
    const kredit = journal.lines.reduce((t, l) => t + l.kredit_amount.toNumber(), 0);
    assert.equal(debit, kredit);
    assert.equal(debit, 7_000_000);

    const sourceAccount = (
      await prisma.mCashBank.findUniqueOrThrow({
        where: { id: from },
        select: { account_id: true },
      })
    ).account_id;
    const credited = journal.lines.find((l) => l.account_id === sourceAccount);
    assert.ok(credited, "the source is credited: money left it");
    assert.equal(credited.kredit_amount.toNumber(), 7_000_000);
  });

  test("a Pencairan's journal still balances once the difference is in it", async () => {
    const from = await makeResource({
      currencyId: foreignCurrency,
      opening: 3_000,
      rate: 15_250,
    });
    const to = await makeResource({ currencyId: baseCurrency });
    const layer = await openLayerOf(from);

    const id = await makeTransfer({
      purpose: "Pencairan",
      from,
      currencyId: foreignCurrency,
      layerId: layer.id,
      lines: [{ to, amount: 3_000, rate: 15_875 }],
    });
    assert.ok((await applyTransfer(id, actor)).ok);

    const journal = await prisma.accJournal.findFirstOrThrow({
      where: {
        source_doc_id: id,
        source_doc_type: { doc_table: "fin_cash_bank_transfer" },
      },
      include: { lines: true },
    });
    const debit = journal.lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0);
    const kredit = journal.lines.reduce((t, l) => t + l.kredit_amount.toNumber(), 0);
    assert.equal(debit, kredit);
  });
});

// ----------------------------------------------------------------- refusals

describe("the rules are enforced by the check, not by the picker", () => {
  const header = (
    purpose: string,
    from: number,
    currencyId?: number,
    layerId?: number | null
  ) =>
    checkTransferHeader({
      purpose,
      from_cash_bank_id: from,
      currency_id: currencyId ?? null,
      cash_bank_layer_id: layerId ?? null,
    });

  const lines = async (
    purpose: TransferPurposeKey,
    from: number,
    input: TransferLineInput[],
    currencyId?: number,
    layerId?: number | null
  ) => {
    const checked = await header(purpose, from, currencyId, layerId);
    assert.ok(checked.ok, JSON.stringify(checked));
    return checkTransferLines(checked, input);
  };

  test("a Pencairan out of a rupiah account is refused", async () => {
    const from = await makeResource({ currencyId: baseCurrency, opening: 1_000_000 });
    const checked = await header("Pencairan", from);
    assert.equal(checked.ok, false);
    assert.match(String(checked.errors.from_cash_bank_id), /Pencairan/);
  });

  test("a Pembelian Valas out of a foreign account is refused", async () => {
    const from = await makeResource({
      currencyId: foreignCurrency,
      opening: 1_000,
      rate: 15_000,
    });
    const checked = await header("PembelianValas", from, foreignCurrency);
    assert.equal(checked.ok, false);
    assert.match(String(checked.errors.from_cash_bank_id), /Pembelian Valas/);
  });

  test("a foreign source without a layer chosen is refused", async () => {
    const from = await makeResource({
      currencyId: foreignCurrency,
      opening: 1_000,
      rate: 15_000,
    });
    const checked = await header("Transfer", from);
    assert.equal(checked.ok, false);
    assert.ok(checked.errors.cash_bank_layer_id);
  });

  test("a destination in a third currency is refused", async () => {
    const from = await makeResource({
      currencyId: foreignCurrency,
      opening: 1_000,
      rate: 15_000,
    });
    const other = await makeResource({ currencyId: thirdCurrency });
    const layer = await openLayerOf(from);

    const result = await lines(
      "Transfer",
      from,
      [{ to_cash_bank_id: other, amount: 500, exchange_rate: null }],
      undefined,
      layer.id
    );
    assert.equal(result.ok, false);
    assert.match(String(result.errors._lines), new RegExp(thirdLabel));
  });

  test("the source cannot be its own destination", async () => {
    const from = await makeResource({ currencyId: baseCurrency, opening: 1_000_000 });
    const result = await lines("Transfer", from, [
      { to_cash_bank_id: from, amount: 500_000, exchange_rate: null },
    ]);
    assert.equal(result.ok, false);
    assert.match(String(result.errors._lines), /tidak boleh sama/);
  });

  test("one destination cannot appear twice", async () => {
    const from = await makeResource({ currencyId: baseCurrency, opening: 1_000_000 });
    const to = await makeResource({ currencyId: baseCurrency });
    const result = await lines("Transfer", from, [
      { to_cash_bank_id: to, amount: 100_000, exchange_rate: null },
      { to_cash_bank_id: to, amount: 200_000, exchange_rate: null },
    ]);
    assert.equal(result.ok, false);
    assert.match(String(result.errors._lines), /sekali/);
  });

  test("a destination in the other Company is refused", async () => {
    const from = await makeResource({ currencyId: baseCurrency, opening: 1_000_000 });
    const elsewhere = await makeResource({
      currencyId: baseCurrency,
      companyId: anak,
    });
    const result = await lines("Transfer", from, [
      { to_cash_bank_id: elsewhere, amount: 500_000, exchange_rate: null },
    ]);
    assert.equal(result.ok, false);
    assert.match(String(result.errors._lines), /Funding Request/);
  });

  test("a document larger than its one layer is refused at draft time", async () => {
    const from = await makeResource({
      currencyId: foreignCurrency,
      opening: 1_000,
      rate: 15_000,
    });
    const a = await makeResource({ currencyId: foreignCurrency });
    const b = await makeResource({ currencyId: foreignCurrency });
    const layer = await openLayerOf(from);

    const result = await lines(
      "Transfer",
      from,
      [
        { to_cash_bank_id: a, amount: 700, exchange_rate: null },
        { to_cash_bank_id: b, amount: 600, exchange_rate: null },
      ],
      undefined,
      layer.id
    );
    assert.equal(result.ok, false);
    assert.match(String(result.errors._lines), /layer/);
  });

  test("a cross-currency line without a kurs is refused", async () => {
    const from = await makeResource({ currencyId: baseCurrency, opening: 100_000_000 });
    const to = await makeResource({ currencyId: foreignCurrency });
    const result = await lines(
      "PembelianValas",
      from,
      [{ to_cash_bank_id: to, amount: 1_000, exchange_rate: null }],
      foreignCurrency
    );
    assert.equal(result.ok, false);
    assert.match(String(result.errors._lines), /kurs/i);
  });
});

// -------------------------------------------------------------- atomicity

describe("a posting that refuses leaves nothing behind", () => {
  test("a missing FX account refuses the post and restores the layer it had drawn", async () => {
    const from = await makeResource({
      currencyId: foreignCurrency,
      opening: 4_000,
      rate: 15_000,
    });
    const to = await makeResource({ currencyId: baseCurrency });
    const layer = await openLayerOf(from);

    const id = await makeTransfer({
      purpose: "Pencairan",
      from,
      currencyId: foreignCurrency,
      layerId: layer.id,
      lines: [{ to, amount: 4_000, rate: 16_000 }],
    });

    // The account is resolved only when a difference actually arises, and this
    // document produces one — so removing it is what makes the posting refuse
    // *after* the layer has already been drawn inside the transaction.
    const saved = await prisma.sysSetting.findUniqueOrThrow({
      where: { setting_key: "induk_fx_account" },
    });
    await prisma.sysSetting.delete({ where: { setting_key: "induk_fx_account" } });

    const posted = await applyTransfer(id, actor);
    await prisma.sysSetting.create({
      data: {
        setting_key: saved.setting_key,
        setting_value: saved.setting_value,
      },
    });

    assert.equal(posted.ok, false);
    assert.match(String(posted.errors._form), /Selisih Kurs/i);

    // The rollback is the point: the draw happened inside the transaction.
    assert.equal(
      (await openLayerOf(from)).foreign_remaining.toNumber(),
      4_000,
      "a refused posting must not leave the layer spent"
    );
    assert.equal((await balanceOf(from)).balance.toNumber(), 4_000);
    assert.equal((await balanceOf(to)).balance.toNumber(), 0);
    assert.equal(
      (
        await prisma.finCashBankTransfer.findUniqueOrThrow({ where: { id } })
      ).status,
      "Draft"
    );
  });

  test("a posted transfer cannot be posted again", async () => {
    const from = await makeResource({ currencyId: baseCurrency, opening: 1_000_000 });
    const to = await makeResource({ currencyId: baseCurrency });

    const id = await makeTransfer({
      purpose: "Transfer",
      from,
      currencyId: baseCurrency,
      lines: [{ to, amount: 1_000_000 }],
    });
    assert.ok((await applyTransfer(id, actor)).ok);

    const again = await applyTransfer(id, actor);
    assert.equal(again.ok, false);
    assert.equal((await balanceOf(to)).balance.toNumber(), 1_000_000);
  });

  test("an overdrawn source takes the whole posting down", async () => {
    const from = await makeResource({ currencyId: baseCurrency, opening: 100_000 });
    const to = await makeResource({ currencyId: baseCurrency });

    const id = await makeTransfer({
      purpose: "Transfer",
      from,
      currencyId: baseCurrency,
      lines: [{ to, amount: 500_000 }],
    });

    await assert.rejects(() => applyTransfer(id, actor));
    assert.equal((await balanceOf(from)).balance.toNumber(), 100_000);
    assert.equal((await balanceOf(to)).balance.toNumber(), 0);
  });
});

// The label is read in a refusal message, so it is asserted rather than left
// as an unused binding the linter would strip.
test("the fixture currencies are distinct and neither is the base", () => {
  assert.notEqual(foreignLabel, thirdLabel);
  assert.notEqual(foreignLabel, BASE_CURRENCY_LABEL);
});

// ------------------------------------------------------------- the period lock

describe("a transfer is refused outside an open period", () => {
  test("a Company that has closed the year cannot move its own money either", async () => {
    const from = await makeResource({ currencyId: baseCurrency, opening: 50_000_000 });
    const to = await makeResource({ currencyId: baseCurrency });
    const id = await makeTransfer({
      purpose: "Transfer",
      from,
      currencyId: baseCurrency,
      lines: [{ to, amount: 30_000_000 }],
    });

    const reopen = await closeYearFor(fiscalYear, induk);
    try {
      const refused = await applyTransfer(id, actor);
      assert.equal(refused.ok, false);
      assert.match(refused.ok === false ? refused.errors._form ?? "" : "", /menutup/);

      assert.equal((await balanceOf(from)).balance.toNumber(), 50_000_000);
      assert.equal((await balanceOf(to)).balance.toNumber(), 0);
    } finally {
      await reopen();
    }

    assert.ok(
      (await applyTransfer(id, actor)).ok,
      "the same document posts once the year is open again"
    );
  });
});
