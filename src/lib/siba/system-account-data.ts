import "server-only";

import { prisma } from "@/lib/prisma";
import { checkAccountIsLeaf, controlAccountReasons } from "./records";
import {
  EMPTY_SYSTEM_ACCOUNTS,
  SYSTEM_ACCOUNTS,
  isSystemAccountKey,
  sideOf,
  systemAccountDef,
  systemAccountName,
  type CompanySide,
  type SystemAccountKey,
  type SystemAccountValues,
} from "./system-accounts";

/**
 * Reading and writing Mapping Account System — `acc_system_account`.
 *
 * One row per Company and key. A row whose key the catalogue no longer
 * declares is ignored, and a key with no row reads as null, which every
 * caller treats as "not set" — a posting target is never guessed.
 */

async function companyOf(side: CompanySide) {
  return prisma.sysCompany.findFirst({
    where: { is_parent: side === "induk" },
    select: { id: true, company_label: true, is_parent: true },
  });
}

/** What every key names for one Company. */
export async function systemAccountsOf(companyId: number): Promise<SystemAccountValues> {
  const rows = await prisma.accSystemAccount.findMany({ where: { company_id: companyId } });
  const out: SystemAccountValues = { ...EMPTY_SYSTEM_ACCOUNTS };
  for (const row of rows) {
    if (isSystemAccountKey(row.account_key)) out[row.account_key] = row.account_id;
  }
  return out;
}

/** The raw id one Company's key names, unchecked; null when unset. */
export async function systemAccountId(
  isParent: boolean,
  key: SystemAccountKey
): Promise<number | null> {
  const company = await companyOf(sideOf(isParent));
  if (!company) return null;
  const row = await prisma.accSystemAccount.findUnique({
    where: { company_id_account_key: { company_id: company.id, account_key: key } },
    select: { account_id: true },
  });
  return row?.account_id ?? null;
}

/**
 * Writes the submitted keys for one Company, leaving the rest alone, and
 * returns the rows whose account actually changed — what the audit entries
 * and the toast describe.
 */
export async function writeSystemAccounts(
  companyId: number,
  values: Partial<Record<SystemAccountKey, number | null>>,
  actorId: number
): Promise<{ key: SystemAccountKey; rowId: number }[]> {
  const current = await systemAccountsOf(companyId);
  const changed: { key: SystemAccountKey; rowId: number }[] = [];

  for (const def of SYSTEM_ACCOUNTS) {
    if (!(def.key in values)) continue;
    const next = values[def.key] ?? null;
    if ((current[def.key] ?? null) === next) continue;

    const row = await prisma.accSystemAccount.upsert({
      where: { company_id_account_key: { company_id: companyId, account_key: def.key } },
      update: { account_id: next, updated_by: actorId },
      create: {
        company_id: companyId,
        account_key: def.key,
        account_id: next,
        updated_by: actorId,
      },
      select: { id: true },
    });
    changed.push({ key: def.key, rowId: row.id });
  }
  return changed;
}

/**
 * Is this an account the key may name for this Company?
 *
 * Checked when it is stored as well as when it is read, because these decide
 * where a posting lands: the account must be the Company's own, postable,
 * active and a leaf. Returns an Indonesian message, or null when fine.
 */
export async function checkSystemAccountValue(
  companyId: number,
  key: SystemAccountKey,
  accountId: number
): Promise<string | null> {
  const company = await prisma.sysCompany.findUnique({
    where: { id: companyId },
    select: { company_label: true },
  });
  if (!company) return "Company tidak ditemukan.";

  const account = await prisma.accAccount.findUnique({
    where: { id: accountId },
    select: { company_id: true, is_postable: true, is_active: true },
  });
  if (!account) return "Account tidak ditemukan.";
  if (account.company_id !== companyId) {
    return `Account harus milik Company ${company.company_label}.`;
  }
  if (!account.is_postable) return "Account tersebut bukan account postable.";
  if (!account.is_active) return "Account tersebut non-aktif.";
  // A note's counter account must not be one a book already reconciles
  // against: a Debit Note posted against a Piutang account would move the
  // General Ledger with no subject-book entry beside it — exactly the
  // discrepancy the note exists to avoid.
  if (systemAccountDef(key).group === "dncn") {
    const reasons = await controlAccountReasons(accountId);
    if (reasons.length) {
      return (
        `Account tersebut direkonsiliasi dengan ${reasons.join(", ")} dan tidak ` +
        "dapat menjadi lawan posting Debit / Credit Note."
      );
    }
  }
  // A parent account is a heading, not a destination.
  return checkAccountIsLeaf(accountId);
}

/**
 * One Company's key, resolved against the master: the id when it is set and
 * still usable, otherwise null. A setting pointing at an account since
 * deactivated or given a sub-account reads as unset rather than as ready.
 */
async function resolved(
  isParent: boolean,
  key: SystemAccountKey
): Promise<number | null> {
  const company = await companyOf(sideOf(isParent));
  if (!company) return null;
  const id = await systemAccountId(isParent, key);
  if (!id) return null;
  return (await checkSystemAccountValue(company.id, key, id)) ? null : id;
}

