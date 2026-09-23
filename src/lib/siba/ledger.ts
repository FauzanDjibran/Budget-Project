import "server-only";

import { prisma } from "@/lib/prisma";
import type { AccountSection, Prisma } from "@/generated/prisma/client";
import { compareCodes } from "./account-code";
import { isBaseCurrency } from "./currency";
import { roundBase } from "./fx";
import { openingBasisFor } from "./opening-balance";
import type { PeriodRange } from "./period";

/**
 * The General Ledger and the Trial Balance.
 *
 * Both derive from journal lines, and they are the **only** things that do —
 * the operational books are independent stores written alongside the journal
 * (concept doc §2.5, §2.6). The subject is the account: a General Ledger is an
 * account's movement over a period, and a Trial Balance is every account's
 * opening, movement and closing side by side.
 *
 * **Signed by normal balance.** An account's balance moves the way its normal
 * balance does: a Debit account rises on the debit side, a Kredit account on
 * the credit side. Reporting a raw debit-minus-credit for a liability would
 * print every payable as a negative number, which is not how a ledger reads.
 *
 * **Measured in base currency, on one scale.** Concept doc §11.2 and §16 say
 * the General Ledger uses the base currency, and it now does: every journal
 * line stores what it was worth in rupiah, so both reports read one column and
 * produce one set of figures.
 *
 * This replaces the per-currency grouping these reports carried while there was
 * no rate anywhere in the system. That was a deliberate deviation, recorded as
 * such, and it could not survive multi-currency for a plainer reason than
 * fidelity to the concept doc: **a journal may now hold two currencies**, so
 * there is no longer any transaction-currency total to group by. A USD line and
 * an IDR line in one entry have no common measure until both are valued.
 *
 * The transaction-currency face is not lost — it travels on each entry, so a
 * reader can see that a rupiah figure came from three hundred dollars. It is
 * simply not what anything is totalled in.
 */

export type Balance = "Debit" | "Kredit";

/** Either the client or a transaction — see `closingBalances`. */
type Client = typeof prisma | Prisma.TransactionClient;

/**
 * Only a **Posted** journal is accounting.
 *
 * A manual journal is typed by a person and is saved `Draft` first, so
 * `acc_journal` now holds rows that are not yet anybody's books. Every query in
 * this file carries this filter: a draft that reached the General Ledger would
 * be a figure nobody posted, and a draft reaching the Trial Balance would read
 * as an imbalance — which is the one thing that report exists to make
 * meaningful. `Cancelled` is excluded by the same filter, for the same reason.
 */
const POSTED = { status: "Posted" } as const;

/**
 * A Posted journal always carries its posting date — that is what Posted means.
 * The column is nullable only so a manual journal can exist before it has been
 * written, and every read here filters those out, so this states the invariant
 * rather than papering over it.
 */
function postedOn(date: Date | null): Date {
  if (!date) {
    throw new Error("Journal berstatus Posted tanpa tanggal posting.");
  }
  return date;
}

/** Which way this account's balance moves, given the two sides. */
export function signedMovement(
  normalBalance: string,
  debit: number,
  credit: number
): number {
  return normalBalance === "Kredit" ? credit - debit : debit - credit;
}

/**
 * Where a Company's accounts stood immediately before a date, and how that was
 * worked out.
 *
 * Both ledger reports need the same figure and used to get it the same way: by
 * summing **every** journal line ever posted before the range began. That is
 * correct and it does not stop being correct, but it grows without bound, and
 * it is exactly the read an Opening Balance exists to remove — a close writes
 * down where the accounts stood, so a report for March 2028 needs that figure
 * plus two months, not four years line by line.
 *
 * The snapshot is a starting point, never an answer on its own: lines dated on
 * or after it are still scanned and added. Where no snapshot covers the date,
 * the scan runs over the whole history exactly as it always did, so a database
 * that has never closed a year produces the figures it produced before any of
 * this existed.
 */
