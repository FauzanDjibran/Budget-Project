/**
 * Showcase data — a whole business, so no screen in the application is empty.
 *
 * `npm run db:seed-showcase`. It is **not** the seeder: the seed writes system
 * data only and is safe against a live database (CLAUDE.md §12), while this
 * writes the business records a user would have entered. Run by hand, never by
 * install, migrate, reset or CI.
 *
 * It replaces `sample-data.ts`, which built the same chart of accounts and
 * mappings but populated them with "Cabang A" and "Karyawan B" — placeholders
 * nobody could demonstrate the application with. The chart-building and
 * numbering here is that script's, unchanged; what is new is a fiction that
 * reads like a real group and the transactions that make every report say
 * something.
 *
 * **Anything posted goes through the real engine.** The go-live setup is the
 * one exception: the closed year's cash and its Opening Balance are stated,
 * not posted, the way a real implementation states the balances it starts
 * from (`injectClosedYear`).
 *
 * Posting itself: `applyPosting`,
 * `applyTransfer`, `confirmFundingRequest` and `applyItemAdjustment` write the Cash Bank Book, the
 * subject books, the journal and the rate layers together, inside one
 * transaction each. Inserting those rows directly would be faster and would
 * produce reports whose figures do not reconcile — which is worse than empty,
 * because it looks like the application is wrong.
 *
 * Additive and idempotent: every step reuses what is already there and nothing
 * is ever deleted. Running it twice does not double anything.
 *
 * **`--master-only`** (`npm run db:seed-master`) stops once the setup is in:
 * the Companies' names, the foreign currency, the Partners, both charts of
 * accounts, the mappings, Mapping Account System and the System Defaults —
 * transcribed from the deployed database — the previous year Closed and the
 * current one Open, the Cash & Bank resources with their opening saldo and
 * rate layers, and the current year's Opening Balance carrying that cash. No
 * Budget, no document, no journal. The full showcase run afterwards
 * on the same database carries on from exactly there.
 */
import "dotenv/config";
import { openCashBankBook, recordCashBankEntry } from "@/lib/siba/cash-bank";
import { openLayer } from "@/lib/siba/cash-bank-layers";
import { ensureFiscalPeriods, fiscalYearShape, recordFiscalClosing } from "@/lib/siba/fiscal";
import { writeOpeningBalance } from "@/lib/siba/opening-balance";
import { syncControlAccounts } from "@/lib/siba/records";
import { writeSystemDefaults } from "@/lib/siba/system-settings";
import { systemAccountIds, writeSystemAccounts } from "@/lib/siba/system-account-data";
import { nextBudgetNo } from "@/lib/siba/budget";
import { applyPosting } from "@/lib/siba/finance";
import { realizationOf } from "@/lib/siba/realization";
import { nextDocumentNumber } from "@/lib/siba/document-number";
import { applyTransfer, nextTransferNo } from "@/lib/siba/transfer";
import { confirmFundingRequest, raiseFundingRequest } from "@/lib/siba/funding";
import { createManualJournal, postManualJournal } from "@/lib/siba/manual-journal";
import {
  adjustmentLineData,
  applyItemAdjustment,
  checkItemAdjustmentHeader,
  checkItemAdjustmentLines,
  nextItemAdjustmentNo,
  valueItemAdjustmentDraft,
} from "@/lib/siba/item-adjustment";
import { openSubledgerItems } from "@/lib/siba/subledger";
import { applyConversion, nextConversionNo } from "@/lib/siba/item-conversion";
import {
  applyReclass,
  checkReclassHeader,
  checkReclassLines,
  nextReclassNo,
} from "@/lib/siba/item-reclass";
import { subledgerForCategory, subledgerMovement } from "@/lib/siba/subledger-catalogue";
import { loadSubledgers } from "@/lib/siba/subledger-data";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type Balance = "Debit" | "Kredit";

type AccountNode = {
  name: string;
  /** Overrides the kelompok's normal balance — a contra account flips it. */
  balance?: Balance;
  /** A header that only holds children. Leaves are postable by default. */
  header?: boolean;
  /**
   * Makes this a subledger account: a Journal Line must name a Partner, and
   * only one of this Partner Category. Such an account is also a control
   * account — its General Ledger balance is what the operational book for
   * that subject is reconciled against.
   */
  partnerCategory?: "Cabang" | "Karyawan" | "Stakeholder" | "Lainnya";
  children?: AccountNode[];
};

/** One seeded kelompok and the accounts hanging under it. */
type Group = { kelompok: string; balance: Balance; accounts: AccountNode[] };

// --------------------------------------------------------------- the chart
//
// Built for the skeleton in `prisma/seed.ts`, and shaped so every Budget
// Category in `lib/siba/rules.ts` has somewhere to map to: Titipan, Hutang and
// Piutang per Partner Category, Prive for a Stakeholder, Investasi and Hasil
// Investasi per Cabang, plus general Asset and Biaya accounts.

/**
 * Kas & Bank, the one kelompok where the two charts differ. The induk holds
 * every Cash & Bank resource, so its bank accounts are named after them — one
 * account per resource, the currency readable from the chart rather than only
 * from the resource. The anak holds none (§10 rule 38) and keeps the generic
 * names. Both transcribed from the deployed database, in the order the
 * accounts were created, so the numbers come out the same.
 */
const cashGroup = (banks: string[]): Group => ({
  kelompok: "1.1.1",
  balance: "Debit",
  accounts: [
    {
      name: "Kas",
      header: true,
      children: [{ name: "Kas Besar" }, { name: "Kas Kecil" }],
    },
    { name: "Bank", header: true, children: banks.map((name) => ({ name })) },
  ],
});
const INDUK_BANKS = ["Mandiri IDR", "BCA IDR", "BCA USD", "Mandiri USD"];
const ANAK_BANKS = ["Bank Mandiri", "Bank BCA", "Bank BCA Valas"];

/** The rest of the chart, the same for both Companies. */
const CHART: Group[] = [
  {
    kelompok: "1.1.3",
    balance: "Debit",
    accounts: [{ name: "Piutang Usaha" }],
  },
  {
    kelompok: "1.1.4",
    balance: "Debit",
    accounts: [
      // What this Company is owed by the other one. Half of the intercompany
      // bridge a confirmed Funding Request journals against (§10 rule 61).
      { name: "Piutang Perusahaan Afiliasi" },
      { name: "Piutang Cabang", partnerCategory: "Cabang" },
      { name: "Piutang Karyawan", partnerCategory: "Karyawan" },
      { name: "Piutang Stakeholder", partnerCategory: "Stakeholder" },
    ],
  },
  {
    kelompok: "1.1.5",
    balance: "Debit",
    accounts: [{ name: "Persediaan Barang Dagang" }],
  },
  {
    kelompok: "1.1.6",
    balance: "Debit",
    accounts: [
      { name: "Uang Muka Pembelian" },
      // The holding book for money that left before anybody knew what for.
      { name: "Pengeluaran Belum Teridentifikasi", partnerCategory: "Lainnya" },
    ],
  },
  {
    kelompok: "1.1.7",
    balance: "Debit",
    accounts: [
      { name: "PPh Pasal 22 Dibayar Dimuka" },
      { name: "PPh Pasal 23 Dibayar Dimuka" },
      { name: "PPN Masukan" },
    ],
  },
  {
    kelompok: "1.1.8",
    balance: "Debit",
    accounts: [
      { name: "Sewa Dibayar Dimuka" },
      { name: "Asuransi Dibayar Dimuka" },
    ],
  },
  {
    kelompok: "1.2.1",
    balance: "Debit",
    accounts: [{ name: "Investasi pada Cabang", partnerCategory: "Cabang" }],
  },
  { kelompok: "1.3.1", balance: "Debit", accounts: [{ name: "Tanah" }] },
  {
    kelompok: "1.3.2",
    balance: "Debit",
    accounts: [{ name: "Peralatan Kantor" }, { name: "Mesin Produksi" }],
  },
  {
    kelompok: "1.3.3",
    balance: "Debit",
    accounts: [{ name: "Gedung Kantor" }],
  },
  {
    kelompok: "1.3.4",
    balance: "Debit",
    accounts: [{ name: "Kendaraan Operasional" }, { name: "Inventaris Kantor" }],
  },
  {
    // A contra-asset: it lives among the assets but carries a credit balance.
    kelompok: "1.3.9",
    balance: "Kredit",
    accounts: [
      { name: "Akumulasi Penyusutan Peralatan dan Mesin" },
      { name: "Akumulasi Penyusutan Gedung dan Bangunan" },
      { name: "Akumulasi Penyusutan Kendaraan dan Inventaris" },
    ],
  },
  { kelompok: "2.1.1", balance: "Kredit", accounts: [{ name: "Hutang Usaha" }] },
  {
    kelompok: "2.1.2",
    balance: "Kredit",
    accounts: [
      { name: "Hutang PPh Pasal 21" },
      { name: "Hutang PPh Pasal 23" },
      { name: "Hutang PPN Keluaran" },
    ],
  },
  {
    kelompok: "2.1.3",
    balance: "Kredit",
    accounts: [{ name: "Hutang Gaji" }, { name: "Hutang Listrik dan Telepon" }],
  },
  {
    kelompok: "2.1.5",
    balance: "Kredit",
    accounts: [
      /** The other half: what this Company owes the other one. */
      { name: "Hutang kepada Perusahaan Afiliasi" },
      { name: "Hutang kepada Cabang", partnerCategory: "Cabang" },
      { name: "Hutang kepada Karyawan", partnerCategory: "Karyawan" },
      { name: "Hutang kepada Stakeholder", partnerCategory: "Stakeholder" },
      { name: "Titipan dari Cabang", partnerCategory: "Cabang" },
      { name: "Titipan dari Stakeholder", partnerCategory: "Stakeholder" },
      // The holding book for money that arrived before anybody knew what for.
      { name: "Penerimaan Belum Teridentifikasi", partnerCategory: "Lainnya" },
    ],
  },
  {
    kelompok: "2.2.1",
    balance: "Kredit",
    accounts: [{ name: "Hutang Bank Jangka Panjang" }],
  },
  {
    kelompok: "3.1.1",
    balance: "Kredit",
    accounts: [
      { name: "Modal Disetor" },
      // Prive reduces equity, so it is a debit account sitting under it.
      { name: "Prive Stakeholder", balance: "Debit", partnerCategory: "Stakeholder" },
    ],
  },
  {
    kelompok: "3.3.1",
    balance: "Kredit",
    accounts: [{ name: "Laba Ditahan" }],
  },
  {
    kelompok: "3.4.1",
    balance: "Kredit",
    // Never posted to: the Neraca computes the year's result to date and places
    // it here, through the System Default below.
    accounts: [
      { name: "Laba Rugi Tahun Berjalan" },
    ],
  },
  {
    kelompok: "4.1.1",
    balance: "Kredit",
    accounts: [{ name: "Pendapatan Penjualan" }, { name: "Pendapatan Jasa" }],
  },
  {
    // A contra-revenue: a deduction from sales, so it is debit.
    kelompok: "4.1.8",
    balance: "Debit",
    accounts: [{ name: "Potongan Penjualan" }, { name: "Retur Penjualan" }],
  },
  {
    kelompok: "4.9.1",
    balance: "Kredit",
    accounts: [
      { name: "Hasil Investasi dari Cabang", partnerCategory: "Cabang" },
      { name: "Pendapatan Bunga Bank" },
      { name: "Pendapatan Lain-lain" },
      // Where an adjustment's counter side lands when it is credited.
      { name: "Pendapatan Penyesuaian" },
    ],
  },
  {
    kelompok: "5.1.1",
    balance: "Debit",
    accounts: [{ name: "Harga Pokok Penjualan" }],
  },
  {
    kelompok: "5.2.1",
    balance: "Debit",
    accounts: [
      { name: "Biaya Pengiriman Penjualan" },
      { name: "Biaya Promosi dan Pemasaran" },
    ],
  },
  {
    kelompok: "5.3.1",
    balance: "Debit",
    accounts: [
      { name: "Biaya Gaji dan Upah" },
      { name: "Biaya Listrik, Air dan Telepon" },
      { name: "Biaya Alat Tulis Kantor" },
      { name: "Biaya Perjalanan Dinas" },
      { name: "Biaya Sewa Kantor" },
      { name: "Biaya Penyusutan" },
      { name: "Biaya Administrasi Bank" },
      { name: "Biaya Umum Lain-lain" },
    ],
  },
  {
    kelompok: "5.3.2",
    balance: "Debit",
    accounts: [{ name: "Biaya PPh Final" }],
  },
  {
    kelompok: "5.9.1",
    balance: "Debit",
    accounts: [
      { name: "Biaya Bunga Pinjaman" },
      { name: "Selisih Kurs" },
      // Where an adjustment's counter side lands when it is debited.
      { name: "Beban Penyesuaian" },
    ],
  },
];

