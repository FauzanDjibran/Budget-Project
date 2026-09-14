import "server-only";

import { compare, hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { issueSession, pruneDeadSessions, revokeSessionsForUser } from "./session";

/**
 * Credential verification. Kept apart from the cookie plumbing in `auth.ts` so
 * the rules below are exercised directly by the test suite.
 */

export const BCRYPT_ROUNDS = 10;

export const LOGIN_FAILED_MESSAGE = "Email atau password tidak sesuai.";

/**
 * A deactivated account is refused with the same message as a wrong password.
 * Saying "this account is disabled" would confirm the address exists.
 */
export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; userId: number }
  | { ok: false; message: string };

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_ROUNDS);
}

/** Minimum length, checked wherever a password is set or changed. */
export const PASSWORD_MIN_LENGTH = 8;

export function passwordProblem(plain: string): string | null {
  if (plain.length < PASSWORD_MIN_LENGTH) {
    return `Password minimal ${PASSWORD_MIN_LENGTH} karakter.`;
  }
  return null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Verifies credentials and, on success, issues a session.
 *
 * Every failure path costs roughly the same: when no user matches, the bcrypt
 * comparison still runs against a dummy hash so the response time does not
 * reveal whether the address is registered.
 */
export async function authenticate(
  rawEmail: string,
  password: string,
  now = new Date()
): Promise<LoginResult> {
  const email = normalizeEmail(rawEmail);

  const user = await prisma.sysUser.findUnique({
    where: { email },
    select: { id: true, password_hash: true, status: true },
  });

  const hashToCheck = user?.password_hash ?? DUMMY_HASH;
  const passwordOk = await compare(password, hashToCheck);

  if (!user || !passwordOk || user.status !== "Active") {
    return { ok: false, message: LOGIN_FAILED_MESSAGE };
  }

  const { token, expiresAt } = await issueSession(user.id, now);

  // Housekeeping: a login is the natural moment to clear out session rows that
  // can no longer be accepted. Cheap, needs no scheduler, and cannot affect the
  // session just issued.
  await pruneDeadSessions(now);

  return { ok: true, token, expiresAt, userId: user.id };
}

/**
 * Changing a password ends every session the account holds, including the one
 * that made the change — a stolen session cannot outlive the password it was
 * obtained with.
 */
export async function setPassword(
  userId: number,
  plain: string,
  now = new Date()
): Promise<void> {
  await prisma.sysUser.update({
    where: { id: userId },
    data: { password_hash: await hashPassword(plain) },
  });
  await revokeSessionsForUser(userId, now);
}

export async function verifyPassword(
  userId: number,
  plain: string
): Promise<boolean> {
  const user = await prisma.sysUser.findUnique({
    where: { id: userId },
    select: { password_hash: true },
  });
  return compare(plain, user?.password_hash ?? DUMMY_HASH);
}

/**
 * A real bcrypt hash of a value nothing can match, so the no-such-user path
 * still pays the cost of a comparison.
 */
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8f8W/1p1vGzFQ7l0i3sJc0aCSMnhZa";