type OpeningBasis = {
  /** `debit − credit` per account, strictly before `from`. Unsigned. */
  net: Map<number, number>;
  /** The snapshot it stood on, where there was one. */
  snapshot: { openingNo: string; postingDate: Date } | null;
  /**
   * Transaction currencies seen in whatever was actually scanned.
   *
   * Only what was scanned, which is the one thing a snapshot genuinely costs:
   * a snapshot is base currency, so an account funded in dollars *before* it
   * no longer reads as foreign-sourced from the opening alone. The per-entry
   * columns inside the period are unaffected.
   */
  currencies: Map<number, Set<string>>;
};

async function openingBasis(
  companyId: number,
  from: Date,
  /** The accounts asked about, or null for "every account this Company has". */
  accountIds: number[] | null
): Promise<OpeningBasis> {
  const snapshot = await openingBasisFor(companyId, from);

  const lines = await prisma.accJournalLine.findMany({
    where: {
      ...(accountIds ? { account_id: { in: accountIds } } : {}),
      journal: {
        ...POSTED,
        company_id: companyId,
        // A snapshot holds everything **before** its own date, so only what
        // came after it is still outstanding. Without one, the whole history is.
        posting_date: snapshot
          ? { gte: snapshot.postingDate, lt: from }
          : { lt: from },
      },
    },
    select: {
      account_id: true,
      debit_amount: true,
      kredit_amount: true,
      currency: { select: { currency_label: true } },
    },
  });

  const net = new Map<number, number>();
  const currencies = new Map<number, Set<string>>();

  if (snapshot) {
    const wanted = accountIds ? new Set(accountIds) : null;
    for (const [accountId, value] of snapshot.byAccount) {
      if (wanted && !wanted.has(accountId)) continue;
      net.set(accountId, value);
    }
  }

  for (const l of lines) {
    net.set(
      l.account_id,
      (net.get(l.account_id) ?? 0) +
        l.debit_amount.toNumber() -
        l.kredit_amount.toNumber()
    );
    const label = l.currency.currency_label;
    if (!isBaseCurrency(label)) {
      const seen = currencies.get(l.account_id) ?? new Set<string>();
      seen.add(label);
      currencies.set(l.account_id, seen);
    }
  }

  return {
    net,
    snapshot: snapshot
      ? { openingNo: snapshot.openingNo, postingDate: snapshot.postingDate }
      : null,
    currencies,
  };
}

/**
 * The raw `debit − credit` net, read in the account's own direction.
 *
 * Zero is returned as positive zero deliberately. Negating `0` in JavaScript
 * gives `-0`, which compares equal to `0` under `===` and then renders as
 * "Rp -0" through `Intl.NumberFormat` — a figure that is not wrong so much as
 * unreadable, on the one line of a ledger a reader most expects to be blank.
 * `signedMovement` never produced it, because it subtracts rather than negates.
 */
function signedNet(normalBalance: string, net: number): number {
  if (net === 0) return 0;
  return normalBalance === "Kredit" ? -net : net;
}

/**
 * One basis per Company, since a snapshot belongs to one.
 *
 * Every Report View runs for a single Company, so this is one entry in
 * practice — but the readers take a scope array, and an account belongs to
 * exactly one Company's chart, so the honest thing is to ask each Company's
 * own snapshot rather than assume there is only ever one.
 */
async function basesByCompany(
  accountsByCompany: Map<number, number[] | null>,
  from: Date
): Promise<Map<number, OpeningBasis>> {
  const out = new Map<number, OpeningBasis>();
  for (const [companyId, ids] of accountsByCompany) {
    out.set(companyId, await openingBasis(companyId, from, ids));
  }
  return out;
}

/** The snapshot a report stood on, for the report to say so. */
export type OpeningProvenance = {
  openingNo: string;
  /** `YYYY-MM-DD`. */
  date: string;
};

