import { UserList } from "@/components/settings/user-list";
import { requirePermission } from "@/lib/siba/auth";
import { actorCan } from "@/lib/siba/access";
import { listUsers } from "@/lib/siba/user-admin";

export const dynamic = "force-dynamic";

export default async function UserListPage() {
  // Menu access and data access are separate permissions: reaching the page is
  // not the same as being allowed to read the list.
  await requirePermission("MENU_USER_ACCESS", "/settings/user");
  const actor = await requirePermission("USER_VIEW", "/settings/user");

  const users = await listUsers(actor);

  return (
    <UserList
      users={users}
      currentUserId={actor.user.id}
      can={{
        create: actorCan(actor, "USER_CREATE"),
        edit: actorCan(actor, "USER_EDIT"),
        activate: actorCan(actor, "USER_ACTIVATE"),
        deactivate: actorCan(actor, "USER_DEACTIVATE"),
      }}
    />
  );
}
