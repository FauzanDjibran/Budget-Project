/**
 * Seeds the fixtures from `SIBA Mockup 2.0.html`'s `buildSeed()` so the app
 * starts with the same data the mockup demonstrates.
 *
 * Ids are set explicitly to match the mockup, which keeps cross-references
 * readable; the sequences are resynced at the end so later inserts don't
 * collide.
 *
 * Run with: npm run db:seed
 */
import "dotenv/config";
import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PURPOSES, rateFor } from "../src/lib/siba/rules";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SEED_TS = new Date("2026-01-01T08:00:00Z");
const SYS = 1; // "Sistem" user
const ME = 2; // "MeeHun" user

/** Dev-only password for both seeded accounts. */
const DEV_PASSWORD = "siba123";

const pad4 = (n: number) => String(n).padStart(4, "0");
const code = (prefix: string, n: number) => `${prefix}.${pad4(n)}`;
const ts = (s: string) => new Date(s.replace(" ", "T") + "Z");
const day = (s: string) => new Date(`${s}T00:00:00Z`);

const audit = (by = SYS) => ({
  created_by: by,
  updated_by: null,
  created_at: SEED_TS,
  updated_at: SEED_TS,
});

// --------------------------------------------------------------- chart of accounts

/** [offset, subcategoryId, label, name, normalBalance, postable, partnerCategory, control, parentOffset] */
const COA_TEMPLATE: [
  number, number, string, string, "Debit" | "Kredit", boolean, string | null, boolean, number | null
][] = [
  [1, 1, "1101", "Kas", "Debit", true, null, false, null],
  [2, 2, "1102", "Bank", "Debit", false, null, false, null],
  [3, 2, "110201", "Bank Mandiri", "Debit", true, null, false, 2],
  [4, 2, "110202", "Bank BCA", "Debit", true, null, false, 2],
  [5, 3, "1201", "Piutang dari Cabang", "Debit", true, "Cabang", true, null],
  [6, 3, "1202", "Piutang dari Karyawan", "Debit", true, "Karyawan", true, null],
  [7, 3, "1203", "Piutang dari Stakeholder", "Debit", true, "Stakeholder", true, null],
  [8, 4, "1301", "Investasi pada Cabang/Entitas", "Debit", true, "Cabang", true, null],
  [9, 5, "1401", "Aktiva Tetap", "Debit", true, null, false, null],
  [10, 6, "2101", "Titipan dari Cabang", "Kredit", true, "Cabang", true, null],
  [11, 6, "2102", "Titipan dari Stakeholder", "Kredit", true, "Stakeholder", true, null],
  [12, 7, "2201", "Hutang kepada Cabang", "Kredit", true, "Cabang", true, null],
  [13, 7, "2202", "Hutang kepada Karyawan", "Kredit", true, "Karyawan", true, null],
  [14, 7, "2203", "Hutang kepada Stakeholder", "Kredit", true, "Stakeholder", true, null],
  [15, 8, "3101", "Modal", "Kredit", true, null, false, null],
  [16, 9, "3201", "Prive / Dividen Stakeholder", "Debit", true, "Stakeholder", true, null],
  [17, 10, "4101", "Pendapatan Hasil Investasi", "Kredit", true, "Cabang", false, null],
  [18, 11, "5101", "Biaya Umum", "Debit", true, null, false, null],
];

/** Company 1's accounts occupy ids 1-18, company 2's 101-118. */
const COA_BASE: Record<number, number> = { 1: 0, 2: 100 };
const PARTNER_CATEGORY_ID: Record<string, number> = {
  Cabang: 1,
  Karyawan: 2,
  Stakeholder: 3,
};
const BUDGET_CATEGORY_ID: Record<string, number> = {
  Titipan: 1,
  Hutang: 2,
  Piutang: 3,
  Prive: 4,
  Asset: 5,
  Biaya: 6,
  Investasi: 7,
  "Hasil Investasi": 8,
};