function provenanceOf(bases: Map<number, OpeningBasis>): OpeningProvenance | null {
  for (const basis of bases.values()) {
    if (basis.snapshot) {
      return {
        openingNo: basis.snapshot.openingNo,
        date: basis.snapshot.postingDate.toISOString().slice(0, 10),
      };
    }
  }
  return null;
}

export type LedgerEntry = {
  journalId: number;
  journalNo: string;
  date: string;
  description: string;
  partnerLabel: string | null;
  /** Base currency, like every figure in these two reports. */
  debit: number;
  credit: number;
  /** Running balance after this entry, in the account's normal direction. */
  balance: number;
  /**
   * What the entry was in its own currency, where that is not the base one.
   *
   * Null for an ordinary rupiah line, which would only be stating its own
   * figure twice. A ledger row is read across, and a column that repeats the
   * one beside it costs width without earning it (§12, report convention).
   */
  trxAmount: number | null;
  trxCurrencyLabel: string | null;
  rate: number | null;
};

export type LedgerAccount = {
  id: number;
  label: string;
  name: string;
  companyLabel: string;
  normalBalance: string;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
  /**
   * Which transaction currencies this account's entries were denominated in,
   * where any of them was not the base currency.
   *
   * The account's own figures are base and always were; this says whether any
   * of what produced them started out as something else, so a reader knows to
   * look at the per-entry columns.
   */
  foreignCurrencies: string[];
  entries: LedgerEntry[];
};

export type GeneralLedgerReport = {
  range: PeriodRange;
  accounts: LedgerAccount[];
  /**
   * The Opening Balance the openings were computed from, where there was one.
   *
   * The figures are identical either way — that is the property this rests on
   * — so this is provenance rather than a caveat. A reader checking a saldo
   * awal is entitled to know it came from a snapshot somebody can open, and
   * not from a sum over years of entries nobody can see on the page.
   */
  openingFrom: OpeningProvenance | null;
};

/**
 * One ledger per account, in chart order.
 *
 * Several accounts at once on purpose: reading a ledger usually means
 * comparing one account against its counterpart, and making that two page
 * loads is what makes a ledger tedious to check. Each account keeps its own
 * table, its own opening and its own closing — nothing is pooled, because
 * accounts of different natures do not add up to anything.
 *
 * `opening` is everything strictly before `from`, folded into a figure rather
 * than listed, and the range is inclusive at both ends — the same arithmetic
 * the Cash Bank reports use (§10 rule 41). Where a close has written one, that
 * figure starts from the Opening Balance snapshot instead of from the first
 * transaction in the Company's history; see `openingBasis`.
 */
