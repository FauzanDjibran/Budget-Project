import { currentActor } from "@/lib/siba/auth";
import { actorCan } from "@/lib/siba/access";
import { cashBankBalanceReport, cashBankLedgerReport } from "@/lib/siba/cash-bank";
import { cashBankBalanceWorkbook } from "@/lib/siba/cash-bank-balance-export";
import { cashBankLayerWorkbook } from "@/lib/siba/cash-bank-layer-export";
import { layerReport } from "@/lib/siba/cash-bank-layers";
import { attachDocumentNumbers } from "@/lib/siba/document-numbers";
import { cashBankLedgerWorkbook } from "@/lib/siba/cash-bank-export";
import { companyScope } from "@/lib/siba/company-access";
import { reportBySlug } from "@/lib/siba/reports";
import { parseIds, resolveRange } from "@/lib/siba/report-params";
import { xlsxResponse } from "@/lib/siba/statement-export";
import { subledgerBalanceReport, subledgerReport } from "@/lib/siba/subledger-reports";
import { subledgerBalanceWorkbook } from "@/lib/siba/subledger-balance-export";
import { loadSubledgers } from "@/lib/siba/subledger-data";
import { subledgerWorkbook } from "@/lib/siba/subledger-export";
import { formatDate, formatTimestamp, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Unduh XLSX for Buku Kas & Bank, Saldo Kas & Bank, Posisi Layer Kurs, Buku Subjek and Saldo Buku Subjek — the Finance twin of the
 * Accounting export route, the same Route Handler exception (CLAUDE.md §12).
 * It reads the page's own parameters through the page's own reader under the
 * page's own permission, so the file is the run on screen. A refusal says
 * nothing about why, like every denial.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> }
) {
  const { report: slug } = await params;
  const report = reportBySlug(slug);
  if (
    !report ||
    report.module !== "finance" ||
    !["cash_bank_ledger", "cash_bank_balance", "cash_bank_layer", "subledger", "subledger_balance"].includes(report.key)
  ) {
    return new Response("Tidak ditemukan", { status: 404 });
  }

  const actor = await currentActor();
  if (!actor) return new Response("Silakan masuk kembali", { status: 401 });
  if (!actorCan(actor, report.permission)) return new Response("Akses ditolak", { status: 403 });

  const query = Object.fromEntries(new URL(request.url).searchParams);
  const company = (await companyScope(actor.permissions, query.company)).selected;
  if (!company) return new Response("Akses ditolak", { status: 403 });
  const range = resolveRange(query.from, query.to);
  const printed = { printedBy: actor.user.name, printedAt: formatTimestamp(new Date()) };

  if (report.key === "subledger_balance") {
    const books = await loadSubledgers();
    const data = await subledgerBalanceReport(books, query.book ?? "", range, {
      partnerIds: parseIds(query.partners),
      companyIds: [company.id],
    });
    if (!data) return new Response("Tidak ditemukan", { status: 404 });

    const notes = [
      data.book.nature === "cumulative"
        ? "Buku ini hanya bertambah; rinciannya mencatat setiap realisasi per Partner, pada kursnya sendiri."
        : `Saldo akhir setiap Partner adalah jumlah sisa open item-nya per ${formatDate(range.to)}, masing-masing pada kurs saat item itu dibuka.`,
    ];
    const off = data.groups.flatMap((g) => g.rows).filter((r) => !r.reconciles).map((r) => `${r.label} (${r.currencyLabel})`);
    if (off.length) notes.push(`Posisi tersimpan tidak cocok dengan jumlah entri pada ${off.join(", ")}; perlu diperiksa.`);

    const file = await subledgerBalanceWorkbook({ companyName: company.name, report: data, footnotes: notes, ...printed });
    return xlsxResponse(file, `Saldo ${data.book.name} ${company.label} ${range.from} - ${range.to}.xlsx`);
  }

  if (report.key === "subledger") {
    const books = await loadSubledgers();
    const data = await subledgerReport(books, query.book ?? "", range, {
      partnerIds: parseIds(query.partners),
      companyIds: [company.id],
    });
    if (!data) return new Response("Tidak ditemukan", { status: 404 });
    await attachDocumentNumbers(data.subjects.flatMap((s) => s.entries));

    const notes = [
      `Kolom Bertambah dan Berkurang mengikuti arah buku ini, bukan arah uang: ${data.book.closingLabel.toLowerCase()} bertambah saat ${data.book.raises === "In" ? "uang masuk" : "uang keluar"}.`,
    ];
    const off = data.subjects.filter((s) => !s.reconciles).map((s) => `${s.label} (${s.currencyLabel})`);
    if (off.length) notes.push(`Posisi tersimpan tidak cocok dengan jumlah entri pada ${off.join(", ")}; perlu diperiksa.`);

    const file = await subledgerWorkbook({ companyName: company.name, report: data, footnotes: notes, ...printed });
    return xlsxResponse(file, `${data.book.name} ${company.label} ${range.from} - ${range.to}.xlsx`);
  }

  const ids = parseIds(query.cashBank);

  if (report.key === "cash_bank_layer") {
    const data = await layerReport([company.id], ids);
    const asOf = todayIso();
    const notes = ["Kurs pada baris total adalah kurs rata-rata layer terbuka — hanya informasi, tidak dipakai untuk menilai apa pun."];
    const off = data.blocks.filter((b) => !b.reconciles).map((b) => b.label);
    if (off.length) notes.push(`Jumlah layer terbuka tidak sama dengan saldo buku pada ${off.join(", ")}; perlu diperiksa.`);
    const file = await cashBankLayerWorkbook({ companyName: company.name, asOf, report: data, footnotes: notes, ...printed });
    return xlsxResponse(file, `${report.name} ${company.label} ${asOf}.xlsx`);
  }

  if (report.key === "cash_bank_balance") {
    const data = await cashBankBalanceReport(range, [company.id], ids);
    const notes = ["Setiap mata uang direkap terpisah dan tidak pernah dijumlahkan menjadi satu angka."];
    const file = await cashBankBalanceWorkbook({ companyName: company.name, report: data, footnotes: notes, ...printed });
    return xlsxResponse(file, `${report.name} ${company.label} ${range.from} - ${range.to}.xlsx`);
  }

  if (!ids.length) return new Response("Pilih Cash & Bank terlebih dahulu", { status: 400 });
  const books = (
    await Promise.all(ids.map((id) => cashBankLedgerReport(id, range, [company.id])))
  ).filter((b) => b !== null);
  if (!books.length) return new Response("Tidak ditemukan", { status: 404 });
  await attachDocumentNumbers(books.flatMap((b) => b.entries));

  const notes = [
    `Saldo awal adalah seluruh mutasi sebelum ${formatDate(range.from)} dan bukan entri tersendiri, sehingga tidak muncul sebagai baris.`,
  ];
  const off = books.filter((b) => !b.reconciles).map((b) => b.resource.label);
  if (off.length) notes.push(`Saldo tersimpan tidak cocok dengan jumlah mutasi pada ${off.join(", ")}; perlu diperiksa.`);

  const file = await cashBankLedgerWorkbook({ companyName: company.name, range, books, footnotes: notes, ...printed });
  return xlsxResponse(file, `${report.name} ${company.label} ${range.from} - ${range.to}.xlsx`);
}
