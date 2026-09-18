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

const DOC_TYPES: [label: string, table: string][] = [
  ["Budget", "bud_budget"],
  ["Cash Bank Transaction", "fin_cash_bank_transaction"],
  ["Cash Bank Transaction Line", "fin_cash_bank_transaction_line"],
  ["Funding Request", "fin_funding_request"],
  ["Journal", "acc_journal"],
];

const BUDGET_CATEGORIES: [label: string, note: string][] = [
  ["Titipan", "Dana yang dititipkan pihak lain untuk ditarik kembali. Wajib Partner: Cabang atau Stakeholder."],
  ["Hutang", "Kewajiban kepada pihak lain. Wajib Partner: Cabang, Karyawan, atau Stakeholder."],
  ["Piutang", "Hak tagih kepada pihak lain. Wajib Partner: Cabang, Karyawan, atau Stakeholder."],
  ["Prive", "Pengambilan oleh pemilik. Wajib Partner: Stakeholder."],
  ["Asset", "Pembelian aset tetap. Tanpa Partner, hanya arah Pengeluaran."],
  ["Biaya", "Beban umum. Tanpa Partner, hanya arah Pengeluaran."],
  ["Investasi", "Penyertaan dana ke entitas lain. Wajib Partner Cabang, hanya arah Pengeluaran."],
  ["Hasil Investasi", "Pendapatan dari entitas yang diinvestasi. Wajib Partner Cabang, hanya arah Penerimaan."],
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
    const made = await create(
      () => prisma.sysAccountType.findUnique({ where: { type_label: label } }),
      () =>
        prisma.sysAccountType.create({
          data: { type_code: code("atyp", i + 1), type_label: label, type_name: name, ...audit },
        })
    );
    tally("account types", made);
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

  for (const [i, [label, note]] of BUDGET_CATEGORIES.entries()) {
    const made = await create(
      () => prisma.sysBudgetCategory.findFirst({ where: { category_label: label } }),
      () =>
        prisma.sysBudgetCategory.create({
          data: {
            category_code: code("bcat", i + 1),
            category_label: label,
            category_name: label,
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

  const typeId = new Map(
    (await prisma.sysAccountType.findMany({ select: { id: true, type_label: true } })).map((t) => [
      t.type_label,
      t.id,
    ])
  );

  // A category hangs off the type its own code names: `1.1` belongs to `1`.
  // Nothing has to be stated twice, and the skeleton cannot contradict itself.
  for (const [i, [label, name]] of skeletonLevel(2).entries()) {
    const made = await create(
      () => prisma.accAccountCategory.findFirst({ where: { category_label: label } }),
      () =>
        prisma.accAccountCategory.create({
          data: {
            account_type_id: typeId.get(parentCode(label)!)!,
            category_code: code("acat", i + 1),
            category_label: label,
            category_name: name,
            ...audit,
          },
        })
    );
    tally("account categories", made);
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
