/**
 * The Mapping Account System catalogue — the accounts a posting engine posts a
 * given role to, per Company.
 *
 * These are not defaults. A default prefills a control somebody can change;
 * these decide where money lands when a document is posted, and nothing
 * guesses them: a process that needs one is refused, **by name**, until it is
 * set. Each belongs to one Company's chart, so the table (`acc_system_account`)
 * holds one row per Company and key, and the screen shows one Company at a
 * time, like the Chart of Accounts it picks from.
 *
 * Every account named here becomes a control account (CLAUDE.md §10 rule 79),
 * so nothing but its posting engine writes into it.
 *
 * Client-safe on purpose — no `server-only`, no database import: the form
 * reads the same catalogue the Server Action writes against.
 */
import type { IconName } from "@/components/icon";

export type SystemAccountKey =
  | "bridge_ar"
  | "bridge_ap"
  | "fx"
  | "accumulated_pl"
  | "current_pl"
  | "debit_note"
  | "credit_note";

export type SystemAccountGroupKey = "bridge" | "fx" | "equity_pl" | "dncn";

export type CompanySide = "induk" | "anak";

export type SystemAccountGroup = {
  key: SystemAccountGroupKey;
  name: string;
  desc: string;
  icon: IconName;
};

export const SYSTEM_ACCOUNT_GROUPS = [
  {
    key: "bridge",
    name: "Bridge Intercompany",
    desc:
      "Account tempat Company ini mencatat posisinya terhadap Company lain saat " +
      "Funding Request dikonfirmasi. Konfirmasi ditolak selama keempatnya, di " +
      "kedua Company, belum diatur.",
    icon: "link",
  },
  {
    key: "fx",
    name: "Selisih Kurs",
    desc:
      "Tempat selisih kurs dicatat. Hanya dibutuhkan ketika dokumen mata uang " +
      "asing diposting dan selisih benar-benar timbul.",
    icon: "coin",
  },
  {
    key: "equity_pl",
    name: "Laba/Rugi pada Ekuitas",
    desc:
      "Tahun Sebelumnya adalah tujuan posting saat Fiscal Year ditutup, dan di " +
      "bawahnya Neraca menampilkan laba rugi tiap tahun yang belum ditutup; " +
      "Tahun Berjalan adalah baris Neraca yang nilainya dihitung, tidak pernah " +
      "diposting.",
    icon: "calc",
  },
  {
    key: "dncn",
    name: "Debit / Credit Note",
    desc:
      "Lawan posting nota. Debit Note selalu mengkredit account-nya, Credit Note " +
      "selalu mendebit account-nya, apa pun buku subjek yang disesuaikan.",
    icon: "pen",
  },
] as const satisfies readonly SystemAccountGroup[];

export type SystemAccountDef = {
  key: SystemAccountKey;
  group: SystemAccountGroupKey;
  icon: IconName;
  /** The Indonesian name, per Company — a bridge account names the other one. */
  name: Record<CompanySide, string>;
  help: string;
};

export const SYSTEM_ACCOUNTS = [
  {
    key: "bridge_ar",
    group: "bridge",
    icon: "clip",
    name: { induk: "Account Piutang ke Anak", anak: "Account Piutang ke Induk" },
    help: "saat Company ini membiayai atau menampung dana Company lain",
  },
  {
    key: "bridge_ap",
    group: "bridge",
    icon: "coin",
    name: { induk: "Account Hutang kepada Anak", anak: "Account Hutang kepada Induk" },
    help: "saat dana Company ini ditampung atau dibiayai Company lain",
  },
  // One account per Company rather than a gain and a loss each: a gain and a
  // loss are the same fact with opposite signs, and the side of the journal
  // line says which (CLAUDE.md §10 rule 107).
  {
    key: "fx",
    group: "fx",
    icon: "coin",
    name: { induk: "Account Selisih Kurs — Induk", anak: "Account Selisih Kurs — Anak" },
    help: "hanya terpakai saat dokumen mata uang asing diposting",
  },
  {
    key: "accumulated_pl",
    group: "equity_pl",
    icon: "hist",
    name: {
      induk: "Account Laba/Rugi Tahun Sebelumnya — Induk",
      anak: "Account Laba/Rugi Tahun Sebelumnya — Anak",
    },
    help: "tujuan posting saat Fiscal Year ditutup",
  },
  {
    key: "current_pl",
    group: "equity_pl",
    icon: "calc",
    name: {
      induk: "Account Laba/Rugi Tahun Berjalan — Induk",
      anak: "Account Laba/Rugi Tahun Berjalan — Anak",
    },
    help: "baris penyajian Neraca, tidak pernah diposting",
  },
  {
    key: "debit_note",
    group: "dncn",
    icon: "pen",
    name: { induk: "Account Debit Note — Induk", anak: "Account Debit Note — Anak" },
    help: "dikredit setiap Debit Note diposting",
  },
  {
    key: "credit_note",
    group: "dncn",
    icon: "pen",
    name: { induk: "Account Credit Note — Induk", anak: "Account Credit Note — Anak" },
    help: "didebit setiap Credit Note diposting",
  },
] as const satisfies readonly SystemAccountDef[];

/** What each key names for one Company; unset reads as null. */
export type SystemAccountValues = Record<SystemAccountKey, number | null>;

export const EMPTY_SYSTEM_ACCOUNTS: SystemAccountValues = {
  bridge_ar: null,
  bridge_ap: null,
  fx: null,
  accumulated_pl: null,
  current_pl: null,
  debit_note: null,
  credit_note: null,
};

export function isSystemAccountKey(key: string): key is SystemAccountKey {
  return SYSTEM_ACCOUNTS.some((d) => d.key === key);
}

export function systemAccountDef(key: SystemAccountKey): SystemAccountDef {
  return SYSTEM_ACCOUNTS.find((d) => d.key === key)!;
}

/** The name a refusal uses, e.g. "Account Selisih Kurs — Induk". */
export function systemAccountName(key: SystemAccountKey, side: CompanySide): string {
  return systemAccountDef(key).name[side];
}

export function systemAccountsIn(
  group: SystemAccountGroupKey
): readonly SystemAccountDef[] {
  return SYSTEM_ACCOUNTS.filter((d) => d.group === group);
}

export const sideOf = (isParent: boolean): CompanySide => (isParent ? "induk" : "anak");
