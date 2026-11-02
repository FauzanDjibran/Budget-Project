import "server-only";

import { prisma } from "@/lib/prisma";
import { cashFlowMovements, type CashFlowColumn, type CashFlowMovements } from "./cash-bank";
import { entryTypeLabel } from "./cashflow-catalogue";
import { cashflowMappings } from "./cashflow-mapping";
import { roundBase } from "./fx";
import { BASE_CURRENCY_LABEL } from "./currency";
import { reportableFiscalYears, type ReportableFiscalYear } from "./fiscal";

/**
 * How the Laporan Arus Kas reads its URL — shared by the page and its Unduh
 * XLSX route, so the file is the run on screen. `currency`, `year`, `from` and
 * `to` (period ids); missing or foreign values fall back to the base currency,
 * the newest year, and its periods from the first to the one holding today.
 */
export async function resolveCashFlowRun(
  companyId: number,
  query: { currency?: string; year?: string; from?: string; to?: string }
) {
  const [currencyRows, years] = await Promise.all([
    prisma.refCurrency.findMany({
      where: { status: "Active" },
      orderBy: { currency_label: "asc" },
      select: { id: true, currency_label: true, currency_name: true },
    }),
    reportableFiscalYears(companyId),
  ]);
  const currencies = currencyRows.map((c) => ({ id: c.id, label: c.currency_label, name: c.currency_name }));
  const requested = Number(query.currency);
  const currencyId =
    currencies.find((c) => c.id === requested)?.id ??
    currencies.find((c) => c.label === BASE_CURRENCY_LABEL)?.id ??
    currencies[0]?.id ??
    null;

  const year: ReportableFiscalYear | null = years.find((y) => y.id === Number(query.year)) ?? years[0] ?? null;
  const periods = year?.periods ?? [];
  const today = new Date().toISOString().slice(0, 10);
  let from = periods.findIndex((p) => p.id === Number(query.from));
  let to = periods.findIndex((p) => p.id === Number(query.to));
  if (from < 0) from = 0;
  if (to < 0) {
    to = periods.findIndex((p) => today >= p.startDate && today <= p.endDate);
    if (to < 0) to = periods.length - 1;
  }
  if (from > to) [from, to] = [to, from];
  const columns: CashFlowColumn[] = periods
    .slice(from, to + 1)
    .map((p) => ({ label: p.name, from: p.startDate, to: p.endDate }));

  return {
    currencies,
    years: years.map((y) => ({ id: y.id, name: y.name, periods: y.periods.map((p) => ({ id: p.id, name: p.name })) })),
    currencyId,
    currencyLabel: currencies.find((c) => c.id === currencyId)?.label ?? "",
    year,
    fromId: periods[from]?.id ?? null,
    toId: periods[to]?.id ?? null,
    columns,
  };
}

/** A Partner, or — where the entries name none — a keterangan. The smallest detail. */
export type CashFlowLeaf = { key: string; name: string; values: number[] };
/** A Budget Category, or the entry type standing in for one. */
export type CashFlowCategory = { key: string; name: string; values: number[]; children: CashFlowLeaf[] };
export type CashFlowGroup = {
  /** Null for movements no mapping places. */
  id: number | null;
  name: string;
  receipts: CashFlowCategory[];
  payments: CashFlowCategory[];
};
export type CashFlowReport = Omit<CashFlowMovements, "movements"> & {
  columns: CashFlowColumn[];
  groups: CashFlowGroup[];
};

/**
 * The Laporan Arus Kas, built: the book's movements placed in their cash-flow
 * group **now**, through Mapping Cash Flow — by Budget Category, or for an entry
 * carrying none (and for every Funding, one Intercompany line) by entry type.
 * Nothing about the group is stored, so remapping a category or reshaping the
 * groups restates every period. Group → Budget Category → Partner or
 * keterangan, each side gross; what no mapping places is *Belum Dikelompokkan*,
 * never dropped.
 */
export async function buildCashFlowReport(
  companyId: number,
  currencyId: number,
  columns: CashFlowColumn[]
): Promise<CashFlowReport> {
  const [data, mappings, groups, anak] = await Promise.all([
    cashFlowMovements([companyId], currencyId, columns),
    cashflowMappings(),
    prisma.sysCashflowGroup.findMany({ orderBy: [{ sort_order: "asc" }, { id: "asc" }] }),
    prisma.sysCompany.findFirst({ where: { is_parent: false }, select: { company_label: true } }),
  ]);
  const add = (into: number[], values: number[]) => values.forEach((v, i) => (into[i] = roundBase(into[i] + v)));
  const sides = new Map<string, { receipts: Map<string, CashFlowCategory>; payments: Map<string, CashFlowCategory> }>();

  for (const m of data.movements) {
    const funding = m.entryType === "Funding";
    const groupId = funding
      ? mappings.byType.get("Funding")
      : m.categoryId != null
        ? mappings.byCategory.get(m.categoryId)
        : mappings.byType.get(m.entryType);
    const groupKey = String(groupId ?? "none");
    if (!sides.has(groupKey)) sides.set(groupKey, { receipts: new Map(), payments: new Map() });
    const side = sides.get(groupKey)![m.side === "in" ? "receipts" : "payments"];

    const [categoryKey, categoryName] = funding
      ? ["intercompany", `Intercompany (${anak?.company_label ?? "anak"})`]
      : m.categoryId != null
        ? [`c:${m.categoryId}`, m.categoryLabel ?? ""]
        : [`t:${m.entryType}`, entryTypeLabel(m.entryType)];
    if (!side.has(categoryKey)) {
      side.set(categoryKey, { key: categoryKey, name: categoryName, values: columns.map(() => 0), children: [] });
    }
    const category = side.get(categoryKey)!;
    add(category.values, m.values);
    const leafName = m.partner ?? m.note ?? "Tanpa keterangan";
    const leafKey = `${m.partner ? "p" : "k"}:${leafName}`;
    let leaf = category.children.find((c) => c.key === leafKey);
    if (!leaf) category.children.push((leaf = { key: leafKey, name: leafName, values: columns.map(() => 0) }));
    add(leaf.values, m.values);
  }

  const ordered = (m?: Map<string, CashFlowCategory>) =>
    [...(m?.values() ?? [])]
      .sort((a, b) => Number(a.key === "intercompany") - Number(b.key === "intercompany") || a.name.localeCompare(b.name))
      .map((c) => ({ ...c, children: c.children.sort((a, b) => a.name.localeCompare(b.name)) }));
  const out: CashFlowGroup[] = groups
    .filter((g) => g.status === "Active" || sides.has(String(g.id)))
    .map((g) => ({
      id: g.id,
      name: g.group_name,
      receipts: ordered(sides.get(String(g.id))?.receipts),
      payments: ordered(sides.get(String(g.id))?.payments),
    }));
  const none = sides.get("none");
  if (none) out.push({ id: null, name: "Belum Dikelompokkan", receipts: ordered(none.receipts), payments: ordered(none.payments) });

  const { movements: _, ...totals } = data;
  void _;
  return { ...totals, columns, groups: out };
}
