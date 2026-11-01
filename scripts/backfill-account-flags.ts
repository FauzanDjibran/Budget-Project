/**
 * Brings every account's `is_postable` back into agreement with the structure
 * that decides it.
 *
 * A one-off, run by hand. It is deliberately not part of install, migrate,
 * reset or CI, for the same reason `backfill-subledger.ts` is not: it writes
 * business data, and the seed writes system data only (CLAUDE.md §12).
 *
 * `is_postable` is whether the account is a **leaf**. An account with a
 * sub-account is a heading over where money lands, not a place it lands
 * (§10 rule 77), so a posting made to one would be money in the chart that no
 * leaf accounts for. The flag used to be a checkbox and is decided by the
 * backend alone now, which leaves any account somebody had unticked by hand
 * permanently unpostable with nothing in the application able to fix it.
 *
 * The control-account half is gone: the account's ledger decides what a line
 * on it demands, and there is no flag left to recompute (Journal Replacement
 * R2).
 *
 * It is idempotent: it reports what it would change, changes only that, and
 * running it twice does nothing the second time.
 *
 * Run with: npm run db:backfill-account-flags
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

type Change = { label: string; from: boolean; to: boolean };

async function main() {
  const accounts = await prisma.accAccount.findMany({
    select: {
      id: true,
      account_label: true,
      account_name: true,
      is_postable: true,
      company: { select: { company_label: true } },
      _count: { select: { children: true } },
    },
    orderBy: [{ company_id: "asc" }, { account_label: "asc" }],
  });

  const postable: Change[] = [];

  for (const a of accounts) {
    const shouldPost = a._count.children === 0;
    if (a.is_postable === shouldPost) continue;
    await prisma.accAccount.update({ where: { id: a.id }, data: { is_postable: shouldPost } });
    postable.push({
      label: `${a.company.company_label} ${a.account_label} — ${a.account_name}`,
      from: a.is_postable,
      to: shouldPost,
    });
  }

  if (postable.length) {
    console.log("\nPostable");
    for (const c of postable) {
      console.log(`  ${c.from ? "ya" : "tidak"} → ${c.to ? "ya" : "tidak"}   ${c.label}`);
    }
  }
  console.log(`\n${accounts.length} account diperiksa: ${postable.length} perubahan Postable.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
