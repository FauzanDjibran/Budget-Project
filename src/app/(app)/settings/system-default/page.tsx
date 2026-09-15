import { SystemDefaultForm } from "@/components/settings/system-default-form";
import { prisma } from "@/lib/prisma";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import type { RefOption } from "@/lib/siba/records";
import type { SystemDefaultKey } from "@/lib/siba/system-defaults";
import { systemDefaults } from "@/lib/siba/system-settings";

export const dynamic = "force-dynamic";

/**
 * System Default — the values the application prefills with.
 *
 * Reaching the menu and reading the values are separate permissions, the same
 * split every other module uses, and editing is a third.
 */
export default async function SystemDefaultPage() {
  await requirePermission("MENU_SYSTEM_DEFAULT_ACCESS", "/settings/system-default");
  const actor = await requirePermission(
    "SYSTEM_DEFAULT_VIEW",
    "/settings/system-default"
  );

  const values = await systemDefaults();

  // A default may only point at something a user could have chosen anyway, so
  // the options are exactly what the pickers themselves offer: active records,
  // plus whatever is already set even if it has since been deactivated.
  const currencies = await prisma.refCurrency.findMany({
    orderBy: { currency_label: "asc" },
  });
  const currencyOptions: RefOption[] = currencies
    .filter(
      (c) => c.status === "Active" || String(c.id) === values.default_currency
    )
    .map((c) => ({
      id: c.id,
      label: c.currency_label,
      name: c.currency_name,
      active: c.status === "Active",
    }));

  const options: Record<SystemDefaultKey, RefOption[]> = {
    default_currency: currencyOptions,
  };

  return (
    <SystemDefaultForm
      values={values}
      options={options}
      canEdit={actorCan(actor, "SYSTEM_DEFAULT_EDIT")}
    />
  );
}
