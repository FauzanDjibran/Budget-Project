import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

import { trialBalanceWorkbook } from "../src/lib/siba/trial-balance-export";
import type { StatementRow } from "../src/lib/siba/statement-layout";

/**
 * The Trial Balance's Unduh XLSX: the tree printed open with a Jumlah per
 * heading, the four columns the screen reads, and one JUMLAH line carrying the
 * movement totals. Pure.
 */

const row = (o: Partial<StatementRow> & Pick<StatementRow, "kind" | "depth" | "name" | "values">): StatementRow => ({
  key: o.name,
  code: null,
  ...o,
});

test("prints the tree open, Jumlah per heading, and the movement totals, on A4 portrait", async () => {
  const rows: StatementRow[] = [
    row({ kind: "step", depth: 0, code: "1", name: "AKTIVA", values: [100, 50, 20, 130] }),
    row({ kind: "subcategory", depth: 1, code: "1.1.1", name: "KAS / SETARA KAS", values: [100, 50, 20, 130] }),
    row({ kind: "account", depth: 2, code: "1.1.1.1", name: "Kas Besar", values: [60, 50, 0, 110] }),
    row({ kind: "account", depth: 2, code: "1.1.1.2", name: "Bank", values: [40, 0, 20, 20] }),
    row({ kind: "step", depth: 0, code: "3", name: "EKUITAS", values: [100, 20, 50, 130] }),
    row({ kind: "account", depth: 1, code: "3.1.1.1", name: "Modal Disetor", values: [100, 20, 50, 130] }),
  ];

  const file = await trialBalanceWorkbook({
    companyName: "ABHC",
    subtitle: "Untuk periode 01/01/2026 s.d. 30/09/2026",
    rows,
    totalDebit: 70,
    totalCredit: 70,
    footnotes: ["Catatan."],
    printedBy: "Tester",
    printedAt: "22/10/2026 08:00",
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const all: ExcelJS.Row[] = [];
  ws.eachRow((r) => all.push(r));
  const named = (name: string) => all.find((r) => r.getCell(2).value === name)!;
  const figures = (r: ExcelJS.Row) => [3, 4, 5, 6].map((c) => r.getCell(c).value ?? null);

  assert.equal(ws.getCell(3, 1).value, "NERACA SALDO (TRIAL BALANCE)");
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((c) => ws.getCell(7, c).value),
    ["Kode", "Akun", "Saldo Awal", "Mutasi Debit", "Mutasi Kredit", "Saldo Akhir"]
  );
  // A heading moves its figure to the Jumlah line after its children.
  assert.deepEqual(figures(named("AKTIVA")), [null, null, null, null]);
  assert.deepEqual(figures(named("Kas Besar")), [60, 50, 0, 110]);
  assert.deepEqual(figures(named("Jumlah Kas / Setara Kas")), [100, 50, 20, 130]);
  assert.deepEqual(figures(named("Jumlah Aktiva")), [100, 50, 20, 130]);
  assert.deepEqual(figures(named("JUMLAH")), [null, 70, 70, null]);

  ws.eachRow((r) => r.eachCell((c) => assert.equal(c.formula, undefined)));
  assert.equal(ws.pageSetup.paperSize, 9);
  assert.equal(ws.pageSetup.orientation, "portrait");
});
