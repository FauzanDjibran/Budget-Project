import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { BASE_CURRENCY_LABEL } from "../src/lib/siba/currency";
import {
  applyDncn,
  checkDncnHeader,
  checkDncnLines,
  nextNoteNo,
  positionRefusal,
} from "../src/lib/siba/dncn";
import { dncnDirection, type DncnType } from "../src/lib/siba/dncn-workflow";
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
import { checkSystemDefaultValue } from "../src/lib/siba/system-settings";
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
  prisma,
  systemUserId,
} from "./helpers";

/**
 * Debit / Credit Note.
 *
 * What the feature lives or dies by, none of it visible on a screen:
 *
 *   1. **One rule signs every book.** A Debit Note debits the Partner's
 *      account, so it raises a Piutang and lowers a Hutang; a Credit Note is
 *      the mirror. Nothing per book.
 *   2. **The book and the journal agree.** The subject-book entry and the
 *      journal's Partner line carry the same face and the same base, and the
 *      journal balances with the note's own account on the other side.
 *   3. **Nothing goes below zero** — refused at save, and again at Post under a
 *      lock, so two notes posted at once cannot both spend one position.
 *   4. **A foreign position relieves at its carrying rate**, and only a note
 *      that raises one takes a typed kurs.
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
let dnAccount = 0;
let cnAccount = 0;

const SETTINGS = [
  "induk_debit_note_account",
  "induk_credit_note_account",
  "anak_debit_note_account",
  "anak_credit_note_account",
] as const;
/** What the database held before this run, so it is put back rather than lost. */
const savedSettings = new Map<string, string | null>();

const notes: number[] = [];

async function setSetting(key: string, value: number | null) {
  if (value === null) {
    await prisma.sysSetting.deleteMany({ where: { setting_key: key } });
    return;
  }
  await prisma.sysSetting.upsert({
    where: { setting_key: key },
    update: { setting_value: String(value) },
    create: { setting_key: key, setting_value: String(value) },
  });
}

/** A position that already stands — written straight into the book. */
async function seedPosition(
  book: SubledgerDef,
  partnerId: number,
  currencyId: number,
  amount: number,
  rate = 1
) {
  await prisma.$transaction((tx) =>
    recordSubledgerEntry(tx, {
      book,
      partnerId,
      currencyId,
      date: new Date().toISOString().slice(0, 10),
      type: "Transaction",
      // Whichever cash direction raises this book.
      direction: book.raises,
      amount,
      rate,
      note: `${FIXTURE_PREFIX} seed`,
      actorId: actor,
    })
  );
}

/** A Draft, written the way `createDncn` writes one. */
async function makeNote(options: {
  type: DncnType;
  book: SubledgerDef;
  partnerId: number;
  companyId?: number;
  currencyId?: number;
  rate?: number | null;
  lines: [string, number][];
}): Promise<number> {
  const total = options.lines.reduce((t, [, a]) => t + a, 0);
  const row = await prisma.finDncn.create({
    data: {
      note_no: await nextNoteNo(options.type),
      note_type: options.type,
      company_id: options.companyId ?? induk,
      budget_category_id: options.book.categoryId,
      partner_id: options.partnerId,
      currency_id: options.currencyId ?? idr,
      exchange_rate:
        options.rate === undefined ? (options.currencyId ?? idr) === idr ? 1 : null : options.rate,
      note_amount: total,
      status: "Draft",
      created_by: actor,
      lines: {
        create: options.lines.map(([description, amount], i) => ({
          sequence_no: i + 1,
          description,
          amount,
          created_by: actor,
        })),
      },
    },
    select: { id: true },
  });
  notes.push(row.id);
  return row.id;
}

const position = (book: SubledgerDef, partnerId: number, currencyId = idr) =>
  subledgerPosition(book.key, partnerId, currencyId);

