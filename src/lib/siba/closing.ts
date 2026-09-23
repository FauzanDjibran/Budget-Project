import "server-only";

import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "./currency";
import {
  closedFiscalYearsFor,
  fiscalClosingState,
  fiscalYearAfter,
  fiscalYearForClosing,
  openFiscalYears,
  recordFiscalClosing,
  type FiscalYearForClosing,
} from "./fiscal";
import {
  draftJournalsCreatedBetween,
  postJournal,
  unbalancedJournals,
  type JournalLineInput,
} from "./journal";
import { closingBalances, trialBalanceReport, type ClosingBalance } from "./ledger";
import { writeOpeningBalance } from "./opening-balance";
import { closingAccountFor } from "./system-settings";

/**
 * Closing a fiscal year.
 *
 * One Company at a time, and one act: the year's profit and loss is moved into
 * equity, the position that remains is written as the next year's Opening
 * Balance, and the Company's closing row is stamped. Either all of that
 * happened or none of it did.
 *
 * ## Laba/Rugi Tahun Berjalan is computed, never posted
 *
 * The closing journal moves the result **straight into Laba/Rugi Tahun
 * Sebelumnya**. The current-year account is a Balance Sheet *presentation
 * line* — Σ Pendapatan − Σ Biaya for the year still open — and nothing ever
 * posts to it. Posting it as a pass-through would leave an account whose
 * balance is permanently zero while the Neraca still had to compute the
 * running figure anyway; posting it and holding it for a year would leave the
 * line named "tahun berjalan" carrying the *previous* year's result for twelve
 * months, which is the commonest way this account is misread in practice.
 *
 * The cost is real and accepted: after closing, "2026 made 250 juta" is no
 * longer a balance. It stays readable as a movement on the accumulated
 * account's General Ledger, and on the closing journal itself.
 *
 * ## What is written
 *
 *   `CLS-0001`  dated 31/12 of the year being closed — the one journal in the
 *               application that is not dated the day it was posted
 *   `OPB-0001`  the next year's snapshot, taken *after* the closing journal,
 *               so it is a balance sheet by construction
 *   the closing row, and `AccFiscalYear.status` when this is the last Company
 *
 * ## Irreversible
 *
 * Nothing reopens a closed year. `checkPostingPeriod` refuses every posting
 * into it by that Company afterwards, on all four posting paths, and there is
 * no un-close: a posted journal is never reversed, so undoing a close would
 * mean reversing one.
 *
 * ## Module boundary
 *
 * This file names no other module's table. Balances come from `ledger.ts`,
 * which is the one thing allowed to derive from journal lines; journals are
 * written through `journal.ts`; snapshots through `opening-balance.ts`; and
 * the calendar records its own state through `fiscal.ts`. The only delegate it
 * reaches for itself is `sys_company`, which is master data and belongs to
 * nobody in particular.
 */

// ------------------------------------------------------------- the subject

export type ClosingSubject = {
  companyId: number;
  companyLabel: string;
  companyName: string;
  isParent: boolean;
  fiscalYearId: number;
  yearLabel: string;
  yearName: string;
  /** `YYYY-MM-DD`, the day the closing journal is dated. */
  endDate: string;
  /** The year the snapshot is written for, when there is one. */
  nextYearLabel: string | null;
  nextYearName: string | null;
};

// ------------------------------------------------------------ the checklist

export type ClosingCheckKey =
  | "year_open"
  | "oldest_open"
  | "not_yet_closed"
  | "next_year"
  | "accumulated_account"
  | "no_draft_journal"
  | "balanced";

/**
 * One blocking condition, and what was actually found.
 *
 * The checklist is the screen and the refusal at once: every entry is asked
 * again when the close is executed, so a list the user can read is never a
 * different set of rules from the ones enforced.
 */
export type ClosingCheck = {
  key: ClosingCheckKey;
  /** What is being checked, stated as a requirement. */
  label: string;
  ok: boolean;
  /** What was found — the refusal when it failed, the evidence when it passed. */
  detail: string;
};

/** One line of the closing journal, as the preview shows it. */
export type ClosingJournalLine = {
  accountId: number;
  accountLabel: string;
  accountName: string;
  partnerId: number | null;
  partnerLabel: string | null;
  debit: number;
  credit: number;
  /** True for the single equity line, which is the residual rather than a balance. */
  residual: boolean;
};

