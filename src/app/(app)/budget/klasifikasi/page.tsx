import { ClassificationQueue } from "@/components/budget/classification-queue";
import { requirePermission } from "@/lib/siba/auth";
import {
  budgetMappings,
  budgetRefs,
  classificationQueue,
} from "@/lib/siba/budget";
import { accessibleCompanyIds } from "@/lib/siba/company-access";

export const dynamic = "force-dynamic";

/**
 * Klasifikasi Budget: every approved Budget still waiting for its Budget
 * Category and Partner, in the Companies the reader may see.
 */
export default async function Page() {
  const actor = await requirePermission("BUDGET_CLASSIFY", "/budget/klasifikasi");
  const companyIds = await accessibleCompanyIds(actor.permissions);

  const [queue, refs, mappings] = await Promise.all([
    classificationQueue(companyIds),
    budgetRefs(),
    budgetMappings(),
  ]);

  return (
    <ClassificationQueue
      budgets={queue.rows}
      hints={queue.hints}
      refs={refs}
      mappings={mappings}
    />
  );
}
