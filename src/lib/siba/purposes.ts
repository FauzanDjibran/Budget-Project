import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { type Direction, directionText } from "./classification";
import type { Purpose } from "./rules";

/**
 * Transaction Purposes, read from and kept in step with the classification.
 *
 * A Purpose is exactly one Budget Category x one Partner Category x one
 * direction. The 22 that used to be constants were *precisely* the cross
 * product of the categories, their admitted Partner Categories and their
 * directions — so the set is derived rather than authored, and a Budget
 * Category created through the GUI gets its Purposes the moment it is saved.
 * That is the whole point: without it a new category could be planned, mapped
 * and given a book, and still never reach a Cash Bank Transaction.
 *
 * What a person edits is the **label**, and only the label. "Penerimaan
 * Pinjaman dari Cabang" is a Hutang receipt: the sentence names the business
 * event, where a template can only name the classification. So the generator
 * writes a serviceable default and never touches it again.
 */

/** A Purpose as the rest of the application reads it. */
export type PurposeRow = Purpose & {
  id: number;
  budgetCategoryId: number;
  partnerCategoryId: number | null;
  active: boolean;
};

type Db = typeof prisma | Prisma.TransactionClient;

const SELECT = {
  id: true,
  purpose_key: true,
  label: true,
  direction: true,
  status: true,
  budget_category_id: true,
  partner_category_id: true,
  budget_category: { select: { category_label: true } },
  partner_category: { select: { category_label: true } },
} as const;

type Row = Prisma.SysPurposeGetPayload<{ select: typeof SELECT }>;

function toPurpose(r: Row): PurposeRow {
  return {
    id: r.id,
    key: r.purpose_key,
    label: r.label,
    direction: r.direction as Direction,
    budgetCategoryId: r.budget_category_id,
    budgetCategory: r.budget_category.category_label,
    partnerCategoryId: r.partner_category_id,
    partnerCategory: r.partner_category?.category_label ?? null,
    active: r.status === "Active",
  };
}

/**
 * Every Purpose, including retired ones.
 *
 * Unfiltered because this is what a list or a detail page reads a posted
 * document's key back through: a document must go on naming its own Purpose
 * after that Purpose has been withdrawn. `availablePurposes` is what a picker
 * reads.
 */
export async function allPurposes(): Promise<PurposeRow[]> {
  const rows = await prisma.sysPurpose.findMany({
    orderBy: [{ budget_category_id: "asc" }, { partner_category_id: "asc" }, { id: "asc" }],
    select: SELECT,
  });
  return rows.map(toPurpose);
}

/**
 * The Purposes a new document may be raised for.
 *
 * Active, and belonging to a Budget Category that is itself active. A retired
 * classification withdraws its Purposes with it, so the form cannot offer one
 * the approval chain would then refuse.
 */
export async function availablePurposes(keep?: string | null): Promise<PurposeRow[]> {
  const rows = await prisma.sysPurpose.findMany({
    where: {
      OR: [
        { status: "Active", budget_category: { status: "Active" } },
        ...(keep ? [{ purpose_key: keep }] : []),
      ],
    },
    orderBy: [{ budget_category_id: "asc" }, { partner_category_id: "asc" }, { id: "asc" }],
    select: SELECT,
  });
  return rows.map(toPurpose);
}

export async function purposeByKey(key: string | null | undefined): Promise<PurposeRow | null> {
  if (!key) return null;
  const row = await prisma.sysPurpose.findUnique({ where: { purpose_key: key }, select: SELECT });
  return row ? toPurpose(row) : null;
}

/**
 * The label the generator writes for a combination nobody has named yet.
 *
 * Deliberately plain. The hand-written 22 say "Pembayaran Hutang ke Cabang"
 * and "Pemberian Advance kepada Karyawan" — verbs and nouns that belong to the
 * business event rather than to the classification, and no template produces
 * them. This says what the movement *is* so the Purpose is usable immediately,
 * and leaves the wording to whoever knows it.
 */
export function defaultPurposeLabel(
  direction: Direction,
  categoryLabel: string,
  partnerCategoryLabel: string | null
): string {
  const verb = directionText(direction);
  const preposition = direction === "In" ? "dari" : "ke";
  return partnerCategoryLabel
    ? `${verb} ${categoryLabel} ${preposition} ${partnerCategoryLabel}`
    : `${verb} ${categoryLabel}`;
}