/**
 * The two Companies, named. They are seeded as INDUK / "Perusahaan Induk",
 * which is a placeholder on every Company badge, report header and journal in
 * the application — so the showcase renames them.
 *
 * This is the one place it touches `sys_*` data. It is reversible: the seed
 * owns those rows and will not change them back, but re-seeding a fresh
 * database restores the defaults.
 */
const COMPANIES: { parent: boolean; label: string; name: string }[] = [
  { parent: true, label: "ABHC", name: "ABHC" },
  { parent: false, label: "SBTC", name: "SBTC" },
];

/** The induk's Partners, transcribed from the deployed database. */
const PARTNERS: [label: string, name: string, category: string][] = [
  ["DAP", "PT. Delta Atsiri Prima", "Cabang"],
  ["DESTEX", "PT. Delta Surya Textile", "Cabang"],
  ["AKUI", "PT. AKUI Birdnest", "Cabang"],
  ["EMP-001", "Fauzan", "Karyawan"],
  ["EMP-002", "Rizal", "Karyawan"],
  ["EMP-003", "Mikhail", "Karyawan"],
  ["MR.X", "MR.X", "Stakeholder"],
  // Whoever sent or received money nobody can place yet.
  ["Lainnya", "Lainnya", "Lainnya"],
];

/**
 * The anak's own Partners: one generic per Partner Category.
 *
 * A Partner belongs to one Company and cannot be moved between them, and a
 * Budget's Partner must belong to that Budget's Company (§10 rule 26) — so the
 * anak needs its own, or its Partner list is empty and its Budgets can only use
 * the two categories that name nobody. MR.X and Lainnya repeat the induk's
 * names; `partner_label` is unique across both Companies, so their labels
 * carry the Company.
 */
const ANAK_PARTNERS: [label: string, name: string, category: string][] = [
  ["CAB-A", "Cabang A", "Cabang"],
  ["KRY-A", "Karyawan A", "Karyawan"],
  ["MR.X-SBTC", "MR.X", "Stakeholder"],
  ["Lainnya-SBTC", "Lainnya", "Lainnya"],
];

const PARTNER_NOTE = "";

/**
 * The calendar: the current year Open, and the one before it **Closed** by
 * both Companies — so the current year opens from an Opening Balance whose
 * source is a closed year. Nothing was posted in the closed year; it exists
 * to hand the current year its cash.
 */
const YEAR = new Date().getUTCFullYear();
const CLOSED_YEAR = YEAR - 1;
const ALL_YEARS = [CLOSED_YEAR, YEAR];

const on = (year: number, month: number, date: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
/** A day in the current year. */
const day = (month: number, date: number) => on(YEAR, month, date);

/** The foreign currency, so rate layers and an FX difference have somewhere to live. */
const FOREIGN = { label: "USD", name: "Dolar Amerika Serikat" };

/**
 * Where the money is. All on the induk: the anak holds no Cash & Bank by
 * design, and reaches money through a Funding Request (§10 rule 38).
 *
 * **Each opens with the saldo it held at the end of the closed year**, dated
 * inside that year so every report of the current year reads it as Saldo
 * Awal. A foreign resource opens one rate layer per acquisition — two, at
 * different kurs, so a payment has a real choice to make. The same figures,
 * in base, are the cash lines of the current year's Opening Balance
 * (`injectClosedYear`), which is what makes Buku Kas & Bank and the Neraca
 * agree from the first day.
 *
 * Injected rather than posted, deliberately: this is go-live setup, the way a
 * real implementation states the balances it starts from.
 */
const CASH_BANKS: {
  label: string;
  name: string;
  type: "Cash" | "Bank";
  currency: "IDR" | "USD";
  account: string;
  /** Each is one `Opening` entry in the book and, on a foreign resource, one layer. */
  openings: { date: [month: number, day: number]; amount: number; rate: number }[];
}[] = [
  { label: "KAS", name: "Kas", type: "Cash", currency: "IDR", account: "Kas Besar",
    openings: [{ date: [12, 31], amount: 75_000_000, rate: 1 }] },
  { label: "BCA-IDR", name: "BCA IDR", type: "Bank", currency: "IDR", account: "BCA IDR",
    openings: [{ date: [12, 31], amount: 3_500_000_000, rate: 1 }] },
  { label: "MDR-IDR", name: "Mandiri IDR", type: "Bank", currency: "IDR", account: "Mandiri IDR",
    openings: [{ date: [12, 31], amount: 1_200_000_000, rate: 1 }] },
  { label: "BCA-USD", name: "BCA USD", type: "Bank", currency: "USD", account: "BCA USD",
    openings: [
      { date: [11, 14], amount: 25_000, rate: 15_750 },
      { date: [12, 16], amount: 20_000, rate: 16_300 },
    ] },
  { label: "MDR-USD", name: "Mandiri USD", type: "Bank", currency: "USD", account: "Mandiri USD",
    openings: [
      { date: [11, 20], amount: 10_000, rate: 15_900 },
      { date: [12, 23], amount: 8_000, rate: 16_450 },
    ] },
];

/**
 * Budget Category x Partner Category -> the account a posting journals against.
 *
 * Every combination `lib/siba/rules.ts` declares, and only those: a Budget
 * Category that takes no Partner gets one mapping with no Partner Category, and
 * one that takes several gets one per category it admits. The accounts are the
 * subledger accounts `CHART` puts there for exactly this purpose, named rather
 * than numbered because a chart's numbers depend on what was already in it.
 *
 * Posting needs these. A document whose Purpose resolves to no account cannot
 * be journalled, so the post is refused — while approval still tolerates the
 * gap (CLAUDE.md §10 rules 28 and 50).
 *
 * Two of them are judgement calls rather than a single obvious account, and
 * both are the general case of their kind:
 *
 *   - **Asset** buys fixed assets, and the chart has four kinds. Inventaris
 *     Kantor is the catch-all; a purchase of land or a building is worth
 *     re-pointing by hand.
 *   - **Biaya** is general expenditure, so it lands on Biaya Umum Lain-lain
 *     rather than on one of the named expense accounts.
 */
const MAPPINGS: [
  budgetCategory: string,
  partnerCategory: string | null,
  accountName: string,
][] = [
  ["Titipan", "Cabang", "Titipan dari Cabang"],
  ["Titipan", "Stakeholder", "Titipan dari Stakeholder"],

  ["Hutang", "Cabang", "Hutang kepada Cabang"],
  ["Hutang", "Karyawan", "Hutang kepada Karyawan"],
  ["Hutang", "Stakeholder", "Hutang kepada Stakeholder"],

  ["Piutang", "Cabang", "Piutang Cabang"],
  ["Piutang", "Karyawan", "Piutang Karyawan"],
  ["Piutang", "Stakeholder", "Piutang Stakeholder"],

  ["Prive", "Stakeholder", "Prive Stakeholder"],

  ["Investasi", "Cabang", "Investasi pada Cabang"],
  ["Hasil Investasi", "Cabang", "Hasil Investasi dari Cabang"],

  ["Penerimaan Belum Teridentifikasi", "Lainnya", "Penerimaan Belum Teridentifikasi"],
  ["Pengeluaran Belum Teridentifikasi", "Lainnya", "Pengeluaran Belum Teridentifikasi"],

  ["Asset", null, "Inventaris Kantor"],
  ["Biaya", null, "Biaya Umum Lain-lain"],
];

/** Stop after the master data and the chart: no Budget, no document, no journal. */
const MASTER_ONLY = process.argv.includes("--master-only");

const made: Record<string, number> = {};
const tally = (what: string, n = 1) => {
  if (n) made[what] = (made[what] ?? 0) + n;
};

// --------------------------------------------------------------------- run

/**
 * Names the two Companies.
 *
 * The one place this script writes `sys_*` data, and it earns it: seeded, they
 * are "Perusahaan Induk" and "Perusahaan Anak", which appears on every Company
 * badge, every report header and every journal. A showcase that still says
 * "Perusahaan Anak" is not showing anything.
 */
async function nameCompanies(actor: number) {
  for (const wanted of COMPANIES) {
    const row = await prisma.sysCompany.findFirst({
      where: { is_parent: wanted.parent },
      select: { id: true, company_label: true },
    });
    if (!row || row.company_label === wanted.label) continue;
    await prisma.sysCompany.update({
      where: { id: row.id },
      data: {
        company_label: wanted.label,
        company_name: wanted.name,
        updated_by: actor,
      },
    });
    tally("companies named");
  }
}

/** The foreign currency. Rate layers and an FX difference need somewhere to be. */
async function ensureForeignCurrency(actor: number): Promise<number> {
  const existing = await prisma.refCurrency.findFirst({
    where: { currency_label: FOREIGN.label },
    select: { id: true },
  });
  if (existing) return existing.id;

  const codes = await prisma.refCurrency.findMany({ select: { currency_code: true } });
  const row = await prisma.refCurrency.create({
    data: {
      currency_code: await nextCode("curr", codes.map((c) => c.currency_code)),
      currency_label: FOREIGN.label,
      currency_name: FOREIGN.name,
      created_by: actor,
    },
    select: { id: true },
  });
  await audit("ref_currency", row.id, actor);
  tally("currencies");
  return row.id;
}

/**
 * The settings that **decide** rather than prefill: where a funded
 * confirmation journals, where an FX difference lands, and where a
 * Penyesuaian Open Item's counter side posts.
 *
 * Without all four bridge accounts a Funding Request refuses by name, and
 * without the FX account a Pencairan does — so a showcase that skipped these
 * would have two menus that cannot be demonstrated at all (§12).
 */
async function setDefaults(actor: number) {
  const companies = await prisma.sysCompany.findMany({
    select: { id: true, is_parent: true },
  });
  const accountId = async (companyId: number, name: string) =>
    (
      await prisma.accAccount.findFirstOrThrow({
        where: { company_id: companyId, account_name: name },
        select: { id: true },
      })
    ).id;

  const induk = companies.find((c) => c.is_parent)!;
  const anak = companies.find((c) => !c.is_parent)!;
  const idr = await prisma.refCurrency.findFirstOrThrow({
    where: { currency_label: "IDR" },
    select: { id: true },
  });

  const changed = await writeSystemDefaults(
    { default_currency: String(idr.id), default_company: String(induk.id) },
    actor
  );
  tally("system defaults", changed.length);

  // Mapping Account System: the same chart names for both Companies, since
  // each keeps its own chart numbered the same way.
  let mapped = 0;
  for (const company of [induk, anak]) {
    const written = await writeSystemAccounts(
      company.id,
      {
        bridge_ar: await accountId(company.id, "Piutang Perusahaan Afiliasi"),
        bridge_ap: await accountId(company.id, "Hutang kepada Perusahaan Afiliasi"),
        fx: await accountId(company.id, "Selisih Kurs"),
        accumulated_pl: await accountId(company.id, "Laba Ditahan"),
        current_pl: await accountId(company.id, "Laba Rugi Tahun Berjalan"),
        adjustment_income: await accountId(company.id, "Pendapatan Penyesuaian"),
        adjustment_expense: await accountId(company.id, "Beban Penyesuaian"),
      },
      actor
    );
    mapped += written.length;
  }
  tally("system accounts", mapped);

  // What the Server Action does after every mapping write: an account a
  // posting engine or a statement owns is closed to hand entry.
  const named = await systemAccountIds();
  await syncControlAccounts([...named], named, actor);
}

/**
 * The cash and bank resources, each with its opening balance written as the
 * first entry in its own book — never as a column (§12).
 *
 * The foreign one opens its first rate layer at the same moment, which is what
 * a later payment out of it draws on.
 */
async function insertCashBanks(companyId: number, foreignId: number, actor: number) {
  const idr = await prisma.refCurrency.findFirstOrThrow({
    where: { currency_label: "IDR" },
    select: { id: true },
  });

  for (const spec of CASH_BANKS) {
    const existing = await prisma.mCashBank.findFirst({
      where: { cash_bank_label: spec.label },
      select: { id: true },
    });
    if (existing) continue;

    const account = await prisma.accAccount.findFirstOrThrow({
      where: { company_id: companyId, account_name: spec.account },
      select: { id: true },
    });
    const codes = await prisma.mCashBank.findMany({ select: { cash_bank_code: true } });
    const layered = spec.currency !== "IDR";

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.mCashBank.create({
        data: {
          cash_bank_code: await nextCode("cbnk", codes.map((c) => c.cash_bank_code)),
          cash_bank_label: spec.label,
          cash_bank_name: spec.name,
          cash_bank_type: spec.type,
          company_id: companyId,
          currency_id: layered ? foreignId : idr.id,
          account_id: account.id,
          created_by: actor,
        },
        select: { id: true },
      });
      // The book's own registration path writes the balance row and the
      // first opening; each further acquisition is one more `Opening` entry
      // and its own layer, never merged into the first (§10 rule 71).
      const [first, ...rest] = spec.openings;
      await openCashBankBook(tx, {
        cashBankId: created.id,
        openingBalance: first.amount,
        rate: first.rate,
        layered,
        date: on(CLOSED_YEAR, ...first.date),
        actorId: actor,
      });
      for (const o of rest) {
        const date = on(CLOSED_YEAR, ...o.date);
        const note = "Saldo awal saat resource didaftarkan.";
        await recordCashBankEntry(tx, {
          cashBankId: created.id,
          date,
          type: "Opening",
          direction: "In",
          amount: o.amount,
          rate: o.rate,
          note,
          actorId: actor,
        });
        if (layered) {
          await openLayer(tx, { cashBankId: created.id, date, rate: o.rate, foreign: o.amount, note, actorId: actor });
        }
      }
      return created;
    });
    await audit("m_cash_bank", row.id, actor);
    tally("cash & bank");
  }

  // What the Server Action does after registering a resource: the account it
  // posts to is reconciled against the Cash Bank Book, so it is a control
  // account and closed to manual journals (§10 rule 79).
  const accounts = await prisma.mCashBank.findMany({ select: { account_id: true } });
  await syncControlAccounts(
    accounts.map((a) => a.account_id),
    await systemAccountIds(),
    actor
  );

  // The resource a new Realisasi starts on: the operating current account,
  // which is in the base currency a new Realisasi starts in.
  const operating = await prisma.mCashBank.findFirst({
    where: { company_id: companyId, cash_bank_label: "BCA-IDR" },
    select: { id: true },
  });
  if (operating) {
    await writeSystemDefaults({ default_realization_cash_bank: String(operating.id) }, actor);
  }
}

