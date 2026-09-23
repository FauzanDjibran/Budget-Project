import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  OpeningBalanceImbalance,
  getOpeningBalance,
  listOpeningBalances,
  writeOpeningBalance,
} from "../src/lib/siba/opening-balance";
import { JournalImbalance, postJournal } from "../src/lib/siba/journal";
import { closingBalances, generalLedgerReport } from "../src/lib/siba/ledger";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import {
  FIXTURE_PREFIX,
  childCompanyId,
  cleanupFixtures,
  disconnect,
  makeAccount,
  makePartner,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The Opening Balance store, and the two things it rests on.
 *
 * A snapshot is immutable and has no rebuild function, so everything that
 * guarantees it is true has to happen at the moment it is written: it balances,
 * and it holds one line per `(account, partner?)` pair. Both are pushed at from
 * the two sides they could be got round — the writer's own checks, and the
 * database underneath it.
 *
 * `closingBalances` is the other half. It is what a close will hand the writer,
 * and its one property is that it agrees with the General Ledger: the same
 * journal lines, read at a finer grain, must still roll up to the same figure
 * the ledger prints.
 */

/**
 * A Draft fiscal year in the distant past, so nothing real collides with it.
 *
 * Draft rather than Open for two reasons. A snapshot attaches to a Draft year
 * by design — a close writes into the year that has not started yet, and §3.9
 * of the phase plan says Draft is enough. And an extra *Open* year would count
 * against the max-two-Open rule that `fiscal.test.ts` exercises, which is a
 * hazard when test files run side by side.
 */
const FIXTURE_YEAR = 1990;
const FIXTURE_YEAR_CODE = `fyr.${FIXTURE_PREFIX}${FIXTURE_YEAR}`;

let actor = 0;
let induk = 0;
let anak = 0;
let fiscalYear = 0;
let madeFiscalYear = false;
let currency = 0;

/**
 * Two Companies' worth of fixtures: one account that names a Partner and one
 * that does not, with Partners of that same Company.
 *
 * The anak's carry the written document, the induk's carry the journals
 * `closingBalances` reads. Keeping them apart means neither case can disturb
 * the other, and a snapshot can be refused for one Company while the other
 * still holds a good one.
 */
let anakReceivable = 0;
let anakCash = 0;
let anakBranch = 0;
let anakBranch2 = 0;
let indukReceivable = 0;
let indukCash = 0;
let branchA = 0;
let branchB = 0;

const openings: number[] = [];

before(async () => {
  actor = await systemUserId();
  induk = await parentCompanyId();
  anak = await childCompanyId();
  currency = (
    await prisma.refCurrency.findFirstOrThrow({
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;

  const existing = await prisma.accFiscalYear.findFirst({
    where: { year_code: FIXTURE_YEAR_CODE },
    select: { id: true },
  });
  if (existing) {
    fiscalYear = existing.id;
  } else {
    fiscalYear = (
      await prisma.accFiscalYear.create({
        data: {
          year_code: FIXTURE_YEAR_CODE,
          year_label: String(FIXTURE_YEAR),
          year_name: `Tahun Buku ${FIXTURE_YEAR}`,
          start_date: new Date(Date.UTC(FIXTURE_YEAR, 0, 1)),
          end_date: new Date(Date.UTC(FIXTURE_YEAR, 11, 31)),
          status: "Draft",
          created_by: actor,
        },
        select: { id: true },
      })
    ).id;
    madeFiscalYear = true;
  }

  anakReceivable = await makeAccount({
    companyId: anak,
    subcategoryLabel: "1.1.4",
    partnerCategoryLabel: "Cabang",
  });
  anakCash = await makeAccount({
    companyId: anak,
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
  });
  anakBranch = await makePartner({ companyId: anak, categoryLabel: "Cabang" });
  anakBranch2 = await makePartner({ companyId: anak, categoryLabel: "Cabang" });

  indukReceivable = await makeAccount({
    companyId: induk,
    subcategoryLabel: "1.1.4",
    partnerCategoryLabel: "Cabang",
  });
  indukCash = await makeAccount({
    companyId: induk,
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
  });
  branchA = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
  branchB = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
});

after(async () => {
  if (openings.length) {
    await prisma.accOpeningBalanceLine.deleteMany({
      where: { opening_id: { in: openings } },
    });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "acc_opening_balance", row_id: { in: openings } },
    });
    await prisma.accOpeningBalance.deleteMany({ where: { id: { in: openings } } });
  }
  await cleanupFixtures();
  if (madeFiscalYear) {
    await prisma.accFiscalYear.deleteMany({ where: { id: fiscalYear } });
  }
  await disconnect();
});

const snapshot = (
  companyId: number,
  lines: { accountId: number; partnerId?: number | null; debit: number; credit: number }[]
) => ({
  companyId,
  fiscalYearId: fiscalYear,
  sourceFiscalYearId: null,
  postingDate: new Date(Date.UTC(FIXTURE_YEAR, 0, 1)),
  lines,
  actorId: actor,
});

// ------------------------------------------------- the document's two sides

describe("an Opening Balance balances, or it is not written", () => {
  test("a balanced snapshot is written, and reads back", async () => {
    const result = await writeOpeningBalance(
      prisma,
      snapshot(anak, [
        { accountId: anakReceivable, partnerId: anakBranch, debit: 300_000, credit: 0 },
        { accountId: anakCash, debit: 700_000, credit: 0 },
        { accountId: anakReceivable, partnerId: anakBranch2, debit: 0, credit: 1_000_000 },
      ])
    );
    openings.push(result.id);
    assert.match(result.openingNo, /^OPB-\d{4}$/);

    const detail = await getOpeningBalance(result.id, [anak]);
    assert.ok(detail, "the snapshot reads back");
    assert.equal(detail.lines.length, 3);
    assert.equal(detail.debit, 1_000_000);
    assert.equal(detail.credit, 1_000_000);
    // Nothing produced it, which is what marks a go-live snapshot.
    assert.equal(detail.sourceFiscalYearLabel, null);
    // Sequence numbers are the writer's, in the order it was handed the lines.
    assert.deepEqual(
      detail.lines.map((l) => l.sequenceNo),
      [1, 2, 3]
    );
  });

  test("a snapshot of another Company reads as not found", async () => {
    const [written] = openings;
    assert.equal(await getOpeningBalance(written, [induk]), null);
  });

  test("an unbalanced snapshot is refused and writes nothing", async () => {
    const before = await prisma.accOpeningBalance.count();

    await assert.rejects(
      writeOpeningBalance(
        prisma,
        snapshot(induk, [
          { accountId: indukCash, debit: 1_000_000, credit: 0 },
          { accountId: indukReceivable, partnerId: branchA, debit: 0, credit: 999_999 },
        ])
      ),
      OpeningBalanceImbalance
    );

    assert.equal(
      await prisma.accOpeningBalance.count(),
      before,
      "a refused snapshot must leave no header behind"
    );
  });

  test("a line carrying both sides, or neither, is refused", async () => {
    for (const line of [
      { accountId: indukCash, debit: 500_000, credit: 500_000 },
      { accountId: indukCash, debit: 0, credit: 0 },
    ]) {
      await assert.rejects(
        writeOpeningBalance(
          prisma,
          snapshot(induk, [
            line,
            { accountId: indukReceivable, partnerId: branchA, debit: 0, credit: 500_000 },
          ])
        ),
        /tepat satu sisi/
      );
    }
  });

  test("a snapshot with no lines is refused", async () => {
    await assert.rejects(
      writeOpeningBalance(prisma, snapshot(induk, [])),
      /tanpa baris/
    );
  });
});

// ------------------------------------------------------- one line per pair

describe("one line per (account, partner?) pair", () => {
  test("the same account and partner twice is refused, by name", async () => {
    await assert.rejects(
      writeOpeningBalance(
        prisma,
        snapshot(induk, [
          { accountId: indukReceivable, partnerId: branchA, debit: 400_000, credit: 0 },
          { accountId: indukReceivable, partnerId: branchA, debit: 0, credit: 400_000 },
        ])
      ),
      /lebih dari satu kali/
    );
  });

  test("the same account with no partner twice is refused", async () => {
    // The case Postgres would let through on its own: NULL is distinct from
    // NULL by default, and an account naming no Partner is the common shape.
    await assert.rejects(
      writeOpeningBalance(
        prisma,
        snapshot(induk, [
          { accountId: indukCash, debit: 400_000, credit: 0 },
          { accountId: indukCash, debit: 0, credit: 400_000 },
        ])
      ),
      /tanpa partner/
    );
  });

  test("the database refuses a duplicate pair on its own", async () => {
    // The writer's check is the readable refusal; this is the guarantee under
    // it. A second null-partner row for one account is what `NULLS NOT
    // DISTINCT` exists for, and nothing else in the schema is written that way.
    const [opening] = openings;
    await assert.rejects(
      prisma.accOpeningBalanceLine.create({
        data: {
          opening_id: opening,
          sequence_no: 99,
          account_id: anakCash,
          partner_id: null,
          debit_amount: 1,
          kredit_amount: 0,
          created_by: actor,
        },
      }),
      /Unique constraint|unique/i
    );

    await assert.rejects(
      prisma.accOpeningBalanceLine.create({
        data: {
          opening_id: opening,
          sequence_no: 98,
          account_id: anakReceivable,
          partner_id: anakBranch,
          debit_amount: 1,
          kredit_amount: 0,
          created_by: actor,
        },
      }),
      /Unique constraint|unique/i
    );
  });

  test("one snapshot per Company per fiscal year", async () => {
    await assert.rejects(
      writeOpeningBalance(
        prisma,
        snapshot(anak, [
          { accountId: anakCash, debit: 1_000, credit: 0 },
          { accountId: anakReceivable, partnerId: anakBranch, debit: 0, credit: 1_000 },
        ])
      ),
      /Unique constraint|unique/i,
      "a second answer to where a Company stood on 1 January must be unreachable"
    );
  });

  test("the register lists only the reader's Companies", async () => {
    const rows = await listOpeningBalances([anak]);
    assert.ok(rows.some((r) => r.id === openings[0]));
    assert.ok(
      rows.every((r) => r.companyId === anak),
      "a register scoped to one Company must hold nothing from the other"
    );
  });
});

// ------------------------------------------- what a close will be handed

describe("closingBalances agrees with the General Ledger", () => {
  const WHOLE_TIME = { from: "2000-01-01", to: "2999-12-31" };
  const AS_OF = "2999-12-31";

  before(async () => {
    const line = (
      accountId: number,
      partnerId: number | null,
      debit: number,
      credit: number
    ) => ({
      accountId,
      partnerId,
      currencyId: currency,
      rate: 1,
      debit,
      credit,
      description: "Fixture",
    });

    const post = (lines: ReturnType<typeof line>[]) =>
      postJournal(prisma, {
        companyId: induk,
        description: "Fixture closing-balance journal",
        lines,
        actorId: actor,
      });

    await post([
      line(indukReceivable, branchA, 300_000, 0),
      line(indukCash, null, 0, 300_000),
    ]);
    await post([
      line(indukReceivable, branchB, 200_000, 0),
      line(indukCash, null, 0, 200_000),
    ]);
    await post([
      line(indukCash, null, 100_000, 0),
      line(indukReceivable, branchA, 0, 100_000),
    ]);
  });

  test("the partner grain is what was actually posted", async () => {
    const rows = (await closingBalances(induk, AS_OF)).filter(
      (r) => r.accountId === indukReceivable
    );

    assert.deepEqual(
      rows.map((r) => [r.partnerId, r.net]).sort((a, b) => Number(a[0]) - Number(b[0])),
      [
        [branchA, 200_000],
        [branchB, 200_000],
      ].sort((a, b) => Number(a[0]) - Number(b[0])),
      "one row per Partner actually posted against, at that Partner's own figure"
    );
  });

  test("the pairs roll up to the General Ledger's closing balance", async () => {
    const pairs = await closingBalances(induk, AS_OF);
    const ledger = await generalLedgerReport(
      [indukReceivable, indukCash],
      WHOLE_TIME,
      [induk]
    );

    for (const account of ledger.accounts) {
      const rolled = pairs
        .filter((p) => p.accountId === account.id)
        .reduce((t, p) => t + p.balance, 0);
      assert.equal(
        Math.round(rolled * 100),
        Math.round(account.closing * 100),
        `${account.label} disagrees with its own General Ledger`
      );
    }
  });

  test("an account with no Partner keeps one null-partner row", async () => {
    const rows = (await closingBalances(induk, AS_OF)).filter(
      (r) => r.accountId === indukCash
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].partnerId, null);
    // Kredit-side movement on a Debit account: 400.000 out, and the raw net
    // and the normal-balance signing disagree in sign, which is the whole
    // reason both are carried.
    assert.equal(rows[0].net, -400_000);
    assert.equal(rows[0].balance, -400_000);
  });

  test("a pair that settles to nothing is not a row", async () => {
    const settled = await makePartner({ companyId: induk, categoryLabel: "Cabang" });
    const line = (debit: number, credit: number, partnerId: number | null) => ({
      accountId: partnerId ? indukReceivable : indukCash,
      partnerId,
      currencyId: currency,
      rate: 1,
      debit,
      credit,
      description: "Fixture",
    });

    await postJournal(prisma, {
      companyId: induk,
      description: "Fixture settled pair",
      lines: [line(50_000, 0, settled), line(0, 50_000, null)],
      actorId: actor,
    });
    await postJournal(prisma, {
      companyId: induk,
      description: "Fixture settled pair",
      lines: [line(0, 50_000, settled), line(50_000, 0, null)],
      actorId: actor,
    });

    const rows = await closingBalances(induk, AS_OF);
    assert.equal(
      rows.filter((r) => r.partnerId === settled).length,
      0,
      "a Partner who owes nothing holds no position, and a zero line says nothing"
    );
  });

  test("a date cuts the balance off", async () => {
    // Every fixture journal is dated today, and the closing entry below is
    // dated the last day of 1990, so a balance struck in 1980 sees none of
    // them.
    const rows = (await closingBalances(induk, "1980-01-01")).filter(
      (r) => r.accountId === indukReceivable || r.accountId === indukCash
    );
    assert.deepEqual(rows, []);
  });
});

