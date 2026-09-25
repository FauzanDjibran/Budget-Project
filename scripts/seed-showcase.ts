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
import { executeClosing } from "@/lib/siba/closing";
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

/**
 * The calendar the showcase lives in: the current year and the three before
 * it, all four Open — because the business works back through its history by
 * backdating — and the oldest **closed by both Companies**, so the Neraca of
 * the current year carries one Laba/Rugi line per unclosed year and the chain
 * of Opening Balance snapshots has a real link in it.
 */
const YEAR = new Date().getUTCFullYear();
const FIRST_YEAR = YEAR - 3;
const HISTORY_YEARS = [FIRST_YEAR, FIRST_YEAR + 1, FIRST_YEAR + 2];
const CLOSED_YEAR = FIRST_YEAR;
const ALL_YEARS = [...HISTORY_YEARS, YEAR];

/** The day the resources were registered: the first working day of the history. */
const OPENING_DATE = `${FIRST_YEAR}-01-02`;
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
 * **Every one opens at nil.** The group's money arrives the way it really
 * did — the founders' setoran, posted as a Cash Bank Transaction in the first
 * week of the history — so the Cash Bank Book, the General Ledger and the
 * Neraca agree from the first day. An opening balance would write the Cash
 * Bank Book alone, and a go-live Opening Balance snapshot for the ledger half
 * is not carried through a close (`closingBalances` reads journal lines only),
 * so the closed year would hand the next one a Neraca missing its cash. The
 * foreign account's layers likewise come from real Pembelian Valas.
 */
const CASH_BANKS: {
  label: string;
  name: string;
  type: "Cash" | "Bank";
  currency: "IDR" | "USD";
  account: string;
}[] = [
  { label: "KAS-PST", name: "Kas Besar Kantor Pusat", type: "Cash", currency: "IDR", account: "Kas Besar" },
  { label: "BCA-OPS", name: "BCA Giro Operasional", type: "Bank", currency: "IDR", account: "Bank BCA" },
  { label: "MDR-PAY", name: "Mandiri Giro Payroll", type: "Bank", currency: "IDR", account: "Bank Mandiri" },
  { label: "BCA-USD", name: "BCA Valas USD", type: "Bank", currency: "USD", account: "Bank BCA Valas" },
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
        openingBalance: 0,
        rate: 1,
        layered,
        date: OPENING_DATE,
        actorId: actor,
      });
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
    await systemDefaultAccountIds(),
    actor
  );
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
 * The oldest year, closed by both Companies through the real engine: the
 * `CLS-` journal moves each Company's result into Laba Ditahan, the next
 * year's `OPB-` snapshot is written, and the year rolls to Closed once the
 * second Company is done. Skipped for a Company that already closed it.
 */