export async function generalLedgerReport(
  accountIds: number[],
  range: PeriodRange,
  companyIds: number[]
): Promise<GeneralLedgerReport> {
  if (!accountIds.length) return { range, accounts: [], openingFrom: null };

  const accounts = await prisma.accAccount.findMany({
    where: { id: { in: accountIds }, company_id: { in: companyIds } },
    select: {
      id: true,
      account_label: true,
      account_name: true,
      normal_balance: true,
      company_id: true,
      company: { select: { company_label: true } },
    },
  });
  if (!accounts.length) return { range, accounts: [], openingFrom: null };

  const ids = accounts.map((a) => a.id);
  const from = new Date(`${range.from}T00:00:00Z`);
  const to = new Date(`${range.to}T00:00:00Z`);

  // Grouped by Company because a snapshot belongs to one, and an account
  // belongs to exactly one Company's chart.
  const byCompany = new Map<number, number[]>();
  for (const a of accounts) {
    byCompany.set(a.company_id, [...(byCompany.get(a.company_id) ?? []), a.id]);
  }

  const [bases, within] = await Promise.all([
    basesByCompany(byCompany, from),
    prisma.accJournalLine.findMany({
      where: {
        account_id: { in: ids },
        journal: { ...POSTED, posting_date: { gte: from, lte: to } },
      },
      orderBy: [{ journal: { posting_date: "asc" } }, { journal_id: "asc" }, { sequence_no: "asc" }],
      include: {
        journal: { select: { id: true, journal_no: true, posting_date: true } },
        partner: { select: { partner_label: true } },
        currency: { select: { currency_label: true } },
      },
    }),
  ]);

  const out: LedgerAccount[] = accounts.map((a) => {
    const basis = bases.get(a.company_id)!;
    const opening = signedNet(a.normal_balance, basis.net.get(a.id) ?? 0);

    let running = opening;
    let debit = 0;
    let credit = 0;
    const entries: LedgerEntry[] = [];
    const foreign = new Set<string>();

    for (const l of within.filter((x) => x.account_id === a.id)) {
      const d = l.debit_amount.toNumber();
      const c = l.kredit_amount.toNumber();
      debit += d;
      credit += c;
      running += signedMovement(a.normal_balance, d, c);

      const label = l.currency.currency_label;
      const isForeign = !isBaseCurrency(label);
      if (isForeign) foreign.add(label);

      entries.push({
        journalId: l.journal.id,
        journalNo: l.journal.journal_no,
        date: postedOn(l.journal.posting_date).toISOString(),
        description: l.description,
        partnerLabel: l.partner?.partner_label ?? null,
        debit: d,
        credit: c,
        balance: running,
        trxAmount: isForeign ? l.trx_amount.toNumber() : null,
        trxCurrencyLabel: isForeign ? label : null,
        rate: isForeign ? l.exchange_rate.toNumber() : null,
      });
    }

    // Whatever produced the opening counts too — an account funded entirely in
    // dollars last year still reads as foreign-sourced this year. What a
    // snapshot folded away is the one thing this cannot see: a snapshot is
    // base currency, so only the lines still scanned can say they were not.
    for (const label of basis.currencies.get(a.id) ?? []) foreign.add(label);

    return {
      id: a.id,
      label: a.account_label,
      name: a.account_name,
      companyLabel: a.company.company_label,
      normalBalance: a.normal_balance,
      opening,
      debit,
      credit,
      closing: running,
      foreignCurrencies: [...foreign].sort(),
      entries,
    };
  });

  out.sort((a, b) => compareCodes(a.label, b.label));
  return { range, accounts: out, openingFrom: provenanceOf(bases) };
}

export type TrialBalanceRow = {
  id: number;
  label: string;
  name: string;
  normalBalance: string;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
};

export type TrialBalanceReport = {
  range: PeriodRange;
  rows: TrialBalanceRow[];
  /** The two sides of the period's movement, which must agree. */
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  /** Journals whose own sides disagree — always empty unless something is wrong. */
  unbalanced: { id: number; journalNo: string; debit: number; credit: number }[];
  /** The Opening Balance the saldo awal column was computed from, if any. */
  openingFrom: OpeningProvenance | null;
};

/**
 * Every account that has moved, or has an opening balance, on one base-currency
 * scale.
 *
 * The check a trial balance exists for is that total debits equal total
 * credits. Here that is a consequence rather than a hope: every journal is
 * refused unless it balances, so the totals can only disagree if something
 * wrote the tables without going through `postJournal`. The report says which
 * it is instead of printing a number nobody can act on.
 *
 * **One table, not one per currency.** The grouping existed because there was
 * no rate to combine with; now every line carries what it was worth, and a
 * single journal can hold two currencies at once — so grouping by transaction
 * currency would split one balanced entry across two tables and make neither of
 * them balance. The trial balance is a base-currency statement or it is nothing.
 *
 * Accounts with neither an opening balance nor a movement are left out — a
 * trial balance lists the accounts that have something to say. An account that
 * carries an opening and did not move **is** one of those, which is why the
 * rows are seeded from the opening as well as from the period's lines: the
 * opening no longer arrives as a by-product of scanning every historical entry.
 */