/**
 * Every year of the showcase, opened oldest first so each has its twelve
 * periods and Budget Month works. All four are opened **before** anything is
 * closed: a year may never be activated behind a close (§12).
 */
async function ensureFiscalYears(actor: number) {
  for (const year of ALL_YEARS) await ensureFiscalYear(year, actor);
}

async function ensureFiscalYear(year: number, actor: number) {
  const label = String(year);
  let row = await prisma.accFiscalYear.findFirst({
    where: { year_label: label },
    select: { id: true, status: true },
  });
  if (!row) {
    const shape = fiscalYearShape(year);
    const codes = await prisma.accFiscalYear.findMany({ select: { year_code: true } });
    row = await prisma.accFiscalYear.create({
      data: {
        year_code: await nextCode("fisc", codes.map((c) => c.year_code)),
        year_label: label,
        year_name: shape.year_name,
        start_date: shape.start_date,
        end_date: shape.end_date,
        status: "Draft",
        created_by: actor,
      },
      select: { id: true, status: true },
    });
    await audit("acc_fiscal_year", row.id, actor);
    tally("fiscal years");
  }

  if (row.status === "Draft") {
    await prisma.$transaction(async (tx) => {
      await tx.accFiscalYear.update({
        where: { id: row!.id },
        data: { status: "Open", updated_by: actor },
      });
      await ensureFiscalPeriods(tx, { fiscalYearId: row!.id, year, actorId: actor });
    });
    tally("fiscal periods", 12);
  }
}

/**
 * The closed year, injected: both Companies' closing records, and the
 * induk's `OPB-` snapshot for the current year sourced from it, carrying the
 * cash. Go-live setup rather than a run of `executeClosing` — the closed year
 * holds no journal, so a real close would have nothing to hand on; the cash
 * was stated, not posted.
 *
 * Each cash account is debited exactly the base its Cash Bank Book holds and
 * Modal Disetor takes the other side, so the Neraca opens on the same figures
 * Buku Kas & Bank does. Skipped once the year is closed.
 */
async function injectClosedYear(actor: number) {
  const [closed, current] = await Promise.all(
    [CLOSED_YEAR, YEAR].map((y) =>
      prisma.accFiscalYear.findFirstOrThrow({
        where: { year_label: String(y) },
        select: { id: true, status: true, start_date: true },
      })
    )
  );
  if (closed.status === "Closed") return;

  const companies = await prisma.sysCompany.findMany({
    orderBy: { is_parent: "desc" },
    select: { id: true, is_parent: true },
  });
  const induk = companies.find((c) => c.is_parent)!;

  const balances = await prisma.cashBankBalance.findMany({
    where: { cash_bank: { company_id: induk.id } },
    select: { base_balance: true, cash_bank: { select: { account_id: true } } },
  });
  const perAccount = new Map<number, number>();
  for (const b of balances) {
    const id = b.cash_bank.account_id;
    perAccount.set(id, (perAccount.get(id) ?? 0) + b.base_balance.toNumber());
  }
  const total = [...perAccount.values()].reduce((t, v) => t + v, 0);
  const equity = await prisma.accAccount.findFirstOrThrow({
    where: { company_id: induk.id, account_name: "Modal Disetor" },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    const opening = total
      ? await writeOpeningBalance(tx, {
          companyId: induk.id,
          fiscalYearId: current.id,
          sourceFiscalYearId: closed.id,
          postingDate: current.start_date,
          lines: [
            ...[...perAccount].map(([accountId, base]) => ({ accountId, debit: base, credit: 0 })),
            { accountId: equity.id, debit: 0, credit: total },
          ],
          actorId: actor,
        })
      : null;
    for (const company of companies) {
      await recordFiscalClosing(tx, {
        fiscalYearId: closed.id,
        companyId: company.id,
        closingJournalId: null,
        openingBalanceId: company.is_parent ? opening?.id ?? null : null,
        actorId: actor,
      });
    }
  });
  tally("fiscal year closings", companies.length);
  tally("opening balances");
}

// ------------------------------------------------------- what the year held
//
// Budgets first, because everything Finance does realizes one. Each names its
// classification the way Klasifikasi Budget would have set it, so the ones
// that are Open or Closed are already past that gate.

type BudgetSpec = {
  key: string;
  company: "induk" | "anak";
  date: string;
  type: "In" | "Out";
  category: string;
  partner?: string;
  currency?: "IDR" | "USD";
  amount: number;
  description: string;
  /**
   * `Closed` is written Open and reached by the posting that realizes it in
   * full — nobody closes a Budget by hand (§12). `Open` stays open because what
   * realizes it falls short. `Submitted`, `Approved`, `Rejected` and
   * `Cancelled` carry no classification, because only Klasifikasi Budget
   * classifies, and only after approval (§10 rules 25–26). `category` is then
   * what it will be classified as, for the reader of this file.
   */
  status: "Submitted" | "Approved" | "Open" | "Closed" | "Rejected" | "Cancelled";
};


async function insertBudgets(
  specs: BudgetSpec[],
  actor: number
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const companies = await prisma.sysCompany.findMany({ select: { id: true, is_parent: true } });
  const idOf = (which: "induk" | "anak") =>
    companies.find((c) => c.is_parent === (which === "induk"))!.id;
  const categories = new Map(
    (await prisma.sysBudgetCategory.findMany({ select: { id: true, category_label: true } }))
      .map((c) => [c.category_label, c.id])
  );
  // Keyed by Company too: both Companies have a MR.X and a Lainnya.
  const partners = new Map(
    (await prisma.mPartner.findMany({ select: { id: true, partner_name: true, company_id: true } }))
      .map((x) => [`${x.company_id}|${x.partner_name}`, x.id])
  );
  const currencies = new Map(
    (await prisma.refCurrency.findMany({ select: { id: true, currency_label: true } }))
      .map((c) => [c.currency_label, c.id])
  );

  for (const spec of specs) {
    const existing = await prisma.budBudget.findFirst({
      where: { description: spec.description },
      select: { id: true },
    });
    if (existing) {
      out.set(spec.key, existing.id);
      continue;
    }

    const classified = spec.status === "Open" || spec.status === "Closed";
    const row = await prisma.budBudget.create({
      data: {
        budget_no: await nextBudgetNo(),
        budget_date: new Date(`${spec.date}T00:00:00.000Z`),
        company_id: idOf(spec.company),
        currency_id: currencies.get(spec.currency ?? "IDR")!,
        budget_type: spec.type,
        budget_amount: spec.amount,
        realized_amount: 0,
        description: spec.description,
        // Only a classified budget carries a classification: Open, or Closed
        // by the realization that follows (§10 rules 25–26).
        category_id: classified ? categories.get(spec.category)! : null,
        partner_id:
          classified && spec.partner
            ? partners.get(`${idOf(spec.company)}|${spec.partner}`)!
            : null,
        status: spec.status === "Closed" ? "Open" : spec.status,
        created_by: actor,
      },
      select: { id: true },
    });
    await audit("bud_budget", row.id, actor);
    out.set(spec.key, row.id);
    tally("budgets");
  }
  return out;
}

// ------------------------------------------------------------- the documents
//
// Every posted one goes through `applyPosting`, so the Cash Bank Book, the
// subject book, the journal, the rate layer and the Budget's realization are
// written together. Nothing here inserts a book row directly.

/**
 * A Draft Realisasi Budget, shaped the way the Server Action shapes one.
 *
 * `purposeKey` is this script's own shorthand for what a document is about —
 * the historical Purpose mnemonics (`BYA_OUT`, `HTG_SH_IN`). The application
 * no longer has Purposes: a realization's direction is the menu it is raised
 * from, read here off the key's suffix, and every line carries its own
 * Budget's classification.
 */
