/**
 * Brings the system tables up to date. Nothing else.
 *
 * The seed owns exactly two kinds of row:
 *
 *   1. The `sys_*` tables — the bootstrap administrator, the permission
 *      catalogue, the seeded roles, and the fixed two-Company structure.
 *   2. The reference tables that behave as system data even though their names
 *      say otherwise: account types, document types, budget categories,
 *      partner categories, and the account category / subcategory skeleton the
 *      chart of accounts hangs off. Application logic reads these by label, so
 *      they are code in the same sense the permission catalogue is.
 *
 * Everything else — partners, cash & bank resources, currencies beyond the
 * reporting base, accounts, mappings, fiscal years and periods, budgets and
 * transactions — is business data that real users create through the
 * application. It is deliberately absent here.
 *
 * The seed is idempotent and never deletes business data. Rows are created when
 * missing and otherwise left alone, so running it against a live database is
 * safe: it adds what a new release introduced and touches nothing a user has
 * entered or adjusted.
 *
 * Run with: npm run db:seed
 */
import "dotenv/config";
import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PERMISSIONS } from "../src/lib/siba/permissions";
import { SEEDED_ROLES, ADMIN_ROLE, adminPermissionCodes } from "../src/lib/siba/roles";
import { parentCode } from "../src/lib/siba/account-code";
import { BASE_CURRENCY_LABEL } from "../src/lib/siba/currency";
import { SEED_PURPOSES } from "../src/lib/siba/rules";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * The bootstrap administrator.
 *
 * Credentials come from the environment so no real password is ever committed.
 * Outside development the seed refuses to run without one — the fallback below
 * exists purely so a local checkout works out of the box, and CLAUDE.md §11
 * records that it must not survive into a deployed environment.
 */
const ADMIN_EMAIL = process.env.SIBA_ADMIN_EMAIL?.trim().toLowerCase() || "admin@siba.app";
const ADMIN_NAME = process.env.SIBA_ADMIN_NAME?.trim() || "Administrator";
const ADMIN_INITIALS = process.env.SIBA_ADMIN_INITIALS?.trim().toUpperCase() || "AD";

/**
 * Further administrators, seeded beside the bootstrap one.
 *
 * A deliberate deviation from "the seeder seeds system data only" (CLAUDE.md
 * §12), and the only one: these are named people, and `/settings/user` can
 * create them through the GUI exactly as that rule intends. They are here
 * because the deployed database is rebuilt from this file, and an operator who
 * has to be re-created by hand after every reset is the step that gets
 * forgotten. They are `sys_*` rows, which is the one thing that keeps this
 * inside the seeder's stated scope rather than outside it.
 *
 * They share the bootstrap password, which was an explicit instruction. Note
 * what it costs: `audit_log` attributes every write to a person, and people
 * who share a password are not distinguishable in it. Each account is expected
 * to set its own password from the profile page after first sign-in — the seed
 * never touches an account that already exists, so doing so is permanent.
 */
const ADDITIONAL_ADMINS = [
  { email: "rizal@siba.app", name: "Rizal", initials: "RZ" },
  { email: "mikhael@siba.app", name: "Mikhael", initials: "MK" },
] as const;

const DEV_PASSWORD = "siba123";

function resolveAdminPassword(): string {
  const fromEnv = process.env.SIBA_ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SIBA_ADMIN_PASSWORD is required outside development. Set it before seeding."
    );
  }
  return DEV_PASSWORD;
}

/**
 * The two Companies.
 *
 * Exactly one induk and one anak, permanently — the structure is foundational,
 * not configuration, so the application has no write path for it and these rows
 * are created once. Identity is adjusted in the database afterwards; the
 * environment variables exist so a first install does not have to start from
 * placeholder names.
 */
const PARENT_LABEL = process.env.SIBA_PARENT_COMPANY_LABEL?.trim() || "INDUK";
const PARENT_NAME = process.env.SIBA_PARENT_COMPANY_NAME?.trim() || "Perusahaan Induk";
const CHILD_LABEL = process.env.SIBA_CHILD_COMPANY_LABEL?.trim() || "ANAK";
const CHILD_NAME = process.env.SIBA_CHILD_COMPANY_NAME?.trim() || "Perusahaan Anak";

/**
 * The reporting base currency. Further currencies are added through the app.
 *
 * The **label** comes from `lib/siba/currency.ts` and is no longer configurable.
 * It used to be read from `SIBA_BASE_CURRENCY`, which was harmless while nothing
 * in the application knew or cared which currency was base. It is not harmless
 * now: every book entry records what it was worth in base currency, and the code
 * that decides whether a rate of 1 is honest reads the constant. Two statements
 * of one fact would mean an installation could seed `USD` while the application
 * valued everything as though it were `IDR`.
 *
 * The **name** stays configurable: it is display text and nothing branches on it.
 */
