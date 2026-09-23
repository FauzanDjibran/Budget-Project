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
 * **Anything posted goes through the real engine.** `applyPosting`,
 * `applyTransfer`, `confirmFundingRequest` and `applyDncn` write the Cash Bank Book, the
 * subject books, the journal and the rate layers together, inside one
 * transaction each. Inserting those rows directly would be faster and would
 * produce reports whose figures do not reconcile — which is worse than empty,
 * because it looks like the application is wrong.
 *
 * Additive and idempotent: every step reuses what is already there and nothing
 * is ever deleted. Running it twice does not double anything.
 */
import "dotenv/config";
import { openCashBankBook } from "@/lib/siba/cash-bank";
import { ensureFiscalPeriods, fiscalYearShape } from "@/lib/siba/fiscal";
import { syncControlAccounts } from "@/lib/siba/records";
import { systemDefaultAccountIds, writeSystemDefaults } from "@/lib/siba/system-settings";
import { nextBudgetNo } from "@/lib/siba/budget";
import { applyPosting } from "@/lib/siba/finance";
import { purposeByKey } from "@/lib/siba/purposes";
import { nextDocumentNumber } from "@/lib/siba/document-number";
import { applyTransfer, nextTransferNo } from "@/lib/siba/transfer";
import { confirmFundingRequest, raiseFundingRequest } from "@/lib/siba/funding";
import { createManualJournal, postManualJournal } from "@/lib/siba/manual-journal";
import { applyDncn, nextNoteNo } from "@/lib/siba/dncn";
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
  partnerCategory?: "Cabang" | "Karyawan" | "Stakeholder";
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

const CHART: Group[] = [
  {
    kelompok: "1.1.1",
    balance: "Debit",
    accounts: [
      {
        name: "Kas",
        header: true,
        children: [{ name: "Kas Besar" }, { name: "Kas Kecil" }],
      },
      {
        name: "Bank",
        header: true,
        children: [
          { name: "Bank Mandiri" },
          { name: "Bank BCA" },
          // A foreign resource posts to its own account, so the currency is
          // readable from the chart rather than only from the resource.
          { name: "Bank BCA Valas" },
        ],
      },
    ],
  },
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
    accounts: [{ name: "Uang Muka Pembelian" }],
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
    // Neither is ever posted to: the Neraca computes both figures and places
    // them here, through the System Defaults below.
    accounts: [
      { name: "Laba Rugi Tahun Berjalan" },
      { name: "Laba Rugi Tahun Lalu Belum Ditutup" },
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
      // Where a Debit Note's counter side lands, through its System Default.
      { name: "Pendapatan Penyesuaian Nota Debit" },
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
      // Where a Credit Note's counter side lands, through its System Default.
      { name: "Beban Penyesuaian Nota Kredit" },
    ],
  },
];

/** Two per Partner Category, named plainly because they are placeholders. */
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

const PARTNERS: [label: string, name: string, category: string][] = [
  ["SBY", "Cabang Surabaya", "Cabang"],
  ["MDN", "Cabang Medan", "Cabang"],
  ["MKS", "Cabang Makassar", "Cabang"],
  ["BDS", "Budi Santoso", "Karyawan"],
  ["SRW", "Siti Rahmawati", "Karyawan"],
  ["AGW", "Agus Wijaya", "Karyawan"],
  ["SYH", "H. Suryanto Halim", "Stakeholder"],
  ["RDK", "Ratna Dewi Kusuma", "Stakeholder"],
  ["MAS", "PT Mitra Abadi Sentosa", "Stakeholder"],
];

/**
 * The anak's own Partners.
 *
 * A Partner belongs to one Company and cannot be moved between them, and a
 * Budget's Partner must belong to that Budget's Company (§10 rule 26) — so the
 * anak needs its own, or its Partner list is empty and its Budgets can only use
 * the two categories that name nobody. It also makes the Company filter on the
 * Partner list a control that does something.
 */
const ANAK_PARTNERS: [label: string, name: string, category: string][] = [
  ["DKW", "Dedi Kurniawan", "Karyawan"],
  ["LSW", "Lina Setiawati", "Karyawan"],
  ["HPT", "Hendra Pranata", "Stakeholder"],
];

