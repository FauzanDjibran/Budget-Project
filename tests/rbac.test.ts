import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { actorCan, permissionsForUser, rolesForUser } from "../src/lib/siba/access";
import { isAccessDenied } from "../src/lib/siba/auth-errors";
import { authenticate } from "../src/lib/siba/login";
import { validateSessionToken } from "../src/lib/siba/session";
import { listUsers, createUser, setUserStatus } from "../src/lib/siba/user-admin";
import { profileFor } from "../src/lib/siba/profile";
import { actorOf, cleanup, disconnect, makeUser, prisma } from "./helpers";

/**
 * The RBAC contract, one test per rule.
 *
 * Everything here goes through the service layer — the same functions the
 * Server Actions delegate to — so a refusal below is the refusal a hand-crafted
 * request receives. Nothing is stubbed and nothing is asserted about the UI.
 *
 *   User -> Role -> Permission
 *
 * A user holds zero or more roles; a role holds zero or more permissions; a
 * user's effective permissions are exactly the union of their active roles'.
 * There are no defaults anywhere.
 */

/** A role carrying exactly the given codes, created for one test. */
let seq = 0;
async function roleWith(codes: string[]): Promise<number> {
  seq += 1;
  const role = await prisma.sysRole.create({
    data: {
      role_code: `test.${Date.now() % 100000}${seq}`,
      role_label: `TEST_ROLE_RBAC_${Date.now()}_${seq}`,
      role_name: "RBAC fixture",
    },
  });
  if (codes.length) {
    const perms = await prisma.sysPermission.findMany({
      where: { permission_code: { in: codes } },
      select: { id: true },
    });
    assert.equal(perms.length, codes.length, "fixture asked for unknown permissions");
    await prisma.sysRolePermission.createMany({
      data: perms.map((p) => ({ role_id: role.id, permission_id: p.id })),
    });
  }
  return role.id;
}

async function grant(userId: number, roleId: number) {
  await prisma.sysUserRole.create({ data: { user_id: userId, role_id: roleId } });
}

