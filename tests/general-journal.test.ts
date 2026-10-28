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
import { todayDay } from "../src/lib/siba/fiscal";
import { syncControlAccounts } from "../src/lib/siba/records";
import { recordSubledgerEntry, subledgerItem } from "../src/lib/siba/subledger";
import type { SubledgerDef } from "../src/lib/siba/subledger-catalogue";
import { loadSubledgers } from "../src/lib/siba/subledger-data";
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

describe("the subject_book ledger (Gate B)", () => {
  const today = todayDay();
  let books: SubledgerDef[] = [];
  const book = (label: string) => books.find((b) => b.budgetCategory === label)!;
  const accounts: Record<string, number> = {};

  before(async () => {
    books = await loadSubledgers();
    for (const [label, sub] of [
      ["Piutang", "1.1.3"],
      ["Hutang", "2.1.1"],
      ["Titipan", "2.1.5"],
      ["Penerimaan Belum Teridentifikasi", "2.1.5"],
    ]) {
      accounts[label] = await makeAccount({
        companyId: company,
        subcategoryLabel: sub,
        normalBalance: sub.startsWith("1") ? "Debit" : "Kredit",
        partnerCategoryLabel: "Cabang",
        bookLabel: label,
      });
    }
    await fx.set("induk", "fx", await makeAccount({ companyId: company, subcategoryLabel: "5.3.1" }));
  });

  /** An open item raised the way its book is raised, dated today. */
  const openItem = async (label: string, amount: number, rate: number, currencyId: number) =>
    (
      await prisma.$transaction((tx) =>
        recordSubledgerEntry(tx, {
          book: book(label),
          partnerId: partner,
          currencyId,
          date: today,
          type: "Transaction",
          direction: book(label).raises,
          amount,
          rate,
          note: "Fixture open item",
          actorId: actor,
        })
      )
    ).balance_id;

  const on = (label: string, debit: number, credit: number, extra: Partial<GeneralJournalLineValues>) =>
    line(accounts[label], debit, credit, { partner_id: partner, ...extra });

  const usd = (rate: number) => ({ currency_id: foreignCurrency, exchange_rate: rate });

  const draftAndPost = async (lines: GeneralJournalLineValues[]) => {
    const draft = await createGeneralJournal(header(), lines, actor);
    assert.ok(draft.ok, JSON.stringify(draft));
    const preview = await postGeneralJournal(draft.id, actor, scope, true);
    assert.ok(preview.ok, JSON.stringify(preview));
    const posted = await postGeneralJournal(draft.id, actor, scope);
    assert.ok(posted.ok && posted.postedJournalNo, JSON.stringify(posted));
    const journal = await prisma.accGeneralJournal.findUniqueOrThrow({ where: { id: draft.id } });
    const written = await prisma.accJournalLine.findMany({
      where: { journal_id: journal.posted_journal_id! },
      orderBy: { sequence_no: "asc" },
    });
    assert.deepEqual(
      preview.preview.map((l) => [l.debit, l.credit]),
      written.map((l) => [l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      "the preview equals the written journal"
    );
    return { id: draft.id, preview: posted.preview, written };
  };

  test("Case 1: Saldo baru lowers an item into an expense", async () => {
    const item = await openItem("Piutang", 10_000_000, 1, baseCurrency);
    const { id } = await draftAndPost([
      on("Piutang", 0, 0, { subject_id: item, new_value: 8_000_000 }),
      line(beban, 2_000_000, 0),
    ]);
    const stored = await prisma.accGeneralJournalLine.findFirstOrThrow({
      where: { journal_id: id, sequence_no: 1 },
    });
    assert.equal(stored.kredit_amount.toNumber(), 2_000_000, "Saldo baru became Kredit 2.000.000");
    assert.equal(stored.balance_before?.toNumber(), 10_000_000);
    assert.equal((await subledgerItem(item))!.remaining, 8_000_000);

    const entry = await prisma.subLedger.findFirstOrThrow({
      where: { balance_id: item, entry_type: "Adjustment" },
      include: { source_doc_type: { select: { doc_table: true } } },
    });
    assert.equal(entry.source_doc_type?.doc_table, "acc_general_journal");
    assert.equal(entry.source_doc_id, id);
  });

  test("Case 2: raising a foreign item takes its own kurs", async (t) => {
    if (!foreignCurrency) return t.skip("no foreign currency in this database");
    const item = await openItem("Hutang", 1_000, 15_800, foreignCurrency);
    const { preview } = await draftAndPost([
      on("Hutang", 0, 50, { subject_id: item, ...usd(99_999) }),
      line(beban, 50, 0, usd(16_200)),
    ]);
    assert.equal(preview[0].credit, 790_000, "the item's kurs, not the typed one");
    assert.equal(preview.at(-1)!.credit, 20_000, "Kredit Selisih 20.000");
    const after = (await subledgerItem(item))!;
    assert.deepEqual([after.remaining, after.baseRemaining, after.rate], [1_050, 16_590_000, 15_800]);
  });

  test("Case 3: AR/AP netting fixes its difference by the two items", async (t) => {
    if (!foreignCurrency) return t.skip("no foreign currency in this database");
    const hutang = await openItem("Hutang", 1_000, 15_800, foreignCurrency);
    const piutang = await openItem("Piutang", 600, 16_400, foreignCurrency);
    const { preview } = await draftAndPost([
      on("Hutang", 600, 0, { subject_id: hutang, ...usd(0) }),
      on("Piutang", 0, 600, { subject_id: piutang, ...usd(0) }),
    ]);
    assert.deepEqual(
      preview.map((l) => [l.debit, l.credit]),
      [[9_480_000, 0], [0, 9_840_000], [360_000, 0]]
    );
    const [h, p] = [(await subledgerItem(hutang))!, (await subledgerItem(piutang))!];
    assert.deepEqual([h.remaining, h.baseRemaining], [400, 6_320_000]);
    assert.equal(p.status, "Cleared");
  });

  test("Case 4: held money moves to its book as a new item", async (t) => {
    if (!foreignCurrency) return t.skip("no foreign currency in this database");
    const held = await openItem("Penerimaan Belum Teridentifikasi", 500, 16_000, foreignCurrency);
    const { id, preview } = await draftAndPost([
      on("Penerimaan Belum Teridentifikasi", 500, 0, { subject_id: held, ...usd(0) }),
      on("Titipan", 0, 500, { subject_id: null, ...usd(16_300) }),
    ]);
    assert.equal(preview.at(-1)!.debit, 150_000, "Debit Selisih 150.000");
    assert.equal((await subledgerItem(held))!.status, "Cleared");
    const opened = await prisma.subLedgerBalance.findFirstOrThrow({
      where: { source_doc_id: id, budget_category_id: book("Titipan").categoryId },
    });
    assert.deepEqual([opened.balance.toNumber(), opened.rate.toNumber()], [500, 16_300]);
  });

  test("a lowering names its item, and never takes it below nothing", async () => {
    const item = await openItem("Piutang", 1_000, 1, baseCurrency);
    const unnamed = await checkGeneralJournal(header(), [
      on("Piutang", 0, 500, { subject_id: null }),
      line(beban, 500, 0),
    ]);
    assert.ok(!unnamed.ok);
    assert.match(unnamed.errors["lines.0.subject_id"], /open item yang dilunasi/);

    const over = await checkGeneralJournal(header(), [
      on("Piutang", 0, 1_500, { subject_id: item }),
      line(beban, 1_500, 0),
    ]);
    assert.ok(!over.ok);
    assert.match(over.errors["lines.0.amount"], /tidak cukup/);
  });

  test("Case 10: Post refuses an item that moved since the draft", async () => {
    const item = await openItem("Piutang", 1_000, 1, baseCurrency);
    const draft = await createGeneralJournal(
      header(),
      [on("Piutang", 0, 600, { subject_id: item }), line(beban, 600, 0)],
      actor
    );
    assert.ok(draft.ok);
    await prisma.$transaction((tx) =>
      recordSubledgerEntry(tx, {
        book: book("Piutang"),
        partnerId: partner,
        currencyId: baseCurrency,
        date: today,
        type: "Transaction",
        direction: "In",
        amount: 300,
        rate: 1,
        itemId: item,
        actorId: actor,
      })
    );
    const refused = await postGeneralJournal(draft.id, actor, scope);
    assert.ok(!refused.ok);
    const itemNo = (await subledgerItem(item))!.itemNo;
    assert.match(refused.errors._form, new RegExp(`${itemNo} berubah`));
    assert.equal((await subledgerItem(item))!.remaining, 700, "nothing written");
  });

  test("Case 11: a currency crossing does not balance, and names the currency", async (t) => {
    if (!foreignCurrency) return t.skip("no foreign currency in this database");
    const item = await openItem("Hutang", 1_000, 15_800, foreignCurrency);
    const draft = await createGeneralJournal(
      header(),
      [on("Hutang", 100, 0, { subject_id: item, ...usd(0) }), line(beban, 0, 1_620_000)],
      actor
    );
    assert.ok(draft.ok);
    const refused = await postGeneralJournal(draft.id, actor, scope);
    assert.ok(!refused.ok);
    const label = (await prisma.refCurrency.findUniqueOrThrow({ where: { id: foreignCurrency } }))
      .currency_label;
    assert.match(refused.errors._form, new RegExp(`Nominal ${label} tidak seimbang`));
  });
});

describe("the manual journal", () => {
  test("JUR- still refuses a control account (Gate A)", async () => {
    const hutang = await makeAccount({
      companyId: company,
      subcategoryLabel: "2.1.1",
      normalBalance: "Kredit",
      partnerCategoryLabel: "Cabang",
      bookLabel: "Hutang",
    });
    await syncControlAccounts([hutang], await systemAccountIds(), actor);
    const manual = await checkManualJournal(header(), [
      { ...line(beban, 1_000, 0) },
      { ...line(hutang, 0, 1_000), partner_id: partner },
    ]);
    assert.ok(!manual.ok);
    assert.match(manual.errors["lines.1.account_id"], /control account/);
  });
});
