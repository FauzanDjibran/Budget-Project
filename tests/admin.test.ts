import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { authenticate } from "../src/lib/siba/login";
import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import { issueSession, validateSessionToken } from "../src/lib/siba/session";
import {
  createRole,
  createUser,
  listUsers,
  resetUserPassword,
  setRolePermissions,
  setRoleStatus,
  setUserRoles,
  setUserStatus,
  updateUser,
} from "../src/lib/siba/user-admin";
import { changeOwnPassword, profileFor, updateOwnProfile } from "../src/lib/siba/profile";
import { actorOf, cleanup, disconnect, makeUser, prisma, roleIdFor } from "./helpers";

/**
 * What an administrator can do, and the three protections that stop the
 * capability turning into an escalation route.
 */
describe("administrator capabilities", () => {
  before(cleanup);

  test("an admin can create, edit, assign roles to and deactivate a user", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const actor = await actorOf(admin.id);
    const staffRole = await roleIdFor("STAFF");

    const created = await createUser(actor, {
      email: "authtest+managed@siba.test",
      name: "Managed User",
      initials: "MU",
      password: "password-12345",
      roleIds: [staffRole],
    });
    assert.equal(created.ok, true);
    const id = created.ok ? created.id : 0;

    const edited = await updateUser(actor, id, {
      email: "authtest+managed2@siba.test",
      name: "Managed User Renamed",
      initials: "MR",
    });
    assert.equal(edited.ok, true);

    const assigned = await setUserRoles(actor, id, []);
    assert.equal(assigned.ok, true);
    assert.equal(await prisma.sysUserRole.count({ where: { user_id: id } }), 0);

    const deactivated = await setUserStatus(actor, id, "Inactive");
    assert.equal(deactivated.ok, true);

    const row = await prisma.sysUser.findUniqueOrThrow({ where: { id } });
    assert.equal(row.status, "Inactive");
    assert.equal(row.name, "Managed User Renamed");
  });

  test("creating a user with roles requires the role-granting permission too", async () => {
    // USER_CREATE alone must not become an escalation route via a second account.
    const partial = await makeUser({ permissions: ["USER_VIEW", "USER_CREATE"] });
    const actor = await actorOf(partial.id);
    const adminRole = await roleIdFor("ADMIN");

    await assert.rejects(
      () =>
        createUser(actor, {
          email: "authtest+backdoor@siba.test",
          name: "Backdoor",
          initials: "BD",
          password: "password-12345",
          roleIds: [adminRole],
        }),
      "creating an admin without USER_ROLE_ASSIGN must be refused"
    );

    assert.equal(
      await prisma.sysUser.count({ where: { email: "authtest+backdoor@siba.test" } }),
      0
    );

    // The same caller may still create a user with no access at all.
    const plain = await createUser(actor, {
      email: "authtest+plain@siba.test",
      name: "Plain",
      initials: "PL",
      password: "password-12345",
    });
    assert.equal(plain.ok, true);
  });

  test("deactivating a user ends their live sessions at once", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const victim = await makeUser({ roleLabels: ["STAFF"] });
    const { token } = await issueSession(victim.id);
    assert.ok(await validateSessionToken(token));

    const result = await setUserStatus(await actorOf(admin.id), victim.id, "Inactive");
    assert.equal(result.ok, true);
    assert.equal(await validateSessionToken(token), null);
  });

  test("a password reset ends the target's sessions and changes their password", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const victim = await makeUser({ roleLabels: ["STAFF"] });
    const { token } = await issueSession(victim.id);

    const result = await resetUserPassword(
      await actorOf(admin.id),
      victim.id,
      "a-brand-new-password"
    );
    assert.equal(result.ok, true);
    assert.equal(await validateSessionToken(token), null);

    assert.equal((await authenticate(victim.email, victim.password)).ok, false);
    assert.equal((await authenticate(victim.email, "a-brand-new-password")).ok, true);
  });

  test("a short reset password is refused", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const victim = await makeUser({});

    const result = await resetUserPassword(await actorOf(admin.id), victim.id, "abc");
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors.password);
  });

  test("duplicate emails are refused, case-insensitively", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const actor = await actorOf(admin.id);
    const existing = await makeUser({});

    const result = await createUser(actor, {
      email: existing.email.toUpperCase(),
      name: "Clash",
      initials: "CL",
      password: "password-12345",
    });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors.email);
  });

  test("an admin can create a role and set its permissions", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const actor = await actorOf(admin.id);

    const created = await createRole(actor, {
      role_label: `TEST_ROLE_APPROVER_${Date.now()}`,
      role_name: "Penyetuju",
      note: "Hanya menyetujui Budget.",
    });
    assert.equal(created.ok, true);
    const id = created.ok ? created.id : 0;

    const result = await setRolePermissions(actor, id, [
      "MENU_BUDGET_ACCESS",
      "BUDGET_VIEW",
      "BUDGET_APPROVE",
    ]);
    assert.equal(result.ok, true);

    const codes = await prisma.sysRolePermission.findMany({
      where: { role_id: id },
      select: { permission: { select: { permission_code: true } } },
    });
    assert.deepEqual(
      codes.map((c) => c.permission.permission_code).sort(),
      ["BUDGET_APPROVE", "BUDGET_VIEW", "MENU_BUDGET_ACCESS"]
    );
  });

  test("an unknown permission code is refused outright", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const actor = await actorOf(admin.id);
    const created = await createRole(actor, {
      role_label: `TEST_ROLE_BAD_${Date.now()}`,
      role_name: "Bad",
    });
    const id = created.ok ? created.id : 0;

    const result = await setRolePermissions(actor, id, ["BUDGET_VIEW", "NOT_A_PERMISSION"]);
    assert.equal(result.ok, false);
    assert.equal(
      await prisma.sysRolePermission.count({ where: { role_id: id } }),
      0,
      "a tampered payload must apply none of it, not the valid subset"
    );
  });

  test("every write is audited", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const actor = await actorOf(admin.id);

    const created = await createUser(actor, {
      email: "authtest+audited@siba.test",
      name: "Audited",
      initials: "AU",
      password: "password-12345",
    });
    const id = created.ok ? created.id : 0;

    const entries = await prisma.auditLog.findMany({
      where: { entity_key: "sys_user", row_id: id },
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, "TAMBAH");
    assert.equal(entries[0].by, admin.id);
  });
});

