import { notFound } from "next/navigation";
import { RoleForm } from "@/components/settings/role-form";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import { permissionsByModule } from "@/lib/siba/permissions";
import { ROLE_FROZEN_MESSAGE, isFrozenRoleLabel } from "@/lib/siba/roles";
import { getRole } from "@/lib/siba/user-admin";
import { RecordHistoryCard } from "@/components/ui/record-history-card";

export const dynamic = "force-dynamic";

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const roleId = Number(id);
  if (!Number.isInteger(roleId)) notFound();

  const actor = await requirePermission("ROLE_VIEW", `/settings/role/${id}`);
  const role = await getRole(actor, roleId);
  if (!role) notFound();

  const frozen = isFrozenRoleLabel(role.role_label);

  return (
    <>
      <RoleForm
        mode="view"
        role={role}
        catalogue={permissionsByModule()}
        frozen={frozen}
        frozenReason={frozen ? ROLE_FROZEN_MESSAGE : undefined}
        can={{
          edit: actorCan(actor, "ROLE_EDIT"),
          managePermissions: actorCan(actor, "ROLE_PERMISSION_MANAGE"),
          activate: actorCan(actor, "ROLE_ACTIVATE"),
          deactivate: actorCan(actor, "ROLE_DEACTIVATE"),
        }}
      />
      <RecordHistoryCard entityKey="sys_role" rowId={role.id} />
    </>
  );
}