async function draftDocument(options: {
  purposeKey: string;
  cashBank?: string;
  currency?: "IDR" | "USD";
  partner?: string;
  company?: "induk" | "anak";
  rate?: number;
  layerId?: number | null;
  note?: string;
  /** The Tanggal Dokumen, `YYYY-MM-DD` — what every book entry and the journal are dated by. */
  date: string;
  lines: { budgetId: number; amount: number }[];
}): Promise<number | null> {
  const actor = await actorId();
  // Its note is this script's marker. Guarding per document rather than on the
  // table being empty means a database already holding somebody else's work is
  // added to rather than skipped.
  if (options.note) {
    const existing = await prisma.finCashBankTransaction.findFirst({
      where: { note: options.note },
      select: { id: true },
    });
    if (existing) return null;
  }
  const direction: "In" | "Out" = options.purposeKey.endsWith("_IN") ? "In" : "Out";
  const prefix = realizationOf(direction).prefix;

  const companies = await prisma.sysCompany.findMany({
    select: { id: true, is_parent: true },
  });
  const resource = options.cashBank
    ? await prisma.mCashBank.findFirstOrThrow({
        where: { cash_bank_label: options.cashBank },
        select: { id: true, currency_id: true, company_id: true },
      })
    : null;
  const companyId =
    resource?.company_id ??
    companies.find((c) => c.is_parent === ((options.company ?? "induk") === "induk"))!.id;

  const currencies = new Map(
    (
      await prisma.refCurrency.findMany({ select: { id: true, currency_label: true } })
    ).map((c) => [c.currency_label, c.id])
  );
  const currencyId = options.currency
    ? currencies.get(options.currency)!
    : resource?.currency_id ?? currencies.get("IDR")!;

  const docType = await prisma.sysDocType.findFirstOrThrow({
    where: { doc_table: "bud_budget" },
    select: { id: true },
  });
  const budgets = await prisma.budBudget.findMany({
    where: { id: { in: options.lines.map((l) => l.budgetId) } },
    select: { id: true, budget_amount: true, realized_amount: true },
  });
  const outstandingOf = (id: number) => {
    const b = budgets.find((x) => x.id === id)!;
    return b.budget_amount.toNumber() - b.realized_amount.toNumber();
  };

  const total = options.lines.reduce((t, l) => t + l.amount, 0);
  const rate = options.rate ?? 1;
  const itemIds = await itemsFor(direction, currencyId, options.date, options.lines);

  const row = await prisma.finCashBankTransaction.create({
    data: {
      transaction_no: await nextDocumentNumber(prefix, async () => {
        const last = await prisma.finCashBankTransaction.findFirst({
          where: { transaction_no: { startsWith: `${prefix}-` } },
          orderBy: { transaction_no: "desc" },
          select: { transaction_no: true },
        });
        return last?.transaction_no ?? null;
      }),
      transaction_type: direction,
      document_date: new Date(`${options.date}T00:00:00Z`),
      company_id: companyId,
      cash_bank_id: resource?.id ?? null,
      currency_id: currencyId,
      exchange_rate: rate,
      cash_bank_layer_id: options.layerId ?? null,
      transaction_amount: total,
      transaction_base_amount: total * rate,
      note: options.note ?? null,
      status: "Draft",
      created_by: actor,
      lines: {
        create: options.lines.map((l, i) => ({
          sequence_no: i + 1,
          source_doc_type_id: docType.id,
          source_doc_id: l.budgetId,
          outstanding_amount: outstandingOf(l.budgetId),
          settlement_amount: l.amount,
          settlement_base_amount: l.amount * rate,
          transaction_amount: l.amount,
          transaction_base_amount: l.amount * rate,
          created_by: actor,
          // One open item per lowering line, settled for the line amount.
          items: itemIds[i]
            ? {
                create: [
                  {
                    sequence_no: 1,
                    sub_ledger_balance_id: itemIds[i]!,
                    amount: l.amount,
                    created_by: actor,
                  },
                ],
              }
            : undefined,
        })),
      },
    },
    select: { id: true },
  });
  tally("cash bank transactions");
  return row.id;
}

/**
 * The open item each line settles, where the line lowers a subject-book
 * position — chosen as a clerk would: the oldest item of that Partner, book and
 * currency raised by the document's date that still holds the line's amount.
 * Null for a line that raises a position (it opens its own item at Post) or
 * whose Budget Category keeps no book.
 */
async function itemsFor(
  direction: "In" | "Out",
  currencyId: number,
  date: string,
  lines: { budgetId: number; amount: number }[]
): Promise<(number | null)[]> {
  const books = await loadSubledgers();
  const budgets = await prisma.budBudget.findMany({
    where: { id: { in: lines.map((l) => l.budgetId) } },
    select: { id: true, category_id: true, partner_id: true },
  });
  const taken = new Map<number, number>();
  const out: (number | null)[] = [];
  for (const l of lines) {
    const budget = budgets.find((b) => b.id === l.budgetId)!;
    const book = subledgerForCategory(books, budget.category_id);
    if (!book || budget.partner_id == null || subledgerMovement(book, direction, 1) > 0) {
      out.push(null);
      continue;
    }
    const items = await prisma.subLedgerBalance.findMany({
      where: {
        budget_category_id: book.categoryId,
        partner_id: budget.partner_id,
        currency_id: currencyId,
        status: "Open",
        opened_date: { lte: new Date(`${date}T00:00:00Z`) },
      },
      orderBy: [{ opened_date: "asc" }, { id: "asc" }],
      select: { id: true, balance: true },
    });
    const item = items.find(
      (i) => i.balance.toNumber() - (taken.get(i.id) ?? 0) >= l.amount
    );
    if (!item) {
      throw new Error(
        `No open ${book.name} item for budget ${l.budgetId} holds ${l.amount} by ${date}.`
      );
    }
    taken.set(item.id, (taken.get(item.id) ?? 0) + l.amount);
    out.push(item.id);
  }
  return out;
}

/**
 * The layer a payment out of a foreign resource draws on — chosen as a
 * treasurer would: the oldest one acquired by that day that still holds the
 * whole amount, because one document draws on exactly one layer (§10 rule 70).
 * Its kurs is the layer's, never typed.
 */
async function layerFor(
  cashBankLabel: string,
  amount: number,
  date: string
): Promise<{ id: number; rate: number }> {
  const resource = await prisma.mCashBank.findFirstOrThrow({
    where: { cash_bank_label: cashBankLabel },
    select: { id: true },
  });
  const layers = await prisma.cashBankLayer.findMany({
    where: {
      cash_bank_id: resource.id,
      status: "Open",
      acquisition_date: { lte: new Date(`${date}T00:00:00Z`) },
    },
    orderBy: [{ acquisition_date: "asc" }, { id: "asc" }],
    select: { id: true, rate: true, foreign_remaining: true },
  });
  const layer = layers.find((l) => l.foreign_remaining.toNumber() >= amount);
  if (!layer) {
    throw new Error(`${cashBankLabel} holds no single layer of ${amount} by ${date}.`);
  }
  return { id: layer.id, rate: layer.rate.toNumber() };
}

/** Posts a Draft through the real engine, and says so loudly when it refuses. */
async function post(docId: number | null, actor: number, what: string) {
  if (!docId) return;
  const result = await applyPosting(docId, actor);
  if (!result.ok) {
    throw new Error(`Posting "${what}" refused: ${Object.values(result.errors).join(" ")}`);
  }
}


// ------------------------------------------------------------- the transfers
//
// The Company's own money moving between its own resources. A transfer settles
// no Budget and names no Partner — there is no counterparty — so its Purpose
// states only how the two currencies relate (§10 rule 85), and one of each is
// what this section writes.
//
// The Pencairan is the interesting one twice over: it is the only Purpose that
// can recognise an FX difference, and together with the Pembelian Valas beside
// it, it leaves BCA Valas holding two layers at two rates — which is what makes
// Posisi Layer Kurs, and the layer picker on a payment, worth opening at all.

type TransferSpec = {
  purpose: "Transfer" | "Pencairan" | "PembelianValas";
  from: string;
  currency: "IDR" | "USD";
  /** Values the foreign side into base; `1` where both sides are rupiah. */
  rate: number;
  /** The Tanggal Dokumen, `YYYY-MM-DD`. */
  date: string;
  note: string;
  lines: { to: string; amount: number }[];
};

/** A Draft Cash Bank Transfer, shaped the way the Server Action shapes one. */
async function draftTransfer(spec: TransferSpec, actor: number): Promise<number | null> {
  // Idempotent on the note, so re-running adds nothing. Nothing else about a
  // transfer is unique, and a document number is issued rather than chosen.
  const already = await prisma.finCashBankTransfer.findFirst({
    where: { note: spec.note },
    select: { id: true },
  });
  if (already) return null;

  const resource = async (label: string) =>
    prisma.mCashBank.findFirstOrThrow({
      where: { cash_bank_label: label },
      select: { id: true, company_id: true, currency_id: true },
    });

  const from = await resource(spec.from);
  const currency = await prisma.refCurrency.findFirstOrThrow({
    where: { currency_label: spec.currency },
    select: { id: true },
  });

  // Only a foreign source draws on a layer; a rupiah one holds none (§10
  // rule 69), which is exactly the Pembelian Valas case.
  const total = spec.lines.reduce((t, l) => t + l.amount, 0);
  const layerId =
    spec.currency !== "IDR" && from.currency_id === currency.id
      ? (await layerFor(spec.from, total, spec.date)).id
      : null;

  const lines = [];
  for (const [i, line] of spec.lines.entries()) {
    lines.push({
      sequence_no: i + 1,
      to_cash_bank_id: (await resource(line.to)).id,
      amount: line.amount,
      exchange_rate: spec.rate,
      // Every figure below is written at Post. A Draft has moved nothing, so
      // it has nothing to be worth.
      out_amount: 0,
      out_base_amount: 0,
      in_amount: 0,
      in_base_amount: 0,
      fx_difference: 0,
      created_by: actor,
    });
  }

  const row = await prisma.finCashBankTransfer.create({
    data: {
      transfer_no: await nextTransferNo(),
      document_date: new Date(`${spec.date}T00:00:00Z`),
      posting_date: null,
      company_id: from.company_id,
      purpose: spec.purpose,
      from_cash_bank_id: from.id,
      currency_id: currency.id,
      cash_bank_layer_id: layerId,
      transfer_amount: total,
      // Provisional while the document is a Draft, exactly as the Server
      // Action leaves it: what a layer releases is known only by drawing it,
      // and Post re-reads the layer before it values anything.
      transfer_base_amount: total * (layerId ? spec.rate : 1),
      note: spec.note,
      status: "Draft",
      created_by: actor,
      lines: { create: lines },
    },
    select: { id: true },
  });
  tally("cash bank transfers");
  return row.id;
}

/** Drafts and posts one transfer through `applyTransfer`, refusing loudly. */
async function postTransfer(spec: TransferSpec, actor: number) {
  const id = await draftTransfer(spec, actor);
  if (!id) return;
  const result = await applyTransfer(id, actor);
  if (!result.ok) {
    throw new Error(`Transfer "${spec.note}" refused: ${Object.values(result.errors).join(" ")}`);
  }
}

// ------------------------------------------------------ pencairan open item
//
// A Partner's foreign Titipan cashed into rupiah: the dollars are sold out of
// a foreign account and the Partner's items converted at the same kurs, so the
// journal carries one Selisih Kurs line. The layer is chosen from before the
// Titipan arrived, as the user's own worked example has it — the dollars sold
// were bought earlier, at another kurs, which is what leaves a difference.

type ConversionSpec = {
  /** The Tanggal Dokumen, `YYYY-MM-DD`. */
  date: string;
  from: string;
  /** The day the layer drawn on must have been acquired by. */
  layerBy: string;
  book: "Titipan" | "Hutang" | "Piutang";
  partner: string;
  rate: number;
  note: string;
  lines: { to: string; amount: number }[];
};