/** [budgetCategory, partnerCategory, accountOffset] */
const MAPPING: [string, string | null, number][] = [
  ["Titipan", "Cabang", 10],
  ["Titipan", "Stakeholder", 11],
  ["Hutang", "Cabang", 12],
  ["Hutang", "Karyawan", 13],
  ["Hutang", "Stakeholder", 14],
  ["Piutang", "Cabang", 5],
  ["Piutang", "Karyawan", 6],
  ["Piutang", "Stakeholder", 7],
  ["Prive", "Stakeholder", 16],
  ["Asset", null, 9],
  ["Biaya", null, 18],
  ["Investasi", "Cabang", 8],
  ["Hasil Investasi", "Cabang", 17],
];

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const MONTH_END = ["31", "28", "31", "30", "31", "30", "31", "31", "30", "31", "30", "31"];

// --------------------------------------------------------------- budgets

/** [id, date, companyId, currencyId, type, description, amount, status, categoryId, partnerId, realized, createdAt] */
const BUDGETS: [
  number, string, number, number, "In" | "Out", string, number, string,
  number | null, number | null, number, string
][] = [
  [1, "2026-09-02", 1, 1, "Out", "Pembayaran sewa gudang bulan September", 25000000, "Open", 6, null, 0, "2026-08-28 09:14:00"],
  [2, "2026-09-03", 1, 1, "Out", "Pembayaran prive Direktur Utama", 15000000, "Closed", 4, 6, 15000000, "2026-08-28 09:20:00"],
  [3, "2026-09-05", 1, 1, "In", "Penerimaan titipan dana operasional Cabang Jakarta", 40000000, "Open", 1, 1, 0, "2026-08-29 10:02:00"],
  [4, "2026-09-08", 2, 1, "Out", "Biaya operasional kantor Trading", 12500000, "Submitted", null, null, 0, "2026-09-01 08:41:00"],
  [5, "2026-09-09", 2, 1, "Out", "Pembelian perlengkapan kantor", 4750000, "Submitted", null, null, 0, "2026-09-01 08:47:00"],
  [6, "2026-09-10", 1, 1, "Out", "Pembayaran hutang kepada Cabang Surabaya", 32000000, "Submitted", null, null, 0, "2026-09-02 11:05:00"],
  [7, "2026-09-11", 1, 1, "Out", "Biaya perjalanan dinas tim penjualan", 6200000, "Draft", null, null, 0, "2026-09-03 14:22:00"],
  [8, "2026-09-12", 2, 1, "In", "Penerimaan pelunasan piutang Cabang Bandung", 18000000, "Draft", null, null, 0, "2026-09-03 15:10:00"],
  [9, "2026-09-15", 1, 2, "Out", "Pembayaran vendor perangkat lunak luar negeri", 3500, "Submitted", null, null, 0, "2026-09-04 09:33:00"],
  [10, "2026-09-04", 1, 1, "Out", "Perbaikan kendaraan operasional", 8900000, "Rejected", null, null, 0, "2026-08-30 16:48:00"],
  [11, "2026-09-01", 2, 1, "Out", "Sewa ruko cabang Trading", 20000000, "Open", 6, null, 0, "2026-08-25 10:15:00"],
  [12, "2026-09-06", 1, 1, "Out", "Investasi peralatan produksi Cabang Medan", 75000000, "Open", 7, 3, 25000000, "2026-08-27 13:37:00"],
  [13, "2026-09-07", 2, 1, "Out", "Pengadaan yang dibatalkan", 3000000, "Cancelled", null, null, 0, "2026-09-01 09:05:00"],
  [14, "2026-09-18", 1, 1, "Out", "Pengembalian titipan kepada Cabang Jakarta", 22000000, "Submitted", null, null, 0, "2026-09-08 10:28:00"],
  [15, "2026-09-19", 2, 1, "Out", "Biaya pemeliharaan gudang cabang", 9300000, "Submitted", null, null, 0, "2026-09-09 08:12:00"],
  [16, "2026-08-20", 1, 1, "Out", "Biaya listrik dan air bulan Agustus", 5400000, "Closed", 6, null, 5400000, "2026-08-12 09:00:00"],
  [17, "2026-08-22", 2, 1, "Out", "Gaji karyawan bulan Agustus", 45000000, "Open", 6, null, 0, "2026-08-14 09:00:00"],
  [18, "2026-08-25", 1, 1, "In", "Penerimaan hasil investasi dari Cabang Medan", 12750000, "Closed", 8, 3, 12750000, "2026-08-18 11:20:00"],
  [19, "2026-09-16", 1, 2, "Out", "Perpanjangan lisensi sistem akuntansi", 1250, "Submitted", null, null, 0, "2026-09-05 13:15:00"],
  [20, "2026-09-17", 1, 2, "In", "Penerimaan royalti lisensi luar negeri", 4800, "Submitted", null, null, 0, "2026-09-05 14:02:00"],
  // Approved Holding budgets — the realization pool for the Finance module
  [21, "2026-09-01", 1, 1, "Out", "Pembayaran listrik dan air September", 6800000, "Open", 6, null, 3000000, "2026-08-26 09:30:00"],
  [22, "2026-09-02", 1, 1, "Out", "Pembayaran internet dan telepon September", 3200000, "Closed", 6, null, 3200000, "2026-08-26 09:34:00"],
  [23, "2026-09-04", 1, 1, "Out", "Pengembalian titipan kepada Cabang Surabaya", 18000000, "Open", 1, 2, 0, "2026-08-27 10:05:00"],
  [24, "2026-09-05", 1, 1, "Out", "Pembayaran prive rutin September", 20000000, "Closed", 4, 6, 22000000, "2026-08-27 10:12:00"],
  [25, "2026-09-08", 1, 1, "In", "Penerimaan pelunasan piutang Cabang Jakarta", 30000000, "Open", 3, 1, 0, "2026-08-28 14:20:00"],
  [26, "2026-09-10", 1, 1, "Out", "Pembayaran hutang kepada Stakeholder", 25000000, "Open", 2, 7, 0, "2026-08-29 08:55:00"],
  [27, "2026-09-11", 1, 2, "Out", "Langganan layanan cloud tahunan", 2400, "Open", 6, null, 0, "2026-08-30 11:02:00"],
  [28, "2026-09-12", 1, 1, "Out", "Pembelian perangkat komputer kantor", 14500000, "Open", 5, null, 0, "2026-08-31 09:18:00"],
  [29, "2026-09-14", 1, 1, "In", "Penerimaan titipan tahap dua Cabang Jakarta", 25000000, "Open", 1, 1, 0, "2026-09-01 13:40:00"],
  [30, "2026-09-15", 1, 1, "Out", "Biaya perawatan gedung kantor pusat", 9000000, "Open", 6, null, 0, "2026-09-02 10:07:00"],
  [31, "2026-09-03", 1, 1, "Out", "Advance perjalanan dinas Budi Santoso", 7500000, "Open", 3, 4, 0, "2026-08-27 15:40:00"],
  [32, "2026-09-09", 1, 1, "In", "Pelunasan advance perjalanan dinas Siti Rahayu", 4200000, "Open", 3, 5, 0, "2026-08-31 16:05:00"],
  [33, "2026-09-13", 1, 1, "Out", "Pembayaran reimbursement Budi Santoso", 5600000, "Open", 2, 4, 0, "2026-09-02 08:20:00"],
  [34, "2026-09-06", 1, 1, "In", "Penerimaan titipan dana Stakeholder", 50000000, "Open", 1, 7, 0, "2026-08-29 09:10:00"],
  [35, "2026-09-20", 1, 1, "Out", "Investasi tambahan pada Cabang Surabaya", 40000000, "Open", 7, 2, 0, "2026-09-06 11:30:00"],
  [36, "2026-09-21", 1, 1, "Out", "Pengembalian titipan kepada Rina Kusuma", 30000000, "Open", 1, 7, 0, "2026-09-07 09:15:00"],
  [37, "2026-09-22", 1, 1, "In", "Penerimaan pinjaman dari Cabang Surabaya", 50000000, "Open", 2, 2, 0, "2026-09-07 10:40:00"],
  [38, "2026-09-23", 1, 1, "Out", "Pemberian pinjaman kepada Cabang Jakarta", 35000000, "Open", 3, 1, 0, "2026-09-08 08:50:00"],
  [39, "2026-09-24", 1, 1, "Out", "Pembayaran prive tahap dua Direktur Utama", 18000000, "Open", 4, 6, 0, "2026-09-08 14:05:00"],
  [40, "2026-09-25", 1, 1, "In", "Penerimaan hasil investasi Cabang Surabaya", 9500000, "Open", 8, 2, 0, "2026-09-09 09:25:00"],
  [41, "2026-09-26", 1, 1, "Out", "Pembayaran hutang kepada Cabang Medan", 16000000, "Open", 2, 3, 0, "2026-09-09 15:50:00"],
];

