import "server-only";

import { prisma } from "@/lib/prisma";
import { checkAccountIsLeaf, controlAccountReasons } from "./records";
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
 * The System Defaults currently pointing at an account, by name.
 *
 * Read before that account is given a sub-account: becoming a parent revokes
 * its posting privilege, and every account-valued default names somewhere a
 * posting *goes* — the four intercompany bridge accounts and the two FX
 * difference accounts. A setting left pointing at a heading would refuse a
 * funded confirmation or an FX posting later, by name, for a reason nobody
 * would connect to the sub-account they had created.
 */
export async function systemDefaultsUsingAccount(
  accountId: number
): Promise<string[]> {
  const current = await systemDefaults();
  return SYSTEM_DEFAULTS.filter(
    (def) => def.ref === "acc_account" && refValueOf(current, def.key) === accountId
  ).map((def) => def.name);
}

/**
 * Every account a System Default currently names.
 *
 * The third structural source of a control account: the bridge and FX
 * settings decide where a posting lands, and what a posting engine owns a
 * person does not hand-write into. `syncControlAccounts` cannot ask this for
 * itself — `records.ts` may not read `sys_setting` — so the caller resolves it
 * and passes it down.
 */
export async function systemDefaultAccountIds(): Promise<Set<number>> {
  const current = await systemDefaults();
  const ids = new Set<number>();
  for (const def of SYSTEM_DEFAULTS) {
    if (def.ref !== "acc_account") continue;
    const id = refValueOf(current, def.key);
    if (id) ids.add(id);
  }
  return ids;
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
    // A note's counter account must not be one a book already reconciles
    // against: a Debit Note posted against a Piutang account would move the
    // General Ledger with no subject-book entry beside it — exactly the
    // discrepancy the note exists to avoid.
    if (def.group === "dncn") {
      const reasons = await controlAccountReasons(id);
      if (reasons.length) {
        return (
          `Account tersebut direkonsiliasi dengan ${reasons.join(", ")} dan tidak ` +
          "dapat menjadi lawan posting Debit / Credit Note."
        );
      }
    }
    // A parent account is a heading, not a destination — a bridge or FX
    // posting made to one would be money in the chart no leaf accounts for.
    return checkAccountIsLeaf(id);
  }

  return null;
}

const ACCUMULATED_PL_KEYS = [
  "induk_accumulated_pl_account",
  "anak_accumulated_pl_account",
] as const satisfies readonly SystemDefaultKey[];

/**
 * The accumulated-P&L settings that are not usable, by name.
 *
 * Closing a Fiscal Year moves that year's result into each Company's
 * Laba/Rugi Tahun Sebelumnya, so without that account there is nowhere for the
 * closing journal to post and the whole process is refused — the same shape the
 * intercompany bridge takes, and for the same reason: a posting target is never
 * guessed and never falls back.
 *
 * Resolved against the master rather than trusted as stored, exactly as
 * `intercompanyBridge` resolves its four, so a setting pointing at an account
 * that has since been deactivated, made non-postable or given a sub-account
 * reads as unset rather than as ready.
 *
 * The Neraca's two computed-line accounts are deliberately **not** checked
 * here. Nothing posts to either, so closing does not need them — the Neraca
 * does, and `missingNeracaAccounts` asks on its behalf.
 */
export async function missingClosingAccounts(): Promise<string[]> {
  const values = await systemDefaults();
  const missing: string[] = [];

  for (const key of ACCUMULATED_PL_KEYS) {
    const id = refValueOf(values, key);
    if (!id || (await checkSystemDefaultValue(key, id))) {
      missing.push(systemDefaultDef(key).name);
    }
  }

  return missing;
}

