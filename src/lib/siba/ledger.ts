import "server-only";

import { prisma } from "@/lib/prisma";
import { compareCodes } from "./account-code";
import { isBaseCurrency } from "./currency";
import { roundBase } from "./fx";
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
 * `opening` is every entry strictly before `from`, folded into a figure rather
 * than listed, and the range is inclusive at both ends — the same arithmetic
 * the Cash Bank reports use (§10 rule 41).
 */
export async function generalLedgerReport(
  accountIds: number[],
  range: PeriodRange,
  companyIds: number[]
): Promise<GeneralLedgerReport> {
  if (!accountIds.length) return { range, accounts: [] };

  const accounts = await prisma.accAccount.findMany({
    where: { id: { in: accountIds }, company_id: { in: companyIds } },
    select: {
      id: true,
      account_label: true,
      account_name: true,
      normal_balance: true,
      company: { select: { company_label: true } },
    },
  });
  if (!accounts.length) return { range, accounts: [] };

  const ids = accounts.map((a) => a.id);
  const from = new Date(`${range.from}T00:00:00Z`);
  const to = new Date(`${range.to}T00:00:00Z`);

  const [before, within] = await Promise.all([
    prisma.accJournalLine.findMany({
      where: {
        account_id: { in: ids },
        journal: { ...POSTED, posting_date: { lt: from } },
      },
      select: {
        account_id: true,
        debit_amount: true,
        kredit_amount: true,
        currency: { select: { currency_label: true } },
      },
    }),
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
    const openingLines = before.filter((l) => l.account_id === a.id);
    const opening = openingLines.reduce(
      (t, l) =>
        t +
        signedMovement(a.normal_balance, l.debit_amount.toNumber(), l.kredit_amount.toNumber()),
      0
    );

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
    // dollars last year still reads as foreign-sourced this year.
    for (const l of openingLines) {
      if (!isBaseCurrency(l.currency.currency_label)) {
        foreign.add(l.currency.currency_label);
      }
    }

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
  return { range, accounts: out };
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
 * trial balance lists the accounts that have something to say.
 */
export async function trialBalanceReport(
  range: PeriodRange,
  companyIds: number[]
): Promise<TrialBalanceReport> {
  const from = new Date(`${range.from}T00:00:00Z`);
  const to = new Date(`${range.to}T00:00:00Z`);

  const lines = await prisma.accJournalLine.findMany({
    where: {
      journal: {
        ...POSTED,
        company_id: { in: companyIds },
        posting_date: { lte: to },
      },
    },
    select: {
      account_id: true,
      debit_amount: true,
      kredit_amount: true,
      journal: { select: { posting_date: true } },
      account: {
        select: { account_label: true, account_name: true, normal_balance: true },
      },
    },
  });

  const rows = new Map<number, TrialBalanceRow>();

  for (const l of lines) {
    let row = rows.get(l.account_id);
    if (!row) {
      row = {
        id: l.account_id,
        label: l.account.account_label,
        name: l.account.account_name,
        normalBalance: l.account.normal_balance,
        opening: 0,
        debit: 0,
        credit: 0,
        closing: 0,
      };
      rows.set(l.account_id, row);
    }

    const d = l.debit_amount.toNumber();
    const c = l.kredit_amount.toNumber();
    const signed = signedMovement(l.account.normal_balance, d, c);

    if (postedOn(l.journal.posting_date) < from) {
      row.opening += signed;
    } else {
      row.debit += d;
      row.credit += c;
    }
    row.closing += signed;
  }

  const list = [...rows.values()].sort((a, b) => compareCodes(a.label, b.label));
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
  asOf: Date | string
): Promise<ClosingBalance[]> {
  const to =
    asOf instanceof Date
      ? new Date(`${asOf.toISOString().slice(0, 10)}T00:00:00Z`)
      : new Date(`${asOf.slice(0, 10)}T00:00:00Z`);

  const lines = await prisma.accJournalLine.findMany({
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
