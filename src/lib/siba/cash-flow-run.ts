import "server-only";

import { prisma } from "@/lib/prisma";
import type { CashFlowColumn } from "./cash-bank";
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