/**
 * The Neraca's two computed-line settings that are not usable, by name.
 *
 * Laba/Rugi Tahun Berjalan and Laba/Rugi Tahun Lalu Belum Ditutup are never
 * posted to; the Neraca computes each figure and **places** it on the account
 * the setting names, so the user decides the line's name and position in the
 * chart. Without the account the report has nowhere to put the figure and is
 * not produced — refused by name, like every other account a process needs.
 *
 * Tahun Berjalan is needed by every Neraca. Belum Ditutup is needed only by a
 * Company still carrying an unclosed previous year, so it is asked for only
 * where the caller says so — the same reasoning that resolves the FX account
 * only when a difference arises: a setting blocks only where it is used.
 *
 * Resolved against the master exactly as `missingClosingAccounts` is.
 */
export async function missingNeracaAccounts(
  carryingUnclosedYear: { induk: boolean; anak: boolean }
): Promise<string[]> {
  const values = await systemDefaults();
  const keys: SystemDefaultKey[] = ["induk_current_pl_account", "anak_current_pl_account"];
  if (carryingUnclosedYear.induk) keys.push("induk_unclosed_pl_account");
  if (carryingUnclosedYear.anak) keys.push("anak_unclosed_pl_account");

  const missing: string[] = [];
  for (const key of keys) {
    const id = refValueOf(values, key);
    if (!id || (await checkSystemDefaultValue(key, id))) {
      missing.push(systemDefaultDef(key).name);
    }
  }
  return missing;
}

export type NeracaAccounts =
  | { ok: true; currentId: number; unclosedId: number | null }
  | { ok: false; missing: string[] };

/**
 * Where one Company's Neraca places its computed equity figures, or what is
 * missing, by name.
 *
 * The Neraca is **not produced** without them — the user's rule — so this is
 * the refusal's source as well as the placement's. Belum Ditutup is resolved
 * only when the caller has a figure for it to hold, the same reasoning
 * `missingNeracaAccounts` applies for the dashboard.
 */
export async function neracaAccountsFor(
  isParent: boolean,
  needsUnclosed: boolean
): Promise<NeracaAccounts> {
  const values = await systemDefaults();
  const prefix = isParent ? "induk" : "anak";
  const resolve = async (key: SystemDefaultKey) => {
    const id = refValueOf(values, key);
    if (!id || (await checkSystemDefaultValue(key, id))) return null;
    return id;
  };

  const currentKey: SystemDefaultKey = `${prefix}_current_pl_account`;
  const unclosedKey: SystemDefaultKey = `${prefix}_unclosed_pl_account`;
  const currentId = await resolve(currentKey);
  const unclosedId = needsUnclosed ? await resolve(unclosedKey) : null;

  const missing: string[] = [];
  if (!currentId) missing.push(systemDefaultDef(currentKey).name);
  if (needsUnclosed && !unclosedId) missing.push(systemDefaultDef(unclosedKey).name);
  if (missing.length) return { ok: false, missing };

  return { ok: true, currentId: currentId!, unclosedId };
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

export type ClosingAccount =
  | { ok: true; accountId: number }
  | { ok: false; missing: string };

/**
 * Where one Company's closing journal posts its result, resolved by name.
 *
 * The same shape the intercompany bridge takes, and for the same reason: a
 * posting target is named, never guessed and never fallen back to. Resolved
 * against the master rather than trusted as stored, so a setting pointing at
 * an account that has since been deactivated, made non-postable or given a
 * sub-account reads as unset — posting to it would be posting somewhere the
 * application itself would no longer offer.
 *
 * `missingClosingAccounts` answers the same question for the dashboard, across
 * both Companies at once. This one answers it for the Company actually being
 * closed, which is what a refusal has to be about.
 */
export async function closingAccountFor(
  isParent: boolean
): Promise<ClosingAccount> {
  const key: SystemDefaultKey = isParent
    ? "induk_accumulated_pl_account"
    : "anak_accumulated_pl_account";
  const def = systemDefaultDef(key);

  const id = refValueOf(await systemDefaults(), key);
  if (!id) return { ok: false, missing: def.name };
  if (await checkSystemDefaultValue(key, id)) return { ok: false, missing: def.name };

  return { ok: true, accountId: id };
}
