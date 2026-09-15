import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES } from "../src/lib/siba/entities";
import { entityPermissions } from "../src/lib/siba/entity-access";
import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import {
  SEGMENT_MAX,
  SEGMENT_MIN,
  codeDepth,
  compareCodes,
  isUnder,
  joinCode,
  parentCode,
  parseSegment,
} from "../src/lib/siba/account-code";
import {
  CASH_BANK_SUBCATEGORY,
  accountDescendants,
  checkAccountNumber,
  checkCashBankAccount,
  partnerCategoriesForBudgetCategory,
} from "../src/lib/siba/records";
import {
  FIXTURE_PREFIX,
  childCompanyId,
  subcategoryId,
  cleanupFixtures,
  disconnect,
  makeAccount,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The Accounting module's enforcement points, checked against a real database.
 *
 * The rules here are the ones a hand-crafted request would have to get past:
 * which account a Cash & Bank resource may post to, whether a parent account
 * would close a loop, and which Partner Categories a Budget Category admits.
 * The form narrows its options to the same sets, but that is presentation.
 *
 * The chart of accounts is business data a real user builds, so this suite
 * builds its own and removes it afterwards rather than assuming any account
 * exists.
 */

after(async () => {
  await cleanupFixtures();
  await disconnect();
});

let parent = 0;
let child = 0;

/** A postable Kas account on the parent Company. */
let cash = 0;
/** A header account with one postable Bank account beneath it. */
let bankHeader = 0;
let bankLeaf = 0;
/** A postable account outside the Kas/Bank groups. */
let receivable = 0;
/** A postable Kas account belonging to the *other* Company. */
let foreignCash = 0;
/** A deactivated Kas account. */
let inactiveCash = 0;
/** Holds the number the uniqueness cases contest, on the parent Company. */
let contested = 0;

before(async () => {
  parent = await parentCompanyId();
  child = await childCompanyId();

  cash = await makeAccount({ companyId: parent, subcategoryLabel: CASH_BANK_SUBCATEGORY });
  bankHeader = await makeAccount({
    companyId: parent,
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
    postable: false,
  });
  bankLeaf = await makeAccount({
    companyId: parent,
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
    parentId: bankHeader,
  });
  receivable = await makeAccount({ companyId: parent, subcategoryLabel: "1.1.3" });
  foreignCash = await makeAccount({ companyId: child, subcategoryLabel: CASH_BANK_SUBCATEGORY });
  inactiveCash = await makeAccount({
    companyId: parent,
    subcategoryLabel: CASH_BANK_SUBCATEGORY,
    active: false,
  });

  contested = (
    await prisma.accAccount.create({
      data: {
        account_code: `${FIXTURE_PREFIX}.contested`,
        account_label: `${CASH_BANK_SUBCATEGORY}.987`,
        account_name: "Fixture Nomor Diperebutkan",
        company_id: parent,
        account_subcategory_id: await subcategoryId(CASH_BANK_SUBCATEGORY),
        normal_balance: "Debit",
        created_by: await systemUserId(),
      },
      select: { id: true },
    })
  ).id;
});

describe("every registry entity declares its permissions", () => {
  test("each operation names a permission that exists in the catalogue", () => {
    for (const entity of ENTITIES) {
      const perms = entityPermissions(entity.key);
      for (const [operation, code] of Object.entries(perms)) {
        if (!code) continue;
        assert.ok(
          PERMISSION_CODES.includes(code),
          `${entity.key}.${operation} names ${code}, which is not in the catalogue`
        );
      }
    }
  });

  test("an entity whose status cannot be toggled declares no activate permission", () => {
    for (const entity of ENTITIES) {
      if (entity.statusModel?.toggle) continue;
      const perms = entityPermissions(entity.key);
      assert.equal(
        perms.activate,
        undefined,
        `${entity.key} has no status toggle but claims an activate permission`
      );
      assert.equal(perms.deactivate, undefined, `${entity.key}: same for deactivate`);
    }
  });
});

describe("a Cash & Bank resource may only post to an eligible account", () => {
  test("accepts a postable Kas or Bank account owned by the same Company", async () => {
    assert.equal(await checkCashBankAccount(cash, parent), null);
    assert.equal(await checkCashBankAccount(bankLeaf, parent), null);
  });

  test("refuses an account owned by the other Company", async () => {
    const problem = await checkCashBankAccount(foreignCash, parent);
    assert.match(String(problem), /Company yang sama/);
  });

  test("refuses a header account, which cannot receive a Journal Line", async () => {
    const problem = await checkCashBankAccount(bankHeader, parent);
    assert.match(String(problem), /postable/);
  });

  test("refuses a postable account outside the Kas / Setara Kas group", async () => {
    const row = await prisma.accAccount.findUniqueOrThrow({
      where: { id: receivable },
      select: {
        is_postable: true,
        account_subcategory: { select: { subcategory_label: true } },
      },
    });
    assert.equal(row.is_postable, true, "only the group rule may stop this one");
    assert.notEqual(row.account_subcategory.subcategory_label, CASH_BANK_SUBCATEGORY);

    const problem = await checkCashBankAccount(receivable, parent);
    assert.match(String(problem), /Kas \/ Setara Kas/);
  });

  test("refuses a deactivated account", async () => {
    const problem = await checkCashBankAccount(inactiveCash, parent);
    assert.match(String(problem), /non-aktif/);
  });

  test("refuses an account that does not exist", async () => {
    const problem = await checkCashBankAccount(999_999_999, parent);
    assert.match(String(problem), /tidak ditemukan/);
  });
});

describe("an account cannot become its own ancestor", () => {
  test("descendants of a header include the accounts under it", async () => {
    const descendants = await accountDescendants(bankHeader);
    assert.ok(descendants.has(bankHeader), "the root is part of its own subtree");
    assert.ok(
      descendants.has(bankLeaf),
      "a child must be refused as its parent's parent"
    );
  });

  test("a leaf has no descendants but itself", async () => {
    const descendants = await accountDescendants(bankLeaf);
    assert.deepEqual([...descendants], [bankLeaf]);
  });
});

describe("a mapping's Partner Category follows the Budget Category", () => {
  test("Prive admits Stakeholder and nothing else", async () => {
    const category = await prisma.sysBudgetCategory.findFirstOrThrow({
      where: { category_label: "Prive" },
      select: { id: true },
    });
    const rule = await partnerCategoriesForBudgetCategory(category.id);
    assert.ok(rule);
    assert.equal(rule.needsPartner, true);

    const allowed = await prisma.sysPartnerCategory.findMany({
      where: { id: { in: rule.allowedIds } },
      select: { category_label: true },
    });
    assert.deepEqual(allowed.map((a) => a.category_label), ["Stakeholder"]);
  });

  test("Biaya takes no Partner Category at all", async () => {
    const category = await prisma.sysBudgetCategory.findFirstOrThrow({
      where: { category_label: "Biaya" },
      select: { id: true },
    });
    const rule = await partnerCategoriesForBudgetCategory(category.id);
    assert.ok(rule);
    assert.equal(rule.needsPartner, false);
    assert.deepEqual(rule.allowedIds, []);
  });
});

/**
 * The chart of accounts is one numbering scheme, and its whole value is that a
 * code cannot disagree with where the row sits. These are the two halves of
 * that: what counts as a segment, and whether the seeded skeleton the user's
 * accounts hang off is actually well formed.
 */
describe("an account code states its own lineage", () => {
  test("a segment is a whole number 1-999 and nothing else", () => {
    assert.equal(parseSegment("1"), SEGMENT_MIN);
    assert.equal(parseSegment("999"), SEGMENT_MAX);
    assert.equal(parseSegment(" 42 "), 42);

    for (const bad of ["0", "1000", "007", "1.2", "-1", "", "  ", "1a", null]) {
      assert.equal(parseSegment(bad), null, `${JSON.stringify(bad)} is not a segment`);
    }
  });

  test("a leading zero is refused rather than trimmed", () => {
    // Otherwise 1.1.1.01 and 1.1.1.1 would be two spellings of one account.
    assert.equal(codeDepth("1.1.1.01"), 0);
    assert.equal(codeDepth("1.1.1.1"), 4);
  });

  test("a code knows its depth and its parent", () => {
    assert.equal(codeDepth("1"), 1);
    assert.equal(codeDepth("1.1.1.2.1"), 5);
    assert.equal(parentCode("1.1.1.2"), "1.1.1");
    assert.equal(parentCode("1"), null);
    assert.equal(joinCode("1.1.1", 2), "1.1.1.2");
  });

  test("a subtree is recognised by its prefix, not by string matching", () => {
    assert.ok(isUnder("1.1.1.2", "1.1.1"));
    assert.ok(isUnder("1.1.1", "1.1.1"));
    assert.ok(!isUnder("1.1.10", "1.1.1"), "1.1.10 is a sibling, not a child");
  });

  test("codes order as numbers, so 1.1.2 comes before 1.1.10", () => {
    const sorted = ["1.1.10", "1.1.2", "1.2", "1.1"].sort(compareCodes);
    assert.deepEqual(sorted, ["1.1", "1.1.2", "1.1.10", "1.2"]);
  });

  test("the seeded skeleton is exactly three levels, each continuing its parent", async () => {
    const [types, categories, subcategories] = await Promise.all([
      prisma.sysAccountType.findMany({ select: { type_label: true } }),
      prisma.accAccountCategory.findMany({
        select: { category_label: true, account_type: { select: { type_label: true } } },
      }),
      prisma.accAccountSubcategory.findMany({
        select: {
          subcategory_label: true,
          account_category: { select: { category_label: true } },
        },
      }),
    ]);

    for (const t of types) assert.equal(codeDepth(t.type_label), 1, t.type_label);

    for (const c of categories) {
      assert.equal(codeDepth(c.category_label), 2, c.category_label);
      assert.equal(
        parentCode(c.category_label),
        c.account_type.type_label,
        `${c.category_label} must continue its account type's code`
      );
    }

    for (const sub of subcategories) {
      assert.equal(codeDepth(sub.subcategory_label), 3, sub.subcategory_label);
      assert.equal(
        parentCode(sub.subcategory_label),
        sub.account_category.category_label,
        `${sub.subcategory_label} must continue its category's code`
      );
    }
  });

  test("the kelompok Cash & Bank posts into is one that exists", async () => {
    const row = await prisma.accAccountSubcategory.findUnique({
      where: { subcategory_label: CASH_BANK_SUBCATEGORY },
      select: { subcategory_name: true },
    });
    assert.ok(
      row,
      `${CASH_BANK_SUBCATEGORY} must be seeded — checkCashBankAccount refuses everything otherwise`
    );
  });

  test("a fixture account's number continues whatever it hangs under", async () => {
    const kelompok = await makeAccount({
      companyId: await parentCompanyId(),
      subcategoryLabel: CASH_BANK_SUBCATEGORY,
    });
    const parent = await prisma.accAccount.findUniqueOrThrow({
      where: { id: kelompok },
      select: { account_label: true },
    });
    assert.equal(parentCode(parent.account_label), CASH_BANK_SUBCATEGORY);

    const childId = await makeAccount({
      companyId: await parentCompanyId(),
      subcategoryLabel: CASH_BANK_SUBCATEGORY,
      parentId: kelompok,
    });
    const child = await prisma.accAccount.findUniqueOrThrow({
      where: { id: childId },
      select: { account_label: true },
    });
    assert.equal(parentCode(child.account_label), parent.account_label);
    assert.ok(isUnder(child.account_label, CASH_BANK_SUBCATEGORY));
  });
});

/**
 * An account number is unique within a Company and not beyond it.
 *
 * Both halves matter. One Company holding 1.1.4.1 twice is a broken chart;
 * the induk and the anak each holding their own 1.1.4.1 is two books, which
 * is the whole point of a chart of accounts belonging to a legal entity.
 */
describe("an account number cannot be reused within its Company", () => {
  // A number chosen high enough that no chart a person builds will hold it,
  // so the two halves below turn on the Company and nothing else.
  const CONTESTED = `${CASH_BANK_SUBCATEGORY}.987`;

  test("a number already taken in this Company is refused, and names the holder", async () => {
    const holder = await prisma.accAccount.findUniqueOrThrow({
      where: { id: contested },
      select: { account_name: true },
    });

    const problem = await checkAccountNumber(parent, CONTESTED);
    assert.ok(problem, "the number is in use and must be refused");
    assert.match(String(problem), new RegExp(holder.account_name));
  });

  test("the same number in the other Company is free", async () => {
    assert.equal(
      await checkAccountNumber(child, CONTESTED),
      null,
      "each Company numbers its own chart — this is not a duplicate"
    );
  });

  test("an unused number is free", async () => {
    assert.equal(await checkAccountNumber(parent, "9.9.9.999"), null);
  });

  test("an account does not collide with itself when edited", async () => {
    assert.equal(await checkAccountNumber(parent, CONTESTED, contested), null);
  });

  test("the database refuses a duplicate even if nothing checked first", async () => {
    await assert.rejects(
      prisma.accAccount.create({
        data: {
          account_code: `${FIXTURE_PREFIX}.collision`,
          account_label: CONTESTED,
          account_name: "Fixture collision",
          company_id: parent,
          account_subcategory_id: await subcategoryId(CASH_BANK_SUBCATEGORY),
          normal_balance: "Debit",
          created_by: await systemUserId(),
        },
      }),
      /Unique constraint/,
      "@@unique([company_id, account_label]) is the backstop under the check"
    );
  });
});
