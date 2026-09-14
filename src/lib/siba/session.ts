import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Server-side sessions.
 *
 * The browser holds an opaque 256-bit random token; the database stores only
 * its SHA-256. Nothing about the user is encoded in the cookie, so a session
 * cannot be forged or read client-side, and revocation takes effect on the very
 * next request because every validation re-reads the row.
 *
 * SHA-256 rather than bcrypt is deliberate: the token already carries full
 * entropy, so there is nothing to slow down a guesser — unlike a password,
 * which is why passwords still go through bcrypt in `login.ts`.
 *
 * This module deliberately knows nothing about cookies or requests. The cookie
 * wiring lives in `auth.ts`, which keeps the lifecycle testable.
 */

export const SESSION_COOKIE = "siba_session";

/** Absolute lifetime. A session older than this is dead regardless of use. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sliding refresh: once a session is more than this old, a request extends it.
 * Keeps an active user signed in without rewriting the row on every request.
 */
const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export type SessionUser = {
  id: number;
  user_code: string;
  email: string;
  name: string;
  initials: string;
};

export type ValidatedSession = {
  user: SessionUser;
  sessionId: number;
  expires_at: Date;
};

/** Issues a session for a user and returns the raw token for the cookie. */
export async function issueSession(
  userId: number,
  now = new Date()
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);

  await prisma.sysSession.create({
    data: {
      token_hash: hashToken(token),
      user_id: userId,
      expires_at: expiresAt,
      last_seen_at: now,
      created_at: now,
    },
  });

  return { token, expiresAt };
}

/**
 * Resolves a raw token to its user, or null.
 *
 * Returns null — never a partial session — when the token is unknown, revoked,
 * expired, or belongs to a user who is no longer Active. A deactivated user's
 * sessions are revoked here rather than merely rejected, so the row cannot come
 * back to life if the account is reactivated later.
 */
export async function validateSessionToken(
  token: string | undefined | null,
  now = new Date()
): Promise<ValidatedSession | null> {
  if (!token) return null;

  const row = await prisma.sysSession.findUnique({
    where: { token_hash: hashToken(token) },
    include: {
      user: {
        select: {
          id: true,
          user_code: true,
          email: true,
          name: true,
          initials: true,
          status: true,
        },
      },
    },
  });

  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at <= now) return null;

  if (row.user.status !== "Active") {
    await revokeSessionsForUser(row.user_id, now);
    return null;
  }

  let expiresAt = row.expires_at;
  if (now.getTime() - row.last_seen_at.getTime() > SESSION_REFRESH_AFTER_MS) {
    expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);
    await prisma.sysSession.update({
      where: { id: row.id },
      data: { last_seen_at: now, expires_at: expiresAt },
    });
  }

  return {
    user: {
      id: row.user.id,
      user_code: row.user.user_code,
      email: row.user.email,
      name: row.user.name,
      initials: row.user.initials,
    },
    sessionId: row.id,
    expires_at: expiresAt,
  };
}

/** Logout. Revoking rather than deleting keeps the trail intact. */
export async function revokeSessionToken(
  token: string | undefined | null,
  now = new Date()
): Promise<void> {
  if (!token) return;
  await prisma.sysSession.updateMany({
    where: { token_hash: hashToken(token), revoked_at: null },
    data: { revoked_at: now },
  });
}

/**
 * Kills every live session a user holds. Called when an account is deactivated
 * and when its password changes.
 */
export async function revokeSessionsForUser(
  userId: number,
  now = new Date()
): Promise<number> {
  const { count } = await prisma.sysSession.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: now },
  });
  return count;
}

/**
 * Deletes sessions that can no longer be accepted — expired or revoked.
 *
 * Sessions are housekeeping, not business records: the application's no-delete
 * rule protects master data and history, and a dead session row is neither.
 * `validateSessionToken` already rejects these rows, so removing them changes
 * no behaviour; it only stops the table growing without bound.
 *
 * Deliberately not a scheduler, a job runner, or a rotation policy. It is one
 * DELETE, called after a successful login (see `login.ts`), which is frequent
 * enough to keep the table small and requires no infrastructure at all. The
 * audit trail lives in `audit_log`, which is untouched by this.
 */
export async function pruneDeadSessions(now = new Date()): Promise<number> {
  const { count } = await prisma.sysSession.deleteMany({
    where: {
      OR: [{ expires_at: { lt: now } }, { revoked_at: { not: null } }],
    },
  });
  return count;
}
