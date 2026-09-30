import { SystemDefaultForm } from "@/components/settings/system-default-form";
import { prisma } from "@/lib/prisma";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import type { RefOption } from "@/lib/siba/records";
import {
  SYSTEM_DEFAULTS,
  refValueOf,
  type SystemDefaultKey,
} from "@/lib/siba/system-defaults";
import { systemDefaults } from "@/lib/siba/system-settings";

export const dynamic = "force-dynamic";

/**
 * System Default — the values the application prefills with.
 *
 * Reaching the menu and reading the values are separate permissions, the same
 * split every other module uses, and editing is a third. The accounts posting
 * engines post to are Mapping Account System, under Accounting.
 */
export default async function SystemDefaultPage() {
  await requirePermission("MENU_SYSTEM_DEFAULT_ACCESS", "/settings/system-default");
  const actor = await requirePermission(
    "SYSTEM_DEFAULT_VIEW",
    "/settings/system-default"
  );

  const values = await systemDefaults();
  const [currencies, companies, cashBanks] = await Promise.all([
    prisma.refCurrency.findMany({ orderBy: { currency_label: "asc" } }),
    prisma.sysCompany.findMany({ orderBy: { id: "asc" } }),
    prisma.mCashBank.findMany({
      orderBy: { cash_bank_label: "asc" },
      include: { currency: { select: { currency_label: true } } },
    }),
  ]);

  // Exactly what each setting's own rule admits, plus whatever is already
  // stored even if it has since stopped qualifying, so a page that opens on a
  // stale value still shows what it is rather than an empty box.
  const keep = (key: SystemDefaultKey, id: number, ok: boolean) =>
    ok || id === refValueOf(values, key);

  const options: Record<SystemDefaultKey, RefOption[]> = {
    default_currency: currencies
      .filter((c) => keep("default_currency", c.id, c.status === "Active"))
      .map((c) => ({
        id: c.id,
        label: c.currency_label,
        name: c.currency_name,
        active: c.status === "Active",
      })),
    default_company: companies.map((c) => ({
      id: c.id,
      label: c.company_label,
      name: c.company_name,
      active: true,
    })),
    default_realization_cash_bank: cashBanks
      .filter((b) =>
        keep(
          "default_realization_cash_bank",
          b.id,
          b.status === "Active" && b.currency.currency_label === BASE_CURRENCY_LABEL
        )
      )
      .map((b) => ({
        id: b.id,
        label: b.cash_bank_label,
        name: b.cash_bank_name,
        active: b.status === "Active",
      })),
  };
  // Every key the catalogue declares has its options.
  for (const def of SYSTEM_DEFAULTS) options[def.key] ??= [];

  const base = currencies.find((c) => c.currency_label === BASE_CURRENCY_LABEL);

  return (
    <SystemDefaultForm
      values={values}
      options={options}
      baseCurrency={{
        label: BASE_CURRENCY_LABEL,
        name: base?.currency_name ?? BASE_CURRENCY_LABEL,
      }}
      canEdit={actorCan(actor, "SYSTEM_DEFAULT_EDIT")}
    />
  );
}
