import "server-only";

import { prisma } from "@/lib/prisma";
import {
  EMPTY_SYSTEM_DEFAULTS,
  SYSTEM_DEFAULTS,
  isSystemDefaultKey,
  refValueOf,
  systemDefaultDef,
  type SystemDefaultKey,
  type SystemDefaultValues,
} from "./system-defaults";

/**
 * Reading and writing the System Defaults.
 *
 * `sys_setting` is a key/value table whose keys are declared in code, so a row
 * with an unknown key is ignored rather than surfaced: it can only be left over
 * from a setting that no longer exists. A key that has never been set reads as
 * null, which every caller must treat as "no default" — a default that failed
 * to load must leave a control empty, never guess.
 */
export async function systemDefaults(): Promise<SystemDefaultValues> {
  const rows = await prisma.sysSetting.findMany();
  const out: SystemDefaultValues = { ...EMPTY_SYSTEM_DEFAULTS };
  for (const row of rows) {
    if (isSystemDefaultKey(row.setting_key)) {
      out[row.setting_key] = row.setting_value;
    }
  }
  return out;
}

/**
 * Writes the submitted keys, leaving the rest alone.
 *
 * Returns the keys whose value actually changed, which is what the audit entry
 * and the toast describe — saving a form nobody edited should say so rather
 * than claim a change.
 */
export async function writeSystemDefaults(
  values: Partial<Record<SystemDefaultKey, string | null>>,
  actorId: number
): Promise<SystemDefaultKey[]> {
  const current = await systemDefaults();
  const changed: SystemDefaultKey[] = [];

  for (const def of SYSTEM_DEFAULTS) {
    if (!(def.key in values)) continue;
    const next = values[def.key] ?? null;
    if ((current[def.key] ?? null) === next) continue;

    await prisma.sysSetting.upsert({
      where: { setting_key: def.key },
      update: { setting_value: next, updated_by: actorId },
      create: { setting_key: def.key, setting_value: next, updated_by: actorId },
    });
    changed.push(def.key);
  }

  return changed;
}

/**
 * The Currency a new record's Currency picker starts on.
 *
 * Resolved against the master rather than trusted as stored: a currency that
 * has since been deactivated or removed is no longer offered in the picker, so
 * prefilling it would put a value in the form that the form itself rejects.
 */
export async function defaultCurrencyId(): Promise<number | null> {
  const id = refValueOf(await systemDefaults(), "default_currency");
  if (!id) return null;

  const currency = await prisma.refCurrency.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  return currency && currency.status === "Active" ? currency.id : null;
}

// ------------------------------------------------------- intercompany bridge

/**
 * Is this a value the setting may actually hold?
 *
 * The bridge settings are the one group that does more than prefill (see the
 * catalogue's own note), so they are checked when they are *stored* as well as
 * when they are read: an account must be postable, active and belong to the
 * Company whose journal it will appear in. Returns an Indonesian message, or
 * null when the value is fine.
 *
 * This narrows nothing on its own — the picker offers the same set — but the
 * Server Action is reachable directly with any id, which is where it counts.
 */
export async function checkSystemDefaultValue(
  key: SystemDefaultKey,
  id: number
): Promise<string | null> {
  const def = systemDefaultDef(key);
  if (!def.company) return null;

  const company = await prisma.sysCompany.findFirst({
    where: { is_parent: def.company === "induk" },
    select: { id: true, company_label: true },
  });
  if (!company) {
    return `Company ${def.company} belum tersedia pada master Company.`;
  }

  if (def.ref === "acc_account") {
    const account = await prisma.accAccount.findUnique({
      where: { id },
      select: { company_id: true, is_postable: true, is_active: true },
    });
    if (!account) return "Account tidak ditemukan.";
    if (account.company_id !== company.id) {
      return `Account harus milik Company ${company.company_label}.`;
    }
    if (!account.is_postable) return "Account tersebut bukan account postable.";
    if (!account.is_active) return "Account tersebut non-aktif.";
    return null;
  }

  return null;
}

export type IntercompanyBridge = {
  /** Where each Company keeps its claim on the other. */
  arAccountId: number;
  /** Where each Company keeps what it owes the other. */
  apAccountId: number;
};

export type BridgeSetup =
  | { ok: true; induk: IntercompanyBridge; anak: IntercompanyBridge }
  | { ok: false; missing: string[] };

const BRIDGE_KEYS = [
  "induk_bridge_ar_account",
  "induk_bridge_ap_account",
  "anak_bridge_ar_account",
  "anak_bridge_ap_account",
] as const satisfies readonly SystemDefaultKey[];

/**
 * The four settings a Funding Request is confirmed against, resolved together.
 *
 * Resolved against the master exactly as `defaultCurrencyId` is: a setting
 * pointing at an account that has since been deactivated or made non-postable
 * is treated as unset, because posting to it would be posting somewhere the
 * application would no longer let anyone choose. A missing or unusable setting
 * is reported by **name**, so the refusal tells whoever hits it what to go and
 * set rather than that something unspecified is wrong.
 */
export async function intercompanyBridge(): Promise<BridgeSetup> {
  const values = await systemDefaults();
  const missing: string[] = [];
  const resolved: Partial<Record<SystemDefaultKey, number>> = {};

  for (const key of BRIDGE_KEYS) {
    const def = systemDefaultDef(key);
    const id = refValueOf(values, key);
    if (!id) {
      missing.push(def.name);
      continue;
    }
    if (await checkSystemDefaultValue(key, id)) {
      missing.push(def.name);
      continue;
    }
    resolved[key] = id;
  }

  if (missing.length) return { ok: false, missing };

  return {
    ok: true,
    induk: {
      arAccountId: resolved.induk_bridge_ar_account!,
      apAccountId: resolved.induk_bridge_ap_account!,
    },
    anak: {
      arAccountId: resolved.anak_bridge_ar_account!,
      apAccountId: resolved.anak_bridge_ap_account!,
    },
  };
}