const journalOf = (noteId: number) =>
  prisma.accJournal.findFirstOrThrow({
    where: {
      source_doc_id: noteId,
      source_doc_type: { doc_table: "fin_dncn" },
    },
    include: { lines: { orderBy: { id: "asc" } } },
  });

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
        currency_name: "Fixture DN/CN Currency",
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

  // The counter side: one account per note type, per Company.
  dnAccount = await makeAccount({ companyId: induk, subcategoryLabel: "5.3.1" });
  cnAccount = await makeAccount({ companyId: induk, subcategoryLabel: "5.3.1" });
  for (const key of SETTINGS) {
    const row = await prisma.sysSetting.findUnique({ where: { setting_key: key } });
    savedSettings.set(key, row?.setting_value ?? null);
  }
  await setSetting("induk_debit_note_account", dnAccount);
  await setSetting("induk_credit_note_account", cnAccount);
});

after(async () => {
  for (const [key, value] of savedSettings) {
    if (value === null) await prisma.sysSetting.deleteMany({ where: { setting_key: key } });
    else await setSetting(key, Number(value));
  }
  if (notes.length) {
    await prisma.finDncnLine.deleteMany({ where: { note_id: { in: notes } } });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "fin_dncn", row_id: { in: notes } },
    });
    await prisma.finDncn.deleteMany({ where: { id: { in: notes } } });
  }
  await cleanupFiscalYear();
  await cleanupFixtures();
  await disconnect();
});

// ------------------------------------------------------------------ the rule

describe("one rule signs every book", () => {
  test("a Debit Note raises a Piutang and lowers a Hutang; a Credit Note the mirror", () => {
    const moves = (book: SubledgerDef, type: DncnType) =>
      subledgerMovement(book, dncnDirection(type), 100);
    assert.equal(moves(piutang, "Debit"), 100);
    assert.equal(moves(piutang, "Credit"), -100);
    assert.equal(moves(hutang, "Debit"), -100);
    assert.equal(moves(hutang, "Credit"), 100);
  });

  test("only books carrying allows_dncn are adjustable, and the seed flags three", async () => {
    const flagged = await prisma.sysBudgetCategory.findMany({
      where: { allows_dncn: true },
      select: { category_label: true },
    });
    const labels = flagged.map((f) => f.category_label);
    for (const off of ["Prive", "Investasi", "Hasil Investasi", "Asset", "Biaya"]) {
      assert.ok(!labels.includes(off), `${off} must not allow a Debit / Credit Note`);
    }

    const partner = await makePartner({ companyId: induk, categoryLabel: "Stakeholder" });
    const checked = await checkDncnHeader(
      {
        note_type: "Debit",
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
        data: { allows_dncn: true },
      }),
      /sys_budget_category_dncn_needs_book/
    );
  });
});

// ------------------------------------------------------------------ the header

describe("the header", () => {
  const header = (partner: number, overrides: Record<string, unknown> = {}) => ({
    note_type: "Credit",
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
    const checked = await checkDncnHeader(header(partner) as never, [induk]);
    assert.ok(!checked.ok && checked.errors.partner_id);
  });

  test("a Partner outside the reader's Companies reads as not found", async () => {
    const partner = await makePartner({ companyId: anak, categoryLabel: "Karyawan" });
    const checked = await checkDncnHeader(header(partner) as never, [induk]);
    assert.ok(!checked.ok && /tidak ditemukan/.test(checked.errors.partner_id));
  });

  test("a Partner of a category the book does not admit is refused", async () => {
    // Titipan admits Cabang and Stakeholder, never Karyawan.
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const titipan = subledgerForCategory(books, await budgetCategoryId("Titipan"))!;
    const checked = await checkDncnHeader(
      header(partner, { budget_category_id: titipan.categoryId }) as never,
      [induk]
    );
    assert.ok(!checked.ok && checked.errors.partner_id);
  });

  test("a note raising a foreign position needs a kurs; one lowering it takes none", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });

    const raiseNoRate = await checkDncnHeader(
      header(partner, { note_type: "Debit", currency_id: foreign }) as never,
      [induk]
    );
    assert.ok(!raiseNoRate.ok && raiseNoRate.errors.exchange_rate);

    const raise = await checkDncnHeader(
      header(partner, { note_type: "Debit", currency_id: foreign, exchange_rate: 16000 }) as never,
      [induk]
    );
    assert.ok(raise.ok && raise.raises && raise.rate === 16000);

    const lowerWithRate = await checkDncnHeader(
      header(partner, { currency_id: foreign, exchange_rate: 16000 }) as never,
      [induk]
    );
    assert.ok(!lowerWithRate.ok && lowerWithRate.errors.exchange_rate);

    const base = await checkDncnHeader(header(partner) as never, [induk]);
    assert.ok(base.ok && base.rate === 1 && !base.raises);
  });

  test("every line needs a reason and a positive amount", () => {
    assert.equal(checkDncnLines([]).ok, false);
    assert.equal(checkDncnLines([{ description: "", amount: 10 }]).ok, false);
    assert.equal(checkDncnLines([{ description: "Diskon", amount: 0 }]).ok, false);
    const ok = checkDncnLines([
      { description: "Diskon", amount: 100 },
      { description: "Retur", amount: 250.5 },
    ]);
    assert.ok(ok.ok && ok.total === 350.5);
  });
});

