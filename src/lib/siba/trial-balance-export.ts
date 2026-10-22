import "server-only";

import ExcelJS from "exceljs";
import type { StatementRow } from "./statement-layout";
import { FONT, MONEY, double, esc, printRows, thin } from "./statement-export";

/**
 * The Trial Balance as an A4 portrait workbook — its Unduh XLSX.
 *
 * The screen's tree printed fully open, as the statements print theirs: each
 * heading, its accounts, and a Jumlah line closing it, with the four columns
 * the screen reads — Saldo Awal, Mutasi Debit, Mutasi Kredit, Saldo Akhir. It
 * closes on one JUMLAH line carrying the movement totals, the figure a trial
 * balance is checked for. Plain values only, like every export.
 */

export type TrialBalanceExport = {
  companyName: string;
  /** `Untuk periode 01/01/2026 s.d. 30/09/2026`. */
  subtitle: string;
  rows: StatementRow[];
  totalDebit: number;
  totalCredit: number;
  footnotes: string[];
  printedBy: string;
  printedAt: string;
};

const HEAD = 7;
const LAST = 6;
const BAND = "FFEDF0F5";
const SOFT = "FFF4F6F9";

export async function trialBalanceWorkbook(s: TrialBalanceExport): Promise<Buffer> {
  const footer = `&L&"${FONT}"&7SIBA 3.0 · dicetak ${esc(s.printedAt)} oleh ${esc(s.printedBy)}&R&"${FONT}"&7Halaman &P dari &N`;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SIBA 3.0";
  wb.title = `Trial Balance ${s.companyName}`;
  const ws = wb.addWorksheet("Trial Balance", {
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
      oddHeader: `&L&"${FONT},Bold"&8${esc(s.companyName)}&R&"${FONT}"&8Trial Balance · ${esc(s.subtitle)}`,
      oddFooter: footer,
      firstFooter: footer,
    },
  });
  // The statements' width, so every export prints at one scale.
  ws.columns = [11, 42, 16, 16, 16, 16].map((width) => ({ width }));

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
  titleLine(3, "NERACA SALDO (TRIAL BALANCE)", { size: 13, bold: true }, true);
  titleLine(4, s.subtitle, { size: 9 }, true);
  titleLine(5, "(Dinyatakan dalam Rupiah)", { size: 8, italic: true }, true);

  ["Kode", "Akun", "Saldo Awal", "Mutasi Debit", "Mutasi Kredit", "Saldo Akhir"].forEach((v, j) => {
    const c = ws.getCell(HEAD, j + 1);
    c.value = v;
    c.font = font({ bold: true, color: { argb: "FF333333" } });
    c.alignment = { horizontal: j < 2 ? "left" : "right", vertical: "middle" };
    c.fill = fill(BAND);
    c.border = { top: thin, bottom: thin };
  });

  let r = HEAD + 2;
  for (const p of printRows(s.rows)) {
    const row = ws.getRow(r++);
    if (p.kind === "blank") continue;
    const bold = p.kind !== "line";

    const code = row.getCell(1);
    code.value = p.code ?? "";
    code.font = font({ size: 7.5, color: { argb: "FF777777" } });
    const name = row.getCell(2);
    name.value = p.name;
    name.font = font({ bold, size: p.depth === 0 && p.kind !== "line" ? 9.5 : p.kind === "line" ? 8.5 : 8 });
    name.alignment = { indent: p.depth };

    if (p.kind === "heading" && !p.values.length) continue;
    p.values.slice(0, 4).forEach((v, j) => {
      const c = row.getCell(3 + j);
      c.value = v;
      c.numFmt = MONEY;
      c.font = font({ bold });
      if (p.kind === "total") c.border = { top: thin };
    });
  }

  for (let j = 1; j <= LAST; j++) {
    const c = ws.getCell(r, j);
    c.fill = fill(SOFT);
    c.border = { top: thin, bottom: double };
  }
  const total = ws.getCell(r, 2);
  total.value = "JUMLAH";
  total.font = font({ bold: true, size: 9 });
  [s.totalDebit, s.totalCredit].forEach((v, j) => {
    const c = ws.getCell(r, 4 + j);
    c.value = v;
    c.numFmt = MONEY;
    c.font = font({ bold: true, size: 9 });
  });
  r += 2;

  for (const note of s.footnotes) {
    const c = ws.getCell(r++, 1);
    c.value = note;
    c.font = font({ size: 7.5, italic: true, color: { argb: "FF666666" } });
  }
  ws.pageSetup.printArea = `A1:F${r - 1}`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
