"use server";

import { revalidatePath } from "next/cache";
import { actorOrDeny } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import {
  type AdminResult,
  createRole,
  createUser,
  resetUserPassword,
  setRolePermissions,
  setRoleStatus,
  setUserRoles,
  setUserStatus,
  updateRole,
  updateUser,
  type RoleInput,
  type UserInput,
} from "@/lib/siba/user-admin";

/**
 * User and role administration, exposed to the client.
 *
 * Each action does three things and nothing else: resolve who is calling,
 * delegate to the guarded service, revalidate. Every rule — the permission
 * itself, the self-edit refusals, the last-administrator check — lives in
 * `lib/siba/user-admin.ts`, so calling one of these directly is checked exactly
 * as calling it through the UI is.
 */

/**
 * Turns an `AccessDeniedError` into the discriminated result the forms already
 * understand, and lets nothing else through: an unexpected failure must not
 * reach the client carrying internals.
 */
async function run(fn: () => Promise<AdminResult>): Promise<AdminResult> {
  try {
    return await fn();
  } catch (error) {
    if (isAccessDenied(error)) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }
}

function revalidateUsers(id?: number) {
  revalidatePath("/settings/user");
  if (id) revalidatePath(`/settings/user/${id}`);
  revalidatePath("/dashboard");
}

function revalidateRoles(id?: number) {
  revalidatePath("/settings/role");
  if (id) revalidatePath(`/settings/role/${id}`);
  revalidatePath("/settings/user");
}

export async function createUserAction(input: UserInput): Promise<AdminResult> {
  const result = await run(async () => createUser(await actorOrDeny(), input));
  if (result.ok) revalidateUsers();
  return result;
}

export async function updateUserAction(
  id: number,
  input: UserInput
): Promise<AdminResult> {
  const result = await run(async () => updateUser(await actorOrDeny(), id, input));
  if (result.ok) revalidateUsers(id);
  return result;
}

export async function setUserRolesAction(
  id: number,
  roleIds: number[]
): Promise<AdminResult> {
  const result = await run(async () => setUserRoles(await actorOrDeny(), id, roleIds));
  if (result.ok) revalidateUsers(id);
  return result;
}

export async function setUserStatusAction(
  id: number,
  status: "Active" | "Inactive"
): Promise<AdminResult> {
  const result = await run(async () => setUserStatus(await actorOrDeny(), id, status));
  if (result.ok) revalidateUsers(id);
  return result;
}

export async function resetUserPasswordAction(
  id: number,
  password: string
): Promise<AdminResult> {
  const result = await run(async () =>
    resetUserPassword(await actorOrDeny(), id, password)
  );
  if (result.ok) revalidateUsers(id);
  return result;
}

export async function createRoleAction(input: RoleInput): Promise<AdminResult> {
  const result = await run(async () => createRole(await actorOrDeny(), input));
  if (result.ok) revalidateRoles();
  return result;
}

export async function updateRoleAction(
  id: number,
  input: RoleInput
): Promise<AdminResult> {
  const result = await run(async () => updateRole(await actorOrDeny(), id, input));
  if (result.ok) revalidateRoles(id);
  return result;
}

export async function setRoleStatusAction(
  id: number,
  status: "Active" | "Inactive"
): Promise<AdminResult> {
  const result = await run(async () => setRoleStatus(await actorOrDeny(), id, status));
  if (result.ok) revalidateRoles(id);
  return result;
}

export async function setRolePermissionsAction(
  id: number,
  codes: string[]
): Promise<AdminResult> {
  const result = await run(async () =>
    setRolePermissions(await actorOrDeny(), id, codes)
  );
  if (result.ok) revalidateRoles(id);
  return result;
}