// --------------------------------------------------------------- transactions

/** [id, documentDate, postingDate, purposeKey, companyId, cashBankId, partnerId, status, note] */
const TRANSACTIONS: [
  number, string, string | null, string, number, number, number | null, string, string
][] = [
  [1, "2026-08-20", "2026-08-20 14:05:00", "BYA_OUT", 1, 2, null, "Posted", "Pembayaran tagihan listrik dan air periode Agustus."],
  [2, "2026-08-25", "2026-08-25 10:40:00", "HIN_CAB_IN", 1, 2, 3, "Posted", "Penerimaan bagi hasil investasi Cabang Medan."],
  [3, "2026-09-03", "2026-09-03 15:20:00", "PRV_SH_OUT", 1, 3, 6, "Posted", "Pencairan prive Direktur Utama."],
  [4, "2026-09-06", "2026-09-06 11:12:00", "INV_CAB_OUT", 1, 2, 3, "Posted", "Pembayaran termin pertama investasi peralatan Cabang Medan."],
  [5, "2026-09-07", "2026-09-07 16:02:00", "PRV_SH_OUT", 1, 3, 6, "Posted", "Realisasi melebihi outstanding budget atas persetujuan lisan Direksi."],
  [6, "2026-09-09", "2026-09-09 09:48:00", "BYA_OUT", 1, 2, null, "Posted", "Satu dokumen merealisasikan dua Budget biaya sekaligus."],
  [7, "2026-09-12", null, "BYA_OUT", 1, 2, null, "Draft", "Pembayaran sebagian sewa gudang, menunggu tanda terima."],
  [8, "2026-09-13", null, "TTP_CAB_OUT", 1, 3, 2, "Cancelled", "Dibatalkan, Cabang Surabaya meminta penjadwalan ulang."],
];

