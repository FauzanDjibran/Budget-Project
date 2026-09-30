import { SystemAccountForm } from "@/components/accounting/system-account-form";
import { prisma } from "@/lib/prisma";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import { companyScope } from "@/lib/siba/company-access";
import { structuralControlAccountIds, type RefOption } from "@/lib/siba/records";
import {
  EMPTY_SYSTEM_ACCOUNTS,
  SYSTEM_ACCOUNTS,
  sideOf,
  type SystemAccountKey,
} from "@/lib/siba/system-accounts";
import { systemAccountsOf } from "@/lib/siba/system-account-data";

export const dynamic = "force-dynamic";

/**
 * Mapping Account System — one Company's posting accounts, chosen from that
 * Company's chart. `?company=` picks the Company, inside what the reader's
 * permissions open.
 */
export default async function SystemAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const actor = await requirePermission("SYSTEM_ACCOUNT_VIEW", "/accounting/system-account");
  const { company: requested } = await searchParams;
  const scope = await companyScope(actor.permissions, requested);
  const companies = scope.options.map((c) => ({ id: c.id, label: c.label, name: c.name }));
  const selected = scope.selected;

  const values = selected ? await systemAccountsOf(selected.id) : { ...EMPTY_SYSTEM_ACCOUNTS };
  const options = {} as Record<SystemAccountKey, RefOption[]>;

  if (selected) {
    // Postable accounts of this Company; an inactive one only when it is the
    // one already stored, so a page opening on a stale value still says what
    // it is. A note's counter account may not be one a book reconciles
    // against — the Server Action refuses it, so the picker does not offer it.
    const [rows, bookAccounts] = await Promise.all([
      prisma.accAccount.findMany({
        where: { company_id: selected.id, is_postable: true },
        orderBy: { account_label: "asc" },
      }),
      structuralControlAccountIds(),
    ]);
    for (const def of SYSTEM_ACCOUNTS) {
      const chosen = values[def.key];
      options[def.key] = rows
        .filter((a) => a.is_active || a.id === chosen)
        .filter((a) => def.group !== "dncn" || a.id === chosen || !bookAccounts.has(a.id))
        .map((a) => ({
          id: a.id,
          label: a.account_label,
          name: a.account_name,
          active: a.is_active,
        }));
    }
  }

  return (
    <SystemAccountForm
      key={selected?.id ?? 0}
      companies={companies}
      company={
        selected
          ? {
              id: selected.id,
              label: selected.label,
              name: selected.name,
              side: sideOf(selected.isParent),
            }
          : null
      }
      values={values}
      options={options}
      canEdit={actorCan(actor, "SYSTEM_ACCOUNT_EDIT")}
    />
  );
}
