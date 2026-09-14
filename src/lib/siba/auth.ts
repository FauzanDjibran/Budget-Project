import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { actorFor, actorCan, type Actor } from "./access";
import { AccessDeniedError } from "./auth-errors";
import {
  SESSION_COOKIE,
  issueSession,
  revokeSessionToken,
  validateSessionToken,
} from "./session";

/**
 * The application's single authentication and authorization entry point.
 *
 * Every server-side read and every write asks this module — pages via
 * `requireAuth` / `requirePermission`, Server Actions via the same helpers.
 * Nothing reads the session cookie directly.
 *
 * `cache()` memoises the lookup for the duration of one render pass, so a page
 * that checks several permissions still costs one session query.
 */

/** The signed-in actor, or null. Never redirects — callers decide. */
export const currentActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await validateSessionToken(token);
  if (!session) return null;
  return actorFor(session.user);
});

/**
 * Requires a session. Pages get redirected to the login screen; Server Actions
 * should call `actorOrDeny` instead, which throws rather than navigating.
 */
export async function requireAuth(nextPath?: string): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect(loginHref(nextPath));
  return actor;
}

/**
 * Requires a permission, for a page.
 *
 * The two failures are answered differently on purpose: no session redirects to
 * the login screen, while a session without the permission renders
 * `app/forbidden.tsx` with a 403. A signed-in user is never bounced to a login
 * form they do not need, and a refusal is never reported as a server error.
 */
export async function requirePermission(
  code: string,
  nextPath?: string
): Promise<Actor> {
  const actor = await requireAuth(nextPath);
  if (!actorCan(actor, code)) forbidden();
  return actor;
}

/** Page-level check that reports rather than throws, for partial UIs. */
export async function can(code: string): Promise<boolean> {
  return actorCan(await currentActor(), code);
}

/**
 * The Server Action counterpart of `requirePermission`. Actions cannot redirect
 * mid-call in a way the client can act on, so this throws `AccessDeniedError`
 * and the action's wrapper turns it into a normal refusal result.
 */
export async function actorOrDeny(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new AccessDeniedError("UNAUTHENTICATED");
  return actor;
}

export async function authorizeAction(code: string): Promise<Actor> {
  const actor = await actorOrDeny();
  if (!actorCan(actor, code)) throw new AccessDeniedError("UNAUTHORIZED");
  return actor;
}

// ------------------------------------------------------------------ cookie

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    // Cookies must not travel over plain HTTP outside local development.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

/** Signs a user in on the current request. */
export async function startSession(userId: number): Promise<void> {
  const { token, expiresAt } = await issueSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

/** Signs the current request out, revoking the session server-side too. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  await revokeSessionToken(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
}

/** Drops the cookie without touching the database — for an already-dead token. */
export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export function loginHref(nextPath?: string): string {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/login";
  }
  return `/login?next=${encodeURIComponent(nextPath)}`;
}