/** Drafts and posts one Pencairan Open Item through `applyConversion`, refusing loudly. */
async function postConversion(spec: ConversionSpec, actor: number) {
  const already = await prisma.finItemConversion.findFirst({
    where: { note: spec.note },
    select: { id: true },
  });
  if (already) return;

  const from = await prisma.mCashBank.findFirstOrThrow({
    where: { cash_bank_label: spec.from },
    select: { id: true, company_id: true, currency_id: true },
  });
  const total = spec.lines.reduce((t, l) => t + l.amount, 0);
  const layer = await layerFor(spec.from, total, spec.layerBy);
  const category = await prisma.sysBudgetCategory.findFirstOrThrow({
    where: { category_label: spec.book },
    select: { id: true },
  });
  const book = subledgerForCategory(await loadSubledgers(), category.id)!;
  const partner = await prisma.mPartner.findFirstOrThrow({
    where: { partner_name: spec.partner, company: { is_parent: true } },
    select: { id: true },
  });

  // The items, chosen as a clerk would: the oldest that still holds each
  // line's amount by the document's date.
  const items = await prisma.subLedgerBalance.findMany({
    where: {
      budget_category_id: book.categoryId,
      partner_id: partner.id,
      currency_id: from.currency_id,
      status: "Open",
      opened_date: { lte: new Date(`${spec.date}T00:00:00Z`) },
    },
    orderBy: [{ opened_date: "asc" }, { id: "asc" }],
    select: { id: true, balance: true },
  });
  const taken = new Map<number, number>();
  const lines = [];
  for (const [i, line] of spec.lines.entries()) {
    const item = items.find((it) => it.balance.toNumber() - (taken.get(it.id) ?? 0) >= line.amount);
    if (!item) throw new Error(`No open ${book.name} item of ${spec.partner} holds ${line.amount}.`);
    taken.set(item.id, (taken.get(item.id) ?? 0) + line.amount);
    const to = await prisma.mCashBank.findFirstOrThrow({
      where: { cash_bank_label: line.to },
      select: { id: true },
    });
    lines.push({
      sequence_no: i + 1,
      to_cash_bank_id: to.id,
      amount: line.amount,
      exchange_rate: spec.rate,
      created_by: actor,
      items: {
        create: [{ sequence_no: 1, sub_ledger_balance_id: item.id, amount: line.amount, created_by: actor }],
      },
    });
  }

  const row = await prisma.finItemConversion.create({
    data: {
      conversion_no: await nextConversionNo(),
      document_date: new Date(`${spec.date}T00:00:00Z`),
      company_id: from.company_id,
      from_cash_bank_id: from.id,
      currency_id: from.currency_id,
      cash_bank_layer_id: layer.id,
      budget_category_id: category.id,
      partner_id: partner.id,
      conversion_amount: total,
      conversion_base_amount: total * layer.rate,
      note: spec.note,
      status: "Draft",
      created_by: actor,
      lines: { create: lines },
    },
    select: { id: true },
  });
  await audit("fin_item_conversion", row.id, actor);
  const result = await applyConversion(row.id, actor);
  if (!result.ok) {
    throw new Error(
      `Pencairan Open Item "${spec.note}" refused: ${Object.values(result.errors).join(" ")}`
    );
  }
  tally("pencairan open item");
}


// ------------------------------------------------------- the reclassifications
//
// Money realized into a Belum Teridentifikasi holding book, moved on once its
// place is known. Checked by the module's own rules and posted through
// `applyReclass`, so the showcase is a standing check on that path too.

type ReclassSpec = {
  date: string;
  /** The source book and Partner, by label and name. */
  book: string;
  partner: string;
  currency: "IDR" | "USD";
  note: string;
  lines: {
    book: string;
    partner: string;
    description: string;
    /** The Budget whose realization opened the source item. */
    from: string;
    amount: number;
    /** Where the target settles: the Budget whose realization opened that item. */
    settle?: string;
  }[];
};

/** The item a Budget's realization opened — what a clerk would pick by name. */
async function itemOpenedBy(budgetId: number): Promise<number> {
  const line = await prisma.finCashBankTransactionLine.findFirst({
    where: { source_doc_id: budgetId, opened_item_id: { not: null }, transaction: { status: "Posted" } },
    select: { opened_item_id: true },
  });
  if (!line?.opened_item_id) throw new Error(`No open item was opened by Budget ${budgetId}.`);
  return line.opened_item_id;
}

/** Drafts and posts one Reklasifikasi Open Item through `applyReclass`, refusing loudly. */
async function postReclass(spec: ReclassSpec, budgets: Map<string, number>, actor: number) {
  const already = await prisma.finItemReclass.findFirst({ where: { note: spec.note }, select: { id: true } });
  if (already) return;

  const categoryId = async (label: string) =>
    (await prisma.sysBudgetCategory.findFirstOrThrow({ where: { category_label: label }, select: { id: true } })).id;
  const partnerId = async (name: string) =>
    (await prisma.mPartner.findFirstOrThrow({ where: { partner_name: name, company: { is_parent: true } }, select: { id: true } })).id;
  const budget = (key: string) => {
    const id = budgets.get(key);
    if (!id) throw new Error(`No Budget "${key}" for "${spec.note}".`);
    return id;
  };
  const currency = await prisma.refCurrency.findFirstOrThrow({
    where: { currency_label: spec.currency },
    select: { id: true },
  });
  const companyIds = (await prisma.sysCompany.findMany({ select: { id: true } })).map((c) => c.id);

  const header = await checkReclassHeader(
    { budget_category_id: await categoryId(spec.book), partner_id: await partnerId(spec.partner), currency_id: currency.id },
    companyIds
  );
  if (!header.ok) throw new Error(`Reklasifikasi "${spec.note}" refused: ${Object.values(header.errors).join(" ")}`);

  const input = [];
  for (const l of spec.lines) {
    input.push({
      target_budget_category_id: await categoryId(l.book),
      target_partner_id: await partnerId(l.partner),
      description: l.description,
      sources: [{ item_id: await itemOpenedBy(budget(l.from)), amount: l.amount }],
      targets: l.settle ? [{ item_id: await itemOpenedBy(budget(l.settle)), amount: l.amount }] : [],
    });
  }
  const checked = await checkReclassLines(header, input);
  if (!checked.ok) throw new Error(`Reklasifikasi "${spec.note}" refused: ${checked.errors._lines}`);

  const row = await prisma.finItemReclass.create({
    data: {
      reclass_no: await nextReclassNo(),
      document_date: new Date(`${spec.date}T00:00:00Z`),
      company_id: header.companyId,
      budget_category_id: header.book.categoryId,
      partner_id: header.partnerId,
      currency_id: header.currencyId,
      reclass_amount: checked.total,
      note: spec.note,
      status: "Draft",
      created_by: actor,
      lines: {
        create: checked.lines.map((l, i) => ({
          sequence_no: i + 1,
          target_budget_category_id: l.targetBook.categoryId,
          target_partner_id: l.targetPartnerId,
          description: l.description,
          amount: l.amount,
          created_by: actor,
          sources: { create: l.sources.map((s, k) => ({ sequence_no: k + 1, sub_ledger_balance_id: s.itemId, amount: s.amount, created_by: actor })) },
          targets: { create: l.targets.map((t, k) => ({ sequence_no: k + 1, sub_ledger_balance_id: t.itemId, amount: t.amount, created_by: actor })) },
        })),
      },
    },
    select: { id: true },
  });
  await audit("fin_item_reclass", row.id, actor);
  const result = await applyReclass(row.id, actor);
  if (!result.ok) {
    throw new Error(`Reklasifikasi "${spec.note}" refused: ${Object.values(result.errors).join(" ")}`);
  }
  tally("reklasifikasi open item");
}

// ------------------------------------------------------- the funding requests
//
// The anak holds no Cash & Bank at all (§10 rule 38), so its documents name a
// Currency and leave Draft as `Pending`, raising a request the induk answers.
//
// One is confirmed and one is left Open, which is the point: the confirmed one
// shows what a funded posting writes — the induk's cash entry, the anak's own
// subject book, a journal each carrying the two Companies' positions — and the
// open one leaves something in the induk's queue to act on.

type FundingSpec = {
  purposeKey: string;
  partner?: string;
  note: string;
  budgetId: number;
  amount: number;
  /** The anak's Tanggal Dokumen — the day both Companies' books are dated by. */
  date: string;
  /** The induk resource that answers it; left Open when absent. */
  confirmFrom?: string;
};

/** The anak's document, raised as a Funding Request and, when asked, confirmed. */
async function fund(spec: FundingSpec, actor: number) {
  const docId = await draftDocument({
    purposeKey: spec.purposeKey,
    company: "anak",
    currency: "IDR",
    partner: spec.partner,
    date: spec.date,
    note: spec.note,
    lines: [{ budgetId: spec.budgetId, amount: spec.amount }],
  });
  if (!docId) return;

  const raised = await raiseFundingRequest(docId, actor);
  if (!raised.ok) {
    throw new Error(`Funding for "${spec.note}" refused: ${Object.values(raised.errors).join(" ")}`);
  }
  tally("funding requests");
  if (!spec.confirmFrom) return;

  const provider = await prisma.mCashBank.findFirstOrThrow({
    where: { cash_bank_label: spec.confirmFrom },
    select: { id: true },
  });
  const result = await confirmFundingRequest(
    raised.id,
    { cashBankId: provider.id, layerId: null, rate: null },
    actor
  );
  if (!result.ok) {
    throw new Error(`Confirming "${spec.note}" refused: ${Object.values(result.errors).join(" ")}`);
  }
}


// -------------------------------------------------------- the manual journals
//
// Real accounting that is not a cash movement anybody could raise a Budget for
// — an accrual. It goes through the same engine an automatic posting uses, so
// the balance rule and the control-account rule apply to it exactly as they do
// to everything else, and it touches no account a book reconciles against
// (§10 rule 79).

type ManualSpec = {
  description: string;
  /** The day it is written for — the posting date once it is posted. */
  date: string;
  post: boolean;
  lines: { account: string; debit?: number; credit?: number; description: string }[];
};


/** Writes one manual journal through the real engine, posting it when asked. */
async function writeManualJournal(spec: ManualSpec, actor: number) {
  const induk = await prisma.sysCompany.findFirstOrThrow({
    where: { is_parent: true },
    select: { id: true },
  });
  const idr = await prisma.refCurrency.findFirstOrThrow({
    where: { currency_label: "IDR" },
    select: { id: true },
  });

  const already = await prisma.accJournal.findFirst({
    where: { description: spec.description },
    select: { id: true },
  });
  if (already) return;

  const lines = [];
  for (const line of spec.lines) {
    const account = await prisma.accAccount.findFirstOrThrow({
      where: { company_id: induk.id, account_name: line.account },
      select: { id: true },
    });
    lines.push({
      account_id: account.id,
      partner_id: null,
      currency_id: idr.id,
      // Base currency, so the rate is 1 and the form does not ask for one.
      exchange_rate: null,
      debit: line.debit ?? 0,
      credit: line.credit ?? 0,
      description: line.description,
    });
  }

  const created = await createManualJournal(
    { company_id: induk.id, description: spec.description, journal_date: spec.date },
    lines,
    actor
  );
  if (!created.ok) {
    throw new Error(
      `Manual journal "${spec.description}" refused: ${Object.values(created.errors).join(" ")}`
    );
  }
  tally("manual journals");

  if (spec.post) {
    const posted = await postManualJournal(created.id, actor, [induk.id]);
    if (!posted.ok) {
      throw new Error(
        `Posting "${spec.description}" refused: ${Object.values(posted.errors).join(" ")}`
      );
    }
  }
}


// ------------------------------------------------ penyesuaian open item
//
// An adjustment moves a Partner's standing position without cash (§10 rules
// 97–102), so each one here lands on a position a document above already
// opened: Fauzan's advance in Piutang, MR.X's setoran in
// Hutang, PT. Delta Atsiri Prima's titipan. Each one names the oldest open
// item that can take it — the script standing in for the user who would pick
// it — and types its new value; the difference is a Penambahan or a
// Pengurangan, like a Debit and a Credit Note. Posted ones go through
// `applyItemAdjustment`, which writes the subject-book entries and the journal
// together; a Draft and a Cancelled put the other two statuses on the register.

type AdjustmentSpec = {
  /** Which way the item should move, and by how much — the new value follows. */
  effect: "Increase" | "Decrease";
  book: "Piutang" | "Hutang" | "Titipan";
  partner: string;
  amount: number;
  reference?: string;
  /** This script's marker, as a document's note is elsewhere. */
  note: string;
  /** The Tanggal Dokumen, `YYYY-MM-DD`. */
  date: string;
  status: "Posted" | "Draft" | "Cancelled";
};


