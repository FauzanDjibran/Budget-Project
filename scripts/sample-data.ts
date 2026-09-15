/**
 * Sample Partner and Chart of Accounts data for a development database.
 *
 * THIS IS NOT THE SEEDER. `prisma/seed.ts` writes system data and nothing else,
 * and that is frozen (CLAUDE.md §12) — partners and accounts are business data
 * that real users create through the GUI. This script exists so a developer can
 * fill an empty development database with something plausible to test against,
 * and it is never run as part of install, migrate, reset, or CI.
 *
 * It behaves the way a person entering the data would:
 *
 *   - Account numbers are composed from the chart, never typed. Each account
 *     takes the next free segment under its kelompok or its parent account,
 *     exactly as `composeSegmentCode` does — see lib/siba/account-code.ts.
 *   - Nothing is overwritten. A record that already exists, matched by name
 *     under the same parent, is reused and its children are added beneath it.
 *     Re-running adds only what is missing, and it never deletes.
 *   - Every insert writes an `audit_log` entry, as `createRecord` does.
 *
 * Run with: npm run db:sample
 */
import "dotenv/config";
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
          { name: "Bank BNI" },
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
    accounts: [{ name: "Laba Rugi Tahun Berjalan" }],
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
    accounts: [{ name: "Biaya Bunga Pinjaman" }, { name: "Selisih Kurs" }],
  },
];

/** Two per Partner Category, named plainly because they are placeholders. */
const PARTNERS: [label: string, name: string, category: string][] = [
  ["CAB-A", "Cabang A", "Cabang"],
  ["CAB-B", "Cabang B", "Cabang"],
  ["KRY-A", "Karyawan A", "Karyawan"],
  ["KRY-B", "Karyawan B", "Karyawan"],
  ["STK-A", "Stakeholder A", "Stakeholder"],
  ["STK-B", "Stakeholder B", "Stakeholder"],
];

const PARTNER_NOTE = "Data contoh untuk pengujian.";

const made: Record<string, number> = {};
const tally = (what: string, n = 1) => {
  if (n) made[what] = (made[what] ?? 0) + n;
};

// --------------------------------------------------------------------- run

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

  // Partners belong to a Company and cannot be moved between them, and
  // partner_label is unique across the whole table — so one set, on the induk,
  // which is the only Company Finance transacts for today (CLAUDE.md §12).
  const induk = companies.find((c) => c.is_parent)!;
  await insertPartners(induk.id, actor);

  // A chart of accounts, on the other hand, is per Company: the same numbers
  // on a different Company are different records.
  for (const company of companies) {
    await insertChart(company.id, company.company_label, actor);
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

async function insertPartners(companyId: number, actor: number) {
  const categories = new Map(
    (
      await prisma.sysPartnerCategory.findMany({
        select: { id: true, category_label: true },
      })
    ).map((c) => [c.category_label, c.id])
  );

  for (const [label, name, categoryLabel] of PARTNERS) {
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
