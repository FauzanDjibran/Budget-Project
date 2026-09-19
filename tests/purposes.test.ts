import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  allPurposes,
  availablePurposes,
  purposeByKey,
  purposeLabel,
} from "../src/lib/siba/purposes";
import {
  getRow,
  reconcileMultiref,
  requireEntity,
  strandedCategories,
} from "../src/lib/siba/records";
import { entityBySlug, fieldApplies } from "../src/lib/siba/entities";
import { loadClassification } from "../src/lib/siba/classification-data";
import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import { MODULES } from "../src/lib/siba/nav";
import { SEED_PURPOSES } from "../src/lib/siba/rules";
import { FIXTURE_PREFIX, disconnect, prisma, systemUserId } from "./helpers";

/**
 * A Purpose is what lets a Budget Category actually be transacted, and it is a
 * row somebody **enters**.
 *
 * They were briefly generated from the classification, so a new category was
 * usable the moment it was saved. That is reversed: `sys_purpose` stands in for
 * what a maintainer would type into the database, so nothing writes one on
 * their behalf and a category with none simply cannot be transacted — a
 * maintenance gap, not a fault.
 *
 * What this suite holds is what survives that: the label is composed and cannot
 * drift, a Purpose the classification does not admit is never offered, and
 * nothing anywhere creates one.
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
  await disconnect();
});

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

/**
 * The Partner Categories a Budget Category admits are chosen on the category's
 * own form and written in the same transaction as the category.
 *
 * They used to be a menu of their own, which meant creating a category and
 * saying what it admits were two records, two forms and two saves — and a
 * category saved between them is inert: no Purpose names it and its subject
 * book can receive nothing. One transaction is what makes that state
 * unreachable rather than merely refused.
 */
describe("a category and the Partner Categories it admits are one save", () => {
  const entity = requireEntity("budget-category");
  let categoryId = 0;
  let cabang = 0;
  let karyawan = 0;

  const admitted = async (): Promise<number[]> => {
    const rows = await prisma.sysBudgetPartnerCategoryMapping.findMany({
      where: { budget_category_id: categoryId, status: "Active" },
      select: { partner_category_id: true },
      orderBy: { partner_category_id: "asc" },
    });
    return rows.map((r) => r.partner_category_id);
  };

  const setTo = (ids: number[]) =>
    prisma.$transaction((tx) =>
      reconcileMultiref(tx, entity, categoryId, { partner_category_ids: ids }, actor)
    );

  before(async () => {
    cabang = (
      await prisma.sysPartnerCategory.findFirstOrThrow({
        where: { category_label: "Cabang" },
        select: { id: true },
      })
    ).id;
    karyawan = (
      await prisma.sysPartnerCategory.findFirstOrThrow({
        where: { category_label: "Karyawan" },
        select: { id: true },
      })
    ).id;
    categoryId = (
      await prisma.sysBudgetCategory.create({
        data: {
          category_code: `bcat.${FIXTURE_PREFIX}3`,
          category_label: `${FIXTURE_PREFIX} Pesanan`,
          category_name: `${FIXTURE_PREFIX} Pesanan Pelanggan`,
          allows_in: true,
          allows_out: true,
          require_partner: true,
          raises: "In",
          created_by: actor,
        },
        select: { id: true },
      })
    ).id;
  });

  test("two Partner Categories are admitted in one write", async () => {
    await setTo([cabang, karyawan]);
    assert.deepEqual(
      await admitted(),
      [cabang, karyawan].sort((a, b) => a - b),
      "PESANAN should admit Cabang and Karyawan straight away"
    );
  });

  test("unticking deactivates the row rather than deleting it", async () => {
    await setTo([cabang]);
    assert.deepEqual(await admitted(), [cabang]);

    const retired = await prisma.sysBudgetPartnerCategoryMapping.findFirst({
      where: { budget_category_id: categoryId, partner_category_id: karyawan },
      select: { status: true, mapping_code: true },
    });
    assert.ok(retired, "the row must survive — a Budget classified by it still reads");
    assert.equal(retired.status, "Inactive");
  });

  test("re-ticking reopens the same row, keeping its code", async () => {
    const before = await prisma.sysBudgetPartnerCategoryMapping.findFirstOrThrow({
      where: { budget_category_id: categoryId, partner_category_id: karyawan },
      select: { id: true, mapping_code: true },
    });

    await setTo([cabang, karyawan]);

    const after = await prisma.sysBudgetPartnerCategoryMapping.findFirstOrThrow({
      where: { budget_category_id: categoryId, partner_category_id: karyawan },
      select: { id: true, mapping_code: true, status: true },
    });
    assert.equal(after.id, before.id, "a second row would break the unique index");
    assert.equal(after.mapping_code, before.mapping_code, "its code is its identity");
    assert.equal(after.status, "Active");
    assert.equal(
      await prisma.sysBudgetPartnerCategoryMapping.count({
        where: { budget_category_id: categoryId, partner_category_id: karyawan },
      }),
      1
    );
  });

  test("an empty set retires everything, which is what clearing the flag does", async () => {
    await setTo([]);
    assert.deepEqual(await admitted(), []);
    assert.equal(
      await prisma.sysBudgetPartnerCategoryMapping.count({
        where: { budget_category_id: categoryId },
      }),
      2,
      "retired, not removed"
    );
    // And the category is now stranded, which is the state the form refuses.
    assert.ok(
      (await strandedCategories({ onlyCategoryId: categoryId })).length,
      "a category admitting nothing must be reported as stranded"
    );
    await setTo([cabang, karyawan]);
  });

  test("the pairing has no menu of its own any more", () => {
    assert.equal(
      entityBySlug("budget-partner-category"),
      undefined,
      "the pairing is edited on the Budget Category form, not as its own entity"
    );
    const master = MODULES.find((m) => m.key === "master")!;
    const slugs = master.groups!.flatMap((g) => g.entities.map((e) => e.slug));
    assert.ok(
      !slugs.includes("budget-partner-category"),
      "a menu entry whose route no longer answers"
    );
    assert.ok(
      !PERMISSION_CODES.some((c) => c.startsWith("BUDGET_PARTNER_CATEGORY")),
      "its permissions went with it — nothing reads them now"
    );
  });

  test("the field says it is mandatory exactly when a Partner is named", () => {
    const field = entity.fields.find((f) => f.name === "partner_category_ids");
    assert.ok(field, "Budget Category must offer the Partner Categories it admits");
    assert.equal(field.type, "multiref");
    assert.equal(field.joinTable, "sys_budget_partner_category_mapping");
    // Together these two read as "required when the category names a Partner":
    // `validate` skips a field that does not apply.
    assert.equal(field.required, true);
    assert.equal(field.visibleWhen, "accountRequiresPartner");
  });
});

