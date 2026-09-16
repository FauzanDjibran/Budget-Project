import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { displayAmount, parseAmount } from "../src/components/ui/money-input";
import { RATE_DECIMALS } from "../src/components/ui/rate-input";

/**
 * The one numeric field — every amount, and every kurs.
 *
 * This suite exists because the kurs field once could not accept `16000` at
 * all. It grouped as it typed and then re-read its own `.` as a decimal point,
 * so the fifth digit turned `1.600` into `1.6000` — one and six tenths.
 * Nothing in the build, the types or the server rules could see it: the value
 * handed over was a perfectly valid rate, just not the one anybody typed.
 *
 * What fixes it is one meaning per key. `.` groups thousands, `,` separates
 * decimals, in what is displayed and in what is typed — so re-reading the
 * screen is always a no-op. These are pure string functions, so the suite needs
 * no database and no renderer.
 */

/** Types `keys` into an empty field one keystroke at a time, as the control does. */
function type(keys: string, decimals = 0): string {
  let value = "";
  for (const key of keys) {
    value = parseAmount(displayAmount(value, decimals) + key, decimals);
  }
  return value;
}

describe("an amount field takes digits and groups them as they are typed", () => {
  test("a figure survives being typed one digit at a time", () => {
    assert.equal(type("3243222"), "3243222");
    assert.equal(type("599999"), "599999");
    assert.equal(type("1"), "1");
  });

  test("grouping happens while typing, not after", () => {
    assert.equal(displayAmount("1600"), "1.600");
    assert.equal(displayAmount("3243222"), "3.243.222");
  });

  test("a separator typed into an amount cannot desync it", () => {
    // An amount carries no decimals, so neither separator means anything here.
    assert.equal(parseAmount("1.600.0", 0), "16000");
    assert.equal(parseAmount("1.600,5", 0), "16005");
  });

  test("an empty field is empty, not zero", () => {
    assert.equal(parseAmount("", 0), "");
    assert.equal(displayAmount(""), "");
  });
});

describe("a kurs is the same field, with six decimals", () => {
  const d = RATE_DECIMALS;

  test("a whole rate survives being typed one digit at a time", () => {
    // The original defect: each of these crosses a grouping boundary mid-type.
    assert.equal(type("16000", d), "16000");
    assert.equal(type("15500", d), "15500");
    assert.equal(type("1600000", d), "1600000");
    assert.equal(type("333333333333", d), "333333333333");
  });

  test("and it is grouped while being typed, exactly like an amount", () => {
    assert.equal(displayAmount(type("16000", d), d), "16.000");
    assert.equal(displayAmount(type("1600000", d), d), "1.600.000");
  });

  test("`,` is the decimal separator, and the user reaches it deliberately", () => {
    assert.equal(type("15500,25", d), "15500.25");
    assert.equal(type("0,5", d), "0.5");
    assert.equal(displayAmount(type("15500,25", d), d), "15.500,25");
  });

  test("`.` is the thousands separator, and never a decimal point", () => {
    // One meaning per key, in both directions: a `.` the user types is the
    // separator the field is already inserting, so it is simply dropped.
    assert.equal(type("15500.25", d), "1550025");
    assert.equal(parseAmount("1.600.000", d), "1600000");
  });

  test("the decimal key is not swallowed before its digits arrive", () => {
    // `16.000,` has to survive as a state, or the keypress vanishes under the
    // cursor and the user presses it again.
    assert.equal(displayAmount(type("16000,", d), d), "16.000,");
    assert.equal(parseAmount("16.000,2", d), "16000.2");
  });

  test("a second decimal point is ignored rather than making a second number", () => {
    assert.equal(type("15500,25,7", d), "15500.257");
  });

  test("precision stops at the six decimals the column holds", () => {
    assert.equal(type("1,1234567", d), "1.123456");
  });

  test("what the field displays reads back as what it stores", () => {
    // The invariant the defect broke, and the one that makes grouping-as-typed
    // safe at all: re-parsing the rendered value must be a no-op.
    for (const stored of [
      "1",
      "999",
      "16000",
      "1600000",
      "15500.5",
      "15500.25",
      "0.000001",
      "1600000.123456",
    ]) {
      assert.equal(
        parseAmount(displayAmount(stored, d), d),
        stored,
        `round trip ${stored}`
      );
    }
  });

  test("an empty kurs is empty, not one", () => {
    // `originate` refuses a non-positive rate, and a blank that parsed to "0"
    // or "1" would sail past the form's own required check.
    assert.equal(parseAmount("", d), "");
    assert.equal(parseAmount("   ", d), "");
  });
});
