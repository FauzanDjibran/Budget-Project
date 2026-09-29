import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { formatAccounting, formatMoney } from "../src/lib/format";

/**
 * How the Journal and the General Ledger print a figure: a negative in
 * parentheses, and the currency symbol only where no column header states it.
 */
describe("formatAccounting", () => {
  test("a negative reads in parentheses, never with a minus", () => {
    assert.equal(formatAccounting(-1_500_000), "(Rp 1.500.000)");
    assert.equal(formatAccounting(-1_500_000, "IDR", { symbol: false }), "(1.500.000)");
    assert.equal(formatAccounting(-3500.5, "USD"), "(USD 3.500,50)");
  });

  test("a positive figure is the ordinary money format", () => {
    assert.equal(formatAccounting(1_500_000), formatMoney(1_500_000));
    assert.equal(formatAccounting(1_500_000, "IDR", { symbol: false }), "1.500.000");
  });

  test("a figure that rounds to nil is nil, not (0)", () => {
    assert.equal(formatAccounting(0, "IDR", { symbol: false }), "0");
    assert.equal(formatAccounting(-0.4, "IDR", { symbol: false }), "0");
    assert.equal(formatAccounting(-0.004, "USD"), "USD 0,00");
    assert.equal(formatAccounting(-0.6, "IDR", { symbol: false }), "(1)");
  });

  test("a stored Decimal is read like a number", () => {
    assert.equal(formatAccounting("-2500", "IDR", { symbol: false }), "(2.500)");
  });
});
