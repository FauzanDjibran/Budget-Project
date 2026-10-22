import "server-only";

import ExcelJS from "exceljs";
import type { StatementRow } from "./statement-layout";

/**
 * A financial statement as an A4 workbook — what the Laba Rugi's and the
 * Neraca's Unduh XLSX hand the reader.
 *
 * It takes the rows the screen drew, so the file and the screen cannot
 * disagree, and lays them out the way the company's printed statements always
 * read: a heading, its lines, and a *Jumlah* line closing it. The tree is
 * printed fully open and without Partner breakdowns. Every figure is a plain
 * value — no formulas, no grouping, no frozen panes — because the file is a
 * report to print or hand on, not a model to work in (the user's rule).
 */

export type StatementExport = {
  companyName: string;
  /** `LAPORAN LABA RUGI` — the line under the company. */
  title: string;
  /** What the figures cover, in words: `Per 30/09/2026, dibandingkan …`. */
  subtitle: string;
  /** Repeated at the top right of every page after the first. */
  pageTitle: string;
  /** One or two value columns, each a role and its dates. */
  columns: { role: string; dates: string }[];
  rows: StatementRow[];
  /** Which result lines carry the double rule of a grand total. */
  grandTotal: (row: StatementRow) => boolean;
  footnotes: string[];
  printedBy: string;
  printedAt: string;
};

/** One line of the printed statement. */
export type PrintRow = {
  kind: "heading" | "line" | "total" | "result" | "blank";
  depth: number;
  code: string | null;
  name: string;
  values: number[];
  computed?: boolean;
  double?: boolean;
};

/**
 * The screen's rows, reshaped for paper.
 *
 * A row with children is a heading here and its figure moves to a *Jumlah*
 * line after them — on screen a heading states its total only while folded,
 * and paper never folds. A heading over a single figure gets no Jumlah, which
 * would only repeat it, and a Neraca section closes on its own Total line.
 */
export function printRows(
  rows: StatementRow[],
  grandTotal: (row: StatementRow) => boolean = () => false
): PrintRow[] {
  const shown = rows.filter((r) => r.kind !== "partner");
  const out: PrintRow[] = [];
  const open: { row: StatementRow; children: number; onlyLeaf: boolean }[] = [];

  const close = (depth: number) => {
    while (open.length && open[open.length - 1].row.depth >= depth) {
      const { row, children, onlyLeaf } = open.pop()!;
      if (!row.values.length || (children === 1 && onlyLeaf)) continue;
      out.push({ kind: "total", depth: row.depth, code: null, name: `Jumlah ${titleCase(row.name)}`, values: row.values });
      if (row.depth === 0) out.push(blank());
    }
  };

  shown.forEach((row, i) => {
    close(row.depth);
    if (row.kind === "subtotal") {
      out.push({ kind: "result", depth: 0, code: null, name: row.name, values: row.values, double: grandTotal(row) });
      out.push(blank());
      return;
    }

    const next = shown[i + 1];
    const hasChildren = Boolean(next && next.kind !== "subtotal" && next.depth > row.depth);
    const parent = open[open.length - 1];
    if (parent) {
      parent.children++;
      parent.onlyLeaf = !hasChildren;
    }

    if (hasChildren) {
      out.push({ kind: "heading", depth: row.depth, code: row.code, name: row.name, values: [] });
      open.push({ row, children: 0, onlyLeaf: false });
    } else if (row.kind === "step" && !row.values.length) {
      out.push({ kind: "heading", depth: 0, code: null, name: row.name, values: [] });
    } else {
      out.push({
        kind: row.kind === "account" ? "line" : "heading",
        depth: row.depth,
        code: row.code,
        name: row.name,
        values: row.values,
        computed: row.computed,
      });
    }
  });
  close(0);

  while (out.at(-1)?.kind === "blank") out.pop();
  return out;
}

const blank = (): PrintRow => ({ kind: "blank", depth: 0, code: null, name: "", values: [] });

/** `PENDAPATAN DARI USAHA` → `Pendapatan Dari Usaha`; a name already in case is left alone. */
function titleCase(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s/(-])\S/g, (m) => m.toUpperCase());
}

// ------------------------------------------------------------------ writer

export const FONT = "Arial";
export const MONEY = '#,##0.00;(#,##0.00);"-"';
const PERCENT = '0.0%;(0.0%);"-"';
const COMPUTED = "FF1F3A68";
export const thin = { style: "thin" } as const;
export const double = { style: "double" } as const;
/** Rows 1–5 are the title block; the column headers sit on 7–8 and repeat on every page. */
const HEAD = 7;

