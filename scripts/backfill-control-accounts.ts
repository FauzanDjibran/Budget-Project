/**
 * Marks the accounts that were already a book's counterpart before the flag
 * meant anything.
 *
 * A one-off, run by hand. It is deliberately not part of install, migrate,
 * reset or CI, for the same reason `backfill-subledger.ts` is not: it writes
 * business data, and the seed writes system data only (CLAUDE.md §12).
 *
 * Why it exists. `acc_account.is_control_account` has existed since the schema
 * was written and nothing ever read it or set it — it was a checkbox on a form.
 * It now decides whether an account may be written to by hand: a manual journal
 * refuses a control account, because moving the General Ledger without moving
 * the book that reconciles against it is the one thing a manual entry must not
 * be able to do. From here on the structure sets the flag when it claims an
 * account — registering a Cash & Bank resource on it, mapping a
 * subledger-bearing Budget Category to it, naming it in a bridge or FX System
 * Default. This is what catches up everything that was claimed beforehand.
 *
 * It is **idempotent** and one-way: it only ever sets the flag, never clears
 * one. An account somebody declared a control account by hand is left alone,
 * and so is an account that stopped being a mapping target — re-opening one to
 * manual entry is a decision to take on the form, not something a script should
 * make on anybody's behalf.
 *
 * Run with: npm run db:backfill-control-accounts
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { structuralControlAccountIds } from "@/lib/siba/records";
import { systemDefaults } from "@/lib/siba/system-settings";
import { SYSTEM_DEFAULTS, refValueOf } from "@/lib/siba/system-defaults";

async function main() {
  const ids = await structuralControlAccountIds();

  // The System Default half is resolved here rather than inside
  // `structuralControlAccountIds`, which is the same split `accountUsage`
  // already uses: `records.ts` does not read `sys_setting`.
  const current = await systemDefaults();
  for (const def of SYSTEM_DEFAULTS) {
    if (def.ref !== "acc_account") continue;
    const id = refValueOf(current, def.key);
    if (id) ids.add(id);
  }

  if (!ids.size) {
    console.log("Tidak ada account yang menjadi pasangan buku. Tidak ada yang diubah.");
    return;
  }

  const accounts = await prisma.accAccount.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      account_label: true,
      account_name: true,
      is_control_account: true,
      company: { select: { company_label: true } },
    },
    orderBy: { account_label: "asc" },
  });

  let marked = 0;
  for (const account of accounts) {
    if (account.is_control_account) continue;
    await prisma.accAccount.update({
      where: { id: account.id },
      data: { is_control_account: true },
    });
    marked += 1;
    console.log(
      `  ${account.company.company_label} ${account.account_label} — ${account.account_name}`
    );
  }

  console.log(
    `\n${accounts.length} account terhubung dengan sebuah buku: ` +
      `${marked} ditandai control account, ${accounts.length - marked} sudah ditandai.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
