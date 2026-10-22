import "server-only";

import ExcelJS from "exceljs";
import { formatDate } from "@/lib/format";
import type { PeriodRange } from "./period";
import { FONT, double, esc, thin } from "./statement-export";

/**
 * An operational book as an A4 portrait workbook — the layout Buku Kas & Bank
 * and Buku Subjek share, so the two print alike.
 *
 * A book the way one is printed everywhere, stacked one block per subject like
 * the General Ledger export: the subject and its currency on the block's band,
 * Saldo Awal carried in, every movement by date with its entry number, the two
 * movement columns, and a Saldo Akhir line that reconciles on the page (§10
 * rule 40). Every figure is in the block's own currency and carries its code,
 * so a USD block and a rupiah one cannot be read as one scale; nothing is
 * totalled across them. No per-row Saldo: an entry may be backdated (§12).
 * Plain values only, like every export.
 */

export type BookRow = {
  date: string;
  entryNo: string;
  text: string;
  in: number | null;
  out: number | null;
};

export type BookBlock = {
  code: string;
  name: string;
  /** Right-aligned on the band; ends with the currency. */
  aside: string;
  currencyLabel: string;
  opening: number;
  rows: BookRow[];
  totalIn: number;
  totalOut: number;
  closing: number;
};

export type BookExport = {
  title: string;
  /** The italic line under the period, saying which measure the figures are in. */
  measure: string;
  columns: [string, string];
  companyName: string;
  range: PeriodRange;
  blocks: BookBlock[];
  footnotes: string[];
  printedBy: string;
  printedAt: string;
};

export const HEAD = 7;
export const BAND = "FFEDF0F5";
export const SOFT = "FFF4F6F9";
export const MUTED = { argb: "FF666666" };
export const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
export const font = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: FONT, size: 8.5, ...o });

/**
 * The page every book-shaped export prints on: A4 portrait fitted to width, the
 * company and title block, the column heading on row HEAD repeated on every
 * page, and the shared footer. The first `textCols` columns are left-aligned.
 */
export function bookSheet(s: {
  title: string;
  measure: string;
  companyName: string;
  range: PeriodRange;
  /** Replaces the period line, for a report of a standing position. */
  period?: string;
  headers: string[];
  widths: number[];
  textCols: number;
  printedBy: string;
  printedAt: string;
}) {
  const period = s.period ?? `Untuk periode ${formatDate(s.range.from)} s.d. ${formatDate(s.range.to)}`;
  const last = s.headers.length;

  const footer = `&L&"${FONT}"&7SIBA 3.0 · dicetak ${esc(s.printedAt)} oleh ${esc(s.printedBy)}&R&"${FONT}"&7Halaman &P dari &N`;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SIBA 3.0";
  wb.title = `${s.title} ${s.companyName}`;
  // Excel refuses a sheet name longer than 31 characters.
  const ws = wb.addWorksheet(s.title.slice(0, 31), {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      printTitlesRow: `${HEAD}:${HEAD}`,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
    },
    headerFooter: {
      differentFirst: true,
      oddHeader: `&L&"${FONT},Bold"&8${esc(s.companyName)}&R&"${FONT}"&8${esc(s.title)} · ${esc(period)}`,
      oddFooter: footer,
      firstFooter: footer,
    },
  });
  ws.columns = s.widths.map((width) => ({ width }));

  const titleLine = (r: number, text: string, f: Partial<ExcelJS.Font>, centred = false) => {
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = font(f);
    if (centred) {
      c.alignment = { horizontal: "center" };
      ws.mergeCells(r, 1, r, last);
    }
  };
  titleLine(1, s.companyName, { size: 12, bold: true });
  titleLine(3, s.title.toUpperCase(), { size: 13, bold: true }, true);
  titleLine(4, period, { size: 9 }, true);
  titleLine(5, s.measure, { size: 8, italic: true }, true);

  s.headers.forEach((v, j) => {
    const c = ws.getCell(HEAD, j + 1);
    c.value = v;
    c.font = font({ bold: true, color: { argb: "FF333333" } });
    c.alignment = { horizontal: j < s.textCols ? "left" : "right", vertical: "middle" };
    c.fill = fill(BAND);
    c.border = { top: thin, bottom: thin };
  });
  return { wb, ws };
}

const LAST = 6;

export async function bookWorkbook(s: BookExport): Promise<Buffer> {
  const { wb, ws } = bookSheet({
    ...s,
    headers: ["Tanggal", "Entri", "Keterangan", ...s.columns, "Saldo"],
    // The statements' width, so every export prints at one scale.
    widths: [10, 10, 47, 17, 17, 17],
    textCols: 3,
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

  for (const b of s.blocks) {
    // The code rides on every figure, so a cell copied out still says what it is.
    const fmt = `"${b.currencyLabel}" #,##0.00;("${b.currencyLabel}" #,##0.00);"-"`;
    const money = (col: number, v: number | null, o: Partial<ExcelJS.Font> = {}) => {
      const c = ws.getCell(r, col);
      c.value = v;
      c.numFmt = fmt;
      c.font = font(o);
      c.alignment = { vertical: "top" };
    };

    band(BAND);
    text(1, b.code, { bold: true, size: 9 });
    text(3, b.name, { bold: true, size: 9.5 });
    const aside = text(LAST, b.aside, { size: 8, color: { argb: "FF555555" } });
    aside.alignment = { horizontal: "right" };
    r++;

    text(3, "Saldo Awal", { italic: true });
    money(6, b.opening, { italic: true });
    r++;

    for (const e of b.rows) {
      text(1, formatDate(e.date));
      text(2, e.entryNo, { size: 8 });
      text(3, e.text, {}, true);
      money(4, e.in);
      money(5, e.out);
      r++;
    }
    if (!b.rows.length) {
      text(3, "Tidak ada mutasi dalam periode ini.", { italic: true, color: MUTED });
      r++;
    }

    band(SOFT, double);
    text(3, "Saldo Akhir", { bold: true });
    money(4, b.totalIn, { bold: true });
    money(5, b.totalOut, { bold: true });
    money(6, b.closing, { bold: true });
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
