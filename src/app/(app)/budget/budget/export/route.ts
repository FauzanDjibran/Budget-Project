import { currentActor } from "@/lib/siba/auth";
import { actorCan } from "@/lib/siba/access";
import { accessibleCompanies } from "@/lib/siba/company-access";
import { budgetRefs, budgetsByIds } from "@/lib/siba/budget";
import { cashBookSummary } from "@/lib/siba/cash-bank";
import { pengajuanWorkbook } from "@/lib/siba/budget-export";
import { formatDate, formatTimestamp, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Unduh XLSX for Laporan Pengajuan — the Budgets ticked in the picker
 * (`?ids=3,7,12`), against the cash the reader's Companies hold now.
 *
 * A file download, so a Route Handler (CLAUDE.md §12). The ids come from the
 * client and are not trusted: only Submitted Budgets of a Company the reader
 * may see are printed.
 */
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return new Response("Silakan masuk kembali", { status: 401 });
  if (!actorCan(actor, "BUDGET_VIEW")) return new Response("Akses ditolak", { status: 403 });

  const companies = await accessibleCompanies(actor.permissions);
  const companyIds = companies.map((c) => c.id);
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  const [found, refs, cash] = await Promise.all([budgetsByIds(ids), budgetRefs(), cashBookSummary(companyIds)]);
  const budgets = found
    .filter((b) => b.status === "Submitted" && companyIds.includes(b.company_id))
    .sort((a, b) => a.budget_date.localeCompare(b.budget_date) || a.budget_no.localeCompare(b.budget_no));
  if (!budgets.length) return new Response("Tidak ada budget berstatus Diajukan untuk dilaporkan", { status: 409 });

  const currency = new Map(refs.currencies.map((c) => [c.id, c]));
  const company = new Map(refs.companies.map((c) => [c.id, c.label]));
  const currencyIds = [...new Set([...cash.rows.map((r) => r.currencyId), ...budgets.map((b) => b.currency_id)])]
    .map((id) => currency.get(id)!)
    .sort((a, b) => (a.label === "IDR" ? -1 : b.label === "IDR" ? 1 : a.label.localeCompare(b.label)));

  const today = todayIso();
  const file = await pengajuanWorkbook({
    companyName: companies.map((c) => c.label).join(" & "),
    subtitle: `Diajukan per ${formatDate(today)}`,
    sections: currencyIds.map((cur) => ({
      heading: `${cur.name.toUpperCase()} (${cur.label})`,
      currency: cur.label,
      cash: cash.rows
        .filter((r) => r.currencyId === cur.id)
        .map((r) => ({ name: r.name, company: r.companyLabel, balance: r.balance })),
      budgets: budgets
        .filter((b) => b.currency_id === cur.id)
        .map((b) => ({
          no: b.budget_no,
          date: formatDate(b.budget_date),
          description: b.description,
          company: company.get(b.company_id) ?? "",
          type: b.budget_type,
          amount: b.budget_amount,
        })),
    })),
    footnotes: ["Saldo Kas & Bank dibaca dari Cash Bank Book saat dicetak. Tiap currency direkap terpisah, tidak dikonversi."],
    printedBy: actor.user.name,
    printedAt: formatTimestamp(new Date()),
  });

  return new Response(new Uint8Array(file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Laporan Pengajuan Budget ${today}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
