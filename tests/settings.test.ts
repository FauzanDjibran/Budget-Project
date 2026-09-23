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
import { syncControlAccounts } from "../src/lib/siba/records";
import {
  checkSystemDefaultValue,
  defaultCurrencyId,
  missingClosingAccounts,
  missingNeracaAccounts,
  systemDefaultAccountIds,
  systemDefaults,
  systemDefaultsUsingAccount,
  writeSystemDefaults,
} from "../src/lib/siba/system-settings";
import {
  FIXTURE_PREFIX,
  childCompanyId,
  cleanupFixtures,
  disconnect,
  makeAccount,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

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

/** The equity settings this suite writes over, so they can be put back. */
const EQUITY_KEYS = [
  "induk_accumulated_pl_account",
  "anak_accumulated_pl_account",
  "induk_unclosed_pl_account",
  "anak_unclosed_pl_account",
  "induk_current_pl_account",
  "anak_current_pl_account",
] as const;
const previousEquity: Record<string, string | null> = {};

before(async () => {
  actor = await systemUserId();
  const stored = await systemDefaults();
  previous = stored.default_currency;
  for (const key of EQUITY_KEYS) previousEquity[key] = stored[key];

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
  await writeSystemDefaults({ default_currency: previous, ...previousEquity }, actor);
  // Release every fixture account these settings claimed, before the accounts
  // themselves go: an account left flagged would outlive the row explaining it.
  await syncControlAccounts(
    claimed,
    await systemDefaultAccountIds(),
    actor
  );
  await cleanupFixtures();
  await prisma.refCurrency.deleteMany({
    where: { currency_label: { startsWith: FIXTURE_PREFIX } },
  });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sys_setting" } });
  await disconnect();
});

// -------------------------------------------------------------- the catalogue

/** Every account this suite pointed a setting at, for the teardown to release. */
const claimed = new Set<number>();

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
    const values = (raw: string | null) => ({
      ...EMPTY_SYSTEM_DEFAULTS,
      default_currency: raw,
    });
    assert.equal(refValueOf(values("12"), "default_currency"), 12);
    assert.equal(refValueOf(values(null), "default_currency"), null);
    assert.equal(refValueOf(values(""), "default_currency"), null);
    assert.equal(refValueOf(values("abc"), "default_currency"), null);
    assert.equal(refValueOf(values("0"), "default_currency"), null);
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

// --------------------------------------------------- the equity P&L accounts

/**
 * The two accounts per Company that closing a Fiscal Year needs.
 *
 * They behave like the intercompany bridge rather than like a prefill: the
 * accumulated one is where a year's result is posted, so it is checked when it
 * is stored and refused by name when it is missing. Both are closed to hand
 * entry by the ordinary mechanism — an account a posting engine owns is not one
 * a person types into — and the property that matters is that the claim is
 * released again when the setting is repointed.
 *
 * The sync is invoked here the way `saveSystemDefaults` invokes it: a test
 * process has no session, so it calls what the Server Action delegates to.
 */
describe("the equity accounts closing posts into", () => {
  const sync = async (touched: number[]) => {
    for (const id of touched) claimed.add(id);
    await syncControlAccounts(touched, await systemDefaultAccountIds(), actor);
  };
  const isControl = async (id: number) =>
    (
      await prisma.accAccount.findUniqueOrThrow({
        where: { id },
        select: { is_control_account: true },
      })
    ).is_control_account;

  test("an account of the wrong Company is refused before it is stored", async () => {
    const anakAccount = await makeAccount({
      companyId: await childCompanyId(),
      subcategoryLabel: "3.3.1",
      normalBalance: "Kredit",
    });
    const refused = await checkSystemDefaultValue(
      "induk_accumulated_pl_account",
      anakAccount
    );
    assert.ok(refused, "the induk's setting may not name the anak's chart");
    assert.match(refused!, /Company/);
  });

  test("a header account is refused — a posting target is always a leaf", async () => {
    const company = await parentCompanyId();
    const parent = await makeAccount({
      companyId: company,
      subcategoryLabel: "3.3.1",
      normalBalance: "Kredit",
    });
    await makeAccount({
      companyId: company,
      subcategoryLabel: "3.3.1",
      normalBalance: "Kredit",
      parentId: parent,
    });
    assert.ok(
      await checkSystemDefaultValue("induk_accumulated_pl_account", parent),
      "an account with a sub-account is a heading, not a destination"
    );
  });

  test("setting one closes it to manual entry, and repointing re-opens it", async () => {
    const company = await parentCompanyId();
    const first = await makeAccount({
      companyId: company,
      subcategoryLabel: "3.3.1",
      normalBalance: "Kredit",
    });
    const current = await makeAccount({
      companyId: company,
      subcategoryLabel: "3.4.1",
      normalBalance: "Kredit",
    });
    const unclosed = await makeAccount({
      companyId: company,
      subcategoryLabel: "3.4.1",
      normalBalance: "Kredit",
    });

    await writeSystemDefaults(
      {
        induk_accumulated_pl_account: String(first),
        induk_unclosed_pl_account: String(unclosed),
        induk_current_pl_account: String(current),
      },
      actor
    );
    await sync([first, current, unclosed]);

    assert.equal(await isControl(first), true, "closing posts here");
    assert.equal(
      await isControl(current),
      true,
      "and nothing posts here at all, which is a stronger reason still"
    );
    assert.equal(
      await isControl(unclosed),
      true,
      "the Neraca places a computed figure here, so a hand-written line would sit beside it"
    );
    assert.deepEqual(await systemDefaultsUsingAccount(first), [
      "Account Laba/Rugi Tahun Sebelumnya — Induk",
    ]);

    // The half that used to be missing everywhere: a setting moved on has to
    // let go of what it left behind, or the old account stays shut for good.
    const second = await makeAccount({
      companyId: company,
      subcategoryLabel: "3.3.1",
      normalBalance: "Kredit",
    });
    await writeSystemDefaults(
      { induk_accumulated_pl_account: String(second) },
      actor
    );
    await sync([first, second]);

    assert.equal(await isControl(first), false, "nothing names it any more");
    assert.equal(await isControl(second), true, "the setting's new target is claimed");
    assert.equal(await isControl(current), true, "the untouched setting still holds its own");
  });

  test("an unset accumulated account is reported by name, and the current one is not", async () => {
    await writeSystemDefaults(
      { induk_accumulated_pl_account: null, anak_accumulated_pl_account: null },
      actor
    );
    const missing = await missingClosingAccounts();
    assert.deepEqual(missing, [
      "Account Laba/Rugi Tahun Sebelumnya — Induk",
      "Account Laba/Rugi Tahun Sebelumnya — Anak",
    ]);

    // Nothing posts to the current-year account, so an unset one blocks no
    // process — it is a report missing a line, not a refusal waiting to happen.
    assert.ok(
      !missing.some((m) => m.includes("Berjalan")),
      "the presentation line is not a blocking gap"
    );

    const company = await parentCompanyId();
    const account = await makeAccount({
      companyId: company,
      subcategoryLabel: "3.3.1",
      normalBalance: "Kredit",
    });
    await writeSystemDefaults(
      { induk_accumulated_pl_account: String(account) },
      actor
    );
    await sync([account]);
    assert.deepEqual(await missingClosingAccounts(), [
      "Account Laba/Rugi Tahun Sebelumnya — Anak",
    ]);

    // Resolved against the master, never trusted as stored: an account that has
    // since been deactivated is somewhere the picker would no longer offer.
    await prisma.accAccount.update({
      where: { id: account },
      data: { is_active: false },
    });
    assert.deepEqual(await missingClosingAccounts(), [
      "Account Laba/Rugi Tahun Sebelumnya — Induk",
      "Account Laba/Rugi Tahun Sebelumnya — Anak",
    ]);
    await prisma.accAccount.update({
      where: { id: account },
      data: { is_active: true },
    });
  });

  test("the Neraca's accounts: Tahun Berjalan always, Belum Ditutup only while a year is carried", async () => {
    await writeSystemDefaults(
      {
        induk_current_pl_account: null,
        anak_current_pl_account: null,
        induk_unclosed_pl_account: null,
        anak_unclosed_pl_account: null,
      },
      actor
    );

    // Every Neraca places Tahun Berjalan, so both Companies need it whatever
    // the calendar holds.
    assert.deepEqual(await missingNeracaAccounts({ induk: false, anak: false }), [
      "Account Laba/Rugi Tahun Berjalan — Induk",
      "Account Laba/Rugi Tahun Berjalan — Anak",
    ]);

    // Belum Ditutup is asked for only from the Company still carrying an
    // unclosed year: a setting blocks only where it is used.
    assert.deepEqual(await missingNeracaAccounts({ induk: false, anak: true }), [
      "Account Laba/Rugi Tahun Berjalan — Induk",
      "Account Laba/Rugi Tahun Berjalan — Anak",
      "Account Laba/Rugi Tahun Lalu Belum Ditutup — Anak",
    ]);

    const company = await parentCompanyId();
    const current = await makeAccount({
      companyId: company,
      subcategoryLabel: "3.4.1",
      normalBalance: "Kredit",
    });
    const unclosed = await makeAccount({
      companyId: company,
      subcategoryLabel: "3.4.1",
      normalBalance: "Kredit",
    });
    await writeSystemDefaults(
      {
        induk_current_pl_account: String(current),
        induk_unclosed_pl_account: String(unclosed),
      },
      actor
    );
    await sync([current, unclosed]);

    assert.deepEqual(await missingNeracaAccounts({ induk: true, anak: false }), [
      "Account Laba/Rugi Tahun Berjalan — Anak",
    ]);

    // Resolved against the master: a deactivated account is not somewhere a
    // line can be placed any more than somewhere a posting can land.
    await prisma.accAccount.update({ where: { id: unclosed }, data: { is_active: false } });
    assert.deepEqual(await missingNeracaAccounts({ induk: true, anak: false }), [
      "Account Laba/Rugi Tahun Berjalan — Anak",
      "Account Laba/Rugi Tahun Lalu Belum Ditutup — Induk",
    ]);
    await prisma.accAccount.update({ where: { id: unclosed }, data: { is_active: true } });
  });
});
