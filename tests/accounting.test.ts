import test, { after, describe } from "node:test";
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
import { disconnect, prisma } from "./helpers";

/**
 * The Accounting module's enforcement points, checked against the real seeded
 * database rather than against the pickers that present them.
 *
 * The rules here are the ones a hand-crafted request would have to get past:
 * which account a Cash & Bank resource may post to, whether a parent account
 * would close a loop, and which Partner Categories a Budget Category admits.
 * The form narrows its options to the same sets, but that is presentation.
 */

after(disconnect);

async function companyId(label: string): Promise<number> {
  const row = await prisma.sysCompany.findFirstOrThrow({
    where: { company_label: label },
    select: { id: true },
  });
  return row.id;
}

async function accountId(companyLabel: string, accountLabel: string): Promise<number> {
  const row = await prisma.accAccount.findFirstOrThrow({
    where: { company: { company_label: companyLabel }, account_label: accountLabel },
    select: { id: true },
  });
  return row.id;
}

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
  test("accepts a postable Kas/Bank account owned by the same Company", async () => {
    const holding = await companyId("Holding");
    assert.equal(await checkCashBankAccount(await accountId("Holding", "1101"), holding), null);
    assert.equal(await checkCashBankAccount(await accountId("Holding", "110201"), holding), null);
  });

  test("refuses an account owned by the other Company", async () => {
    const holding = await companyId("Holding");
    const foreign = await accountId("Trading", "1101");
    const problem = await checkCashBankAccount(foreign, holding);
    assert.match(String(problem), /Company yang sama/);
  });

  test("refuses a header account, which cannot receive a Journal Line", async () => {
    const holding = await companyId("Holding");
    // 1102 Bank is the header above Bank Mandiri / Bank BCA.
    const header = await accountId("Holding", "1102");
    const problem = await checkCashBankAccount(header, holding);
    assert.match(String(problem), /postable/);
  });

  test("refuses a postable account outside the Kas and Bank groups", async () => {
    const holding = await companyId("Holding");
    // 1201 Piutang dari Cabang is postable, so only the group rule stops it.
    const receivable = await accountId("Holding", "1201");
    const row = await prisma.accAccount.findUniqueOrThrow({
      where: { id: receivable },
      select: { is_postable: true, account_subcategory: { select: { subcategory_label: true } } },
    });
    assert.equal(row.is_postable, true);
    assert.ok(!CASH_BANK_SUBCATEGORIES.includes(row.account_subcategory.subcategory_label));

    const problem = await checkCashBankAccount(receivable, holding);
    assert.match(String(problem), /Kas atau Bank/);
  });

  test("refuses an account that does not exist", async () => {
    const problem = await checkCashBankAccount(999_999, await companyId("Holding"));
    assert.match(String(problem), /tidak ditemukan/);
  });
});

describe("an account cannot become its own ancestor", () => {
  test("descendants of a header include the accounts under it", async () => {
    const header = await accountId("Holding", "1102");
    const child = await accountId("Holding", "110201");
    const descendants = await accountDescendants(header);
    assert.ok(descendants.has(header), "the root is part of its own subtree");
    assert.ok(
      descendants.has(child),
      "a child must be refused as its parent's parent"
    );
  });

  test("a leaf has no descendants but itself", async () => {
    const leaf = await accountId("Holding", "110201");
    const descendants = await accountDescendants(leaf);
    assert.deepEqual([...descendants], [leaf]);
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
