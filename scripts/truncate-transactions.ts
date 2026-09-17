/**
 * Empties every transaction store, leaving master and system data standing.
 *
 * A hand-run script, deliberately outside install, migrate, reset and CI — the
 * same standing as `sample-data.ts` and `backfill-subledger.ts` (CLAUDE.md §12).
 * It is what clears a database that has been used for trying things out, so the
 * people who own it can start entering real documents against a chart of
 * accounts, a partner list and a fiscal calendar they have already set up.
 *
 * This is **not** `db:reset`. Nothing is dropped, no migration is replayed, and
 * the seed is not re-run: the schema, the system tables and every master record
 * are untouched.
 *
 * WHAT IT DELETES
 *   acc_journal_line, acc_journal                  the books' journals
 *   fin_cash_bank_transaction(_line)               Finance's documents
 *   fin_funding_request                            the intercompany bridge
 *   bud_budget                                     the plans
 *   sub_ledger, sub_ledger_balance                 the six subject books
 *   cash_bank_ledger, cash_bank_layer              the Cash Bank Book
 *   audit_log rows belonging to those documents
 *
 * WHAT IT KEEPS
 *   every sys_* table, ref_currency, m_partner, m_cash_bank, the whole chart of
 *   accounts and its mappings, acc_fiscal_year / acc_fiscal_period, and the
 *   master records' own audit history.
 *
 * WHY cash_bank_balance IS RESET RATHER THAN DELETED
 *   A Cash & Bank resource has a book from the moment it is registered, even at
 *   zero — `openCashBankBook` writes the balance row unconditionally and the
 *   rest of the application reads it without checking. Deleting those rows
 *   would leave a master record the reports cannot answer for, so every row is
 *   set back to zero instead, and any resource somehow missing one is given it.
 *
 * WHAT YOU DO NOT GET BACK
 *   Opening balances go with the book. Saldo Awal is a create-only field, so a
 *   resource cleared here cannot be given its opening figure again through the
 *   GUI — it would have to be deactivated and re-registered. That was chosen
 *   deliberately over keeping the Opening entries; it is stated here because it
 *   is the one consequence that is not reversible from inside the application.
 *
 * Document numbering restarts on its own: `nextDocumentNumber` reads the
 * highest row still in the table, so the next Budget is BGT-0001 again. The
 * primary-key sequences are left alone — nothing in the application reads an
 * id as a number, and resetting them by hand buys only tidier integers.
 *
 * Everything happens in one transaction: either the database is clear or it is
 * exactly as it was.
 *
 * Run with:  npm run db:truncate-transactions -- --confirm
 * Without --confirm it only reports what it would delete, and deletes nothing.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

/** Audit rows follow the documents they describe; master history stays. */
const DOCUMENT_ENTITY_KEYS = [
  "bud_budget",
  "fin_cash_bank_transaction",
  "fin_funding_request",
  "acc_journal",
];

async function main() {
  const confirmed = process.argv.includes("--confirm");

  const counts = {
    acc_journal_line: await prisma.accJournalLine.count(),
    acc_journal: await prisma.accJournal.count(),
    fin_cash_bank_transaction_line: await prisma.finCashBankTransactionLine.count(),
    fin_funding_request: await prisma.finFundingRequest.count(),
    fin_cash_bank_transaction: await prisma.finCashBankTransaction.count(),
    bud_budget: await prisma.budBudget.count(),
    sub_ledger: await prisma.subLedger.count(),
    sub_ledger_balance: await prisma.subLedgerBalance.count(),
    cash_bank_ledger: await prisma.cashBankLedger.count(),
    cash_bank_layer: await prisma.cashBankLayer.count(),
    audit_log: await prisma.auditLog.count({
      where: { entity_key: { in: DOCUMENT_ENTITY_KEYS } },
    }),
  };

  const resources = await prisma.mCashBank.count();
  const total = Object.values(counts).reduce((t, n) => t + n, 0);

  console.log("\nData transaksi yang akan dihapus:\n");
  for (const [table, n] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(32)} ${String(n).padStart(7)}`);
  }
  console.log(`\n  ${"cash_bank_balance".padEnd(32)} ${String(resources).padStart(7)}  (direset ke nol, tidak dihapus)`);

  if (!total) {
    console.log("\nTidak ada data transaksi. Tidak ada yang dihapus.");
    return;
  }

  if (!confirmed) {
    console.log(
      `\n${total} baris akan dihapus, dan saldo ${resources} Cash & Bank direset ke nol.` +
        "\nMaster data (Partner, Cash & Bank, Bagan Akun, Tahun Buku) tidak tersentuh." +
        "\nSaldo awal Cash & Bank ikut terhapus dan tidak dapat diisi ulang dari GUI." +
        "\n\nJalankan ulang dengan --confirm untuk benar-benar menghapus:" +
        "\n  npm run db:truncate-transactions -- --confirm\n"
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Order follows the foreign keys: lines before their documents, documents
    // before the layer a payment drew on, everything before the books.
    await tx.accJournalLine.deleteMany();
    await tx.accJournal.deleteMany();

    await tx.finCashBankTransactionLine.deleteMany();
    await tx.finFundingRequest.deleteMany();
    await tx.finCashBankTransaction.deleteMany();

    await tx.budBudget.deleteMany();

    await tx.subLedger.deleteMany();
    await tx.subLedgerBalance.deleteMany();

    await tx.cashBankLedger.deleteMany();
    await tx.cashBankLayer.deleteMany();

    // Reset rather than delete — see the note at the top of this file.
    await tx.cashBankBalance.updateMany({
      data: {
        balance: 0,
        base_balance: 0,
        entry_count: 0,
        last_entry_id: null,
        last_entry_date: null,
      },
    });

    // A resource registered before this script existed always has one; this is
    // for the case where something went wrong earlier and left one without.
    const withBooks = new Set(
      (await tx.cashBankBalance.findMany({ select: { cash_bank_id: true } })).map(
        (b) => b.cash_bank_id
      )
    );
    const missing = (await tx.mCashBank.findMany({ select: { id: true } }))
      .map((r) => r.id)
      .filter((id) => !withBooks.has(id));
    if (missing.length) {
      await tx.cashBankBalance.createMany({
        data: missing.map((cash_bank_id) => ({ cash_bank_id })),
      });
    }

    await tx.auditLog.deleteMany({
      where: { entity_key: { in: DOCUMENT_ENTITY_KEYS } },
    });
  });

  console.log(
    `\n${total} baris dihapus. Saldo ${resources} Cash & Bank direset ke nol.` +
      "\nMaster data dan data sistem tidak tersentuh. Penomoran dokumen dimulai " +
      "kembali dari 0001.\n"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