/** One Penyesuaian Open Item, written as the form saves it and posted when its status says so. */
async function writeAdjustment(spec: AdjustmentSpec, actor: number) {
  const already = await prisma.finItemAdjustment.findFirst({
    where: { note: spec.note },
    select: { id: true },
  });
  if (already) return;

  const idr = await prisma.refCurrency.findFirstOrThrow({
    where: { currency_label: "IDR" },
    select: { id: true },
  });
  const category = await prisma.sysBudgetCategory.findFirstOrThrow({
    where: { category_label: spec.book },
    select: { id: true },
  });
  const partner = await prisma.mPartner.findFirstOrThrow({
    where: { partner_name: spec.partner, company: { is_parent: true } },
    select: { id: true, company_id: true },
  });

  const header = await checkItemAdjustmentHeader(
    {
      budget_category_id: category.id,
      partner_id: partner.id,
      currency_id: idr.id,
      exchange_rate: null,
    },
    [partner.company_id]
  );
  if (!header.ok) {
    throw new Error(`Adjustment ${spec.note} refused: ${Object.values(header.errors).join(" ")}`);
  }

  // The oldest open item that can take the change, and the value it should
  // hold after it.
  const open = await openSubledgerItems([
    { bookId: category.id, partnerId: partner.id, currencyId: idr.id },
  ]);
  const item = open.find((i) => spec.effect === "Increase" || i.remaining >= spec.amount);
  if (!item) {
    console.log(`  skipped adjustment "${spec.note}": ${spec.partner} has no open item in ${spec.book} that can take it`);
    return;
  }
  const newAmount =
    spec.effect === "Increase" ? item.remaining + spec.amount : item.remaining - spec.amount;
  const checked = await checkItemAdjustmentLines(header, [
    { item_id: item.id, new_amount: newAmount },
  ]);
  if (!checked.ok) {
    throw new Error(`Adjustment ${spec.note} refused: ${Object.values(checked.errors).join(" ")}`);
  }

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.finItemAdjustment.create({
      data: {
        adjustment_no: await nextItemAdjustmentNo(tx),
        document_date: new Date(`${spec.date}T00:00:00Z`),
        company_id: partner.company_id,
        budget_category_id: category.id,
        partner_id: partner.id,
        currency_id: idr.id,
        exchange_rate: null,
        adjustment_amount: checked.total,
        reference: spec.reference ?? null,
        note: spec.note,
        status: "Draft",
        created_by: actor,
        lines: { create: adjustmentLineData(checked.lines, actor) },
      },
      select: { id: true, adjustment_no: true },
    });
    await valueItemAdjustmentDraft(tx, created.id, header, checked.lines, actor);
    return created;
  });
  await audit("fin_item_adjustment", row.id, actor);
  tally("penyesuaian open item");

  if (spec.status === "Posted") {
    const posted = await applyItemAdjustment(row.id, actor);
    if (!posted.ok) {
      throw new Error(`Posting ${row.adjustment_no} refused: ${Object.values(posted.errors).join(" ")}`);
    }
  } else if (spec.status === "Cancelled") {
    await prisma.finItemAdjustment.update({
      where: { id: row.id },
      data: { status: "Cancelled", updated_by: actor },
    });
  }
}


// ------------------------------------------------------------- the year
//
// The year is a plan: the Budgets it held, and the events that happened to
// them, **in date order**. Order is not cosmetic. A book refuses to go below
// zero and a layer to be overdrawn at the moment of posting, so a payroll run
// posted before the transfer that funded it would be refused exactly as it
// would be for a user — the runner sorts by date and posts in that order.
//
// It starts from the cash the closed year handed over (`CASH_BANKS`), and
// holds every live state: Drafts, a Pending Funding Request, a Submitted
// Budget and Cancelled documents. Only the induk holds cash; the anak's own
// spending reaches money through a Funding Request, which is what keeps the
// intercompany bridge moving on both Companies' Neraca.

type CbtEvent = {
  kind: "cbt";
  date: string;
  purpose: string;
  cashBank?: string;
  currency?: "IDR" | "USD";
  /** The kurs a foreign receipt was credited at — an input, where no layer is drawn. */
  rate?: number;
  partner?: string;
  note: string;
  lines: { budget: string; amount: number }[];
  status?: "Posted" | "Draft" | "Cancelled";
};

type Event =
  | CbtEvent
  | { kind: "transfer"; date: string; spec: TransferSpec; draft?: boolean }
  | {
      kind: "funding";
      date: string;
      purpose: string;
      partner?: string;
      note: string;
      budget: string;
      amount: number;
      confirmFrom?: string;
    }
  | { kind: "journal"; date: string; spec: ManualSpec }
  | { kind: "adjustment"; date: string; spec: AdjustmentSpec }
  | { kind: "conversion"; date: string; spec: ConversionSpec }
  | { kind: "reclass"; date: string; spec: ReclassSpec };

type YearPlan = { year: number; budgets: BudgetSpec[]; events: Event[] };

const transfer = (spec: TransferSpec, draft = false): Event => ({ kind: "transfer", date: spec.date, spec, draft });
const journal = (spec: ManualSpec): Event => ({ kind: "journal", date: spec.date, spec });
const adjustment = (spec: AdjustmentSpec): Event => ({ kind: "adjustment", date: spec.date, spec });
const reclass = (spec: ReclassSpec): Event => ({ kind: "reclass", date: spec.date, spec });

/**
 * The year being worked in. Everything here is dated on or before today's
 * date in the months it uses — no document may be dated ahead (§12).
 */
