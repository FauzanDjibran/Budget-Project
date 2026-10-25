import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

import { ledgerWorkbook } from "../src/lib/siba/ledger-export";
import type { LedgerAccount, LedgerEntry } from "../src/lib/siba/ledger";

/**
 * The General Ledger's Unduh XLSX: each account opens on its Saldo Awal, runs
 * its Saldo entry by entry and closes on a Saldo Akhir that reconciles. Pure.
 */

const entry = (o: Partial<LedgerEntry>): LedgerEntry => ({
  journalId: 1,
  journalNo: "JRN-0001",
  date: "2026-01-09",
  description: "",
  partnerLabel: null,
  partnerName: null,
  partnerMismatch: null,
  debit: 0,
  credit: 0,
  balance: 0,
  trxAmount: null,
  trxCurrencyLabel: null,
  rate: null,
  ...o,
});

const account = (o: Partial<LedgerAccount>): LedgerAccount => ({
  id: 1,
  label: "1.1.1.2.1",
  name: "BCA IDR",
  companyLabel: "ABHC",
  normalBalance: "Debit",
  requirePartner: false,
  opening: 0,
  debit: 0,
  credit: 0,
  closing: 0,
  foreignCurrencies: [],
  entryCount: o.entries?.length ?? 0,
  mismatchCount: 0,
  entries: [],
  ...o,
});

test("each account runs from Saldo Awal to a Saldo Akhir, on A4 portrait, with no formula", async () => {
  const file = await ledgerWorkbook({
    companyName: "ABHC & Co",
    subtitle: "Untuk periode 01/01/2026 s.d. 30/09/2026",
    accounts: [
      account({
        opening: 1000,
        debit: 500,
        credit: 200,
        closing: 1300,
        entries: [
          entry({ journalNo: "JRN-0002", description: "Terima", debit: 500, balance: 1500 }),
          entry({
            journalNo: "JRN-0003",
            description: "Bayar",
            credit: 200,
            balance: 1300,
            partnerLabel: "part.0001",
            partnerName: "PLN",
            trxAmount: 10,
            trxCurrencyLabel: "USD",
            rate: 20,
          }),
        ],
      }),
      account({ id: 2, label: "2.1.1", name: "Hutang", normalBalance: "Kredit", opening: 50, closing: 50 }),
    ],
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
  const figures = (r: ExcelJS.Row) => [5, 6, 7].map((c) => r.getCell(c).value ?? null);

  assert.deepEqual(find(4, "Saldo Awal").map((r) => r.getCell(7).value), [1000, 50]);
  assert.deepEqual(figures(find(2, "JRN-0002")[0]), [500, null, 1500]);
  const paid = find(2, "JRN-0003")[0];
  assert.deepEqual(figures(paid), [null, 200, 1300]);
  assert.equal(paid.getCell(3).value, "part.0001 – PLN");
  assert.match(String(paid.getCell(4).value), /^Bayar · USD 10,00 @ 20,00$/);

  const closing = find(4, "Saldo Akhir");
  assert.deepEqual(closing.map(figures), [[500, 200, 1300], [0, 0, 50]]);
  assert.equal(find(4, "Tidak ada mutasi").length, 1);

  ws.eachRow((r) => r.eachCell((c) => assert.equal(c.formula, undefined)));
  assert.equal(ws.pageSetup.paperSize, 9);
  assert.equal(ws.pageSetup.orientation, "portrait");
});
