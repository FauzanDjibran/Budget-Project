import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { actorCan } from "../src/lib/siba/access";
import { isAccessDenied } from "../src/lib/siba/auth-errors";
import { abilitiesFor, entityPermissions } from "../src/lib/siba/entity-access";
import {
  PERMISSIONS,
  PERMISSION_CODES,
  permissionsByModule,
} from "../src/lib/siba/permissions";
import { adminPermissionCodes, SEEDED_ROLES } from "../src/lib/siba/roles";
import {
  createUser,
  listUsers,
  setRolePermissions,
  setUserRoles,
  setUserStatus,
  updateUser,
} from "../src/lib/siba/user-admin";
import { actorOf, cleanup, disconnect, makeUser, prisma, roleIdFor } from "./helpers";

/**
 * Authorization: what you are allowed to do.
 *
 * These call the service layer directly — the same functions the Server Actions
 * delegate to — so a refusal here is the refusal a hand-crafted request gets.
 * Covers checklist items 4-15 and 17.
 */

/** Asserts that a call was refused for lack of permission, not for any other reason. */
async function assertDenied(fn: () => Promise<unknown>, what: string) {
  await assert.rejects(
    fn,
    (error: unknown) => {
      assert.ok(isAccessDenied(error), `${what}: expected an access denial`);
      assert.equal(
        isAccessDenied(error) ? error.kind : "",
        "UNAUTHORIZED",
        `${what}: expected UNAUTHORIZED`
      );
      return true;
    },
    what
  );
}

describe("the permission catalogue", () => {
  test("codes are unique", () => {
    assert.equal(new Set(PERMISSION_CODES).size, PERMISSION_CODES.length);
  });

  test("every permission belongs to exactly one module group", () => {
    const grouped = permissionsByModule();
    const total = Object.values(grouped).reduce((n, list) => n + list.length, 0);
    assert.equal(total, PERMISSIONS.length);
  });

  test("create, edit, approve, reject and post are separate permissions", () => {
    for (const code of [
      "BUDGET_CREATE",
      "BUDGET_EDIT",
      "BUDGET_APPROVE",
      "BUDGET_REJECT",
      "CASH_BANK_TRANSACTION_POST",
    ]) {
      assert.ok(PERMISSION_CODES.includes(code as never), `${code} must exist`);
    }
    // Menu access is separate from every action inside the module.
    assert.ok(PERMISSION_CODES.includes("MENU_BUDGET_ACCESS" as never));
  });

  test("the catalogue in code matches the catalogue in the database", async () => {
    const rows = await prisma.sysPermission.findMany({ select: { permission_code: true } });
    const inDb = new Set(rows.map((r) => r.permission_code));
    for (const code of PERMISSION_CODES) {
      assert.ok(inDb.has(code), `${code} is missing from the database — reseed`);
    }
  });
});

describe("seeded roles", () => {
  before(cleanup);

  test("ADMIN holds every permission in the catalogue", async () => {
    const roleId = await roleIdFor("ADMIN");
    const rows = await prisma.sysRolePermission.findMany({
      where: { role_id: roleId },
      select: { permission: { select: { permission_code: true } } },
    });
    const held = new Set(rows.map((r) => r.permission.permission_code));
    for (const code of adminPermissionCodes()) {
      assert.ok(held.has(code), `ADMIN is missing ${code}`);
    }
  });

  test("STAFF is seeded with no permissions at all", async () => {
    // There are no default permissions in this system. A role's name grants
    // nothing — STAFF is an empty container until an administrator fills it.
    const declared = SEEDED_ROLES.find((r) => r.label === "STAFF")!;
    assert.deepEqual(declared.permissions, [], "STAFF must declare no grants");

    const count = await prisma.sysRolePermission.count({
      where: { role_id: await roleIdFor("STAFF") },
    });
    assert.equal(count, 0, "STAFF must hold no permission rows after seeding");
  });

  test("ADMIN is the only seeded role carrying any permission", async () => {
    const rows = await prisma.sysRole.findMany({
      where: { is_system: true },
      select: {
        role_label: true,
        _count: { select: { permissions: true } },
      },
    });

    for (const role of rows) {
      if (role.role_label === "ADMIN") {
        assert.equal(role._count.permissions, PERMISSION_CODES.length);
      } else {
        assert.equal(
          role._count.permissions,
          0,
          `${role.role_label} must start empty — no role but ADMIN gets default grants`
        );
      }
    }
  });
});

