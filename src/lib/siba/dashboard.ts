import "server-only";

import { prisma } from "@/lib/prisma";
import { sumByCurrency, type MoneyTotal } from "@/lib/format";
import {
  approvedCommitments,
  submittedCommitments,
  type CommitmentRow,
} from "./budget";
import { cashBookSummary, type CashBookSummary } from "./cash-bank";
import { pendingCommitments } from "./finance";
import { openFundingRequests } from "./funding";
import { unbalancedJournals } from "./journal";
import { accountPositions, type AccountPosition } from "./ledger";
import { companyStructure } from "./records";
import { subledgerPositions, type SubledgerPosition } from "./subledger";
import { loadSubledgers } from "./subledger-data";
import { intercompanyBridge, missingClosingAccounts } from "./system-settings";

/**
 * The dashboard's data, composed from what each module says about its own
 * records.
 *
 * This file names no other module's table. Every figure below is asked for by
 * calling the module that owns it — which is what lets the dashboard summarise
 * the whole application without becoming the one place that knows everything
 * about all of it.
 *
 * It is a **leaf**: it depends on every module and nothing depends on it, so
 * it can be deleted without disturbing anything. That is the acceptable shape
 * for a cross-cutting screen (CLAUDE.md §3).
 *
 * ## The one rule the page is built on
 *
 * Every rupiah of committed money sits in **exactly one** stage, and the
 * stages together are the whole of what has been committed but has not yet
 * reached a book. That is not automatic: `realized_amount` is written only at
 * Post, so an approved Budget still reports its full outstanding even while a
 * `Pending` document is holding part of it and waiting on the induk. Stating
 * both unadjusted would print the same money twice in two different costumes.
 * `executionStage` below is where the subtraction happens.
 *
 * Draft records — of a Budget or of a document — appear nowhere. A draft is a
 * preparation document that may or may not ever happen, so counting it would
 * inflate every figure that follows it.
 */

// ------------------------------------------------------------------- stages

export type StageKey = "approval" | "execution" | "funding";

export type FunnelStage = {
  key: StageKey;
  name: string;
  /** What this stage is waiting on, in one phrase. */
  blockedOn: string;
  href: string;
  count: number;
  totals: MoneyTotal[];
  /** Split by direction, so the cash projection can use it. */
  inTotals: MoneyTotal[];
  outTotals: MoneyTotal[];
};

/** One thing to open, wherever in the funnel it happens to sit. */
export type TaskRow = {
  key: string;
  stage: StageKey;
  href: string;
  /** Document number. */
  title: string;
  subtitle: string;
  companyLabel: string;
  direction: "In" | "Out";
  amount: number;
  currencyLabel: string;
  since: string;
};

export type Funnel = {
  stages: FunnelStage[];
  /** Every stage's records in one list, longest-waiting first. */
  tasks: TaskRow[];
  /**
   * Approved money that has not yet moved — stages 2 and 3, per direction.
   * Stage 1 is deliberately excluded: an unapproved request is not yet a
   * claim on anybody's cash.
   */
  committedOut: MoneyTotal[];
  committedIn: MoneyTotal[];
};

// -------------------------------------------------------------------- shape

export type IntercompanyPosition = {
  ok: boolean;
  /** Missing System Default names, when the bridge is not fully set. */
  missing: string[];
  sides: AccountPosition[];
};

export type AttentionItem = { href: string; title: string; detail: string };

export type Health = {
  unbalanced: { id: number; journalNo: string; debit: number; credit: number }[];
  attention: AttentionItem[];
};

export type DashboardData = {
  funnel: Funnel;
  cash: CashBookSummary;
  positions: SubledgerPosition[];
  intercompany: IntercompanyPosition;
  health: Health;
};

// ------------------------------------------------------------------ helpers

const moneyOf = (r: {
  currencyLabel: string;
  amount: number;
  currencyId: number;
}) => ({
  currencyId: r.currencyId,
  currencyLabel: r.currencyLabel,
  amount: r.amount,
});

function directional<T extends { currencyId: number; currencyLabel: string; amount: number }>(
  rows: T[],
  isOut: (row: T) => boolean
) {
  return {
    totals: sumByCurrency(rows.map(moneyOf)),
    outTotals: sumByCurrency(rows.filter(isOut).map(moneyOf)),
    inTotals: sumByCurrency(rows.filter((r) => !isOut(r)).map(moneyOf)),
  };
}

const budgetTask = (
  r: CommitmentRow,
  stage: StageKey
): TaskRow => ({
  key: `budget-${r.id}`,
  stage,
  href: `/budget/budget/${r.id}`,
  title: r.budgetNo,
  subtitle: r.description,
  companyLabel: r.companyLabel,
  direction: r.budgetType,
  amount: r.amount,
  currencyLabel: r.currencyLabel,
  since: r.since,
});