describe("protections against privilege abuse", () => {
  before(cleanup);

  test("an admin cannot change their own roles", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const other = await makeUser({ roleLabels: ["ADMIN"] });
    const actor = await actorOf(admin.id);
    const staffRole = await roleIdFor("STAFF");

    const result = await setUserRoles(actor, admin.id, [staffRole]);
    assert.equal(result.ok, false, "self role changes are refused for everyone");

    // ...but they may still change someone else's.
    assert.equal((await setUserRoles(actor, other.id, [staffRole])).ok, true);
  });

  test("an admin cannot deactivate their own account", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const result = await setUserStatus(await actorOf(admin.id), admin.id, "Inactive");

    assert.equal(result.ok, false);
    const row = await prisma.sysUser.findUniqueOrThrow({ where: { id: admin.id } });
    assert.equal(row.status, "Active");
  });

  test("an admin cannot reset their own password from user administration", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const result = await resetUserPassword(
      await actorOf(admin.id),
      admin.id,
      "another-password"
    );
    assert.equal(result.ok, false, "own password goes through the profile instead");
  });

  test("the ADMIN role's permission matrix is frozen", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const adminRole = await roleIdFor("ADMIN");

    const result = await setRolePermissions(await actorOf(admin.id), adminRole, [
      "BUDGET_VIEW",
    ]);
    assert.equal(result.ok, false);

    const remaining = await prisma.sysRolePermission.count({ where: { role_id: adminRole } });
    assert.equal(remaining, PERMISSION_CODES.length, "ADMIN must keep the whole catalogue");
  });

  test("system roles cannot be deactivated", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const actor = await actorOf(admin.id);

    for (const label of ["ADMIN", "STAFF"]) {
      const result = await setRoleStatus(actor, await roleIdFor(label), "Inactive");
      assert.equal(result.ok, false, `${label} must stay active`);
    }
  });

  test("nobody can edit the permissions of a role they hold themselves", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const actor = await actorOf(admin.id);

    const created = await createRole(actor, {
      role_label: `TEST_ROLE_MINE_${Date.now()}`,
      role_name: "Mine",
    });
    const roleId = created.ok ? created.id : 0;

    // Give the administrator the new role, then re-resolve their access.
    await prisma.sysUserRole.create({ data: { user_id: admin.id, role_id: roleId } });
    const holder = await actorOf(admin.id);

    const result = await setRolePermissions(holder, roleId, [...PERMISSION_CODES]);
    assert.equal(result.ok, false, "widening a role you hold is self-escalation");
  });

  test("the application can never be left without an active administrator", async () => {
    // Park every other administrator so exactly one is left, then try both ways
    // of removing the last one.
    const adminRoleId = await roleIdFor("ADMIN");
    const existing = await prisma.sysUserRole.findMany({
      where: { role_id: adminRoleId, user: { status: "Active" } },
      select: { user_id: true },
    });
    const parked = existing.map((a) => a.user_id);

    const survivor = await makeUser({ roleLabels: ["ADMIN"] });
    // A second administrator does the asking, so the refusal is the
    // last-administrator guard rather than the self-edit guard.
    const operator = await makeUser({ roleLabels: ["ADMIN"] });

    await prisma.sysUser.updateMany({
      where: { id: { in: parked } },
      data: { status: "Inactive" },
    });

    try {
      // With two administrators left, demoting one is fine.
      assert.equal((await setUserRoles(await actorOf(operator.id), survivor.id, [])).ok, true);

      // The operator is now the only one. A third party cannot demote them...
      const helper = await makeUser({ permissions: ["USER_VIEW", "USER_ROLE_ASSIGN"] });
      const demote = await setUserRoles(await actorOf(helper.id), operator.id, []);
      assert.equal(demote.ok, false, "the last administrator must keep their role");
      assert.equal(
        await prisma.sysUserRole.count({
          where: { user_id: operator.id, role_id: adminRoleId },
        }),
        1,
        "a refused demotion must change nothing"
      );

      // ...nor deactivate them.
      const deactivator = await makeUser({
        permissions: ["USER_VIEW", "USER_DEACTIVATE"],
      });
      const off = await setUserStatus(await actorOf(deactivator.id), operator.id, "Inactive");
      assert.equal(off.ok, false, "the last administrator must stay active");

      const row = await prisma.sysUser.findUniqueOrThrow({ where: { id: operator.id } });
      assert.equal(row.status, "Active");
    } finally {
      await prisma.sysUser.updateMany({
        where: { id: { in: parked } },
        data: { status: "Active" },
      });
    }
  });

  test("emptying a role cannot remove the last administrator either", async () => {
    const adminRoleId = await roleIdFor("ADMIN");
    const existing = await prisma.sysUserRole.findMany({
      where: { role_id: adminRoleId, user: { status: "Active" } },
      select: { user_id: true },
    });
    const parked = existing.map((a) => a.user_id);

    // A custom role that is the only thing granting administration.
    const operator = await makeUser({ roleLabels: ["ADMIN"] });
    const custom = await createRole(await actorOf(operator.id), {
      role_label: `TEST_ROLE_ONLYADMIN_${Date.now()}`,
      role_name: "Only admin",
    });
    const customId = custom.ok ? custom.id : 0;
    await setRolePermissions(await actorOf(operator.id), customId, [...PERMISSION_CODES]);

    const soleAdmin = await makeUser({});
    await prisma.sysUserRole.create({
      data: { user_id: soleAdmin.id, role_id: customId },
    });

    await prisma.sysUser.updateMany({
      where: { id: { in: [...parked, operator.id] } },
      data: { status: "Inactive" },
    });

    try {
      // Someone else holds the permission to edit roles but must not be able to
      // empty the one role keeping the system administrable.
      const editor = await makeUser({ permissions: ["ROLE_VIEW", "ROLE_PERMISSION_MANAGE"] });
      const result = await setRolePermissions(await actorOf(editor.id), customId, []);

      assert.equal(result.ok, false, "emptying the only administration role is refused");
      assert.equal(
        await prisma.sysRolePermission.count({ where: { role_id: customId } }),
        PERMISSION_CODES.length,
        "a refused change must leave the matrix untouched"
      );
    } finally {
      await prisma.sysUser.updateMany({
        where: { id: { in: parked } },
        data: { status: "Active" },
      });
    }
  });
});

