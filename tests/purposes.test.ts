import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  allPurposes,
  availablePurposes,
  defaultPurposeLabel,
  purposeByKey,
  syncPurposes,
} from "../src/lib/siba/purposes";
import { loadClassification } from "../src/lib/siba/classification-data";
import { strandedCategories } from "../src/lib/siba/records";
import { SEED_PURPOSES } from "../src/lib/siba/rules";
import { FIXTURE_PREFIX, disconnect, prisma, systemUserId } from "./helpers";

/**
 * A Purpose is what lets a Budget Category actually be transacted.
 *
 * The categories became rows first, and for a while the Purposes did not — so a
 * category created through the GUI could be planned against, mapped to an
 * account and given a subject book, and still never reach a Cash Bank
 * Transaction, because no Purpose named it. This suite is about the property
 * that closed: **every classification the matrix implies has a Purpose.**
 */

let actor = 0;

before(async () => {
  actor = await systemUserId();
});

after(async () => {
  await prisma.sysPurpose.deleteMany({
    where: { budget_category: { category_label: { startsWith: FIXTURE_PREFIX } } },
  });
  await prisma.sysBudgetPartnerCategoryMapping.deleteMany({
    where: { budget_category: { category_label: { startsWith: FIXTURE_PREFIX } } },
  });
  await prisma.sysBudgetCategory.deleteMany({
    where: { category_label: { startsWith: FIXTURE_PREFIX } },
  });
  await syncPurposes(prisma, actor);
  await disconnect();
});

describe("the set of Purposes is the classification's cross product", () => {
  test("every implied combination has exactly one Purpose", async () => {
    const catalogue = await loadClassification();
    const purposes = await allPurposes();

    let implied = 0;
    for (const rule of catalogue) {
      if (!rule.active) continue;
      const directions = [
        ...(rule.allowsIn ? ["In" as const] : []),
        ...(rule.allowsOut ? ["Out" as const] : []),
      ];
      const partners = rule.requirePartner ? rule.partnerCategories : [null];
      // A category that names a Partner but admits none yet implies nothing —
      // it is a setup gap, and generating a Purpose with no Partner Category
      // would quietly invent a classification nobody chose.
      if (rule.requirePartner && !rule.partnerCategories.length) continue;

      for (const direction of directions) {
        for (const partner of partners) {
          implied += 1;
          const matches = purposes.filter(
            (p) =>
              p.budgetCategoryId === rule.id &&
              p.direction === direction &&
              p.partnerCategory === partner &&
              p.active
          );
          assert.equal(
            matches.length,
            1,
            `${rule.label} ${direction} ${partner ?? "(no partner)"} should have exactly one active Purpose, found ${matches.length}`
          );
        }
      }
    }

    assert.equal(
      purposes.filter((p) => p.active).length,
      implied,
      "no active Purpose beyond what the classification implies"
    );
  });

  test("the original 22 kept their keys and their wording", async () => {
    for (const seeded of SEED_PURPOSES) {
      const row = await purposeByKey(seeded.key);
      assert.ok(row, `${seeded.key} is missing — a posted document would stop resolving`);
      assert.equal(row.label, seeded.label, `${seeded.key} was reworded by the generator`);
      assert.equal(row.direction, seeded.direction);
      assert.equal(row.budgetCategory, seeded.budgetCategory);
      assert.equal(row.partnerCategory, seeded.partnerCategory);
    }
  });

  test("a generated label names the movement in Indonesian, never the enum", () => {
    assert.equal(
      defaultPurposeLabel("In", "Titipan", "Cabang"),
      "Penerimaan Titipan dari Cabang"
    );
    assert.equal(
      defaultPurposeLabel("Out", "Produksi", "Cabang"),
      "Pengeluaran Produksi ke Cabang"
    );
    assert.equal(defaultPurposeLabel("Out", "Biaya", null), "Pengeluaran Biaya");
  });
});

