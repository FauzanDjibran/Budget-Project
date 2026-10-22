import "server-only";

import ExcelJS from "exceljs";
import { formatDate } from "@/lib/format";
import { isBaseCurrency } from "./currency";
import type { SubledgerBalanceReport } from "./subledger";
import { BAND, MUTED, SOFT, bookSheet, fill, font } from "./book-export";
import { double, thin } from "./statement-export";

/**
 * Saldo Buku Subjek as an A4 portrait workbook — its Unduh XLSX, on the page
 * the book exports print on. One block per Partner and currency holding its
 * open items, each with the kurs it was raised at (a dash on a rupiah item)
 * and its own Saldo Awal, Bertambah, Berkurang and Saldo; a Jumlah per block
 * that equals the Partner's line in Buku Subjek, and a closing total per
 * currency, never added across. Face currency only, on the user's
 * instruction. Plain values only, like every export.
 */

export type SubledgerBalanceExport = {
  companyName: string;
  report: SubledgerBalanceReport;
  footnotes: string[];
  printedBy: string;
  printedAt: string;
};

const LAST = 8;
// formatRate's two-to-six decimals.
const RATE = "#,##0.00####";

export async function subledgerBalanceWorkbook(s: SubledgerBalanceExport): Promise<Buffer> {
  const { book, range, groups } = s.report;
  // A book that only accumulates keeps its items as a record, not as open items.
  const noun = book.nature === "cumulative" ? "Rincian" : "Open Item";
  const { wb, ws } = bookSheet({
    title: `Saldo ${book.name}`,
    measure: "(Dinyatakan dalam mata uang masing-masing posisi)",
    companyName: s.companyName,
    range,
    headers: ["Tanggal", noun, "Keterangan", "Kurs", "Saldo Awal", "Bertambah", "Berkurang", "Saldo"],
    widths: [10, 10, 30, 11, 15, 15, 15, 15],
    textCols: 3,
    printedBy: s.printedBy,
    printedAt: s.printedAt,
  });

  let r = 9;
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
  // The code rides on every figure, so a cell copied out still says what it is.
  const figures = (currency: string, v: number[], o: Partial<ExcelJS.Font> = {}) =>
    v.forEach((n, j) => {
      const c = ws.getCell(r, 5 + j);
      c.value = n;
      c.numFmt = `"${currency}" #,##0.00;("${currency}" #,##0.00);"-"`;
      c.font = font(o);
      c.alignment = { vertical: "top" };
    });

  for (const g of groups) {
    for (const p of g.rows) {
      band(BAND);
      text(1, p.label, { bold: true, size: 9 });
      text(3, p.name, { bold: true, size: 9.5 });
      const aside = text(LAST, `${p.categoryLabel}${p.active ? "" : " · non-aktif"} · Mata uang: ${p.currencyLabel}`, {
        size: 8,
        color: { argb: "FF555555" },
      });
      aside.alignment = { horizontal: "right" };
      r++;

      const foreign = !isBaseCurrency(p.currencyLabel);
      for (const i of p.items) {
        text(1, formatDate(i.date));
        text(2, i.itemNo, { size: 8 });
        text(3, i.note ?? "—", {}, true);
        const k = ws.getCell(r, 4);
        k.value = foreign ? i.rate : "-";
        k.numFmt = RATE;
        k.font = font();
        k.alignment = { horizontal: "right", vertical: "top" };
        figures(p.currencyLabel, [i.opening, i.raised, i.lowered, i.closing]);
        r++;
      }
      if (!p.items.length) {
        text(3, `Tidak ada ${noun.toLowerCase()} dalam periode ini.`, { italic: true, color: MUTED });
        r++;
      }

      band(SOFT, double);
      text(3, "Jumlah", { bold: true });
      figures(p.currencyLabel, [p.opening, p.raised, p.lowered, p.closing], { bold: true });
      r += 3;
    }
  }

  if (groups.length) {
    text(1, "JUMLAH PER MATA UANG", { bold: true });
    r++;
    for (const g of groups) {
      text(3, g.currencyLabel, { bold: true });
      figures(g.currencyLabel, [g.opening, g.raised, g.lowered, g.closing], { bold: true });
      for (let j = 3; j <= LAST; j++) ws.getCell(r, j).border = { bottom: thin };
      r++;
    }
    r += 2;
  }

  for (const note of s.footnotes) {
    const c = ws.getCell(r++, 1);
    c.value = note;
    c.font = font({ size: 7.5, italic: true, color: MUTED });
  }
  ws.pageSetup.printArea = `A1:H${Math.max(r - 1, 7)}`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
