import "server-only";

import ExcelJS from "exceljs";
import { PARTNER_MISMATCH_TEXT } from "@/components/ui/partner-cell";
import { formatDate, formatForeignFace } from "@/lib/format";
import type { LedgerAccount } from "./ledger";
import { FONT, MONEY, double, esc, thin } from "./statement-export";

/**
 * The General Ledger as an A4 portrait workbook — its Unduh XLSX.
 *
 * Laid out the way the company's printed GL always read (`Example report/GL.Xls`):
 * one block per account, headed by its number, name and normal balance, opening
 * on Saldo Awal and running the Saldo entry by entry. Kept from it: the block
 * and the running balance. Changed: the Period column is dropped, since the date
 * already says it; the Partner the screen shows is added; and each block closes
 * on a Saldo Akhir line carrying the period's debit and kredit, so it reconciles
 * on the page (§10 rule 40). Plain values only, like every export.
 */

export type LedgerExport = {
  companyName: string;
  /** `Untuk periode 01/01/2026 s.d. 30/04/2026`. */
  subtitle: string;
  accounts: LedgerAccount[];
  footnotes: string[];
  printedBy: string;
  printedAt: string;
};

const HEAD = 7;
const LAST = 7;
const BAND = "FFEDF0F5";
const SOFT = "FFF4F6F9";
const MUTED = { argb: "FF777777" };

export async function ledgerWorkbook(s: LedgerExport): Promise<Buffer> {
  const footer = `&L&"${FONT}"&7SIBA 3.0 · dicetak ${esc(s.printedAt)} oleh ${esc(s.printedBy)}&R&"${FONT}"&7Halaman &P dari &N`;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SIBA 3.0";
  wb.title = `General Ledger ${s.companyName}`;
  const ws = wb.addWorksheet("General Ledger", {
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
      oddHeader: `&L&"${FONT},Bold"&8${esc(s.companyName)}&R&"${FONT}"&8General Ledger · ${esc(s.subtitle)}`,
      oddFooter: footer,
      firstFooter: footer,
    },
  });
  // The statements' width, so every export prints at one scale.
  ws.columns = [10, 10, 17, 38, 14, 14, 15].map((width) => ({ width }));

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
  titleLine(3, "GENERAL LEDGER", { size: 13, bold: true }, true);
  titleLine(4, s.subtitle, { size: 9 }, true);
  titleLine(5, "(Dinyatakan dalam Rupiah)", { size: 8, italic: true }, true);

  ["Tanggal", "Journal", "Partner", "Keterangan", "Debit", "Kredit", "Saldo"].forEach((v, j) => {
    const c = ws.getCell(HEAD, j + 1);
    c.value = v;
    c.font = font({ bold: true, color: { argb: "FF333333" } });
    c.alignment = { horizontal: j < 4 ? "left" : "right", vertical: "middle" };
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
  const money = (col: number, v: number | null, o: Partial<ExcelJS.Font> = {}) => {
    const c = ws.getCell(r, col);
    c.value = v;
    c.numFmt = MONEY;
    c.font = font(o);
    c.alignment = { vertical: "top" };
    return c;
  };

  for (const a of s.accounts) {
    for (let j = 1; j <= LAST; j++) ws.getCell(r, j).fill = fill(BAND);
    text(1, a.label, { bold: true, size: 9 });
    text(3, a.name, { bold: true, size: 9.5 });
    const nb = text(LAST, `Normal Balance: ${a.normalBalance}`, { size: 8, color: { argb: "FF555555" } });
    nb.alignment = { horizontal: "right" };
    r++;

    text(4, "Saldo Awal", { italic: true });
    money(7, a.opening, { italic: true });
    r++;

    for (const e of a.entries) {
      text(1, formatDate(e.date));
      text(2, e.journalNo, { size: 8 });
      const partner = e.partnerLabel ? `${e.partnerLabel} – ${e.partnerName ?? ""}` : "—";
      const fault = e.partnerMismatch ? ` (${PARTNER_MISMATCH_TEXT[e.partnerMismatch]})` : "";
      text(3, partner + fault, { size: 8, color: e.partnerLabel ? undefined : MUTED }, true);
      const face = e.trxAmount != null ? ` · ${formatForeignFace(e.trxAmount, e.trxCurrencyLabel ?? "", e.rate)}` : "";
      text(4, e.description + face, {}, true);
      money(5, e.debit || null);
      money(6, e.credit || null);
      money(7, e.balance);
      r++;
    }
    if (!a.entries.length) {
      text(4, "Tidak ada mutasi dalam periode ini.", { italic: true, color: { argb: "FF666666" } });
      r++;
    }

    for (let j = 1; j <= LAST; j++) {
      const c = ws.getCell(r, j);
      c.fill = fill(SOFT);
      c.border = { top: thin, bottom: double };
    }
    text(4, "Saldo Akhir", { bold: true });
    money(5, a.debit, { bold: true });
    money(6, a.credit, { bold: true });
    money(7, a.closing, { bold: true });
    r += 3;
  }

  for (const note of s.footnotes) {
    const c = ws.getCell(r++, 1);
    c.value = note;
    c.font = font({ size: 7.5, italic: true, color: { argb: "FF666666" } });
  }
  ws.pageSetup.printArea = `A1:G${Math.max(r - 1, HEAD)}`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