const BASE_CURRENCY_NAME = process.env.SIBA_BASE_CURRENCY_NAME?.trim() || "Rupiah Indonesia";

const pad4 = (n: number) => String(n).padStart(4, "0");
const code = (prefix: string, n: number) => `${prefix}.${pad4(n)}`;

/** Tally of what this run had to create, printed at the end. */
const created: Record<string, number> = {};
const tally = (what: string, n = 1) => {
  if (n) created[what] = (created[what] ?? 0) + n;
};

// ------------------------------------------------------------- system data
//
// Labels are load-bearing: `src/lib/siba/rules.ts` keys its classification
// rules off budget and partner category labels, and `CASH_BANK_SUBCATEGORY` in
// `records.ts` names the chart-of-accounts group a cash or bank resource posts
// into. Renaming a label here without renaming it there silently breaks a
// business rule.

/**
 * **Append only.** Each row's `doc_code` is `dtyp.<index + 1>`, so inserting a
 * type in the middle renumbers every one after it and the seed then collides
 * with the codes already in the database — which is a unique-constraint error
 * on a seeder whose whole contract is that it is safe to re-run. A new
 * document type goes at the end, whatever the reading order would prefer.
 */
const DOC_TYPES: [label: string, table: string][] = [
  ["Budget", "bud_budget"],
  ["Cash Bank Transaction", "fin_cash_bank_transaction"],
  ["Cash Bank Transaction Line", "fin_cash_bank_transaction_line"],
  ["Funding Request", "fin_funding_request"],
  ["Journal", "acc_journal"],
  ["Cash Bank Transfer", "fin_cash_bank_transfer"],
  ["Cash Bank Transfer Line", "fin_cash_bank_transfer_line"],
  ["Opening Balance", "acc_opening_balance"],
  // A Fiscal Year is a document type because closing one *produces* journals:
  // the `CLS-` entry names the year it closed as its source, which is what
  // lets a reader get from a journal line back to the close that wrote it.
  ["Fiscal Year", "acc_fiscal_year"],
  // A Debit / Credit Note writes a subject-book entry and a journal, and both
  // name the note as their source.
  ["Debit / Credit Note", "fin_dncn"],
];

/**
 * The eight Budget Categories and the rules each one carries: which directions
 * are meaningful for it, whether it names a Partner at all, and which Partner
 * Categories it admits.
 *
 * Direction follows balance-sheet logic rather than cash direction:
 *
 *   Liability (Titipan, Hutang)   In = obligation up,  Out = obligation down
 *   Asset (Piutang, Investasi)    Out = asset up,      In  = asset down
 *   Contra-equity (Prive)         Out = drawing up,    In  = drawing down
 *   Expense / Fixed asset         Out only
 *   Income                        In only
 *
 * This is the **starting point**, not the running rule. Once seeded, the tables
 * are what the application reads, and the user reshapes them through
 * Master > Klasifikasi. The sync below is written so that it never overwrites
 * an edit made there — see `ensureBudgetCategoryRules`.
 */
const BUDGET_CATEGORIES: [
  label: string,
  note: string,
  directions: ("In" | "Out")[],
  partnerCategories: string[],
  /**
   * Which cash direction **raises** the subject's position, and so whether the
   * category keeps a subject book at all.
   *
   * Balance-sheet logic, never cash direction: money leaving raises a Piutang,
   * a Prive and an Investasi, and *lowers* a Hutang or a Titipan. A book that
   * mirrored the cash flow would print every position backwards.
   *
   * Null exactly where the category names no Partner, because a book with no
   * subject is not a book. The pairing is mandatory in both directions:
   * `sys_budget_category_partner_implies_book` refuses a row that names a
   * Partner without saying which way its book runs, so a fresh database cannot
   * be seeded at all without this column. It was missing until a reset proved
   * it — the categories already in a database had been repaired by migration,
   * so only a database with none showed the gap.
   */
  raises: "In" | "Out" | null,
  /**
   * Whether a Debit / Credit Note may adjust this category's book. On for the
   * three books one Profit & Loss counter account fixes correctly — a deposit
   * held, a payable, a receivable — and off for Prive, Investasi and Hasil
   * Investasi, whose counter entry is not an income or an expense. Written on
   * create only: afterwards the flag is the category's own, set on its form.
   */
  allowsDncn: boolean,
][] = [
  ["Titipan", "Dana yang dititipkan pihak lain untuk ditarik kembali. Wajib Partner: Cabang atau Stakeholder.", ["In", "Out"], ["Cabang", "Stakeholder"], "In", true],
  ["Hutang", "Kewajiban kepada pihak lain. Wajib Partner: Cabang, Karyawan, atau Stakeholder.", ["In", "Out"], ["Cabang", "Karyawan", "Stakeholder"], "In", true],
  ["Piutang", "Hak tagih kepada pihak lain. Wajib Partner: Cabang, Karyawan, atau Stakeholder.", ["In", "Out"], ["Cabang", "Karyawan", "Stakeholder"], "Out", true],
  ["Prive", "Pengambilan oleh pemilik. Wajib Partner: Stakeholder.", ["In", "Out"], ["Stakeholder"], "Out", false],
  ["Asset", "Pembelian aset tetap. Tanpa Partner, hanya arah Pengeluaran.", ["Out"], [], null, false],
  ["Biaya", "Beban umum. Tanpa Partner, hanya arah Pengeluaran.", ["Out"], [], null, false],
  ["Investasi", "Penyertaan dana ke entitas lain. Wajib Partner Cabang, hanya arah Pengeluaran.", ["Out"], ["Cabang"], "Out", false],
  ["Hasil Investasi", "Pendapatan dari entitas yang diinvestasi. Wajib Partner Cabang, hanya arah Penerimaan.", ["In"], ["Cabang"], "In", false],
];

