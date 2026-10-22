import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

import { subledgerBalanceWorkbook } from "../src/lib/siba/subledger-balance-export";
import type { SubledgerBalanceReport } from "../src/lib/siba/subledger";

/**
 * Saldo Buku Subjek's Unduh XLSX: one block per Partner and currency holding
 * its open items, each with its kurs (a dash on rupiah) and four figures, a
 * Jumlah per block, a total per currency, and no base figure. Pure.
 */

const range = { from: "2026-01-01", to: "2026-09-30" };

const item = (o: Record<string, unknown>) => ({
  id: 1,
  itemNo: "SBI-0001",
  date: "2026-03-03",
  rate: 1,
  original: 0,
  opening: 0,
  raised: 0,
  lowered: 0,
  closing: 0,
  baseClosing: 0,
  note: null,
  ...o,
});

const row = (label: string, currencyLabel: string, o: Record<string, unknown>) => ({
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
  reconciles: true,
  items: [],
  ...o,
});

test("each Partner's open items carry their kurs and four figures, with a Jumlah and a total per currency", async () => {
  const usd = row("MRX", "USD", {
    opening: 100,
    raised: 30,
    lowered: 110,
    closing: 20,
    baseClosing: 323_000,
    items: [
      item({ itemNo: "SBI-0002", rate: 16_150, opening: 100, lowered: 100, closing: 0, note: "Lama" }),
      item({ itemNo: "SBI-0003", rate: 16_250.125, raised: 30, lowered: 10, closing: 20, baseClosing: 323_000, note: "Baru" }),
    ],
  });
  const idr = row("DAP", "IDR", {
    opening: 5,
    closing: 5,
    items: [item({ itemNo: "SBI-0004", opening: 5, closing: 5, note: "Rupiah" })],
  });
  const report = {
    book: { name: "Buku Titipan", nature: "position", closingLabel: "Saldo titipan" },
    range,
    groups: [
      { currencyId: 1, currencyLabel: "IDR", rows: [idr], opening: 5, raised: 0, lowered: 0, closing: 5, baseClosing: 5 },
      { currencyId: 2, currencyLabel: "USD", rows: [usd], opening: 100, raised: 30, lowered: 110, closing: 20, baseClosing: 323_000 },
    ],
  } as unknown as SubledgerBalanceReport;

  const file = await subledgerBalanceWorkbook({
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
  const find = (col: number, text: string) => rows.filter((r) => String(r.getCell(col).value ?? "") === text);
  const figures = (r: ExcelJS.Row) => [5, 6, 7, 8].map((c) => r.getCell(c).value ?? null);

  assert.equal(ws.getCell(3, 1).value, "SALDO BUKU TITIPAN");
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map((c) => ws.getCell(7, c).value),
    ["Tanggal", "Open Item", "Keterangan", "Kurs", "Saldo Awal", "Bertambah", "Berkurang", "Saldo"]
  );

  // A settled item stays listed at nil, so the columns add up to the Jumlah.
  const settled = find(2, "SBI-0002")[0];
  assert.equal(settled.getCell(4).value, 16_150);
  assert.deepEqual(figures(settled), [100, 0, 100, 0]);
  assert.equal(find(2, "SBI-0003")[0].getCell(4).value, 16_250.125);
  assert.equal(find(2, "SBI-0004")[0].getCell(4).value, "-");

  const jumlah = find(3, "Jumlah");
  assert.deepEqual(jumlah.map(figures), [[5, 0, 0, 5], [100, 30, 110, 20]]);
  assert.match(jumlah[1].getCell(8).numFmt, /"USD"/);

  // One total per currency, never added across.
  assert.deepEqual(find(3, "IDR").map(figures), [[5, 0, 0, 5]]);
  assert.deepEqual(find(3, "USD").map(figures), [[100, 30, 110, 20]]);

  // No base figure anywhere.
  ws.eachRow((r) => r.eachCell((c) => assert.notEqual(c.value, 323_000)));
  ws.eachRow((r) => r.eachCell((c) => assert.equal(c.formula, undefined)));
  assert.equal(ws.pageSetup.paperSize, 9);
  assert.equal(ws.pageSetup.orientation, "portrait");
});

test("an accumulating book calls its items Rincian", async () => {
  const file = await subledgerBalanceWorkbook({
    companyName: "ABHC",
    report: { book: { name: "Buku Investasi", nature: "cumulative" }, range, groups: [] } as unknown as SubledgerBalanceReport,
    footnotes: [],
    printedBy: "Tester",
    printedAt: "22/10/2026 08:00",
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file as unknown as ArrayBuffer);
  assert.equal(wb.worksheets[0].getCell(7, 2).value, "Rincian");
});
