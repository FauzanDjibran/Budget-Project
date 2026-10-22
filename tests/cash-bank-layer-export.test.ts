import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

import { cashBankLayerWorkbook } from "../src/lib/siba/cash-bank-layer-export";
import type { LayerResourceBlock, LayerRow } from "../src/lib/siba/cash-bank-layers";

/**
 * Posisi Layer Kurs's Unduh XLSX: one block per foreign Cash & Bank, its open
 * layers with the keterangan exactly as stored, closed by the open total. Pure.
 */

const layer = (o: Partial<LayerRow>): LayerRow => ({
  id: 1,
  layerNo: "CBLY-0001",
  date: "2026-05-12",
  seq: 1,
  rate: 16_000,
  foreignOriginal: 100,
  baseOriginal: 1_600_000,
  foreignRemaining: 100,
  baseRemaining: 1_600_000,
  status: "Open",
  note: null,
  ...o,
});

const block = (label: string, o: Partial<LayerResourceBlock>): LayerResourceBlock => ({
  cashBankId: 1,
  label,
  name: label,
  companyLabel: "ABHC",
  currencyLabel: "USD",
  active: true,
  layers: [],
  foreignRemaining: 0,
  baseRemaining: 0,
  averageRate: null,
  reconciles: true,
  ...o,
});

test("Posisi Layer Kurs prints each resource's open layers and their total", async () => {
  const file = await cashBankLayerWorkbook({
    companyName: "ABHC",
    asOf: "2026-10-22",
    report: {
      resources: 2,
      blocks: [
        block("BCA-USD", {
          layers: [
            layer({ layerNo: "CBLY-0003", note: "Saldo awal saat resource didaftarkan." }),
            layer({ layerNo: "CBLY-0006", rate: 16_500, foreignOriginal: 50, foreignRemaining: 20, baseRemaining: 330_000, note: "TRF-0003 — Pembelian Valas" }),
          ],
          foreignRemaining: 120,
          baseRemaining: 1_930_000,
          averageRate: 1_930_000 / 120,
        }),
        block("MDR-EUR", { currencyLabel: "EUR", active: false }),
      ],
    },
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

  assert.equal(ws.getCell(4, 1).value, "Per 22/10/2026");
  // The keterangan is what the layer stores, and nothing beside it.
  assert.deepEqual(
    find(2, "CBLY-").map((r) => r.getCell(3).value),
    ["Saldo awal saat resource didaftarkan.", "TRF-0003 — Pembelian Valas"]
  );
  assert.deepEqual(
    [4, 5, 6, 7].map((c) => find(2, "CBLY-0006")[0].getCell(c).value),
    [16_500, 50, 20, 330_000]
  );
  const totals = find(3, "Total layer terbuka");
  assert.deepEqual([6, 7].map((c) => totals[0].getCell(c).value), [120, 1_930_000]);
  assert.match(totals[0].getCell(6).numFmt, /"USD"/);
  assert.match(totals[0].getCell(7).numFmt, /"IDR"/);
  assert.equal(find(1, "MDR-EUR")[0].getCell(3).value, "MDR-EUR · non-aktif");
  assert.equal(find(3, "Tidak ada layer terbuka").length, 1);
  ws.eachRow((r) => r.eachCell((c) => assert.equal(c.formula, undefined)));
  assert.equal(ws.pageSetup.paperSize, 9);
});
