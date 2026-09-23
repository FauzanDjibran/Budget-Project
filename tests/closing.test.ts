import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { closingPlan, executeClosing } from "../src/lib/siba/closing";
import { unclosedPriorYear } from "../src/lib/siba/fiscal";
import { closingBalances, generalLedgerReport } from "../src/lib/siba/ledger";
import { getOpeningBalance } from "../src/lib/siba/opening-balance";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import type { SystemDefaultKey } from "../src/lib/siba/system-defaults";
import {
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
 * Closing a fiscal year.
 *
 * The one irreversible act in the application, and the only one that writes
 * three things at once — a back-dated journal, a snapshot, and the record that
 * the year is shut. Each of those is checked here on its own, and so is the
 * property that ties them together: after the close, every ProfitLoss balance
 * is exactly zero and what is left reconciles with the General Ledger.
 *
 * ## Why 1990
 *
 * The suite closes a fiscal year in the distant past, with journals it wrote
 * itself. That is what makes it safe to run against a database somebody is
 * using: nothing real is dated in 1990, so `closingBalances` for that year
 * returns this file's fixtures and nothing else, and the closing journal it
 * posts touches only fixture accounts — which is also what lets the teardown
 * remove it. Closing a year with live data in it would move that data into
 * equity, and no teardown can undo a posted journal.
 *
 * The fixture journals are inserted directly rather than through `postJournal`,
 * because `postJournal` deliberately refuses to back-date anything but a
 * closing entry (§3.8). Building the *history* a close operates on is the one
 * thing that cannot go through the engine whose whole job is to refuse it.
 */

const FY = 1990;
const NEXT_FY = 1991;
const YEAR_PREFIX = "test.cls.";

let actor = 0;
let induk = 0;
let anak = 0;
let fiscalYear = 0;
let nextYear = 0;

/** One Company's fixtures: somewhere for cash, income, expense and equity. */
type Chart = {
  cash: number;
  income: number;
  expense: number;
  accumulated: number;
  current: number;
};
let indukChart: Chart;
let anakChart: Chart;
let branch = 0;

/** What the settings held before this file touched them. */
const savedSettings = new Map<SystemDefaultKey, string | null>();

async function makeChart(companyId: number): Promise<Chart> {
  return {
    cash: await makeAccount({
      companyId,
      subcategoryLabel: CASH_BANK_SUBCATEGORY,
      normalBalance: "Debit",
    }),
    income: await makeAccount({
      companyId,
      subcategoryLabel: "4.1.1",
      normalBalance: "Kredit",
    }),
    expense: await makeAccount({
      companyId,
      subcategoryLabel: "5.3.1",
      normalBalance: "Debit",
    }),
    accumulated: await makeAccount({
      companyId,
      subcategoryLabel: "3.3.1",
      normalBalance: "Kredit",
    }),
    current: await makeAccount({
      companyId,
      subcategoryLabel: "3.4.1",
      normalBalance: "Kredit",
    }),
  };
}

async function makeYear(
  year: number,
  status: "Draft" | "Open" | "Closed"
): Promise<number> {
  const row = await prisma.accFiscalYear.create({
    data: {
      year_code: `${YEAR_PREFIX}${year}`,
      year_label: String(year),
      year_name: `Tahun Buku ${year}`,
      start_date: new Date(Date.UTC(year, 0, 1)),
      end_date: new Date(Date.UTC(year, 11, 31)),
      status,
      created_by: actor,
    },
    select: { id: true },
  });
  return row.id;
}

let baseCurrency = 0;

type FixtureLine = {
  accountId: number;
  partnerId?: number | null;
  debit: number;
  credit: number;
};

/** A posted journal dated inside the fixture year — see the file's note. */
async function postFixtureJournal(
  companyId: number,
  date: Date,
  lines: FixtureLine[],
  status: "Posted" | "Draft" = "Posted"
): Promise<number> {
  const row = await prisma.accJournal.create({
    data: {
      journal_no: `ZZC-${Date.now() % 100000}-${Math.floor(Math.random() * 1000)}`,
      posting_date: status === "Posted" ? date : null,
      created_at: date,
      company_id: companyId,
      description: "Fixture",
      status,
      is_manual: status === "Draft",
      created_by: actor,
      lines: {
        create: lines.map((l, i) => ({
          sequence_no: i + 1,
          account_id: l.accountId,
          partner_id: l.partnerId ?? null,
          currency_id: baseCurrency,
          exchange_rate: 1,
          debit_amount: l.debit,
          kredit_amount: l.credit,
          trx_amount: l.debit || l.credit,
          description: "Fixture",
          created_by: actor,
        })),
      },
    },
    select: { id: true },
  });
  return row.id;
}

async function setSetting(key: SystemDefaultKey, value: string | null) {
  if (!savedSettings.has(key)) {
    const row = await prisma.sysSetting.findUnique({
      where: { setting_key: key },
      select: { setting_value: true },
    });
    savedSettings.set(key, row?.setting_value ?? null);
  }
  await prisma.sysSetting.upsert({
    where: { setting_key: key },
    update: { setting_value: value, updated_by: actor },
    create: { setting_key: key, setting_value: value, updated_by: actor },
  });
}

before(async () => {
  actor = await systemUserId();
  induk = await parentCompanyId();
  anak = await childCompanyId();
  baseCurrency = (
    await prisma.refCurrency.findFirstOrThrow({
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;

  // A run that died before its teardown leaves these behind; clearing them
  // first is what makes the file re-runnable rather than poisoned.
  await wipeFixtureYears();

  fiscalYear = await makeYear(FY, "Open");
  nextYear = await makeYear(NEXT_FY, "Draft");

  indukChart = await makeChart(induk);
  anakChart = await makeChart(anak);
  branch = await makePartner({ companyId: induk, categoryLabel: "Cabang" });

  await setSetting("induk_accumulated_pl_account", String(indukChart.accumulated));
  await setSetting("anak_accumulated_pl_account", String(anakChart.accumulated));

  const mid = new Date(Date.UTC(FY, 5, 30));

  // The induk makes a profit: a million in, four hundred thousand out — and
  // part of the expense names a Partner, so the closing journal has to zero a
  // pair rather than only an account.
  await postFixtureJournal(induk, mid, [
    { accountId: indukChart.cash, debit: 1_000_000, credit: 0 },
    { accountId: indukChart.income, debit: 0, credit: 1_000_000 },
  ]);
  await postFixtureJournal(induk, mid, [
    { accountId: indukChart.expense, debit: 300_000, credit: 0 },
    { accountId: indukChart.cash, debit: 0, credit: 300_000 },
  ]);
  await postFixtureJournal(induk, mid, [
    { accountId: indukChart.expense, partnerId: branch, debit: 100_000, credit: 0 },
    { accountId: indukChart.cash, debit: 0, credit: 100_000 },
  ]);

  // The anak makes a loss: it only spends.
  await postFixtureJournal(anak, mid, [
    { accountId: anakChart.expense, debit: 250_000, credit: 0 },
    { accountId: anakChart.cash, debit: 0, credit: 250_000 },
  ]);
});

/** Everything this file's fiscal years carry, whoever wrote it. */
async function wipeFixtureYears() {
  const years = await prisma.accFiscalYear.findMany({
    where: { year_code: { startsWith: YEAR_PREFIX } },
    select: { id: true },
  });
  const ids = years.map((y) => y.id);
  if (!ids.length) return;

  const openings = await prisma.accOpeningBalance.findMany({
    where: {
      OR: [
        { fiscal_year_id: { in: ids } },
        { source_fiscal_year_id: { in: ids } },
      ],
    },
    select: { id: true },
  });
  const openingIds = openings.map((o) => o.id);
  if (openingIds.length) {
    await prisma.accOpeningBalanceLine.deleteMany({
      where: { opening_id: { in: openingIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "acc_opening_balance", row_id: { in: openingIds } },
    });
    await prisma.accOpeningBalance.deleteMany({ where: { id: { in: openingIds } } });
  }

  const closings = await prisma.accFiscalClosing.findMany({
    where: { fiscal_year_id: { in: ids } },
    select: { id: true },
  });
  if (closings.length) {
    await prisma.auditLog.deleteMany({
      where: {
        entity_key: "acc_fiscal_closing",
        row_id: { in: closings.map((c) => c.id) },
      },
    });
    await prisma.accFiscalClosing.deleteMany({ where: { fiscal_year_id: { in: ids } } });
  }

  await prisma.auditLog.deleteMany({
    where: { entity_key: "acc_fiscal_year", row_id: { in: ids } },
  });
  await prisma.accFiscalPeriod.deleteMany({ where: { fiscal_year_id: { in: ids } } });
  await prisma.accFiscalYear.deleteMany({ where: { id: { in: ids } } });
}

after(async () => {
  await wipeFixtureYears();
  // Settings go back before the accounts they point at are deleted, or the
  // System Default would be left naming a row that no longer exists.
  for (const [key, value] of savedSettings) {
    if (value === null) {
      await prisma.sysSetting.deleteMany({ where: { setting_key: key } });
    } else {
      await prisma.sysSetting.update({
        where: { setting_key: key },
        data: { setting_value: value },
      });
    }
  }
  await cleanupFixtures();
  await disconnect();
});

const plan = (companyId: number, yearId = fiscalYear) =>
  closingPlan(companyId, yearId);

const check = async (
  companyId: number,
  key: string,
  yearId = fiscalYear
) => {
  const p = await plan(companyId, yearId);
  assert.ok(p, "the plan resolves");
  const found = p.checks.find((c) => c.key === key);
  assert.ok(found, `no check named ${key}`);
  return found;
};

// ------------------------------------------------------- the preview

describe("the closing journal zeroes the profit and loss", () => {
  test("every ProfitLoss balance is posted to the opposite side", async () => {
    const p = await plan(induk);
    assert.ok(p?.ready, `not ready: ${JSON.stringify(p?.checks.filter((c) => !c.ok))}`);
    assert.ok(p.preview);
    const preview = p.preview;

    const pairs = await closingBalances(induk, `${FY}-12-31`);
    const profitLoss = pairs.filter((x) => x.section === "ProfitLoss");
    assert.equal(profitLoss.length, 3, "income, expense, and expense-per-partner");

    for (const pair of profitLoss) {
      const line = preview.lines.find(
        (l) => l.accountId === pair.accountId && l.partnerId === pair.partnerId
      );
      assert.ok(line, `${pair.accountLabel} is not in the closing journal`);
      // Posted to the opposite side of where it stands, at its own figure,
      // which is the only thing that leaves the pair at exactly nil.
      assert.equal(line.debit - line.credit, -pair.net);
    }
  });

  test("the residual is the year's result, on the equity account", async () => {
    const p = await plan(induk);
    // 1.000.000 in, 400.000 out: a profit of 600.000, credited to equity.
    assert.equal(p!.preview!.result, -600_000);

    const residual = p!.preview!.lines.filter((l) => l.residual);
    assert.equal(residual.length, 1, "exactly one equity line");
    assert.equal(residual[0].accountId, indukChart.accumulated);
    assert.equal(residual[0].credit, 600_000);
    assert.equal(residual[0].debit, 0);
  });

  test("a loss lands on the other side", async () => {
    const p = await plan(anak);
    assert.equal(p!.preview!.result, 250_000, "spending only is a loss");
    const residual = p!.preview!.lines.find((l) => l.residual)!;
    assert.equal(residual.debit, 250_000);
    assert.equal(residual.credit, 0);
  });

  test("the preview counts the snapshot the close will actually write", async () => {
    // Counted on the position the close *leaves*, not the one it starts from:
    // the equity account has no balance here and gains one from the residual,
    // so a count taken before the journal would be short by exactly that line.
    const p = await plan(induk);
    const sheet = (await closingBalances(induk, `${FY}-12-31`)).filter(
      (x) => x.section === "BalanceSheet"
    );
    assert.equal(
      sheet.some((x) => x.accountId === indukChart.accumulated),
      false,
      "the equity account starts with nothing on it"
    );
    assert.equal(p!.preview!.snapshotLines, sheet.length + 1);
  });

  test("the journal balances by construction", async () => {
    for (const company of [induk, anak]) {
      const p = await plan(company);
      assert.equal(
        Math.round(p!.preview!.debit * 100),
        Math.round(p!.preview!.credit * 100)
      );
    }
  });

  test("Laba/Rugi Tahun Berjalan is never in it", async () => {
    // The current-year account is a Neraca presentation line, computed as
    // Pendapatan minus Biaya while the year is open. A posting on it would
    // leave the line named "tahun berjalan" carrying last year's result.
    for (const [company, chart] of [
      [induk, indukChart],
      [anak, anakChart],
    ] as const) {
      const p = await plan(company);
      assert.ok(
        p!.preview!.lines.every((l) => l.accountId !== chart.current),
        "nothing posts to Laba/Rugi Tahun Berjalan"
      );
    }
  });
});

// --------------------------------------------------- the blocking checks

describe("every blocking condition refuses by name", () => {
  test("a year that is not Open", async () => {
    const c = await check(induk, "year_open", nextYear);
    assert.equal(c.ok, false);
    assert.match(c.detail, /Draft/);
  });

  test("a year that is not the oldest Open one", async () => {
    const older = await makeYear(FY - 1, "Open");
    try {
      const c = await check(induk, "oldest_open");
      assert.equal(c.ok, false);
      assert.match(c.detail, new RegExp(String(FY - 1)));
    } finally {
      await prisma.accFiscalYear.delete({ where: { id: older } });
    }
  });

  test("no fiscal year after this one", async () => {
    // Asked of the newest year the calendar has, because that is the only
    // year with nothing after it — moving 1991 out of the way would not do,
    // since the real calendar's own years still start after 1990 and one of
    // them would inherit instead.
    const latest = await makeYear(2190, "Draft");
    try {
      const c = await check(induk, "next_year", latest);
      assert.equal(c.ok, false);
      assert.match(c.detail, /tahun buku berikutnya/i);
    } finally {
      await prisma.accFiscalYear.delete({ where: { id: latest } });
    }
  });

  test("the snapshot goes to the next year that exists, not to a label plus one", async () => {
    // 1991 is what inherits here because it is the nearest year starting after
    // 1990 ends. A calendar with a gap in it has exactly one candidate, and it
    // is this one — the label is a string somebody typed, the dates are what
    // the calendar actually spans.
    const c = await check(induk, "next_year");
    assert.equal(c.ok, true);
    assert.match(c.detail, new RegExp(String(NEXT_FY)));
  });

  test("an unset accumulated account, by the setting's own name", async () => {
    await setSetting("induk_accumulated_pl_account", null);
    try {
      const c = await check(induk, "accumulated_account");
      assert.equal(c.ok, false);
      assert.match(c.detail, /Laba\/Rugi Tahun Sebelumnya — Induk/);
    } finally {
      await setSetting("induk_accumulated_pl_account", String(indukChart.accumulated));
    }
  });

  test("an accumulated account that has since been deactivated", async () => {
    await prisma.accAccount.update({
      where: { id: indukChart.accumulated },
      data: { is_active: false },
    });
    try {
      const c = await check(induk, "accumulated_account");
      assert.equal(c.ok, false, "a setting resolved against the master, not trusted");
    } finally {
      await prisma.accAccount.update({
        where: { id: indukChart.accumulated },
        data: { is_active: true },
      });
    }
  });

  test("a Draft journal created inside the year", async () => {
    const draft = await postFixtureJournal(
      induk,
      new Date(Date.UTC(FY, 7, 1)),
      [{ accountId: indukChart.expense, debit: 1_000, credit: 0 }],
      "Draft"
    );
    try {
      const c = await check(induk, "no_draft_journal");
      assert.equal(c.ok, false);
      assert.match(c.detail, /Draft/);
    } finally {
      await prisma.accJournalLine.deleteMany({ where: { journal_id: draft } });
      await prisma.accJournal.delete({ where: { id: draft } });
    }
  });

  test("a draft from another year does not block", async () => {
    // The range is read against `created_at`, which is the only thing a draft
    // carries — a draft typed in 1985 was never meant for 1990.
    const draft = await postFixtureJournal(
      induk,
      new Date(Date.UTC(FY - 5, 7, 1)),
      [{ accountId: indukChart.expense, debit: 1_000, credit: 0 }],
      "Draft"
    );
    try {
      assert.equal((await check(induk, "no_draft_journal")).ok, true);
    } finally {
      await prisma.accJournalLine.deleteMany({ where: { journal_id: draft } });
      await prisma.accJournal.delete({ where: { id: draft } });
    }
  });

  test("books that do not add up", async () => {
    const broken = await postFixtureJournal(induk, new Date(Date.UTC(FY, 8, 1)), [
      { accountId: indukChart.expense, debit: 500, credit: 0 },
      { accountId: indukChart.cash, debit: 0, credit: 400 },
    ]);
    try {
      const c = await check(induk, "balanced");
      assert.equal(c.ok, false);
      assert.match(c.detail, /tidak seimbang|tidak sama/);
    } finally {
      await prisma.accJournalLine.deleteMany({ where: { journal_id: broken } });
      await prisma.accJournal.delete({ where: { id: broken } });
    }
  });

  test("a blocked plan offers no preview at all", async () => {
    await setSetting("induk_accumulated_pl_account", null);
    try {
      const p = await plan(induk);
      assert.equal(p!.ready, false);
      assert.equal(p!.preview, null, "nothing to approve while something blocks it");
    } finally {
      await setSetting("induk_accumulated_pl_account", String(indukChart.accumulated));
    }
  });

  test("a refused close writes nothing", async () => {
    await setSetting("induk_accumulated_pl_account", null);
    const before = await counts(induk);
    try {
      const result = await executeClosing(induk, fiscalYear, actor);
      assert.equal(result.ok, false);
      assert.match((result as { error: string }).error, /Laba\/Rugi Tahun Sebelumnya/);
      assert.deepEqual(await counts(induk), before);
    } finally {
      await setSetting("induk_accumulated_pl_account", String(indukChart.accumulated));
    }
  });
});

async function counts(companyId: number) {
  return {
    journals: await prisma.accJournal.count({
      where: { company_id: companyId, journal_no: { startsWith: "CLS-" } },
    }),
    openings: await prisma.accOpeningBalance.count({
      where: { company_id: companyId, fiscal_year_id: nextYear },
    }),
    closings: await prisma.accFiscalClosing.count({
      where: { company_id: companyId, fiscal_year_id: fiscalYear },
    }),
  };
}

// ------------------------------------------------------------- the close

describe("closing writes the journal, the snapshot and the record", () => {
  let journalNo = "";
  let openingNo = "";

  /**
   * `unclosedPriorYear` answers only while a newer year also stands Open, so
   * 1991 is opened for the assertion and put back to Draft after it. 1990 is
   * the oldest year in any database this runs against, so it is the one found.
   */
  const withNextYearOpen = async (fn: () => Promise<void>) => {
    await prisma.accFiscalYear.update({ where: { id: nextYear }, data: { status: "Open" } });
    try {
      await fn();
    } finally {
      await prisma.accFiscalYear.update({ where: { id: nextYear }, data: { status: "Draft" } });
    }
  };

  test("before any close, both Companies carry the older year into the newer", async () => {
    await withNextYearOpen(async () => {
      assert.equal((await unclosedPriorYear(induk))?.id, fiscalYear);
      assert.equal((await unclosedPriorYear(anak))?.id, fiscalYear);
    });
  });

  test("the induk closes, and the year does not", async () => {
    const result = await executeClosing(induk, fiscalYear, actor);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    assert.ok(result.journalNo);
    assert.ok(result.openingNo);
    journalNo = result.journalNo!;
    openingNo = result.openingNo!;
    assert.match(journalNo, /^CLS-\d{4}$/);
    assert.match(openingNo, /^OPB-\d{4}$/);

    // The rollup: one Company of two is finished, so the year is still Open
    // and the anak goes on posting into it. That is the whole reason closing
    // is per Company.
    assert.equal(result.yearClosed, false);
    const year = await prisma.accFiscalYear.findUniqueOrThrow({
      where: { id: fiscalYear },
      select: { status: true },
    });
    assert.equal(year.status, "Open");
  });

  test("the Company that closed stops carrying the year, the other still does", async () => {
    // Per Company, like the close itself: the induk's Neraca of 1991 no longer
    // has an unclosed year to state, while the anak's still does.
    await withNextYearOpen(async () => {
      assert.equal(await unclosedPriorYear(induk), null);
      assert.equal((await unclosedPriorYear(anak))?.id, fiscalYear);
    });
  });

  test("the closing journal is dated the year's last day", async () => {
    const journal = await prisma.accJournal.findFirstOrThrow({
      where: { journal_no: journalNo },
      select: { posting_date: true, status: true, source_doc_id: true },
    });
    assert.equal(
      journal.posting_date?.toISOString(),
      new Date(Date.UTC(FY, 11, 31)).toISOString(),
      "a closing entry belongs to the year it closes, not to the day it was run"
    );
    assert.equal(journal.status, "Posted");
    assert.equal(journal.source_doc_id, fiscalYear);
  });

  test("every ProfitLoss balance is now exactly zero", async () => {
    const pairs = await closingBalances(induk, `${FY}-12-31`);
    assert.deepEqual(
      pairs.filter((p) => p.section === "ProfitLoss"),
      [],
      "a pair that nets to nil is dropped, so nothing on the P&L should remain"
    );
  });

  test("the result is on the equity account, and nowhere else", async () => {
    const ledger = await generalLedgerReport(
      [indukChart.accumulated, indukChart.current],
      { from: `${FY}-01-01`, to: `${FY}-12-31` },
      [induk]
    );
    const accumulated = ledger.accounts.find((a) => a.id === indukChart.accumulated)!;
    // Kredit-natured, so a profit raises it.
    assert.equal(accumulated.closing, 600_000);

    const current = ledger.accounts.find((a) => a.id === indukChart.current);
    assert.equal(
      current?.entries.length ?? 0,
      0,
      "Laba/Rugi Tahun Berjalan is computed, never posted"
    );
  });

  test("the snapshot balances", async () => {
    const opening = await prisma.accOpeningBalance.findFirstOrThrow({
      where: { opening_no: openingNo },
      select: { id: true, fiscal_year_id: true, source_fiscal_year_id: true },
    });
    assert.equal(opening.fiscal_year_id, nextYear, "written for the year it opens");
    assert.equal(
      opening.source_fiscal_year_id,
      fiscalYear,
      "and it names the close that produced it — a null source is a go-live snapshot"
    );

    const detail = await getOpeningBalance(opening.id, [induk]);
    assert.equal(
      Math.round(detail!.debit * 100),
      Math.round(detail!.credit * 100),
      "once the P&L is out, what remains is a balance sheet"
    );
  });

  test("the snapshot reconciles to the General Ledger at both grains", async () => {
    const opening = await prisma.accOpeningBalance.findFirstOrThrow({
      where: { opening_no: openingNo },
      select: { id: true },
    });
    const detail = (await getOpeningBalance(opening.id, [induk]))!;
    const pairs = await closingBalances(induk, `${FY}-12-31`);

    // Pair grain: one line per (account, partner?), at that pair's own figure.
    assert.equal(detail.lines.length, pairs.length);
    for (const pair of pairs) {
      const line = detail.lines.find(
        (l) => l.accountId === pair.accountId && l.partnerId === pair.partnerId
      );
      assert.ok(line, `${pair.accountLabel} is missing from the snapshot`);
      assert.equal(line.debit - line.credit, pair.net);
    }

    // Account grain: the lines for one account roll up to what the General
    // Ledger prints as that account's closing balance.
    const accountIds = [...new Set(pairs.map((p) => p.accountId))];
    const ledger = await generalLedgerReport(
      accountIds,
      { from: `${FY}-01-01`, to: `${FY}-12-31` },
      [induk]
    );
    for (const account of ledger.accounts) {
      const rolled = detail.lines
        .filter((l) => l.accountId === account.id)
        .reduce(
          (t, l) =>
            t +
            (account.normalBalance === "Kredit"
              ? l.credit - l.debit
              : l.debit - l.credit),
          0
        );
      assert.equal(
        Math.round(rolled * 100),
        Math.round(account.closing * 100),
        `${account.label} disagrees with its own General Ledger`
      );
    }
  });

  test("the closing record names what it produced", async () => {
    const row = await prisma.accFiscalClosing.findUniqueOrThrow({
      where: {
        fiscal_year_id_company_id: {
          fiscal_year_id: fiscalYear,
          company_id: induk,
        },
      },
      select: {
        status: true,
        closed_by: true,
        closing_journal_id: true,
        opening_balance_id: true,
      },
    });
    assert.equal(row.status, "Closed");
    assert.equal(row.closed_by, actor);
    assert.ok(row.closing_journal_id);
    assert.ok(row.opening_balance_id);
  });

  test("a second close is refused", async () => {
    const before = await counts(induk);
    const result = await executeClosing(induk, fiscalYear, actor);
    assert.equal(result.ok, false);
    assert.match((result as { error: string }).error, /[Ss]udah ditutup/);
    assert.deepEqual(await counts(induk), before, "and it wrote nothing");
  });

  test("the other Company is untouched, and still closable", async () => {
    const p = await plan(anak);
    assert.equal(p!.closed, null);
    assert.equal(
      p!.ready,
      true,
      "the induk finishing its books says nothing about the anak's"
    );
  });

  test("the year rolls to Closed only on the second Company's close", async () => {
    const result = await executeClosing(anak, fiscalYear, actor);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    assert.equal(result.yearClosed, true);
    const year = await prisma.accFiscalYear.findUniqueOrThrow({
      where: { id: fiscalYear },
      select: { status: true },
    });
    assert.equal(
      year.status,
      "Closed",
      "the year's own status is a rollup over every Company's closing row"
    );
  });

  test("a closed year is reported back, with what it produced", async () => {
    const p = await plan(induk);
    assert.ok(p!.closed);
    assert.ok(p!.closed.closingJournalId);
    assert.ok(p!.closed.openingBalanceId);
  });
});
