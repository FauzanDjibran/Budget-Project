import "server-only";

import { BAND, HEAD, MUTED, SOFT, bookSheet, fill, font } from "./book-export";
import type { CashFlowCategory, CashFlowReport } from "./cash-flow-run";
import { double, thin } from "./statement-export";

/**
 * The Laporan Arus Kas as an A4 workbook of plain values, the run on screen
 * printed fully open: Saldo Awal, per group its Penerimaan, Pengeluaran in
 * brackets and Arus Kas Neto — each Budget Category with its Partners or
 * keterangan beneath it — then the net change and Saldo Akhir. Portrait to
 * four periods, landscape beyond, fitted to the page's width either way.
 */
export async function cashFlowWorkbook(s: {
  companyName: string;
  period: string;
  report: CashFlowReport;
  printedBy: string;
  printedAt: string;
}): Promise<Buffer> {
  const r = s.report;
  const n = r.columns.length;
  const { wb, ws } = bookSheet({
    title: `Laporan Arus Kas ${r.currencyLabel}`,
    measure: `(Metode langsung · dinyatakan dalam ${r.currencyLabel === "IDR" ? "Rupiah" : r.currencyLabel}, tidak dikonversi)`,
    companyName: s.companyName,
    range: { from: r.columns[0]?.from ?? "", to: r.columns[n - 1]?.to ?? "" },
    period: s.period,
    headers: ["Keterangan", ...r.columns.map((c) => c.label), "Jumlah"],
    widths: [48, ...Array(n + 1).fill(17)],
    textCols: 1,
    printedBy: s.printedBy,
    printedAt: s.printedAt,
  });
  if (n > 4) ws.pageSetup.orientation = "landscape";

  const fmt = `#,##0.00;(#,##0.00);"-"`;
  const last = n + 2;
  let row = HEAD + 2;
  const sum = (rows: CashFlowCategory[]) => r.columns.map((_, i) => rows.reduce((t, x) => t + x.values[i], 0));
  const withTotal = (v: number[]) => [...v, v.reduce((t, x) => t + x, 0)];
  const put = (
    text: string,
    values: number[] | null,
    o: { bold?: boolean; italic?: boolean; indent?: number; band?: string; border?: "top" | "result" } = {}
  ) => {
    const name = ws.getCell(row, 1);
    name.value = text;
    name.font = font({ bold: o.bold, italic: o.italic });
    name.alignment = { indent: o.indent ?? 0 };
    for (let j = 1; j <= last; j++) {
      const c = ws.getCell(row, j);
      if (o.band) c.fill = fill(o.band);
      if (o.border === "top") c.border = { top: thin };
      if (o.border === "result") c.border = { top: thin, bottom: double };
      if (j > 1 && values) {
        c.value = values[j - 2];
        c.numFmt = fmt;
        c.font = font({ bold: o.bold });
      }
    }
    row++;
  };

  put(`SALDO AWAL KAS & BANK (${r.currencyLabel})`, [...r.opening, r.opening[0] ?? 0], { bold: true, band: SOFT, border: "top" });
  row++;
  let net = r.columns.map(() => 0);
  for (const g of r.groups) {
    put(`ARUS KAS DARI AKTIVITAS ${g.name.toUpperCase()}`, null, { bold: true, band: BAND });
    for (const [title, rows] of [["Penerimaan", g.receipts], ["Pengeluaran", g.payments]] as const) {
      if (!rows.length) continue;
      put(title, null, { italic: true, indent: 1 });
      for (const c of rows) {
        put(c.name, withTotal(c.values), { bold: true, indent: 2 });
        for (const leaf of c.children) put(leaf.name, withTotal(leaf.values), { indent: 3 });
      }
      put(`Jumlah ${title}`, withTotal(sum(rows)), { indent: 1, border: "top" });
    }
    const groupNet = sum([...g.receipts, ...g.payments]);
    put(`Arus Kas Neto dari Aktivitas ${g.name}`, withTotal(groupNet), { bold: true, border: "top" });
    net = net.map((v, i) => v + groupNet[i]);
    row++;
  }
  if (r.registered.some((v) => v !== 0)) {
    put("Saldo awal rekening baru", withTotal(r.registered));
    net = net.map((v, i) => v + r.registered[i]);
  }
  put("KENAIKAN (PENURUNAN) NETO KAS & BANK", withTotal(net), { bold: true, border: "top" });
  put(`SALDO AKHIR KAS & BANK (${r.currencyLabel})`, [...r.closing, r.closing[n - 1] ?? 0], {
    bold: true,
    band: SOFT,
    border: "result",
  });
  row++;
  for (const note of [
    "Saldo Awal + Kenaikan (Penurunan) Neto = Saldo Akhir pada setiap kolom. Pengeluaran ditulis dalam kurung.",
    "Transfer antar Cash & Bank sendiri dan revaluasi kurs bukan arus kas, sehingga tidak dicantumkan.",
  ]) {
    const c = ws.getCell(row++, 1);
    c.value = note;
    c.font = font({ size: 7.5, italic: true, color: MUTED });
  }
  ws.pageSetup.printArea = `A1:${ws.getColumn(last).letter}${row - 1}`;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
