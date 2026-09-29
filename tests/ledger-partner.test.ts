import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { getJournal, partnerMismatch, postJournal } from "../src/lib/siba/journal";
import { generalLedgerReport } from "../src/lib/siba/ledger";
import { CASH_BANK_SUBCATEGORY } from "../src/lib/siba/records";
import {
  cleanupFixtures,
  disconnect,
  makeAccount,
  makePartner,
  parentCompanyId,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * A journal line's Partner, as the General Ledger and the Journal show it.
 *
 * Only an account that requires a Partner may carry one, and every line on it
 * must. The screens show what the line recorded and warn where it breaks the
 * rule — they never repair it. The two broken lines here are written through
 * `postJournal` directly, which does not ask the account's Partner rule (the
 * document and manual-journal paths above it do): that is exactly the kind of
 * write the warning exists to expose.
 */

describe("the Partner rule", () => {
  test("a Partner-bearing account needs one, any other account takes none", () => {
    assert.equal(partnerMismatch(true, 5), null);
    assert.equal(partnerMismatch(false, null), null);
    assert.equal(partnerMismatch(true, null), "missing");
    assert.equal(partnerMismatch(false, 5), "unexpected");
  });
});

let company = 0;
let cash = 0;
let payable = 0;
let branch = 0;
let broken = 0;
const today = new Date().toISOString().slice(0, 10);
const RANGE = { from: today, to: today };

before(async () => {
  company = await parentCompanyId();
  const actor = await systemUserId();
  cash = await makeAccount({ companyId: company, subcategoryLabel: CASH_BANK_SUBCATEGORY });
  payable = await makeAccount({
    companyId: company,
    subcategoryLabel: "2.1.1",
    partnerCategoryLabel: "Cabang",
  });
  branch = await makePartner({ companyId: company, categoryLabel: "Cabang" });
  const currency = (
    await prisma.refCurrency.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true } })
  ).id;
  const line = (accountId: number, debit: number, credit: number, partnerId: number | null) => ({
    accountId,
    partnerId,
    currencyId: currency,
    rate: 1,
    debit,
    credit,
    description: "Fixture",
  });

  // As the engine writes it: the Partner on the account that keeps one.
  await postJournal(prisma, {
    companyId: company,
    description: "Fixture — sesuai aturan",
    lines: [line(cash, 400_000, 0, null), line(payable, 0, 400_000, branch)],
    actorId: actor,
  });
  // Both halves of the rule broken at once.
  broken = (
    await postJournal(prisma, {
      companyId: company,
      description: "Fixture — melanggar aturan",
      lines: [line(cash, 0, 150_000, branch), line(payable, 150_000, 0, null)],
      actorId: actor,
    })
  ).id;
});

after(async () => {
  await cleanupFixtures();
  await disconnect();
});

describe("the General Ledger shows each line's own Partner", () => {
  test("a Partner-bearing account's line carries its Partner's code and name", async () => {
    const report = await generalLedgerReport([payable], RANGE, [company]);
    const account = report.accounts[0];
    assert.equal(account.requirePartner, true);
    const ok = account.entries.find((e) => e.credit === 400_000);
    assert.ok(ok);
    const partner = await prisma.mPartner.findUniqueOrThrow({
      where: { id: branch },
      select: { partner_label: true, partner_name: true },
    });
    assert.equal(ok.partnerLabel, partner.partner_label);
    assert.equal(ok.partnerName, partner.partner_name);
    assert.equal(ok.partnerMismatch, null);
  });

  test("an account that takes no Partner shows none on a correct line", async () => {
    const report = await generalLedgerReport([cash], RANGE, [company]);
    const ok = report.accounts[0].entries.find((e) => e.debit === 400_000);
    assert.ok(ok);
    assert.equal(ok.partnerLabel, null);
    assert.equal(ok.partnerMismatch, null);
  });

  test("a line breaking the rule is flagged, and shown as it was written", async () => {
    const report = await generalLedgerReport([cash, payable], RANGE, [company]);
    const byId = new Map(report.accounts.map((a) => [a.id, a]));
    const unexpected = byId.get(cash)!.entries.find((e) => e.credit === 150_000);
    const missing = byId.get(payable)!.entries.find((e) => e.debit === 150_000);
    assert.equal(unexpected?.partnerMismatch, "unexpected");
    assert.ok(unexpected?.partnerLabel, "the Partner it wrongly carries is still shown");
    assert.equal(missing?.partnerMismatch, "missing");
    assert.equal(missing?.partnerLabel, null);
  });
});

describe("the Journal shows the same warning on the same line", () => {
  test("each line of the broken journal names its own fault", async () => {
    const journal = await getJournal(broken, [company]);
    assert.ok(journal);
    const byAccount = new Map(journal.lines.map((l) => [l.accountId, l]));
    assert.equal(byAccount.get(cash)?.partnerMismatch, "unexpected");
    assert.equal(byAccount.get(payable)?.partnerMismatch, "missing");
  });
});
