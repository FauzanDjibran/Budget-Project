/**
 * The System Default catalogue — every value the application prefills or
 * assumes when the user has not said otherwise.
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
 * Client-safe on purpose — no `server-only`, no database import: the settings
 * form reads the same catalogue the Server Action writes against.
 */
import type { IconName } from "@/components/icon";

export type SystemDefaultKey = "default_currency";

export type SystemDefaultDef = {
  key: SystemDefaultKey;
  /** Indonesian label shown on the settings page. */
  name: string;
  help: string;
  icon: IconName;
  /** A `ref` setting stores the referenced row's id as text. */
  type: "ref";
  /** Registry entity key the value points at. */
  ref: string;
};

export const SYSTEM_DEFAULTS = [
  {
    key: "default_currency",
    name: "Currency Default",
    icon: "coin",
    type: "ref",
    ref: "ref_currency",
    help:
      "Currency yang terisi lebih dulu setiap kali ada pilihan Currency — " +
      "pada Budget baru dan pendaftaran Cash & Bank. Pengguna tetap dapat " +
      "menggantinya. Tidak diisi berarti pilihan dimulai kosong.",
  },
] as const satisfies readonly SystemDefaultDef[];

/** What each key is set to; a key that has never been set reads as null. */
export type SystemDefaultValues = Record<SystemDefaultKey, string | null>;

export const EMPTY_SYSTEM_DEFAULTS: SystemDefaultValues = {
  default_currency: null,
};

export function isSystemDefaultKey(key: string): key is SystemDefaultKey {
  return SYSTEM_DEFAULTS.some((d) => d.key === key);
}

/** A ref setting's value as a row id, or null when unset or unparseable. */
export function refValueOf(
  values: SystemDefaultValues,
  key: SystemDefaultKey
): number | null {
  const raw = values[key];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
