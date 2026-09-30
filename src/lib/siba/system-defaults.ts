/**
 * The System Default catalogue — every value the application prefills when
 * the user has not said otherwise.
 *
 * Declared in code for the same reason the permission catalogue is: a setting
 * is a branch somewhere in the application, so one that could be created at
 * runtime would be a row nothing reads. `sys_setting` holds only what each key
 * is currently set to.
 *
 * A default is a starting point, never a rule. Everything here fills a control
 * in that the user can then change — it must not decide what is valid, which
 * stays with the Server Actions.
 *
 * The accounts a posting engine posts to are **not** here. They decide where
 * money lands rather than prefilling anything, and each belongs to one
 * Company's chart, so they are Mapping Account System — `system-accounts.ts`
 * and their own table, `acc_system_account`.
 *
 * Client-safe on purpose — no `server-only`, no database import: the settings
 * form reads the same catalogue the Server Action writes against.
 */
import type { IconName } from "@/components/icon";

export type SystemDefaultKey =
  | "default_currency"
  | "default_company"
  | "default_realization_cash_bank";

/** Which master a `ref` setting points at — a registry entity key. */
export type SystemDefaultRef = "ref_currency" | "sys_company" | "m_cash_bank";

export type SystemDefaultGroupKey = "application" | "realization";

export type SystemDefaultGroup = {
  key: SystemDefaultGroupKey;
  name: string;
  desc: string;
  icon: IconName;
};

export const SYSTEM_DEFAULT_GROUPS = [
  {
    key: "application",
    name: "Default Aplikasi",
    desc: "Berlaku untuk seluruh Company dan seluruh pengguna.",
    icon: "gear",
  },
  {
    key: "realization",
    name: "Default Realisasi Budget",
    desc:
      "Isian awal dokumen Realisasi Penerimaan dan Pengeluaran. Currency dokumen " +
      "baru selalu dimulai dari base currency.",
    icon: "wallet2",
  },
] as const satisfies readonly SystemDefaultGroup[];

export type SystemDefaultDef = {
  key: SystemDefaultKey;
  /** Indonesian label shown on the settings page. */
  name: string;
  help: string;
  icon: IconName;
  /** A `ref` setting stores the referenced row's id as text. */
  type: "ref";
  /** Registry entity key the value points at. */
  ref: SystemDefaultRef;
  group: SystemDefaultGroupKey;
};

export const SYSTEM_DEFAULTS = [
  {
    key: "default_currency",
    name: "Currency Default",
    icon: "coin",
    type: "ref",
    ref: "ref_currency",
    group: "application",
    help: "mengisi pilihan Currency lebih dulu",
  },
  {
    key: "default_company",
    name: "Company Default",
    icon: "build",
    type: "ref",
    ref: "sys_company",
    group: "application",
    help: "mengisi Company pada Budget dan Realisasi baru",
  },
  // Only a base-currency resource: a new Realisasi starts in the base
  // currency, and a base-currency document is settled from a base-currency
  // resource alone (CLAUDE.md §10 rule 67) — anything else would prefill a
  // pair the form itself refuses.
  {
    key: "default_realization_cash_bank",
    name: "Cash & Bank Default",
    icon: "wallet2",
    type: "ref",
    ref: "m_cash_bank",
    group: "realization",
    help: "hanya resource base currency yang aktif",
  },
] as const satisfies readonly SystemDefaultDef[];

/** What each key is set to; a key that has never been set reads as null. */
export type SystemDefaultValues = Record<SystemDefaultKey, string | null>;

export const EMPTY_SYSTEM_DEFAULTS: SystemDefaultValues = {
  default_currency: null,
  default_company: null,
  default_realization_cash_bank: null,
};

export function isSystemDefaultKey(key: string): key is SystemDefaultKey {
  return SYSTEM_DEFAULTS.some((d) => d.key === key);
}

export function systemDefaultDef(key: SystemDefaultKey): SystemDefaultDef {
  return SYSTEM_DEFAULTS.find((d) => d.key === key)!;
}

/** The settings belonging to one card, in catalogue order. */
export function systemDefaultsIn(
  group: SystemDefaultGroupKey
): readonly SystemDefaultDef[] {
  return SYSTEM_DEFAULTS.filter((d) => d.group === group);
}

/** A ref setting's value as a row id, or null when unset or unparseable. */
export function refValueOf(
  values: SystemDefaultValues,
  key: SystemDefaultKey
): number | null {
  return idOf(values[key]);
}

/** A stored id as a row id, or null when unset or unparseable. */
export function idOf(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