export async function statementWorkbook(s: StatementExport): Promise<Buffer> {
  const compare = s.columns.length > 1;
  const valueCols = s.columns.length;
  const lastCol = compare ? 6 : 3;
  const footer = `&L&"${FONT}"&7SIBA 3.0 · dicetak ${esc(s.printedAt)} oleh ${esc(s.printedBy)}&R&"${FONT}"&7Halaman &P dari &N`;

  const wb = new ExcelJS.Workbook();
  wb.creator = "SIBA 3.0";
  wb.title = `${s.title} ${s.companyName}`;
  // No outlineProperties: exceljs writes <outlinePr> after <pageSetUpPr>,
  // which Excel rejects as a corrupt sheet.
  const ws = wb.addWorksheet(s.title.slice(0, 31), {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      printTitlesRow: `${HEAD}:${HEAD + 1}`,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
    },
    headerFooter: {
      differentFirst: true,
      oddHeader: `&L&"${FONT},Bold"&8${esc(s.companyName)}&R&"${FONT}"&8${esc(s.pageTitle)}`,
      oddFooter: footer,
      firstFooter: footer,
    },
  });
  // Both shapes add up to the same width, so both print at one scale.
  ws.columns = (compare ? [11, 44, 18, 18, 17, 9] : [12, 80, 25]).map((width) => ({ width }));

  const font = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: FONT, size: 8.5, ...o });
  const titleLine = (r: number, text: string, f: Partial<ExcelJS.Font>, centred = false) => {
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = font(f);
    if (centred) {
      c.alignment = { horizontal: "center" };
      ws.mergeCells(r, 1, r, lastCol);
    }
  };
  titleLine(1, s.companyName, { size: 12, bold: true });
  titleLine(3, s.title, { size: 13, bold: true }, true);
  titleLine(4, s.subtitle, { size: 9 }, true);
  titleLine(5, "(Dinyatakan dalam Rupiah)", { size: 8, italic: true }, true);

  const heads = [
    ["Kode", "Akun", ...s.columns.map((c) => c.role), ...(compare ? ["Selisih", "Selisih %"] : [])],
    ["", "", ...s.columns.map((c) => c.dates), ...(compare ? ["", ""] : [])],
  ];
  heads.forEach((values, i) => {
    values.forEach((v, j) => {
      const c = ws.getCell(HEAD + i, j + 1);
      c.value = v;
      c.font = font({ size: i ? 7.5 : 8.5, bold: !i, color: { argb: "FF333333" } });
      c.alignment = { horizontal: j < 2 ? "left" : "right", vertical: "middle" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF0F5" } };
      c.border = i ? { bottom: thin } : { top: thin };
    });
  });
  ws.mergeCells(HEAD, 1, HEAD + 1, 1);
  ws.mergeCells(HEAD, 2, HEAD + 1, 2);
  if (compare) {
    ws.mergeCells(HEAD, 5, HEAD + 1, 5);
    ws.mergeCells(HEAD, 6, HEAD + 1, 6);
  }

  let r = HEAD + 2;
  for (const p of printRows(s.rows, s.grandTotal)) {
    const row = ws.getRow(r++);
    if (p.kind === "blank") continue;

    const bold = p.kind !== "line";
    const color = p.computed ? { argb: COMPUTED } : undefined;
    const size = p.depth === 0 ? (p.kind === "line" ? 8.5 : 9.5) : p.kind === "line" ? 8.5 : 8;

    const code = row.getCell(1);
    code.value = p.code ?? "";
    code.font = font({ size: 7.5, color: { argb: "FF777777" } });
    const name = row.getCell(2);
    name.value = p.computed ? `${p.name} *` : p.kind === "result" ? p.name.toUpperCase() : p.name;
    name.font = font({ bold, size, color });
    name.alignment = { indent: p.depth };

    if (p.kind === "heading" && !p.values.length) continue;

    const figures = p.values.slice(0, valueCols);
    const cells: [number, number | null, string][] = figures.map((v, j) => [3 + j, v, MONEY]);
    if (compare) {
      const [a, b] = figures;
      cells.push([5, a - b, MONEY], [6, b ? (a - b) / Math.abs(b) : null, PERCENT]);
    }
    const border =
      p.kind === "total" ? { top: thin } : p.kind === "result" ? { top: thin, bottom: p.double ? double : thin } : undefined;
    for (const [col, value, fmt] of cells) {
      const c = row.getCell(col);
      c.value = value;
      c.numFmt = fmt;
      c.font = font({ bold, size: p.kind === "result" ? 9 : 8.5, color: col > 4 ? { argb: "FF555555" } : color });
      if (border) c.border = border;
      if (p.kind === "result" && col <= 2 + valueCols) {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F6F9" } };
      }
    }
  }

  r++;
  for (const note of s.footnotes) {
    const c = ws.getCell(r++, 1);
    c.value = note;
    c.font = font({ size: 7.5, italic: true, color: { argb: "FF666666" } });
  }
  ws.pageSetup.printArea = `A1:${ws.getColumn(lastCol).letter}${r - 1}`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A page header or footer reads `&` as a code; a literal one is doubled. */
export function esc(text: string): string {
  return text.replace(/&/g, "&&");
}

/** An Unduh XLSX response: the file, named for the run, never cached. */
export function xlsxResponse(file: Buffer, name: string): Response {
  return new Response(new Uint8Array(file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    },
  });
}
