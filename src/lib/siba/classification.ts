/**
 * The classification chain, as data: Budget Category -> Partner Category -> Partner.
 *
 * These rules used to be a constant in `rules.ts`. They are now rows in
 * `sys_budget_category` and `sys_budget_partner_category_mapping`, because the
 * model is still being discovered and reshaping it must not mean editing code
 * and redeploying. What stayed in code is the part that carries behaviour: the
 * 22 Purposes in `rules.ts`, each of which resolves to exactly one account.
 *
 * This module is **client-safe** — no `server-only`, no database import — for
 * the same reason `currency.ts` is: the form narrowing a picker and the Server
 * Action refusing a value must read the identical rule, and a rule that exists
 * twice is a rule with two answers. The catalogue is loaded once on the server
 * (`loadClassification` in `records.ts`) and handed to whoever needs it.
 */
export type Direction = "In" | "Out";

/**
 * How a direction is written for the user. `In` and `Out` are storage; nothing
 * in the interface ever shows them. One map, because the application already
 * carried two copies of this and a third would be how they start to disagree.
 */
export const DIRECTION_TEXT: Record<Direction, string> = {
  In: "Penerimaan",
  Out: "Pengeluaran",
};

export function directionText(direction: string): string {
  return DIRECTION_TEXT[direction as Direction] ?? direction;
}

export type BudgetCategoryRule = {
  id: number;
  label: string;
  name: string;
  allowsIn: boolean;
  allowsOut: boolean;
  /**
   * Whether this category names a subject at all. Asset and Biaya do not, and
   * that is a decision rather than an omission — which is exactly why it is a
   * flag and not `partnerCategories.length === 0`. A category that requires a
   * Partner but has no Partner Category configured yet is a setup gap; a
   * category that requires none is finished.
   */
  requirePartner: boolean;
  /** Labels of the **active** Partner Categories this category admits. */
  partnerCategories: string[];
  active: boolean;
};

export type ClassificationCatalogue = BudgetCategoryRule[];

export function ruleFor(
  catalogue: ClassificationCatalogue,
  categoryLabel: string
): BudgetCategoryRule | undefined {
  return catalogue.find((r) => r.label === categoryLabel);
}

/** Whether a Budget Category is classified per Partner Category. */
export function budgetCategoryNeedsPartner(
  catalogue: ClassificationCatalogue,
  categoryLabel: string
): boolean {
  return ruleFor(catalogue, categoryLabel)?.requirePartner ?? false;
}

export function allowedPartnerCategories(
  catalogue: ClassificationCatalogue,
  categoryLabel: string
): string[] {
  return ruleFor(catalogue, categoryLabel)?.partnerCategories ?? [];
}

/**
 * Whether a Budget Category makes sense for a budget going this way.
 *
 * Direction follows balance-sheet logic, not cash direction: Biaya and Asset
 * only ever go Out, Hasil Investasi only ever comes In, while the subject
 * categories move both ways.
 */
export function budgetCategoryAllowsDirection(
  catalogue: ClassificationCatalogue,
  categoryLabel: string,
  direction: string
): boolean {
  const rule = ruleFor(catalogue, categoryLabel);
  if (!rule) return false;
  return direction === "In" ? rule.allowsIn : direction === "Out" ? rule.allowsOut : false;
}

export function directionsOf(rule: {
  allowsIn: boolean;
  allowsOut: boolean;
}): Direction[] {
  const out: Direction[] = [];
  if (rule.allowsIn) out.push("In");
  if (rule.allowsOut) out.push("Out");
  return out;
}

/** `Penerimaan · Pengeluaran`, or a dash where the category admits neither. */
export function directionsText(rule: {
  allowsIn: boolean;
  allowsOut: boolean;
}): string {
  const dirs = directionsOf(rule);
  return dirs.length ? dirs.map(directionText).join(" · ") : "—";
}
