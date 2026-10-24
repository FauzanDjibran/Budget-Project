import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

import { subledgerWorkbook } from "../src/lib/siba/subledger-export";
import type { SubledgerEntryRow, SubledgerReport, SubledgerSubject } from "../src/lib/siba/subledger-reports";

/**
 * Buku Subjek's Unduh XLSX: one block per Partner and currency, each from Saldo
 * Awal to a Saldo Akhir that reconciles, Bertambah and Berkurang read off the
 * book's own sign, the keterangan alone, and no base figure. Pure.
 */

const range = { from: "2026-01-01", to: "2026-09-30" };

const entry = (o: Partial<SubledgerEntryRow>): SubledgerEntryRow => ({
  id: 1,
  entryNo: "SBL-0001",
  date: "2026-03-03",
  type: "Transaction",
  movement: 0,
  rate: 1,
  baseMovement: 0,
  itemId: 1,
  itemNo: "SBI-0001",
  note: null,
  sourceDocTable: null,
  sourceDocId: null,
  sourceDocNo: null,
  ...o,
});

const subject = (label: string, currencyLabel: string, o: Partial<SubledgerSubject>): SubledgerSubject => ({
  partnerId: 1,
  label,
  name: `${label} Nama`,
  categoryLabel: "Stakeholder",
  companyLabel: "ABHC",
  active: true,
  currencyId: 1,
  currencyLabel,
  opening: 0,
  raised: 0,
  lowered: 0,
  closing: 0,
  baseOpening: 0,
  baseRaised: 0,
  baseLowered: 0,
  baseClosing: 0,
  carryingRate: null,
  entries: [],
  reconciles: true,
  ...o,
});

test("each position runs from Saldo Awal to Saldo Akhir in its own currency, keterangan only, on A4 portrait", async () => {
  const report = {
    book: { categoryId: 1, budgetCategory: "Titipan", name: "Buku Titipan", raises: "In", closingLabel: "Saldo titipan" },
    range,
    subjects: [
      subject("MRX", "USD", {
        opening: 100,
        raised: 30,
        lowered: 10,
        closing: 120,
        baseOpening: 1_600_000,
        baseClosing: 1_900_000,
        entries: [
          entry({ movement: 30, note: "Titipan dana impor", sourceDocNo: "RBM-0002" }),
          entry({ movement: -10, type: "Conversion", note: "Pencairan Open Item", sourceDocNo: "POI-0001" }),
        ],
      }),
      subject("DAP", "IDR", { opening: 5, closing: 5, active: false }),
    ],
  } as unknown as SubledgerReport;

  const file = await subledgerWorkbook({
    companyName: "ABHC",
    report,
    footnotes: ["Catatan."],
    printedBy: "Tester",
    printedAt: "22/10/2026 08:00",
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const rows: ExcelJS.Row[] = [];
  ws.eachRow((r) => rows.push(r));
  const find = (col: number, text: string) => rows.filter((r) => String(r.getCell(col).value ?? "").startsWith(text));
  const figures = (r: ExcelJS.Row) => [4, 5, 6].map((c) => r.getCell(c).value ?? null);

  assert.equal(ws.getCell(3, 1).value, "BUKU TITIPAN");
  assert.deepEqual([4, 5].map((c) => ws.getCell(7, c).value), ["Bertambah", "Berkurang"]);
  assert.deepEqual(find(3, "Saldo Awal").map((r) => r.getCell(6).value), [100, 5]);
  assert.deepEqual(figures(find(2, "RBM-0002")[0]), [30, null, null]);
  const lowered = find(2, "POI-0001")[0];
  assert.deepEqual(figures(lowered), [null, 10, null]);
  // The source document and the keterangan — no open item, no entry type.
  assert.equal(lowered.getCell(3).value, "Pencairan Open Item");

  const closing = find(3, "Saldo Akhir");
  assert.deepEqual(closing.map(figures), [[30, 10, 120], [0, 0, 5]]);
  assert.match(closing[0].getCell(6).numFmt, /"USD"/);
  assert.deepEqual(
    find(6, "Stakeholder").map((r) => r.getCell(6).value),
    ["Stakeholder · Mata uang: USD", "Stakeholder · non-aktif · Mata uang: IDR"]
  );
  // No base figure anywhere.
  ws.eachRow((r) => r.eachCell((c) => assert.ok(c.value !== 1_600_000 && c.value !== 1_900_000)));

  ws.eachRow((r) => r.eachCell((c) => assert.equal(c.formula, undefined)));
  assert.equal(ws.pageSetup.paperSize, 9);
  assert.equal(ws.pageSetup.orientation, "portrait");
});
