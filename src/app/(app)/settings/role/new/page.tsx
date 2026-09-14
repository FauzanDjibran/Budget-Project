import { RoleForm } from "@/components/settings/role-form";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import { permissionsByModule } from "@/lib/siba/permissions";

export const dynamic = "force-dynamic";

export default async function NewRolePage() {
  const actor = await requirePermission("ROLE_CREATE", "/settings/role/new");

  return (
    <RoleForm
      mode="new"
      role={null}
      catalogue={permissionsByModule()}
      frozen={false}
      can={{
        edit: true,
        managePermissions: actorCan(actor, "ROLE_PERMISSION_MANAGE"),
        activate: false,
        deactivate: false,
      }}
    />
  );
}
