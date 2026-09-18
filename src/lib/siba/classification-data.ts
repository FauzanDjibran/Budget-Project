import "server-only";

import { prisma } from "@/lib/prisma";
import type { ClassificationCatalogue } from "./classification";

/**
 * The classification chain as the rest of the application reads it:
 * Budget Category -> Partner Category -> Partner.
 *
 * Loaded whole rather than queried per question. It is eight categories and a
 * handful of pairs, every caller needs several answers from it, and a catalogue
 * that arrives in one piece can be handed to a client component as a prop —
 * which is what lets a form narrow a picker by the same rule the Server Action
 * refuses by.
 *
 * A **deactivated pair is absent**, not merely marked: narrowing a category has
 * to stop it being offered everywhere at once, while the row itself survives so
 * every Budget already classified by it still reads. The same goes for a
 * deactivated Partner Category, which drops out of every category that admitted
 * it without any of those categories being edited.
 *
 * Its own module rather than part of `records.ts` because it is a rule rather
 * than registry plumbing, and because `records.ts` has to be free to ask Budget
 * how many Budgets a category holds — which would be a cycle if the rule lived
 * there too.
 */
export async function loadClassification(): Promise<ClassificationCatalogue> {
  const rows = await prisma.sysBudgetCategory.findMany({
    orderBy: { id: "asc" },
    include: {
      partner_categories: {
        where: { status: "Active", partner_category: { status: "Active" } },
        include: { partner_category: { select: { category_label: true } } },
        orderBy: { partner_category_id: "asc" },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.category_label,
    name: r.category_name,
    allowsIn: r.allows_in,
    allowsOut: r.allows_out,
    requirePartner: r.require_partner,
    partnerCategories: r.partner_categories.map((m) => m.partner_category.category_label),
    active: r.status === "Active",
  }));
}
