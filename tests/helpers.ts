import { prisma } from "../src/lib/prisma";
import { actorFor, type Actor } from "../src/lib/siba/access";
import { hashPassword } from "../src/lib/siba/login";
import { ADMIN_ROLE, STAFF_ROLE } from "../src/lib/siba/roles";

/**
 * Shared fixtures for the security suite.
 *
 * The tests run against the real database and the real service layer — the
 * same functions the Server Actions call — because that is the only way to
 * prove the guards hold. Nothing is stubbed out.
 *
 * Every fixture user is created under a reserved email prefix and cleaned up
 * afterwards, so a run never disturbs the seeded baseline.
 */

export const TEST_PREFIX = "authtest+";

export async function roleIdFor(label: string): Promise<number> {
  const role = await prisma.sysRole.findUniqueOrThrow({ where: { role_label: label } });
  return role.id;
}

export const adminRoleId = () => roleIdFor(ADMIN_ROLE);
export const staffRoleId = () => roleIdFor(STAFF_ROLE);

let counter = 0;

export async function makeUser(options: {
  roleLabels?: string[];
  status?: "Active" | "Inactive";
  password?: string;
  permissions?: string[];
}): Promise<{ id: number; email: string; password: string }> {
  counter += 1;
  const email = `${TEST_PREFIX}${Date.now()}_${counter}@siba.test`;
  const password = options.password ?? "test-password-123";

  const user = await prisma.sysUser.create({
    data: {
      user_code: `test.${String(Date.now() % 100000)}${counter}`,
      email,
      name: `Test User ${counter}`,
      initials: "TU",
      password_hash: await hashPassword(password),
      status: options.status ?? "Active",
    },
  });

  for (const label of options.roleLabels ?? []) {
    await prisma.sysUserRole.create({
      data: { user_id: user.id, role_id: await roleIdFor(label) },
    });
  }

  // An ad-hoc role carrying exactly the permissions a test needs, so a case can
  // isolate one capability without depending on what STAFF happens to hold.
  if (options.permissions) {
    counter += 1;
    const role = await prisma.sysRole.create({
      data: {
        role_code: `test.${String(Date.now() % 100000)}${counter}`,
        role_label: `TEST_ROLE_${Date.now()}_${counter}`,
        role_name: "Test role",
      },
    });
    const perms = await prisma.sysPermission.findMany({
      where: { permission_code: { in: options.permissions } },
      select: { id: true },
    });
    await prisma.sysRolePermission.createMany({
      data: perms.map((p) => ({ role_id: role.id, permission_id: p.id })),
    });
    await prisma.sysUserRole.create({ data: { user_id: user.id, role_id: role.id } });
  }

  return { id: user.id, email, password };
}

export async function actorOf(userId: number): Promise<Actor> {
  const user = await prisma.sysUser.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, user_code: true, email: true, name: true, initials: true },
  });
  return actorFor(user);
}

/** Removes every row this suite created, leaving the seeded baseline intact. */
export async function cleanup(): Promise<void> {
  const users = await prisma.sysUser.findMany({
    where: { email: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);

  if (ids.length) {
    await prisma.sysSession.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.sysUserRole.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { by: { in: ids } } });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "sys_user", row_id: { in: ids } },
    });
    await prisma.sysUser.deleteMany({ where: { id: { in: ids } } });
  }

  const roles = await prisma.sysRole.findMany({
    where: { role_label: { startsWith: "TEST_ROLE_" } },
    select: { id: true },
  });
  const roleIds = roles.map((r) => r.id);
  if (roleIds.length) {
    await prisma.sysUserRole.deleteMany({ where: { role_id: { in: roleIds } } });
    await prisma.sysRolePermission.deleteMany({ where: { role_id: { in: roleIds } } });
    await prisma.auditLog.deleteMany({
      where: { entity_key: "sys_role", row_id: { in: roleIds } },
    });
    await prisma.sysRole.deleteMany({ where: { id: { in: roleIds } } });
  }
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

export { prisma };

// --------------------------------------------------------- business fixtures
//
// The seed carries system data only — no partners, no accounts, no budgets — so
// a test that needs business data creates it. Fixtures are labelled with
// `FIXTURE_PREFIX` and removed by `cleanupFixtures`, which is what keeps a run
// from leaving anything behind in a database somebody is actually using.

export const FIXTURE_PREFIX = "ZZTEST";

