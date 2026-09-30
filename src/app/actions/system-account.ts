"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { accessibleCompanyIds } from "@/lib/siba/company-access";
import { syncControlAccounts } from "@/lib/siba/records";
import { isSystemAccountKey, type SystemAccountKey } from "@/lib/siba/system-accounts";
import {
  checkSystemAccountValue,
  systemAccountIds,
  writeSystemAccounts,
} from "@/lib/siba/system-account-data";

/**
 * Mapping Account System's one write path — one Company at a time.
 *
 * These decide where a posting lands, so every value is checked as it is
 * stored: the Company's own account, postable, active, a leaf, and for a note
 * not one a book reconciles against. A key outside the catalogue — a System
 * Default key included — is dropped, and a Company the caller may not read is
 * refused outright.
 */
export type SystemAccountResult =
  | { ok: true; changed: number }
  | { ok: false; errors: Record<string, string> };

export async function saveSystemAccounts(
  companyId: number,
  values: Record<string, number | string | null>
): Promise<SystemAccountResult> {
  let actorId: number;
  try {
    const actor = await authorizeAction("SYSTEM_ACCOUNT_EDIT");
    actorId = actor.user.id;
    if (!(await accessibleCompanyIds(actor.permissions)).includes(companyId)) {
      return { ok: false, errors: { _form: "Company tidak dapat diakses." } };
    }
  } catch (error) {
    if (isAccessDenied(error)) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }

  const clean: Partial<Record<SystemAccountKey, number | null>> = {};
  const errors: Record<string, string> = {};
  const named: number[] = [];

  for (const [key, raw] of Object.entries(values)) {
    if (!isSystemAccountKey(key)) continue;
    const value = raw == null ? "" : String(raw).trim();
    if (value === "") {
      clean[key] = null;
      continue;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      errors[key] = "Pilihan tidak dikenali.";
      continue;
    }
    const refused = await checkSystemAccountValue(companyId, key, n);
    if (refused) {
      errors[key] = refused;
      continue;
    }
    clean[key] = n;
    named.push(n);
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  // The accounts named a moment ago: a key repointed at another account has
  // to release the one it left behind, and once the write has run nothing
  // remembers it.
  const before = await systemAccountIds();
  const changed = await writeSystemAccounts(companyId, clean, actorId);

  // An account a posting engine owns is a control account for as long as an
  // entry names it, and stops being one when none does (CLAUDE.md §10 rule 79).
  if (changed.length) {
    const after = await systemAccountIds();
    const touched = new Set([...before, ...after, ...named]);
    await syncControlAccounts(touched, after, actorId);
  }

  for (const { rowId } of changed) {
    await prisma.auditLog.create({
      data: {
        entity_key: "acc_system_account",
        row_id: rowId,
        action: "UPDATE",
        event: "update",
        by: actorId,
      },
    });
  }

  revalidatePath("/accounting/system-account");
  revalidatePath("/dashboard");

  return { ok: true, changed: changed.length };
}