/**
 * Arah is one answer stored as two booleans.
 *
 * Two checkboxes could both be off — a category that moves in no direction
 * classifies nothing — so the form asks once, with three answers and no fourth.
 * The columns did not change, because every reader still wants the booleans:
 * the subject book's nature, the Purpose generator's direction list, and three
 * CHECK constraints.
 *
 * What that buys is also what it risks: a write half and a read half that must
 * agree. This drives both against the real registry.
 */
describe("Arah is one field over two columns", () => {
  const entity = requireEntity("budget-category");

  test("the form asks once, and cannot be left empty", () => {
    const field = entity.fields.find((f) => f.name === "direction_mode");
    assert.ok(field, "Budget Category must ask for Arah");
    assert.equal(field.required, true);
    assert.equal(field.virtual, true, "it is stored as allows_in / allows_out");
    assert.deepEqual(field.options, ["Out", "In", "Both"]);
    // Direction is never shown as its stored enum (§8).
    assert.deepEqual(Object.values(field.optionLabels ?? {}), [
      "Pengeluaran saja",
      "Penerimaan saja",
      "Keduanya",
    ]);

    for (const gone of ["allows_in", "allows_out"]) {
      assert.ok(
        !entity.fields.some((f) => f.name === gone),
        `${gone} is derived from Arah — offering it again is how both got switched off`
      );
    }
  });

  test("raises is asked only where it is a real choice", () => {
    const field = entity.fields.find((f) => f.name === "raises");
    assert.ok(field);
    assert.equal(field.visibleWhen, "categoryChoosesRaises");

    const applies = (values: Record<string, unknown>) =>
      fieldApplies(field, values, undefined, undefined, []);

    assert.equal(
      applies({ require_partner: true, direction_mode: "Both" }),
      true,
      "a category moving both ways has to say which way its book runs"
    );
    assert.equal(
      applies({ require_partner: true, direction_mode: "Out" }),
      false,
      "a Pengeluaran-only book can only rise on Pengeluaran — asking offers one answer"
    );
    assert.equal(
      applies({ require_partner: false, direction_mode: "Both" }),
      false,
      "a category naming no Partner keeps no book at all"
    );
  });

  test("every seeded category round-trips through the one field", async () => {
    // The read half (`virtualValues` in records.ts) against the write half
    // (`derivedColumns` in master.ts). They are mirrors and must stay in step,
    // or editing a category would silently rewrite its directions.
    const rows = await prisma.sysBudgetCategory.findMany({
      select: { id: true, category_label: true, allows_in: true, allows_out: true },
    });
    assert.ok(rows.length, "the seeded categories should be present");

    for (const row of rows) {
      const read = await getRow(entity, row.id);
      assert.ok(read, `${row.category_label} should be readable`);

      const mode = read.direction_mode;
      const expected =
        row.allows_in && row.allows_out ? "Both" : row.allows_in ? "In" : "Out";
      assert.equal(
        mode,
        expected,
        `${row.category_label} reads back as ${String(mode)}`
      );
    }
  });
});

