import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import {
  allowedPartnerCategories,
  budgetCategoryAllowsDirection,
  budgetCategoryNeedsPartner,
  directionText,
  directionsOf,
} from "./classification";
import { loadClassification } from "./classification-data";
import { sumByCurrency, type MoneyTotal } from "@/lib/format";
import {
  NOT_APPROVED,
  type BudgetStatus,
} from "./budget-workflow";

/**
 * Budget reads.
 *
 * Budget is a document, not a master record, so it sits outside the entity
 * registry — its lifecycle, its approval-only fields and its month grouping are
 * exactly the things the registry cannot express. The escape hatch CLAUDE.md
 * §12 describes for User and Role applies here for the same reason.
 *
 * Budget Month is derived, never stored: a month *is* a Fiscal Period, and a
 * budget belongs to it when its `budget_date` falls inside that period's range.
 * There is no `bud_budget_month` table and there must not be one.
 */

export type BudgetRow = {
  id: number;
  budget_no: string;
  budget_date: string;
  company_id: number;
  currency_id: number;
  budget_type: "In" | "Out";
  category_id: number | null;
  partner_id: number | null;
  description: string;
  budget_amount: number;
  realized_amount: number;
  status: BudgetStatus;
  created_by: number;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

/** `2026-09-02T00:00:00.000Z` -> `2026-09-02`, the form every comparison uses. */
const day = (d: Date): string => d.toISOString().slice(0, 10);

function toRow(b: {
  id: number;
  budget_no: string;
  budget_date: Date;
  company_id: number;
  currency_id: number;
  budget_type: string;
  category_id: number | null;
  partner_id: number | null;
  description: string;
  budget_amount: { toNumber(): number };
  realized_amount: { toNumber(): number };
  status: string;
  created_by: number;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
}): BudgetRow {
  return {
    id: b.id,
    budget_no: b.budget_no,
    budget_date: day(b.budget_date),
    company_id: b.company_id,
    currency_id: b.currency_id,
    budget_type: b.budget_type as "In" | "Out",
    category_id: b.category_id,
    partner_id: b.partner_id,
    description: b.description,
    budget_amount: b.budget_amount.toNumber(),
    realized_amount: b.realized_amount.toNumber(),
    status: b.status as BudgetStatus,
    created_by: b.created_by,
    updated_by: b.updated_by,
    created_at: b.created_at.toISOString(),
    updated_at: b.updated_at.toISOString(),
  };
}

// ------------------------------------------------------------- budget month

export type BudgetMonth = {
  periodId: number;
  label: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  /** The period containing today — the one a planner most likely wants. */
  current: boolean;
  /**
   * How many budgets fall inside the period. A month is a container, so how
   * many it holds is the whole of what the list needs to say about it — the
   * statuses and the planned amounts belong to the budgets themselves and are
   * read inside the month.
   */
  count: number;
};

/**
 * Every Fiscal Period, with the budgets that fall inside it rolled up.
 *
 * Periods with no budgets are still listed: a month you have planned nothing
 * for is exactly the month a planner needs to see.
 */
export async function budgetMonths(companyIds: number[]): Promise<BudgetMonth[]> {
  // Budgets belong to a Company; the fiscal calendar does not, so the months
  // themselves are the same either way and only their rollups narrow. The
  // Companies are the ones the reader's permissions open — none of them means
  // no budget is readable, and the months come back empty rather than whole.
  const [periods, budgets] = await Promise.all([
    prisma.accFiscalPeriod.findMany({ orderBy: { start_date: "desc" } }),
    prisma.budBudget.findMany({
      where: { company_id: { in: companyIds } },
      select: { budget_date: true },
    }),
  ]);

  const today = day(new Date());

  return periods.map((p) => {
    const from = day(p.start_date);
    const to = day(p.end_date);
    const mine = budgets.filter((b) => {
      const d = day(b.budget_date);
      return d >= from && d <= to;
    });
    return {
      periodId: p.id,
      label: p.period_label,
      name: p.period_name,
      startDate: from,
      endDate: to,
      status: p.status,
      current: today >= from && today <= to,
      count: mine.length,
    };
  });
}

// ------------------------------------------------------------------ budgets

/** The fiscal period a month page is showing, or null for "all months". */
export async function fiscalPeriod(periodId: number) {
  const p = await prisma.accFiscalPeriod.findUnique({ where: { id: periodId } });
  if (!p) return null;
  return {
    id: p.id,
    label: p.period_label,
    name: p.period_name,
    startDate: day(p.start_date),
    endDate: day(p.end_date),
    status: p.status,
  };
}

/**
 * Budgets in one month, or all of them.
 *
 * The month filter is a date-range query rather than a stored month id — that
 * is what "derived, not stored" means in practice. A budget moves between
 * months by having its date changed, and nothing else needs updating.
 */
export async function listBudgets(
  range: { startDate: string; endDate: string } | null,
  companyIds: number[]
): Promise<BudgetRow[]> {
  const rows = await prisma.budBudget.findMany({
    where: {
      company_id: { in: companyIds },
      ...(range
        ? {
            budget_date: {
              gte: new Date(`${range.startDate}T00:00:00Z`),
              lte: new Date(`${range.endDate}T00:00:00Z`),
            },
          }
        : {}),
    },
    orderBy: [{ budget_date: "desc" }, { id: "desc" }],
  });
  return rows.map(toRow);
}

export async function getBudget(id: number): Promise<BudgetRow | null> {
  const row = await prisma.budBudget.findUnique({ where: { id } });
  return row ? toRow(row) : null;
}

/** The fiscal period a given budget date falls into, for the detail page. */
export async function monthOfDate(
  date: string
): Promise<{ id: number; label: string; name: string } | null> {
  const p = await prisma.accFiscalPeriod.findFirst({
    where: {
      start_date: { lte: new Date(`${date}T00:00:00Z`) },
      end_date: { gte: new Date(`${date}T00:00:00Z`) },
    },
    select: { id: true, period_label: true, period_name: true },
  });
  return p ? { id: p.id, label: p.period_label, name: p.period_name } : null;
}

// ------------------------------------------------------------------ options

export type BudgetOption = {
  id: number;
  label: string;
  name: string;
  active: boolean;
};

export type PartnerOption = BudgetOption & {
  companyId: number;
  categoryId: number;
  categoryLabel: string;
};

export type BudgetCategoryOption = BudgetOption & {
  /** Directions this category is meaningful for — In, Out, or both. */
  directions: string[];
  needsPartner: boolean;
  /** Partner Category labels this budget category admits. */
  partnerCategories: string[];
};

export type BudgetRefs = {
  companies: BudgetOption[];
  currencies: BudgetOption[];
  categories: BudgetCategoryOption[];
  partners: PartnerOption[];
};

/**
 * Everything the budget pages need to render a reference as text, plus the two
 * option sets approval chooses from.
 *
 * The category options carry their own rules — direction, whether a partner is
 * required, which partner categories are admissible — so the approval dialog
 * narrows its pickers from the same `rules.ts` table the Server Action checks
 * against. The dialog is still only a convenience: `checkClassification` is
 * what enforces it.
 */
/**
 * How many Budgets each Budget Category holds, keyed by category id.
 *
 * Exported because `bud_budget` is Budget's table and the classification screen
 * wants the number: a category about to be deactivated should say what still
 * depends on it. The module contract is that another module asks for the figure
 * rather than querying the table (CLAUDE.md §3).
 */
export async function budgetCountByCategory(): Promise<Map<number, number>> {
  const groups = await prisma.budBudget.groupBy({
    by: ["category_id"],
    _count: { _all: true },
  });
  const out = new Map<number, number>();
  for (const g of groups) {
    if (g.category_id !== null) out.set(g.category_id, g._count._all);
  }
  return out;
}

export async function budgetRefs(): Promise<BudgetRefs> {
  const [companies, currencies, categories, partners, partnerCategories, classification] =
    await Promise.all([
      prisma.sysCompany.findMany({ orderBy: { id: "asc" } }),
      prisma.refCurrency.findMany({ orderBy: { id: "asc" } }),
      prisma.sysBudgetCategory.findMany({ orderBy: { id: "asc" } }),
      prisma.mPartner.findMany({ orderBy: { id: "asc" } }),
      prisma.sysPartnerCategory.findMany(),
      loadClassification(),
    ]);

  const categoryLabel = new Map(
    partnerCategories.map((p) => [p.id, p.category_label])
  );

  return {
    companies: companies.map((c) => ({
      id: c.id,
      label: c.company_label,
      name: c.company_name,
      active: true,
    })),
    currencies: currencies.map((c) => ({
      id: c.id,
      label: c.currency_label,
      name: c.currency_name,
      active: c.status === "Active",
    })),
    categories: categories.map((c) => {
      const rule = classification.find((r) => r.label === c.category_label);
      return {
        id: c.id,
        label: c.category_label,
        name: c.category_name,
        active: c.status === "Active",
        directions: rule ? directionsOf(rule) : [],
        needsPartner: rule?.requirePartner ?? false,
        partnerCategories: rule?.partnerCategories ?? [],
      };
    }),
    partners: partners.map((p) => ({
      id: p.id,
      label: p.partner_label,
      name: p.partner_name,
      active: p.status === "Active",
      companyId: p.company_id,
      categoryId: p.category_id,
      categoryLabel: categoryLabel.get(p.category_id) ?? "",
    })),
  };
}

export type BudgetMapping = {
  companyId: number;
  budgetCategoryId: number;
  partnerCategoryId: number | null;
  accountLabel: string;
  accountName: string;
};

/**
 * The Accounting mapping table — Company × Budget Category × Partner Category
 * to exactly one account — read whole so the approval dialog can resolve the
 * destination account live as the approver picks.
 *
 * Showing it lets an approver see *why* the classification matters before
 * committing to it. A missing mapping does not block approval: that is an
 * Accounting gap to fix in the Accounting module, and refusing here would
 * strand a planner behind someone else's unfinished setup. The dialog says so
 * instead.
 */
export async function budgetMappings(): Promise<BudgetMapping[]> {
  const rows = await prisma.accBudgetCategoryAccount.findMany({
    select: {
      company_id: true,
      budget_category_id: true,
      partner_category_id: true,
      account: { select: { account_label: true, account_name: true } },
    },
  });
  return rows.map((m) => ({
    companyId: m.company_id,
    budgetCategoryId: m.budget_category_id,
    partnerCategoryId: m.partner_category_id,
    accountLabel: m.account.account_label,
    accountName: m.account.account_name,
  }));
}

// ------------------------------------------------------------- enforcement

/**
 * The classification an approver assigns, checked against every rule at once.
 *
 * The approval dialog offers only valid combinations, but a Server Action is
 * reachable directly with any pair of ids — this is what actually enforces the
 * chain Budget Category -> allowed Partner Categories -> Partner.
 */
export async function checkClassification(
  budget: { company_id: number; budget_type: string },
  budgetCategoryId: number | null,
  partnerId: number | null
): Promise<Record<string, string>> {
  if (!budgetCategoryId) {
    return {
      category_id: "Budget Category wajib ditetapkan sebelum menyetujui.",
    };
  }

  const category = await prisma.sysBudgetCategory.findUnique({
    where: { id: budgetCategoryId },
    select: { category_label: true },
  });
  if (!category) return { category_id: "Budget Category tidak ditemukan." };

  const label = category.category_label;
  const classification = await loadClassification();
  if (!budgetCategoryAllowsDirection(classification, label, budget.budget_type)) {
    const arah = directionText(budget.budget_type);
    return {
      category_id: `Category ini tidak berlaku untuk budget bertipe ${arah}.`,
    };
  }

  const needsPartner = budgetCategoryNeedsPartner(classification, label);
  if (!needsPartner) {
    // A category that takes no subject must not carry one, or a subledger
    // would later be opened against a partner the classification never meant.
    return partnerId
      ? { partner_id: "Category yang dipilih tidak memakai Partner." }
      : {};
  }

  if (!partnerId) return { partner_id: "Category ini memerlukan Partner." };

  const partner = await prisma.mPartner.findUnique({
    where: { id: partnerId },
    select: {
      company_id: true,
      status: true,
      category: { select: { category_label: true } },
    },
  });
  if (!partner) return { partner_id: "Partner tidak ditemukan." };
  if (partner.company_id !== budget.company_id) {
    return { partner_id: "Partner harus milik Company yang sama dengan budget." };
  }
  if (partner.status !== "Active") {
    return { partner_id: "Partner tersebut non-aktif dan tidak dapat dipilih." };
  }
  if (
    !allowedPartnerCategories(classification, label).includes(
      partner.category.category_label
    )
  ) {
    return {
      partner_id: "Partner ini tidak berkategori yang diizinkan Category tersebut.",
    };
  }
  return {};
}

// ------------------------------------------------ realization (the contract)

/**
 * How another module reaches a Budget.
 *
 * Finance executes what Budget plans (concept doc §2.2), so it necessarily
 * holds references to Budgets — but it must not read or write `bud_budget`
 * itself. These three functions are the whole surface: two reads and one
 * write, all returning Budget's own `BudgetRow`, so a change to the table is a
 * change to this file and nowhere else.
 *
 * The direction is one-way on purpose. Budget knows nothing about Finance: a
 * plan is complete without an execution, and `budget.ts` must never import
 * `finance.ts`. `tests/module-boundaries.test.ts` enforces both halves.
 */

/** A Prisma client or an interactive transaction. */
type Db = Prisma.TransactionClient | typeof prisma;

/** The Budgets behind a set of ids — for a module that stores references. */
export async function budgetsByIds(ids: number[]): Promise<BudgetRow[]> {
  if (!ids.length) return [];
  const rows = await prisma.budBudget.findMany({ where: { id: { in: ids } } });
  return rows.map(toRow);
}

/**
 * The criteria a settling document narrows Budgets by.
 *
 * The *rule* belongs to the caller — which combination is eligible is concept
 * doc §9, and Finance owns it. The *query* belongs here, because the table
 * does. `partnerId` is applied only when supplied: a Budget Category that takes
 * no subject stores null rather than a stale partner (§10 rule 26).
 */
export type OpenBudgetFilter = {
  companyId: number;
  budgetType: "In" | "Out";
  categoryId: number;
  currencyId: number;
  partnerId?: number | null;
};

/** Approved, still-open Budgets matching a filter, oldest plan first. */
export async function openBudgetsMatching(
  filter: OpenBudgetFilter
): Promise<BudgetRow[]> {
  const rows = await prisma.budBudget.findMany({
    where: {
      status: "Open",
      company_id: filter.companyId,
      budget_type: filter.budgetType,
      category_id: filter.categoryId,
      currency_id: filter.currencyId,
      ...(filter.partnerId != null ? { partner_id: filter.partnerId } : {}),
    },
    orderBy: [{ budget_date: "asc" }, { id: "asc" }],
  });
  return rows.map(toRow);
}

/** One plan, and how much of it a posting is settling. */
export type BudgetSettlement = { budgetId: number; amount: number };

/**
 * Records realization against Budgets, inside the caller's transaction.
 *
 * This is the only way `realized_amount` and a realization-driven `Closed`
 * are ever written. It takes the caller's `tx` rather than opening its own,
 * because Post is one database transaction and must stay that way (§12): the
 * book entry, the journal and this all commit together or not at all.
 *
 * Budgets are re-read *here*, inside that transaction, rather than trusted
 * from a read the caller made earlier — the figure being incremented is the
 * one actually in the row. Settlements are summed per Budget first, so the
 * function is correct even if a caller ever passes the same plan twice.
 *
 * Over-realization is permitted (§6.5) and still closes the plan: the money
 * left, and a plan cannot be more than finished. Nobody closes a Budget by
 * hand — there is no `BUDGET_CLOSE` permission and there must not be one.
 */
export async function realizeBudgets(
  tx: Db,
  settlements: BudgetSettlement[],
  actorId: number
): Promise<{ closed: number }> {
  if (!settlements.length) return { closed: 0 };

  const byBudget = new Map<number, number>();
  for (const s of settlements) {
    byBudget.set(s.budgetId, (byBudget.get(s.budgetId) ?? 0) + s.amount);
  }

  const rows = await tx.budBudget.findMany({
    where: { id: { in: [...byBudget.keys()] } },
    select: { id: true, budget_amount: true, realized_amount: true },
  });

  let closed = 0;
  for (const row of rows) {
    const realized =
      row.realized_amount.toNumber() + (byBudget.get(row.id) ?? 0);
    const willClose = realized >= row.budget_amount.toNumber();
    if (willClose) closed += 1;

    await tx.budBudget.update({
      where: { id: row.id },
      data: {
        realized_amount: realized,
        ...(willClose ? { status: "Closed" as const } : {}),
        updated_by: actorId,
      },
    });
    // Realization is a consequence of somebody posting a document, not a
    // decision taken against the Budget, and closing is the same consequence
    // reaching the planned amount (CLAUDE.md §10 rule 36). The history names
    // which of the two happened so the trace does not read as a manual edit.
    await tx.auditLog.create({
      data: {
        entity_key: "bud_budget",
        row_id: row.id,
        action: "UPDATE",
        event: willClose ? "close" : "realize",
        by: actorId,
      },
    });
  }

  return { closed };
}

// --------------------------------------------------------------- numbering

/** Next document number, `BGT-0001`. The format lives in `document-number.ts`. */
export async function nextBudgetNo(): Promise<string> {
  return nextDocumentNumber("BGT", async () => {
    const row = await prisma.budBudget.findFirst({
      orderBy: { id: "desc" },
      select: { budget_no: true },
    });
    return row?.budget_no ?? null;
  });
}

// ------------------------------------------------------------- KPI summary

export type BudgetSummary = {
  notApproved: number;
  notApprovedTotals: MoneyTotal[];
  draft: number;
  submitted: number;
  unrealized: number;
  unrealizedTotals: MoneyTotal[];
};

/** The two KPI cards computed from `bud_budget` itself. */
export async function summarise(rows: BudgetRow[]): Promise<BudgetSummary> {
  const currencies = await prisma.refCurrency.findMany({
    select: { id: true, currency_label: true },
  });
  const labelOf = new Map(currencies.map((c) => [c.id, c.currency_label]));
  const money = (b: BudgetRow, amount: number) => ({
    currencyId: b.currency_id,
    currencyLabel: labelOf.get(b.currency_id) ?? "",
    amount,
  });

  const notApproved = rows.filter((b) => NOT_APPROVED.includes(b.status));
  // "Unrealized" means an approved budget with money still left to spend
  // against it. `realized_amount` is written by a posted Cash Bank Transaction,
  // and a budget that reaches its planned amount leaves Open for Closed — so a
  // budget only counts here while it is both approved and not yet spent out.
  const unrealized = rows.filter(
    (b) => b.status === "Open" && b.realized_amount < b.budget_amount
  );

  return {
    notApproved: notApproved.length,
    notApprovedTotals: sumByCurrency(
      notApproved.map((b) => money(b, b.budget_amount))
    ),
    draft: rows.filter((b) => b.status === "Draft").length,
    submitted: rows.filter((b) => b.status === "Submitted").length,
    unrealized: unrealized.length,
    unrealizedTotals: sumByCurrency(
      unrealized.map((b) => money(b, b.budget_amount - b.realized_amount))
    ),
  };
}

// -------------------------------------------------------- commitment queues

/**
 * One budget as the dashboard's work queue states it: what it is, how much of
 * it is still committed but not yet cash, and how long it has been sitting.
 *
 * `amount` is the committed figure for the stage the row is in — the whole
 * plan while it is waiting for approval, and only what is left outstanding
 * once it has been approved. That difference is what keeps the two queues from
 * counting the same money twice.
 */
export type CommitmentRow = {
  id: number;
  budgetNo: string;
  budgetDate: string;
  description: string;
  companyId: number;
  companyLabel: string;
  currencyId: number;
  currencyLabel: string;
  budgetType: "In" | "Out";
  amount: number;
  /** When the budget last moved — submission, approval, or a realization. */
  since: string;
};

export type CommitmentQueue = {
  count: number;
  totals: MoneyTotal[];
  /** Out minus In, per currency — what the queue does to cash if it all lands. */
  outTotals: MoneyTotal[];
  inTotals: MoneyTotal[];
  rows: CommitmentRow[];
};

const emptyQueue = (): CommitmentQueue => ({
  count: 0,
  totals: [],
  outTotals: [],
  inTotals: [],
  rows: [],
});

function toQueue(rows: CommitmentRow[]): CommitmentQueue {
  const money = (r: CommitmentRow) => ({
    currencyId: r.currencyId,
    currencyLabel: r.currencyLabel,
    amount: r.amount,
  });
  return {
    count: rows.length,
    totals: sumByCurrency(rows.map(money)),
    outTotals: sumByCurrency(
      rows.filter((r) => r.budgetType === "Out").map(money)
    ),
    inTotals: sumByCurrency(
      rows.filter((r) => r.budgetType === "In").map(money)
    ),
    // Oldest first: a queue is read to find what has been waiting longest.
    rows: [...rows].sort((a, b) => a.since.localeCompare(b.since)),
  };
}

type QueueRecord = {
  id: number;
  budget_no: string;
  budget_date: Date;
  description: string;
  company_id: number;
  currency_id: number;
  budget_type: string;
  budget_amount: { toNumber(): number };
  realized_amount: { toNumber(): number };
  updated_at: Date;
  company: { company_label: string };
  currency: { currency_label: string };
};

const toCommitment = (b: QueueRecord, amount: number): CommitmentRow => ({
  id: b.id,
  budgetNo: b.budget_no,
  budgetDate: day(b.budget_date),
  description: b.description,
  companyId: b.company_id,
  companyLabel: b.company.company_label,
  currencyId: b.currency_id,
  currencyLabel: b.currency.currency_label,
  budgetType: b.budget_type as "In" | "Out",
  amount,
  since: b.updated_at.toISOString(),
});

/**
 * Budgets submitted and still waiting for a decision.
 *
 * This is the first stage of the commitment funnel: an intent somebody has
 * committed to on paper, blocked on an approver. Draft and Rejected budgets
 * are deliberately absent — a draft is a preparation document that may never
 * happen, so counting it would inflate every figure below it.
 */
export async function submittedCommitments(
  companyIds: number[]
): Promise<CommitmentQueue> {
  if (!companyIds.length) return emptyQueue();
  const rows = await prisma.budBudget.findMany({
    where: { status: "Submitted", company_id: { in: companyIds } },
    include: {
      company: { select: { company_label: true } },
      currency: { select: { currency_label: true } },
    },
  });
  return toQueue(rows.map((b) => toCommitment(b, b.budget_amount.toNumber())));
}

/**
 * Approved budgets with money still to spend against them.
 *
 * The amount is what is left — `budget_amount - realized_amount` — because
 * `realized_amount` is written only at Post, so a partly realized plan is
 * partly cash already and only the remainder is still a commitment.
 *
 * What a *pending* document has claimed is subtracted by the caller
 * (`dashboard.ts`), not here: this module knows nothing about documents, and
 * Budget must not learn about Finance (CLAUDE.md §3).
 */
export async function approvedCommitments(
  companyIds: number[]
): Promise<CommitmentQueue> {
  if (!companyIds.length) return emptyQueue();
  const rows = await prisma.budBudget.findMany({
    where: { status: "Open", company_id: { in: companyIds } },
    include: {
      company: { select: { company_label: true } },
      currency: { select: { currency_label: true } },
    },
  });
  return toQueue(
    rows
      .map((b) =>
        toCommitment(b, b.budget_amount.toNumber() - b.realized_amount.toNumber())
      )
      // A plan realized to the last rupiah closes, so this is belt and braces
      // for one over-realized by a rounding of its own.
      .filter((r) => r.amount > 0)
  );
}