// ------------------------------------------------------------------ zero rule

describe("nothing below zero", () => {
  test("a negative position is refused, a lowering past zero is refused, to zero is fine", () => {
    assert.ok(positionRefusal({ foreign: -1 }, true, 10, "IDR"));
    assert.ok(positionRefusal({ foreign: 100 }, false, 101, "IDR"));
    assert.equal(positionRefusal({ foreign: 100 }, false, 100, "IDR"), null);
    assert.equal(positionRefusal({ foreign: 0 }, true, 100, "IDR"), null);
  });

  test("a note waits for the position, and sees what the writer before it left", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    await seedPosition(piutang, partner, idr, 100_000);
    const id = await makeNote({ type: "Credit", book: piutang, partnerId: partner, lines: [["B", 100_000]] });

    // Another writer holds the position and spends all of it, slowly. Racing two
    // posts against each other proved nothing — they rarely overlap — so the
    // overlap is made certain: the note starts while this transaction is open.
    // Without the lock the note reads the uncommitted-over 100.000, passes its
    // check, and both writes land.
    const holder = prisma.$transaction(
      async (tx) => {
        await lockSubledgerPosition(tx, piutang.key, partner, idr);
        await new Promise((r) => setTimeout(r, 500));
        await recordSubledgerEntry(tx, {
          book: piutang,
          partnerId: partner,
          currencyId: idr,
          date: new Date().toISOString().slice(0, 10),
          type: "Transaction",
          direction: piutang.raises === "Out" ? "In" : "Out",
          amount: 100_000,
          rate: 1,
          note: `${FIXTURE_PREFIX} other writer`,
          actorId: actor,
        });
      },
      { timeout: 10_000 }
    );
    await new Promise((r) => setTimeout(r, 100));

    const result = await applyDncn(id, actor);
    await holder;

    assert.equal(result.ok, false, "the note must see the position already spent");
    assert.deepEqual(await position(piutang, partner), { foreign: 0, base: 0 });
  });
});

// ------------------------------------------------------------------ posting

