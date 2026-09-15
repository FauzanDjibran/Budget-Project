import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { ENTITIES } from "../src/lib/siba/entities";
import { entityPermissions } from "../src/lib/siba/entity-access";
import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import {
  CASH_BANK_SUBCATEGORIES,
  accountDescendants,
  checkCashBankAccount,
  partnerCategoriesForBudgetCategory,
} from "../src/lib/siba/records";
import {
  childCompanyId,
  cleanupFixtures,
  disconnect,
  makeAccount,
  parentCompanyId,
  prisma,
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

before(async () => {
  parent = await parentCompanyId();
  child = await childCompanyId();

  cash = await makeAccount({ companyId: parent, subcategoryLabel: "Kas" });
  bankHeader = await makeAccount({
    companyId: parent,
    subcategoryLabel: "Bank",
    postable: false,
  });
  bankLeaf = await makeAccount({
    companyId: parent,
    subcategoryLabel: "Bank",
    parentId: bankHeader,
  });
  receivable = await makeAccount({ companyId: parent, subcategoryLabel: "Piutang" });
  foreignCash = await makeAccount({ companyId: child, subcategoryLabel: "Kas" });
  inactiveCash = await makeAccount({
    companyId: parent,
    subcategoryLabel: "Kas",
    active: false,
  });
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

  test("refuses a postable account outside the Kas and Bank groups", async () => {
    const row = await prisma.accAccount.findUniqueOrThrow({
      where: { id: receivable },
      select: {
        is_postable: true,
        account_subcategory: { select: { subcategory_label: true } },
      },
    });
    assert.equal(row.is_postable, true, "only the group rule may stop this one");
    assert.ok(!CASH_BANK_SUBCATEGORIES.includes(row.account_subcategory.subcategory_label));

    const problem = await checkCashBankAccount(receivable, parent);
    assert.match(String(problem), /Kas atau Bank/);
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
