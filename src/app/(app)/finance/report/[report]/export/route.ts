import { currentActor } from "@/lib/siba/auth";
import { actorCan } from "@/lib/siba/access";
import { cashBankLedgerReport } from "@/lib/siba/cash-bank";
import { cashBankLedgerWorkbook } from "@/lib/siba/cash-bank-export";
import { companyScope } from "@/lib/siba/company-access";
import { reportBySlug } from "@/lib/siba/reports";
import { parseIds, resolveRange } from "@/lib/siba/report-params";
import { xlsxResponse } from "@/lib/siba/statement-export";
import { formatDate, formatTimestamp } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Unduh XLSX for Buku Kas & Bank — the Finance twin of the Accounting export
 * route, the same Route Handler exception (CLAUDE.md §12). It reads the page's
 * own parameters through the page's own reader under the page's own
 * permission, so the file is the run on screen. A refusal says nothing about
 * why, like every denial.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> }
) {
  const { report: slug } = await params;
  const report = reportBySlug(slug);
  if (!report || report.module !== "finance" || report.key !== "cash_bank_ledger") {
    return new Response("Tidak ditemukan", { status: 404 });
  }

  const actor = await currentActor();
  if (!actor) return new Response("Silakan masuk kembali", { status: 401 });
  if (!actorCan(actor, report.permission)) return new Response("Akses ditolak", { status: 403 });

  const query = Object.fromEntries(new URL(request.url).searchParams);
  const company = (await companyScope(actor.permissions, query.company)).selected;
  if (!company) return new Response("Akses ditolak", { status: 403 });

  const ids = parseIds(query.cashBank);
  if (!ids.length) return new Response("Pilih Cash & Bank terlebih dahulu", { status: 400 });
  const range = resolveRange(query.from, query.to);
  const books = (
    await Promise.all(ids.map((id) => cashBankLedgerReport(id, range, [company.id])))
  ).filter((b) => b !== null);
  if (!books.length) return new Response("Tidak ditemukan", { status: 404 });

  const notes = [
    `Saldo awal adalah seluruh mutasi sebelum ${formatDate(range.from)} dan bukan entri tersendiri, sehingga tidak muncul sebagai baris.`,
  ];
  const off = books.filter((b) => !b.reconciles).map((b) => b.resource.label);
  if (off.length) notes.push(`Saldo tersimpan tidak cocok dengan jumlah mutasi pada ${off.join(", ")}; perlu diperiksa.`);

  const file = await cashBankLedgerWorkbook({
    companyName: company.name,
    range,
    books,
    footnotes: notes,
    printedBy: actor.user.name,
    printedAt: formatTimestamp(new Date()),
  });
  return xlsxResponse(file, `${report.name} ${company.label} ${range.from} - ${range.to}.xlsx`);
}