/**
 * Brings the Purpose rows up to what the classification implies.
 *
 * For every active Budget Category: one Purpose per admitted Partner Category
 * per allowed direction, or — where the category names no Partner — one per
 * direction. Idempotent, and **additive only**:
 *
 *   - a combination with no row gets one, Active;
 *   - a combination whose row exists is left **entirely** alone, including its
 *     label, because that label is the one thing a person edits here;
 *   - a row whose combination is no longer implied is **not deleted**. It is
 *     deactivated, so every document already posted against it still resolves.
 *     Nothing in this application deletes a record that history points at.
 *
 * Called from the seed and from every write that can change the matrix — a
 * Budget Category saved, a Partner Category pairing added or retired.
 */
export async function syncPurposes(
  db: Db,
  actorId: number
): Promise<{ created: number; retired: number; restored: number }> {
  const categories = await db.sysBudgetCategory.findMany({
    where: { status: "Active" },
    orderBy: { id: "asc" },
    select: {
      id: true,
      category_label: true,
      allows_in: true,
      allows_out: true,
      require_partner: true,
      partner_categories: {
        where: { status: "Active", partner_category: { status: "Active" } },
        orderBy: { partner_category_id: "asc" },
        select: {
          partner_category_id: true,
          partner_category: { select: { category_label: true } },
        },
      },
    },
  });

  // Every combination the classification currently implies.
  const wanted = new Map<
    string,
    { categoryId: number; categoryLabel: string; partnerCategoryId: number | null; partnerCategoryLabel: string | null; direction: Direction }
  >();
  for (const c of categories) {
    const directions: Direction[] = [];
    if (c.allows_in) directions.push("In");
    if (c.allows_out) directions.push("Out");

    const partners: { id: number | null; label: string | null }[] = c.require_partner
      ? c.partner_categories.map((m) => ({
          id: m.partner_category_id,
          label: m.partner_category.category_label,
        }))
      : [{ id: null, label: null }];

    for (const direction of directions) {
      for (const partner of partners) {
        wanted.set(`${c.id}|${partner.id ?? ""}|${direction}`, {
          categoryId: c.id,
          categoryLabel: c.category_label,
          partnerCategoryId: partner.id,
          partnerCategoryLabel: partner.label,
          direction,
        });
      }
    }
  }

  const existing = await db.sysPurpose.findMany({
    select: {
      id: true,
      purpose_key: true,
      budget_category_id: true,
      partner_category_id: true,
      direction: true,
      status: true,
    },
  });
  const byCombination = new Map(
    existing.map((r) => [
      `${r.budget_category_id}|${r.partner_category_id ?? ""}|${r.direction}`,
      r,
    ])
  );

  let created = 0;
  let retired = 0;
  let restored = 0;

  // The generated key continues the system-code convention (§9). The original
  // 22 keep their mnemonics, which is why the sequence starts past whatever is
  // already there rather than at the row count.
  let sequence = existing.length;
  const nextKey = () => {
    sequence += 1;
    return `purp.${String(sequence).padStart(4, "0")}`;
  };

  for (const [combination, want] of wanted) {
    const row = byCombination.get(combination);
    if (row) {
      // A combination that has come back — a pairing reactivated — reopens the
      // Purpose that was retired with it, rather than creating a second one.
      if (row.status !== "Active") {
        await db.sysPurpose.update({
          where: { id: row.id },
          data: { status: "Active", updated_by: actorId },
        });
        restored += 1;
      }
      continue;
    }

    let key = nextKey();
    while (existing.some((r) => r.purpose_key === key)) key = nextKey();

    await db.sysPurpose.create({
      data: {
        purpose_key: key,
        budget_category_id: want.categoryId,
        partner_category_id: want.partnerCategoryId,
        direction: want.direction,
        label: defaultPurposeLabel(
          want.direction,
          want.categoryLabel,
          want.partnerCategoryLabel
        ),
        created_by: actorId,
      },
    });
    created += 1;
  }

  for (const [combination, row] of byCombination) {
    if (wanted.has(combination) || row.status !== "Active") continue;
    await db.sysPurpose.update({
      where: { id: row.id },
      data: { status: "Inactive", updated_by: actorId },
    });
    retired += 1;
  }

  return { created, retired, restored };
}