export type ClosingPreview = {
  lines: ClosingJournalLine[];
  debit: number;
  credit: number;
  /**
   * `Σ (debit − credit)` over every ProfitLoss balance.
   *
   * Positive is a **loss** — expenses are debit-natured, so a net debit is
   * money spent beyond what came in — and it is debited to equity. Negative is
   * a profit, credited. Zero writes no journal at all.
   */
  result: number;
  /** How many `(account, partner?)` lines the snapshot will carry. */
  snapshotLines: number;
};

export type ClosingPlan = {
  subject: ClosingSubject;
  checks: ClosingCheck[];
  ready: boolean;
  /** Null while something still blocks it — there is nothing to preview yet. */
  preview: ClosingPreview | null;
  /** Set once this Company has closed this year. */
  closed: {
    at: string;
    closingJournalId: number | null;
    openingBalanceId: number | null;
  } | null;
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100);

/**
 * Every blocking condition, asked in order.
 *
 * Ordered so the earliest failure is the one a reader can act on first: there
 * is no point reporting an unbalanced Trial Balance for a year this Company
 * has already closed.
 */
async function runChecks(
  subject: ClosingSubject,
  year: FiscalYearForClosing,
  next: FiscalYearForClosing | null
): Promise<ClosingCheck[]> {
  const checks: ClosingCheck[] = [];

  // 1. The year must be Open. Draft means its periods do not exist yet and
  //    nothing was ever grouped into it; Closed means every Company is done.
  checks.push({
    key: "year_open",
    label: "Tahun buku berstatus Open",
    ok: year.status === "Open",
    detail:
      year.status === "Open"
        ? `${year.name} aktif.`
        : `${year.name} berstatus ${year.status}, bukan Open.`,
  });

  // 2. Only the oldest Open year may be closed. Closing the newer one would
  //    leave an Open year with no successor to inherit into — the snapshot
  //    this close writes is what the next year opens from.
  const open = await openFiscalYears();
  const oldest = open[0] ?? null;
  checks.push({
    key: "oldest_open",
    label: "Tahun buku Open yang paling lama",
    ok: oldest?.id === year.id,
    detail:
      oldest?.id === year.id
        ? "Tidak ada tahun buku Open yang lebih lama."
        : oldest
          ? `${oldest.name} masih terbuka dan lebih lama. Tutup tahun buku itu lebih dahulu.`
          : "Tidak ada tahun buku Open sama sekali.",
  });

  // 3. This Company must not already have closed it. Closing is per Company
  //    and irreversible, so a second one is refused rather than repeated.
  const state = await fiscalClosingState(year.id, subject.companyId);
  checks.push({
    key: "not_yet_closed",
    label: `Company ${subject.companyLabel} belum menutup tahun buku ini`,
    ok: state.status !== "Closed",
    detail:
      state.status === "Closed"
        ? `Sudah ditutup pada ${formatDate(state.closedAt ?? new Date())}. Penutupan tidak dapat diulang.`
        : "Belum ditutup.",
  });

  // 4. The next year must exist. It is **refused, not created**: a fiscal year
  //    is chosen by a person (CLAUDE.md §12). Draft is enough — activating it
  //    later generates its twelve periods exactly as it does today.
  checks.push({
    key: "next_year",
    label: "Tahun buku berikutnya sudah dibuat",
    ok: Boolean(next),
    detail: next
      ? `${next.name} (${next.status}) akan menerima Opening Balance.`
      : "Belum ada tahun buku setelah ini. Buat tahun buku berikutnya lebih dahulu — cukup berstatus Draft.",
  });

  // 5. Somewhere for the result to go, named rather than guessed.
  const account = await closingAccountFor(subject.isParent);
  checks.push({
    key: "accumulated_account",
    label: "Account Laba/Rugi Tahun Sebelumnya sudah diatur",
    ok: account.ok,
    detail: account.ok
      ? "Sudah diatur, postable, dan aktif."
      : `${account.missing} belum diatur atau tidak dapat dipakai. Lengkapi di Settings › System Default.`,
  });

  // 6. No unfinished journal inside the year. Closing would strand it: the
  //    lock refuses a posting into a closed year, so a draft left here could
  //    afterwards only ever be cancelled.
  const drafts = await draftJournalsCreatedBetween(
    subject.companyId,
    year.startDate,
    year.endDate
  );
  checks.push({
    key: "no_draft_journal",
    label: "Tidak ada Journal Manual yang masih Draft",
    ok: drafts.length === 0,
    detail: drafts.length
      ? `Masih ada ${drafts.length} journal Draft: ${drafts
          .map((d) => d.journalNo)
          .join(", ")}. Posting atau batalkan lebih dahulu.`
      : "Tidak ada.",
  });

  // 7. The books must add up. Every journal is refused unless it balances, so
  //    a Trial Balance that does not is a system fault rather than a
  //    bookkeeping one — and closing a set of books that does not add up would
  //    carry the fault forward into a snapshot nobody could reconcile.
  const range = { from: day(year.startDate), to: day(year.endDate) };
  const [trial, unbalanced] = await Promise.all([
    trialBalanceReport(range, [subject.companyId]),
    unbalancedJournals([subject.companyId]),
  ]);
  const balanced = trial.balanced && unbalanced.length === 0;
  checks.push({
    key: "balanced",
    label: "Trial Balance seimbang dan tidak ada journal yang timpang",
    ok: balanced,
    detail: balanced
      ? "Debit dan kredit sama."
      : unbalanced.length
        ? `Journal tidak seimbang: ${unbalanced.map((j) => j.journalNo).join(", ")}.`
        : "Total debit dan kredit Trial Balance tahun ini tidak sama.",
  });

  return checks;
}