export async function trialBalanceReport(
  range: PeriodRange,
  companyIds: number[]
): Promise<TrialBalanceReport> {
  const from = new Date(`${range.from}T00:00:00Z`);
  const to = new Date(`${range.to}T00:00:00Z`);

  // Every account of every Company in scope, because a Trial Balance's subject
  // is "whatever has something to say" rather than a list somebody picked.
  const scope = new Map<number, number[] | null>();
  for (const id of companyIds) scope.set(id, null);

  const [bases, lines] = await Promise.all([
    basesByCompany(scope, from),
    prisma.accJournalLine.findMany({
      where: {
        journal: {
          ...POSTED,
          company_id: { in: companyIds },
          posting_date: { gte: from, lte: to },
        },
      },
      select: {
        account_id: true,
        debit_amount: true,
        kredit_amount: true,
      },
    }),
  ]);

  // The two sources name their accounts by id alone, so the labels come in one
  // query rather than riding along on every line.
  const accountIds = new Set<number>(lines.map((l) => l.account_id));
  for (const basis of bases.values()) {
    for (const id of basis.net.keys()) accountIds.add(id);
  }

  const meta = await prisma.accAccount.findMany({
    where: { id: { in: [...accountIds] } },
    select: {
      id: true,
      account_label: true,
      account_name: true,
      normal_balance: true,
      company_id: true,
    },
  });

  const rows = new Map<number, TrialBalanceRow>();
  for (const a of meta) {
    const basis = bases.get(a.company_id);
    const opening = signedNet(a.normal_balance, basis?.net.get(a.id) ?? 0);
    rows.set(a.id, {
      id: a.id,
      label: a.account_label,
      name: a.account_name,
      normalBalance: a.normal_balance,
      opening,
      debit: 0,
      credit: 0,
      closing: opening,
    });
  }

  for (const l of lines) {
    const row = rows.get(l.account_id);
    if (!row) continue;
    const d = l.debit_amount.toNumber();
    const c = l.kredit_amount.toNumber();
    row.debit += d;
    row.credit += c;
    row.closing += signedMovement(row.normalBalance, d, c);
  }

  // An account that neither moved nor carries an opening has nothing to say —
  // it can only get here through a snapshot line that nets to zero, which
  // `closingBalances` already drops, or through a Company outside the scope.
  const list = [...rows.values()]
    .filter(
      (r) =>
        Math.round(r.opening * 100) !== 0 ||
        Math.round(r.debit * 100) !== 0 ||
        Math.round(r.credit * 100) !== 0
    )
    .sort((a, b) => compareCodes(a.label, b.label));
  const totalDebit = roundBase(list.reduce((t, r) => t + r.debit, 0));
  const totalCredit = roundBase(list.reduce((t, r) => t + r.credit, 0));

  const { unbalancedJournals } = await import("./journal");

  return {
    range,
    rows: list,
    totalDebit,
    totalCredit,
    balanced: Math.round(totalDebit * 100) === Math.round(totalCredit * 100),
    unbalanced: await unbalancedJournals(companyIds),
    openingFrom: provenanceOf(bases),
  };
}

/**
 * Accounts a ledger report may be run for, in chart order.
 *
 * One Company's, because each numbers its own chart independently: the induk's
 * `1.1.1.1` and the anak's are different accounts sharing a number, and a
 * picker offering both would read as duplicates (CLAUDE.md §12).
 */
export async function ledgerAccountOptions(companyId: number) {
  const rows = await prisma.accAccount.findMany({
    where: { company_id: companyId },
    select: {
      id: true,
      account_label: true,
      account_name: true,
      is_active: true,
    },
  });
  return rows
    .sort((a, b) => compareCodes(a.account_label, b.account_label))
    .map((a) => ({
      id: a.id,
      label: a.account_label,
      name: a.account_name + (a.is_active ? "" : " · non-aktif"),
      // A ledger must be runnable for an account that is no longer active:
      // last quarter's figures are exactly when one matters.
      active: true,
    }));
}

