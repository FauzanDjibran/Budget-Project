import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { MODULES } from "../src/lib/siba/nav";
import { PERMISSION_CODES } from "../src/lib/siba/permissions";
import {
  EMPTY_SYSTEM_DEFAULTS,
  SYSTEM_DEFAULTS,
  isSystemDefaultKey,
  refValueOf,
} from "../src/lib/siba/system-defaults";
import {
  defaultCurrencyId,
  systemDefaults,
  writeSystemDefaults,
} from "../src/lib/siba/system-settings";
import { FIXTURE_PREFIX, disconnect, prisma, systemUserId } from "./helpers";

/**
 * System Default.
 *
 * A default fills a control in and decides nothing, so the cases below are
 * about exactly that boundary: the catalogue is code, a value that would not be
 * offered to the user is not prefilled either, and a key nobody declared is
 * never written.
 *
 * The suite writes to a real settings table, so whatever was configured before
 * it ran is captured and put back afterwards.
 */

let actor = 0;
let activeCurrency = 0;
let inactiveCurrency = 0;
let previous: string | null = null;

before(async () => {
  actor = await systemUserId();
  previous = (await systemDefaults()).default_currency;

  const base = await prisma.refCurrency.findFirstOrThrow({
    where: { status: "Active" },
    select: { id: true },
  });
  activeCurrency = base.id;

  const label = `${FIXTURE_PREFIX}CUR${Date.now() % 100000}`;
  const made = await prisma.refCurrency.create({
    data: {
      currency_code: `test.${label}`,
      currency_label: label,
      currency_name: `Fixture ${label}`,
      status: "Inactive",
      created_by: actor,
    },
    select: { id: true },
  });
  inactiveCurrency = made.id;
});

after(async () => {
  await writeSystemDefaults({ default_currency: previous }, actor);
  await prisma.refCurrency.deleteMany({
    where: { currency_label: { startsWith: FIXTURE_PREFIX } },
  });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sys_setting" } });
  await disconnect();
});

// -------------------------------------------------------------- the catalogue

describe("the System Default catalogue lives in code", () => {
  test("every declared key has a home in the empty value set", () => {
    for (const def of SYSTEM_DEFAULTS) {
      assert.ok(
        def.key in EMPTY_SYSTEM_DEFAULTS,
        `${def.key} is declared but has no default value`
      );
      assert.equal(
        EMPTY_SYSTEM_DEFAULTS[def.key],
        null,
        "an unset default must read as null, never as a guess"
      );
    }
  });

  test("a key nobody declared is not a setting", () => {
    assert.equal(isSystemDefaultKey("default_currency"), true);
    assert.equal(isSystemDefaultKey("default_company"), false);
    assert.equal(isSystemDefaultKey(""), false);
  });

  test("the page is behind its own menu and action permissions", () => {
    for (const code of [
      "MENU_SYSTEM_DEFAULT_ACCESS",
      "SYSTEM_DEFAULT_VIEW",
      "SYSTEM_DEFAULT_EDIT",
    ]) {
      assert.ok(PERMISSION_CODES.includes(code as never), `${code} is missing`);
    }

    const leaf = MODULES.find((m) => m.key === "settings")
      ?.groups?.flatMap((g) => g.entities)
      .find((e) => e.slug === "system-default");
    assert.ok(leaf, "System Default must be reachable from the Pengaturan menu");
    assert.equal(leaf!.permission, "MENU_SYSTEM_DEFAULT_ACCESS");
  });

  test("a ref value reads back as a row id, and anything else as nothing", () => {
    assert.equal(refValueOf({ default_currency: "12" }, "default_currency"), 12);
    assert.equal(refValueOf({ default_currency: null }, "default_currency"), null);
    assert.equal(refValueOf({ default_currency: "" }, "default_currency"), null);
    assert.equal(refValueOf({ default_currency: "abc" }, "default_currency"), null);
    assert.equal(refValueOf({ default_currency: "0" }, "default_currency"), null);
  });
});

// ------------------------------------------------------------- reading it back

describe("a saved default is what the forms read", () => {
  test("a value written is a value read", async () => {
    await writeSystemDefaults({ default_currency: String(activeCurrency) }, actor);
    assert.equal((await systemDefaults()).default_currency, String(activeCurrency));
    assert.equal(await defaultCurrencyId(), activeCurrency);
  });

  test("writing the same value again changes nothing", async () => {
    const changed = await writeSystemDefaults(
      { default_currency: String(activeCurrency) },
      actor
    );
    assert.deepEqual(changed, [], "an unchanged save must not claim a change");
  });

  test("clearing it leaves the picker empty rather than guessing", async () => {
    await writeSystemDefaults({ default_currency: null }, actor);
    assert.equal((await systemDefaults()).default_currency, null);
    assert.equal(await defaultCurrencyId(), null);
  });

  test("a deactivated currency is not prefilled", async () => {
    // The picker hides inactive records, so prefilling one would put a value in
    // the form that the form itself refuses to offer.
    await writeSystemDefaults({ default_currency: String(inactiveCurrency) }, actor);
    assert.equal(
      (await systemDefaults()).default_currency,
      String(inactiveCurrency),
      "the stored setting is left alone"
    );
    assert.equal(
      await defaultCurrencyId(),
      null,
      "but nothing is prefilled from it"
    );
  });

  test("a default pointing at a currency that no longer exists prefills nothing", async () => {
    await writeSystemDefaults({ default_currency: "999999" }, actor);
    assert.equal(await defaultCurrencyId(), null);
  });

  test("a key outside the catalogue is never written", async () => {
    await writeSystemDefaults(
      { default_currency: null, default_company: "1" } as never,
      actor
    );
    const row = await prisma.sysSetting.findUnique({
      where: { setting_key: "default_company" },
    });
    assert.equal(row, null, "sys_setting holds only keys the catalogue declares");
  });
});
