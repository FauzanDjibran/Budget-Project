import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  checkGeneralJournal,
  createGeneralJournal,
  postGeneralJournal,
  type GeneralJournalLineValues,
} from "../src/lib/siba/general-journal";
import { isBalanced, valueGeneralJournal } from "../src/lib/siba/general-journal-valuation";
import {
  checkManualJournal,
  createManualJournal,
  postManualJournal,
} from "../src/lib/siba/manual-journal";
import { syncControlAccounts } from "../src/lib/siba/records";
import { systemAccountIds } from "../src/lib/siba/system-account-data";
import {
  childCompanyId,
  cleanupFiscalYear,
  cleanupFixtures,
  disconnect,
  makeAccount,
  makePartner,
  openFiscalYear,
  parentCompanyId,
  prisma,
  systemAccountFixture,
  systemUserId,
} from "./helpers";

/**
 * Jurnal Umum, Gate A (Journal 2.0 step 2): the engine with the `none` and
 * `partner` ledgers. A rupiah Jurnal Umum posts the journal the same manual
 * journal would; the netted Selisih Kurs follows §4; and the manual journal
 * still refuses a control account, which Jurnal Umum will reach once its
 * ledger's adapter exists.
 */

let company = 0;
let actor = 0;
let scope: number[] = [];
let baseCurrency = 0;
let foreignCurrency = 0;
let beban = 0;
let ymh = 0;
let pemasaran = 0;
let partner = 0;
const fx = systemAccountFixture();

before(async () => {
  await openFiscalYear();
  company = await parentCompanyId();
  actor = await systemUserId();
  scope = [company, await childCompanyId()];

  beban = await makeAccount({ companyId: company, subcategoryLabel: "5.3.1" });
  ymh = await makeAccount({ companyId: company, subcategoryLabel: "2.1.1", normalBalance: "Kredit" });
  pemasaran = await makeAccount({
    companyId: company,
    subcategoryLabel: "5.3.1",
    partnerCategoryLabel: "Cabang",
  });
  partner = await makePartner({ companyId: company, categoryLabel: "Cabang" });

  baseCurrency = (
    await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" }, select: { id: true } })
  ).id;
  foreignCurrency =
    (
      await prisma.refCurrency.findFirst({
        where: { currency_label: { not: "IDR" }, status: "Active" },
        orderBy: { id: "asc" },
        select: { id: true },
      })
    )?.id ?? 0;
});

after(async () => {
  await fx.restore();
  await cleanupFiscalYear();
  await cleanupFixtures();
  await disconnect();
});

const line = (
  accountId: number,
  debit: number,
  credit: number,
  extra: Partial<GeneralJournalLineValues> = {}
): GeneralJournalLineValues => ({
  account_id: accountId,
  partner_id: null,
  currency_id: baseCurrency,
  exchange_rate: null,
  debit,
  credit,
  description: "",
  ...extra,
});

const header = () => ({ company_id: company, description: "Fixture Jurnal Umum" });

describe("valuation and the netted Selisih Kurs (§4, D7)", () => {
  const usd = { currencyLabel: "USD", isBase: false };

  test("Case 2: a line typed at another kurs than its counterpart gives a Kredit Selisih", () => {
    const v = valueGeneralJournal([
      { ...usd, side: "credit", face: 50, rate: 15_800 },
      { ...usd, side: "debit", face: 50, rate: 16_200 },
    ]);
    assert.deepEqual(v.bases, [790_000, 810_000]);
    assert.equal(v.selisih, -20_000, "Kredit 20.000, a gain");
    assert.ok(isBalanced(v));
  });

  test("Case 3 and 6 net into one Debit line", () => {
    const v = valueGeneralJournal([
      { ...usd, side: "debit", face: 600, rate: 15_800 },
      { ...usd, side: "credit", face: 600, rate: 16_400 },
      { ...usd, side: "debit", face: 15, rate: 16_100 },
      { ...usd, side: "credit", face: 15, rate: 15_900 },
    ]);
    assert.equal(v.selisih, 357_000);
    assert.ok(isBalanced(v));
  });

  test("Case 11: a currency whose amounts do not balance is never read as FX", () => {
    const v = valueGeneralJournal([
      { ...usd, side: "debit", face: 100, rate: 15_800 },
      { currencyLabel: "IDR", isBase: true, side: "credit", face: 1_620_000, rate: 1 },
    ]);
    assert.equal(v.selisih, 0);
    assert.deepEqual(v.unbalancedCurrencies, ["USD"]);
    assert.equal(isBalanced(v), false);
  });

  test("a supplied base wins over face × kurs", () => {
    const v = valueGeneralJournal([
      { ...usd, side: "debit", face: 1, rate: 15_800.5, baseAmount: 15_800 },
      { ...usd, side: "credit", face: 1, rate: 15_800.5 },
    ]);
    assert.deepEqual(v.bases, [15_800, 15_800.5]);
    assert.equal(v.selisih, 0.5, "the residue sits inside the gap");
  });
});

