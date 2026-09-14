import { RoleList } from "@/components/settings/role-list";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import { PERMISSION_CODES } from "@/lib/siba/permissions";
import { listRoles } from "@/lib/siba/user-admin";

export const dynamic = "force-dynamic";

export default async function RoleListPage() {
  await requirePermission("MENU_ROLE_ACCESS", "/settings/role");
  const actor = await requirePermission("ROLE_VIEW", "/settings/role");

  return (
    <RoleList
      roles={await listRoles(actor)}
      totalPermissions={PERMISSION_CODES.length}
      canCreate={actorCan(actor, "ROLE_CREATE")}
    />
  );
}
