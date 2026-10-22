import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  formatAccounting,
  formatDate,
  formatMoney,
  formatTimestamp,
  toDisplayDate,
  toIsoDate,
} from "../src/lib/format";

describe("every date reads dd/mm/yyyy", () => {
  test("a calendar date formats day first", () => {
    assert.equal(formatDate("2026-09-02"), "02/09/2026");
    assert.equal(formatDate("2026-12-31"), "31/12/2026");
    // The case that gives the format away: a day that cannot be a month.
    assert.equal(formatDate("2026-01-25"), "25/01/2026");
  });

  test("a timestamp keeps the same date format", () => {
    assert.match(formatTimestamp("2026-09-02T14:05:00Z"), /^02\/09\/2026 • 14:05$/);
  });

  test("an empty value formats to nothing rather than to today", () => {
    assert.equal(formatDate(null), "");
    assert.equal(formatDate(undefined), "");
    assert.equal(formatDate(""), "");
  });

  test("the field's two directions round-trip", () => {
    assert.equal(toDisplayDate("2026-09-02"), "02/09/2026");
    assert.equal(toIsoDate("02/09/2026"), "2026-09-02");
    assert.equal(toIsoDate(toDisplayDate("2028-02-29")), "2028-02-29");
  });

  test("a date that does not exist is refused, not rolled forward", () => {
    // 31/02 parses arithmetically as 3 March; accepting it would save a date
    // nobody typed.
    assert.equal(toIsoDate("31/02/2026"), "");
    assert.equal(toIsoDate("29/02/2026"), "", "2026 is not a leap year");
    assert.equal(toIsoDate("29/02/2028"), "2028-02-29", "2028 is");
    assert.equal(toIsoDate("00/01/2026"), "");
    assert.equal(toIsoDate("01/13/2026"), "");
    assert.equal(toIsoDate("2026-09-02"), "", "ISO is not the input format");
  });
});

/**
 * How the Journal and the General Ledger print a figure: with its currency like
 * every other amount, and a negative in parentheses rather than a minus.
 */
describe("formatAccounting", () => {
  test("a negative reads in parentheses, never with a minus", () => {
    assert.equal(formatAccounting(-1_500_000), "(Rp 1.500.000)");
    assert.equal(formatAccounting(-3500.5, "USD"), "(USD 3.500,50)");
  });

  test("a positive figure is the ordinary money format", () => {
    assert.equal(formatAccounting(1_500_000), formatMoney(1_500_000));
    assert.equal(formatAccounting(1_500_000), "Rp 1.500.000");
  });

  test("a figure that rounds to nil is nil, not (Rp 0)", () => {
    assert.equal(formatAccounting(0), "Rp 0");
    assert.equal(formatAccounting(-0.4), "Rp 0");
    assert.equal(formatAccounting(-0.004, "USD"), "USD 0,00");
    assert.equal(formatAccounting(-0.6), "(Rp 1)");
  });

  test("a stored Decimal is read like a number", () => {
    assert.equal(formatAccounting("-2500"), "(Rp 2.500)");
  });
});
