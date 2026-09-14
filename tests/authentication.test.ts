import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  authenticate,
  LOGIN_FAILED_MESSAGE,
  passwordProblem,
  verifyPassword,
} from "../src/lib/siba/login";
import {
  issueSession,
  pruneDeadSessions,
  revokeSessionToken,
  revokeSessionsForUser,
  validateSessionToken,
  SESSION_MAX_AGE_MS,
  hashToken,
} from "../src/lib/siba/session";
import { cleanup, disconnect, makeUser, prisma } from "./helpers";

/**
 * Authentication: who you are.
 *
 * Covers checklist items 1-3 and 16 — unauthenticated rejection, valid and
 * invalid login, and the deactivated account.
 */
describe("authentication", () => {
  before(cleanup);
  after(async () => {
    await cleanup();
    await disconnect();
  });

  test("an absent or unknown token yields no session", async () => {
    assert.equal(await validateSessionToken(undefined), null);
    assert.equal(await validateSessionToken(""), null);
    assert.equal(await validateSessionToken("not-a-real-token"), null);
  });

  test("valid credentials sign a user in", async () => {
    const user = await makeUser({ roleLabels: ["STAFF"] });

    const result = await authenticate(user.email, user.password);
    assert.equal(result.ok, true);

    const session = await validateSessionToken(result.ok ? result.token : "");
    assert.equal(session?.user.id, user.id);
    assert.equal(session?.user.email, user.email);
  });

  test("the login identifier is case-insensitive", async () => {
    const user = await makeUser({});
    const result = await authenticate(user.email.toUpperCase(), user.password);
    assert.equal(result.ok, true);
  });

  test("a wrong password is rejected, and issues no session", async () => {
    const user = await makeUser({});
    const before = await prisma.sysSession.count({ where: { user_id: user.id } });

    const result = await authenticate(user.email, "definitely-not-the-password");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.message, LOGIN_FAILED_MESSAGE);

    const after = await prisma.sysSession.count({ where: { user_id: user.id } });
    assert.equal(after, before, "a failed login must not create a session");
  });

  test("an unknown address is refused with the same message as a wrong password", async () => {
    const result = await authenticate("nobody@nowhere.test", "whatever");
    assert.equal(result.ok, false);
    assert.equal(
      result.ok === false && result.message,
      LOGIN_FAILED_MESSAGE,
      "the message must not reveal whether the account exists"
    );
  });

  test("a deactivated user cannot authenticate", async () => {
    const user = await makeUser({ status: "Inactive", roleLabels: ["STAFF"] });

    const result = await authenticate(user.email, user.password);
    assert.equal(result.ok, false);
    assert.equal(
      await prisma.sysSession.count({ where: { user_id: user.id } }),
      0,
      "no session may exist for a deactivated account"
    );
  });

  test("deactivating a user kills the sessions they already hold", async () => {
    const user = await makeUser({ roleLabels: ["STAFF"] });
    const { token } = await issueSession(user.id);
    assert.ok(await validateSessionToken(token), "session should start valid");

    await prisma.sysUser.update({
      where: { id: user.id },
      data: { status: "Inactive" },
    });

    assert.equal(
      await validateSessionToken(token),
      null,
      "an existing session must stop working the moment the account is deactivated"
    );

    const row = await prisma.sysSession.findFirstOrThrow({ where: { user_id: user.id } });
    assert.ok(row.revoked_at, "the session row should be revoked, not merely rejected");
  });

  test("logout revokes the session server-side", async () => {
    const user = await makeUser({});
    const { token } = await issueSession(user.id);

    await revokeSessionToken(token);

    assert.equal(
      await validateSessionToken(token),
      null,
      "a revoked token must not be accepted again"
    );
  });

  test("an expired session is refused", async () => {
    const user = await makeUser({});
    const { token } = await issueSession(user.id);

    const now = new Date(Date.now() + SESSION_MAX_AGE_MS + 1000);
    assert.equal(await validateSessionToken(token, now), null);
  });

  test("revoking a user's sessions ends all of them at once", async () => {
    const user = await makeUser({});
    const a = await issueSession(user.id);
    const b = await issueSession(user.id);

    await revokeSessionsForUser(user.id);

    assert.equal(await validateSessionToken(a.token), null);
    assert.equal(await validateSessionToken(b.token), null);
  });

  test("the raw token is never stored", async () => {
    const user = await makeUser({});
    const { token } = await issueSession(user.id);

    const rows = await prisma.sysSession.findMany({ where: { user_id: user.id } });
    for (const row of rows) {
      assert.notEqual(row.token_hash, token);
      assert.equal(row.token_hash.length, 64, "expected a SHA-256 hex digest");
    }
  });

  test("passwords are hashed, never stored in the clear", async () => {
    const user = await makeUser({ password: "a-very-distinct-password" });
    const row = await prisma.sysUser.findUniqueOrThrow({ where: { id: user.id } });

    assert.notEqual(row.password_hash, "a-very-distinct-password");
    assert.match(row.password_hash, /^\$2[aby]\$/, "expected a bcrypt hash");
    assert.ok(await verifyPassword(user.id, "a-very-distinct-password"));
  });

  test("short passwords are refused", () => {
    assert.ok(passwordProblem("short"));
    assert.equal(passwordProblem("long-enough-password"), null);
  });

  test("dead sessions are cleaned up; live ones are left alone", async () => {
    const user = await makeUser({});

    const live = await issueSession(user.id);
    const revoked = await issueSession(user.id);
    await revokeSessionToken(revoked.token);

    // An already-expired row, aged directly so the test does not have to wait.
    const stale = await issueSession(user.id);
    await prisma.sysSession.update({
      where: { token_hash: hashToken(stale.token) },
      data: { expires_at: new Date(Date.now() - 1000) },
    });

    const removed = await pruneDeadSessions();
    assert.ok(removed >= 2, "the revoked and the expired row should both go");

    const remaining = await prisma.sysSession.findMany({ where: { user_id: user.id } });
    assert.equal(remaining.length, 1, "only the live session survives");
    assert.ok(
      await validateSessionToken(live.token),
      "pruning must not disturb a session that is still valid"
    );
  });

  test("logging in prunes dead sessions", async () => {
    const user = await makeUser({});

    const old = await issueSession(user.id);
    await revokeSessionToken(old.token);
    assert.equal(
      await prisma.sysSession.count({ where: { user_id: user.id, revoked_at: { not: null } } }),
      1
    );

    const result = await authenticate(user.email, user.password);
    assert.equal(result.ok, true);

    // The revoked row is gone and the freshly issued one is untouched.
    const rows = await prisma.sysSession.findMany({ where: { user_id: user.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].revoked_at, null);
    assert.ok(await validateSessionToken(result.ok ? result.token : ""));
  });
});
