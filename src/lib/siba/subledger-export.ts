import "server-only";

import type { SubledgerReport } from "./subledger";
import { bookWorkbook } from "./book-export";

/**
 * Buku Subjek as an A4 portrait workbook — its Unduh XLSX, in the layout every
 * book export shares (`book-export.ts`). One block per Partner and currency,
 * as on screen; each entry is its keterangan and its figure, Bertambah and
 * Berkurang following the book's own direction, not the money's (§10 rule
 * 53). Face currency only — a position's base value is Saldo Buku Subjek's to
 * state.
 */

export type SubledgerExport = {
  companyName: string;
  report: SubledgerReport;
  footnotes: string[];
  printedBy: string;
  printedAt: string;
};

export function subledgerWorkbook(s: SubledgerExport): Promise<Buffer> {
  const { book, range, subjects } = s.report;
  return bookWorkbook({
    title: book.name,
    measure: "(Dinyatakan dalam mata uang masing-masing posisi)",
    columns: ["Bertambah", "Berkurang"],
    companyName: s.companyName,
    range,
    footnotes: s.footnotes,
    printedBy: s.printedBy,
    printedAt: s.printedAt,
    blocks: subjects.map((p) => ({
      code: p.label,
      name: p.name,
      aside: `${p.categoryLabel}${p.active ? "" : " · non-aktif"} · Mata uang: ${p.currencyLabel}`,
      currencyLabel: p.currencyLabel,
      opening: p.opening,
      totalIn: p.raised,
      totalOut: p.lowered,
      closing: p.closing,
      rows: p.entries.map((e) => ({
        date: e.date,
        docNo: e.sourceDocNo ?? "",
        text: e.note ?? "—",
        in: e.movement > 0 ? e.movement : null,
        out: e.movement < 0 ? -e.movement : null,
      })),
    })),
  });
}
