import test, { describe } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";

import type { StatementRow } from "../src/lib/siba/statement-layout";
import { printRows, statementWorkbook } from "../src/lib/siba/statement-export";

/**
 * Unduh XLSX for the statements.
 *
 * The rows come from the statement builders, which their own suites hold; what
 * is held here is the reshaping for paper and the file. Pure — no database.
 */

const row = (r: Partial<StatementRow> & Pick<StatementRow, "key" | "kind" | "depth" | "name">): StatementRow => ({
  code: null,
  values: [],
  ...r,
});

// A Neraca in miniature: a section, a category over two kelompok, a parent
// account over two sub-accounts, a heading over one figure, a Partner split
// and a computed line.
const NERACA: StatementRow[] = [
  row({ key: "s1", kind: "step", depth: 0, name: "AKTIVA" }),
  row({ key: "c1", kind: "category", depth: 1, code: "1.1", name: "AKTIVA LANCAR", values: [600, 500] }),
  row({ key: "u1", kind: "subcategory", depth: 2, code: "1.1.1", name: "KAS / SETARA KAS", values: [400, 300] }),
  row({ key: "a1", kind: "account", depth: 3, code: "1.1.1.2", name: "BANK", values: [400, 300] }),
  row({ key: "a2", kind: "account", depth: 4, code: "1.1.1.2.1", name: "Bank BCA IDR", values: [150, 100] }),
  row({ key: "a3", kind: "account", depth: 4, code: "1.1.1.2.2", name: "Bank BCA USD", values: [250, 200], hasPartners: true }),
  row({ key: "a3p9", kind: "partner", depth: 5, code: "P-9", name: "Partner", values: [250, 200], partnerOf: "a3" }),
  row({ key: "u2", kind: "subcategory", depth: 2, code: "1.1.4", name: "PIUTANG LAIN-LAIN", values: [200, 200] }),
  row({ key: "a4", kind: "account", depth: 3, code: "1.1.4.1", name: "Piutang Karyawan", values: [200, 200] }),
  row({ key: "t1", kind: "subtotal", depth: 0, name: "Total AKTIVA", values: [600, 500] }),
  row({ key: "s3", kind: "step", depth: 0, name: "EKUITAS" }),
  row({ key: "c3", kind: "category", depth: 1, code: "3.4", name: "LABA/RUGI TAHUN BERJALAN", values: [600, 500] }),
  row({ key: "a9", kind: "account", depth: 2, code: "3.4.1.1", name: "Laba/Rugi Tahun Berjalan", values: [600, 500], computed: true }),
  row({ key: "t3", kind: "subtotal", depth: 0, name: "Total EKUITAS", values: [600, 500] }),
];

describe("printRows", () => {
  const out = printRows(NERACA, (r) => r.key === "t1");
  const names = out.filter((p) => p.kind !== "blank").map((p) => `${p.kind}:${p.name}`);

  test("a heading's figure moves to a Jumlah line after what it holds", () => {
    assert.deepEqual(names, [
      "heading:AKTIVA",
      "heading:AKTIVA LANCAR",
      "heading:KAS / SETARA KAS",
      "heading:BANK",
      "line:Bank BCA IDR",
      "line:Bank BCA USD",
      "total:Jumlah Bank",
      // KAS / SETARA KAS holds BANK alone, but BANK is a heading, so it closes too
      "total:Jumlah Kas / Setara Kas",
      "heading:PIUTANG LAIN-LAIN",
      "line:Piutang Karyawan",
      "total:Jumlah Aktiva Lancar",
      "result:Total AKTIVA",
      "heading:EKUITAS",
      "heading:LABA/RUGI TAHUN BERJALAN",
      "line:Laba/Rugi Tahun Berjalan",
      "result:Total EKUITAS",
    ]);
  });

  test("a heading over a single figure prints no Jumlah", () => {
    assert.ok(!names.includes("total:Jumlah Piutang Lain-lain"));
    assert.ok(!names.includes("total:Jumlah Laba/Rugi Tahun Berjalan"));
  });

  test("Partner rows are left out, and a Jumlah carries its heading's figures", () => {
    assert.ok(!out.some((p) => p.name === "Partner"));
    assert.deepEqual(out.find((p) => p.name === "Jumlah Bank")?.values, [400, 300]);
  });

  test("the grand total is marked, a computed line keeps its mark", () => {
    assert.equal(out.find((p) => p.name === "Total AKTIVA")?.double, true);
    assert.equal(out.find((p) => p.name === "Total EKUITAS")?.double, false);
    assert.equal(out.find((p) => p.name === "Laba/Rugi Tahun Berjalan")?.computed, true);
  });

  test("a Laba Rugi step with no accounts prints its nil figure", () => {
    const pl = printRows([
      row({ key: "sHPP", kind: "step", depth: 0, name: "Harga Pokok Penjualan", values: [0] }),
      row({ key: "tHPP", kind: "subtotal", depth: 0, name: "Laba Kotor", values: [10] }),
    ]);
    assert.deepEqual(
      pl.map((p) => [p.kind, p.name, p.values]),
      [
        ["heading", "Harga Pokok Penjualan", [0]],
        ["result", "Laba Kotor", [10]],
      ]
    );
  });
});

describe("statementWorkbook", () => {
  const base = {
    companyName: "ABHC & Co",
    title: "LAPORAN POSISI KEUANGAN (NERACA)",
    subtitle: "Per 30/09/2026",
    pageTitle: "Neraca · per 30/09/2026",
    rows: NERACA,
    grandTotal: (r: StatementRow) => r.key === "t1",
    footnotes: ["Catatan."],
    printedBy: "Tester",
    printedAt: "22/10/2026 • 14:05",
  };

  for (const compare of [false, true]) {
    test(`writes plain values on an A4 page${compare ? ", with Pembanding" : ""}`, async () => {
      const columns = compare
        ? [{ role: "Periode Ini", dates: "30/09/2026" }, { role: "Pembanding", dates: "31/12/2025" }]
        : [{ role: "Saldo", dates: "30/09/2026" }];
      const file = await statementWorkbook({ ...base, columns });

      const sheet = await (await JSZip.loadAsync(file)).file("xl/worksheets/sheet1.xml")!.async("string");
      assert.ok(!sheet.includes("<f>"), "no formulas");
      assert.ok(!sheet.includes("outlinePr"), "Excel rejects exceljs's outlinePr placement");
      assert.ok(!sheet.includes("<pane"), "no frozen panes");
      assert.ok(sheet.includes('paperSize="9"'), "A4");

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      const byName = new Map<string, ExcelJS.Row>();
      ws.eachRow((r) => byName.set(String(r.getCell(2).value), r));

      assert.equal(ws.columnCount, compare ? 6 : 3);
      assert.equal(byName.get("Jumlah Bank")?.getCell(3).value, 400);
      assert.equal(byName.get("Laba/Rugi Tahun Berjalan *")?.getCell(3).value, 600);
      if (compare) {
        assert.equal(byName.get("Jumlah Bank")?.getCell(4).value, 300);
        assert.equal(byName.get("Jumlah Bank")?.getCell(5).value, 100);
        assert.equal(byName.get("Jumlah Bank")?.getCell(6).value, 100 / 300);
      }
      assert.equal(ws.getCell("A1").value, "ABHC & Co");
      assert.match(ws.headerFooter.oddHeader ?? "", /ABHC && Co/);
    });
  }
});
