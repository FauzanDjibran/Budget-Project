import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { MAPPED_ENTRY_TYPES, entryTypeLabel } from "./cashflow-catalogue";

/**
 * Mapping Cash Flow — which cash-flow group a Budget Category, or an entry type
 * carrying none, falls in. Owns `acc_cashflow_mapping`; the registry pages edit
 * it like Mapping Budget ke Account. Read when the Laporan Arus Kas is built
 * and never copied onto a ledger entry, so a changed mapping restates every
 * period — the way an account takes its Laba Rugi step from its category.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** Every mapping, by category and by entry type, for the report. */
export async function cashflowMappings(db: Db = prisma) {
  const rows = await db.accCashflowMapping.findMany({
    select: { budget_category_id: true, entry_type: true, cashflow_group_id: true },
  });
  return {
    byCategory: new Map(
      rows.filter((r) => r.budget_category_id != null).map((r) => [r.budget_category_id!, r.cashflow_group_id])
    ),
    byType: new Map(rows.filter((r) => r.entry_type != null).map((r) => [r.entry_type as string, r.cashflow_group_id])),
  };
}

/**
 * The registry form's own rule: a row maps exactly one Budget Category or one
 * of the four entry types, and each of those is mapped once. The CHECK and the
 * unique indexes are the backstop under it.
 */
export async function checkCashflowMapping(
  values: { budget_category_id?: unknown; entry_type?: unknown },
  currentId: number | null
): Promise<Record<string, string>> {
  const category = values.budget_category_id ? Number(values.budget_category_id) : null;
  const type = values.entry_type ? String(values.entry_type) : null;
  if ((category == null) === (type == null)) {
    const message = "Isi Budget Category atau Jenis Entri — salah satu saja.";
    return { budget_category_id: message, entry_type: message };
  }
  if (type && !MAPPED_ENTRY_TYPES.some((t) => t.type === type)) return { entry_type: "Pilihan tidak dikenali." };
  const taken = await prisma.accCashflowMapping.findFirst({
    where: {
      ...(category != null ? { budget_category_id: category } : { entry_type: type as never }),
      ...(currentId ? { NOT: { id: currentId } } : {}),
    },
    select: { mapping_code: true },
  });
  if (!taken) return {};
  return category != null
    ? { budget_category_id: `Budget Category ini sudah dipetakan (${taken.mapping_code}).` }
    : { entry_type: `${entryTypeLabel(type!)} sudah dipetakan (${taken.mapping_code}).` };
}

/** What a group is mapped from — category labels and entry-type names — for a refusal. */
export async function subjectsMappedTo(groupId: number, db: Db = prisma): Promise<string[]> {
  const rows = await db.accCashflowMapping.findMany({
    where: { cashflow_group_id: groupId },
    select: { entry_type: true, budget_category: { select: { category_label: true } } },
  });
  return rows.map((r) => r.budget_category?.category_label ?? entryTypeLabel(r.entry_type ?? ""));
}
