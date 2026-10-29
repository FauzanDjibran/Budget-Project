import test, { after, describe } from "node:test";
import assert from "node:assert/strict";

import { loadClassification } from "../src/lib/siba/classification-data";
import {
  allowedPartnerCategories,
  budgetCategoryAllowsDirection,
  budgetCategoryNeedsPartner,
  directionText,
  directionsOf,
  ruleFor,
} from "../src/lib/siba/classification";
import { FIXTURE_PREFIX, cleanupFixtures, disconnect, makeBudgetCategory, prisma } from "./helpers";

/**
 * The Budget Category rules used to be a constant compiled into the build. They
 * are rows now, which buys the ability to reshape the model while it is still
 * being discovered and costs exactly one new failure mode: a rule can change
 * under a system already built on it.
 *
 * These are the properties that failure mode would break.
 */

after(async () => {
  await cleanupFixtures();
  await disconnect();
});

describe("the catalogue is what the seed declared", () => {
  test("every seeded category carries a direction and a partner decision", async () => {
    const catalogue = await loadClassification();
    assert.ok(catalogue.length >= 6, "the six seeded categories should be present");

    for (const rule of catalogue) {
      assert.ok(
        rule.allowsIn || rule.allowsOut,
        `${rule.label} allows neither direction, so it could classify no Budget at all`
      );
      // The flag and the pairs have to agree. A category requiring a Partner
      // with no pair configured is a setup gap the screen reports; one that
      // requires none must hold no pairs at all.
      if (!rule.requirePartner) {
        assert.equal(
          rule.partnerCategories.length,
          0,
          `${rule.label} takes no Partner but admits ${rule.partnerCategories.join(", ")}`
        );
      }
    }
  });

  test("Asset and Biaya name no subject; the books and their (N) versions do", async () => {
    const catalogue = await loadClassification();
    for (const label of ["Asset", "Biaya"]) {
      assert.equal(
        budgetCategoryNeedsPartner(catalogue, label),
        false,
        `${label} should name no Partner`
      );
    }
    const subjects = ["Piutang", "Hutang", "Piutang (N)", "Hutang (N)"];
    for (const label of subjects) {
      assert.equal(
        budgetCategoryNeedsPartner(catalogue, label),
        true,
        `${label} should name a Partner`
      );
      assert.ok(
        allowedPartnerCategories(catalogue, label).length > 0,
        `${label} requires a Partner but admits no Partner Category`
      );
    }
  });

  test("direction still follows balance-sheet logic", async () => {
    const c = await loadClassification();
    assert.equal(budgetCategoryAllowsDirection(c, "Biaya", "In"), false);
    assert.equal(budgetCategoryAllowsDirection(c, "Biaya", "Out"), true);
    assert.equal(budgetCategoryAllowsDirection(c, "Asset", "In"), false);
    assert.equal(budgetCategoryAllowsDirection(c, "Asset", "Out"), true);
    assert.equal(budgetCategoryAllowsDirection(c, "Hutang", "In"), true);
    assert.equal(budgetCategoryAllowsDirection(c, "Hutang", "Out"), true);
  });

  test("an unknown category admits nothing rather than everything", async () => {
    const c = await loadClassification();
    assert.equal(ruleFor(c, "Tidak Ada"), undefined);
    assert.equal(budgetCategoryNeedsPartner(c, "Tidak Ada"), false);
    assert.deepEqual(allowedPartnerCategories(c, "Tidak Ada"), []);
    assert.equal(budgetCategoryAllowsDirection(c, "Tidak Ada", "Out"), false);
  });
});

describe("direction is written for the user, never shown raw", () => {
  test("In and Out read as Penerimaan and Pengeluaran", () => {
    assert.equal(directionText("In"), "Penerimaan");
    assert.equal(directionText("Out"), "Pengeluaran");
  });

  test("directionsOf lists them in the order a form asks them", () => {
    assert.deepEqual(directionsOf({ allowsIn: true, allowsOut: true }), ["In", "Out"]);
    assert.deepEqual(directionsOf({ allowsIn: false, allowsOut: true }), ["Out"]);
    assert.deepEqual(directionsOf({ allowsIn: false, allowsOut: false }), []);
  });
});

/**
 * Retiring a category's only pairing must withdraw what rests on it — the form
 * must not offer a classification the approval chain would then refuse.
 * A fixture category admitting exactly one Partner Category, so retiring that
 * one row empties it.
 */
describe("retiring a pair withdraws what rests on it", () => {
  test("a deactivated pair leaves the catalogue but not the table", async () => {
    await makeBudgetCategory({
      label: "Satu Pasangan",
      directions: ["In", "Out"],
      partnerCategoryLabels: ["Stakeholder"],
      raises: "Out",
    });
    const label = `${FIXTURE_PREFIX} Satu Pasangan`;
    const pair = {
      budget_category: { category_label: label },
      partner_category: { category_label: "Stakeholder" },
    };
    const row = await prisma.sysBudgetPartnerCategoryMapping.findFirstOrThrow({ where: pair });
    await prisma.sysBudgetPartnerCategoryMapping.update({ where: { id: row.id }, data: { status: "Inactive" } });

    const catalogue = await loadClassification();
    assert.deepEqual(allowedPartnerCategories(catalogue, label), [], "a retired pair should stop being admitted");
    assert.ok(
      await prisma.sysBudgetPartnerCategoryMapping.findFirst({ where: pair }),
      "the row must survive — every Budget already classified by it still reads"
    );

    // And it comes back, which is what makes deactivation reversible where a
    // delete would not have been.
    await prisma.sysBudgetPartnerCategoryMapping.update({ where: { id: row.id }, data: { status: "Active" } });
    assert.deepEqual(allowedPartnerCategories(await loadClassification(), label), ["Stakeholder"]);
  });

});

