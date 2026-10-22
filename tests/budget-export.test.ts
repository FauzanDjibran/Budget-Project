import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

import { pengajuanWorkbook } from "../src/lib/siba/budget-export";

/**
 * Laporan Pengajuan's Unduh XLSX: each currency opens on its cash, the Saldo
 * runs row by row, and one Jumlah per currency reconciles. Pure — no database.
 */

test("the Saldo runs from the cash, and each currency closes on its own Jumlah", async () => {
  const file = await pengajuanWorkbook({
    companyName: "ABHC & SBTC",
    subtitle: "Diajukan per 22/10/2026",
    sections: [
      {
        heading: "RUPIAH (IDR)",
        currency: "IDR",
        cash: [
          { name: "BCA", company: "ABHC", balance: 1000 },
          { name: "Mandiri", company: "ABHC", balance: 500 },
        ],
        budgets: [
          { no: "BGT-0001", date: "01/10/2026", description: "Gaji", company: "ABHC", type: "Out", amount: 2000 },
          { no: "BGT-0002", date: "02/10/2026", description: "Terima", company: "ABHC", type: "In", amount: 800 },
        ],
      },
      { heading: "US DOLLAR (USD)", currency: "USD", cash: [{ name: "BCA USD", company: "ABHC", balance: 10 }], budgets: [] },
    ],
    footnotes: [],
    printedBy: "Tester",
    printedAt: "22/10/2026 08:00",
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const byNo = new Map<string, ExcelJS.Row>();
  ws.eachRow((r) => byNo.set(String(r.getCell(1).value ?? r.getCell(3).value ?? ""), r));

  assert.equal(byNo.get("BGT-0001")!.getCell(7).value, -500);
  assert.equal(byNo.get("BGT-0002")!.getCell(7).value, 300);
  const idr = byNo.get("JUMLAH PENGAJUAN IDR")!;
  assert.deepEqual([5, 6, 7].map((c) => idr.getCell(c).value), [2000, 800, 300]);
  const usd = byNo.get("JUMLAH PENGAJUAN USD")!;
  assert.deepEqual([5, 6, 7].map((c) => usd.getCell(c).value), [0, 0, 10]);

  ws.eachRow((r) => r.eachCell((c) => assert.equal(c.formula, undefined)));
  assert.equal(ws.pageSetup.paperSize, 9);
});