// -------------------------------------------------------- account positions

/**
 * Where a handful of named accounts stand right now, in base currency.
 *
 * All of history, no period: this answers "what is the balance today", which
 * is a different question from the General Ledger's "what happened between
 * these dates". It exists for the intercompany bridge, whose two sides are a
 * standing position rather than a period's movement — and which is otherwise
 * readable only by someone who thinks to run the General Ledger for exactly
 * the right account (CLAUDE.md §17).
 *
 * Signed by normal balance like every other figure here. One figure rather
 * than a per-currency list: the bridge's two sides are meant to be compared
 * against each other, and two lists of currencies do not compare — one rupiah
 * figure each does.
 */
export type AccountPosition = {
  id: number;
  label: string;
  name: string;
  companyId: number;
  companyLabel: string;
  normalBalance: string;
  /** Base currency, signed in the account's normal direction. */
  balance: number;
};

export async function accountPositions(
  accountIds: number[]
): Promise<AccountPosition[]> {
  if (!accountIds.length) return [];

  const [accounts, lines] = await Promise.all([
    prisma.accAccount.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true,
        account_label: true,
        account_name: true,
        normal_balance: true,
        company_id: true,
        company: { select: { company_label: true } },
      },
    }),
    prisma.accJournalLine.findMany({
      where: { account_id: { in: accountIds }, journal: POSTED },
      select: {
        account_id: true,
        debit_amount: true,
        kredit_amount: true,
      },
    }),
  ]);

  return accounts.map((a) => ({
    id: a.id,
    label: a.account_label,
    name: a.account_name,
    companyId: a.company_id,
    companyLabel: a.company.company_label,
    normalBalance: a.normal_balance,
    balance: roundBase(
      lines
        .filter((l) => l.account_id === a.id)
        .reduce(
          (t, l) =>
            t +
            signedMovement(
              a.normal_balance,
              l.debit_amount.toNumber(),
              l.kredit_amount.toNumber()
            ),
          0
        )
    ),
  }));
}

// -------------------------------------------------------- closing balances

/**
 * One account's balance against one Partner, at a moment.
 *
 * Both measures of it. `net` is the raw `debit − credit`, which is what a
 * snapshot line stores — positive goes on the debit side, negative on the
 * credit side. `balance` is the same figure signed in the account's own normal
 * direction, which is what a ledger prints. Keeping both is what lets a caller
 * write a snapshot and a reader check it against the General Ledger without
 * either of them re-deriving the other's convention.
 */
export type ClosingBalance = {
  accountId: number;
  accountLabel: string;
  accountName: string;
  normalBalance: string;
  /**
   * Which statement the account is on, read from its type rather than from the
   * first segment of its number.
   *
   * Closing needs it: a ProfitLoss balance is moved into equity and a
   * BalanceSheet balance is carried forward, and those are opposite fates. The
   * convention that `4` and `5` are Laba Rugi happens to hold, and a
   * convention that merely happens to hold is one a maintainer can break with
   * nothing failing — so the column is asked instead (phase plan §3.3).
   */
  section: AccountSection;
  partnerId: number | null;
  partnerLabel: string | null;
  /** Raw sums over every posted line up to and including `asOf`, base currency. */
  debit: number;
  credit: number;
  /** `debit − credit`. Positive sits on the debit side. */
  net: number;
  /** Signed in the account's normal direction — the figure a ledger prints. */
  balance: number;
};

