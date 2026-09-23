import { SystemDefaultForm } from "@/components/settings/system-default-form";
import { prisma } from "@/lib/prisma";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import { structuralControlAccountIds, type RefOption } from "@/lib/siba/records";
import {
  SYSTEM_DEFAULTS,
  type SystemDefaultDef,
  type SystemDefaultKey,
  type SystemDefaultValues,
} from "@/lib/siba/system-defaults";
import { systemDefaults } from "@/lib/siba/system-settings";

export const dynamic = "force-dynamic";

/**
 * System Default — the values the application prefills with, plus the account
 * each Company journals its side of a Funding Request against.
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

  const companies = await prisma.sysCompany.findMany({
    select: { id: true, is_parent: true },
  });
  const companyId = (which: "induk" | "anak") =>
    companies.find((c) => c.is_parent === (which === "induk"))?.id ?? 0;

  // A note's counter account may not be one a book already reconciles
  // against — `checkSystemDefaultValue` refuses it, so the picker does not offer
  // it. Read once for the four settings that need it.
  const bookAccounts = await structuralControlAccountIds();

  const options = {} as Record<SystemDefaultKey, RefOption[]>;
  for (const def of SYSTEM_DEFAULTS) {
    options[def.key] = await optionsFor(def, values);
  }

  return (
    <SystemDefaultForm
      values={values}
      options={options}
      canEdit={actorCan(actor, "SYSTEM_DEFAULT_EDIT")}
    />
  );

  /**
   * Exactly what the setting's own rules admit — active records of the right
   * Company, plus whatever is already stored even if it has since been
   * deactivated, so a page that opens on a stale value still shows what it is
   * rather than an empty box.
   */
  async function optionsFor(
    def: SystemDefaultDef,
    current: SystemDefaultValues
  ): Promise<RefOption[]> {
    const chosen = Number(current[def.key] ?? "");
    const keep = (id: number, active: boolean) => active || id === chosen;

    if (def.ref === "ref_currency") {
      const rows = await prisma.refCurrency.findMany({
        orderBy: { currency_label: "asc" },
      });
      return rows
        .filter((c) => keep(c.id, c.status === "Active"))
        .map((c) => ({
          id: c.id,
          label: c.currency_label,
          name: c.currency_name,
          active: c.status === "Active",
        }));
    }

    const rows = await prisma.accAccount.findMany({
      where: { company_id: companyId(def.company!), is_postable: true },
      orderBy: { account_label: "asc" },
    });
    return rows
      .filter((a) => keep(a.id, a.is_active))
      .filter((a) => def.group !== "dncn" || a.id === chosen || !bookAccounts.has(a.id))
      .map((a) => ({
        id: a.id,
        label: a.account_label,
        name: a.account_name,
        active: a.is_active,
      }));
  }
}
