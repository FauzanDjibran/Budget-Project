import "server-only";

import type { LedgerReport } from "./cash-bank";
import type { PeriodRange } from "./period";
import { entryKindText } from "./document-links";
import { bookWorkbook } from "./book-export";

/**
 * Buku Kas & Bank as an A4 portrait workbook — its Unduh XLSX, in the layout
 * every book export shares (`book-export.ts`): one block per Cash & Bank, the
 * source document's number in its own column, every figure in the resource's own
 * currency and none in base.
 */

export type CashBankLedgerExport = {
  companyName: string;
  range: PeriodRange;
  books: LedgerReport[];
  footnotes: string[];
  printedBy: string;
  printedAt: string;
};

export function cashBankLedgerWorkbook(s: CashBankLedgerExport): Promise<Buffer> {
  return bookWorkbook({
    title: "Buku Kas & Bank",
    measure: "(Dinyatakan dalam mata uang masing-masing Cash & Bank)",
    columns: ["Masuk", "Keluar"],
    companyName: s.companyName,
    range: s.range,
    footnotes: s.footnotes,
    printedBy: s.printedBy,
    printedAt: s.printedAt,
    blocks: s.books.map((book) => ({
      code: book.resource.label,
      name: book.resource.name,
      aside: `Mata uang: ${book.resource.currencyLabel}`,
      currencyLabel: book.resource.currencyLabel,
      opening: book.opening,
      totalIn: book.totalIn,
      totalOut: book.totalOut,
      closing: book.closing,
      rows: book.entries.map((e) => ({
        date: e.date,
        docNo: [e.sourceDocNo, entryKindText(e.type, e.sourceDocTable, e.movement)].filter(Boolean).join("\n"),
        text: e.note ?? "—",
        // A revaluation moves no currency, only its base value, so neither column carries it.
        in: e.movement > 0 ? e.movement : null,
        out: e.movement < 0 && e.type !== "Revaluation" ? -e.movement : null,
      })),
    })),
  });
}