/** [transactionId, budgetId, outstandingSnapshot, settlementAmount] */
const TRANSACTION_LINES: [number, number, number, number][] = [
  [1, 16, 5400000, 5400000],
  [2, 18, 12750000, 12750000],
  [3, 2, 15000000, 15000000],
  [4, 12, 75000000, 25000000],
  [5, 24, 20000000, 22000000],
  [6, 21, 6800000, 3000000],
  [6, 22, 3200000, 3200000],
  [7, 1, 25000000, 10000000],
  [8, 23, 18000000, 18000000],
];

/** Opening cash/bank balances, keyed by cash bank id. */
const OPENING_BALANCE: Record<number, number> = {
  1: 85000000,
  2: 1250000000,
  3: 640000000,
  4: 48500,
};

const CURRENCY_LABEL: Record<number, string> = { 1: "IDR", 2: "USD", 3: "SGD" };

// --------------------------------------------------------------- run

async function main() {
  console.log("Clearing existing data…");
  // Child-to-parent order so foreign keys never block a delete.
  await prisma.auditLog.deleteMany();
  await prisma.finCashBankTransactionLine.deleteMany();
  await prisma.finCashBankTransaction.deleteMany();
  await prisma.budBudget.deleteMany();
  await prisma.accFiscalPeriod.deleteMany();
  await prisma.accFiscalYear.deleteMany();
  await prisma.accBudgetCategoryAccount.deleteMany();
  await prisma.mCashBank.deleteMany();
  await prisma.accAccount.deleteMany();
  await prisma.accAccountSubcategory.deleteMany();
  await prisma.accAccountCategory.deleteMany();
  await prisma.mPartner.deleteMany();
  await prisma.refCurrency.deleteMany();
  await prisma.sysPartnerCategory.deleteMany();
  await prisma.sysBudgetCategory.deleteMany();
  await prisma.sysDocType.deleteMany();
  await prisma.sysAccountType.deleteMany();
  await prisma.sysCompany.deleteMany();
  await prisma.sysUser.deleteMany();

  const passwordHash = await hash(DEV_PASSWORD, 10);
  await prisma.sysUser.createMany({
    data: [
      { id: SYS, email: "sistem@siba.app", name: "Sistem", initials: "SY", password_hash: passwordHash, created_at: SEED_TS, updated_at: SEED_TS },
      { id: ME, email: "meehun@siba.app", name: "MeeHun", initials: "MH", password_hash: passwordHash, created_at: SEED_TS, updated_at: SEED_TS },
    ],
  });

  await prisma.sysCompany.createMany({
    data: [
      { id: 1, company_code: code("comp", 1), company_label: "Holding", company_name: "Holding Company", is_parent: true, note: "Induk. Memiliki Cash Bank sendiri dan bertindak sebagai treasury provider bagi Company anak.", ...audit() },
      { id: 2, company_code: code("comp", 2), company_label: "Trading", company_name: "Trading Company", is_parent: false, note: "Anak dari Holding Company. Tidak memiliki Cash Bank sendiri; kebutuhan dana dipenuhi melalui Funding Request ke induk.", ...audit() },
    ],
  });

  await prisma.sysAccountType.createMany({
    data: ["Aset", "Kewajiban", "Ekuitas", "Pendapatan", "Beban"].map((label, i) => ({
      id: i + 1, type_code: code("atyp", i + 1), type_label: label, type_name: label, note: "", ...audit(),
    })),
  });

  await prisma.sysDocType.createMany({
    data: [
      ["Budget", "bud_budget"],
      ["Cash Bank Transaction", "fin_cash_bank_transaction"],
      ["Cash Bank Transaction Line", "fin_cash_bank_transaction_line"],
      ["Funding Request", "fin_funding_request"],
      ["Journal", "acc_journal"],
    ].map(([label, table], i) => ({
      id: i + 1, doc_code: code("dtyp", i + 1), doc_label: label, doc_name: label, doc_table: table, note: "", ...audit(),
    })),
  });

  await prisma.sysBudgetCategory.createMany({
    data: [
      ["Titipan", "Dana yang dititipkan pihak lain untuk ditarik kembali. Wajib Partner: Cabang atau Stakeholder."],
      ["Hutang", "Kewajiban kepada pihak lain. Wajib Partner: Cabang, Karyawan, atau Stakeholder."],
      ["Piutang", "Hak tagih kepada pihak lain. Wajib Partner: Cabang, Karyawan, atau Stakeholder."],
      ["Prive", "Pengambilan oleh pemilik. Wajib Partner: Stakeholder."],
      ["Asset", "Pembelian aset tetap. Tanpa Partner, hanya arah Pengeluaran."],
      ["Biaya", "Beban umum. Tanpa Partner, hanya arah Pengeluaran."],
      ["Investasi", "Penyertaan dana ke entitas lain. Wajib Partner Cabang, hanya arah Pengeluaran."],
      ["Hasil Investasi", "Pendapatan dari entitas yang diinvestasi. Wajib Partner Cabang, hanya arah Penerimaan."],
    ].map(([label, note], i) => ({
      id: i + 1, category_code: code("bcat", i + 1), category_label: label, category_name: label, note, ...audit(),
    })),
  });

  await prisma.sysPartnerCategory.createMany({
    data: [
      ["Cabang", "Cabang / Entitas", "Entitas cabang atau investee di luar dua Company utama sistem."],
      ["Karyawan", "Karyawan", "Pegawai perusahaan. Hanya dipakai oleh Hutang dan Piutang."],
      ["Stakeholder", "Pemegang Saham", "Pemilik / pemegang saham. Dipakai oleh Titipan, Hutang, Piutang, dan Prive."],
    ].map(([label, name, note], i) => ({
      id: i + 1, category_code: code("pcat", i + 1), category_label: label, category_name: name, note, ...audit(),
    })),
  });

  await prisma.refCurrency.createMany({
    data: [
      ["IDR", "Rupiah Indonesia", "Base currency pelaporan"],
      ["USD", "Dolar Amerika", ""],
      ["SGD", "Dolar Singapura", ""],
    ].map(([label, name, note], i) => ({
      id: i + 1, currency_code: code("curr", i + 1), currency_label: label, currency_name: name, note, status: "Active" as const, ...audit(),
    })),
  });

  await prisma.mPartner.createMany({
    data: ([
      [1, "CAB-JKT", "Cabang Jakarta", 1, 1, ""],
      [2, "CAB-SBY", "Cabang Surabaya", 1, 1, ""],
      [3, "CAB-MDN", "Cabang Medan", 1, 1, "Entitas investee pada Budget Investasi dan Hasil Investasi."],
      [4, "KRY-BS", "Budi Santoso", 1, 2, ""],
      [5, "KRY-SR", "Siti Rahayu", 1, 2, ""],
      [6, "SH-AW", "Andi Wijaya", 1, 3, "Direktur Utama sekaligus pemegang saham mayoritas."],
      [7, "SH-RK", "Rina Kusuma", 1, 3, ""],
      [8, "CAB-BDG", "Cabang Bandung", 2, 1, ""],
      [9, "KRY-DP", "Dedi Prasetyo", 2, 2, ""],
      [10, "SH-AW2", "Andi Wijaya", 2, 3, "Pemegang saham yang sama dengan Holding, dicatat terpisah karena Partner adalah master per Company."],
    ] as [number, string, string, number, number, string][]).map(([id, label, name, companyId, categoryId, note]) => ({
      id, partner_code: code("part", id), partner_label: label, partner_name: name,
      company_id: companyId, category_id: categoryId, note, status: "Active" as const, ...audit(),
    })),
  });

  await prisma.accAccountCategory.createMany({
    data: ([
      [1, 1, "Kas & Setara Kas"], [2, 1, "Piutang"], [3, 1, "Investasi"], [4, 1, "Aset Tetap"],
      [5, 2, "Titipan"], [6, 2, "Hutang"], [7, 3, "Ekuitas"], [8, 3, "Prive"],
      [9, 4, "Pendapatan"], [10, 5, "Beban"],
    ] as [number, number, string][]).map(([id, typeId, label]) => ({
      id, account_type_id: typeId, category_code: code("acat", id),
      category_label: label, category_name: label, note: "", status: "Active" as const, ...audit(),
    })),
  });

  await prisma.accAccountSubcategory.createMany({
    data: ([
      [1, 1, "Kas", "Kas"],
      [2, 1, "Bank", "Bank"],
      [3, 2, "Piutang", "Piutang per Partner Category"],
      [4, 3, "Investasi", "Investasi pada Entitas"],
      [5, 4, "Aset Tetap", "Aset Tetap"],
      [6, 5, "Titipan", "Titipan per Partner Category"],
      [7, 6, "Hutang", "Hutang per Partner Category"],
      [8, 7, "Modal", "Modal"],
      [9, 8, "Prive", "Prive / Dividen"],
      [10, 9, "Pendapatan Investasi", "Pendapatan Hasil Investasi"],
      [11, 10, "Beban Umum", "Beban Umum"],
    ] as [number, number, string, string][]).map(([id, categoryId, label, name]) => ({
      id, account_category_id: categoryId, subcategory_code: code("asub", id),
      subcategory_label: label, subcategory_name: name, note: "", status: "Active" as const, ...audit(),
    })),
  });

  // Accounts are inserted parent-first so the self-referencing FK resolves.
  let accountSeq = 0;
  const accounts = [1, 2].flatMap((companyId) =>
    COA_TEMPLATE.map((t) => {
      accountSeq += 1;
      const [offset, subcategoryId, label, name, normal, postable, partnerCategory, control, parentOffset] = t;
      return {
        id: COA_BASE[companyId] + offset,
        account_code: code("coa", accountSeq),
        account_subcategory_id: subcategoryId,
        account_label: label,
        account_name: name,
        company_id: companyId,
        parent_account: parentOffset ? COA_BASE[companyId] + parentOffset : null,
        is_postable: postable,
        normal_balance: normal,
        require_partner: partnerCategory != null,
        partner_category_id: partnerCategory ? PARTNER_CATEGORY_ID[partnerCategory] : null,
        is_control_account: control,
        note: "",
        is_active: true,
        ...audit(),
      };
    })
  );
  for (const a of accounts.filter((a) => a.parent_account == null)) {
    await prisma.accAccount.create({ data: a });
  }
  for (const a of accounts.filter((a) => a.parent_account != null)) {
    await prisma.accAccount.create({ data: a });
  }

  await prisma.mCashBank.createMany({
    data: ([
      [1, "Kas Pusat", "Kas Kantor Pusat", 1, "Cash", 1, 1],
      [2, "Mandiri IDR", "Bank Mandiri Rupiah", 1, "Bank", 1, 3],
      [3, "BCA IDR", "Bank BCA Rupiah", 1, "Bank", 1, 4],
      [4, "Mandiri USD", "Bank Mandiri Dolar", 1, "Bank", 2, 3],
    ] as [number, string, string, number, "Cash" | "Bank", number, number][]).map(
      ([id, label, name, companyId, type, currencyId, accountId]) => ({
        id, cash_bank_code: code("cbnk", id), cash_bank_label: label, cash_bank_name: name,
        company_id: companyId, cash_bank_type: type, currency_id: currencyId,
        account_id: accountId, balance: OPENING_BALANCE[id], note: "",
        status: "Active" as const, ...audit(),
      })
    ),
  });

  let mappingId = 0;
  await prisma.accBudgetCategoryAccount.createMany({
    data: [1, 2].flatMap((companyId) =>
      MAPPING.map(([budgetCategory, partnerCategory, accountOffset]) => {
        mappingId += 1;
        return {
          id: mappingId,
          bca_code: code("bcam", mappingId),
          budget_category_id: BUDGET_CATEGORY_ID[budgetCategory],
          partner_category_id: partnerCategory ? PARTNER_CATEGORY_ID[partnerCategory] : null,
          company_id: companyId,
          account_id: COA_BASE[companyId] + accountOffset,
          ...audit(),
        };
      })
    ),
  });

  await prisma.accFiscalYear.createMany({
    data: [
      { id: 1, year_code: code("fyr", 1), year_label: "2026", year_name: "Tahun Buku 2026", start_date: day("2026-01-01"), end_date: day("2026-12-31"), note: "Tahun buku berjalan", status: "Open" as const, ...audit() },
      { id: 2, year_code: code("fyr", 2), year_label: "2027", year_name: "Tahun Buku 2027", start_date: day("2027-01-01"), end_date: day("2027-12-31"), note: "", status: "Draft" as const, ...audit() },
    ],
  });

  await prisma.accFiscalPeriod.createMany({
    data: MONTHS.map((month, i) => {
      const mm = String(i + 1).padStart(2, "0");
      return {
        id: i + 1,
        period_code: code("fprd", i + 1),
        fiscal_year_id: 1,
        sequence_no: i + 1,
        period_label: `2026-${mm}`,
        period_name: `${month} 2026`,
        start_date: day(`2026-${mm}-01`),
        end_date: day(`2026-${mm}-${MONTH_END[i]}`),
        note: "",
        status: (i < 9 ? "Open" : "Draft") as "Open" | "Draft",
        ...audit(),
      };
    }),
  });

  await prisma.budBudget.createMany({
    data: BUDGETS.map(([id, date, companyId, currencyId, type, description, amount, status, categoryId, partnerId, realized, createdAt]) => ({
      id,
      budget_no: `BGT-${pad4(id)}`,
      budget_date: day(date),
      company_id: companyId,
      currency_id: currencyId,
      budget_type: type,
      description,
      budget_amount: amount,
      realized_amount: realized,
      status: status as never,
      category_id: categoryId,
      partner_id: partnerId,
      created_by: ME,
      updated_by: status === "Draft" ? null : ME,
      created_at: ts(createdAt),
      updated_at: ts(createdAt),
    })),
  });

  // Transaction amounts are derived from their lines, exactly as the mockup does.
  const cashBankCurrency: Record<number, number> = { 1: 1, 2: 1, 3: 1, 4: 2 };
  await prisma.finCashBankTransaction.createMany({
    data: TRANSACTIONS.map(([id, docDate, postingDate, purposeKey, companyId, cashBankId, partnerId, status, note]) => {
      const purpose = PURPOSES.find((p) => p.key === purposeKey)!;
      const currencyId = cashBankCurrency[cashBankId] ?? 1;
      const rate = rateFor(CURRENCY_LABEL[currencyId]);
      const amount = TRANSACTION_LINES.filter((l) => l[0] === id).reduce((t, l) => t + l[3], 0);
      return {
        id,
        transaction_no: `CBT-${pad4(id)}`,
        document_date: status === "Posted" ? day(docDate) : null,
        posting_date: postingDate ? ts(postingDate) : null,
        transaction_type: purpose.direction,
        company_id: companyId,
        purpose: purposeKey,
        cash_bank_id: cashBankId,
        currency_id: currencyId,
        exchange_rate: rate,
        partner_id: partnerId,
        transaction_amount: amount,
        transaction_base_amount: amount * rate,
        note,
        status: status as never,
        created_by: ME,
        updated_by: status === "Draft" ? null : ME,
        created_at: ts(`${docDate} 08:30:00`),
        updated_at: postingDate ? ts(postingDate) : ts(`${docDate} 08:30:00`),
      };
    }),
  });

  const sequenceByTransaction: Record<number, number> = {};
  await prisma.finCashBankTransactionLine.createMany({
    data: TRANSACTION_LINES.map(([transactionId, budgetId, outstanding, settlement], i) => {
      const header = TRANSACTIONS.find((t) => t[0] === transactionId)!;
      const currencyId = cashBankCurrency[header[5]] ?? 1;
      const rate = rateFor(CURRENCY_LABEL[currencyId]);
      sequenceByTransaction[transactionId] = (sequenceByTransaction[transactionId] ?? 0) + 1;
      return {
        id: i + 1,
        transaction_id: transactionId,
        sequence_no: sequenceByTransaction[transactionId],
        source_doc_type_id: 1, // Budget
        source_doc_id: budgetId,
        outstanding_amount: outstanding,
        settlement_amount: settlement,
        settlement_base_amount: settlement * rate,
        settlement_exchange_rate: 1,
        transaction_amount: settlement,
        transaction_base_amount: settlement * rate,
        created_by: ME,
        updated_by: null,
        created_at: ts(`${header[1]} 08:30:00`),
        updated_at: header[2] ? ts(header[2]) : ts(`${header[1]} 08:30:00`),
      };
    }),
  });

  await prisma.auditLog.createMany({
    data: ([
      [1, "sys_company", 2, "2026-08-14 09:12:00"],
      [2, "m_cash_bank", 4, "2026-09-02 11:40:00"],
      [3, "acc_account", 12, "2026-09-08 16:05:00"],
      [4, "m_partner", 3, "2026-09-11 10:22:00"],
      [5, "bud_budget", 1, "2026-08-29 14:03:00"],
      [6, "bud_budget", 12, "2026-08-28 09:11:00"],
      [7, "bud_budget", 10, "2026-09-01 10:40:00"],
    ] as [number, string, number, string][]).map(([id, entity, rowId, at]) => ({
      id, entity_key: entity, row_id: rowId, action: "UPDATE" as const, at: ts(at), by: ME,
    })),
  });

  // Explicit ids leave the sequences at 1, which would collide on the next
  // insert. Fast-forward each to its table's current max.
  const sequences: [string, string][] = [
    ["sys_user", "id"], ["sys_company", "id"], ["sys_account_type", "id"],
    ["sys_doc_type", "id"], ["sys_budget_category", "id"], ["sys_partner_category", "id"],
    ["ref_currency", "id"], ["m_partner", "id"], ["m_cash_bank", "id"],
    ["acc_account_category", "id"], ["acc_account_subcategory", "id"], ["acc_account", "id"],
    ["acc_budget_category_account", "id"], ["acc_fiscal_year", "id"], ["acc_fiscal_period", "id"],
    ["bud_budget", "id"], ["fin_cash_bank_transaction", "id"],
    ["fin_cash_bank_transaction_line", "id"], ["audit_log", "id"],
  ];
  for (const [table, column] of sequences) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', '${column}'), COALESCE((SELECT MAX("${column}") FROM "${table}"), 1))`
    );
  }

  const counts = {
    users: await prisma.sysUser.count(),
    companies: await prisma.sysCompany.count(),
    partners: await prisma.mPartner.count(),
    cashBanks: await prisma.mCashBank.count(),
    accounts: await prisma.accAccount.count(),
    mappings: await prisma.accBudgetCategoryAccount.count(),
    periods: await prisma.accFiscalPeriod.count(),
    budgets: await prisma.budBudget.count(),
    transactions: await prisma.finCashBankTransaction.count(),
    transactionLines: await prisma.finCashBankTransactionLine.count(),
  };
  console.table(counts);
  console.log(`\nSeeded. Sign in with meehun@siba.app / ${DEV_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