/**
 * The Mapping Account System entries currently naming an account, by name.
 *
 * Read before that account is given a sub-account: becoming a parent revokes
 * its posting privilege, and every entry names somewhere a posting goes.
 */
export async function systemAccountsUsingAccount(accountId: number): Promise<string[]> {
  const rows = await prisma.accSystemAccount.findMany({
    where: { account_id: accountId },
    select: { account_key: true, company: { select: { is_parent: true } } },
  });
  return rows
    .filter((r) => isSystemAccountKey(r.account_key))
    .map((r) =>
      systemAccountName(r.account_key as SystemAccountKey, sideOf(r.company.is_parent))
    );
}

/**
 * Every account Mapping Account System currently names — the third
 * structural source of a control account. `syncControlAccounts` cannot ask
 * this for itself (`records.ts` may not read this table), so the caller
 * resolves it and passes it down.
 */
export async function systemAccountIds(): Promise<Set<number>> {
  const rows = await prisma.accSystemAccount.findMany({
    where: { account_id: { not: null } },
    select: { account_key: true, account_id: true },
  });
  return new Set(
    rows.filter((r) => isSystemAccountKey(r.account_key)).map((r) => r.account_id!)
  );
}

// ---------------------------------------------------------------- closing

/**
 * The Laba/Rugi Tahun Sebelumnya accounts that are not usable, by name —
 * without one there is nowhere for a Company's closing journal to post.
 */
export async function missingClosingAccounts(): Promise<string[]> {
  const missing: string[] = [];
  for (const isParent of [true, false]) {
    if (!(await resolved(isParent, "accumulated_pl"))) {
      missing.push(systemAccountName("accumulated_pl", sideOf(isParent)));
    }
  }
  return missing;
}

/**
 * The Neraca's accounts that are not usable, by name. Tahun Berjalan is
 * needed by every Neraca; Tahun Sebelumnya only by a Company still carrying an
 * unclosed year, so it is asked for only where the caller says so.
 */
export async function missingNeracaAccounts(
  carryingUnclosedYear: { induk: boolean; anak: boolean }
): Promise<string[]> {
  const asks: [boolean, SystemAccountKey][] = [
    [true, "current_pl"],
    [false, "current_pl"],
  ];
  if (carryingUnclosedYear.induk) asks.push([true, "accumulated_pl"]);
  if (carryingUnclosedYear.anak) asks.push([false, "accumulated_pl"]);

  const missing: string[] = [];
  for (const [isParent, key] of asks) {
    if (!(await resolved(isParent, key))) missing.push(systemAccountName(key, sideOf(isParent)));
  }
  return missing;
}

export type NeracaAccounts =
  | { ok: true; currentId: number; accumulatedId: number | null }
  | { ok: false; missing: string[] };

/** Where one Company's Neraca places its computed equity figures. */
export async function neracaAccountsFor(
  isParent: boolean,
  needsYearLines: boolean
): Promise<NeracaAccounts> {
  const side = sideOf(isParent);
  const currentId = await resolved(isParent, "current_pl");
  const accumulatedId = needsYearLines ? await resolved(isParent, "accumulated_pl") : null;

  const missing: string[] = [];
  if (!currentId) missing.push(systemAccountName("current_pl", side));
  if (needsYearLines && !accumulatedId) missing.push(systemAccountName("accumulated_pl", side));
  if (missing.length) return { ok: false, missing };

  return { ok: true, currentId: currentId!, accumulatedId };
}

export type ClosingAccount =
  | { ok: true; accountId: number }
  | { ok: false; missing: string };

/** Where one Company's closing journal posts its result. */
export async function closingAccountFor(isParent: boolean): Promise<ClosingAccount> {
  const id = await resolved(isParent, "accumulated_pl");
  return id
    ? { ok: true, accountId: id }
    : { ok: false, missing: systemAccountName("accumulated_pl", sideOf(isParent)) };
}

// -------------------------------------------------------- intercompany bridge

export type IntercompanyBridge = {
  /** Where each Company keeps its claim on the other. */
  arAccountId: number;
  /** Where each Company keeps what it owes the other. */
  apAccountId: number;
};

export type BridgeSetup =
  | { ok: true; induk: IntercompanyBridge; anak: IntercompanyBridge }
  | { ok: false; missing: string[] };

/**
 * The four accounts a Funding Request is confirmed against, resolved together
 * and reported by **name** when any is missing or unusable.
 */
export async function intercompanyBridge(): Promise<BridgeSetup> {
  const missing: string[] = [];
  const ids: Record<string, number> = {};

  for (const isParent of [true, false]) {
    for (const key of ["bridge_ar", "bridge_ap"] as const) {
      const id = await resolved(isParent, key);
      if (!id) missing.push(systemAccountName(key, sideOf(isParent)));
      else ids[`${sideOf(isParent)}_${key}`] = id;
    }
  }
  if (missing.length) return { ok: false, missing };

  return {
    ok: true,
    induk: { arAccountId: ids.induk_bridge_ar, apAccountId: ids.induk_bridge_ap },
    anak: { arAccountId: ids.anak_bridge_ar, apAccountId: ids.anak_bridge_ap },
  };
}
