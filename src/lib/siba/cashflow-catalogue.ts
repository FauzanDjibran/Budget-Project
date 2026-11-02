/**
 * The entry types Mapping Cash Flow maps directly: the ones that carry no
 * Budget Category of their own. Every other cash flow takes its category's
 * group; a transfer, a registration and a revaluation are not cash flows.
 * Client-safe, so the mapping page and the report name them alike.
 */
export const MAPPED_ENTRY_TYPES = [
  { type: "Funding", label: "Intercompany (Funding)" },
  { type: "Pencairan", label: "Pencairan Valas" },
  { type: "BuyFx", label: "Pembelian Valas" },
  { type: "Journal", label: "Journal" },
] as const;

export type MappedEntryType = (typeof MAPPED_ENTRY_TYPES)[number]["type"];

export const entryTypeLabel = (type: string) =>
  MAPPED_ENTRY_TYPES.find((t) => t.type === type)?.label ?? type;
