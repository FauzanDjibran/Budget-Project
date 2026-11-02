"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { MAPPED_ENTRY_TYPES, type MappedEntryType } from "@/lib/siba/cashflow-catalogue";
import { writeCashflowMapping } from "@/lib/siba/cashflow-mapping";

/**
 * Mapping Cash Flow's one write path. Keys are `category:<id>` and
 * `type:<entry type>`; anything else is dropped. A change reaches later
 * postings only — every Cash Bank Book entry keeps the group it was posted under.
 */
export type CashflowMappingResult =
  | { ok: true; changed: number }
  | { ok: false; errors: Record<string, string> };

export async function saveCashflowMapping(
  values: Record<string, number | string | null>
): Promise<CashflowMappingResult> {
  let actorId: number;
  try {
    actorId = (await authorizeAction("CASHFLOW_MAPPING_EDIT")).user.id;
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, errors: { _form: error.message } };
    throw error;
  }

  const categories = new Map<number, number>();
  const types = new Map<MappedEntryType, number>();
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(values)) {
    if (raw == null || String(raw).trim() === "") continue;
    const group = Number(raw);
    if (!Number.isInteger(group) || group <= 0) {
      errors[key] = "Pilihan tidak dikenali.";
      continue;
    }
    const [kind, subject] = key.split(":");
    if (kind === "category" && Number.isInteger(Number(subject))) categories.set(Number(subject), group);
    else if (kind === "type" && MAPPED_ENTRY_TYPES.some((t) => t.type === subject)) {
      types.set(subject as MappedEntryType, group);
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const written = await writeCashflowMapping({ categories, types }, actorId);
  if (!written.ok) return written;

  for (const rowId of written.changed) {
    await prisma.auditLog.create({
      data: { entity_key: "acc_cashflow_mapping", row_id: rowId, action: "UPDATE", event: "update", by: actorId },
    });
  }
  revalidatePath("/accounting/cashflow-mapping");
  return { ok: true, changed: written.changed.length };
}