describe("a Purpose's label is composed, never stored", () => {
  test("the format is direction, category, preposition, partner", () => {
    assert.equal(
      purposeLabel("In", "Titipan", "Cabang"),
      "Penerimaan Titipan dari Cabang"
    );
    assert.equal(
      purposeLabel("Out", "Hutang", "Cabang"),
      "Pengeluaran Hutang ke Cabang"
    );
    // A category naming no Partner has no preposition to hang one off.
    assert.equal(purposeLabel("Out", "Biaya", null), "Pengeluaran Biaya");
    // Direction is never shown as its stored enum (§8).
    for (const label of [
      purposeLabel("In", "X", "Y"),
      purposeLabel("Out", "X", "Y"),
    ]) {
      assert.ok(!/\bIn\b|\bOut\b/.test(label), `${label} shows the raw enum`);
    }
  });

  test("no column holds it, so it cannot disagree with what it names", async () => {
    const columns: { column_name: string }[] = await prisma.$queryRaw`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sys_purpose'`;
    assert.ok(
      !columns.some((c) => c.column_name === "label"),
      "a stored label would survive a Budget Category being renamed"
    );
  });

  test("every Purpose reads in that one format", async () => {
    for (const p of await allPurposes()) {
      assert.equal(
        p.label,
        purposeLabel(p.direction, p.budgetCategory, p.partnerCategory),
        `${p.key} does not read in the standard format`
      );
    }
  });

  test("the seeded 22 kept their keys", async () => {
    // Their wording is gone — "Pemberian Advance kepada Karyawan" is now
    // "Pengeluaran Piutang ke Karyawan" — but the keys are what posted
    // documents reference, so those had to survive.
    for (const seeded of SEED_PURPOSES) {
      const row = await purposeByKey(seeded.key);
      assert.ok(row, `${seeded.key} is missing — a posted document would stop resolving`);
      assert.equal(row.direction, seeded.direction);
      assert.equal(row.budgetCategory, seeded.budgetCategory);
      assert.equal(row.partnerCategory, seeded.partnerCategory);
    }
  });
});

describe("nothing creates a Purpose on the user's behalf", () => {
  const master = readFileSync(
    join(process.cwd(), "src/app/actions/master.ts"),
    "utf8"
  );

  test("no write path generates them", () => {
    // The inverse of an assertion this suite used to carry. Saving a Budget
    // Category, a Partner Category or a pairing must leave `sys_purpose`
    // untouched — the table is a maintainer's to fill.
    assert.ok(
      !/syncPurposes/.test(master),
      "a Budget Category write must not create Purposes; the maintainer enters them"
    );
  });

  test("adding one is an ordinary capability", () => {
    assert.ok(
      PERMISSION_CODES.includes("PURPOSE_CREATE"),
      "a capability is a catalogue entry first"
    );
    const entity = requireEntity("purpose");
    for (const name of ["direction", "budget_category_id", "partner_category_id"]) {
      const field = entity.fields.find((f) => f.name === name);
      assert.ok(field, `a Purpose is chosen by its ${name}`);
      assert.equal(field.locked, true, `${name} is what this Purpose *is*`);
    }
    assert.ok(
      !entity.fields.some((f) => f.name === "label"),
      "the label is composed, so there is nothing to type"
    );
  });

  test("the seed plants the 22 and stops there", () => {
    const seed = readFileSync(join(process.cwd(), "prisma/seed.ts"), "utf8");
    assert.ok(
      !/syncPurposes/.test(seed),
      "the seed plants SEED_PURPOSES and generates nothing beyond them"
    );
  });
});