// --------------------------------------------------------------------- read

export async function dashboardData(
  companyIds: number[]
): Promise<DashboardData> {
  const [submitted, approved, pending, requests, cash, positions, bridge] =
    await Promise.all([
      submittedCommitments(companyIds),
      approvedCommitments(companyIds),
      pendingCommitments(companyIds),
      openFundingRequests(companyIds),
      cashBookSummary(companyIds),
      loadSubledgers().then((books) => subledgerPositions(books, companyIds)),
      intercompanyBridge(),
    ]);

  // Stage 2 is what is approved *minus* what a pending document is already
  // holding — the subtraction this whole page depends on. Per budget rather
  // than per currency, so a plan half-claimed reports only the half that is
  // genuinely still free to be executed.
  const executionRows = approved.rows
    .map((r) => ({ ...r, amount: r.amount - (pending.claims.get(r.id) ?? 0) }))
    .filter((r) => r.amount > 0);

  const execution = directional(executionRows, (r) => r.budgetType === "Out");

  // A Pending document *is* an open Funding Request, so the queue is stated
  // once: the amounts come from the documents, and the request supplies the
  // number and the link, because confirming is what the induk actually does.
  const requestOf = new Map(
    requests
      .filter((r) => r.transaction)
      .map((r) => [r.transaction!.id, r] as const)
  );

  const fundingTasks: TaskRow[] = pending.rows.map((d) => {
    const request = requestOf.get(d.id);
    return {
      key: `funding-${d.id}`,
      stage: "funding" as const,
      href: request
        ? `/finance/funding-request/${request.id}`
        : `/finance/cash-bank-transaction/${d.id}`,
      title: request?.funding_request_no ?? d.transactionNo,
      subtitle: `${d.purposeLabel} · ${d.transactionNo}`,
      companyLabel: d.companyLabel,
      direction: d.transactionType,
      amount: d.amount,
      currencyLabel: d.currencyLabel,
      since: d.since,
    };
  });

  const stages: FunnelStage[] = [
    {
      key: "approval",
      name: "Menunggu Persetujuan",
      blockedOn: "Budget sudah diajukan dan menunggu keputusan approver.",
      href: "/budget/budget/month/all?status=Submitted",
      count: submitted.count,
      totals: submitted.totals,
      inTotals: submitted.inTotals,
      outTotals: submitted.outTotals,
    },
    {
      key: "execution",
      name: "Siap Direalisasi",
      blockedOn:
        "Budget sudah disetujui dan dananya belum dieksekusi menjadi dokumen.",
      href: "/budget/budget/month/all?status=Open",
      count: executionRows.length,
      totals: execution.totals,
      inTotals: execution.inTotals,
      outTotals: execution.outTotals,
    },
    {
      key: "funding",
      name: "Menunggu Konfirmasi Induk",
      blockedOn:
        "Company anak sudah mengajukan dana dan menunggu induk mengonfirmasi.",
      href: "/finance/funding-request?status=Open",
      count: pending.count,
      totals: pending.totals,
      inTotals: pending.inTotals,
      outTotals: pending.outTotals,
    },
  ];

  const tasks = [
    ...submitted.rows.map((r) => budgetTask(r, "approval")),
    ...executionRows.map((r) => budgetTask(r, "execution")),
    ...fundingTasks,
  ].sort((a, b) => a.since.localeCompare(b.since));

  const committedOut = sumByCurrency([
    ...execution.outTotals,
    ...pending.outTotals,
  ]);
  const committedIn = sumByCurrency([
    ...execution.inTotals,
    ...pending.inTotals,
  ]);

  const sides = bridge.ok
    ? await accountPositions([
        bridge.induk.arAccountId,
        bridge.induk.apAccountId,
        bridge.anak.arAccountId,
        bridge.anak.apAccountId,
      ])
    : [];

  return {
    funnel: { stages, tasks, committedOut, committedIn },
    cash,
    positions,
    intercompany: {
      ok: bridge.ok,
      missing: bridge.ok ? [] : bridge.missing,
      sides,
    },
    health: {
      unbalanced: await unbalancedJournals(companyIds),
      attention: await setupGaps(bridge.ok ? null : bridge.missing),
    },
  };
}

// ------------------------------------------------------------- setup checks

/**
 * What a fresh installation still has to do, in the order the modules depend
 * on each other.
 *
 * The seed plants system data and nothing else (CLAUDE.md §12), so these are
 * the path from an empty database to one that can post — not a health check on
 * a working system. They disappear as they are satisfied, and the whole
 * section disappears with the last of them.
 *
 * Referential problems Postgres already makes impossible are deliberately not
 * checked here.
 */