const PARTNER_CATEGORIES: [label: string, name: string, note: string][] = [
  ["Cabang", "Cabang / Entitas", "Entitas cabang atau investee di luar dua Company utama sistem."],
  ["Karyawan", "Karyawan", "Pegawai perusahaan. Hanya dipakai oleh Hutang dan Piutang."],
  ["Stakeholder", "Pemegang Saham", "Pemilik / pemegang saham. Dipakai oleh Titipan, Hutang, Piutang, dan Prive."],
];

/**
 * The chart-of-accounts skeleton, transcribed from `Initialization/Template
 * COA.xlsx` (Sheet1, the workbook's only visible sheet).
 *
 * One flat list, because the hierarchy is already in the codes: a row's depth
 * is its number of segments, and its parent is its code minus the last one.
 * Depth 1 is an Account Type, depth 2 an Account Category, depth 3 an Account
 * Subcategory. Anything deeper is an account, which users create through the
 * application — see `lib/siba/account-code.ts`.
 *
 * Three deviations from the sheet, all of them forced:
 *
 *   - Categories 3.2–3.5 have no row of their own in the sheet, only their
 *     single subcategory. They are named after it, because a subcategory
 *     cannot exist without the category its code claims.
 *   - 4.1.1, 5.1.1 and 5.2.1 have a blank name cell. Each takes its category's
 *     name, the convention the sheet already uses at 4.9.1 and 5.9.1.
 *   - Names are kept verbatim from the sheet, capitals included. They are the
 *     user's own chart, not ours to restyle.
 *
 * `CASH_BANK_SUBCATEGORY` in `lib/siba/records.ts` names 1.1.1 as the group a
 * cash or bank resource posts into, so that code is load-bearing.
 */
const COA_SKELETON: [code: string, name: string][] = [
  ["1", "AKTIVA"],
  ["1.1", "AKTIVA LANCAR"],
  ["1.1.1", "KAS / SETARA KAS"],
  ["1.1.2", "INVESTASI LANCAR"],
  ["1.1.3", "PIUTANG DAGANG"],
  ["1.1.4", "PIUTANG LAIN-LAIN"],
  ["1.1.5", "PERSEDIAAN"],
  ["1.1.6", "UANG MUKA PEMBELIAN"],
  ["1.1.7", "UANG MUKA PAJAK"],
  ["1.1.8", "BIAYA DIBAYAR DIMUKA"],
  ["1.2", "AKTIVA TIDAK LANCAR"],
  ["1.2.1", "INVESTASI JANGKA PANJANG"],
  ["1.3", "AKTIVA TETAP"],
  ["1.3.1", "TANAH"],
  ["1.3.2", "PERALATAN DAN MESIN"],
  ["1.3.3", "GEDUNG DAN BANGUNAN"],
  ["1.3.4", "KENDARAAN DAN INVENTARIS"],
  ["1.3.9", "AKUMULASI PENYUSUTAN"],
  ["1.4", "ASET LAINNYA"],
  ["1.4.1", "ASET TIDAK BERWUJUD"],
  ["1.4.8", "PRA OPERASI"],
  ["1.4.9", "AMORTISASI ASET LAINNYA"],
  ["2", "PASIVA"],
  ["2.1", "KEWAJIBAN JANGKA PENDEK"],
  ["2.1.1", "HUTANG DAGANG"],
  ["2.1.2", "HUTANG PAJAK"],
  ["2.1.3", "HUTANG BIAYA"],
  ["2.1.4", "PENDAPATAN DITERIMA DIMUKA"],
  ["2.1.5", "HUTANG LAIN LAIN"],
  ["2.2", "KEWAJIBAN JANGKA PANJANG"],
  ["2.2.1", "HUTANG JANGKA PANJANG"],
  ["3", "EKUITAS"],
  ["3.1", "MODAL"],
  ["3.1.1", "MODAL AWAL"],
  ["3.2", "REVALUASI AKTIVA TETAP"],
  ["3.2.1", "REVALUASI AKTIVA TETAP"],
  ["3.3", "LABA/RUGI TAHUN SEBELUMNYA"],
  ["3.3.1", "LABA/RUGI TAHUN SEBELUMNYA"],
  ["3.4", "LABA/RUGI TAHUN BERJALAN"],
  ["3.4.1", "LABA/RUGI TAHUN BERJALAN"],
  ["3.5", "L/R ATAS INVESTASI"],
  ["3.5.1", "L/R ATAS INVESTASI"],
  ["4", "PENDAPATAN"],
  ["4.1", "PENDAPATAN DARI USAHA"],
  ["4.1.1", "PENDAPATAN DARI USAHA"],
  ["4.1.8", "PENGURANG HASIL PENJUALAN"],
  ["4.9", "PENDAPATAN DILUAR USAHA"],
  ["4.9.1", "PENDAPATAN DILUAR USAHA"],
  ["5", "BIAYA"],
  ["5.1", "HARGA POKOK PENJUALAN"],
  ["5.1.1", "HARGA POKOK PENJUALAN"],
  ["5.1.9", "HARGA POKOK PENJUALAN WASTE"],
  ["5.2", "BIAYA PENJUALAN"],
  ["5.2.1", "BIAYA PENJUALAN"],
  ["5.3", "BIAYA UMUM DAN ADMINISTRASI"],
  ["5.3.1", "BIAYA UMUM"],
  ["5.3.2", "BIAYA PAJAK"],
  ["5.9", "BIAYA DILUAR USAHA"],
  ["5.9.1", "BIAYA DILUAR USAHA"],
];

