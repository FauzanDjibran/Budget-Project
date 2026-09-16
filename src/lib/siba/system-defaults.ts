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
 * **The intercompany bridge settings are the one group that behaves
 * differently**, and deliberately so: they do not prefill a control, they name
 * the account each Company records its position against the other in. Nothing
 * guesses them, and a Funding Request cannot be confirmed until they are set —
 * a refusal that names what is missing, never a silent fallback. They are still
 * settings rather than a table because there are exactly two permanent
 * Companies (CLAUDE.md §12) and a "company relationship" table is precisely
 * what §14 forbids.
 *
 * Client-safe on purpose — no `server-only`, no database import: the settings
 * form reads the same catalogue the Server Action writes against.
 */
import type { IconName } from "@/components/icon";

export type SystemDefaultKey =
  | "default_currency"
  | "induk_bridge_ar_account"
  | "induk_bridge_ap_account"
  | "anak_bridge_ar_account"
  | "anak_bridge_ap_account"
  | "induk_fx_account"
  | "anak_fx_account";

/** Which master a `ref` setting points at — a registry entity key. */
export type SystemDefaultRef = "ref_currency" | "acc_account";

export type SystemDefaultGroupKey =
  | "application"
  | "bridge_induk"
  | "bridge_anak"
  | "fx";

export type SystemDefaultGroup = {
  key: SystemDefaultGroupKey;
  name: string;
  desc: string;
  icon: IconName;
};

/**
 * The cards the settings page is built from.
 *
 * The bridge settings are split by Company rather than listed together,
 * because each Company's pair is a decision taken inside that Company's own
 * chart of accounts — and the page has to say whose accounts a picker is
 * offering before the user picks one.
 */
export const SYSTEM_DEFAULT_GROUPS = [
  {
    key: "application",
    name: "Default Aplikasi",
    desc: "Berlaku untuk seluruh Company dan seluruh pengguna.",
    icon: "gear",
  },
  {
    key: "bridge_induk",
    name: "Bridge Intercompany — Induk",
    desc:
      "Account yang dipakai Company induk untuk mencatat posisinya terhadap " +
      "Company anak saat Funding Request dikonfirmasi.",
    icon: "link",
  },
  {
    key: "bridge_anak",
    name: "Bridge Intercompany — Anak",
    desc:
      "Account yang dipakai Company anak untuk mencatat posisinya terhadap " +
      "Company induk atas dana yang sama.",
    icon: "link",
  },
  {
    key: "fx",
    name: "Selisih Kurs",
    desc:
      "Account tempat selisih kurs dicatat: gap antara nilai kewajiban saat " +
      "diakui dan harga currency yang dipakai melunasinya. Hanya terpakai " +
      "ketika dokumen mata uang asing diposting.",
    icon: "coin",
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
  /**
   * Whose records this may point at. A bridge account belongs to one Company's
   * chart, so the picker offers that Company's records and the Server Action
   * refuses anything else. Absent means the setting is not Company-scoped.
   */
  company?: "induk" | "anak";
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

  // --------------------------------------------------------------- induk
  {
    key: "induk_bridge_ar_account",
    name: "Account Piutang ke Anak",
    icon: "clip",
    type: "ref",
    ref: "acc_account",
    group: "bridge_induk",
    company: "induk",
    help: "saat induk membiayai pengeluaran anak",
  },
  {
    key: "induk_bridge_ap_account",
    name: "Account Hutang kepada Anak",
    icon: "coin",
    type: "ref",
    ref: "acc_account",
    group: "bridge_induk",
    company: "induk",
    help: "saat induk menampung penerimaan anak",
  },

  // ---------------------------------------------------------------- anak
  {
    key: "anak_bridge_ar_account",
    name: "Account Piutang ke Induk",
    icon: "clip",
    type: "ref",
    ref: "acc_account",
    group: "bridge_anak",
    company: "anak",
    help: "saat penerimaan anak ditampung induk",
  },
  {
    key: "anak_bridge_ap_account",
    name: "Account Hutang kepada Induk",
    icon: "coin",
    type: "ref",
    ref: "acc_account",
    group: "bridge_anak",
    company: "anak",
    help: "saat pengeluaran anak dibiayai induk",
  },

  // ------------------------------------------------------------------ fx
  //
  // One account per Company rather than a gain and a loss each. A gain and a
  // loss are the same fact with opposite signs — the same payment produces one
  // or the other depending on which kurs was used — so netting them in one
  // account is what an accountant expects, and the Selisih Kurs analytic on the
  // document lines is where the two are told apart.
  {
    key: "induk_fx_account",
    name: "Account Selisih Kurs — Induk",
    icon: "coin",
    type: "ref",
    ref: "acc_account",
    group: "fx",
    company: "induk",
    help: "hanya terpakai saat dokumen mata uang asing diposting",
  },
  {
    key: "anak_fx_account",
    name: "Account Selisih Kurs — Anak",
    icon: "coin",
    type: "ref",
    ref: "acc_account",
    group: "fx",
    company: "anak",
    help: "hanya terpakai saat dokumen mata uang asing diposting",
  },
] as const satisfies readonly SystemDefaultDef[];

/** What each key is set to; a key that has never been set reads as null. */
export type SystemDefaultValues = Record<SystemDefaultKey, string | null>;

export const EMPTY_SYSTEM_DEFAULTS: SystemDefaultValues = {
  default_currency: null,
  induk_bridge_ar_account: null,
  induk_bridge_ap_account: null,
  anak_bridge_ar_account: null,
  anak_bridge_ap_account: null,
  induk_fx_account: null,
  anak_fx_account: null,
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
  const raw = values[key];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
