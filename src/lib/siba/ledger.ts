import "server-only";

import { prisma } from "@/lib/prisma";
import { sumByCurrency, type MoneyTotal } from "@/lib/format";
import { compareCodes } from "./account-code";
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
 * **Grouped by currency, never converted.** There is no exchange-rate source
 * in this system (§12), so a period is reported per currency rather than
 * summed into one figure. Each currency group balances on its own, because
 * every journal is written in a single currency and every journal balances.
 *
 * This deviates from concept doc §11.2, which says the General Ledger uses the
 * base currency. It cannot until a real rate source exists: converting would
 * mean inventing the rate. Recorded in CLAUDE.md rather than resolved quietly.
 */

export type Balance = "Debit" | "Kredit";

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
  debit: number;
  credit: number;
  /** Running balance after this entry, in the account's normal direction. */
  balance: number;
};

export type LedgerAccount = {
  id: number;
  label: string;
  name: string;
  companyLabel: string;
  currencyLabel: string;
  normalBalance: string;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
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
      where: { account_id: { in: ids }, journal: { posting_date: { lt: from } } },
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
        journal: { posting_date: { gte: from, lte: to } },
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

    for (const l of within.filter((x) => x.account_id === a.id)) {
      const d = l.debit_amount.toNumber();
      const c = l.kredit_amount.toNumber();
      debit += d;
      credit += c;
      running += signedMovement(a.normal_balance, d, c);
      entries.push({
        journalId: l.journal.id,
        journalNo: l.journal.journal_no,
        date: l.journal.posting_date.toISOString(),
        description: l.description,
        partnerLabel: l.partner?.partner_label ?? null,
        debit: d,
        credit: c,
        balance: running,
      });
    }

    // A currency is a property of the entries, not of the account: an account
    // with no movement at all has none to state.
    const currency =
      within.find((l) => l.account_id === a.id)?.currency.currency_label ??
      openingLines[0]?.currency.currency_label ??
      "—";

    return {
      id: a.id,
      label: a.account_label,
      name: a.account_name,
      companyLabel: a.company.company_label,
      currencyLabel: currency,
      normalBalance: a.normal_balance,
      opening,
      debit,
      credit,
      closing: running,
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

export type TrialBalanceGroup = {
  currencyLabel: string;
  rows: TrialBalanceRow[];
  /** The two sides of the period's movement, which must agree. */
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
};

export type TrialBalanceReport = {
  range: PeriodRange;
  groups: TrialBalanceGroup[];
  /** Journals whose own sides disagree — always empty unless something is wrong. */
  unbalanced: { id: number; journalNo: string; debit: number; credit: number }[];
};

/**
 * Every account that has moved, or has an opening balance, per currency.
 *
 * The check a trial balance exists for is that total debits equal total
 * credits. Here that is a consequence rather than a hope: every journal is
 * refused unless it balances, so the totals can only disagree if something
 * wrote the tables without going through `postJournal`. The report says which
 * it is instead of printing a number nobody can act on.
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
      journal: { company_id: { in: companyIds }, posting_date: { lte: to } },
    },
    select: {
      account_id: true,
      debit_amount: true,
      kredit_amount: true,
      journal: { select: { posting_date: true } },
      currency: { select: { currency_label: true } },
      account: {
        select: { account_label: true, account_name: true, normal_balance: true },
      },
    },
  });

  type Key = string;
  const byCurrency = new Map<string, Map<Key, TrialBalanceRow>>();

  for (const l of lines) {
    const currency = l.currency.currency_label;
    if (!byCurrency.has(currency)) byCurrency.set(currency, new Map());
    const rows = byCurrency.get(currency)!;

    const key = String(l.account_id);
    if (!rows.has(key)) {
      rows.set(key, {
        id: l.account_id,
        label: l.account.account_label,
        name: l.account.account_name,
        normalBalance: l.account.normal_balance,
        opening: 0,
        debit: 0,
        credit: 0,
        closing: 0,
      });
    }
    const row = rows.get(key)!;

    const d = l.debit_amount.toNumber();
    const c = l.kredit_amount.toNumber();
    const signed = signedMovement(l.account.normal_balance, d, c);

    if (l.journal.posting_date < from) {
      row.opening += signed;
    } else {
      row.debit += d;
      row.credit += c;
    }
    row.closing += signed;
  }

  const groups: TrialBalanceGroup[] = [...byCurrency.entries()]
    .map(([currencyLabel, rows]) => {
      const list = [...rows.values()].sort((a, b) => compareCodes(a.label, b.label));
      const totalDebit = list.reduce((t, r) => t + r.debit, 0);
      const totalCredit = list.reduce((t, r) => t + r.credit, 0);
      return {
        currencyLabel,
        rows: list,
        totalDebit,
        totalCredit,
        balanced: Math.round(totalDebit * 100) === Math.round(totalCredit * 100),
      };
    })
    .sort((a, b) => a.currencyLabel.localeCompare(b.currencyLabel));

  const { unbalancedJournals } = await import("./journal");

  return { range, groups, unbalanced: await unbalancedJournals(companyIds) };
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
 * Where a handful of named accounts stand right now, per currency.
 *
 * All of history, no period: this answers "what is the balance today", which
 * is a different question from the General Ledger's "what happened between
 * these dates". It exists for the intercompany bridge, whose two sides are a
 * standing position rather than a period's movement — and which is otherwise
 * readable only by someone who thinks to run the General Ledger for exactly
 * the right account (CLAUDE.md §17).
 *
 * Signed by normal balance like every other figure here, and grouped per
 * currency because nothing converts.
 */
export type AccountPosition = {
  id: number;
  label: string;
  name: string;
  companyId: number;
  companyLabel: string;
  normalBalance: string;
  totals: MoneyTotal[];
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
      where: { account_id: { in: accountIds } },
      select: {
        account_id: true,
        debit_amount: true,
        kredit_amount: true,
        currency_id: true,
        currency: { select: { currency_label: true } },
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
    totals: sumByCurrency(
      lines
        .filter((l) => l.account_id === a.id)
        .map((l) => ({
          currencyId: l.currency_id,
          currencyLabel: l.currency.currency_label,
          amount: signedMovement(
            a.normal_balance,
            l.debit_amount.toNumber(),
            l.kredit_amount.toNumber()
          ),
        }))
    ),
  }));
}