/**
 * What the closing journal will say.
 *
 * Every ProfitLoss balance is posted to the opposite side of where it stands,
 * at its own `(account, partner?)` grain, which is what leaves each one at
 * exactly zero. The residual then lands on the accumulated account and the
 * journal balances **by construction** — `postJournal`'s refusal can never
 * fire here, which is the point of computing it this way rather than deriving
 * one side and hoping.
 *
 * Nothing is written. The same function produces the preview on screen and the
 * lines the transaction posts, so what a reader approved is what was posted.
 */
function planJournal(
  pairs: ClosingBalance[],
  accumulatedAccountId: number
): { lines: ClosingJournalLine[]; result: number } {
  const profitLoss = pairs.filter((p) => p.section === "ProfitLoss");
  const lines: ClosingJournalLine[] = [];
  let result = 0;

  for (const p of profitLoss) {
    result += p.net;
    lines.push({
      accountId: p.accountId,
      accountLabel: p.accountLabel,
      accountName: p.accountName,
      partnerId: p.partnerId,
      partnerLabel: p.partnerLabel,
      // The opposite side of where the balance stands, so the pair nets to nil.
      debit: p.net < 0 ? -p.net : 0,
      credit: p.net > 0 ? p.net : 0,
      residual: false,
    });
  }

  if (!lines.length) return { lines, result: 0 };

  const existing = pairs.find(
    (p) => p.accountId === accumulatedAccountId && p.partnerId === null
  );
  lines.push({
    accountId: accumulatedAccountId,
    accountLabel: existing?.accountLabel ?? "",
    accountName: existing?.accountName ?? "",
    partnerId: null,
    partnerLabel: null,
    // A net debit across the P&L is a loss, and a loss reduces equity.
    debit: result > 0 ? result : 0,
    credit: result < 0 ? -result : 0,
    residual: true,
  });

  return { lines, result };
}

/**
 * Everything the closing screen shows, and everything the action re-checks.
 *
 * The preview is computed only once nothing blocks it: a journal previewed
 * against books that do not balance, or against an account nobody has named,
 * would be a figure somebody might act on.
 */
