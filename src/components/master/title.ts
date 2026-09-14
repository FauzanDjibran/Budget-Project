import type { Entity } from "@/lib/siba/entities";
import type { RefOption, Row } from "@/lib/siba/records";

/**
 * How a record names itself in headers, breadcrumbs and confirmations.
 *
 * Most records carry their own identity — a label and a name. A mapping does
 * not: it exists only to connect three other records, so it is named by what it
 * connects (`titleRefs`), the way the mockup titled it.
 */
export function recordTitle(
  entity: Entity,
  row: Row | null,
  refs: Record<string, RefOption[]>
): string {
  if (!row) return entity.single ?? entity.name;

  if (entity.titleRefs) {
    const parts = entity.titleRefs
      .map((field) => refs[field]?.find((o) => o.id === Number(row[field])))
      .filter((o): o is RefOption => Boolean(o))
      .map((o) => o.label);
    if (parts.length) return parts.join(" × ");
    return String(row[entity.codeField] ?? entity.name);
  }

  const label = entity.labelField ? String(row[entity.labelField] ?? "") : "";
  const name = entity.nameField ? String(row[entity.nameField] ?? "") : "";
  if (label && name) return `${label} – ${name}`;
  return name || label || String(row[entity.codeField] ?? entity.name);
}