// ------------------------------------------- the closing journal's series

describe("a closing journal names its own date and series", () => {
  const line = (accountId: number, debit: number, credit: number) => ({
    accountId,
    currencyId: currency,
    rate: 1,
    debit,
    credit,
    description: "Fixture",
  });

  test("CLS is its own series, dated the day it is given", async () => {
    const lastDay = new Date(Date.UTC(FIXTURE_YEAR, 11, 31));
    const result = await postJournal(prisma, {
      companyId: induk,
      description: "Fixture closing journal",
      series: "CLS",
      postingDate: lastDay,
      lines: [line(indukCash, 1_000, 0), line(indukReceivable, 0, 1_000)],
      actorId: actor,
    });

    assert.match(result.journalNo, /^CLS-\d{4}$/);
    const written = await prisma.accJournal.findUniqueOrThrow({
      where: { id: result.id },
      select: { posting_date: true, status: true },
    });
    assert.equal(written.posting_date?.toISOString(), lastDay.toISOString());
    assert.equal(written.status, "Posted");
  });

  test("the balance rule is unchanged by the series", async () => {
    await assert.rejects(
      postJournal(prisma, {
        companyId: induk,
        description: "Fixture closing journal",
        series: "CLS",
        postingDate: new Date(Date.UTC(FIXTURE_YEAR, 11, 31)),
        lines: [line(indukCash, 1_000, 0), line(indukReceivable, 0, 999)],
        actorId: actor,
      }),
      JournalImbalance
    );
  });

  test("nothing but a closing journal may name its own date", async () => {
    // The single exception to the no-back-dating rule is the closing entry.
    // Tying the date to the series is what makes every other back-dated
    // journal unrepresentable rather than merely discouraged.
    await assert.rejects(
      postJournal(prisma, {
        companyId: induk,
        description: "Fixture back-dated journal",
        postingDate: new Date(Date.UTC(FIXTURE_YEAR, 5, 1)),
        lines: [line(indukCash, 1_000, 0), line(indukReceivable, 0, 1_000)],
        actorId: actor,
      }),
      /journal penutup tahun buku/
    );
  });

  test("an ordinary posting is still dated today, in the JRN series", async () => {
    const result = await postJournal(prisma, {
      companyId: induk,
      description: "Fixture ordinary journal",
      lines: [line(indukCash, 1_000, 0), line(indukReceivable, 0, 1_000)],
      actorId: actor,
    });
    assert.match(result.journalNo, /^JRN-\d{4}$/);

    const written = await prisma.accJournal.findUniqueOrThrow({
      where: { id: result.id },
      select: { posting_date: true },
    });
    assert.equal(
      written.posting_date?.toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10)
    );
  });
});