describe("posting", () => {
  test("a Draft adjusts nothing", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    await seedPosition(piutang, partner, idr, 500_000);
    await makeNote({ type: "Credit", book: piutang, partnerId: partner, lines: [["X", 200_000]] });
    assert.deepEqual(await position(piutang, partner), { foreign: 500_000, base: 500_000 });
  });

  test("a Credit Note lowers a Piutang, and the book and the journal agree", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    await seedPosition(piutang, partner, idr, 1_000_000);
    const id = await makeNote({
      type: "Credit",
      book: piutang,
      partnerId: partner,
      lines: [
        ["Diskon pelunasan", 100_000],
        ["Retur barang", 200_000],
      ],
    });

    const posted = await applyDncn(id, actor);
    assert.ok(posted.ok, JSON.stringify(posted));
    assert.deepEqual(await position(piutang, partner), { foreign: 700_000, base: 700_000 });

    const entry = await prisma.subLedger.findFirstOrThrow({
      where: { source_doc_id: id, source_doc_type: { doc_table: "fin_dncn" } },
    });
    assert.equal(entry.entry_type, "Adjustment");
    assert.equal(entry.movement.toNumber(), -300_000);

    const journal = await journalOf(id);
    const debit = journal.lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0);
    const credit = journal.lines.reduce((t, l) => t + l.kredit_amount.toNumber(), 0);
    assert.equal(debit, 300_000);
    assert.equal(credit, 300_000);
    const partnerLine = journal.lines.find((l) => l.account_id === piutangAccount)!;
    assert.equal(partnerLine.kredit_amount.toNumber(), 300_000, "a Credit Note credits the Partner");
    assert.equal(partnerLine.partner_id, partner);
    const counter = journal.lines.filter((l) => l.account_id === cnAccount);
    assert.deepEqual(
      counter.map((l) => l.debit_amount.toNumber()),
      [100_000, 200_000],
      "one counter line per note line, on the debit side"
    );

    const note = await prisma.finDncn.findUniqueOrThrow({
      where: { id },
      include: { lines: { orderBy: { sequence_no: "asc" } } },
    });
    assert.equal(note.status, "Posted");
    assert.ok(note.document_date && note.posting_date);
    assert.equal(note.note_base_amount.toNumber(), 300_000);
    assert.deepEqual(note.lines.map((l) => l.base_amount.toNumber()), [100_000, 200_000]);

    assert.equal((await applyDncn(id, actor)).ok, false, "a posted note is final");
  });

  test("a Debit Note lowers a Hutang to nil, and one may raise a position from nothing", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    await seedPosition(hutang, partner, idr, 500_000);
    const down = await makeNote({ type: "Debit", book: hutang, partnerId: partner, lines: [["Klaim", 500_000]] });
    assert.ok((await applyDncn(down, actor)).ok);
    assert.deepEqual(await position(hutang, partner), { foreign: 0, base: 0 });
    const line = (await journalOf(down)).lines.find((l) => l.account_id === hutangAccount)!;
    assert.equal(line.debit_amount.toNumber(), 500_000, "a Debit Note debits the Partner");

    const fresh = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const up = await makeNote({ type: "Debit", book: piutang, partnerId: fresh, lines: [["Denda", 75_000]] });
    assert.ok((await applyDncn(up, actor)).ok);
    assert.deepEqual(await position(piutang, fresh), { foreign: 75_000, base: 75_000 });
    const counter = (await journalOf(up)).lines.find((l) => l.account_id === dnAccount)!;
    assert.equal(counter.kredit_amount.toNumber(), 75_000, "the Debit Note account is credited");
  });

  test("a foreign position is relieved at its carrying rate, the remainder exactly", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    // 1.000 carried at 15.500, then 1.000 at 16.000 — a carrying rate of 15.750.
    await seedPosition(piutang, partner, foreign, 1_000, 15_500);
    await seedPosition(piutang, partner, foreign, 1_000, 16_000);

    const part = await makeNote({
      type: "Credit",
      book: piutang,
      partnerId: partner,
      currencyId: foreign,
      rate: null,
      lines: [["Potongan", 200]],
    });
    const posted = await applyDncn(part, actor);
    assert.ok(posted.ok && posted.baseAmount === 3_150_000, JSON.stringify(posted));

    const journal = await journalOf(part);
    const debit = journal.lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0);
    const credit = journal.lines.reduce((t, l) => t + l.kredit_amount.toNumber(), 0);
    assert.equal(debit, credit, "no FX difference: both sides carry the released base");

    const rest = await makeNote({
      type: "Credit",
      book: piutang,
      partnerId: partner,
      currencyId: foreign,
      rate: null,
      lines: [["Pelunasan sisa", 1_800]],
    });
    assert.ok((await applyDncn(rest, actor)).ok);
    assert.deepEqual(
      await position(piutang, partner, foreign),
      { foreign: 0, base: 0 },
      "emptying a position releases its remaining base exactly"
    );
  });

  test("a foreign note raising a position originates at the stated kurs", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    const id = await makeNote({
      type: "Debit",
      book: piutang,
      partnerId: partner,
      currencyId: foreign,
      rate: 16_250,
      lines: [["Tagihan tambahan", 100]],
    });
    const posted = await applyDncn(id, actor);
    assert.ok(posted.ok && posted.baseAmount === 1_625_000);
    assert.deepEqual(await position(piutang, partner, foreign), {
      foreign: 100,
      base: 1_625_000,
    });
  });

  test("a note taking a position below zero is refused at Post and writes nothing", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    await seedPosition(piutang, partner, idr, 50_000);
    const id = await makeNote({ type: "Credit", book: piutang, partnerId: partner, lines: [["X", 60_000]] });
    const refused = await applyDncn(id, actor);
    assert.equal(refused.ok, false);
    assert.deepEqual(await position(piutang, partner), { foreign: 50_000, base: 50_000 });
    const note = await prisma.finDncn.findUniqueOrThrow({ where: { id } });
    assert.equal(note.status, "Draft");
  });

  test("a negative position is refused at Post", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    // An overpaid receivable: money came back beyond what was owed.
    await prisma.$transaction((tx) =>
      recordSubledgerEntry(tx, {
        book: piutang,
        partnerId: partner,
        currencyId: idr,
        date: new Date().toISOString().slice(0, 10),
        type: "Transaction",
        direction: "In",
        amount: 10_000,
        rate: 1,
        note: `${FIXTURE_PREFIX} overpaid`,
        actorId: actor,
      })
    );
    const id = await makeNote({ type: "Debit", book: piutang, partnerId: partner, lines: [["X", 5_000]] });
    const refused = await applyDncn(id, actor);
    assert.ok(!refused.ok && /di bawah nol/.test(refused.errors._form));
  });

  test("a missing note account refuses by name, and nothing moves", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    await seedPosition(piutang, partner, idr, 100_000);
    const id = await makeNote({ type: "Credit", book: piutang, partnerId: partner, lines: [["X", 10_000]] });
    await setSetting("induk_credit_note_account", null);
    try {
      const refused = await applyDncn(id, actor);
      assert.ok(!refused.ok && /Credit Note/.test(refused.errors._form));
      assert.deepEqual(await position(piutang, partner), { foreign: 100_000, base: 100_000 });
    } finally {
      await setSetting("induk_credit_note_account", cnAccount);
    }
  });

  test("a closed year refuses the note", async () => {
    const partner = await makePartner({ companyId: induk, categoryLabel: "Karyawan" });
    await seedPosition(piutang, partner, idr, 100_000);
    const id = await makeNote({ type: "Credit", book: piutang, partnerId: partner, lines: [["X", 10_000]] });
    const reopen = await closeYearFor(fiscalYear, induk);
    try {
      assert.equal((await applyDncn(id, actor)).ok, false);
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
    await setSetting(
      "anak_credit_note_account",
      await makeAccount({ companyId: anak, subcategoryLabel: "5.3.1" })
    );
    const partner = await makePartner({ companyId: anak, categoryLabel: "Karyawan" });
    await seedPosition(piutang, partner, idr, 40_000);
    const id = await makeNote({
      type: "Credit",
      book: piutang,
      partnerId: partner,
      companyId: anak,
      lines: [["Diskon", 40_000]],
    });
    const posted = await applyDncn(id, actor);
    assert.ok(posted.ok, JSON.stringify(posted));
    assert.equal((await journalOf(id)).company_id, anak);
  });
});

// ------------------------------------------------------------------ settings

describe("the note accounts", () => {
  test("an account a book already reconciles against is refused as a note account", async () => {
    const refusal = await checkSystemDefaultValue("induk_debit_note_account", piutangAccount);
    assert.ok(refusal && /direkonsiliasi/.test(refusal), String(refusal));
    assert.equal(await checkSystemDefaultValue("induk_debit_note_account", dnAccount), null);
  });
});
