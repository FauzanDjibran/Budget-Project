import { notFound } from "next/navigation";
import { UserForm } from "@/components/settings/user-form";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import { assignableRoles, getUser } from "@/lib/siba/user-admin";

export const dynamic = "force-dynamic";

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) notFound();

  const actor = await requirePermission("USER_EDIT", `/settings/user/${id}/edit`);
  const user = await getUser(actor, userId);
  if (!user) notFound();

  const canAssign = actorCan(actor, "USER_ROLE_ASSIGN");
  const roles = canAssign ? await assignableRoles(actor) : [];
  const assigned = roles.filter((r) => user.role_labels.includes(r.label)).map((r) => r.id);

  return (
    <UserForm
      mode="edit"
      user={user}
      roles={roles}
      assignedRoleIds={assigned}
      isSelf={user.id === actor.user.id}
      can={{
        edit: true,
        assignRoles: canAssign,
        resetPassword: actorCan(actor, "USER_PASSWORD_RESET"),
        activate: actorCan(actor, "USER_ACTIVATE"),
        deactivate: actorCan(actor, "USER_DEACTIVATE"),
      }}
    />
  );
}
