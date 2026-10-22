import "server-only";

import ExcelJS from "exceljs";
import { FONT, MONEY, double, esc, thin } from "./statement-export";

/**
 * Laporan Pengajuan as an A4 workbook — printed daily, marked up by whoever
 * approves, and brought back to approve the marked Budgets in SIBA.
 *
 * One section per currency, never converted: the Cash & Bank it holds, then the
 * Budgets ticked in the picker in date order, each with the Saldo after it, so
 * the reader sees where the money runs out. One Jumlah per currency closes it.
 * It shares the statement export's page, fonts and footer.
 */

export type PengajuanSection = {
  /** `RUPIAH (IDR)`. */
  heading: string;
  /** `IDR` — named on the Jumlah line. */
  currency: string;
  cash: { name: string; company: string; balance: number }[];
  budgets: { no: string; date: string; description: string; company: string; type: "In" | "Out"; amount: number }[];
};

export type PengajuanExport = {
  companyName: string;
  subtitle: string;
  sections: PengajuanSection[];
  footnotes: string[];
  printedBy: string;
  printedAt: string;
};

const HEAD = 7;
const LAST = 7;
const BAND = "FFEDF0F5";
const SOFT = "FFF4F6F9";

export async function pengajuanWorkbook(s: PengajuanExport): Promise<Buffer> {
  const footer = `&L&"${FONT}"&7SIBA 3.0 · dicetak ${esc(s.printedAt)} oleh ${esc(s.printedBy)}&R&"${FONT}"&7Halaman &P dari &N`;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SIBA 3.0";
  wb.title = "Laporan Pengajuan Budget";
  const ws = wb.addWorksheet("Pengajuan Budget", {
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
      oddHeader: `&L&"${FONT},Bold"&8${esc(s.companyName)}&R&"${FONT}"&8Laporan Pengajuan · ${esc(s.subtitle)}`,
      oddFooter: footer,
      firstFooter: footer,
    },
  });
  ws.columns = [11, 10, 41, 7, 16, 16, 17].map((width) => ({ width }));

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
  titleLine(3, "LAPORAN PENGAJUAN BUDGET", { size: 13, bold: true }, true);
  titleLine(4, s.subtitle, { size: 9 }, true);
  titleLine(5, "(Dinyatakan dalam mata uang masing-masing)", { size: 8, italic: true }, true);

  ["No", "Tanggal", "Keterangan", "Co.", "Pengeluaran", "Penerimaan", "Saldo"].forEach((v, j) => {
    const c = ws.getCell(HEAD, j + 1);
    c.value = v;
    c.font = font({ bold: true, color: { argb: "FF333333" } });
    c.alignment = { horizontal: j < 4 ? "left" : "right", vertical: "middle" };
    c.fill = fill(BAND);
    c.border = { top: thin, bottom: thin };
  });

  let r = HEAD + 2;
  const label = (text: string, o: Partial<ExcelJS.Font> = {}, indent = 0) => {
    const c = ws.getCell(r, 3);
    c.value = text;
    c.font = font(o);
    c.alignment = { indent, wrapText: true, vertical: "top" };
  };
  const money = (col: number, v: number | null, o: Partial<ExcelJS.Font> = {}) => {
    const c = ws.getCell(r, col);
    c.value = v;
    c.numFmt = MONEY;
    c.font = font(o);
    c.alignment = { vertical: "top" };
    return c;
  };

  for (const sec of s.sections) {
    const band = ws.getCell(r, 1);
    band.value = sec.heading;
    band.font = font({ size: 9.5, bold: true });
    for (let j = 1; j <= LAST; j++) ws.getCell(r, j).fill = fill(BAND);
    r += 2;

    label("Saldo Kas & Bank", { bold: true, size: 9 });
    r++;
    let opening = 0;
    for (const c of sec.cash) {
      label(c.name, {}, 1);
      ws.getCell(r, 4).value = c.company;
      ws.getCell(r, 4).font = font({ size: 7.5, color: { argb: "FF777777" } });
      ws.getCell(r, 4).alignment = { vertical: "top" };
      money(7, c.balance);
      opening += c.balance;
      r++;
    }
    label("Jumlah Saldo Kas & Bank", { bold: true });
    money(7, opening, { bold: true }).border = { top: thin };
    r += 2;

    label("Rincian Pengajuan", { bold: true, size: 9 });
    r++;
    label("Saldo Awal", { italic: true }, 1);
    money(7, opening, { italic: true });
    r++;

    let saldo = opening;
    let out = 0;
    let inn = 0;
    if (!sec.budgets.length) {
      label("Tidak ada pengajuan.", { italic: true, color: { argb: "FF666666" } }, 1);
      r++;
    }
    for (const b of sec.budgets) {
      const isOut = b.type === "Out";
      saldo += isOut ? -b.amount : b.amount;
      if (isOut) out += b.amount;
      else inn += b.amount;
      const cells: [number, string][] = [[1, b.no], [2, b.date], [4, b.company]];
      for (const [col, v] of cells) {
        const c = ws.getCell(r, col);
        c.value = v;
        c.font = font({ size: col === 4 ? 7.5 : 8.5, color: col === 4 ? { argb: "FF777777" } : undefined });
        c.alignment = { vertical: "top" };
      }
      label(b.description);
      money(5, isOut ? b.amount : null);
      money(6, isOut ? null : b.amount);
      money(7, saldo);
      r++;
    }

    const total = ws.getRow(r);
    for (let j = 1; j <= LAST; j++) {
      const c = total.getCell(j);
      c.fill = fill(SOFT);
      c.border = { top: thin, bottom: double };
    }
    const t = total.getCell(1);
    t.value = `JUMLAH PENGAJUAN ${sec.currency}`;
    t.font = font({ bold: true, size: 9 });
    money(5, out, { bold: true, size: 9 });
    money(6, inn, { bold: true, size: 9 });
    money(7, saldo, { bold: true, size: 9 });
    r += 3;
  }

  for (const note of s.footnotes) {
    const c = ws.getCell(r++, 1);
    c.value = note;
    c.font = font({ size: 7.5, italic: true, color: { argb: "FF666666" } });
  }
  ws.pageSetup.printArea = `A1:G${r - 1}`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
