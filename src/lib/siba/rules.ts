/**
 * The Transaction Purposes as they were originally written — **seed data now,
 * not a runtime source.**
 *
 * A Purpose is exactly one Budget Category x one Partner Category x one
 * direction, which is what lets it resolve to a single account. It used to live
 * here as 22 constants. It lives in `sys_purpose` now, because the Budget
 * Categories it classifies became rows: a category created through the GUI that
 * no Purpose named could be planned, mapped and given a subject book, and still
 * never reach a Cash Bank Transaction. That was the last link that needed a
 * developer, and it is the reason this moved.
 *
 * The 22 below are kept **verbatim** and planted once by `prisma/seed.ts`,
 * because two things about them cannot be regenerated:
 *
 *   - their **keys**. `fin_cash_bank_transaction.purpose` already holds
 *     `TTP_CAB_IN` on posted documents, and a posted document is permanent.
 * Their **labels are no longer here**. Every Purpose now reads
 * `<Penerimaan|Pengeluaran> <Budget Category> <dari|ke> <Partner Category>`,
 * composed by `purposeLabel` from the three fields, so the hand-written wording
 * these carried is gone — "Pemberian Advance kepada Karyawan" is "Pengeluaran
 * Piutang ke Karyawan". Uniformity was chosen over naming the business event.
 *
 * Everything after the seed is **entered**, through Master › Klasifikasi ›
 * Transaction Purpose. Nothing generates a Purpose: a Budget Category with none
 * cannot be transacted, and that is a maintenance gap rather than a fault.
 * **Do not add an entry here** for a category somebody creates through the GUI.
 */
import type { Direction } from "./classification";

export type { Direction };

export type Purpose = {
  key: string;
  /** Composed, never stored — see `purposeLabel` in `purposes.ts`. */
  label: string;
  direction: Direction;
  /** The Budget Category's label. Display only — logic keys on its id. */
  budgetCategory: string;
  /** null = this purpose takes no partner. */
  partnerCategory: string | null;
};

/** What a seeded Purpose is: its key and the combination it names. */
export type SeedPurpose = Omit<Purpose, "label">;

/**
 * The historical set, planted once. Renamed from `PURPOSES` so that nothing
 * reads it by accident expecting the live catalogue, and **not** extended when a
 * Budget Category is added — a new Purpose is entered through Master ›
 * Klasifikasi › Transaction Purpose, deliberately.
 */
export const SEED_PURPOSES: SeedPurpose[] = [
  { key: "TTP_CAB_IN",               direction: "In",  budgetCategory: "Titipan",         partnerCategory: "Cabang" },
  { key: "TTP_CAB_OUT",               direction: "Out", budgetCategory: "Titipan",         partnerCategory: "Cabang" },
  { key: "TTP_SH_IN",          direction: "In",  budgetCategory: "Titipan",         partnerCategory: "Stakeholder" },
  { key: "TTP_SH_OUT",          direction: "Out", budgetCategory: "Titipan",         partnerCategory: "Stakeholder" },
  { key: "HTG_CAB_IN",              direction: "In",  budgetCategory: "Hutang",          partnerCategory: "Cabang" },
  { key: "HTG_CAB_OUT",                  direction: "Out", budgetCategory: "Hutang",          partnerCategory: "Cabang" },
  { key: "HTG_KRY_IN",            direction: "In",  budgetCategory: "Hutang",          partnerCategory: "Karyawan" },
  { key: "HTG_KRY_OUT",                direction: "Out", budgetCategory: "Hutang",          partnerCategory: "Karyawan" },
  { key: "HTG_SH_IN",         direction: "In",  budgetCategory: "Hutang",          partnerCategory: "Stakeholder" },
  { key: "HTG_SH_OUT",             direction: "Out", budgetCategory: "Hutang",          partnerCategory: "Stakeholder" },
  { key: "PTG_CAB_OUT",             direction: "Out", budgetCategory: "Piutang",         partnerCategory: "Cabang" },
  { key: "PTG_CAB_IN",     direction: "In",  budgetCategory: "Piutang",         partnerCategory: "Cabang" },
  { key: "PTG_KRY_OUT",            direction: "Out", budgetCategory: "Piutang",         partnerCategory: "Karyawan" },
  { key: "PTG_KRY_IN",   direction: "In",  budgetCategory: "Piutang",         partnerCategory: "Karyawan" },
  { key: "PTG_SH_OUT",        direction: "Out", budgetCategory: "Piutang",         partnerCategory: "Stakeholder" },
  { key: "PTG_SH_IN", direction: "In", budgetCategory: "Piutang",         partnerCategory: "Stakeholder" },
  { key: "PRV_SH_OUT",          direction: "Out", budgetCategory: "Prive",           partnerCategory: "Stakeholder" },
  { key: "PRV_SH_IN", direction: "In", budgetCategory: "Prive",          partnerCategory: "Stakeholder" },
  { key: "AST_OUT",                               direction: "Out", budgetCategory: "Asset",           partnerCategory: null },
  { key: "BYA_OUT",                             direction: "Out", budgetCategory: "Biaya",           partnerCategory: null },
  { key: "INV_CAB_OUT",          direction: "Out", budgetCategory: "Investasi",       partnerCategory: "Cabang" },
  { key: "HIN_CAB_IN",       direction: "In",  budgetCategory: "Hasil Investasi", partnerCategory: "Cabang" },
];