describe("a new Budget Category can be transacted", () => {
  /**
   * The whole point, end to end: create a category and a pairing exactly as the
   * GUI does, sync, and a Purpose exists for it. If this breaks, a new category
   * is once again a category nobody can raise a document against.
   */
  test("a category created with a pairing gets its Purposes", async () => {
    const partnerCategory = await prisma.sysPartnerCategory.findFirstOrThrow({
      where: { status: "Active" },
      select: { id: true, category_label: true },
    });

    const category = await prisma.sysBudgetCategory.create({
      data: {
        category_code: `bcat.${FIXTURE_PREFIX}1`,
        category_label: `${FIXTURE_PREFIX} Sewa`,
        category_name: `${FIXTURE_PREFIX} Sewa Peralatan`,
        allows_in: true,
        allows_out: true,
        require_partner: true,
        raises: "Out",
        created_by: actor,
      },
      select: { id: true, category_label: true },
    });
    await prisma.sysBudgetPartnerCategoryMapping.create({
      data: {
        mapping_code: `bpcm.${FIXTURE_PREFIX}1`,
        budget_category_id: category.id,
        partner_category_id: partnerCategory.id,
        created_by: actor,
      },
    });

    const before = (await allPurposes()).length;
    const { created } = await syncPurposes(prisma, actor);
    assert.equal(created, 2, "both directions of one pairing should be generated");

    const mine = (await allPurposes()).filter((p) => p.budgetCategoryId === category.id);
    assert.equal(mine.length, 2);
    assert.equal((await allPurposes()).length, before + 2);

    for (const direction of ["In", "Out"] as const) {
      const purpose = mine.find((p) => p.direction === direction);
      assert.ok(purpose, `no Purpose for ${direction}`);
      assert.equal(purpose.partnerCategory, partnerCategory.category_label);
      assert.equal(
        purpose.label,
        defaultPurposeLabel(direction, category.category_label, partnerCategory.category_label)
      );
      assert.ok(purpose.active, "a generated Purpose is immediately usable");
    }

    // And it is offered to a document, which is the thing that was broken.
    const offered = await availablePurposes();
    for (const purpose of mine) {
      assert.ok(
        offered.some((p) => p.key === purpose.key),
        `${purpose.label} was generated but is not offered on a new document`
      );
    }
  });

  test("running the generator again changes nothing", async () => {
    const before = await allPurposes();
    const result = await syncPurposes(prisma, actor);
    assert.deepEqual(result, { created: 0, retired: 0, restored: 0 });
    assert.deepEqual(
      (await allPurposes()).map((p) => p.key),
      before.map((p) => p.key)
    );
  });

  test("a reworded Purpose is never overwritten", async () => {
    const mine = (await allPurposes()).find((p) =>
      p.budgetCategory.startsWith(FIXTURE_PREFIX)
    );
    assert.ok(mine, "the fixture category should hold Purposes");

    await prisma.sysPurpose.update({
      where: { purpose_key: mine.key },
      data: { label: "Pembayaran Sewa Alat Berat" },
    });
    await syncPurposes(prisma, actor);

    assert.equal(
      (await purposeByKey(mine.key))?.label,
      "Pembayaran Sewa Alat Berat",
      "the label is the one thing a person edits here — the generator must leave it alone"
    );
  });
});

describe("a retired classification withdraws its Purposes, and keeps them readable", () => {
  test("retiring a pairing deactivates rather than deletes", async () => {
    const category = await prisma.sysBudgetCategory.findFirstOrThrow({
      where: { category_label: { startsWith: FIXTURE_PREFIX } },
      select: { id: true },
    });
    const keys = (await allPurposes())
      .filter((p) => p.budgetCategoryId === category.id)
      .map((p) => p.key);
    assert.ok(keys.length, "the fixture should hold Purposes to retire");

    await prisma.sysBudgetPartnerCategoryMapping.updateMany({
      where: { budget_category_id: category.id },
      data: { status: "Inactive" },
    });
    const { retired } = await syncPurposes(prisma, actor);
    assert.equal(retired, keys.length);

    const offered = await availablePurposes();
    for (const key of keys) {
      const row = await purposeByKey(key);
      assert.ok(row, `${key} must survive — a posted document still names it`);
      assert.equal(row.active, false);
      assert.ok(
        !offered.some((p) => p.key === key),
        `${key} is retired and must not be offered on a new document`
      );
    }

    // A document already carrying one keeps it, like any deactivated record in
    // the picker that already selected it.
    const kept = await availablePurposes(keys[0]);
    assert.ok(kept.some((p) => p.key === keys[0]));
  });

  test("bringing the pairing back reopens the same Purposes", async () => {
    const category = await prisma.sysBudgetCategory.findFirstOrThrow({
      where: { category_label: { startsWith: FIXTURE_PREFIX } },
      select: { id: true },
    });
    const before = (await allPurposes())
      .filter((p) => p.budgetCategoryId === category.id)
      .map((p) => p.key)
      .sort();

    await prisma.sysBudgetPartnerCategoryMapping.updateMany({
      where: { budget_category_id: category.id },
      data: { status: "Active" },
    });
    const { created, restored } = await syncPurposes(prisma, actor);

    assert.equal(created, 0, "a combination that came back must not create a second Purpose");
    assert.equal(restored, before.length);
    assert.deepEqual(
      (await allPurposes())
        .filter((p) => p.budgetCategoryId === category.id)
        .map((p) => p.key)
        .sort(),
      before,
      "the same keys, so documents posted before the pause still resolve"
    );
  });
});

