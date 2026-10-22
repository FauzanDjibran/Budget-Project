import "server-only";

import ExcelJS from "exceljs";
import type { BalanceReport } from "./cash-bank";
import { BAND, HEAD, MUTED, SOFT, bookSheet, fill, font } from "./book-export";
import { double, thin } from "./statement-export";

/**
 * Saldo Kas & Bank as an A4 portrait workbook — its Unduh XLSX, on the page the
 * book exports print on. One block per currency, as on screen: a row per Cash &
 * Bank with Saldo Awal, Penerimaan, Pengeluaran and Saldo Akhir, closed by a
 * Jumlah that is that currency's total. Currencies are never added together and
 * no base figure is printed, like Buku Kas & Bank. Plain values only.
 */

export type CashBankBalanceExport = {
  companyName: string;
  report: BalanceReport;
  footnotes: string[];
  printedBy: string;
  printedAt: string;
};

const LAST = 6;

export async function cashBankBalanceWorkbook(s: CashBankBalanceExport): Promise<Buffer> {
  const { wb, ws } = bookSheet({
    title: "Saldo Kas & Bank",
    measure: "(Dinyatakan dalam mata uang masing-masing Cash & Bank)",
    companyName: s.companyName,
    range: s.report.range,
    headers: ["Kode", "Cash & Bank", "Saldo Awal", "Penerimaan", "Pengeluaran", "Saldo Akhir"],
    widths: [10, 40, 17, 17, 17, 17],
    textCols: 2,
    printedBy: s.printedBy,
    printedAt: s.printedAt,
  });

  let r = HEAD + 2;
  const text = (col: number, v: string, o: Partial<ExcelJS.Font> = {}) => {
    const c = ws.getCell(r, col);
    c.value = v;
    c.font = font(o);
    c.alignment = { vertical: "top", wrapText: col === 2 };
    return c;
  };
  const band = (argb: string, bottom?: Partial<ExcelJS.Border>) => {
    for (let j = 1; j <= LAST; j++) {
      const c = ws.getCell(r, j);
      c.fill = fill(argb);
      if (bottom) c.border = { top: thin, bottom };
    }
  };

  for (const g of s.report.groups) {
    // The code rides on every figure, so a cell copied out still says what it is.
    const figures = (v: number[], o: Partial<ExcelJS.Font> = {}) =>
      v.forEach((n, j) => {
        const c = ws.getCell(r, 3 + j);
        c.value = n;
        c.numFmt = `"${g.currencyLabel}" #,##0.00;("${g.currencyLabel}" #,##0.00);"-"`;
        c.font = font(o);
        c.alignment = { vertical: "top" };
      });

    band(BAND);
    text(1, g.currencyLabel, { bold: true, size: 9.5 });
    const aside = text(LAST, `${g.rows.length} Cash & Bank`, { size: 8, color: { argb: "FF555555" } });
    aside.alignment = { horizontal: "right" };
    r++;

    for (const row of g.rows) {
      text(1, row.label, { size: 8 });
      text(2, `${row.name} · ${row.type}${row.active ? "" : " · non-aktif"}`);
      figures([row.opening, row.totalIn, row.totalOut, row.closing]);
      r++;
    }

    band(SOFT, double);
    text(2, `Jumlah ${g.currencyLabel}`, { bold: true });
    figures([g.opening, g.totalIn, g.totalOut, g.closing], { bold: true });
    r += 3;
  }

  if (!s.report.groups.length) {
    text(2, "Tidak ada Cash & Bank untuk dilaporkan.", { italic: true, color: MUTED });
    r += 3;
  }

  for (const note of s.footnotes) {
    const c = ws.getCell(r++, 1);
    c.value = note;
    c.font = font({ size: 7.5, italic: true, color: MUTED });
  }
  ws.pageSetup.printArea = `A1:F${Math.max(r - 1, HEAD)}`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