describe("the profile", () => {
  before(cleanup);
  after(async () => {
    await cleanup();
    await disconnect();
  });

  test("any signed-in user can read their own profile, whatever they hold", async () => {
    const nobody = await makeUser({});
    const profile = await profileFor(await actorOf(nobody.id));

    assert.equal(profile.id, nobody.id);
    assert.equal(profile.permissions.length, 0);
    assert.equal(profile.roles.length, 0);
  });

  test("a profile never exposes the password hash", async () => {
    const staff = await makeUser({ roleLabels: ["STAFF"] });
    const profile = await profileFor(await actorOf(staff.id));

    assert.ok(!Object.keys(profile).includes("password_hash"));
    assert.ok(!JSON.stringify(profile).includes("$2b$"));
  });

  test("the user register never exposes password hashes", async () => {
    const admin = await makeUser({ roleLabels: ["ADMIN"] });
    const rows = await listUsers(await actorOf(admin.id));

    assert.ok(rows.length > 0);
    assert.ok(!JSON.stringify(rows).includes("$2b$"));
    for (const row of rows) {
      assert.ok(!Object.keys(row).includes("password_hash"));
    }
  });

  test("a user can change their own name and initials", async () => {
    const staff = await makeUser({ roleLabels: ["STAFF"] });
    const result = await updateOwnProfile(await actorOf(staff.id), {
      name: "Renamed",
      initials: "rn",
    });

    assert.equal(result.ok, true);
    const row = await prisma.sysUser.findUniqueOrThrow({ where: { id: staff.id } });
    assert.equal(row.name, "Renamed");
    assert.equal(row.initials, "RN");
  });

  test("changing a password requires the current one", async () => {
    const staff = await makeUser({ roleLabels: ["STAFF"] });
    const actor = await actorOf(staff.id);

    const wrong = await changeOwnPassword(actor, {
      current: "not-the-password",
      next: "a-new-password-1",
      confirm: "a-new-password-1",
    });
    assert.equal(wrong.ok, false);
    assert.equal((await authenticate(staff.email, staff.password)).ok, true);

    const right = await changeOwnPassword(actor, {
      current: staff.password,
      next: "a-new-password-1",
      confirm: "a-new-password-1",
    });
    assert.equal(right.ok, true);
    assert.equal((await authenticate(staff.email, "a-new-password-1")).ok, true);
  });

  test("a password change ends every existing session", async () => {
    const staff = await makeUser({ roleLabels: ["STAFF"] });
    const { token } = await issueSession(staff.id);

    const result = await changeOwnPassword(await actorOf(staff.id), {
      current: staff.password,
      next: "yet-another-password",
      confirm: "yet-another-password",
    });

    assert.equal(result.ok, true);
    assert.equal(await validateSessionToken(token), null);
  });

  test("a mismatched confirmation is refused", async () => {
    const staff = await makeUser({});
    const result = await changeOwnPassword(await actorOf(staff.id), {
      current: staff.password,
      next: "a-new-password-1",
      confirm: "a-different-one",
    });

    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.errors.confirm);
  });
});
