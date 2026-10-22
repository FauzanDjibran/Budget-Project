import "server-only";

import ExcelJS from "exceljs";
import { formatDate } from "@/lib/format";
import type { LayerReport } from "./cash-bank-layers";
import { BAND, HEAD, MUTED, SOFT, bookSheet, fill, font } from "./book-export";
import { BASE_CURRENCY_LABEL } from "./currency";
import { double, thin } from "./statement-export";

/**
 * Posisi Layer Kurs as an A4 portrait workbook — its Unduh XLSX, on the page the
 * book exports print on. One block per foreign Cash & Bank, as on screen: its
 * open layers with the keterangan as stored, kurs, what was acquired, what is
 * left and its rupiah value at the layer's own kurs, closed by the open total
 * and the average kurs. A standing position, so it is dated *per* today rather
 * than over a period. Currencies are never added together. Plain values only.
 */

export type CashBankLayerExport = {
  companyName: string;
  asOf: string;
  report: LayerReport;
  footnotes: string[];
  printedBy: string;
  printedAt: string;
};

const LAST = 7;
const RATE = "#,##0.00####";

export async function cashBankLayerWorkbook(s: CashBankLayerExport): Promise<Buffer> {
  const { wb, ws } = bookSheet({
    title: "Posisi Layer Kurs",
    measure: `(Sisa dalam mata uang Cash & Bank; nilai dalam ${BASE_CURRENCY_LABEL} pada kurs perolehan layer)`,
    companyName: s.companyName,
    range: { from: s.asOf, to: s.asOf },
    period: `Per ${formatDate(s.asOf)}`,
    headers: ["Perolehan", "Layer", "Keterangan", "Kurs", "Diperoleh", "Sisa", `Nilai ${BASE_CURRENCY_LABEL}`],
    widths: [10, 11, 35, 13, 16, 16, 18],
    textCols: 3,
    printedBy: s.printedBy,
    printedAt: s.printedAt,
  });

  let r = HEAD + 2;
  const text = (col: number, v: string, o: Partial<ExcelJS.Font> = {}, wrap = false) => {
    const c = ws.getCell(r, col);
    c.value = v;
    c.font = font(o);
    c.alignment = { vertical: "top", wrapText: wrap };
    return c;
  };
  const band = (argb: string, bottom?: Partial<ExcelJS.Border>) => {
    for (let j = 1; j <= LAST; j++) {
      const c = ws.getCell(r, j);
      c.fill = fill(argb);
      if (bottom) c.border = { top: thin, bottom };
    }
  };
  const figure = (col: number, v: number | null, numFmt: string, o: Partial<ExcelJS.Font> = {}) => {
    const c = ws.getCell(r, col);
    c.value = v;
    c.numFmt = numFmt;
    c.font = font(o);
    c.alignment = { vertical: "top" };
  };
  // The code rides on every figure, so a cell copied out still says what it is.
  const money = (code: string) => `"${code}" #,##0.00;("${code}" #,##0.00);"-"`;
  const base = money(BASE_CURRENCY_LABEL);

  for (const b of s.report.blocks) {
    const fx = money(b.currencyLabel);

    band(BAND);
    text(1, b.label, { bold: true, size: 9 });
    text(3, `${b.name}${b.active ? "" : " · non-aktif"}`, { bold: true, size: 9.5 });
    const aside = text(LAST, `Mata uang ${b.currencyLabel}`, { size: 8, color: { argb: "FF555555" } });
    aside.alignment = { horizontal: "right" };
    r++;

    for (const l of b.layers) {
      text(1, formatDate(l.date));
      text(2, l.layerNo, { size: 8 });
      text(3, l.note ?? "—", {}, true);
      figure(4, l.rate, RATE);
      figure(5, l.foreignOriginal, fx);
      figure(6, l.foreignRemaining, fx);
      figure(7, l.baseRemaining, base);
      r++;
    }
    if (!b.layers.length) {
      text(3, "Tidak ada layer terbuka.", { italic: true, color: MUTED });
      r++;
    }

    band(SOFT, double);
    text(3, "Total layer terbuka", { bold: true });
    figure(4, b.averageRate, RATE, { bold: true });
    figure(6, b.foreignRemaining, fx, { bold: true });
    figure(7, b.baseRemaining, base, { bold: true });
    r += 3;
  }

  if (!s.report.blocks.length) {
    text(3, "Tidak ada Cash & Bank mata uang asing untuk dilaporkan.", { italic: true, color: MUTED });
    r += 3;
  }

  for (const note of s.footnotes) {
    const c = ws.getCell(r++, 1);
    c.value = note;
    c.font = font({ size: 7.5, italic: true, color: MUTED });
  }
  ws.pageSetup.printArea = `A1:G${Math.max(r - 1, HEAD)}`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