async function setupGaps(bridgeMissing: string[] | null): Promise<AttentionItem[]> {
  const [companies, cashBanks, accounts, mappings, periods, categories, structure] =
    await Promise.all([
      prisma.sysCompany.findMany({ orderBy: { id: "asc" } }),
      prisma.mCashBank.findMany({
        select: {
          company_id: true,
          account: { select: { company_id: true } },
        },
      }),
      prisma.accAccount.count(),
      prisma.accBudgetCategoryAccount.findMany({
        select: { company_id: true, budget_category_id: true },
      }),
      prisma.accFiscalPeriod.count(),
      prisma.sysBudgetCategory.findMany({
        select: { id: true, category_label: true },
      }),
      companyStructure(),
    ]);

  const items: AttentionItem[] = [];

  // Exactly one induk and one anak is foundational, and nothing in the
  // application can create or edit a Company — so a mismatch here means the
  // database was changed outside the seed.
  if (!structure.ok) {
    items.push({
      href: "/master/company",
      title: "Struktur Company tidak sesuai",
      detail:
        `Ditemukan ${structure.total} Company (${structure.parents} induk, ${structure.children} anak). ` +
        "Sistem mengharuskan tepat satu induk dan satu anak — perbaiki langsung pada database.",
    });
  }

  if (!accounts) {
    items.push({
      href: "/accounting/account",
      title: "Bagan akun belum dibuat",
      detail:
        "Account adalah dasar seluruh modul: Cash & Bank, mapping Budget Category, " +
        "dan Journal. Susun bagan akun tiap Company terlebih dahulu.",
    });
  }

  if (!periods) {
    items.push({
      href: "/accounting/fiscal-year",
      title: "Belum ada Fiscal Period",
      detail:
        "Budget Month mengikuti Fiscal Period. Buat Fiscal Year lalu aktifkan — " +
        "12 periode bulanan dibuat otomatis saat itu.",
    });
  }

  const crossCompany = cashBanks.filter(
    (cb) => cb.account && cb.account.company_id !== cb.company_id
  );
  if (crossCompany.length) {
    items.push({
      href: "/master/cash-bank",
      title: `${crossCompany.length} Cash & Bank memakai Account milik Company lain`,
      detail: "Account harus berada pada Company yang sama dengan resource-nya.",
    });
  }

  // Only worth raising once a chart of accounts exists — before that, the
  // missing accounts are the thing to fix and this would just repeat it.
  if (accounts) {
    const unmapped: string[] = [];
    for (const c of companies) {
      for (const bc of categories) {
        const has = mappings.some(
          (m) => m.company_id === c.id && m.budget_category_id === bc.id
        );
        if (!has) unmapped.push(`${c.company_label} · ${bc.category_label}`);
      }
    }
    if (unmapped.length) {
      items.push({
        href: "/accounting/budget-category-account",
        title: `${unmapped.length} Budget Category belum dipetakan ke Account`,
        detail:
          "Belum dipetakan: " +
          unmapped.slice(0, 4).join(", ") +
          (unmapped.length > 4 ? `, dan ${unmapped.length - 4} lainnya.` : "."),
      });
    }
  }

  const withoutCashBank = companies.filter(
    (c) => !cashBanks.some((cb) => cb.company_id === c.id)
  );
  if (withoutCashBank.length) {
    items.push({
      href: "/master/cash-bank",
      title: `${withoutCashBank.map((c) => c.company_name).join(", ")} belum memiliki Cash & Bank`,
      detail:
        "Company tanpa resource kas bergantung pada Company induk untuk setiap " +
        "realisasi, melalui Funding Request.",
    });
  }

  if (accounts && bridgeMissing?.length) {
    items.push({
      href: "/settings/system-default",
      title: "Bridge intercompany belum lengkap",
      detail:
        "Belum diatur: " +
        bridgeMissing.join(", ") +
        ". Funding Request Company anak tidak dapat dikonfirmasi sebelum ini lengkap.",
    });
  }

  // Same shape as the bridge above, and for the same reason: an account a
  // posting engine needs is named, never guessed. Raised only once a chart of
  // accounts exists, because before that the missing accounts are the thing to
  // fix and this would only repeat it.
  if (accounts) {
    const closingMissing = await missingClosingAccounts();
    if (closingMissing.length) {
      items.push({
        href: "/settings/system-default",
        title: "Account Laba/Rugi Tahun Sebelumnya belum diatur",
        detail:
          "Belum diatur: " +
          closingMissing.join(", ") +
          ". Fiscal Year tidak dapat ditutup sebelum tiap Company menunjuk " +
          "account tempat hasil tahun berjalan dipindahkan.",
      });
    }
  }

  return items;
}
