import { UserForm } from "@/components/settings/user-form";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import { assignableRoles } from "@/lib/siba/user-admin";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  const actor = await requirePermission("USER_CREATE", "/settings/user/new");

  // Only fetched when the caller may actually grant access; otherwise the form
  // never offers roles and `createUser` would refuse them anyway.
  const canAssign = actorCan(actor, "USER_ROLE_ASSIGN");
  const roles = canAssign ? await assignableRoles(actor) : [];

  return (
    <UserForm
      mode="new"
      user={null}
      roles={roles}
      assignedRoleIds={[]}
      isSelf={false}
      can={{
        edit: true,
        assignRoles: canAssign,
        resetPassword: false,
        activate: false,
        deactivate: false,
      }}
    />
  );
}