describe("a Purpose the classification no longer admits is not offered", () => {
  /**
   * The read-side half of going manual. Retiring a pairing leaves the Purpose
   * row exactly as the maintainer left it — nothing is written — but the picker
   * stops offering it, because Budget approval would refuse that classification
   * anyway and the form should not lead an operator there.
   */
  test("retiring a pairing withdraws its Purposes from the picker only", async () => {
    const pairing = await prisma.sysBudgetPartnerCategoryMapping.findFirstOrThrow({
      where: {
        budget_category: { category_label: "Prive" },
        partner_category: { category_label: "Stakeholder" },
      },
      select: { id: true, status: true },
    });

    const before = await availablePurposes();
    const affected = before
      .filter((p) => p.budgetCategory === "Prive")
      .map((p) => p.key);
    assert.ok(affected.length, "Prive should have Purposes to withdraw");

    await prisma.sysBudgetPartnerCategoryMapping.update({
      where: { id: pairing.id },
      data: { status: "Inactive" },
    });
    try {
      const offered = await availablePurposes();
      for (const key of affected) {
        assert.ok(
          !offered.some((p) => p.key === key),
          `${key} rests on a pairing that is no longer admitted`
        );
        // And the row itself is untouched: nothing wrote to it.
        const row = await purposeByKey(key);
        assert.ok(row, `${key} must still exist — a posted document names it`);
        assert.equal(
          row.active,
          true,
          "the Purpose is not retired, only unoffered — nothing writes here"
        );
      }

      // A draft already carrying one keeps it.
      const kept = await availablePurposes(affected[0]);
      assert.ok(kept.some((p) => p.key === affected[0]));
    } finally {
      await prisma.sysBudgetPartnerCategoryMapping.update({
        where: { id: pairing.id },
        data: { status: pairing.status },
      });
    }

    assert.deepEqual(
      (await availablePurposes()).filter((p) => p.budgetCategory === "Prive").map((p) => p.key),
      affected,
      "restoring the pairing offers them again, unchanged"
    );
  });

  test("a seeded database offers every Purpose it holds", async () => {
    const all = await allPurposes();
    const offered = await availablePurposes();
    assert.equal(
      offered.length,
      all.filter((p) => p.active).length,
      "the seeded classification admits every seeded Purpose"
    );
  });
});

describe("the Purpose form never asks a reader to guess", () => {
  const entity = requireEntity("purpose");
  const field = entity.fields.find((f) => f.name === "partner_category_id")!;

  test("Partner Category is asked only where the category names a subject", () => {
    assert.equal(field.visibleWhen, "budgetCategoryRequiresPartner");
    assert.equal(field.required, true, "and is mandatory wherever it is asked");
  });

  test("it applies exactly when the chosen Budget Category takes a Partner", async () => {
    const catalogue = await loadClassification();
    const labelOf = (id: unknown) =>
      catalogue.find((r) => r.id === Number(id))?.label;

    for (const rule of catalogue) {
      assert.equal(
        fieldApplies(field, { budget_category_id: rule.id }, labelOf, undefined, catalogue),
        rule.requirePartner,
        `${rule.label} ${rule.requirePartner ? "takes" : "takes no"} Partner, so the field should ${rule.requirePartner ? "appear" : "not"}`
      );
    }
  });

  test("it offers only what that Budget Category admits", async () => {
    // The picker narrows and `validatePurpose` refuses — the two must agree, or
    // the form offers something the save would reject.
    const catalogue = await loadClassification();
    const all = await prisma.sysPartnerCategory.findMany({
      where: { status: "Active" },
      select: { category_label: true },
    });

    const hutang = catalogue.find((r) => r.label === "Hutang");
    const prive = catalogue.find((r) => r.label === "Prive");
    assert.ok(hutang && prive);

    assert.equal(field.refFilter, "admittedPartnerCategory");
    // Prive admits one of the three; the picker must not show the other two.
    assert.deepEqual(prive.partnerCategories, ["Stakeholder"]);
    assert.ok(
      all.length > prive.partnerCategories.length,
      "there are Partner Categories Prive does not admit — those are the guesswork"
    );
    assert.deepEqual(
      hutang.partnerCategories.slice().sort(),
      ["Cabang", "Karyawan", "Stakeholder"]
    );
  });
});