/**
 * The generator is only as good as the places that call it.
 *
 * `syncPurposes` itself is exercised above, but the property that matters to a
 * user is that they never have to think about it — which depends entirely on
 * every write path that can move the matrix calling it. One of the three was
 * missed once and nothing failed: the Purposes simply drifted from the
 * classification, silently, until somebody noticed a picker offering a retired
 * combination. A source scan is the cheapest thing that catches it.
 */
describe("every write that moves the matrix re-syncs", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/actions/master.ts"),
    "utf8"
  );

  const bodyOf = (fn: string): string => {
    const start = source.indexOf(`export async function ${fn}(`);
    assert.ok(start > 0, `${fn} is missing from master.ts`);
    const next = source.indexOf("\nexport async function ", start + 1);
    return source.slice(start, next === -1 ? source.length : next);
  };

  for (const fn of ["createRecord", "updateRecord", "toggleStatus"]) {
    test(`${fn} calls syncPurposesFor`, () => {
      assert.ok(
        bodyOf(fn).includes("syncPurposesFor("),
        `${fn} can change the classification but never re-derives the Purposes — ` +
          "a new Budget Category would silently have none, or a retired pairing " +
          "would go on being offered"
      );
    });
  }

  test("the three classification entities are the ones it watches", () => {
    const set = source.slice(
      source.indexOf("const CLASSIFICATION_ENTITIES"),
      source.indexOf("async function syncPurposesFor")
    );
    for (const key of [
      "sys_budget_category",
      "sys_partner_category",
      "sys_budget_partner_category_mapping",
    ]) {
      assert.ok(set.includes(key), `${key} moves the matrix but is not watched`);
    }
  });
});

/**
 * A category that cannot do anything must not be reachable.
 *
 * The user's rule: a combination producing a useless result is blocked, not
 * allowed and reported, so nobody can arrive at it by accident and then trust
 * it. Two such combinations existed.
 *
 * `strandedCategories` is the shared question behind the refusals — it lives in
 * `records.ts` so this can drive the real rule, since a Server Action resolves
 * its caller from a session cookie that a test process does not have.
 */
describe("an inert classification cannot be reached", () => {
  test("a category naming a Partner with no pairing is reported as stranded", async () => {
    const actorId = await systemUserId();
    const category = await prisma.sysBudgetCategory.create({
      data: {
        category_code: `bcat.${FIXTURE_PREFIX}2`,
        category_label: `${FIXTURE_PREFIX} Inert`,
        category_name: `${FIXTURE_PREFIX} Inert`,
        allows_out: true,
        require_partner: true,
        // The database itself refuses `raises: null` here, which is the other
        // half of the same rule.
        raises: "Out",
        status: "Active",
        created_by: actorId,
      },
      select: { id: true, category_label: true },
    });

    assert.ok(
      (await strandedCategories({ onlyCategoryId: category.id })).includes(
        category.category_label
      ),
      "an Active category with no pairing generates no Purpose and must be refused"
    );

    // Pair it, and it stops being stranded.
    const partnerCategory = await prisma.sysPartnerCategory.findFirstOrThrow({
      where: { status: "Active" },
      select: { id: true },
    });
    const pairing = await prisma.sysBudgetPartnerCategoryMapping.create({
      data: {
        mapping_code: `bpcm.${FIXTURE_PREFIX}2`,
        budget_category_id: category.id,
        partner_category_id: partnerCategory.id,
        created_by: actorId,
      },
      select: { id: true },
    });
    assert.deepEqual(
      await strandedCategories({ onlyCategoryId: category.id }),
      [],
      "one pairing is enough to make it usable"
    );

    // Each mirror reaches the same state from its own direction.
    assert.ok(
      (await strandedCategories({ ignorePairingId: pairing.id })).includes(
        category.category_label
      ),
      "retiring the last pairing would strand it"
    );
    assert.ok(
      (
        await strandedCategories({ ignorePartnerCategoryId: partnerCategory.id })
      ).includes(category.category_label),
      "deactivating the Partner Category it points at would strand it too"
    );
  });

  test("a category that names no Partner is never stranded", async () => {
    // Asset and Biaya have no pairings and never will. They are not inert: a
    // Purpose is generated for them because they need no Partner to be usable.
    const stranded = await strandedCategories();
    for (const label of ["Asset", "Biaya"]) {
      assert.ok(
        !stranded.includes(label),
        `${label} names no Partner, so having no pairing is correct rather than broken`
      );
    }
  });

  test("the seeded classification strands nothing", async () => {
    const stranded = (await strandedCategories()).filter(
      (l) => !l.startsWith(FIXTURE_PREFIX)
    );
    assert.deepEqual(
      stranded,
      [],
      `these categories are Active but can never be transacted: ${stranded.join(", ")}`
    );
  });
});
