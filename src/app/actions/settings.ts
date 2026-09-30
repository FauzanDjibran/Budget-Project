"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { isSystemDefaultKey, type SystemDefaultKey } from "@/lib/siba/system-defaults";
import {
  checkSystemDefaultValue,
  writeSystemDefaults,
} from "@/lib/siba/system-settings";

/**
 * The System Defaults' one write path.
 *
 * A default only fills a control in — it decides nothing — so the checking here
 * is deliberately light: the permission, that the keys are ones the catalogue
 * declares, and that a `ref` value names a record the forms it prefills would
 * accept. What a value is allowed to be is still decided where it matters, by
 * the Server Action that saves the record the default was prefilled into.
 *
 * A key outside this catalogue — a Mapping Account System key included — is
 * not a setting and is dropped: the accounts posting engines post to have
 * their own action and their own permission (`saveSystemAccounts`).
 */
export type SettingsResult =
  | { ok: true; changed: number }
  | { ok: false; errors: Record<string, string> };

export async function saveSystemDefaults(
  values: Record<string, string | null>
): Promise<SettingsResult> {
  let actorId: number;
  try {
    const actor = await authorizeAction("SYSTEM_DEFAULT_EDIT");
    actorId = actor.user.id;
  } catch (error) {
    if (isAccessDenied(error)) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }

  const clean: Partial<Record<SystemDefaultKey, string | null>> = {};
  const errors: Record<string, string> = {};

  for (const [key, raw] of Object.entries(values)) {
    if (!isSystemDefaultKey(key)) continue;

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
    const refused = await checkSystemDefaultValue(key, n);
    if (refused) {
      errors[key] = refused;
      continue;
    }
    clean[key] = String(n);
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  const changed = await writeSystemDefaults(clean, actorId);

  for (const key of changed) {
    const row = await prisma.sysSetting.findUnique({
      where: { setting_key: key },
      select: { id: true },
    });
    if (row) {
      await prisma.auditLog.create({
        data: {
          entity_key: "sys_setting",
          row_id: row.id,
          action: "UPDATE",
          event: "update",
          by: actorId,
        },
      });
    }
  }

  // Defaults are read wherever a form is built, so every form is now stale.
  revalidatePath("/settings/system-default");
  revalidatePath("/budget/budget/new");
  revalidatePath("/finance/realisasi-penerimaan/new");
  revalidatePath("/finance/realisasi-pengeluaran/new");
  revalidatePath("/master/cash-bank/new");

  return { ok: true, changed: changed.length };
}
