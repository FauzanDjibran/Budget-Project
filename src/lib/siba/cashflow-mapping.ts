import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { MAPPED_ENTRY_TYPES, entryTypeLabel, type MappedEntryType } from "./cashflow-catalogue";

/**
 * Mapping Cash Flow — which cash-flow group a Budget Category, or an entry type
 * carrying none, falls in. Owns `acc_cashflow_mapping`. Read at Post and handed
 * to the Cash Bank Book as a value, so the book never imports this module and
 * a change to the mapping reaches later postings only.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * A posting refused because what it writes has no group yet. Thrown from inside
 * a posting transaction, like the books' own refusals, and turned back into the
 * ordinary error shape by each posting path.
 */
export class CashflowUnmapped extends Error {
  constructor(subject: string) {
    super(`${subject} belum dipetakan ke kelompok arus kas. Atur di Accounting › Mapping Cash Flow.`);
    this.name = "CashflowUnmapped";
  }
}

/** The group of each category that has one; an unmapped category is absent. */
export async function categoryGroups(categoryIds: number[], db: Db = prisma): Promise<Map<number, number>> {
  if (!categoryIds.length) return new Map();
  const rows = await db.accCashflowMapping.findMany({
    where: { budget_category_id: { in: categoryIds } },
    select: { budget_category_id: true, cashflow_group_id: true },
  });
  return new Map(rows.map((r) => [r.budget_category_id!, r.cashflow_group_id]));
}

/** The group a category falls in, or a `CashflowUnmapped` naming it. */
export async function groupForCategory(categoryId: number, db: Db = prisma): Promise<number> {
  const group = (await categoryGroups([categoryId], db)).get(categoryId);
  if (group != null) return group;
  const category = await db.sysBudgetCategory.findUnique({
    where: { id: categoryId },
    select: { category_label: true },
  });
  throw new CashflowUnmapped(`Budget Category ${category?.category_label ?? categoryId}`);
}

/** The group one of the four mapped entry types falls in, or a `CashflowUnmapped`. */
export async function groupForEntryType(type: MappedEntryType, db: Db = prisma): Promise<number> {
  const row = await db.accCashflowMapping.findUnique({
    where: { entry_type: type },
    select: { cashflow_group_id: true },
  });
  if (row) return row.cashflow_group_id;
  throw new CashflowUnmapped(entryTypeLabel(type));
}

/** Names of the given categories that have no group, for a refusal. */
export async function unmappedCategoryLabels(categoryIds: number[], db: Db = prisma): Promise<string[]> {
  const mapped = await categoryGroups(categoryIds, db);
  const missing = categoryIds.filter((id) => !mapped.has(id));
  if (!missing.length) return [];
  const rows = await db.sysBudgetCategory.findMany({
    where: { id: { in: missing } },
    select: { category_label: true },
  });
  return rows.map((r) => r.category_label);
}

/** What a group is mapped from — category labels and entry-type names — for a refusal. */
export async function subjectsMappedTo(groupId: number, db: Db = prisma): Promise<string[]> {
  const rows = await db.accCashflowMapping.findMany({
    where: { cashflow_group_id: groupId },
    select: { entry_type: true, budget_category: { select: { category_label: true } } },
  });
  return rows.map((r) => r.budget_category?.category_label ?? entryTypeLabel(r.entry_type ?? ""));
}

export type CashflowMappingView = {
  groups: { id: number; label: string; name: string; active: boolean }[];
  /** Every active Budget Category, and an inactive one only while it is mapped. */
  categories: { id: number; label: string; name: string; groupId: number | null }[];
  types: { type: MappedEntryType; groupId: number | null }[];
};

/** What Mapping Cash Flow shows: every category and mapped entry type, with its group. */
export async function cashflowMappingView(): Promise<CashflowMappingView> {
  const [groups, categories, rows] = await Promise.all([
    prisma.sysCashflowGroup.findMany({ orderBy: [{ sort_order: "asc" }, { id: "asc" }] }),
    prisma.sysBudgetCategory.findMany({ orderBy: { id: "asc" } }),
    prisma.accCashflowMapping.findMany(),
  ]);
  const byCategory = new Map(rows.filter((r) => r.budget_category_id != null).map((r) => [r.budget_category_id!, r.cashflow_group_id]));
  const byType = new Map(rows.filter((r) => r.entry_type != null).map((r) => [r.entry_type!, r.cashflow_group_id]));
  return {
    groups: groups.map((g) => ({ id: g.id, label: g.group_label, name: g.group_name, active: g.status === "Active" })),
    categories: categories
      .filter((c) => c.status === "Active" || byCategory.has(c.id))
      .map((c) => ({ id: c.id, label: c.category_label, name: c.category_name, groupId: byCategory.get(c.id) ?? null })),
    types: MAPPED_ENTRY_TYPES.map((t) => ({ type: t.type, groupId: byType.get(t.type) ?? null })),
  };
}

/**
 * Writes the mapping, one row per category or entry type, creating or
 * re-pointing it. Only an active group may be chosen; a key outside the
 * catalogue is the caller's to drop. Returns the rows that changed, for audit.
 */
export async function writeCashflowMapping(
  input: { categories: Map<number, number>; types: Map<MappedEntryType, number> },
  actorId: number
): Promise<{ ok: true; changed: number[] } | { ok: false; errors: Record<string, string> }> {
  const active = new Set(
    (await prisma.sysCashflowGroup.findMany({ where: { status: "Active" }, select: { id: true } })).map((g) => g.id)
  );
  const errors: Record<string, string> = {};
  for (const [id, group] of input.categories) if (!active.has(group)) errors[`category:${id}`] = "Kelompok tidak aktif.";
  for (const [type, group] of input.types) if (!active.has(group)) errors[`type:${type}`] = "Kelompok tidak aktif.";
  if (Object.keys(errors).length) return { ok: false, errors };

  const changed: number[] = [];
  await prisma.$transaction(async (tx) => {
    const write = async (key: { budget_category_id: number } | { entry_type: MappedEntryType }, group: number) => {
      const existing = await tx.accCashflowMapping.findFirst({ where: key });
      if (existing?.cashflow_group_id === group) return;
      const row = existing
        ? await tx.accCashflowMapping.update({
            where: { id: existing.id },
            data: { cashflow_group_id: group, updated_by: actorId },
          })
        : await tx.accCashflowMapping.create({
            data: {
              ...key,
              mapping_code: `cfm.${String((await tx.accCashflowMapping.count()) + 1).padStart(4, "0")}`,
              cashflow_group_id: group,
              created_by: actorId,
            },
          });
      changed.push(row.id);
    };
    for (const [id, group] of input.categories) await write({ budget_category_id: id }, group);
    for (const [type, group] of input.types) await write({ entry_type: type }, group);
  });
  return { ok: true, changed };
}
