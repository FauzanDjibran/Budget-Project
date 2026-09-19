import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { type Direction, directionText } from "./classification";
import { loadClassification } from "./classification-data";
import type { Purpose } from "./rules";

/**
 * Transaction Purposes — rows a maintainer enters, not rows the application
 * writes for them.
 *
 * A Purpose is exactly one Budget Category x one Partner Category x one
 * direction, which is what lets it resolve to a single account. They were
 * briefly generated from the classification, since the set is derivable from
 * it. That is reversed on the user's instruction: this table stands in for what
 * somebody would otherwise type straight into the database, so it is filled in
 * deliberately and nothing creates a row on their behalf.
 *
 * **A Budget Category with no Purpose cannot be transacted, and that is the
 * correct outcome** — it means whoever added the category has not finished, not
 * that the application is broken. The gap is made *visible* (the Budget
 * Category list says how many Purposes each one has) and is never filled in
 * automatically.
 */

/** A Purpose as the rest of the application reads it. */
export type PurposeRow = Purpose & {
  id: number;
  budgetCategoryId: number;
  partnerCategoryId: number | null;
  active: boolean;
};

const SELECT = {
  id: true,
  purpose_key: true,
  direction: true,
  status: true,
  budget_category_id: true,
  partner_category_id: true,
  budget_category: { select: { category_label: true } },
  partner_category: { select: { category_label: true } },
} as const;

type Row = Prisma.SysPurposeGetPayload<{ select: typeof SELECT }>;

/**
 * What a Purpose is called: `<direction> <Budget Category> <preposition>
 * <Partner Category>`, and nothing else.
 *
 * **Computed rather than stored**, so it cannot disagree with the three fields
 * it describes — renaming a Budget Category renames its Purposes, which a
 * stored copy would not. Uniform by construction: there is no field anyone
 * could type a one-off into.
 *
 * Direction reads as Penerimaan / Pengeluaran here as everywhere; the stored
 * `In` / `Out` is never shown (§8).
 */
export function purposeLabel(
  direction: Direction,
  categoryLabel: string,
  partnerCategoryLabel: string | null
): string {
  const preposition = direction === "In" ? "dari" : "ke";
  return partnerCategoryLabel
    ? `${directionText(direction)} ${categoryLabel} ${preposition} ${partnerCategoryLabel}`
    : `${directionText(direction)} ${categoryLabel}`;
}

function toPurpose(r: Row): PurposeRow {
  const direction = r.direction as Direction;
  const partnerCategory = r.partner_category?.category_label ?? null;
  return {
    id: r.id,
    key: r.purpose_key,
    label: purposeLabel(direction, r.budget_category.category_label, partnerCategory),
    direction,
    budgetCategoryId: r.budget_category_id,
    budgetCategory: r.budget_category.category_label,
    partnerCategoryId: r.partner_category_id,
    partnerCategory,
    active: r.status === "Active",
  };
}

const ORDER = [
  { budget_category_id: "asc" },
  { partner_category_id: "asc" },
  { id: "asc" },
] as const;

/**
 * Every Purpose, including retired ones.
 *
 * Unfiltered on purpose: this is what a list or a detail page reads a posted
 * document's key back through, and a document must go on naming its own Purpose
 * after that Purpose has been retired. `availablePurposes` is what a picker
 * reads.
 */
export async function allPurposes(): Promise<PurposeRow[]> {
  const rows = await prisma.sysPurpose.findMany({
    orderBy: [...ORDER],
    select: SELECT,
  });
  return rows.map(toPurpose);
}

/**
 * The Purposes a new document may be raised for.
 *
 * Active, on an active Budget Category, **and still admitted by the
 * classification** — the category must allow that direction, and must admit
 * that Partner Category (or name no Partner, where the Purpose names none).
 *
 * That last check is a **read-side** filter and writes nothing. Retiring a
 * pairing leaves its Purpose row exactly as the maintainer left it; it simply
 * stops being offered, because the Budget approval chain would refuse the
 * classification anyway and the picker should not lead an operator there.
 *
 * `keep` is the Purpose a document already carries. It survives the filter for
 * the same reason a deactivated record stays visible in the picker that already
 * selected it (CLAUDE.md §12): editing a draft must not silently drop a value
 * the user never touched.
 */
export async function availablePurposes(keep?: string | null): Promise<PurposeRow[]> {
  const [rows, classification] = await Promise.all([
    prisma.sysPurpose.findMany({
      where: { status: "Active", budget_category: { status: "Active" } },
      orderBy: [...ORDER],
      select: SELECT,
    }),
    loadClassification(),
  ]);

  const offered = rows.map(toPurpose).filter((p) => {
    const rule = classification.find((r) => r.id === p.budgetCategoryId);
    if (!rule || !rule.active) return false;
    if (p.direction === "In" ? !rule.allowsIn : !rule.allowsOut) return false;
    return p.partnerCategory === null
      ? !rule.requirePartner
      : rule.partnerCategories.includes(p.partnerCategory);
  });

  if (!keep || offered.some((p) => p.key === keep)) return offered;
  const kept = await purposeByKey(keep);
  return kept ? [...offered, kept] : offered;
}

export async function purposeByKey(key: string | null | undefined): Promise<PurposeRow | null> {
  if (!key) return null;
  const row = await prisma.sysPurpose.findUnique({ where: { purpose_key: key }, select: SELECT });
  return row ? toPurpose(row) : null;
}

/** How many Purposes each Budget Category holds, keyed by category id. */
export async function purposeCountByCategory(): Promise<Map<number, number>> {
  const groups = await prisma.sysPurpose.groupBy({
    by: ["budget_category_id"],
    where: { status: "Active" },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.budget_category_id, g._count._all]));
}