function currentYear(): YearPlan {
  return {
    year: YEAR,
    budgets: [
      { key: "gudang", company: "induk", date: day(1, 8), type: "Out", category: "Biaya", amount: 185_000_000, description: "Termin II kontraktor gudang Cikarang", status: "Closed" },
      { key: "advance", company: "induk", date: day(1, 15), type: "Out", category: "Piutang", partner: "Fauzan", amount: 25_000_000, description: "Advance perjalanan dinas Surabaya", status: "Open" },
      { key: "forklift", company: "induk", date: day(2, 3), type: "Out", category: "Asset", amount: 340_000_000, description: "Pembelian forklift gudang Cikarang", status: "Open" },
      { key: "penyertaan", company: "induk", date: day(2, 10), type: "Out", category: "Investasi", partner: "PT. Delta Surya Textile", amount: 500_000_000, description: "Penyertaan modal PT. Delta Surya Textile", status: "Open" },
      { key: "bagihasil", company: "induk", date: day(3, 5), type: "In", category: "Hasil Investasi", partner: "PT. Delta Atsiri Prima", amount: 120_000_000, description: "Bagi hasil semester I PT. Delta Atsiri Prima", status: "Submitted" },
      // Approved and waiting in Klasifikasi Budget, so that queue is not empty
      // — two of them alike, so its similar-classification hint has something
      // to point at and its bulk classification something to do.
      { key: "atk", company: "induk", date: day(3, 2), type: "Out", category: "Biaya", amount: 4_500_000, description: `Pembelian alat tulis kantor pusat kuartal II ${YEAR}`, status: "Approved" },
      { key: "atkgudang", company: "induk", date: day(3, 3), type: "Out", category: "Biaya", amount: 2_750_000, description: `Pembelian alat tulis kantor gudang kuartal II ${YEAR}`, status: "Approved" },
      { key: "advanceanak2", company: "anak", date: day(3, 4), type: "Out", category: "Piutang", partner: "Karyawan A", amount: 7_500_000, description: "Advance operasional Karyawan A Maret", status: "Approved" },
      { key: "modalkerja", company: "induk", date: day(1, 6), type: "In", category: "Hutang", partner: "MR.X", amount: 750_000_000, description: "Setoran modal kerja dari MR.X", status: "Closed" },
      { key: "prive", company: "induk", date: day(3, 12), type: "Out", category: "Prive", partner: "MR.X", amount: 90_000_000, description: "Pembayaran prive MR.X", status: "Open" },
      { key: "sparepart", company: "induk", date: day(2, 18), type: "Out", category: "Biaya", currency: "USD", amount: 12_000, description: "Pembelian spare part impor dari pemasok Singapura", status: "Open" },
      { key: "operasional", company: "anak", date: day(2, 24), type: "Out", category: "Biaya", amount: 65_000_000, description: "Biaya operasional gudang SBTC Februari", status: "Open" },
      { key: "advanceanak", company: "anak", date: day(2, 26), type: "Out", category: "Piutang", partner: "Karyawan A", amount: 15_000_000, description: "Advance operasional Karyawan A", status: "Open" },
      { key: "listrik", company: "induk", date: day(1, 5), type: "Out", category: "Biaya", amount: 8_100_000, description: `Tagihan listrik dan telepon Desember ${YEAR - 1}`, status: "Closed" },
      { key: "gaji", company: "induk", date: day(6, 10), type: "Out", category: "Biaya", amount: 130_000_000, description: `Gaji dan tunjangan karyawan semester I ${YEAR}`, status: "Closed" },
      { key: "bagihasilsby", company: "induk", date: day(6, 2), type: "In", category: "Hasil Investasi", partner: "PT. Delta Atsiri Prima", amount: 620_000_000, description: `Bagi hasil semester I ${YEAR} PT. Delta Atsiri Prima`, status: "Closed" },
      // A stakeholder's dollar Titipan, part of which is later cashed into
      // rupiah by a Pencairan Open Item.
      { key: "titipanadib", company: "induk", date: day(9, 1), type: "In", category: "Titipan", partner: "MR.X", currency: "USD", amount: 30_000, description: `Titipan dana impor bahan baku MR.X ${YEAR}`, status: "Closed" },
      // Money nobody could place when it moved, held until it could be.
      { key: "terimabt", company: "induk", date: day(6, 4), type: "In", category: "Penerimaan Belum Teridentifikasi", partner: "Lainnya", amount: 50_000_000, description: "Transfer masuk BCA tanpa berita, menunggu identifikasi pengirim", status: "Closed" },
      { key: "pinjamanadib", company: "induk", date: day(5, 19), type: "Out", category: "Piutang", partner: "MR.X", currency: "USD", amount: 2_000, description: "Pinjaman dolar kepada MR.X untuk uang muka impor", status: "Closed" },
      { key: "terimabtusd", company: "induk", date: day(6, 15), type: "In", category: "Penerimaan Belum Teridentifikasi", partner: "Lainnya", currency: "USD", amount: 2_000, description: "Transfer masuk USD dari bank koresponden tanpa keterangan", status: "Closed" },
      { key: "bayarbt", company: "induk", date: day(7, 1), type: "Out", category: "Pengeluaran Belum Teridentifikasi", partner: "Lainnya", amount: 12_500_000, description: "Debet rekening BCA tanpa dokumen pendukung", status: "Closed" },
    ],
    events: [
      { kind: "cbt", date: day(1, 8), purpose: "BYA_OUT", cashBank: "KAS", note: `Pembayaran tagihan listrik dan telepon Desember ${YEAR - 1}`, lines: [{ budget: "listrik", amount: 8_100_000 }] },
      { kind: "cbt", date: day(1, 9), purpose: "HTG_SH_IN", cashBank: "BCA-IDR", partner: "MR.X", note: "Setoran modal kerja, dikembalikan setelah kontrak selesai", lines: [{ budget: "modalkerja", amount: 750_000_000 }] },
      transfer({ purpose: "Transfer", from: "BCA-IDR", currency: "IDR", rate: 1, date: day(1, 12), note: `Pengisian kas dan rekening payroll semester I ${YEAR}`, lines: [{ to: "KAS", amount: 50_000_000 }, { to: "MDR-IDR", amount: 200_000_000 }] }),
      { kind: "cbt", date: day(1, 20), purpose: "BYA_OUT", cashBank: "BCA-IDR", note: "Termin II sesuai berita acara serah terima", lines: [{ budget: "gudang", amount: 185_000_000 }] },
      { kind: "cbt", date: day(1, 22), purpose: "PTG_KRY_OUT", cashBank: "MDR-IDR", partner: "Fauzan", note: "Advance perjalanan dinas, dipertanggungjawabkan setelah kembali", lines: [{ budget: "advance", amount: 10_000_000 }] },
      adjustment({ effect: "Increase", book: "Piutang", partner: "Fauzan", amount: 1_250_000, reference: "SPD-SBY-0142", note: "Kelebihan klaim uang harian perjalanan dinas Surabaya, dibebankan kembali", date: day(2, 3), status: "Posted" }),
      // Taken back, so Cancelled is on the screen too.
      { kind: "cbt", date: day(2, 10), purpose: "AST_OUT", cashBank: "BCA-IDR", note: "Dibatalkan — unit tidak tersedia, pengadaan diulang", lines: [{ budget: "forklift", amount: 340_000_000 }], status: "Cancelled" },
      adjustment({ effect: "Decrease", book: "Hutang", partner: "MR.X", amount: 2_000_000, note: "Dibatalkan — selisih sudah diselesaikan lewat transfer", date: day(2, 20), status: "Cancelled" }),
      // Still waiting, so the induk's queue is not empty.
      { kind: "funding", date: day(2, 27), purpose: "BYA_OUT", note: "Operasional gudang Februari, menunggu konfirmasi induk", budget: "operasional", amount: 65_000_000 },
      // Confirmed. The anak's Purpose keeps a subject book, so its own Piutang
      // against Karyawan A is written — while the position between the two
      // Companies goes to the bridge accounts (§10 rule 61).
      { kind: "funding", date: day(3, 2), purpose: "PTG_KRY_OUT", partner: "Karyawan A", note: "Advance operasional cabang, dipertanggungjawabkan akhir bulan", budget: "advanceanak", amount: 15_000_000, confirmFrom: "BCA-IDR" },
      { kind: "cbt", date: day(3, 3), purpose: "BYA_OUT", cashBank: "BCA-USD", currency: "USD", note: "Pembayaran pemasok Singapura, invoice SG-2291", lines: [{ budget: "sparepart", amount: 5_000 }] },
      adjustment({ effect: "Decrease", book: "Piutang", partner: "Fauzan", amount: 350_000, note: "Biaya tol dan parkir disetujui, mengurangi advance", date: day(3, 10), status: "Draft" }),
      // A Draft, left as one: it has moved nothing, which is what Draft means.
      { kind: "cbt", date: day(3, 20), purpose: "PRV_SH_OUT", cashBank: "KAS", partner: "MR.X", note: "Menunggu konfirmasi jadwal pencairan", lines: [{ budget: "prive", amount: 30_000_000 }], status: "Draft" },
      adjustment({ effect: "Increase", book: "Hutang", partner: "MR.X", amount: 7_500_000, reference: `SK-MRX-03/${YEAR}`, note: "Kompensasi atas setoran modal kerja kuartal I", date: day(3, 31), status: "Posted" }),
      // Left as a Draft, because Draft is the one status only a manual journal
      // ever has — and the reports must be seen leaving it out.
      journal({
        description: "Akrual listrik dan telepon Maret",
        date: day(3, 31),
        post: false,
        lines: [
          { account: "Biaya Listrik, Air dan Telepon", debit: 8_400_000, description: "Tagihan Maret belum jatuh tempo" },
          { account: "Hutang Listrik dan Telepon", credit: 8_400_000, description: "Tagihan Maret belum jatuh tempo" },
        ],
      }),
      // Dollars from the layer acquired at 15.750, sold at 16.100: a realized gain.
      transfer({ purpose: "Pencairan", from: "BCA-USD", currency: "USD", rate: 16_100, date: day(4, 8), note: "Pencairan valas untuk kebutuhan rupiah operasional", lines: [{ to: "BCA-IDR", amount: 20_000 }] }),
      transfer({ purpose: "PembelianValas", from: "BCA-IDR", currency: "USD", rate: 16_050, date: day(5, 12), note: "Pembelian valas untuk pembayaran pemasok kuartal II", lines: [{ to: "BCA-USD", amount: 10_000 }, { to: "MDR-USD", amount: 5_000 }] }),
      { kind: "cbt", date: day(6, 24), purpose: "BYA_OUT", cashBank: "MDR-IDR", note: `Gaji dan tunjangan karyawan semester I ${YEAR}`, lines: [{ budget: "gaji", amount: 130_000_000 }] },
      { kind: "cbt", date: day(7, 13), purpose: "HIN_CAB_IN", cashBank: "BCA-IDR", partner: "PT. Delta Atsiri Prima", note: `Bagi hasil semester I ${YEAR} PT. Delta Atsiri Prima diterima`, lines: [{ budget: "bagihasilsby", amount: 620_000_000 }] },
      transfer({ purpose: "Transfer", from: "BCA-IDR", currency: "IDR", rate: 1, date: day(8, 28), note: "Menunggu jadwal pembayaran gaji akhir bulan", lines: [{ to: "MDR-IDR", amount: 120_000_000 }] }, true),
      { kind: "cbt", date: day(9, 3), purpose: "TTP_SH_IN", cashBank: "BCA-USD", currency: "USD", rate: 16_150, partner: "MR.X", note: "Titipan dana impor bahan baku dari MR.X", lines: [{ budget: "titipanadib", amount: 30_000 }] },
      // MR.X asks for a third of it in rupiah. The dollars are sold out of a
      // layer bought before its Titipan arrived, and both legs go at 16.250 —
      // one Selisih Kurs line for the gap between the two carrying rates.
      { kind: "conversion", date: day(9, 10), spec: { date: day(9, 10), from: "BCA-USD", layerBy: day(9, 2), book: "Titipan", partner: "MR.X", rate: 16_250, note: "Pencairan sebagian titipan MR.X ke rupiah", lines: [{ to: "BCA-IDR", amount: 10_000 }] } },
      // Held money, and where it turned out to belong. Rp 50 juta arrived
      // with no berita; two weeks later it is identified as Rp 30 juta of
      // MR.X's working capital and a Rp 15 juta deposit from
      // PT. Delta Atsiri Prima — the last Rp 5 juta is still held.
      { kind: "cbt", date: day(6, 5), purpose: "PBT_IN", cashBank: "BCA-IDR", partner: "Lainnya", note: "Transfer masuk tanpa berita, ditampung sampai pengirim teridentifikasi", lines: [{ budget: "terimabt", amount: 50_000_000 }] },
      reclass({ date: day(6, 19), book: "Penerimaan Belum Teridentifikasi", partner: "Lainnya", currency: "IDR", note: "Identifikasi transfer masuk 5 Juni berdasarkan konfirmasi pengirim", lines: [
        { book: "Hutang", partner: "MR.X", description: "Tambahan setoran modal kerja MR.X", from: "terimabt", amount: 30_000_000 },
        { book: "Titipan", partner: "PT. Delta Atsiri Prima", description: "Titipan dana pembelian armada PT. Delta Atsiri Prima", from: "terimabt", amount: 15_000_000 },
      ] }),
      // A dollar loan to MR.X, and an unexplained dollar receipt that turns
      // out to be its repayment: the held receipt settles the Piutang, and the
      // gap between the two kurs is a realized difference of its own.
      { kind: "cbt", date: day(5, 20), purpose: "PTG_SH_OUT", cashBank: "BCA-USD", currency: "USD", partner: "MR.X", note: "Pinjaman dolar MR.X untuk uang muka impor", lines: [{ budget: "pinjamanadib", amount: 2_000 }] },
      { kind: "cbt", date: day(6, 16), purpose: "PBT_IN", cashBank: "BCA-USD", currency: "USD", rate: 16_300, partner: "Lainnya", note: "Transfer masuk USD dari bank koresponden tanpa keterangan", lines: [{ budget: "terimabtusd", amount: 2_000 }] },
      reclass({ date: day(6, 30), book: "Penerimaan Belum Teridentifikasi", partner: "Lainnya", currency: "USD", note: "Transfer USD 16 Juni teridentifikasi sebagai pelunasan pinjaman MR.X", lines: [
        { book: "Piutang", partner: "MR.X", description: "Pelunasan pinjaman dolar MR.X", from: "terimabtusd", amount: 2_000, settle: "pinjamanadib" },
      ] }),
      // A bank debit with no document, later owned up to as a staff advance.
      { kind: "cbt", date: day(7, 2), purpose: "PeBT_OUT", cashBank: "BCA-IDR", partner: "Lainnya", note: "Debet rekening BCA tanpa dokumen pendukung, ditampung", lines: [{ budget: "bayarbt", amount: 12_500_000 }] },
      reclass({ date: day(7, 21), book: "Pengeluaran Belum Teridentifikasi", partner: "Lainnya", currency: "IDR", note: "Debet BCA 2 Juli teridentifikasi sebagai kasbon Fauzan", lines: [
        { book: "Piutang", partner: "Fauzan", description: "Kasbon Fauzan, dipotong dari gaji", from: "bayarbt", amount: 12_500_000 },
      ] }),
    ],
  };
}

const PLANS: YearPlan[] = [currentYear()];

/** One Cash Bank Transaction: drafted, then posted, cancelled or left as it is. */
async function runCbt(e: CbtEvent, budgets: Map<string, number>, actor: number) {
  // A payment out of a foreign resource draws on one layer, at its kurs.
  const resource = e.cashBank
    ? await prisma.mCashBank.findFirstOrThrow({
        where: { cash_bank_label: e.cashBank },
        select: { currency: { select: { currency_label: true } } },
      })
    : null;
  const total = e.lines.reduce((t, l) => t + l.amount, 0);
  const foreign = resource && resource.currency.currency_label !== "IDR";
  const already = await prisma.finCashBankTransaction.findFirst({
    where: { note: e.note },
    select: { id: true },
  });
  if (already) return;
  const layer =
    foreign && purposeDirection(e.purpose) === "Out"
      ? await layerFor(e.cashBank!, total, e.date)
      : null;

  const id = await draftDocument({
    purposeKey: e.purpose,
    cashBank: e.cashBank,
    currency: e.currency,
    partner: e.partner,
    date: e.date,
    note: e.note,
    layerId: layer?.id ?? null,
    rate: layer?.rate ?? e.rate,
    lines: e.lines.map((l) => {
      const budgetId = budgets.get(l.budget);
      if (!budgetId) throw new Error(`No Budget "${l.budget}" for "${e.note}".`);
      return { budgetId, amount: l.amount };
    }),
  });
  if (!id) return;

  if (e.status === "Cancelled") {
    await prisma.finCashBankTransaction.update({
      where: { id },
      data: { status: "Cancelled", updated_by: actor },
    });
  } else if (e.status !== "Draft") {
    await post(id, actor, e.note);
  }
}

/** A Purpose key's direction, read off its suffix as `SEED_PURPOSES` spells it. */
const purposeDirection = (key: string): "In" | "Out" => (key.endsWith("_IN") ? "In" : "Out");

async function runPlan(plan: YearPlan, actor: number) {
  const budgets = await insertBudgets(plan.budgets, actor);
  // Stable, so two events on one day keep the order the plan wrote them in.
  const events = [...plan.events].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of events) {
    switch (e.kind) {
      case "cbt":
        await runCbt(e, budgets, actor);
        break;
      case "transfer":
        if (e.draft) await draftTransfer(e.spec, actor);
        else await postTransfer(e.spec, actor);
        break;
      case "funding": {
        const budgetId = budgets.get(e.budget);
        if (!budgetId) throw new Error(`No Budget "${e.budget}" for "${e.note}".`);
        await fund(
          {
            purposeKey: e.purpose,
            partner: e.partner,
            note: e.note,
            budgetId,
            amount: e.amount,
            date: e.date,
            confirmFrom: e.confirmFrom,
          },
          actor
        );
        break;
      }
      case "journal":
        await writeManualJournal(e.spec, actor);
        break;
      case "adjustment":
        await writeAdjustment(e.spec, actor);
        break;
      case "conversion":
        await postConversion(e.spec, actor);
        break;
      case "reclass":
        await postReclass(e.spec, budgets, actor);
        break;
    }
  }
}

