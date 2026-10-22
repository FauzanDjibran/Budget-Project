import { currentActor } from "@/lib/siba/auth";
import { actorCan } from "@/lib/siba/access";
import { companyScope } from "@/lib/siba/company-access";
import { carriedYearsBefore, reportableFiscalYears } from "@/lib/siba/fiscal";
import { reportBySlug } from "@/lib/siba/reports";
import { STATEMENT_MODES, type StatementRow } from "@/lib/siba/statement-layout";
import { statementWorkbook } from "@/lib/siba/statement-export";
import {
  balanceSheetReport,
  profitLossReport,
  resolveStatementRun,
  type StatementColumn,
} from "@/lib/siba/statements";
import { formatDate, formatMoney, formatTimestamp } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Unduh XLSX for the Laba Rugi and the Neraca.
 *
 * A file download, which a Server Action cannot return — the second instance of
 * the Route Handler exception CLAUDE.md §12 reserves for report export. It takes
 * the page's own parameters and asks the page's own permission, then reads the
 * statement through the same functions the page does, so the file is the run
 * on screen. A refusal says nothing about why, like every denial.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> }
) {
  const { report: slug } = await params;
  const report = reportBySlug(slug);
  if (!report || report.module !== "accounting" || report.params !== "fiscal-period") {
    return new Response("Tidak ditemukan", { status: 404 });
  }

  const actor = await currentActor();
  if (!actor) return new Response("Silakan masuk kembali", { status: 401 });
  if (!actorCan(actor, report.permission)) return new Response("Akses ditolak", { status: 403 });

  const query = Object.fromEntries(new URL(request.url).searchParams);
  const company = (await companyScope(actor.permissions, query.company)).selected;
  if (!company) return new Response("Akses ditolak", { status: 403 });

  const years = await reportableFiscalYears(company.id);
  if (!years.length) return new Response("Belum ada tahun buku aktif", { status: 404 });

  const neraca = report.key === "balance_sheet";
  const { mode, main, compare } = resolveStatementRun(years, query, neraca);
  const columns = compare ? [main, compare] : [main];

  const latestStart = columns.map((c) => c.range.from).sort().at(-1)!;
  const carried = await carriedYearsBefore(company.id, latestStart);
  const notes: string[] = [];
  if (carried.length) {
    notes.push(`${carried.map((y) => y.name).join(", ")} belum ditutup untuk Company ini.`);
  }

  const dates = (c: StatementColumn) =>
    neraca ? formatDate(c.range.to) : `${formatDate(c.range.from)} – ${formatDate(c.range.to)}`;
  const span = (c: StatementColumn) =>
    neraca ? `per ${formatDate(c.range.to)}` : `${formatDate(c.range.from)} s.d. ${formatDate(c.range.to)}`;
  const subtitle =
    (neraca ? `Per ${formatDate(main.range.to)}` : `Untuk periode ${span(main)} (${STATEMENT_MODES.find((m) => m.value === mode)!.label})`) +
    (compare ? `, dibandingkan dengan ${span(compare)}` : "");

  let rows: StatementRow[];
  let grandTotal: (r: StatementRow) => boolean;
  if (neraca) {
    const data = await balanceSheetReport(company, columns, years);
    if (!data.ok) {
      return new Response(`Neraca tidak dapat dibuat. Belum diatur: ${data.missing.join(", ")}.`, { status: 409 });
    }
    rows = data.rows;
    const same = (a: number[], b: number[]) => a.every((v, i) => Math.round(v * 100) === Math.round(b[i] * 100));
    grandTotal = (r) =>
      r.kind === "subtotal" && (same(r.values, data.debitTotal) || same(r.values, data.creditTotal));
    if (rows.some((r) => r.computed)) {
      notes.unshift(
        "* Dihitung dari journal, bukan diposting: Laba/Rugi Tahun Berjalan sejak awal tahun buku s.d. akhir periode kolom, dan laba rugi tiap tahun yang belum ditutup."
      );
    }
    data.columns.forEach((c, i) => {
      const gap = Math.abs(data.debitTotal[i] - data.creditTotal[i]);
      if (Math.round(gap * 100) !== 0) notes.push(`Aktiva tidak sama dengan Pasiva dan Ekuitas per ${formatDate(c.range.to)}: selisih ${formatMoney(gap)}.`);
    });
    const opening = data.openingFrom.find(Boolean);
    if (opening) notes.push(`Saldo awal diambil dari Opening Balance ${opening.openingNo} per ${formatDate(opening.date)}.`);
  } else {
    const data = await profitLossReport(company.id, columns);
    rows = data.rows;
    const last = rows.at(-1)?.key;
    grandTotal = (r) => r.key === last;
    notes.push("Tidak termasuk journal penutupan tahun buku kolom itu sendiri.");
  }

  const file = await statementWorkbook({
    companyName: company.name,
    title: neraca ? "LAPORAN POSISI KEUANGAN (NERACA)" : "LAPORAN LABA RUGI",
    subtitle,
    pageTitle: `${report.name} · ${span(main)}`,
    columns: compare
      ? [{ role: "Periode Ini", dates: dates(main) }, { role: "Pembanding", dates: dates(compare) }]
      : [{ role: neraca ? "Saldo" : "Periode Ini", dates: dates(main) }],
    rows,
    grandTotal,
    footnotes: notes,
    printedBy: actor.user.name,
    printedAt: formatTimestamp(new Date()),
  });

  const name = `${report.name} ${company.label} ${main.range.to}${compare ? ` vs ${compare.range.to}` : ""}.xlsx`;
  return new Response(new Uint8Array(file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    },
  });
}
