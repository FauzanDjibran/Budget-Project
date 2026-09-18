/**
 * Brings every account's two structural flags back into agreement with the
 * structure that now decides them.
 *
 * A one-off, run by hand. It is deliberately not part of install, migrate,
 * reset or CI, for the same reason `backfill-subledger.ts` is not: it writes
 * business data, and the seed writes system data only (CLAUDE.md §12).
 *
 * Why it exists. Both flags used to be checkboxes on the Chart of Accounts
 * form, and both are now decided by the backend alone:
 *
 *   * `is_postable` is whether the account is a **leaf**. An account with a
 *     sub-account is a heading over where money lands, not a place it lands
 *     (§10 rule 77), so a posting made to one would be money in the chart that
 *     no leaf accounts for. The flag came off the form entirely, which leaves
 *     any account somebody had unticked by hand permanently unpostable with
 *     nothing in the application able to fix it.
 *   * `is_control_account` is whether anything outside the General Ledger
 *     reconciles against the account — a Cash & Bank resource registered on
 *     it, a subledger-bearing mapping pointing at it, a bridge or FX System
 *     Default naming it (§10 rule 79). It is now recomputed in **both**
 *     directions by `syncControlAccounts`, so an account flagged by a mapping
 *     that has since been repointed elsewhere no longer stays closed to manual
 *     entry for good.
 *
 * This replaces `backfill-control-accounts.ts`, which only ever *set* the
 * control flag. That one-way behaviour was correct while a person could untick
 * the box; with the box gone it would leave exactly the stale flags the
 * recompute exists to clear.
 *
 * It is idempotent: it reports what it would change, changes only that, and
 * running it twice does nothing the second time.
 *
 * Run with: npm run db:backfill-account-flags
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { structuralControlAccountIds } from "@/lib/siba/records";
import { systemDefaultAccountIds } from "@/lib/siba/system-settings";

type Change = { label: string; from: boolean; to: boolean };

async function main() {
  // The System Default half is resolved here rather than inside
  // `structuralControlAccountIds`, which is the same split `accountUsage`
  // already uses: `records.ts` does not read `sys_setting`.
  const controlIds = await structuralControlAccountIds();
  for (const id of await systemDefaultAccountIds()) controlIds.add(id);

  const accounts = await prisma.accAccount.findMany({
    select: {
      id: true,
      account_label: true,
      account_name: true,
      is_postable: true,
      is_control_account: true,
      company: { select: { company_label: true } },
      _count: { select: { children: true } },
    },
    orderBy: [{ company_id: "asc" }, { account_label: "asc" }],
  });

  const postable: Change[] = [];
  const control: Change[] = [];

  for (const a of accounts) {
    const name = `${a.company.company_label} ${a.account_label} — ${a.account_name}`;
    const shouldPost = a._count.children === 0;
    const shouldControl = controlIds.has(a.id);

    if (a.is_postable !== shouldPost || a.is_control_account !== shouldControl) {
      await prisma.accAccount.update({
        where: { id: a.id },
        data: { is_postable: shouldPost, is_control_account: shouldControl },
      });
    }
    if (a.is_postable !== shouldPost) {
      postable.push({ label: name, from: a.is_postable, to: shouldPost });
    }
    if (a.is_control_account !== shouldControl) {
      control.push({ label: name, from: a.is_control_account, to: shouldControl });
    }
  }

  report("Postable", postable);
  report("Control Account", control);

  console.log(
    `\n${accounts.length} account diperiksa: ` +
      `${postable.length} perubahan Postable, ` +
      `${control.length} perubahan Control Account.`
  );
}

function report(title: string, changes: Change[]) {
  if (!changes.length) return;
  console.log(`\n${title}`);
  for (const c of changes) {
    console.log(`  ${c.from ? "ya" : "tidak"} → ${c.to ? "ya" : "tidak"}   ${c.label}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