export async function closingPlan(
  companyId: number,
  fiscalYearId: number
): Promise<ClosingPlan | null> {
  const [company, year] = await Promise.all([
    prisma.sysCompany.findUnique({
      where: { id: companyId },
      select: { id: true, company_label: true, company_name: true, is_parent: true },
    }),
    fiscalYearForClosing(fiscalYearId),
  ]);
  if (!company || !year) return null;

  const next = await fiscalYearAfter(year);

  const subject: ClosingSubject = {
    companyId: company.id,
    companyLabel: company.company_label,
    companyName: company.company_name,
    isParent: company.is_parent,
    fiscalYearId: year.id,
    yearLabel: year.label,
    yearName: year.name,
    endDate: day(year.endDate),
    nextYearLabel: next?.label ?? null,
    nextYearName: next?.name ?? null,
  };

  const checks = await runChecks(subject, year, next);
  const state = await fiscalClosingState(year.id, companyId);
  const closed =
    state.status === "Closed"
      ? {
          at: (state.closedAt ?? new Date()).toISOString(),
          closingJournalId: state.closingJournalId,
          openingBalanceId: state.openingBalanceId,
        }
      : null;

  const ready = checks.every((c) => c.ok);
  if (!ready) return { subject, checks, ready, preview: null, closed };

  const account = await closingAccountFor(company.is_parent);
  // `ready` already proved this resolves; the narrowing is for the compiler.
  if (!account.ok) return { subject, checks, ready: false, preview: null, closed };

  const pairs = await closingBalances(companyId, year.endDate);
  const { lines, result } = planJournal(pairs, account.accountId);

  return {
    subject,
    checks,
    ready,
    preview: {
      lines,
      debit: lines.reduce((t, l) => t + l.debit, 0),
      credit: lines.reduce((t, l) => t + l.credit, 0),
      result,
      snapshotLines: snapshotLineCount(pairs, account.accountId, result),
    },
    closed,
  };
}

/**
 * How many lines the snapshot will carry, counted on the position the close
 * will leave rather than on the one it starts from.
 *
 * The equity account is what makes this more than a filter. It usually has no
 * balance before the close and gains one from the residual, so counting the
 * balance-sheet pairs as they stand undercounts by exactly one — and where it
 * *did* have a balance, the residual can cancel it, which overcounts by one
 * the other way. Both are the same mistake: the snapshot is taken after the
 * journal, so the count has to be too.
 */
function snapshotLineCount(
  pairs: ClosingBalance[],
  accumulatedAccountId: number,
  result: number
): number {
  const sheet = pairs.filter((p) => p.section === "BalanceSheet");
  const equity = sheet.find(
    (p) => p.accountId === accumulatedAccountId && p.partnerId === null
  );
  const equityAfter = (equity?.net ?? 0) + result;

  // Every other balance-sheet pair carries straight over — `closingBalances`
  // has already dropped the ones that net to nothing.
  const others = sheet.filter((p) => p !== equity).length;
  return others + (cents(equityAfter) === 0 ? 0 : 1);
}

export type ClosingResult =
  | {
      ok: true;
      /** Null where the year had no profit and loss to move. */
      journalNo: string | null;
      /** Null where nothing at all was standing to snapshot. */
      openingNo: string | null;
      /** True when this was the last Company, and the year itself is now Closed. */
      yearClosed: boolean;
    }
  | { ok: false; error: string };

/**
 * Closes the year for one Company, in one transaction, or writes nothing.
 *
 * The checks are run **again here**, not trusted from when the screen was
 * drawn: another Company may have closed the year since, a journal may have
 * been drafted, a setting may have been repointed. That is the same reasoning
 * `applyPosting` uses for re-reading its Budgets before it moves money.
 *
 * Two things are allowed to be absent, and both are genuine rather than
 * defensive. A year with no income and no expense produces **no closing
 * journal** — there is nothing to move, and `postJournal` rightly refuses an
 * empty one. A Company with nothing standing at all produces **no snapshot** —
 * an Opening Balance with no lines is not a balance sheet. The closing row is
 * written either way, because the Company has finished with the year either
 * way, and the two ids on it are nullable for exactly this.
 */