describe("RBAC: User -> Role -> Permission", () => {
  before(cleanup);
  after(async () => {
    await cleanup();
    await disconnect();
  });

  // ---------------------------------------------------------------- 1
  test("unauthenticated -> denied", async () => {
    // No token, a junk token and an empty token all resolve to no session, so
    // there is no actor for any guard to let through.
    assert.equal(await validateSessionToken(undefined), null);
    assert.equal(await validateSessionToken(""), null);
    assert.equal(await validateSessionToken("forged-token-value"), null);

    // And a revoked one stops working immediately.
    const user = await makeUser({});
    const login = await authenticate(user.email, user.password);
    assert.equal(login.ok, true);
    const token = login.ok ? login.token : "";
    assert.ok(await validateSessionToken(token));

    await prisma.sysSession.updateMany({
      where: { user_id: user.id },
      data: { revoked_at: new Date() },
    });
    assert.equal(await validateSessionToken(token), null);
  });

  // ---------------------------------------------------------------- 2
  test("authenticated with no role -> signed in, but denied everything", async () => {
    const user = await makeUser({});

    // Logging in works. Having no access is not a reason to refuse a session.
    const login = await authenticate(user.email, user.password);
    assert.equal(login.ok, true);
    const session = await validateSessionToken(login.ok ? login.token : "");
    assert.equal(session?.user.id, user.id);

    const actor = await actorOf(user.id);
    assert.deepEqual(actor.roles, [], "no roles");
    assert.equal(actor.permissions.size, 0, "and therefore no permissions");

    // Every protected capability is refused.
    await assert.rejects(() => listUsers(actor), isAccessDenied);
    await assert.rejects(
      () =>
        createUser(actor, {
          email: "authtest+norole@siba.test",
          name: "No Role",
          initials: "NR",
          password: "password-12345",
        }),
      isAccessDenied
    );

    // Their own profile still works — it needs authentication, not permission.
    const profile = await profileFor(actor);
    assert.equal(profile.id, user.id);
    assert.equal(profile.permissions.length, 0);
  });

  // ---------------------------------------------------------------- 3
  test("authenticated with a role that lacks the permission -> denied", async () => {
    // A role that grants something real, just not what is being attempted.
    const user = await makeUser({});
    await grant(user.id, await roleWith(["MENU_MASTER_ACCESS", "PARTNER_VIEW"]));
    const actor = await actorOf(user.id);

    assert.ok(actorCan(actor, "PARTNER_VIEW"), "the role does grant something");
    assert.equal(actorCan(actor, "USER_VIEW"), false);

    await assert.rejects(() => listUsers(actor), isAccessDenied);
    await assert.rejects(
      () => setUserStatus(actor, user.id, "Inactive"),
      isAccessDenied
    );
  });

  // ---------------------------------------------------------------- 4
  test("authenticated with the required permission -> allowed", async () => {
    const user = await makeUser({});
    await grant(user.id, await roleWith(["MENU_USER_ACCESS", "USER_VIEW"]));
    const actor = await actorOf(user.id);

    const rows = await listUsers(actor);
    assert.ok(rows.length > 0, "USER_VIEW is enough to read the register");

    // ...and still refused for a capability the role does not carry.
    await assert.rejects(
      () =>
        createUser(actor, {
          email: "authtest+notallowed@siba.test",
          name: "Nope",
          initials: "NO",
          password: "password-12345",
        }),
      isAccessDenied,
      "USER_VIEW must not imply USER_CREATE"
    );
  });

  // ---------------------------------------------------------------- 5
  test("multiple roles -> permissions combine", async () => {
    const user = await makeUser({});
    const viewer = await roleWith(["MENU_USER_ACCESS", "USER_VIEW"]);
    const creator = await roleWith(["USER_CREATE"]);

    await grant(user.id, viewer);
    const one = await actorOf(user.id);
    assert.ok(actorCan(one, "USER_VIEW"));
    assert.equal(actorCan(one, "USER_CREATE"), false);

    await grant(user.id, creator);
    const both = await actorOf(user.id);
    assert.equal(both.roles.length, 2);
    assert.ok(actorCan(both, "USER_VIEW"), "kept from the first role");
    assert.ok(actorCan(both, "USER_CREATE"), "gained from the second");

    // The union is exactly the two sets, with nothing invented.
    assert.deepEqual(
      [...both.permissions].sort(),
      ["MENU_USER_ACCESS", "USER_CREATE", "USER_VIEW"]
    );

    // And the combination is live: both capabilities now work.
    const created = await createUser(both, {
      email: "authtest+combined@siba.test",
      name: "Combined",
      initials: "CB",
      password: "password-12345",
    });
    assert.equal(created.ok, true);

    // Deactivating one role withdraws only its half, without touching the
    // assignment — the user still holds two roles.
    await prisma.sysRole.update({ where: { id: creator }, data: { status: "Inactive" } });
    const after = await actorOf(user.id);
    assert.ok(actorCan(after, "USER_VIEW"));
    assert.equal(actorCan(after, "USER_CREATE"), false);
    assert.equal(await prisma.sysUserRole.count({ where: { user_id: user.id } }), 2);
  });

  // ---------------------------------------------------------------- 6
  test("a menu permission is not an action permission", async () => {
    // Menu access only: the user may see the area and do nothing in it.
    const user = await makeUser({});
    await grant(user.id, await roleWith(["MENU_USER_ACCESS"]));
    const actor = await actorOf(user.id);

    assert.ok(actorCan(actor, "MENU_USER_ACCESS"));
    for (const code of [
      "USER_VIEW",
      "USER_CREATE",
      "USER_EDIT",
      "USER_ACTIVATE",
      "USER_DEACTIVATE",
      "USER_ROLE_ASSIGN",
    ]) {
      assert.equal(actorCan(actor, code), false, `MENU_USER_ACCESS must not imply ${code}`);
    }

    // Reaching the menu is not permission to read what is behind it.
    await assert.rejects(() => listUsers(actor), isAccessDenied);
  });

  test("the same holds for approve, reject and post", async () => {
    const user = await makeUser({});
    await grant(
      user.id,
      await roleWith(["MENU_BUDGET_ACCESS", "BUDGET_VIEW", "MENU_FINANCE_ACCESS"])
    );
    const actor = await actorOf(user.id);

    assert.ok(actorCan(actor, "BUDGET_VIEW"));
    for (const code of [
      "BUDGET_CREATE",
      "BUDGET_EDIT",
      "BUDGET_APPROVE",
      "BUDGET_REJECT",
      "CASH_BANK_TRANSACTION_POST",
    ]) {
      assert.equal(actorCan(actor, code), false, `must not be implied: ${code}`);
    }
  });

  // ---------------------------------------------------------------- 7
  test("a direct service call without the permission is refused", async () => {
    // This is the bypass case: no UI involved, the service invoked straight with
    // a real signed-in actor who simply lacks the permission.
    const user = await makeUser({});
    await grant(user.id, await roleWith(["MENU_MASTER_ACCESS"]));
    const actor = await actorOf(user.id);

    const victim = await makeUser({});
    const before = await prisma.sysUser.findUniqueOrThrow({ where: { id: victim.id } });

    for (const call of [
      () => listUsers(actor),
      () => setUserStatus(actor, victim.id, "Inactive"),
      () =>
        createUser(actor, {
          email: "authtest+direct@siba.test",
          name: "Direct",
          initials: "DR",
          password: "password-12345",
        }),
    ]) {
      await assert.rejects(call, (error: unknown) => {
        assert.ok(isAccessDenied(error));
        assert.equal(isAccessDenied(error) ? error.kind : "", "UNAUTHORIZED");
        return true;
      });
    }

    // Nothing was written by any of the refused calls.
    const after = await prisma.sysUser.findUniqueOrThrow({ where: { id: victim.id } });
    assert.equal(after.status, before.status);
    assert.equal(
      await prisma.sysUser.count({ where: { email: "authtest+direct@siba.test" } }),
      0
    );
  });

  // ---------------------------------------------------------------- model
  test("effective permissions are exactly the union of active roles", async () => {
    const user = await makeUser({});
    const a = await roleWith(["PARTNER_VIEW", "PARTNER_CREATE"]);
    const b = await roleWith(["PARTNER_VIEW", "CURRENCY_VIEW"]);
    await grant(user.id, a);
    await grant(user.id, b);

    const codes = await permissionsForUser(user.id);
    assert.deepEqual(
      [...codes].sort(),
      ["CURRENCY_VIEW", "PARTNER_CREATE", "PARTNER_VIEW"],
      "overlap is a union, not a duplicate, and nothing else appears"
    );

    const roles = await rolesForUser(user.id);
    assert.equal(roles.length, 2);
  });

  test("a role with no permissions grants nothing", async () => {
    const user = await makeUser({});
    await grant(user.id, await roleWith([]));
    const actor = await actorOf(user.id);

    assert.equal(actor.roles.length, 1, "the role is held");
    assert.equal(actor.permissions.size, 0, "and grants nothing");
    await assert.rejects(() => listUsers(actor), isAccessDenied);
  });

  test("no permission is granted by a role's name", async () => {
    // A role labelled ADMIN-ish but seeded empty must behave as empty: nothing
    // in the system reads a role's name to decide access.
    const user = await makeUser({});
    seq += 1;
    const impostor = await prisma.sysRole.create({
      data: {
        role_code: `test.imp${Date.now() % 100000}${seq}`,
        role_label: `TEST_ROLE_ADMINISTRATOR_${Date.now()}_${seq}`,
        role_name: "Administrator",
      },
    });
    await grant(user.id, impostor.id);

    const actor = await actorOf(user.id);
    assert.equal(actor.permissions.size, 0);
    await assert.rejects(() => listUsers(actor), isAccessDenied);
  });
});