async function closeOldestYear(actor: number) {
  const year = await prisma.accFiscalYear.findFirstOrThrow({
    where: { year_label: String(CLOSED_YEAR) },
    select: { id: true },
  });
  const companies = await prisma.sysCompany.findMany({
    orderBy: { is_parent: "desc" },
    select: { id: true, company_label: true },
  });
  for (const company of companies) {
    const done = await prisma.accFiscalClosing.findFirst({
      where: { fiscal_year_id: year.id, company_id: company.id, status: "Closed" },
      select: { id: true },
    });
    if (done) continue;
    const result = await executeClosing(company.id, year.id, actor);
    if (!result.ok) {
      throw new Error(`Closing ${CLOSED_YEAR} for ${company.company_label} refused: ${result.error}`);
    }
    tally("fiscal year closings");
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
  /**
   * `Closed` is written Open and reached by the posting that realizes it in
   * full — nobody closes a Budget by hand (§12). `Open` stays open because what
   * realizes it falls short. `Submitted`, `Rejected` and `Cancelled` carry no
   * classification, because only approval classifies (§10 rules 25–26).
   */
  status: "Submitted" | "Open" | "Closed" | "Rejected" | "Cancelled";
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
  const partners = new Map(
    (await prisma.mPartner.findMany({ select: { id: true, partner_name: true } }))
      .map((x) => [x.partner_name, x.id])
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
        // Only an approved budget has been classified, because approval is
        // what classifies (§10 rules 25–26).
        category_id: classified ? categories.get(spec.category)! : null,
        partner_id: classified && spec.partner ? partners.get(spec.partner)! : null,
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
      document_date: new Date(`${options.date}T00:00:00Z`),
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
  const result = await confirmFundingRequest(raised.id, provider.id, actor);
  if (!result.ok) {
    throw new Error(`Confirming "${spec.note}" refused: ${Object.values(result.errors).join(" ")}`);
  }
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
  /** The day it is written for — the posting date once it is posted. */
  date: string;
  post: boolean;
  lines: { account: string; debit?: number; credit?: number; description: string }[];
};

/** A quarter's depreciation on the fixed assets the Asset budgets bought. */
function depreciation(year: number, quarter: 1 | 2 | 3 | 4, amount: number): ManualSpec {
  const end = [on(year, 3, 31), on(year, 6, 30), on(year, 9, 30), on(year, 12, 31)][quarter - 1];
  const text = `Penyusutan kendaraan dan inventaris kuartal ${quarter} ${year}`;
  return {
    description: `Penyusutan aset tetap kuartal ${["I", "II", "III", "IV"][quarter - 1]} ${year}`,
    date: end,
    post: true,
    lines: [
      { account: "Biaya Penyusutan", debit: amount, description: text },
      { account: "Akumulasi Penyusutan Kendaraan dan Inventaris", credit: amount, description: text },
    ],
  };
}

/**
 * December's electricity and telephone, accrued at the year-end because the
 * bill arrives in January — and reversed on the second of January, so the
 * bill paid then is the expense of record without being counted twice. The
 * accrual/reversal pair is ordinary year-end work nobody raises a Budget for.
 */
function accrual(year: number, amount: number): ManualSpec {
  const text = `Tagihan listrik dan telepon Desember ${year} belum diterima`;
  return {
    description: `Akrual listrik dan telepon Desember ${year}`,
    date: on(year, 12, 31),
    post: true,
    lines: [
      { account: "Biaya Listrik, Air dan Telepon", debit: amount, description: text },
      { account: "Hutang Listrik dan Telepon", credit: amount, description: text },
    ],
  };
}

function reversal(accruedYear: number, amount: number): ManualSpec {
  const text = `Pembalikan akrual listrik dan telepon Desember ${accruedYear}`;
  return {
    description: text,
    date: on(accruedYear + 1, 1, 2),
    post: true,
    lines: [
      { account: "Hutang Listrik dan Telepon", debit: amount, description: text },
      { account: "Biaya Listrik, Air dan Telepon", credit: amount, description: text },
    ],
  };
}


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
  book: "Piutang" | "Hutang" | "Titipan";
  partner: string;
  amount: number;
  description: string;
  reference?: string;
  /** This script's marker, as a document's note is elsewhere. */
  note: string;
  /** The Tanggal Dokumen, `YYYY-MM-DD`. */
  date: string;
  status: "Posted" | "Draft" | "Cancelled";
};


/** One Debit / Credit Note, posted through `applyDncn` when its status says so. */
async function writeNote(spec: NoteSpec, actor: number) {
  const already = await prisma.finDncn.findFirst({
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
    where: { partner_name: spec.partner },
    select: { id: true, company_id: true },
  });

  // Shaped the way `createDncn` writes a Draft: rupiah, so the rate is 1,
  // and no base figure until Post decides one.
  const row = await prisma.finDncn.create({
    data: {
      note_no: await nextNoteNo(spec.type),
      note_type: spec.type,
      document_date: new Date(`${spec.date}T00:00:00Z`),
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
      throw new Error(`Posting ${row.note_no} refused: ${Object.values(posted.errors).join(" ")}`);
    }
  } else if (spec.status === "Cancelled") {
    await prisma.finDncn.update({
      where: { id: row.id },
      data: { status: "Cancelled", updated_by: actor },
    });
  }
}


// ------------------------------------------------------------ the four years
//
// Each year is a plan: the Budgets it held, and the events that happened to
// them, **in date order**. Order is not cosmetic. A book refuses to go below
// zero and a layer to be overdrawn at the moment of posting, so a payroll run
// posted before the transfer that funded it would be refused exactly as it
// would be for a user — the runner sorts by date and posts in that order.
//
// The story, told by the reports rather than by this comment:
//
//   - the first year is the founding — the founders' money in, the gudang fitted
//     out, Cabang Surabaya capitalised, the first dollars bought — and it runs a
//     loss, which is why its Laba/Rugi line reads negative until the close;
//   - the second is the expansion — PT Mitra Abadi Sentosa lends, Cabang Medan
//     is capitalised, the forklift arrives, Surabaya pays its first bagi hasil,
//     the first import is paid in dollars and some dollars are sold at a gain;
//   - the third is the import year — more dollars bought at a dearer rate, two
//     payments drawn on two layers, the oldest layer sold down to nothing, part
//     of H. Suryanto Halim's setoran handed back;
//   - the current year is the one being worked in, and the only one holding
//     Drafts, a Pending Funding Request, a Submitted Budget and Cancelled
//     documents. A year being closed may not hold a draft journal, and the live
//     states belong where somebody is still working anyway.
//
// Only the induk holds cash; the anak's own spending reaches money through a
// Funding Request each year, which is what keeps the intercompany bridge
// moving on both Companies' Neraca.

type CbtEvent = {
  kind: "cbt";
  date: string;
  purpose: string;
  cashBank?: string;
  currency?: "IDR" | "USD";
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
  | { kind: "note"; date: string; spec: NoteSpec };

type YearPlan = { year: number; budgets: BudgetSpec[]; events: Event[] };

const transfer = (spec: TransferSpec, draft = false): Event => ({ kind: "transfer", date: spec.date, spec, draft });
const journal = (spec: ManualSpec): Event => ({ kind: "journal", date: spec.date, spec });
const note = (spec: NoteSpec): Event => ({ kind: "note", date: spec.date, spec });

type BudgetRow = Omit<BudgetSpec, "date"> & { date: [month: number, day: number] };
const budgetsOf = (year: number, rows: BudgetRow[]): BudgetSpec[] =>
  rows.map((b) => ({ ...b, date: on(year, b.date[0], b.date[1]) }));

/** The founding year: money in, the gudang fitted out, and a loss. */
function foundingYear(y: number): YearPlan {
  const d = (m: number, dd: number) => on(y, m, dd);
  return {
    year: y,
    budgets: budgetsOf(y, [
      { key: "setoran", company: "induk", date: [1, 3], type: "In", category: "Hutang", partner: "H. Suryanto Halim", amount: 3_000_000_000, description: `Setoran modal pendirian dari H. Suryanto Halim ${y}`, status: "Closed" },
      { key: "titipan", company: "induk", date: [1, 4], type: "In", category: "Titipan", partner: "Ratna Dewi Kusuma", amount: 500_000_000, description: `Titipan dana pengembangan usaha Ratna Dewi Kusuma ${y}`, status: "Closed" },
      { key: "fitout", company: "induk", date: [2, 6], type: "Out", category: "Biaya", amount: 420_000_000, description: `Renovasi dan fit-out gudang Cikarang ${y}`, status: "Closed" },
      { key: "inventaris", company: "induk", date: [2, 20], type: "Out", category: "Asset", amount: 600_000_000, description: `Pengadaan rak gudang dan inventaris kantor pusat ${y}`, status: "Closed" },
      { key: "penyertaan", company: "induk", date: [3, 1], type: "Out", category: "Investasi", partner: "Cabang Surabaya", amount: 800_000_000, description: `Penyertaan modal awal Cabang Surabaya ${y}`, status: "Closed" },
      { key: "kaskecil", company: "induk", date: [3, 15], type: "Out", category: "Biaya", amount: 25_000_000, description: `Kebutuhan kas kecil kantor pusat ${y}`, status: "Closed" },
      { key: "gaji", company: "induk", date: [1, 25], type: "Out", category: "Biaya", amount: 180_000_000, description: `Gaji dan tunjangan karyawan kantor pusat ${y}`, status: "Closed" },
      { key: "advance", company: "induk", date: [8, 7], type: "Out", category: "Piutang", partner: "Budi Santoso", amount: 20_000_000, description: `Advance survei lokasi Cabang Medan ${y}`, status: "Closed" },
      { key: "mobil", company: "induk", date: [5, 8], type: "Out", category: "Asset", amount: 650_000_000, description: `Pembelian mobil operasional direksi ${y}`, status: "Rejected" },
      { key: "anakops", company: "anak", date: [4, 3], type: "Out", category: "Biaya", amount: 90_000_000, description: `Biaya operasional awal SBTC ${y}`, status: "Closed" },
    ]),
    events: [
      { kind: "cbt", date: d(1, 5), purpose: "HTG_SH_IN", cashBank: "BCA-OPS", partner: "H. Suryanto Halim", note: `Setoran modal pendirian ${y}, termin tunggal`, lines: [{ budget: "setoran", amount: 3_000_000_000 }] },
      { kind: "cbt", date: d(1, 6), purpose: "TTP_SH_IN", cashBank: "BCA-OPS", partner: "Ratna Dewi Kusuma", note: `Titipan dana pengembangan usaha ${y} dari Ratna Dewi Kusuma`, lines: [{ budget: "titipan", amount: 500_000_000 }] },
      transfer({ purpose: "Transfer", from: "BCA-OPS", currency: "IDR", rate: 1, date: d(1, 9), note: `Pengisian kas dan rekening payroll awal operasional ${y}`, lines: [{ to: "KAS-PST", amount: 60_000_000 }, { to: "MDR-PAY", amount: 300_000_000 }] }),
      { kind: "cbt", date: d(2, 10), purpose: "BYA_OUT", cashBank: "BCA-OPS", note: `Pembayaran kontraktor fit-out gudang Cikarang ${y}`, lines: [{ budget: "fitout", amount: 420_000_000 }] },
      { kind: "cbt", date: d(2, 24), purpose: "AST_OUT", cashBank: "BCA-OPS", note: `Pembayaran rak gudang dan inventaris kantor ${y}`, lines: [{ budget: "inventaris", amount: 600_000_000 }] },
      { kind: "cbt", date: d(3, 6), purpose: "INV_CAB_OUT", cashBank: "BCA-OPS", partner: "Cabang Surabaya", note: `Setoran penyertaan modal Cabang Surabaya ${y}`, lines: [{ budget: "penyertaan", amount: 800_000_000 }] },
      journal(depreciation(y, 1, 8_500_000)),
      { kind: "cbt", date: d(4, 10), purpose: "BYA_OUT", cashBank: "KAS-PST", note: `Belanja kas kecil kantor pusat ${y}`, lines: [{ budget: "kaskecil", amount: 25_000_000 }] },
      { kind: "funding", date: d(4, 12), purpose: "BYA_OUT", note: `Operasional awal gudang SBTC ${y}`, budget: "anakops", amount: 90_000_000, confirmFrom: "BCA-OPS" },
      { kind: "cbt", date: d(6, 26), purpose: "BYA_OUT", cashBank: "MDR-PAY", note: `Gaji dan tunjangan semester I ${y}`, lines: [{ budget: "gaji", amount: 90_000_000 }] },
      journal(depreciation(y, 2, 8_500_000)),
      { kind: "cbt", date: d(8, 9), purpose: "PTG_KRY_OUT", cashBank: "MDR-PAY", partner: "Budi Santoso", note: `Advance survei lokasi Cabang Medan ${y}`, lines: [{ budget: "advance", amount: 20_000_000 }] },
      journal(depreciation(y, 3, 8_500_000)),
      transfer({ purpose: "PembelianValas", from: "BCA-OPS", currency: "USD", rate: 15_480, date: d(11, 14), note: `Pembelian valas pertama untuk rencana impor ${y + 1}`, lines: [{ to: "BCA-USD", amount: 25_000 }] }),
      { kind: "cbt", date: d(12, 22), purpose: "BYA_OUT", cashBank: "MDR-PAY", note: `Gaji dan tunjangan semester II ${y}`, lines: [{ budget: "gaji", amount: 90_000_000 }] },
      note({ type: "Credit", book: "Hutang", partner: "H. Suryanto Halim", amount: 12_000_000, description: `Imbal jasa atas setoran modal pendirian ${y}`, reference: `SK-SYH-12/${y}`, note: `Imbal jasa setoran modal pendirian ${y}`, date: d(12, 27), status: "Posted" }),
      journal(depreciation(y, 4, 8_500_000)),
      journal(accrual(y, 6_200_000)),
    ],
  };
}

/** The expansion year: a second lender, Cabang Medan, the first bagi hasil. */
function expansionYear(y: number): YearPlan {
  const d = (m: number, dd: number) => on(y, m, dd);
  return {
    year: y,
    budgets: budgetsOf(y, [
      { key: "listrik", company: "induk", date: [1, 5], type: "Out", category: "Biaya", amount: 6_200_000, description: `Tagihan listrik dan telepon Desember ${y - 1}`, status: "Closed" },
      { key: "pinjaman", company: "induk", date: [1, 8], type: "In", category: "Hutang", partner: "PT Mitra Abadi Sentosa", amount: 1_500_000_000, description: `Pinjaman pemegang saham PT Mitra Abadi Sentosa ${y}`, status: "Closed" },
      { key: "pelunasan", company: "induk", date: [1, 10], type: "In", category: "Piutang", partner: "Budi Santoso", amount: 18_500_000, description: `Pengembalian sisa advance survei Medan ${y}`, status: "Closed" },
      { key: "penyertaan", company: "induk", date: [2, 5], type: "Out", category: "Investasi", partner: "Cabang Medan", amount: 500_000_000, description: `Penyertaan modal Cabang Medan ${y}`, status: "Closed" },
      { key: "forklift", company: "induk", date: [3, 4], type: "Out", category: "Asset", amount: 340_000_000, description: `Pembelian forklift gudang Cikarang ${y}`, status: "Closed" },
      { key: "ops", company: "induk", date: [1, 15], type: "Out", category: "Biaya", amount: 310_000_000, description: `Biaya operasional gudang Cikarang ${y}`, status: "Closed" },
      { key: "gaji", company: "induk", date: [1, 20], type: "Out", category: "Biaya", amount: 200_000_000, description: `Gaji dan tunjangan karyawan kantor pusat ${y}`, status: "Closed" },
      { key: "kaskecil", company: "induk", date: [3, 15], type: "Out", category: "Biaya", amount: 25_000_000, description: `Kebutuhan kas kecil kantor pusat ${y}`, status: "Closed" },
      { key: "impor", company: "induk", date: [6, 3], type: "Out", category: "Biaya", currency: "USD", amount: 12_000, description: `Pembelian spare part forklift impor ${y}`, status: "Closed" },
      { key: "bagihasil", company: "induk", date: [6, 3], type: "In", category: "Hasil Investasi", partner: "Cabang Surabaya", amount: 1_130_000_000, description: `Bagi hasil Cabang Surabaya ${y}`, status: "Closed" },
      { key: "titipan", company: "induk", date: [8, 1], type: "In", category: "Titipan", partner: "Cabang Surabaya", amount: 75_000_000, description: `Titipan dana pembelian armada Cabang Surabaya ${y}`, status: "Closed" },
      { key: "advance", company: "induk", date: [8, 28], type: "Out", category: "Piutang", partner: "Siti Rahmawati", amount: 15_000_000, description: `Advance pelatihan sertifikasi gudang ${y}`, status: "Open" },
      { key: "prive", company: "induk", date: [12, 2], type: "Out", category: "Prive", partner: "H. Suryanto Halim", amount: 100_000_000, description: `Prive akhir tahun H. Suryanto Halim ${y}`, status: "Closed" },
      { key: "genset", company: "induk", date: [9, 16], type: "Out", category: "Asset", amount: 180_000_000, description: `Pembelian genset cadangan gudang ${y}`, status: "Cancelled" },
      { key: "anakops", company: "anak", date: [4, 2], type: "Out", category: "Biaya", amount: 120_000_000, description: `Biaya operasional gudang SBTC ${y}`, status: "Closed" },
      { key: "anakadv", company: "anak", date: [5, 2], type: "Out", category: "Piutang", partner: "Lina Setiawati", amount: 10_000_000, description: `Advance pengadaan perlengkapan SBTC ${y}`, status: "Closed" },
    ]),
    events: [
      journal(reversal(y - 1, 6_200_000)),
      { kind: "cbt", date: d(1, 8), purpose: "BYA_OUT", cashBank: "KAS-PST", note: `Pembayaran tagihan listrik dan telepon Desember ${y - 1}`, lines: [{ budget: "listrik", amount: 6_200_000 }] },
      { kind: "cbt", date: d(1, 10), purpose: "HTG_SH_IN", cashBank: "BCA-OPS", partner: "PT Mitra Abadi Sentosa", note: `Pencairan pinjaman pemegang saham PT Mitra Abadi Sentosa ${y}`, lines: [{ budget: "pinjaman", amount: 1_500_000_000 }] },
      note({ type: "Credit", book: "Piutang", partner: "Budi Santoso", amount: 1_500_000, description: `Biaya transportasi survei Medan disetujui ${y}`, reference: `SPD-MDN-0107`, note: `Biaya transportasi survei Medan disetujui, mengurangi advance ${y}`, date: d(1, 12), status: "Posted" }),
      transfer({ purpose: "Transfer", from: "BCA-OPS", currency: "IDR", rate: 1, date: d(1, 15), note: `Pengisian kas dan rekening payroll ${y}`, lines: [{ to: "KAS-PST", amount: 30_000_000 }, { to: "MDR-PAY", amount: 220_000_000 }] }),
      { kind: "cbt", date: d(1, 22), purpose: "PTG_KRY_IN", cashBank: "BCA-OPS", partner: "Budi Santoso", note: `Pengembalian sisa advance survei Medan ${y}`, lines: [{ budget: "pelunasan", amount: 18_500_000 }] },
      { kind: "cbt", date: d(2, 7), purpose: "INV_CAB_OUT", cashBank: "BCA-OPS", partner: "Cabang Medan", note: `Setoran penyertaan modal Cabang Medan ${y}`, lines: [{ budget: "penyertaan", amount: 500_000_000 }] },
      transfer({ purpose: "PembelianValas", from: "BCA-OPS", currency: "USD", rate: 15_900, date: d(3, 6), note: `Pembelian valas untuk impor spare part ${y}`, lines: [{ to: "BCA-USD", amount: 30_000 }] }),
      { kind: "cbt", date: d(3, 11), purpose: "AST_OUT", cashBank: "BCA-OPS", note: `Pembayaran forklift gudang Cikarang ${y}`, lines: [{ budget: "forklift", amount: 340_000_000 }] },
      journal(depreciation(y, 1, 14_000_000)),
      { kind: "cbt", date: d(4, 5), purpose: "BYA_OUT", cashBank: "BCA-OPS", note: `Operasional gudang Cikarang semester I ${y}`, lines: [{ budget: "ops", amount: 150_000_000 }] },
      { kind: "funding", date: d(4, 18), purpose: "BYA_OUT", note: `Operasional gudang SBTC ${y}`, budget: "anakops", amount: 120_000_000, confirmFrom: "BCA-OPS" },
      { kind: "funding", date: d(5, 6), purpose: "PTG_KRY_OUT", partner: "Lina Setiawati", note: `Advance pengadaan perlengkapan SBTC ${y}`, budget: "anakadv", amount: 10_000_000, confirmFrom: "BCA-OPS" },
      { kind: "cbt", date: d(6, 18), purpose: "BYA_OUT", cashBank: "BCA-USD", currency: "USD", note: `Pembayaran pemasok spare part Singapura, invoice SG-1874`, lines: [{ budget: "impor", amount: 12_000 }] },
      { kind: "cbt", date: d(6, 25), purpose: "BYA_OUT", cashBank: "MDR-PAY", note: `Gaji dan tunjangan semester I ${y}`, lines: [{ budget: "gaji", amount: 100_000_000 }] },
      journal(depreciation(y, 2, 14_000_000)),
      { kind: "cbt", date: d(7, 15), purpose: "HIN_CAB_IN", cashBank: "BCA-OPS", partner: "Cabang Surabaya", note: `Bagi hasil semester I ${y} Cabang Surabaya diterima`, lines: [{ budget: "bagihasil", amount: 520_000_000 }] },
      { kind: "cbt", date: d(8, 5), purpose: "TTP_CAB_IN", cashBank: "BCA-OPS", partner: "Cabang Surabaya", note: `Titipan dana pembelian armada Cabang Surabaya ${y}`, lines: [{ budget: "titipan", amount: 75_000_000 }] },
      { kind: "cbt", date: d(9, 3), purpose: "PTG_KRY_OUT", cashBank: "MDR-PAY", partner: "Siti Rahmawati", note: `Advance pelatihan sertifikasi gudang ${y}`, lines: [{ budget: "advance", amount: 10_000_000 }] },
      journal(depreciation(y, 3, 14_000_000)),
      { kind: "cbt", date: d(10, 7), purpose: "BYA_OUT", cashBank: "BCA-OPS", note: `Operasional gudang Cikarang semester II ${y}`, lines: [{ budget: "ops", amount: 160_000_000 }] },
      // Dollars bought at 15.480 sold at 16.250: a realized gain.
      transfer({ purpose: "Pencairan", from: "BCA-USD", currency: "USD", rate: 16_250, date: d(10, 9), note: `Pencairan valas untuk kebutuhan rupiah ${y}`, lines: [{ to: "BCA-OPS", amount: 8_000 }] }),
      { kind: "cbt", date: d(11, 12), purpose: "BYA_OUT", cashBank: "KAS-PST", note: `Belanja kas kecil kantor pusat ${y}`, lines: [{ budget: "kaskecil", amount: 25_000_000 }] },
      { kind: "cbt", date: d(12, 10), purpose: "PRV_SH_OUT", cashBank: "BCA-OPS", partner: "H. Suryanto Halim", note: `Prive akhir tahun H. Suryanto Halim ${y}`, lines: [{ budget: "prive", amount: 100_000_000 }] },
      { kind: "cbt", date: d(12, 16), purpose: "HIN_CAB_IN", cashBank: "BCA-OPS", partner: "Cabang Surabaya", note: `Bagi hasil semester II ${y} Cabang Surabaya diterima`, lines: [{ budget: "bagihasil", amount: 610_000_000 }] },
      { kind: "cbt", date: d(12, 20), purpose: "BYA_OUT", cashBank: "MDR-PAY", note: `Gaji dan tunjangan semester II ${y}`, lines: [{ budget: "gaji", amount: 100_000_000 }] },
      journal(depreciation(y, 4, 14_000_000)),
      journal(accrual(y, 7_400_000)),
    ],
  };
}

/** The import year: dearer dollars, two layers drawn, a partial repayment. */
function importYear(y: number): YearPlan {
  const d = (m: number, dd: number) => on(y, m, dd);
  return {
    year: y,
    budgets: budgetsOf(y, [
      { key: "listrik", company: "induk", date: [1, 5], type: "Out", category: "Biaya", amount: 7_400_000, description: `Tagihan listrik dan telepon Desember ${y - 1}`, status: "Closed" },
      { key: "pelunasan", company: "induk", date: [1, 27], type: "In", category: "Piutang", partner: "Siti Rahmawati", amount: 10_000_000, description: `Pengembalian advance pelatihan sertifikasi ${y}`, status: "Closed" },
      { key: "kendaraan", company: "induk", date: [3, 2], type: "Out", category: "Asset", amount: 250_000_000, description: `Pengadaan kendaraan operasional pengiriman ${y}`, status: "Closed" },
      { key: "ops", company: "induk", date: [1, 14], type: "Out", category: "Biaya", amount: 380_000_000, description: `Biaya operasional gudang Cikarang ${y}`, status: "Closed" },
      { key: "impor", company: "induk", date: [3, 20], type: "Out", category: "Biaya", currency: "USD", amount: 25_000, description: `Pembelian spare part dan suku cadang impor ${y}`, status: "Closed" },
      { key: "gaji", company: "induk", date: [1, 20], type: "Out", category: "Biaya", amount: 240_000_000, description: `Gaji dan tunjangan karyawan kantor pusat ${y}`, status: "Closed" },
      { key: "kaskecil", company: "induk", date: [3, 15], type: "Out", category: "Biaya", amount: 30_000_000, description: `Kebutuhan kas kecil kantor pusat ${y}`, status: "Closed" },
      { key: "bagihasilsby", company: "induk", date: [6, 2], type: "In", category: "Hasil Investasi", partner: "Cabang Surabaya", amount: 1_150_000_000, description: `Bagi hasil Cabang Surabaya ${y}`, status: "Closed" },
      { key: "bagihasilmdn", company: "induk", date: [11, 3], type: "In", category: "Hasil Investasi", partner: "Cabang Medan", amount: 180_000_000, description: `Bagi hasil pertama Cabang Medan ${y}`, status: "Closed" },
      { key: "titipan", company: "induk", date: [8, 25], type: "Out", category: "Titipan", partner: "Cabang Surabaya", amount: 72_500_000, description: `Pengembalian titipan dana armada Cabang Surabaya ${y}`, status: "Closed" },
      { key: "pengembalian", company: "induk", date: [10, 6], type: "Out", category: "Hutang", partner: "H. Suryanto Halim", amount: 600_000_000, description: `Pengembalian sebagian setoran modal H. Suryanto Halim ${y}`, status: "Open" },
      { key: "prive", company: "induk", date: [12, 1], type: "Out", category: "Prive", partner: "H. Suryanto Halim", amount: 120_000_000, description: `Prive akhir tahun H. Suryanto Halim ${y}`, status: "Closed" },
      { key: "renovasi", company: "induk", date: [5, 12], type: "Out", category: "Biaya", amount: 450_000_000, description: `Renovasi kantor pusat lantai 2 ${y}`, status: "Rejected" },
      { key: "anakops", company: "anak", date: [4, 1], type: "Out", category: "Biaya", amount: 150_000_000, description: `Biaya operasional gudang SBTC ${y}`, status: "Closed" },
    ]),
    events: [
      journal(reversal(y - 1, 7_400_000)),
      { kind: "cbt", date: d(1, 7), purpose: "BYA_OUT", cashBank: "KAS-PST", note: `Pembayaran tagihan listrik dan telepon Desember ${y - 1}`, lines: [{ budget: "listrik", amount: 7_400_000 }] },
      transfer({ purpose: "Transfer", from: "BCA-OPS", currency: "IDR", rate: 1, date: d(1, 13), note: `Pengisian kas dan rekening payroll ${y}`, lines: [{ to: "KAS-PST", amount: 40_000_000 }, { to: "MDR-PAY", amount: 260_000_000 }] }),
      { kind: "cbt", date: d(2, 3), purpose: "PTG_KRY_IN", cashBank: "BCA-OPS", partner: "Siti Rahmawati", note: `Pengembalian advance pelatihan sertifikasi ${y}`, lines: [{ budget: "pelunasan", amount: 10_000_000 }] },
      transfer({ purpose: "PembelianValas", from: "BCA-OPS", currency: "USD", rate: 16_350, date: d(2, 11), note: `Pembelian valas untuk impor suku cadang ${y}`, lines: [{ to: "BCA-USD", amount: 25_000 }] }),
      { kind: "cbt", date: d(3, 12), purpose: "AST_OUT", cashBank: "BCA-OPS", note: `Pembayaran kendaraan operasional pengiriman ${y}`, lines: [{ budget: "kendaraan", amount: 250_000_000 }] },
      journal(depreciation(y, 1, 21_000_000)),
      { kind: "cbt", date: d(4, 4), purpose: "BYA_OUT", cashBank: "BCA-OPS", note: `Operasional gudang Cikarang semester I ${y}`, lines: [{ budget: "ops", amount: 180_000_000 }] },
      { kind: "cbt", date: d(4, 15), purpose: "BYA_OUT", cashBank: "BCA-USD", currency: "USD", note: `Pembayaran pemasok suku cadang Singapura, invoice SG-2107`, lines: [{ budget: "impor", amount: 15_000 }] },
      { kind: "funding", date: d(4, 22), purpose: "BYA_OUT", note: `Operasional gudang SBTC ${y}`, budget: "anakops", amount: 150_000_000, confirmFrom: "BCA-OPS" },
      { kind: "cbt", date: d(6, 24), purpose: "BYA_OUT", cashBank: "MDR-PAY", note: `Gaji dan tunjangan semester I ${y}`, lines: [{ budget: "gaji", amount: 120_000_000 }] },
      journal(depreciation(y, 2, 21_000_000)),
      { kind: "cbt", date: d(7, 14), purpose: "HIN_CAB_IN", cashBank: "BCA-OPS", partner: "Cabang Surabaya", note: `Bagi hasil semester I ${y} Cabang Surabaya diterima`, lines: [{ budget: "bagihasilsby", amount: 540_000_000 }] },
      { kind: "cbt", date: d(8, 20), purpose: "BYA_OUT", cashBank: "BCA-USD", currency: "USD", note: `Pembayaran pemasok suku cadang Singapura, invoice SG-2188`, lines: [{ budget: "impor", amount: 10_000 }] },
      note({ type: "Debit", book: "Titipan", partner: "Cabang Surabaya", amount: 2_500_000, description: `Koreksi selisih titipan dana armada ${y}`, reference: `BA-SBY-09/${y}`, note: `Koreksi selisih titipan dana armada Cabang Surabaya ${y}`, date: d(9, 2), status: "Posted" }),
      { kind: "cbt", date: d(9, 8), purpose: "TTP_CAB_OUT", cashBank: "BCA-OPS", partner: "Cabang Surabaya", note: `Pengembalian titipan dana armada Cabang Surabaya ${y}`, lines: [{ budget: "titipan", amount: 72_500_000 }] },
      journal(depreciation(y, 3, 21_000_000)),
      { kind: "cbt", date: d(10, 6), purpose: "BYA_OUT", cashBank: "BCA-OPS", note: `Operasional gudang Cikarang semester II ${y}`, lines: [{ budget: "ops", amount: 200_000_000 }] },
      // The last of the oldest layer, bought at 15.480, sold at 16.400.
      transfer({ purpose: "Pencairan", from: "BCA-USD", currency: "USD", rate: 16_400, date: d(11, 5), note: `Pencairan sisa valas lama ${y}`, lines: [{ to: "BCA-OPS", amount: 5_000 }] }),
      { kind: "cbt", date: d(11, 12), purpose: "BYA_OUT", cashBank: "KAS-PST", note: `Belanja kas kecil kantor pusat ${y}`, lines: [{ budget: "kaskecil", amount: 30_000_000 }] },
      { kind: "cbt", date: d(11, 20), purpose: "HTG_SH_OUT", cashBank: "BCA-OPS", partner: "H. Suryanto Halim", note: `Pengembalian tahap I setoran modal H. Suryanto Halim ${y}`, lines: [{ budget: "pengembalian", amount: 300_000_000 }] },
      { kind: "cbt", date: d(12, 9), purpose: "PRV_SH_OUT", cashBank: "BCA-OPS", partner: "H. Suryanto Halim", note: `Prive akhir tahun H. Suryanto Halim ${y}`, lines: [{ budget: "prive", amount: 120_000_000 }] },
      { kind: "cbt", date: d(12, 15), purpose: "HIN_CAB_IN", cashBank: "BCA-OPS", partner: "Cabang Surabaya", note: `Bagi hasil semester II ${y} Cabang Surabaya diterima`, lines: [{ budget: "bagihasilsby", amount: 610_000_000 }] },
      { kind: "cbt", date: d(12, 18), purpose: "HIN_CAB_IN", cashBank: "BCA-OPS", partner: "Cabang Medan", note: `Bagi hasil pertama Cabang Medan ${y} diterima`, lines: [{ budget: "bagihasilmdn", amount: 180_000_000 }] },
      { kind: "cbt", date: d(12, 19), purpose: "BYA_OUT", cashBank: "MDR-PAY", note: `Gaji dan tunjangan semester II ${y}`, lines: [{ budget: "gaji", amount: 120_000_000 }] },
      journal(depreciation(y, 4, 21_000_000)),
      journal(accrual(y, 8_100_000)),
    ],
  };
}

/**
 * The year being worked in. Everything here is dated on or before today's
 * date in the months it uses — no document may be dated ahead (§12).
 */
function currentYear(): YearPlan {
  return {
    year: YEAR,
    budgets: [
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
      { key: "listrik", company: "induk", date: day(1, 5), type: "Out", category: "Biaya", amount: 8_100_000, description: `Tagihan listrik dan telepon Desember ${YEAR - 1}`, status: "Closed" },
      { key: "gaji", company: "induk", date: day(6, 10), type: "Out", category: "Biaya", amount: 130_000_000, description: `Gaji dan tunjangan karyawan semester I ${YEAR}`, status: "Closed" },
      { key: "bagihasilsby", company: "induk", date: day(6, 2), type: "In", category: "Hasil Investasi", partner: "Cabang Surabaya", amount: 620_000_000, description: `Bagi hasil semester I ${YEAR} Cabang Surabaya`, status: "Closed" },
    ],
    events: [
      journal(reversal(YEAR - 1, 8_100_000)),
      { kind: "cbt", date: day(1, 8), purpose: "BYA_OUT", cashBank: "KAS-PST", note: `Pembayaran tagihan listrik dan telepon Desember ${YEAR - 1}`, lines: [{ budget: "listrik", amount: 8_100_000 }] },
      { kind: "cbt", date: day(1, 9), purpose: "HTG_SH_IN", cashBank: "BCA-OPS", partner: "H. Suryanto Halim", note: "Setoran modal kerja, dikembalikan setelah kontrak selesai", lines: [{ budget: "modalkerja", amount: 750_000_000 }] },
      transfer({ purpose: "Transfer", from: "BCA-OPS", currency: "IDR", rate: 1, date: day(1, 12), note: `Pengisian kas dan rekening payroll semester I ${YEAR}`, lines: [{ to: "KAS-PST", amount: 50_000_000 }, { to: "MDR-PAY", amount: 200_000_000 }] }),
      { kind: "cbt", date: day(1, 20), purpose: "BYA_OUT", cashBank: "BCA-OPS", note: "Termin II sesuai berita acara serah terima", lines: [{ budget: "gudang", amount: 185_000_000 }] },
      { kind: "cbt", date: day(1, 22), purpose: "PTG_KRY_OUT", cashBank: "MDR-PAY", partner: "Budi Santoso", note: "Advance perjalanan dinas, dipertanggungjawabkan setelah kembali", lines: [{ budget: "advance", amount: 10_000_000 }] },
      note({ type: "Debit", book: "Piutang", partner: "Budi Santoso", amount: 1_250_000, description: "Kelebihan klaim uang harian perjalanan dinas Surabaya", reference: "SPD-SBY-0142", note: "Kelebihan klaim uang harian perjalanan dinas Surabaya, dibebankan kembali", date: day(2, 3), status: "Posted" }),
      // Taken back, so Cancelled is on the screen too.
      { kind: "cbt", date: day(2, 10), purpose: "AST_OUT", cashBank: "BCA-OPS", note: "Dibatalkan — unit tidak tersedia, pengadaan diulang", lines: [{ budget: "forklift", amount: 340_000_000 }], status: "Cancelled" },
      note({ type: "Debit", book: "Hutang", partner: "H. Suryanto Halim", amount: 2_000_000, description: "Selisih pengembalian setoran modal kerja", note: "Dibatalkan — selisih sudah diselesaikan lewat transfer", date: day(2, 20), status: "Cancelled" }),
      // Still waiting, so the induk's queue is not empty.
      { kind: "funding", date: day(2, 27), purpose: "BYA_OUT", note: "Operasional gudang Februari, menunggu konfirmasi induk", budget: "operasional", amount: 65_000_000 },
      // Confirmed. The anak's Purpose keeps a subject book, so its own Piutang
      // against Dedi Kurniawan is written — while the position between the two
      // Companies goes to the bridge accounts (§10 rule 61).
      { kind: "funding", date: day(3, 2), purpose: "PTG_KRY_OUT", partner: "Dedi Kurniawan", note: "Advance operasional cabang, dipertanggungjawabkan akhir bulan", budget: "advanceanak", amount: 15_000_000, confirmFrom: "BCA-OPS" },
      { kind: "cbt", date: day(3, 3), purpose: "BYA_OUT", cashBank: "BCA-USD", currency: "USD", note: "Pembayaran pemasok Singapura, invoice SG-2291", lines: [{ budget: "sparepart", amount: 5_000 }] },
      note({ type: "Credit", book: "Piutang", partner: "Budi Santoso", amount: 350_000, description: "Biaya tol dan parkir perjalanan dinas disetujui", note: "Biaya tol dan parkir disetujui, mengurangi advance", date: day(3, 10), status: "Draft" }),
      // A Draft, left as one: it has moved nothing, which is what Draft means.
      { kind: "cbt", date: day(3, 20), purpose: "PRV_SH_OUT", cashBank: "KAS-PST", partner: "H. Suryanto Halim", note: "Menunggu konfirmasi jadwal pencairan", lines: [{ budget: "prive", amount: 30_000_000 }], status: "Draft" },
      journal(depreciation(YEAR, 1, 24_000_000)),
      note({ type: "Credit", book: "Hutang", partner: "H. Suryanto Halim", amount: 7_500_000, description: "Kompensasi atas setoran modal kerja kuartal I", reference: `SK-SYH-03/${YEAR}`, note: "Kompensasi atas setoran modal kerja kuartal I", date: day(3, 31), status: "Posted" }),
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
      // Dollars from the layer bought at 16.350, sold at 16.100: a realized loss.
      transfer({ purpose: "Pencairan", from: "BCA-USD", currency: "USD", rate: 16_100, date: day(4, 8), note: "Pencairan valas untuk kebutuhan rupiah operasional", lines: [{ to: "BCA-OPS", amount: 20_000 }] }),
      transfer({ purpose: "PembelianValas", from: "BCA-OPS", currency: "USD", rate: 16_050, date: day(5, 12), note: "Pembelian valas untuk pembayaran pemasok kuartal II", lines: [{ to: "BCA-USD", amount: 10_000 }] }),
      { kind: "cbt", date: day(6, 24), purpose: "BYA_OUT", cashBank: "MDR-PAY", note: `Gaji dan tunjangan karyawan semester I ${YEAR}`, lines: [{ budget: "gaji", amount: 130_000_000 }] },
      journal(depreciation(YEAR, 2, 24_000_000)),
      { kind: "cbt", date: day(7, 13), purpose: "HIN_CAB_IN", cashBank: "BCA-OPS", partner: "Cabang Surabaya", note: `Bagi hasil semester I ${YEAR} Cabang Surabaya diterima`, lines: [{ budget: "bagihasilsby", amount: 620_000_000 }] },
      transfer({ purpose: "Transfer", from: "BCA-OPS", currency: "IDR", rate: 1, date: day(8, 28), note: "Menunggu jadwal pembayaran gaji akhir bulan", lines: [{ to: "MDR-PAY", amount: 120_000_000 }] }, true),
    ],
  };
}

const PLANS: YearPlan[] = [
  foundingYear(FIRST_YEAR),
  expansionYear(FIRST_YEAR + 1),
  importYear(FIRST_YEAR + 2),
  currentYear(),
];

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
    rate: layer?.rate,
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
      case "note":
        await writeNote(e.spec, actor);
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
    await insertChart(company.id, company.company_label, actor);
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

  // The years in order, each posted through the real engine. The oldest is
  // closed by both Companies once its own events are in — after that nothing
  // may be posted into it — and the later years then run as its successors.
  for (const plan of PLANS) {
    await runPlan(plan, actor);
    if (plan.year === CLOSED_YEAR) await closeOldestYear(actor);
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
