"use server";

import { revalidatePath } from "next/cache";
import { actorOrDeny, startSession } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import {
  changeOwnPassword,
  updateOwnProfile,
  type ProfileResult,
} from "@/lib/siba/profile";

/**
 * The current user's own account. Authentication is the only requirement — see
 * the note in `lib/siba/profile.ts` on why own-profile access is not a
 * permission — and nothing here can change access.
 */

async function run(fn: () => Promise<ProfileResult>): Promise<ProfileResult> {
  try {
    return await fn();
  } catch (error) {
    if (isAccessDenied(error)) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }
}

export async function updateProfileAction(input: {
  name: string;
  initials: string;
}): Promise<ProfileResult> {
  const result = await run(async () => updateOwnProfile(await actorOrDeny(), input));
  if (result.ok) {
    revalidatePath("/settings/profile");
    revalidatePath("/", "layout");
  }
  return result;
}

export async function changePasswordAction(input: {
  current: string;
  next: string;
  confirm: string;
}): Promise<ProfileResult> {
  const actor = await actorOrDeny().catch((error) => {
    if (isAccessDenied(error)) return null;
    throw error;
  });
  if (!actor) {
    return { ok: false, errors: { _form: "Sesi Anda sudah berakhir." } };
  }

  const result = await changeOwnPassword(actor, input);
  if (!result.ok) return result;

  // A successful change revoked every session, this one included. Issue a fresh
  // one so the browser that made the change stays signed in and the others do
  // not.
  await startSession(actor.user.id);
  revalidatePath("/settings/profile");
  return result;
}