describe("a rupiah Jurnal Umum of plain and Partner accounts", () => {
  test("Case 9 posts the journal the same manual journal posts", async () => {
    const lines = [
      line(pemasaran, 5_000_000, 0, { partner_id: partner }),
      line(ymh, 0, 5_000_000),
    ];

    const draft = await createGeneralJournal(header(), lines, actor);
    assert.ok(draft.ok, JSON.stringify(draft));
    assert.match(draft.journalNo, /^JUM-\d{4}$/);

    const preview = await postGeneralJournal(draft.id, actor, scope, true);
    assert.ok(preview.ok && preview.postedJournalNo === null, "a dry run writes nothing");
    assert.equal(
      (await prisma.accGeneralJournal.findUniqueOrThrow({ where: { id: draft.id } })).status,
      "Draft"
    );

    const posted = await postGeneralJournal(draft.id, actor, scope);
    assert.ok(posted.ok && posted.postedJournalNo, JSON.stringify(posted));

    const manual = await createManualJournal(header(), lines, actor);
    assert.ok(manual.ok);
    assert.ok((await postManualJournal(manual.id, actor, scope)).ok);

    const general = await prisma.accGeneralJournal.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: { orderBy: { sequence_no: "asc" } } },
    });
    assert.equal(general.status, "Posted");
    assert.ok(general.posted_journal_id);

    const shape = (l: {
      account_id: number;
      partner_id: number | null;
      currency_id: number;
      exchange_rate: { toNumber(): number };
      debit_amount: { toNumber(): number };
      kredit_amount: { toNumber(): number };
      trx_amount: { toNumber(): number };
      description: string;
    }) => ({
      account: l.account_id,
      partner: l.partner_id,
      currency: l.currency_id,
      rate: l.exchange_rate.toNumber(),
      debit: l.debit_amount.toNumber(),
      kredit: l.kredit_amount.toNumber(),
      face: l.trx_amount.toNumber(),
      description: l.description,
    });
    const linesOf = async (id: number) =>
      (await prisma.accJournalLine.findMany({ where: { journal_id: id }, orderBy: { sequence_no: "asc" } })).map(shape);

    const fromGeneral = await linesOf(general.posted_journal_id!);
    assert.deepEqual(fromGeneral, await linesOf(manual.id), "identical to the manual journal");
    assert.deepEqual(general.lines.map(shape), fromGeneral, "the draft's rows equal what Post wrote");
    assert.equal(fromGeneral[0].partner, partner, "the Partner breakdown, no book written");

    const journal = await prisma.accJournal.findUniqueOrThrow({
      where: { id: general.posted_journal_id! },
      include: { source_doc_type: { select: { doc_table: true } } },
    });
    assert.equal(journal.source_doc_type?.doc_table, "acc_general_journal");
    assert.equal(journal.source_doc_id, draft.id);
  });

  test("a Partner account demands its Partner, of the account's category", async () => {
    const missing = await checkGeneralJournal(header(), [line(pemasaran, 1_000, 0), line(ymh, 0, 1_000)]);
    assert.ok(!missing.ok);
    assert.match(missing.errors["lines.0.partner_id"], /wajib menyebut Partner/);

    const stranger = await makePartner({ companyId: company, categoryLabel: "Stakeholder" });
    const wrong = await checkGeneralJournal(header(), [
      line(pemasaran, 1_000, 0, { partner_id: stranger }),
      line(ymh, 0, 1_000),
    ]);
    assert.ok(!wrong.ok);
    assert.match(wrong.errors["lines.0.partner_id"], /Partner Category/);
  });

  test("an unbalanced draft saves, and Post refuses it", async () => {
    const draft = await createGeneralJournal(header(), [line(beban, 1_000, 0), line(ymh, 0, 900)], actor);
    assert.ok(draft.ok);
    const refused = await postGeneralJournal(draft.id, actor, scope);
    assert.ok(!refused.ok);
    assert.match(refused.errors._form, /tidak seimbang/);
  });

  test("a foreign journal writes its one Selisih line on the fx account", async (t) => {
    if (!foreignCurrency) return t.skip("no foreign currency in this database");
    const selisih = await makeAccount({ companyId: company, subcategoryLabel: "5.3.1" });
    await fx.set("induk", "fx", selisih);

    const draft = await createGeneralJournal(
      header(),
      [
        line(beban, 15, 0, { currency_id: foreignCurrency, exchange_rate: 16_100 }),
        line(ymh, 0, 15, { currency_id: foreignCurrency, exchange_rate: 15_900 }),
      ],
      actor
    );
    assert.ok(draft.ok, JSON.stringify(draft));
    const posted = await postGeneralJournal(draft.id, actor, scope);
    assert.ok(posted.ok, JSON.stringify(posted));

    const generated = posted.preview.at(-1)!;
    assert.equal(generated.description, "Selisih kurs");
    assert.equal(generated.credit, 3_000, "Kredit 3.000, a gain");
  });
});

describe("the ledgers whose adapters are not built yet, and the manual journal", () => {
  test("a subject-book account is refused by Jurnal Umum, by its ledger", async () => {
    const hutang = await makeAccount({
      companyId: company,
      subcategoryLabel: "2.1.1",
      normalBalance: "Kredit",
      partnerCategoryLabel: "Cabang",
      bookLabel: "Hutang",
    });
    const refused = await checkGeneralJournal(header(), [
      line(beban, 1_000, 0),
      line(hutang, 0, 1_000, { partner_id: partner }),
    ]);
    assert.ok(!refused.ok);
    assert.match(refused.errors["lines.1.account_id"], /Buku Subjek/);

    // JUR- still refuses a control account (Gate A).
    await syncControlAccounts([hutang], await systemAccountIds(), actor);
    const manual = await checkManualJournal(header(), [
      { ...line(beban, 1_000, 0) },
      { ...line(hutang, 0, 1_000), partner_id: partner },
    ]);
    assert.ok(!manual.ok);
    assert.match(manual.errors["lines.1.account_id"], /control account/);
  });
});
