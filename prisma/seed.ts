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

/** The reporting base currency. Further currencies are added through the app. */
const BASE_CURRENCY_LABEL = process.env.SIBA_BASE_CURRENCY?.trim().toUpperCase() || "IDR";
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
// rules off budget and partner category labels, and `CASH_BANK_SUBCATEGORIES`
// in `records.ts` names the Kas and Bank groups. Renaming a label here without
// renaming it there silently breaks a business rule.

const ACCOUNT_TYPES = ["Aset", "Kewajiban", "Ekuitas", "Pendapatan", "Beban"];

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

/** [account type label, category label] */
const ACCOUNT_CATEGORIES: [string, string][] = [
  ["Aset", "Kas & Setara Kas"],
  ["Aset", "Piutang"],
  ["Aset", "Investasi"],
  ["Aset", "Aset Tetap"],
  ["Kewajiban", "Titipan"],
  ["Kewajiban", "Hutang"],
  ["Ekuitas", "Ekuitas"],
  ["Ekuitas", "Prive"],
  ["Pendapatan", "Pendapatan"],
  ["Beban", "Beban"],
];

/** [category label, subcategory label, subcategory name] */
const ACCOUNT_SUBCATEGORIES: [string, string, string][] = [
  ["Kas & Setara Kas", "Kas", "Kas"],
  ["Kas & Setara Kas", "Bank", "Bank"],
  ["Piutang", "Piutang", "Piutang per Partner Category"],
  ["Investasi", "Investasi", "Investasi pada Entitas"],
  ["Aset Tetap", "Aset Tetap", "Aset Tetap"],
  ["Titipan", "Titipan", "Titipan per Partner Category"],
  ["Hutang", "Hutang", "Hutang per Partner Category"],
  ["Ekuitas", "Modal", "Modal"],
  ["Prive", "Prive", "Prive / Dividen"],
  ["Pendapatan", "Pendapatan Investasi", "Pendapatan Hasil Investasi"],
  ["Beban", "Beban Umum", "Beban Umum"],
];

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
  const existing = await prisma.sysUser.findUnique({
    where: { email: ADMIN_EMAIL },
    select: { id: true },
  });
  if (existing) return;

  await prisma.sysUser.create({
    data: {
      user_code: await nextUserCode(),
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      initials: ADMIN_INITIALS,
      password_hash: await hash(resolveAdminPassword(), 10),
    },
  });
  tally("administrator");
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

  // The bootstrap administrator holds the ADMIN role. Re-checked every run so a
  // fresh catalogue entry cannot leave the system unadministrable.
  const admin = await prisma.sysUser.findUnique({
    where: { email: ADMIN_EMAIL },
    select: { id: true },
  });
  const adminRole = await prisma.sysRole.findUnique({
    where: { role_label: ADMIN_ROLE },
    select: { id: true },
  });
  if (admin && adminRole) {
    const assigned = await prisma.sysUserRole.findUnique({
      where: { user_id_role_id: { user_id: admin.id, role_id: adminRole.id } },
      select: { id: true },
    });
    if (!assigned) {
      await prisma.sysUserRole.create({
        data: { user_id: admin.id, role_id: adminRole.id, created_by: system },
      });
      tally("administrator role assignment");
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
  for (const [i, label] of ACCOUNT_TYPES.entries()) {
    const made = await create(
      () => prisma.sysAccountType.findUnique({ where: { type_label: label } }),
      () =>
        prisma.sysAccountType.create({
          data: { type_code: code("atyp", i + 1), type_label: label, type_name: label, ...audit },
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

  for (const [i, [typeLabel, label]] of ACCOUNT_CATEGORIES.entries()) {
    const made = await create(
      () => prisma.accAccountCategory.findFirst({ where: { category_label: label } }),
      () =>
        prisma.accAccountCategory.create({
          data: {
            account_type_id: typeId.get(typeLabel)!,
            category_code: code("acat", i + 1),
            category_label: label,
            category_name: label,
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

  for (const [i, [categoryLabel, label, name]] of ACCOUNT_SUBCATEGORIES.entries()) {
    const made = await create(
      () =>
        prisma.accAccountSubcategory.findFirst({
          where: {
            subcategory_label: label,
            account_category_id: categoryId.get(categoryLabel)!,
          },
        }),
      () =>
        prisma.accAccountSubcategory.create({
          data: {
            account_category_id: categoryId.get(categoryLabel)!,
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
