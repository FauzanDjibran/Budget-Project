import "server-only";

import { prisma } from "@/lib/prisma";
import { BASE_CURRENCY_LABEL } from "./currency";
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
 * Reading and writing the System Defaults — `sys_setting`.
 *
 * A key/value table whose keys are declared in code, so a row with an unknown
 * key is ignored rather than surfaced: it can only be left over from a setting
 * that no longer exists. A key that has never been set reads as null, which
 * every caller must treat as "no default" — a default that failed to load must
 * leave a control empty, never guess.
 *
 * The accounts posting engines post to are Mapping Account System, in
 * `system-account-data.ts`, not here.
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
 * Writes the submitted keys, leaving the rest alone, and returns the keys
 * whose value actually changed — saving a form nobody edited should say so
 * rather than claim a change.
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
 * Is this a value the setting may hold? Checked when stored, so the page
 * cannot save what the forms it prefills would refuse. Returns an Indonesian
 * message, or null when the value is fine. An inactive record is refused here
 * but tolerated when read — it simply prefills nothing.
 */
export async function checkSystemDefaultValue(
  key: SystemDefaultKey,
  id: number
): Promise<string | null> {
  const def = systemDefaultDef(key);

  if (def.ref === "ref_currency") {
    const currency = await prisma.refCurrency.findUnique({ where: { id }, select: { id: true } });
    return currency ? null : "Currency tidak ditemukan.";
  }

  if (def.ref === "sys_company") {
    const company = await prisma.sysCompany.findUnique({ where: { id }, select: { id: true } });
    return company ? null : "Company tidak ditemukan.";
  }

  const resource = await prisma.mCashBank.findUnique({
    where: { id },
    select: { status: true, currency: { select: { currency_label: true } } },
  });
  if (!resource) return "Cash & Bank tidak ditemukan.";
  if (resource.status !== "Active") return "Cash & Bank tersebut non-aktif.";
  if (resource.currency.currency_label !== BASE_CURRENCY_LABEL) {
    return `Cash & Bank default harus ber-currency ${BASE_CURRENCY_LABEL}, currency dokumen Realisasi baru.`;
  }
  return null;
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

/**
 * The Company a new Budget or Realisasi starts on — only when the reader may
 * write for it, so the form never opens on a Company it would refuse.
 */
export async function defaultCompanyId(allowed: number[]): Promise<number | null> {
  const id = refValueOf(await systemDefaults(), "default_company");
  return id && allowed.includes(id) ? id : null;
}

/** The base currency's row id — what a new Realisasi starts in. */
export async function baseCurrencyId(): Promise<number | null> {
  const row = await prisma.refCurrency.findFirst({
    where: { currency_label: BASE_CURRENCY_LABEL },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * The Cash & Bank a new Realisasi starts on, with its Company so the form
 * prefills it only beside that Company. Resolved against the master: an
 * inactive or no-longer-base-currency resource prefills nothing.
 */
export async function defaultRealizationCashBank(): Promise<
  { id: number; companyId: number } | null
> {
  const id = refValueOf(await systemDefaults(), "default_realization_cash_bank");
  if (!id) return null;
  if (await checkSystemDefaultValue("default_realization_cash_bank", id)) return null;
  const row = await prisma.mCashBank.findUnique({
    where: { id },
    select: { id: true, company_id: true },
  });
  return row ? { id: row.id, companyId: row.company_id } : null;
}