async function main() {
  const actor = await actorId();

  const companies = await prisma.sysCompany.findMany({
    orderBy: { is_parent: "desc" },
    select: { id: true, company_label: true, is_parent: true },
  });
  if (companies.length !== 2) {
    throw new Error(
      `Expected the two seeded Companies, found ${companies.length}. Run npm run db:seed first.`
    );
  }

  // A Partner belongs to one Company and cannot be moved between them, so each
  // Company gets its own set. `partner_label` is unique across the whole table,
  // which is why the two lists share no label.
  const induk = companies.find((c) => c.is_parent)!;
  await nameCompanies(actor);
  const foreignId = await ensureForeignCurrency(actor);
  await insertPartners(induk.id, PARTNERS, actor);
  await insertPartners(companies.find((c) => !c.is_parent)!.id, ANAK_PARTNERS, actor);

  // A chart of accounts, on the other hand, is per Company: the same numbers
  // on a different Company are different records.
  for (const company of companies) {
    await insertChart(company.id, company.company_label, company.is_parent, actor);
  }

  // After the chart, because a mapping points at an account in it.
  for (const company of companies) {
    await insertMappings(company.id, company.company_label, actor);
  }

  // And after both, because each of these names an account.
  await setDefaults(actor);
  // Every year opened before anything is posted or closed: nothing may be
  // activated behind a close, and the resources are registered on the first
  // working day of the history.
  await ensureFiscalYears(actor);
  await insertCashBanks(induk.id, foreignId, actor);
  // After the cash, because the Opening Balance states what the books hold.
  await injectClosedYear(actor);

  if (MASTER_ONLY) {
    report();
    return;
  }

  // The years in order, each posted through the real engine. The oldest is
  // closed by both Companies once its own events are in — after that nothing
  // may be posted into it — and the later years then run as its successors.
  for (const plan of PLANS) {
    await runPlan(plan, actor);
  }

  report();
}

/**
 * Who the rows are attributed to. The administrator, because this is data a
 * person would have entered; the system account is the fallback so the script
 * still runs on a database where the administrator was renamed.
 */
async function actorId(): Promise<number> {
  const user =
    (await prisma.sysUser.findFirst({
      where: { email: "admin@siba.app" },
      select: { id: true },
    })) ??
    (await prisma.sysUser.findFirst({
      where: { email: "sistem@siba.app" },
      select: { id: true },
    }));
  if (!user) throw new Error("No user to attribute to. Run npm run db:seed first.");
  return user.id;
}

async function audit(entityKey: string, rowId: number, by: number) {
  await prisma.auditLog.create({
    data: { entity_key: entityKey, row_id: rowId, action: "TAMBAH", by },
  });
}

/** Next system code for a table, e.g. `part.0007`. Mirrors `nextCode`. */
async function nextCode(prefix: string, existing: string[]): Promise<string> {
  let max = 0;
  for (const code of existing) {
    const n = Number(String(code ?? "").split(".")[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}.${String(max + 1).padStart(4, "0")}`;
}

// ----------------------------------------------------------------- partners

async function insertPartners(
  companyId: number,
  partners: typeof PARTNERS,
  actor: number
) {
  const categories = new Map(
    (
      await prisma.sysPartnerCategory.findMany({
        select: { id: true, category_label: true },
      })
    ).map((c) => [c.category_label, c.id])
  );

  for (const [label, name, categoryLabel] of partners) {
    const categoryId = categories.get(categoryLabel);
    if (!categoryId) {
      throw new Error(`Partner Category "${categoryLabel}" is not seeded.`);
    }

    const existing = await prisma.mPartner.findFirst({
      where: { partner_label: { equals: label, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) continue;

    const codes = await prisma.mPartner.findMany({ select: { partner_code: true } });
    const row = await prisma.mPartner.create({
      data: {
        partner_code: await nextCode("part", codes.map((c) => c.partner_code)),
        partner_label: label,
        partner_name: name,
        company_id: companyId,
        category_id: categoryId,
        note: PARTNER_NOTE,
        created_by: actor,
      },
      select: { id: true },
    });
    await audit("m_partner", row.id, actor);
    tally("partners");
  }
}

// ----------------------------------------------------------------- mappings

async function insertMappings(companyId: number, companyLabel: string, actor: number) {
  const budgetCategories = new Map(
    (
      await prisma.sysBudgetCategory.findMany({
        select: { id: true, category_label: true },
      })
    ).map((c) => [c.category_label, c.id])
  );
  const partnerCategories = new Map(
    (
      await prisma.sysPartnerCategory.findMany({
        select: { id: true, category_label: true },
      })
    ).map((c) => [c.category_label, c.id])
  );
  const accounts = new Map(
    (
      await prisma.accAccount.findMany({
        where: { company_id: companyId },
        select: { id: true, account_name: true, is_postable: true, is_active: true },
      })
    ).map((a) => [a.account_name.toLowerCase(), a])
  );

  for (const [budgetLabel, partnerLabel, accountName] of MAPPINGS) {
    const budgetCategoryId = budgetCategories.get(budgetLabel);
    if (!budgetCategoryId) {
      throw new Error(`Budget Category "${budgetLabel}" is not seeded.`);
    }
    const partnerCategoryId = partnerLabel
      ? partnerCategories.get(partnerLabel) ?? null
      : null;
    if (partnerLabel && !partnerCategoryId) {
      throw new Error(`Partner Category "${partnerLabel}" is not seeded.`);
    }

    const account = accounts.get(accountName.toLowerCase());
    if (!account) {
      // The chart above creates every account named here, so a miss means the
      // two lists have drifted apart rather than that the database is short.
      throw new Error(
        `${companyLabel}: no account named "${accountName}". MAPPINGS and CHART disagree.`
      );
    }
    // The same rule the Server Action enforces: a mapping resolves to exactly
    // one postable, active account of that Company.
    if (!account.is_postable || !account.is_active) {
      throw new Error(
        `${companyLabel}: "${accountName}" is not a postable, active account.`
      );
    }

    const existing = await prisma.accBudgetCategoryAccount.findFirst({
      where: {
        company_id: companyId,
        budget_category_id: budgetCategoryId,
        partner_category_id: partnerCategoryId,
      },
      select: { id: true },
    });
    if (existing) continue;

    const codes = await prisma.accBudgetCategoryAccount.findMany({
      select: { bca_code: true },
    });
    const row = await prisma.accBudgetCategoryAccount.create({
      data: {
        bca_code: await nextCode("bcam", codes.map((c) => c.bca_code)),
        company_id: companyId,
        budget_category_id: budgetCategoryId,
        partner_category_id: partnerCategoryId,
        account_id: account.id,
        created_by: actor,
      },
      select: { id: true },
    });
    await audit("acc_budget_category_account", row.id, actor);
    tally(`mappings (${companyLabel})`);
  }
}

// ----------------------------------------------------------------- accounts

async function insertChart(
  companyId: number,
  companyLabel: string,
  isParent: boolean,
  actor: number
) {
  const subcategories = new Map(
    (
      await prisma.accAccountSubcategory.findMany({
        select: { id: true, subcategory_label: true },
      })
    ).map((s) => [s.subcategory_label, s.id])
  );
  const partnerCategories = new Map(
    (
      await prisma.sysPartnerCategory.findMany({
        select: { id: true, category_label: true },
      })
    ).map((c) => [c.category_label, c.id])
  );

  for (const group of [cashGroup(isParent ? INDUK_BANKS : ANAK_BANKS), ...CHART]) {
    const subcategoryId = subcategories.get(group.kelompok);
    if (!subcategoryId) {
      throw new Error(
        `Kelompok ${group.kelompok} is not seeded. Run npm run db:seed first.`
      );
    }
    await insertNodes(group.accounts, {
      companyId,
      companyLabel,
      actor,
      subcategoryId,
      groupBalance: group.balance,
      parentId: null,
      parentLabel: group.kelompok,
      partnerCategories,
    });
  }
}

type Context = {
  companyId: number;
  companyLabel: string;
  actor: number;
  subcategoryId: number;
  groupBalance: Balance;
  parentId: number | null;
  parentLabel: string;
  partnerCategories: Map<string, number>;
};

async function insertNodes(nodes: AccountNode[], ctx: Context) {
  for (const node of nodes) {
    const id = await insertNode(node, ctx);
    if (node.children?.length) {
      const parent = await prisma.accAccount.findUniqueOrThrow({
        where: { id },
        select: { account_label: true },
      });
      await insertNodes(node.children, {
        ...ctx,
        parentId: id,
        parentLabel: parent.account_label,
      });
    }
  }
}

async function insertNode(node: AccountNode, ctx: Context): Promise<number> {
  // Matched by name under the same parent rather than by number: the number is
  // whatever the chart had free when the account was created, so it is not a
  // stable way to recognise a row that is already there.
  const existing = await prisma.accAccount.findFirst({
    where: {
      company_id: ctx.companyId,
      parent_account: ctx.parentId,
      account_name: { equals: node.name, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const partnerCategoryId = node.partnerCategory
    ? ctx.partnerCategories.get(node.partnerCategory) ?? null
    : null;
  if (node.partnerCategory && !partnerCategoryId) {
    throw new Error(`Partner Category "${node.partnerCategory}" is not seeded.`);
  }

  const codes = await prisma.accAccount.findMany({ select: { account_code: true } });
  const row = await prisma.accAccount.create({
    data: {
      account_code: await nextCode("coa", codes.map((c) => c.account_code)),
      account_label: await freeNumber(ctx.companyId, ctx.parentLabel),
      account_name: node.name,
      company_id: ctx.companyId,
      account_subcategory_id: ctx.subcategoryId,
      parent_account: ctx.parentId,
      is_postable: !node.header,
      normal_balance: node.balance ?? ctx.groupBalance,
      require_partner: Boolean(partnerCategoryId),
      partner_category_id: partnerCategoryId,
      // A subledger account is exactly the thing a control account reconciles:
      // its GL balance against the Hutang / Piutang / Titipan / Prive book.
      is_control_account: Boolean(partnerCategoryId),
      created_by: ctx.actor,
    },
    select: { id: true },
  });
  await audit("acc_account", row.id, ctx.actor);
  tally(`accounts (${ctx.companyLabel})`);
  return row.id;
}

/**
 * The next unused number under `parentLabel` in this Company.
 *
 * Exact labels are compared rather than a prefix: `1.1.1.2.1` starts with
 * `1.1.1.2.` but is a grandchild, not a sibling competing for the number.
 */
async function freeNumber(companyId: number, parentLabel: string): Promise<string> {
  const siblings = await prisma.accAccount.findMany({
    where: { company_id: companyId, account_label: { startsWith: `${parentLabel}.` } },
    select: { account_label: true },
  });
  const taken = new Set(siblings.map((a) => a.account_label));
  for (let segment = 1; segment <= 999; segment += 1) {
    const label = `${parentLabel}.${segment}`;
    if (!taken.has(label)) return label;
  }
  throw new Error(`No free account number left under ${parentLabel}`);
}

function report() {
  const rows = Object.entries(made);
  if (!rows.length) {
    console.log("\nNothing to add — every sample record was already there.\n");
    return;
  }
  console.log("");
  for (const [what, n] of rows) console.log(`  ${String(n).padStart(4)}  ${what}`);
  if (MASTER_ONLY) {
    console.log("\nMaster data and chart of accounts only — no Budget, document or journal.");
  }
  console.log(
    "\nSample data only. This is not the seeder: these are ordinary records," +
      "\nand they can be edited or deactivated through the application.\n"
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