const PARTNER_NOTE = "";

/** The year everything is dated in, so the fiscal calendar and the reports agree. */
const YEAR = new Date().getUTCFullYear();
const OPENING_DATE = `${YEAR}-01-02`;
const day = (month: number, date: number) =>
  `${YEAR}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;

/** The foreign currency, so rate layers and an FX difference have somewhere to live. */
const FOREIGN = { label: "USD", name: "Dolar Amerika Serikat" };

/**
 * Where the money is. All on the induk: the anak holds no Cash & Bank by
 * design, and reaches money through a Funding Request (§10 rule 38).
 *
 * The opening balance becomes the resource's first book entry, and on the
 * foreign one its first rate layer — which is what the Posisi Layer Kurs report
 * and any FX difference are drawn from.
 */
const CASH_BANKS: {
  label: string;
  name: string;
  type: "Cash" | "Bank";
  currency: "IDR" | "USD";
  account: string;
  opening: number;
  rate?: number;
}[] = [
  { label: "KAS-PST", name: "Kas Besar Kantor Pusat", type: "Cash", currency: "IDR", account: "Kas Besar", opening: 75_000_000 },
  { label: "BCA-OPS", name: "BCA Giro Operasional", type: "Bank", currency: "IDR", account: "Bank BCA", opening: 1_850_000_000 },
  { label: "MDR-PAY", name: "Mandiri Giro Payroll", type: "Bank", currency: "IDR", account: "Bank Mandiri", opening: 420_000_000 },
  { label: "BCA-USD", name: "BCA Valas USD", type: "Bank", currency: "USD", account: "Bank BCA Valas", opening: 60_000, rate: 15_850 },
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

  ["Asset", null, "Inventaris Kantor"],
  ["Biaya", null, "Biaya Umum Lain-lain"],
];

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
 * confirmation journals, where an FX difference lands, and where a Debit /
 * Credit Note's counter side posts.
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
    {
      default_currency: String(idr.id),
      induk_bridge_ar_account: String(await accountId(induk.id, "Piutang Perusahaan Afiliasi")),
      induk_bridge_ap_account: String(await accountId(induk.id, "Hutang kepada Perusahaan Afiliasi")),
      anak_bridge_ar_account: String(await accountId(anak.id, "Piutang Perusahaan Afiliasi")),
      anak_bridge_ap_account: String(await accountId(anak.id, "Hutang kepada Perusahaan Afiliasi")),
      induk_fx_account: String(await accountId(induk.id, "Selisih Kurs")),
      anak_fx_account: String(await accountId(anak.id, "Selisih Kurs")),
      induk_accumulated_pl_account: String(await accountId(induk.id, "Laba Ditahan")),
      anak_accumulated_pl_account: String(await accountId(anak.id, "Laba Ditahan")),
      induk_unclosed_pl_account: String(await accountId(induk.id, "Laba Rugi Tahun Lalu Belum Ditutup")),
      anak_unclosed_pl_account: String(await accountId(anak.id, "Laba Rugi Tahun Lalu Belum Ditutup")),
      induk_current_pl_account: String(await accountId(induk.id, "Laba Rugi Tahun Berjalan")),
      anak_current_pl_account: String(await accountId(anak.id, "Laba Rugi Tahun Berjalan")),
      induk_debit_note_account: String(await accountId(induk.id, "Pendapatan Penyesuaian Nota Debit")),
      induk_credit_note_account: String(await accountId(induk.id, "Beban Penyesuaian Nota Kredit")),
      anak_debit_note_account: String(await accountId(anak.id, "Pendapatan Penyesuaian Nota Debit")),
      anak_credit_note_account: String(await accountId(anak.id, "Beban Penyesuaian Nota Kredit")),
    },
    actor
  );
  tally("system defaults", changed.length);

  // What the Server Action does after every settings write: an account a
  // posting engine or a statement owns is closed to hand entry.
  const named = await systemDefaultAccountIds();
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
      await openCashBankBook(tx, {
        cashBankId: created.id,
        openingBalance: spec.opening,
        rate: spec.rate ?? 1,
        layered,
        date: OPENING_DATE,
        actorId: actor,
      });
      return created;
    });
    await audit("m_cash_bank", row.id, actor);
    tally("cash & bank");
  }
}

/** The fiscal year, opened so its twelve periods exist and Budget Month works. */
async function ensureFiscalYear(actor: number) {
  const label = String(YEAR);
  let row = await prisma.accFiscalYear.findFirst({
    where: { year_label: label },
    select: { id: true, status: true },
  });
  if (!row) {
    const shape = fiscalYearShape(YEAR);
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
      await ensureFiscalPeriods(tx, { fiscalYearId: row!.id, year: YEAR, actorId: actor });
    });
    tally("fiscal periods", 12);
  }
}

// ------------------------------------------------------- what the year held
//
// Budgets first, because everything Finance does realizes one. Each names its
// classification the way an approver would have set it (§10 rule 26), so the
// ones that are Open or Closed are already past that gate.

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
  status: "Submitted" | "Open" | "Closed";
};

const BUDGETS: BudgetSpec[] = [
  { key: "gudang", company: "induk", date: day(1, 8), type: "Out", category: "Biaya", amount: 185_000_000, description: "Termin II kontraktor gudang Cikarang", status: "Closed" },
  { key: "advance", company: "induk", date: day(1, 15), type: "Out", category: "Piutang", partner: "Budi Santoso", amount: 25_000_000, description: "Advance perjalanan dinas Surabaya", status: "Open" },
  { key: "forklift", company: "induk", date: day(2, 3), type: "Out", category: "Asset", amount: 340_000_000, description: "Pembelian forklift gudang Cikarang", status: "Open" },
  { key: "penyertaan", company: "induk", date: day(2, 10), type: "Out", category: "Investasi", partner: "Cabang Medan", amount: 500_000_000, description: "Penyertaan modal Cabang Medan", status: "Open" },
  { key: "bagihasil", company: "induk", date: day(3, 5), type: "In", category: "Hasil Investasi", partner: "Cabang Surabaya", amount: 120_000_000, description: "Bagi hasil semester I Cabang Surabaya", status: "Submitted" },
  { key: "modalkerja", company: "induk", date: day(1, 6), type: "In", category: "Hutang", partner: "H. Suryanto Halim", amount: 750_000_000, description: "Setoran modal kerja dari H. Suryanto Halim", status: "Closed" },
  { key: "prive", company: "induk", date: day(3, 12), type: "Out", category: "Prive", partner: "H. Suryanto Halim", amount: 90_000_000, description: "Pembayaran prive H. Suryanto Halim", status: "Open" },
  { key: "sparepart", company: "induk", date: day(2, 18), type: "Out", category: "Biaya", currency: "USD", amount: 12_000, description: "Pembelian spare part impor dari pemasok Singapura", status: "Open" },
  { key: "operasional", company: "anak", date: day(2, 24), type: "Out", category: "Biaya", amount: 65_000_000, description: "Biaya operasional gudang SBTC Februari", status: "Open" },
  { key: "advanceanak", company: "anak", date: day(2, 26), type: "Out", category: "Piutang", partner: "Dedi Kurniawan", amount: 15_000_000, description: "Advance operasional Dedi Kurniawan", status: "Open" },
];

async function insertBudgets(actor: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const companies = await prisma.sysCompany.findMany({ select: { id: true, is_parent: true } });
  const idOf = (which: "induk" | "anak") =>
    companies.find((c) => c.is_parent === (which === "induk"))!.id;
  const categories = new Map(
    (await prisma.sysBudgetCategory.findMany({ select: { id: true, category_label: true } }))
      .map((c) => [c.category_label, c.id])
  );
  const partners = new Map(
    (await prisma.mPartner.findMany({ select: { id: true, partner_name: true } }))
      .map((x) => [x.partner_name, x.id])
  );
  const currencies = new Map(
    (await prisma.refCurrency.findMany({ select: { id: true, currency_label: true } }))
      .map((c) => [c.currency_label, c.id])
  );

  for (const spec of BUDGETS) {
    const existing = await prisma.budBudget.findFirst({
      where: { description: spec.description },
      select: { id: true },
    });
    if (existing) {
      out.set(spec.key, existing.id);
      continue;
    }

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
        // A Submitted budget has not been classified yet; the other two have,
        // because approval is what classifies (§10 rules 25–26).
        category_id: spec.status === "Submitted" ? null : categories.get(spec.category)!,
        partner_id:
          spec.status === "Submitted" || !spec.partner
            ? null
            : partners.get(spec.partner)!,
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

/** A Draft Cash Bank Transaction, shaped the way the Server Action shapes one. */
async function draftDocument(options: {
  purposeKey: string;
  cashBank?: string;
  currency?: "IDR" | "USD";
  partner?: string;
  company?: "induk" | "anak";
  rate?: number;
  layerId?: number | null;
  note?: string;
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
  const purpose = await purposeByKey(options.purposeKey);
  if (!purpose) throw new Error(`No Purpose ${options.purposeKey} — run npm run db:seed.`);

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

  const partnerId = options.partner
    ? (
        await prisma.mPartner.findFirstOrThrow({
          where: { partner_name: options.partner },
          select: { id: true },
        })
      ).id
    : null;

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

  const row = await prisma.finCashBankTransaction.create({
    data: {
      transaction_no: await nextDocumentNumber("CBT", async () => {
        const last = await prisma.finCashBankTransaction.findFirst({
          orderBy: { transaction_no: "desc" },
          select: { transaction_no: true },
        });
        return last?.transaction_no ?? null;
      }),
      transaction_type: purpose.direction,
      company_id: companyId,
      purpose: purpose.key,
      cash_bank_id: resource?.id ?? null,
      currency_id: currencyId,
      exchange_rate: rate,
      cash_bank_layer_id: options.layerId ?? null,
      partner_id: partnerId,
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
        })),
      },
    },
    select: { id: true },
  });
  tally("cash bank transactions");
  return row.id;
}

/** The layer a payment out of a foreign resource draws on. */
async function firstLayer(cashBankLabel: string): Promise<number> {
  const resource = await prisma.mCashBank.findFirstOrThrow({
    where: { cash_bank_label: cashBankLabel },
    select: { id: true },
  });
  const layer = await prisma.cashBankLayer.findFirstOrThrow({
    where: { cash_bank_id: resource.id, status: "Open" },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return layer.id;
}

async function insertDocuments(budgets: Map<string, number>, actor: number) {

  const settled = await draftDocument({
    purposeKey: "BYA_OUT",
    cashBank: "BCA-OPS",
    note: "Termin II sesuai berita acara serah terima",
    lines: [{ budgetId: budgets.get("gudang")!, amount: 185_000_000 }],
  });
  if (settled) await applyPosting(settled, actor);

  const advance = await draftDocument({
    purposeKey: "PTG_KRY_OUT",
    cashBank: "MDR-PAY",
    partner: "Budi Santoso",
    note: "Advance perjalanan dinas, dipertanggungjawabkan setelah kembali",
    lines: [{ budgetId: budgets.get("advance")!, amount: 10_000_000 }],
  });
  if (advance) await applyPosting(advance, actor);

  const setoran = await draftDocument({
    purposeKey: "HTG_SH_IN",
    cashBank: "BCA-OPS",
    partner: "H. Suryanto Halim",
    note: "Setoran modal kerja, dikembalikan setelah kontrak selesai",
    lines: [{ budgetId: budgets.get("modalkerja")!, amount: 750_000_000 }],
  });
  if (setoran) await applyPosting(setoran, actor);

  // Foreign: paid out of the valas account, drawing its opening layer.
  const impor = await draftDocument({
    purposeKey: "BYA_OUT",
    cashBank: "BCA-USD",
    currency: "USD",
    layerId: await firstLayer("BCA-USD"),
    rate: 15_850,
    note: "Pembayaran pemasok Singapura, invoice SG-2291",
    lines: [{ budgetId: budgets.get("sparepart")!, amount: 5_000 }],
  });
  if (impor) await applyPosting(impor, actor);

  // A Draft, left as one: it has moved nothing, which is what Draft means.
  await draftDocument({
    purposeKey: "PRV_SH_OUT",
    cashBank: "KAS-PST",
    partner: "H. Suryanto Halim",
    note: "Menunggu konfirmasi jadwal pencairan",
    lines: [{ budgetId: budgets.get("prive")!, amount: 30_000_000 }],
  });

  // And one taken back, so Cancelled is on the screen too.
  const cancelled = await draftDocument({
    purposeKey: "AST_OUT",
    cashBank: "BCA-OPS",
    note: "Dibatalkan — unit tidak tersedia, pengadaan diulang",
    lines: [{ budgetId: budgets.get("forklift")!, amount: 340_000_000 }],
  });
  if (cancelled) {
    await prisma.finCashBankTransaction.update({
      where: { id: cancelled },
      data: { status: "Cancelled", updated_by: actor },
    });
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
  const layerId =
    spec.currency !== "IDR" && from.currency_id === currency.id
      ? await firstLayer(spec.from)
      : null;

  const total = spec.lines.reduce((t, l) => t + l.amount, 0);
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
      document_date: null,
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

async function insertTransfers(actor: number) {
  const post = async (spec: TransferSpec) => {
    const id = await draftTransfer(spec, actor);
    if (!id) return;
    const result = await applyTransfer(id, actor);
    if (!result.ok) {
      throw new Error(
        `Transfer "${spec.note}" refused: ${Object.values(result.errors).join(" ")}`
      );
    }
  };

  await post({
    purpose: "Transfer",
    from: "BCA-OPS",
    currency: "IDR",
    rate: 1,
    note: "Pengisian kas kantor pusat untuk operasional mingguan",
    lines: [{ to: "KAS-PST", amount: 50_000_000 }],
  });

  // Selling USD: the layer was carried at 15.850 and the bank credited at
  // 16.100, so the residual is a realized gain — the only transfer that can
  // produce one (§10 rule 87).
  await post({
    purpose: "Pencairan",
    from: "BCA-USD",
    currency: "USD",
    rate: 16_100,
    note: "Pencairan valas untuk kebutuhan rupiah operasional",
    lines: [{ to: "BCA-OPS", amount: 20_000 }],
  });

  // Buying USD: origination, so nothing is on the books to disagree with and
  // the rupiah spent *is* the base value of the currency bought. It opens a
  // second layer beside the opening one.
  await post({
    purpose: "PembelianValas",
    from: "BCA-OPS",
    currency: "USD",
    rate: 16_050,
    note: "Pembelian valas untuk pembayaran pemasok kuartal II",
    lines: [{ to: "BCA-USD", amount: 10_000 }],
  });

  // And one left as a Draft, because Draft is a status the list should show.
  await draftTransfer(
    {
      purpose: "Transfer",
      from: "BCA-OPS",
      currency: "IDR",
      rate: 1,
      note: "Menunggu jadwal pembayaran gaji akhir bulan",
      lines: [{ to: "MDR-PAY", amount: 120_000_000 }],
    },
    actor
  );
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

async function insertFunding(budgets: Map<string, number>, actor: number) {
  const raise = async (options: {
    purposeKey: string;
    partner?: string;
    note: string;
    budget: string;
    amount: number;
  }) => {
    const docId = await draftDocument({
      purposeKey: options.purposeKey,
      company: "anak",
      currency: "IDR",
      partner: options.partner,
      note: options.note,
      lines: [{ budgetId: budgets.get(options.budget)!, amount: options.amount }],
    });
    if (!docId) return null;

    const raised = await raiseFundingRequest(docId, actor);
    if (!raised.ok) {
      throw new Error(
        `Funding for "${options.note}" refused: ${Object.values(raised.errors).join(" ")}`
      );
    }
    tally("funding requests");
    return raised.id;
  };

  // Confirmed. The anak's Purpose keeps a subject book, so its own Piutang
  // against Dedi Kurniawan is written — while the position between the two
  // Companies goes to the bridge accounts and to nobody's subject book
  // (§10 rule 61).
  const confirmed = await raise({
    purposeKey: "PTG_KRY_OUT",
    partner: "Dedi Kurniawan",
    note: "Advance operasional cabang, dipertanggungjawabkan akhir bulan",
    budget: "advanceanak",
    amount: 15_000_000,
  });
  if (confirmed) {
    const provider = await prisma.mCashBank.findFirstOrThrow({
      where: { cash_bank_label: "BCA-OPS" },
      select: { id: true },
    });
    const result = await confirmFundingRequest(confirmed, provider.id, actor);
    if (!result.ok) {
      throw new Error(`Confirmation refused: ${Object.values(result.errors).join(" ")}`);
    }
  }

  // And one still waiting, so the induk's queue is not empty.
  await raise({
    purposeKey: "BYA_OUT",
    note: "Operasional gudang Februari, menunggu konfirmasi induk",
    budget: "operasional",
    amount: 65_000_000,
  });
}

// -------------------------------------------------------- the manual journals
//
// Real accounting that is not a cash movement anybody could raise a Budget for:
// depreciation and an accrual. Both go through the same engine an automatic
// posting uses, so the balance rule and the control-account rule apply to them
// exactly as they do to everything else.
//
// Neither touches an account a book reconciles against — that is what a manual
// journal may never do (§10 rule 79), and it is why these two are depreciation
// and an accrual rather than anything involving cash.

type ManualSpec = {
  description: string;
  post: boolean;
  lines: { account: string; debit?: number; credit?: number; description: string }[];
};

const MANUAL_JOURNALS: ManualSpec[] = [
  {
    description: "Penyusutan aset tetap Februari",
    post: true,
    lines: [
      { account: "Biaya Penyusutan", debit: 12_500_000, description: "Penyusutan peralatan dan mesin" },
      { account: "Akumulasi Penyusutan Peralatan dan Mesin", credit: 12_500_000, description: "Penyusutan peralatan dan mesin" },
    ],
  },
  {
    // Left as a Draft, because Draft is the one status only a manual journal
    // ever has — and the reports must be seen leaving it out.
    description: "Akrual listrik dan telepon Maret",
    post: false,
    lines: [
      { account: "Biaya Listrik, Air dan Telepon", debit: 8_400_000, description: "Tagihan Maret belum jatuh tempo" },
      { account: "Hutang Listrik dan Telepon", credit: 8_400_000, description: "Tagihan Maret belum jatuh tempo" },
    ],
  },
];

async function insertManualJournals(actor: number) {
  const induk = await prisma.sysCompany.findFirstOrThrow({
    where: { is_parent: true },
    select: { id: true },
  });
  const idr = await prisma.refCurrency.findFirstOrThrow({
    where: { currency_label: "IDR" },
    select: { id: true },
  });

  for (const spec of MANUAL_JOURNALS) {
    const already = await prisma.accJournal.findFirst({
      where: { description: spec.description },
      select: { id: true },
    });
    if (already) continue;

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
      { company_id: induk.id, description: spec.description },
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
}

// ------------------------------------------------------ debit / credit notes
//
// A note adjusts a Partner's standing position without cash (§10 rules 97–102),
// so each one here lands on a position a document above already opened: Budi
// Santoso's advance in Piutang, H. Suryanto Halim's setoran in Hutang. Both
// posted notes go through `applyDncn`, which writes the subject-book entry and
// the journal together; one Draft and one Cancelled put the other two statuses
// on the register.

type NoteSpec = {
  type: "Debit" | "Credit";
  book: "Piutang" | "Hutang";
  partner: string;
  amount: number;
  description: string;
  reference?: string;
  /** This script's marker, as a document's note is elsewhere. */
  note: string;
  status: "Posted" | "Draft" | "Cancelled";
};

const NOTES: NoteSpec[] = [
  {
    type: "Debit",
    book: "Piutang",
    partner: "Budi Santoso",
    amount: 1_250_000,
    description: "Kelebihan klaim uang harian perjalanan dinas Surabaya",
    reference: "SPD-SBY-0142",
    note: "Kelebihan klaim uang harian perjalanan dinas Surabaya, dibebankan kembali",
    status: "Posted",
  },
  {
    type: "Credit",
    book: "Hutang",
    partner: "H. Suryanto Halim",
    amount: 7_500_000,
    description: "Kompensasi atas setoran modal kerja kuartal I",
    reference: "SK-SYH-03/2026",
    note: "Kompensasi atas setoran modal kerja kuartal I",
    status: "Posted",
  },
  {
    type: "Credit",
    book: "Piutang",
    partner: "Budi Santoso",
    amount: 350_000,
    description: "Biaya tol dan parkir perjalanan dinas disetujui",
    note: "Biaya tol dan parkir disetujui, mengurangi advance",
    status: "Draft",
  },
  {
    type: "Debit",
    book: "Hutang",
    partner: "H. Suryanto Halim",
    amount: 2_000_000,
    description: "Selisih pengembalian setoran modal kerja",
    note: "Dibatalkan — selisih sudah diselesaikan lewat transfer",
    status: "Cancelled",
  },
];

async function insertNotes(actor: number) {
  const idr = await prisma.refCurrency.findFirstOrThrow({
    where: { currency_label: "IDR" },
    select: { id: true },
  });

  for (const spec of NOTES) {
    const already = await prisma.finDncn.findFirst({
      where: { note: spec.note },
      select: { id: true },
    });
    if (already) continue;

    const category = await prisma.sysBudgetCategory.findFirstOrThrow({
      where: { category_label: spec.book },
      select: { id: true },
    });
    const partner = await prisma.mPartner.findFirstOrThrow({
      where: { partner_name: spec.partner },
      select: { id: true, company_id: true },
    });

    // Shaped the way `createDncn` writes a Draft: rupiah, so the rate is 1,
    // and no base figure until Post decides one.
    const row = await prisma.finDncn.create({
      data: {
        note_no: await nextNoteNo(spec.type),
        note_type: spec.type,
        company_id: partner.company_id,
        budget_category_id: category.id,
        partner_id: partner.id,
        currency_id: idr.id,
        exchange_rate: 1,
        note_amount: spec.amount,
        reference: spec.reference ?? null,
        note: spec.note,
        status: "Draft",
        created_by: actor,
        lines: {
          create: [
            { sequence_no: 1, description: spec.description, amount: spec.amount, created_by: actor },
          ],
        },
      },
      select: { id: true, note_no: true },
    });
    await audit("fin_dncn", row.id, actor);
    tally("debit / credit notes");

    if (spec.status === "Posted") {
      const posted = await applyDncn(row.id, actor);
      if (!posted.ok) {
        throw new Error(
          `Posting ${row.note_no} refused: ${Object.values(posted.errors).join(" ")}`
        );
      }
    } else if (spec.status === "Cancelled") {
      await prisma.finDncn.update({
        where: { id: row.id },
        data: { status: "Cancelled", updated_by: actor },
      });
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
    await insertChart(company.id, company.company_label, actor);
  }

  // After the chart, because a mapping points at an account in it.
  for (const company of companies) {
    await insertMappings(company.id, company.company_label, actor);
  }

  // And after both, because each of these names an account.
  await setDefaults(actor);
  await insertCashBanks(induk.id, foreignId, actor);
  await ensureFiscalYear(actor);

  // The year itself: plans first, then what realized them.
  const budgets = await insertBudgets(actor);
  await insertDocuments(budgets, actor);

  // Then the three documents that are not a Cash Bank Transaction: the
  // Company moving its own money, the anak reaching the induk’s, and the
  // accounting nobody raises a Budget for.
  await insertTransfers(actor);
  await insertFunding(budgets, actor);
  await insertManualJournals(actor);

  // Last, because a note adjusts a position the documents above opened.
  await insertNotes(actor);

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

async function insertChart(companyId: number, companyLabel: string, actor: number) {
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

  for (const group of CHART) {
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
