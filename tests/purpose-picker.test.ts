import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { filterOptions, type SelectOption } from "../src/components/ui/select";
import { SEED_PURPOSES } from "../src/lib/siba/rules";
import { TRANSACTION_TYPE_TEXT } from "../src/lib/siba/transaction-workflow";

/**
 * The Transaction Purpose list — 22 combinations in one dropdown.
 *
 * A Purpose is exactly direction x Budget Category x Partner Category, and its
 * label is that triple written as a sentence. That is what makes the list hard:
 * every label starts with one of five verbs and ends with the Partner Category,
 * so the rows differ from each other at their two extremes and agree in the
 * middle. The list states the Category once per group, the direction in a chip,
 * and the label in full — and the thing that has to keep working is that all
 * three are searchable, because an operator picks a Purpose by naming facets
 * ("pengeluaran cabang") rather than by recalling a sentence.
 *
 * Pure string work over the historical 22, so this needs no database and no
 * renderer. It reads `SEED_PURPOSES` rather than the table deliberately: the
 * property under test is how the *picker* searches, and those 22 are the
 * hardest realistic set — five verbs, every label ending in its Partner
 * Category. A generated label is a strictly easier case.
 */

/** The options exactly as `transaction-form.tsx` builds them. */
const options: SelectOption[] = SEED_PURPOSES.map((p) => ({
  value: p.key,
  label: p.label,
  group: p.budgetCategory,
  hint: TRANSACTION_TYPE_TEXT[p.direction],
}));

const keysFor = (query: string) => filterOptions(options, query).map((o) => o.value).sort();

describe("a Purpose is findable by any facet a reader can see", () => {
  test("every option carries the three facets the screen shows", () => {
    assert.equal(options.length, 22);
    for (const o of options) {
      assert.ok(o.group, `${o.value} must sit under its Budget Category.`);
      assert.ok(
        o.hint === "Penerimaan" || o.hint === "Pengeluaran",
        `${o.value} must state its direction, which its label does not always spell.`
      );
    }
  });

  test("the direction is searchable even where the label never says it", () => {
    // "Pembayaran", "Pemberian", "Pembelian" and "Pengembalian" are all Out and
    // none of them contains the word Pengeluaran. Before the chip carried the
    // direction alone this was the one facet a reader could not type.
    const payment = options.find((o) => o.value === "HTG_CAB_OUT")!;
    assert.doesNotMatch(payment.label.toLowerCase(), /pengeluaran/);
    assert.ok(keysFor("pengeluaran").includes("HTG_CAB_OUT"));

    const out = new Set(keysFor("pengeluaran"));
    const In = new Set(keysFor("penerimaan"));
    assert.equal(out.size + In.size, 22, "Every Purpose is one direction or the other.");
    assert.equal([...out].filter((k) => In.has(k)).length, 0, "and never both.");
  });

  test("the Budget Category is searchable through the group it is stated in", () => {
    // The word is on screen once, as the heading over the run. Typing it must
    // still work, or moving it out of every row would have cost the reader the
    // only way they had to filter by it.
    assert.deepEqual(keysFor("titipan").length, 4);
    assert.deepEqual(keysFor("investasi").sort(), ["HIN_CAB_IN", "INV_CAB_OUT"]);
    assert.deepEqual(keysFor("biaya"), ["BYA_OUT"]);
  });

  test("the Partner Category is searchable, and it is the word that was cut off", () => {
    // Every label that takes a Partner ends with its category, which is exactly
    // where the old 320px list truncated. These are the rows that were
    // unreadable, so they are the ones worth pinning.
    for (const p of SEED_PURPOSES) {
      if (!p.partnerCategory) continue;
      assert.match(
        p.label,
        new RegExp(`${p.partnerCategory}$`),
        `${p.key} should still name its Partner Category last.`
      );
    }
    assert.equal(keysFor("karyawan").length, 4);
    assert.equal(keysFor("stakeholder").length, 8);
  });

  test("naming two facets narrows to their intersection", () => {
    // The whole point of the multi-term rule: no row spells "pengeluaran" and
    // "cabang" in that order, so a single-substring test returned nothing here.
    assert.deepEqual(keysFor("pengeluaran cabang"), [
      "HTG_CAB_OUT",
      "INV_CAB_OUT",
      "PTG_CAB_OUT",
      "TTP_CAB_OUT",
    ]);
    assert.deepEqual(keysFor("penerimaan hutang karyawan"), ["HTG_KRY_IN"]);
    assert.deepEqual(keysFor("prive"), ["PRV_SH_IN", "PRV_SH_OUT"]);
  });

  test("order is preserved, so the groups stay contiguous", () => {
    // The list emits a heading each time `group` changes rather than sorting,
    // so a filter that reordered rows would scatter a category across several
    // headings of the same name.
    const groups = filterOptions(options, "penerimaan").map((o) => o.group!);
    assert.deepEqual([...new Set(groups)].length, new Set(groups).size);
    const seen: string[] = [];
    for (const g of groups) if (g !== seen[seen.length - 1]) seen.push(g);
    assert.deepEqual(seen.length, new Set(seen).size, "A group must appear as one run.");
  });

  test("an empty query keeps all 22, and nonsense keeps none", () => {
    assert.equal(filterOptions(options, "").length, 22);
    assert.equal(filterOptions(options, "   ").length, 22);
    assert.equal(filterOptions(options, "zzz").length, 0);
    assert.equal(filterOptions(options, "cabang zzz").length, 0);
  });

  test("search ignores case and tolerates repeated spaces", () => {
    assert.deepEqual(keysFor("CABANG   pengeluaran"), keysFor("pengeluaran cabang"));
  });
});