/**
 * Which statement each Account Type belongs to.
 *
 * Keyed on the type's code, which is also its label, because that is what the
 * migration backfills on and what a reader of the chart already knows. Neraca
 * is carried forward from one fiscal year into the next; Laba Rugi is closed
 * out into Laba/Rugi Tahun Sebelumnya and starts the new year at nil.
 *
 * Declared here rather than derived from the code's first segment on purpose:
 * the derivation would work today and would break silently the first time
 * somebody added a type. Re-synced on every run, because nothing in the
 * application can change it — the section of a type is not a judgement call,
 * so code is its source of truth in the same sense the permission catalogue is.
 */
const ACCOUNT_TYPE_SECTIONS: Record<string, "BalanceSheet" | "ProfitLoss"> = {
  "1": "BalanceSheet", // AKTIVA
  "2": "BalanceSheet", // PASIVA
  "3": "BalanceSheet", // EKUITAS
  "4": "ProfitLoss", //  PENDAPATAN
  "5": "ProfitLoss", //  BIAYA
};

/**
 * Which step of the multi-step Laba Rugi each Laba Rugi category sits in.
 *
 * Keyed on the category's code, like `ACCOUNT_TYPE_SECTIONS`, and declared for
 * the same reason: `5.1` being Harga Pokok Penjualan is how Sheet1 is laid out,
 * not something the application may infer from a number. Every category under
 * a ProfitLoss type appears here and no Neraca category does — which
 * `tests/accounting.test.ts` asserts against the database. Re-synced on every
 * run, because nothing in the application can write it.
 *
 * `5.3.2 BIAYA PAJAK` sits inside Biaya Umum dan Administrasi, so it is an
 * operating expense: the template has no income-tax category, and therefore
 * the statement has no "Laba Sebelum Pajak" step.
 */
const ACCOUNT_CATEGORY_PL_GROUPS: Record<
  string,
  "OperatingRevenue" | "CostOfSales" | "OperatingExpense" | "OtherIncome" | "OtherExpense"
> = {
  "4.1": "OperatingRevenue", // PENDAPATAN DARI USAHA
  "4.9": "OtherIncome", //      PENDAPATAN DILUAR USAHA
  "5.1": "CostOfSales", //      HARGA POKOK PENJUALAN
  "5.2": "OperatingExpense", // BIAYA PENJUALAN
  "5.3": "OperatingExpense", // BIAYA UMUM DAN ADMINISTRASI
  "5.9": "OtherExpense", //     BIAYA DILUAR USAHA
};

/**
 * Which side each Account Type's own total reads positive on.
 *
 * The Neraca signs every row beneath a type by this rather than by the
 * account's own normal balance, which is what prints Akumulasi Penyusutan — a
 * Kredit account inside AKTIVA — as the deduction it is. Declared rather than
 * inferred from the code for the reason `ACCOUNT_TYPE_SECTIONS` is, and
 * re-synced on every run for the same reason.
 */
const ACCOUNT_TYPE_NORMAL_BALANCE: Record<string, "Debit" | "Kredit"> = {
  "1": "Debit", //  AKTIVA
  "2": "Kredit", // PASIVA
  "3": "Kredit", // EKUITAS
  "4": "Kredit", // PENDAPATAN
  "5": "Debit", //  BIAYA
};

