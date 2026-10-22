import "server-only";

import ExcelJS from "exceljs";
import { formatDate } from "@/lib/format";
import type { LedgerReport } from "./cash-bank";
import type { PeriodRange } from "./period";
import { FONT, double, esc, thin } from "./statement-export";

/**
 * Buku Kas & Bank as an A4 portrait workbook — its Unduh XLSX.
 *
 * A cash book the way one is printed everywhere, stacked one block per Cash &
 * Bank like the General Ledger export: the resource and its currency on the
 * block's band, Saldo Awal carried in, every movement by date with its entry
 * number and its source document leading the keterangan, Masuk and Keluar,
 * and a Saldo Akhir line that reconciles on the page (§10 rule 40). Every
 * figure is in the resource's own currency and carries its code, so a USD
 * block and a rupiah one cannot be read as one scale; nothing is totalled
 * across them. Like the screen it prints no per-row Saldo. Plain values only,
 * like every export.
 */

export type CashBankLedgerExport = {
  companyName: string;
  range: PeriodRange;
  books: LedgerReport[];
  footnotes: string[];
  printedBy: string;
  printedAt: string;
};

const HEAD = 7;
const LAST = 6;
const BAND = "FFEDF0F5";
const SOFT = "FFF4F6F9";
const MUTED = { argb: "FF666666" };

const TYPE_TEXT: Record<string, string> = {
  Opening: "Saldo Awal",
  Adjustment: "Penyesuaian",
  Revaluation: "Revaluasi Kurs",
};

export async function cashBankLedgerWorkbook(s: CashBankLedgerExport): Promise<Buffer> {
  const period = `Untuk periode ${formatDate(s.range.from)} s.d. ${formatDate(s.range.to)}`;

  const footer = `&L&"${FONT}"&7SIBA 3.0 · dicetak ${esc(s.printedAt)} oleh ${esc(s.printedBy)}&R&"${FONT}"&7Halaman &P dari &N`;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SIBA 3.0";
  wb.title = `Buku Kas & Bank ${s.companyName}`;
  const ws = wb.addWorksheet("Buku Kas & Bank", {
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
      oddHeader: `&L&"${FONT},Bold"&8${esc(s.companyName)}&R&"${FONT}"&8Buku Kas & Bank · ${esc(period)}`,
      oddFooter: footer,
      firstFooter: footer,
    },
  });
  // The statements' width, so every export prints at one scale.
  ws.columns = [10, 10, 47, 17, 17, 17].map((width) => ({ width }));

  const font = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: FONT, size: 8.5, ...o });
  const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const titleLine = (r: number, text: string, f: Partial<ExcelJS.Font>, centred = false) => {
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = font(f);
    if (centred) {
      c.alignment = { horizontal: "center" };
      ws.mergeCells(r, 1, r, LAST);
    }
  };
  titleLine(1, s.companyName, { size: 12, bold: true });
  titleLine(3, "BUKU KAS & BANK", { size: 13, bold: true }, true);
  titleLine(4, period, { size: 9 }, true);
  titleLine(5, "(Dinyatakan dalam mata uang masing-masing Cash & Bank)", { size: 8, italic: true }, true);

  ["Tanggal", "Entri", "Keterangan", "Masuk", "Keluar", "Saldo"].forEach((v, j) => {
    const c = ws.getCell(HEAD, j + 1);
    c.value = v;
    c.font = font({ bold: true, color: { argb: "FF333333" } });
    c.alignment = { horizontal: j < 3 ? "left" : "right", vertical: "middle" };
    c.fill = fill(BAND);
    c.border = { top: thin, bottom: thin };
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

  for (const book of s.books) {
    const res = book.resource;
    // The code rides on every figure, so a cell copied out still says what it is.
    const fmt = `"${res.currencyLabel}" #,##0.00;("${res.currencyLabel}" #,##0.00);"-"`;
    const money = (col: number, v: number | null, o: Partial<ExcelJS.Font> = {}) => {
      const c = ws.getCell(r, col);
      c.value = v;
      c.numFmt = fmt;
      c.font = font(o);
      c.alignment = { vertical: "top" };
    };

    band(BAND);
    text(1, res.label, { bold: true, size: 9 });
    text(3, res.name, { bold: true, size: 9.5 });
    const cur = text(LAST, `Mata uang: ${res.currencyLabel}`, { size: 8, color: { argb: "FF555555" } });
    cur.alignment = { horizontal: "right" };
    r++;

    text(3, "Saldo Awal", { italic: true });
    money(6, book.opening, { italic: true });
    r++;

    for (const e of book.entries) {
      text(1, formatDate(e.date));
      text(2, e.entryNo, { size: 8 });
      // Only a Realisasi resolves to a number; every other document already leads its note with one.
      const note = e.sourceDocNo ? `${e.sourceDocNo} — ${e.note ?? ""}` : (e.note ?? "—");
      text(3, [TYPE_TEXT[e.type] && `[${TYPE_TEXT[e.type]}]`, note].filter(Boolean).join(" "), {}, true);
      // A revaluation moves no currency, only its base value, so neither column carries it.
      money(4, e.movement > 0 ? e.movement : null);
      money(5, e.movement < 0 && e.type !== "Revaluation" ? -e.movement : null);
      r++;
    }
    if (!book.entries.length) {
      text(3, "Tidak ada mutasi dalam periode ini.", { italic: true, color: MUTED });
      r++;
    }

    band(SOFT, double);
    text(3, "Saldo Akhir", { bold: true });
    money(4, book.totalIn, { bold: true });
    money(5, book.totalOut, { bold: true });
    money(6, book.closing, { bold: true });
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