/**
 * Where one Company's accounts stood at the end of a day, at `(account,
 * partner?)` grain.
 *
 * This is the grain `acc_journal_line` itself keeps, and taking it straight
 * from the posted lines is the point: an account's Partner split is whatever
 * was actually posted against it, not whatever `require_partner` currently
 * says. Reading the flag instead would drop a partner-bearing balance sitting
 * on an unflagged account, and would invent a null-partner line for an account
 * that has none.
 *
 * It lives here because `acc_journal_line` is the Journal's table and the
 * General Ledger is the one thing allowed to derive from it (CLAUDE.md §10
 * rule 22). A module that needed these figures and read the table itself would
 * be crossing a boundary to ask a question this file already answers.
 *
 * Inclusive of `asOf`, like every other date range in the application, and
 * **Posted only** — a draft is not accounting and a snapshot of one would be a
 * figure nobody posted.
 *
 * Pairs whose two sides cancel exactly are left out. A Partner who was invoiced
 * and has paid in full holds no position, and a snapshot line stating zero is
 * a row that says nothing.
 */
export async function closingBalances(
  companyId: number,
  asOf: Date | string,
  /**
   * Read inside a transaction where the caller needs to see its own writes —
   * a close takes this twice, once to work out what to move and once, after
   * the closing journal is in, to snapshot what is left.
   */
  db: Client = prisma
): Promise<ClosingBalance[]> {
  const to =
    asOf instanceof Date
      ? new Date(`${asOf.toISOString().slice(0, 10)}T00:00:00Z`)
      : new Date(`${asOf.slice(0, 10)}T00:00:00Z`);

  const lines = await db.accJournalLine.findMany({
    where: {
      journal: { ...POSTED, company_id: companyId, posting_date: { lte: to } },
    },
    select: {
      account_id: true,
      partner_id: true,
      debit_amount: true,
      kredit_amount: true,
      account: {
        select: { account_label: true, account_name: true, normal_balance: true },
      },
      partner: { select: { partner_label: true } },
    },
  });

  // The section is asked for once per account rather than joined onto every
  // line: it is three levels up the chart (subcategory -> category -> type),
  // and a ledger of a thousand lines would otherwise carry the same three
  // joins a thousand times.
  const sections = new Map<number, AccountSection>();
  const accountIds = [...new Set(lines.map((l) => l.account_id))];
  if (accountIds.length) {
    const rows = await db.accAccount.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true,
        account_subcategory: {
          select: {
            account_category: {
              select: { account_type: { select: { section: true } } },
            },
          },
        },
      },
    });
    for (const r of rows) {
      sections.set(
        r.id,
        r.account_subcategory.account_category.account_type.section
      );
    }
  }

  const pairs = new Map<string, ClosingBalance>();

  for (const l of lines) {
    // The null partner is a key of its own, not an absent one: an account with
    // a mix of partner-bearing and partner-less postings holds both, and they
    // are different balances.
    const key = `${l.account_id}:${l.partner_id ?? "-"}`;
    let row = pairs.get(key);
    if (!row) {
      row = {
        accountId: l.account_id,
        accountLabel: l.account.account_label,
        accountName: l.account.account_name,
        normalBalance: l.account.normal_balance,
        section: sections.get(l.account_id)!,
        partnerId: l.partner_id,
        partnerLabel: l.partner?.partner_label ?? null,
        debit: 0,
        credit: 0,
        net: 0,
        balance: 0,
      };
      pairs.set(key, row);
    }
    row.debit += l.debit_amount.toNumber();
    row.credit += l.kredit_amount.toNumber();
  }

  const out: ClosingBalance[] = [];
  for (const row of pairs.values()) {
    row.debit = roundBase(row.debit);
    row.credit = roundBase(row.credit);
    row.net = roundBase(row.debit - row.credit);
    row.balance = roundBase(signedMovement(row.normalBalance, row.debit, row.credit));
    if (Math.round(row.net * 100) !== 0) out.push(row);
  }

  return out.sort(
    (a, b) =>
      compareCodes(a.accountLabel, b.accountLabel) ||
      (a.partnerLabel ?? "").localeCompare(b.partnerLabel ?? "")
  );
}
