"use server";

import { redirect } from "next/navigation";
import { currentActor, endSession, startSession } from "@/lib/siba/auth";
import { authenticate } from "@/lib/siba/login";

/**
 * Sign-in and sign-out.
 *
 * The only two actions in the application reachable without a session, and the
 * only place a password is read.
 */

export type LoginState =
  | { ok: true }
  | { ok: false; message: string }
  | null;

export async function login(
  email: string,
  password: string
): Promise<{ ok: boolean; message?: string }> {
  const result = await authenticate(email, password);
  if (!result.ok) return { ok: false, message: result.message };

  await startSession(result.userId);
  return { ok: true };
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}

/** Lets the login screen bounce an already-signed-in visitor. */
export async function isSignedIn(): Promise<boolean> {
  return Boolean(await currentActor());
}