export async function executeClosing(
  companyId: number,
  fiscalYearId: number,
  actorId: number
): Promise<ClosingResult> {
  const plan = await closingPlan(companyId, fiscalYearId);
  if (!plan) return { ok: false, error: "Company atau tahun buku tidak ditemukan." };

  const failed = plan.checks.find((c) => !c.ok);
  if (failed) return { ok: false, error: failed.detail };
  if (!plan.preview) {
    return { ok: false, error: "Journal penutup tidak dapat disusun." };
  }

  const year = await fiscalYearForClosing(fiscalYearId);
  const next = year ? await fiscalYearAfter(year) : null;
  if (!year || !next) {
    return { ok: false, error: "Tahun buku berikutnya tidak ditemukan." };
  }

  const account = await closingAccountFor(plan.subject.isParent);
  if (!account.ok) {
    return {
      ok: false,
      error: `${account.missing} belum diatur atau tidak dapat dipakai.`,
    };
  }

  const currency = await prisma.refCurrency.findFirst({
    where: { currency_label: BASE_CURRENCY_LABEL },
    select: { id: true },
  });
  if (!currency) {
    return {
      ok: false,
      error: `Currency ${BASE_CURRENCY_LABEL} belum ada pada master Currency.`,
    };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      let journalNo: string | null = null;
      let journalId: number | null = null;

      if (plan.preview!.lines.length) {
        const lines: JournalLineInput[] = plan.preview!.lines.map((l) => ({
          accountId: l.accountId,
          partnerId: l.partnerId,
          // A journal line states the currency it was in; a closing entry
          // moves figures that are already base, so the rate is the identity
          // and that is the one case where `1` is right (§10 rule 68).
          currencyId: currency.id,
          rate: 1,
          debit: l.debit,
          credit: l.credit,
          description: l.residual
            ? `Hasil ${year.name} dipindahkan ke Laba/Rugi Tahun Sebelumnya`
            : `Penutupan ${l.accountLabel} — ${year.name}`,
        }));

        const posted = await postJournal(tx, {
          companyId,
          description: `Penutupan ${year.name} — ${plan.subject.companyLabel}`,
          series: "CLS",
          // The one back-dated journal in the application: a closing entry
          // belongs to the year it closes, and one dated after it would fall
          // inside the year it opens and be the first thing inherited.
          postingDate: year.endDate,
          sourceDocTypeId: await closingDocTypeId(tx),
          sourceDocId: fiscalYearId,
          lines,
          actorId,
        });
        journalNo = posted.journalNo;
        journalId = posted.id;
      }

      // Read back *inside* the transaction, so the snapshot sees the closing
      // journal that was just written. Every ProfitLoss pair is now exactly
      // zero and `closingBalances` drops a zero pair, so what comes back is a
      // balance sheet by construction rather than by a filter.
      const remaining = await closingBalances(companyId, year.endDate, tx);

      let openingNo: string | null = null;
      let openingId: number | null = null;
      if (remaining.length) {
        const written = await writeOpeningBalance(tx, {
          companyId,
          fiscalYearId: next.id,
          sourceFiscalYearId: fiscalYearId,
          // The day the figures speak for: the first day of the year opened.
          postingDate: next.startDate,
          lines: remaining.map((p) => ({
            accountId: p.accountId,
            partnerId: p.partnerId,
            debit: p.net > 0 ? p.net : 0,
            credit: p.net < 0 ? -p.net : 0,
          })),
          actorId,
        });
        openingNo = written.openingNo;
        openingId = written.id;
      }

      const { yearClosed } = await recordFiscalClosing(tx, {
        fiscalYearId,
        companyId,
        closingJournalId: journalId,
        openingBalanceId: openingId,
        actorId,
      });

      return { ok: true as const, journalNo, openingNo, yearClosed };
    });
  } catch (error) {
    // A refusal from inside the transaction — an unbalanced journal, a
    // duplicated snapshot line — rolls everything back and is reported rather
    // than thrown on: the user hit it, and nothing was written.
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Penutupan gagal.",
    };
  }
}

/**
 * The document type a closing journal names as its source.
 *
 * A `CLS-` journal is produced by a Fiscal Year being closed, so the year is
 * what it points back at — through the weak `(doc_type_id, doc_id)` pair every
 * cross-module document reference uses, never a foreign key.
 */
async function closingDocTypeId(
  tx: Parameters<typeof recordFiscalClosing>[0]
): Promise<number | null> {
  const row = await tx.sysDocType.findFirst({
    where: { doc_table: "acc_fiscal_year" },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * The years a Company could be asked to close, newest first.
 *
 * Every Open year plus any the Company has already closed, so the screen can
 * report a finished close rather than losing the year from its own picker the
 * moment it succeeds.
 */
export async function closableYears(
  companyId: number
): Promise<{ id: number; label: string; name: string; closed: boolean }[]> {
  const [open, closed] = await Promise.all([
    openFiscalYears(),
    closedFiscalYearsFor(companyId),
  ]);

  const byId = new Map<number, { id: number; label: string; name: string; closed: boolean }>();
  for (const y of open) byId.set(y.id, { ...y, closed: false });
  for (const y of closed) byId.set(y.id, { ...y, closed: true });

  return [...byId.values()].sort((a, b) => b.label.localeCompare(a.label));
}