describe("staff restrictions", () => {
  before(cleanup);
  after(cleanup);

  test("staff cannot read the user register", async () => {
    const staff = await makeUser({ roleLabels: ["STAFF"] });
    const actor = await actorOf(staff.id);

    assert.equal(actorCan(actor, "USER_VIEW"), false);
    await assertDenied(() => listUsers(actor), "listUsers as staff");
  });

  test("staff cannot create a user", async () => {
    const staff = await makeUser({ roleLabels: ["STAFF"] });
    const actor = await actorOf(staff.id);

    await assertDenied(
      () =>
        createUser(actor, {
          email: "authtest+sneaky@siba.test",
          name: "Sneaky",
          initials: "SN",
          password: "password-12345",
        }),
      "createUser as staff"
    );

    assert.equal(
      await prisma.sysUser.count({ where: { email: "authtest+sneaky@siba.test" } }),
      0,
      "nothing may be written when the call is refused"
    );
  });

  test("staff cannot edit another user", async () => {
    const staff = await makeUser({ roleLabels: ["STAFF"] });
    const victim = await makeUser({ roleLabels: ["STAFF"] });
    const actor = await actorOf(staff.id);

    await assertDenied(
      () =>
        updateUser(actor, victim.id, {
          email: "authtest+hijacked@siba.test",
          name: "Hijacked",
          initials: "HJ",
        }),
      "updateUser as staff"
    );
  });

  test("staff cannot change anyone's roles, including their own", async () => {
    const staff = await makeUser({ roleLabels: ["STAFF"] });
    const victim = await makeUser({ roleLabels: ["STAFF"] });
    const actor = await actorOf(staff.id);
    const adminRole = await roleIdFor("ADMIN");

    await assertDenied(
      () => setUserRoles(actor, victim.id, [adminRole]),
      "setUserRoles on another user"
    );
    await assertDenied(
      () => setUserRoles(actor, staff.id, [adminRole]),
      "setUserRoles on self — the escalation attempt"
    );

    const after = await prisma.sysUserRole.findMany({ where: { user_id: staff.id } });
    assert.ok(
      !after.some((r) => r.role_id === adminRole),
      "a refused escalation must leave no trace"
    );
  });

  test("staff cannot edit a role's permission matrix", async () => {
    const staff = await makeUser({ roleLabels: ["STAFF"] });
    const actor = await actorOf(staff.id);
    const staffRole = await roleIdFor("STAFF");

    await assertDenied(
      () => setRolePermissions(actor, staffRole, [...PERMISSION_CODES]),
      "setRolePermissions as staff — escalation by widening their own role"
    );
  });

  test("staff cannot deactivate another user", async () => {
    const staff = await makeUser({ roleLabels: ["STAFF"] });
    const victim = await makeUser({ roleLabels: ["STAFF"] });
    const actor = await actorOf(staff.id);

    await assertDenied(
      () => setUserStatus(actor, victim.id, "Inactive"),
      "setUserStatus as staff"
    );
  });
});

describe("per-operation permissions on master data", () => {
  before(cleanup);
  after(async () => {
    await cleanup();
    await disconnect();
  });

  test("a view permission does not grant create, edit or status changes", async () => {
    const viewer = await makeUser({ permissions: ["PARTNER_VIEW"] });
    const actor = await actorOf(viewer.id);

    const can = abilitiesFor("m_partner", actor.permissions);
    assert.deepEqual(can, {
      create: false,
      edit: false,
      activate: false,
      deactivate: false,
    });
    assert.ok(actorCan(actor, "PARTNER_VIEW"));
  });

  test("create does not imply edit, and edit does not imply create", async () => {
    const creator = await makeUser({ permissions: ["PARTNER_VIEW", "PARTNER_CREATE"] });
    const editor = await makeUser({ permissions: ["PARTNER_VIEW", "PARTNER_EDIT"] });

    const canCreate = abilitiesFor("m_partner", (await actorOf(creator.id)).permissions);
    assert.equal(canCreate.create, true);
    assert.equal(canCreate.edit, false);

    const canEdit = abilitiesFor("m_partner", (await actorOf(editor.id)).permissions);
    assert.equal(canEdit.edit, true);
    assert.equal(canEdit.create, false);
  });

  test("activate and deactivate are distinct", async () => {
    const user = await makeUser({ permissions: ["CURRENCY_VIEW", "CURRENCY_DEACTIVATE"] });
    const can = abilitiesFor("ref_currency", (await actorOf(user.id)).permissions);

    assert.equal(can.deactivate, true);
    assert.equal(can.activate, false);
  });

  test("Company declares no create or edit permission — it is locked for everyone", () => {
    const perms = entityPermissions("sys_company");
    assert.equal(perms.create, undefined);
    assert.equal(perms.edit, undefined);
    assert.equal(perms.view, "COMPANY_VIEW");
  });

  test("an entity with no declared permissions fails loudly rather than opening up", () => {
    assert.throws(() => entityPermissions("bud_budget"));
  });
});
