/**
 * Business classification rules, ported from the mockup's data layer.
 *
 * The chain is: Budget Category -> allowed Partner Categories -> Partner, and
 * a Purpose fully resolves (Budget Category, Partner Category, direction) to
 * exactly one Account.
 *
 * These live in code rather than the database because the source DBML models
 * `purpose` as a plain varchar. The mockup's own note suggests promoting them
 * to a `fin_purpose` config table — a V2 candidate.
 */

export type Direction = "In" | "Out";

/**
 * Which partner categories each budget category accepts, and which directions
 * are meaningful for it.
 *
 * Direction follows balance-sheet logic, not merely "money in / money out":
 *   Liability (Titipan, Hutang)      In = obligation up,  Out = obligation down
 *   Asset (Piutang, Investasi)       Out = asset up,      In  = asset down
 *   Contra-equity (Prive)            Out = drawing up,    In  = drawing down
 *   Expense / Fixed asset            Out only
 *   Income                           In only
 */
export const BUDGET_CATEGORY_RULES: Record<
  string,
  { partnerCategories: string[]; directions: Direction[] }
> = {
  Titipan: { partnerCategories: ["Cabang", "Stakeholder"], directions: ["In", "Out"] },
  Hutang: {
    partnerCategories: ["Cabang", "Karyawan", "Stakeholder"],
    directions: ["In", "Out"],
  },
  Piutang: {
    partnerCategories: ["Cabang", "Karyawan", "Stakeholder"],
    directions: ["In", "Out"],
  },
  Prive: { partnerCategories: ["Stakeholder"], directions: ["In", "Out"] },
  Asset: { partnerCategories: [], directions: ["Out"] },
  Biaya: { partnerCategories: [], directions: ["Out"] },
  Investasi: { partnerCategories: ["Cabang"], directions: ["Out"] },
  "Hasil Investasi": { partnerCategories: ["Cabang"], directions: ["In"] },
};

export type Purpose = {
  key: string;
  label: string;
  direction: Direction;
  budgetCategory: string;
  /** null = this purpose takes no partner. */
  partnerCategory: string | null;
};

/**
 * A purpose is one budget category x one partner category x one direction —
 * never a loose list. That is what lets it resolve to a single account.
 */
export const PURPOSES: Purpose[] = [
  { key: "TTP_CAB_IN",  label: "Penerimaan Titipan dari Cabang",               direction: "In",  budgetCategory: "Titipan",         partnerCategory: "Cabang" },
  { key: "TTP_CAB_OUT", label: "Pengembalian Titipan ke Cabang",               direction: "Out", budgetCategory: "Titipan",         partnerCategory: "Cabang" },
  { key: "TTP_SH_IN",   label: "Penerimaan Titipan dari Stakeholder",          direction: "In",  budgetCategory: "Titipan",         partnerCategory: "Stakeholder" },
  { key: "TTP_SH_OUT",  label: "Pengembalian Titipan ke Stakeholder",          direction: "Out", budgetCategory: "Titipan",         partnerCategory: "Stakeholder" },
  { key: "HTG_CAB_IN",  label: "Penerimaan Pinjaman dari Cabang",              direction: "In",  budgetCategory: "Hutang",          partnerCategory: "Cabang" },
  { key: "HTG_CAB_OUT", label: "Pembayaran Hutang ke Cabang",                  direction: "Out", budgetCategory: "Hutang",          partnerCategory: "Cabang" },
  { key: "HTG_KRY_IN",  label: "Penerimaan Pinjaman dari Karyawan",            direction: "In",  budgetCategory: "Hutang",          partnerCategory: "Karyawan" },
  { key: "HTG_KRY_OUT", label: "Pembayaran Hutang ke Karyawan",                direction: "Out", budgetCategory: "Hutang",          partnerCategory: "Karyawan" },
  { key: "HTG_SH_IN",   label: "Penerimaan Pinjaman dari Stakeholder",         direction: "In",  budgetCategory: "Hutang",          partnerCategory: "Stakeholder" },
  { key: "HTG_SH_OUT",  label: "Pembayaran Hutang ke Stakeholder",             direction: "Out", budgetCategory: "Hutang",          partnerCategory: "Stakeholder" },
  { key: "PTG_CAB_OUT", label: "Pemberian Pinjaman kepada Cabang",             direction: "Out", budgetCategory: "Piutang",         partnerCategory: "Cabang" },
  { key: "PTG_CAB_IN",  label: "Penerimaan Pelunasan Piutang dari Cabang",     direction: "In",  budgetCategory: "Piutang",         partnerCategory: "Cabang" },
  { key: "PTG_KRY_OUT", label: "Pemberian Advance kepada Karyawan",            direction: "Out", budgetCategory: "Piutang",         partnerCategory: "Karyawan" },
  { key: "PTG_KRY_IN",  label: "Penerimaan Pelunasan Piutang dari Karyawan",   direction: "In",  budgetCategory: "Piutang",         partnerCategory: "Karyawan" },
  { key: "PTG_SH_OUT",  label: "Pemberian Pinjaman kepada Stakeholder",        direction: "Out", budgetCategory: "Piutang",         partnerCategory: "Stakeholder" },
  { key: "PTG_SH_IN",   label: "Penerimaan Pelunasan Piutang dari Stakeholder", direction: "In", budgetCategory: "Piutang",         partnerCategory: "Stakeholder" },
  { key: "PRV_SH_OUT",  label: "Pembayaran Prive kepada Stakeholder",          direction: "Out", budgetCategory: "Prive",           partnerCategory: "Stakeholder" },
  { key: "PRV_SH_IN",   label: "Penerimaan Pengembalian Prive dari Stakeholder", direction: "In", budgetCategory: "Prive",          partnerCategory: "Stakeholder" },
  { key: "AST_OUT",     label: "Pembelian Aset",                               direction: "Out", budgetCategory: "Asset",           partnerCategory: null },
  { key: "BYA_OUT",     label: "Pembayaran Biaya",                             direction: "Out", budgetCategory: "Biaya",           partnerCategory: null },
  { key: "INV_CAB_OUT", label: "Pengeluaran Investasi kepada Cabang",          direction: "Out", budgetCategory: "Investasi",       partnerCategory: "Cabang" },
  { key: "HIN_CAB_IN",  label: "Penerimaan Hasil Investasi dari Cabang",       direction: "In",  budgetCategory: "Hasil Investasi", partnerCategory: "Cabang" },
];

const BY_KEY = new Map(PURPOSES.map((p) => [p.key, p]));

export function purposeOf(key: string | null | undefined): Purpose | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

export function purposeLabel(key: string | null | undefined): string {
  return purposeOf(key)?.label ?? key ?? "—";
}

export function purposeNeedsPartner(key: string | null | undefined): boolean {
  return purposeOf(key)?.partnerCategory != null;
}

/** Base-currency (IDR) conversion rates. The mockup hardcodes these; a real
 *  exchange-rate master is out of V1 scope. */
export const RATES: Record<string, number> = { IDR: 1, USD: 16000, SGD: 12500 };

export function rateFor(currencyLabel: string): number {
  return RATES[currencyLabel] ?? 1;
}