/** The skeleton rows at one depth, in the order the sheet lists them. */
const skeletonLevel = (depth: number) =>
  COA_SKELETON.filter(([c]) => c.split(".").length === depth);


// --------------------------------------------------------------------- run

async function main() {
  const system = await systemUser();
  const audit = { created_by: system, updated_by: null };

  await bootstrapAdministrator();
  await syncPermissionCatalogue();
  await syncRoles(system);
  await ensureCompanies(audit);
  await ensureReferenceData(audit);

  report();
}

/**
 * The account every seeded row is attributed to. Seeded Inactive so it can
 * never be signed in as — it exists to be referenced, not used.
 */
async function systemUser(): Promise<number> {
  const existing = await prisma.sysUser.findUnique({
    where: { email: "sistem@siba.app" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const user = await prisma.sysUser.create({
    data: {
      user_code: await nextUserCode(),
      email: "sistem@siba.app",
      name: "Sistem",
      initials: "SY",
      // Unusable by construction: bcrypt never produces this string, so no
      // password can ever verify against it.
      password_hash: "-",
      status: "Inactive",
    },
    select: { id: true },
  });
  tally("system account");
  return user.id;
}

async function nextUserCode(): Promise<string> {
  const count = await prisma.sysUser.count();
  return code("user", count + 1);
}

/**
 * Creates the administrator if the application has none.
 *
 * An existing account is never touched: re-seeding must not reset a password or
 * reactivate an account somebody deliberately disabled.
 */
async function bootstrapAdministrator(): Promise<void> {
  const password_hash = await hash(resolveAdminPassword(), 10);

  const people = [
    { email: ADMIN_EMAIL, name: ADMIN_NAME, initials: ADMIN_INITIALS, tallyAs: "administrator" },
    ...ADDITIONAL_ADMINS.map((person) => ({ ...person, tallyAs: "additional administrator" })),
  ];

  for (const person of people) {
    const existing = await prisma.sysUser.findUnique({
      where: { email: person.email },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.sysUser.create({
      data: {
        user_code: await nextUserCode(),
        email: person.email,
        name: person.name,
        initials: person.initials,
        password_hash,
      },
    });
    tally(person.tallyAs);
  }
}

/**
 * `src/lib/siba/permissions.ts` is the source of truth; this table is its
 * materialisation. Names and descriptions are re-synced so the role matrix
 * reads current copy, and a permission dropped from the catalogue is removed
 * along with every grant of it — a row no code reads is a row that can only
 * mislead.
 */
async function syncPermissionCatalogue(): Promise<void> {
  const existing = await prisma.sysPermission.findMany({
    select: { id: true, permission_code: true },
  });
  const byCode = new Map(existing.map((p) => [p.permission_code, p.id]));

  let added = 0;
  for (const p of PERMISSIONS) {
    const description = "description" in p ? p.description : null;
    if (byCode.has(p.code)) {
      await prisma.sysPermission.update({
        where: { permission_code: p.code },
        data: { permission_name: p.name, module: p.module, description },
      });
    } else {
      await prisma.sysPermission.create({
        data: {
          permission_code: p.code,
          permission_name: p.name,
          module: p.module,
          description,
        },
      });
      added += 1;
    }
  }
  tally("permissions", added);

  const live = new Set<string>(PERMISSIONS.map((p) => p.code));
  const stale = existing.filter((p) => !live.has(p.permission_code));
  if (stale.length) {
    const ids = stale.map((p) => p.id);
    await prisma.sysRolePermission.deleteMany({ where: { permission_id: { in: ids } } });
    await prisma.sysPermission.deleteMany({ where: { id: { in: ids } } });
    console.log(`  Removed ${stale.length} permission(s) no longer in the catalogue.`);
  }
}

/**
 * Seeded roles are created once and then belong to whoever administers the
 * system — except ADMIN's grant, which is frozen at the whole catalogue and
 * re-synced on every run so it keeps up as capabilities are added. That is what
 * guarantees the application always has a way to administer itself.
 */
async function syncRoles(system: number): Promise<void> {
  const permissionId = new Map(
    (await prisma.sysPermission.findMany({ select: { id: true, permission_code: true } })).map(
      (p) => [p.permission_code, p.id]
    )
  );

  for (const role of SEEDED_ROLES) {
    let row = await prisma.sysRole.findUnique({
      where: { role_label: role.label },
      select: { id: true },
    });
    if (!row) {
      row = await prisma.sysRole.create({
        data: {
          role_code: code("role", (await prisma.sysRole.count()) + 1),
          role_label: role.label,
          role_name: role.name,
          note: role.note,
          is_system: true,
          created_by: system,
        },
        select: { id: true },
      });
      tally("roles");

      // A custom role starts empty; only ADMIN is granted anything on creation.
      for (const c of role.permissions ?? []) {
        await prisma.sysRolePermission.create({
          data: { role_id: row.id, permission_id: permissionId.get(c)!, created_by: system },
        });
      }
    }

    if (role.label !== ADMIN_ROLE) continue;

    const held = new Set(
      (
        await prisma.sysRolePermission.findMany({
          where: { role_id: row.id },
          select: { permission_id: true },
        })
      ).map((g) => g.permission_id)
    );
    const wanted = adminPermissionCodes().map((c) => permissionId.get(c)!);
    const missing = wanted.filter((id) => !held.has(id));
    if (missing.length) {
      await prisma.sysRolePermission.createMany({
        data: missing.map((permission_id) => ({
          role_id: row!.id,
          permission_id,
          created_by: system,
        })),
      });
      tally("administrator grants", missing.length);
    }
  }

  // Every seeded administrator holds the ADMIN role. Re-checked each run so a
  // fresh catalogue entry cannot leave the system unadministrable.
  const adminRole = await prisma.sysRole.findUnique({
    where: { role_label: ADMIN_ROLE },
    select: { id: true },
  });
  if (adminRole) {
    for (const email of [ADMIN_EMAIL, ...ADDITIONAL_ADMINS.map((p) => p.email)]) {
      const user = await prisma.sysUser.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!user) continue;

      const assigned = await prisma.sysUserRole.findUnique({
        where: { user_id_role_id: { user_id: user.id, role_id: adminRole.id } },
        select: { id: true },
      });
      if (!assigned) {
        await prisma.sysUserRole.create({
          data: { user_id: user.id, role_id: adminRole.id, created_by: system },
        });
        tally("administrator role assignment");
      }
    }
  }
}

/**
 * Exactly one induk and one anak. Created only when the table is empty: after
 * that the structure is fixed, and identity edits made directly in the database
 * must survive a re-seed.
 */
async function ensureCompanies(audit: { created_by: number; updated_by: null }): Promise<void> {
  if (await prisma.sysCompany.count()) return;

  await prisma.sysCompany.createMany({
    data: [
      {
        company_code: code("comp", 1),
        company_label: PARENT_LABEL,
        company_name: PARENT_NAME,
        is_parent: true,
        note: "Induk. Memiliki Cash Bank sendiri dan bertindak sebagai treasury provider bagi Company anak.",
        ...audit,
      },
      {
        company_code: code("comp", 2),
        company_label: CHILD_LABEL,
        company_name: CHILD_NAME,
        is_parent: false,
        note: "Anak dari Company induk. Kebutuhan dana dipenuhi melalui Funding Request ke induk.",
        ...audit,
      },
    ],
  });
  tally("companies", 2);
}

async function ensureReferenceData(
  audit: { created_by: number; updated_by: null }
): Promise<void> {
  for (const [i, [label, name]] of skeletonLevel(1).entries()) {
    const section = ACCOUNT_TYPE_SECTIONS[label] ?? "BalanceSheet";
    const normalBalance = ACCOUNT_TYPE_NORMAL_BALANCE[label] ?? "Debit";
    const made = await create(
      () => prisma.sysAccountType.findUnique({ where: { type_label: label } }),
      () =>
        prisma.sysAccountType.create({
          data: {
            type_code: code("atyp", i + 1),
            type_label: label,
            type_name: name,
            section,
            normal_balance: normalBalance,
            ...audit,
          },
        })
    );
    tally("account types", made);

    // Nothing in the application writes this column, so a row disagreeing with
    // the declaration above was changed outside it. Corrected rather than left,
    // because closing reads it to decide which accounts are zeroed.
    if (!made) {
      const fixed = await prisma.sysAccountType.updateMany({
        where: { type_label: label, section: { not: section } },
        data: { section },
      });
      if (fixed.count) tally("account type sections corrected", fixed.count);
      const sided = await prisma.sysAccountType.updateMany({
        where: { type_label: label, normal_balance: { not: normalBalance } },
        data: { normal_balance: normalBalance },
      });
      if (sided.count) tally("account type sides corrected", sided.count);
    }
  }

  for (const [i, [label, table]] of DOC_TYPES.entries()) {
    const made = await create(
      () => prisma.sysDocType.findFirst({ where: { doc_label: label } }),
      () =>
        prisma.sysDocType.create({
          data: {
            doc_code: code("dtyp", i + 1),
            doc_label: label,
            doc_name: label,
            doc_table: table,
            ...audit,
          },
        })
    );
    tally("document types", made);
  }

  for (const [i, [label, note, directions, _partners, raises, allowsDncn]] of BUDGET_CATEGORIES.entries()) {
    const made = await create(
      () => prisma.sysBudgetCategory.findFirst({ where: { category_label: label } }),
      () =>
        prisma.sysBudgetCategory.create({
          data: {
            category_code: code("bcat", i + 1),
            category_label: label,
            category_name: label,
            allows_in: directions.includes("In"),
            allows_out: directions.includes("Out"),
            require_partner: _partners.length > 0,
            raises,
            allows_dncn: allowsDncn,
            note,
            ...audit,
          },
        })
    );
    tally("budget categories", made);
  }

  for (const [i, [label, name, note]] of PARTNER_CATEGORIES.entries()) {
    const made = await create(
      () => prisma.sysPartnerCategory.findFirst({ where: { category_label: label } }),
      () =>
        prisma.sysPartnerCategory.create({
          data: {
            category_code: code("pcat", i + 1),
            category_label: label,
            category_name: name,
            note,
            ...audit,
          },
        })
    );
    tally("partner categories", made);
  }

  await ensureBudgetCategoryRules(audit);
  await ensurePurposes(audit.created_by);

  const typeId = new Map(
    (await prisma.sysAccountType.findMany({ select: { id: true, type_label: true } })).map((t) => [
      t.type_label,
      t.id,
    ])
  );

  // A category hangs off the type its own code names: `1.1` belongs to `1`.
  // Nothing has to be stated twice, and the skeleton cannot contradict itself.
  for (const [i, [label, name]] of skeletonLevel(2).entries()) {
    const plGroup = ACCOUNT_CATEGORY_PL_GROUPS[label] ?? null;
    const made = await create(
      () => prisma.accAccountCategory.findFirst({ where: { category_label: label } }),
      () =>
        prisma.accAccountCategory.create({
          data: {
            account_type_id: typeId.get(parentCode(label)!)!,
            category_code: code("acat", i + 1),
            category_label: label,
            category_name: name,
            pl_group: plGroup,
            ...audit,
          },
        })
    );
    tally("account categories", made);

    // Same reasoning as the type's section: nothing in the application writes
    // this, so a disagreeing row was changed outside it, and the Laba Rugi
    // reads it to decide which subtotal an account falls under.
    if (!made) {
      const fixed = await prisma.accAccountCategory.updateMany({
        // `<> X` never matches a null in SQL, so a missing step is asked for
        // separately from a wrong one.
        where: plGroup
          ? { category_label: label, OR: [{ pl_group: null }, { pl_group: { not: plGroup } }] }
          : { category_label: label, pl_group: { not: null } },
        data: { pl_group: plGroup },
      });
      if (fixed.count) tally("account category Laba Rugi steps corrected", fixed.count);
    }
  }

  const categoryId = new Map(
    (
      await prisma.accAccountCategory.findMany({ select: { id: true, category_label: true } })
    ).map((c) => [c.category_label, c.id])
  );

  for (const [i, [label, name]] of skeletonLevel(3).entries()) {
    const made = await create(
      () =>
        prisma.accAccountSubcategory.findFirst({
          where: { subcategory_label: label },
        }),
      () =>
        prisma.accAccountSubcategory.create({
          data: {
            account_category_id: categoryId.get(parentCode(label)!)!,
            subcategory_code: code("asub", i + 1),
            subcategory_label: label,
            subcategory_name: name,
            ...audit,
          },
        })
    );
    tally("account subcategories", made);
  }

  // The reporting base currency, so a first install can register a Cash & Bank
  // resource and plan a budget without setting up a master first. Every other
  // currency is created through the application.
  const made = await create(
    () => prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL } }),
    () =>
      prisma.refCurrency.create({
        data: {
          currency_code: code("curr", 1),
          currency_label: BASE_CURRENCY_LABEL,
          currency_name: BASE_CURRENCY_NAME,
          note: "Base currency pelaporan.",
          ...audit,
        },
      })
  );
  tally("base currency", made);
}

/** Creates the row when the lookup finds nothing. Returns 1 if it created one. */
/**
 * Brings the Budget Category rules and the Budget Category x Partner Category
 * mappings up to what `BUDGET_CATEGORIES` declares — **without ever overwriting
 * a rule the user has already shaped through the GUI.**
 *
 * That distinction is the whole difficulty here. These rows are system data by
 * origin but user data by intent: the seed states where the model starts, and
 * Master > Klasifikasi is where it goes next. A sync that simply wrote the
 * declared rules back would silently undo a morning's work the first time
 * anyone ran `npm run db:seed` to pick up a new permission.
 *
 * So each half asks a question whose answer distinguishes "never set" from
 * "set to something else":
 *
 *   - Direction is backfilled only when **both** flags are false, which no real
 *     category ever is — a category that moves in no direction could classify
 *     nothing. That state means the row predates the column.
 *   - Mappings are seeded only when the category has **no rows at all**. One
 *     row, even a deactivated one, means somebody has been here.
 *
 * Neither half deletes anything, in keeping with the seeder's contract.
 */
async function ensureBudgetCategoryRules(audit: {
  created_by: number;
  updated_by: null;
}): Promise<void> {
  const partnerId = new Map(
    (
      await prisma.sysPartnerCategory.findMany({
        select: { id: true, category_label: true },
      })
    ).map((c) => [c.category_label, c.id])
  );

  for (const [label, , directions, partners, raises] of BUDGET_CATEGORIES) {
    const category = await prisma.sysBudgetCategory.findFirst({
      where: { category_label: label },
      select: { id: true, allows_in: true, allows_out: true, raises: true },
    });
    // A category the declaration names but the database does not is not this
    // function's to create — the loop above owns that, and reaching here means
    // somebody renamed a label.
    if (!category) continue;

    if (!category.allows_in && !category.allows_out) {
      await prisma.sysBudgetCategory.update({
        where: { id: category.id },
        data: {
          allows_in: directions.includes("In"),
          allows_out: directions.includes("Out"),
          require_partner: partners.length > 0,
          raises,
        },
      });
      tally("budget category rules backfilled");
    }

    // A category that predates the column and was repaired by the migration's
    // rule rather than by name. Filled in only where it is still missing: a
    // direction somebody has since chosen through the GUI is theirs, and the
    // seed does not overwrite it.
    if (partners.length && !category.raises && raises) {
      await prisma.sysBudgetCategory.update({
        where: { id: category.id },
        data: { raises },
      });
      tally("budget category book directions backfilled");
    }

    if (!partners.length) continue;
    const existing = await prisma.sysBudgetPartnerCategoryMapping.count({
      where: { budget_category_id: category.id },
    });
    if (existing) continue;

    for (const partnerLabel of partners) {
      const id = partnerId.get(partnerLabel);
      if (!id) continue;
      const seq =
        (await prisma.sysBudgetPartnerCategoryMapping.count()) + 1;
      await prisma.sysBudgetPartnerCategoryMapping.create({
        data: {
          mapping_code: code("bpcm", seq),
          budget_category_id: category.id,
          partner_category_id: id,
          ...audit,
        },
      });
      tally("budget-partner category mappings");
    }
  }
}

/**
 * Plants the 22 historical Purposes, then lets the generator fill in anything
 * else the classification implies.
 *
 * Only the original 22, and only because their **keys** are already referenced
 * by posted documents — a seeded database has to be able to read those back.
 * Nothing else is planted: a Purpose for a Budget Category somebody adds later
 * is entered through the GUI, on purpose, because this table is a maintainer's
 * to own.
 *
 * Additive and idempotent: a key that already exists is left alone.
 */
async function ensurePurposes(system: number): Promise<void> {
  const categoryId = new Map(
    (
      await prisma.sysBudgetCategory.findMany({
        select: { id: true, category_label: true },
      })
    ).map((c) => [c.category_label, c.id])
  );
  const partnerId = new Map(
    (
      await prisma.sysPartnerCategory.findMany({
        select: { id: true, category_label: true },
      })
    ).map((c) => [c.category_label, c.id])
  );

  for (const purpose of SEED_PURPOSES) {
    const budgetCategoryId = categoryId.get(purpose.budgetCategory);
    // A label renamed since the first seed. The Purpose it named is already in
    // the table under its own key, so skipping is right — planting a second row
    // against a category that no longer answers to this name would be worse.
    if (!budgetCategoryId) continue;
    const partnerCategoryId = purpose.partnerCategory
      ? partnerId.get(purpose.partnerCategory) ?? null
      : null;
    if (purpose.partnerCategory && !partnerCategoryId) continue;

    const made = await create(
      () => prisma.sysPurpose.findFirst({ where: { purpose_key: purpose.key } }),
      () =>
        prisma.sysPurpose.create({
          data: {
            purpose_key: purpose.key,
            budget_category_id: budgetCategoryId,
            partner_category_id: partnerCategoryId,
            direction: purpose.direction,
            created_by: system,
            updated_by: null,
          },
        })
    );
    tally("purposes", made);
  }

}

async function create<T>(find: () => Promise<T | null>, make: () => Promise<T>): Promise<number> {
  if (await find()) return 0;
  await make();
  return 1;
}

function report(): void {
  const entries = Object.entries(created);
  if (entries.length) {
    console.log("Created:");
    for (const [what, n] of entries) console.log(`  ${String(n).padStart(4)}  ${what}`);
  } else {
    console.log("Nothing to create — system data is already up to date.");
  }

  console.log(`\nAdministrator : ${ADMIN_EMAIL}`);
  for (const person of ADDITIONAL_ADMINS) {
    console.log(`                ${person.email}  (${person.name})`);
  }
  if (!process.env.SIBA_ADMIN_PASSWORD) {
    console.log(`Password      : ${DEV_PASSWORD}   <-- DEVELOPMENT ONLY`);
    console.log("                Set SIBA_ADMIN_PASSWORD before seeding anywhere real.");
  }
  console.log(
    "\nBusiness data — partners, cash & bank, accounts, mappings, fiscal periods,\n" +
      "budgets — is created through the application, not by this seed."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