let fixtureSeq = 0;
const nextFixture = () => `${FIXTURE_PREFIX}${Date.now() % 1_000_000}${++fixtureSeq}`;

/** The account seeded rows are attributed to; fixtures borrow it. */
export async function systemUserId(): Promise<number> {
  const row = await prisma.sysUser.findFirstOrThrow({
    where: { email: "sistem@siba.app" },
    select: { id: true },
  });
  return row.id;
}

export async function parentCompanyId(): Promise<number> {
  const row = await prisma.sysCompany.findFirstOrThrow({
    where: { is_parent: true },
    select: { id: true },
  });
  return row.id;
}

export async function childCompanyId(): Promise<number> {
  const row = await prisma.sysCompany.findFirstOrThrow({
    where: { is_parent: false },
    select: { id: true },
  });
  return row.id;
}

export async function budgetCategoryId(label: string): Promise<number> {
  const row = await prisma.sysBudgetCategory.findFirstOrThrow({
    where: { category_label: label },
    select: { id: true },
  });
  return row.id;
}

export async function partnerCategoryId(label: string): Promise<number> {
  const row = await prisma.sysPartnerCategory.findFirstOrThrow({
    where: { category_label: label },
    select: { id: true },
  });
  return row.id;
}

export async function subcategoryId(label: string): Promise<number> {
  const row = await prisma.accAccountSubcategory.findFirstOrThrow({
    where: { subcategory_label: label },
    select: { id: true },
  });
  return row.id;
}

/**
 * The next unused number under `parentLabel` in this Company.
 *
 * A fixture cannot simply take segment 1: the database it runs against belongs
 * to whoever uses the application, and a real user's own `1.1.1.1` would
 * collide with it. Probing exact labels rather than a prefix is deliberate —
 * `1.1.1.1.1` starts with `1.1.1.` but is a grandchild, not a sibling.
 */
async function freeSegment(companyId: number, parentLabel: string): Promise<string> {
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

export async function makeAccount(options: {
  companyId: number;
  subcategoryLabel: string;
  postable?: boolean;
  active?: boolean;
  parentId?: number | null;
  normalBalance?: "Debit" | "Kredit";
}): Promise<number> {
  const key = nextFixture();
  // A fixture account carries a real lineage code: it continues its parent
  // account's number when it has one and its kelompok's otherwise, exactly as
  // `createRecord` composes it.
  const parentLabel = options.parentId
    ? (
        await prisma.accAccount.findUniqueOrThrow({
          where: { id: options.parentId },
          select: { account_label: true },
        })
      ).account_label
    : options.subcategoryLabel;

  const row = await prisma.accAccount.create({
    data: {
      account_code: `${FIXTURE_PREFIX}.${key}`,
      account_label: await freeSegment(options.companyId, parentLabel),
      account_name: `Fixture ${key}`,
      company_id: options.companyId,
      account_subcategory_id: await subcategoryId(options.subcategoryLabel),
      parent_account: options.parentId ?? null,
      is_postable: options.postable ?? true,
      is_active: options.active ?? true,
      normal_balance: options.normalBalance ?? "Debit",
      created_by: await systemUserId(),
    },
    select: { id: true },
  });
  return row.id;
}

export async function makePartner(options: {
  companyId: number;
  categoryLabel: string;
  status?: "Active" | "Inactive";
}): Promise<number> {
  const key = nextFixture();
  const row = await prisma.mPartner.create({
    data: {
      partner_code: `test.${key}`,
      partner_label: key,
      partner_name: `Fixture ${key}`,
      company_id: options.companyId,
      category_id: await partnerCategoryId(options.categoryLabel),
      status: options.status ?? "Active",
      created_by: await systemUserId(),
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Removes every business fixture, children before parents so the self
 * -referencing account tree never blocks a delete.
 */
export async function cleanupFixtures(): Promise<void> {
  const accounts = await prisma.accAccount.findMany({
    // Keyed on the system code, not the label: an account's label is now a
    // lineage code with no room for a fixture marker in it.
    where: { account_code: { startsWith: FIXTURE_PREFIX } },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  for (const a of accounts) {
    await prisma.accAccount.delete({ where: { id: a.id } });
  }
  await prisma.mPartner.deleteMany({
    where: { partner_label: { startsWith: FIXTURE_PREFIX } },
  });
}
