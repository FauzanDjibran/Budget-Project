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
 *   acc_journal_line, acc_journal                  the books' journals, manual
 *                                                  and closing journals included
 *   fin_cash_bank_transaction(_line)               Realisasi Budget
 *   fin_funding_request                            the intercompany bridge
 *   fin_cash_bank_transfer(_line)                  Cash Bank Transfer
 *   fin_item_adjustment(_line)                     Penyesuaian Open Item
 *   fin_item_conversion(_line, _line_item)         Pencairan Open Item
 *   fin_item_reclass(_line, _line_source,
 *                    _line_target)                 Reklasifikasi Open Item
 *   fin_cash_bank_revaluation(_layer)              Revaluasi Kurs
 *   acc_general_journal(_line)                     Jurnal Umum
 *   bud_budget                                     the plans
 *   sub_ledger, sub_ledger_balance                 the subject books
 *   cash_bank_ledger, cash_bank_layer              the Cash Bank Book
 *   acc_fiscal_closing                             every Company's closes
 *   acc_opening_balance(_line) written by a close  the snapshots they wrote
 *   audit_log rows belonging to all of those, and each Fiscal Year's
 *   "Ditutup" event
 *
 * WHY THE CLOSES GO TOO
 *   A close is a posting: its `CLS-` journal goes with the other journals,
 *   and the Opening Balance it wrote is built from journals that no longer
 *   exist. Left behind, a year would still read Closed — refusing every
 *   posting into it — and the reports would open from figures nothing backs.
 *   So the closing records and the snapshots a close wrote are deleted, and a
 *   year reading Closed goes back to Open. The years and their periods stay.
 *   A go-live snapshot injected by hand (no source year) is not a close's and
 *   is kept: it is the starting position, not a transaction.
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
  "fin_cash_bank_transfer",
  "fin_item_adjustment",
  "fin_item_conversion",
  "fin_item_reclass",
  "fin_cash_bank_revaluation",
  "acc_general_journal",
  "acc_journal",
  "acc_fiscal_closing",
];

/** The snapshots a close wrote; a go-live snapshot has no source year and stays. */
const WRITTEN_BY_A_CLOSE = { source_fiscal_year_id: { not: null } } as const;

/** A Fiscal Year's own history keeps everything but the close being undone. */
const YEAR_CLOSE_EVENTS = { entity_key: "acc_fiscal_year", event: "close" } as const;

async function main() {
  const confirmed = process.argv.includes("--confirm");

  const snapshotIds = (
    await prisma.accOpeningBalance.findMany({ where: WRITTEN_BY_A_CLOSE, select: { id: true } })
  ).map((o) => o.id);

  const counts = {
    acc_general_journal_line: await prisma.accGeneralJournalLine.count(),
    acc_general_journal: await prisma.accGeneralJournal.count(),
    acc_journal_line: await prisma.accJournalLine.count(),
    acc_journal: await prisma.accJournal.count(),
    fin_cash_bank_transaction_line: await prisma.finCashBankTransactionLine.count(),
    fin_funding_request: await prisma.finFundingRequest.count(),
    fin_cash_bank_transaction: await prisma.finCashBankTransaction.count(),
    fin_cash_bank_transfer_line: await prisma.finCashBankTransferLine.count(),
    fin_cash_bank_transfer: await prisma.finCashBankTransfer.count(),
    fin_item_adjustment_line: await prisma.finItemAdjustmentLine.count(),
    fin_item_adjustment: await prisma.finItemAdjustment.count(),
    fin_item_conversion_line_item: await prisma.finItemConversionLineItem.count(),
    fin_item_conversion_line: await prisma.finItemConversionLine.count(),
    fin_item_conversion: await prisma.finItemConversion.count(),
    fin_item_reclass_line_source: await prisma.finItemReclassLineSource.count(),
    fin_item_reclass_line_target: await prisma.finItemReclassLineTarget.count(),
    fin_item_reclass_line: await prisma.finItemReclassLine.count(),
    fin_item_reclass: await prisma.finItemReclass.count(),
    fin_cash_bank_revaluation_layer: await prisma.finCashBankRevaluationLayer.count(),
    fin_cash_bank_revaluation: await prisma.finCashBankRevaluation.count(),
    bud_budget: await prisma.budBudget.count(),
    sub_ledger: await prisma.subLedger.count(),
    sub_ledger_balance: await prisma.subLedgerBalance.count(),
    cash_bank_ledger: await prisma.cashBankLedger.count(),
    cash_bank_layer: await prisma.cashBankLayer.count(),
    acc_fiscal_closing: await prisma.accFiscalClosing.count(),
    acc_opening_balance_line: await prisma.accOpeningBalanceLine.count({
      where: { opening_id: { in: snapshotIds } },
    }),
    acc_opening_balance: snapshotIds.length,
    audit_log: await prisma.auditLog.count({
      where: {
        OR: [
          { entity_key: { in: DOCUMENT_ENTITY_KEYS } },
          { entity_key: "acc_opening_balance", row_id: { in: snapshotIds } },
          YEAR_CLOSE_EVENTS,
        ],
      },
    }),
  };

  const resources = await prisma.mCashBank.count();
  const closedYears = await prisma.accFiscalYear.count({ where: { status: "Closed" } });
  const total = Object.values(counts).reduce((t, n) => t + n, 0);

  console.log("\nData transaksi yang akan dihapus:\n");
  for (const [table, n] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(32)} ${String(n).padStart(7)}`);
  }
  console.log(`\n  ${"cash_bank_balance".padEnd(32)} ${String(resources).padStart(7)}  (direset ke nol, tidak dihapus)`);
  console.log(`  ${"acc_fiscal_year (Closed)".padEnd(32)} ${String(closedYears).padStart(7)}  (dibuka kembali, tidak dihapus)`);

  if (!total) {
    console.log("\nTidak ada data transaksi. Tidak ada yang dihapus.");
    return;
  }

  if (!confirmed) {
    console.log(
      `\n${total} baris akan dihapus, dan saldo ${resources} Cash & Bank direset ke nol.` +
        (closedYears ? `\n${closedYears} Tahun Buku yang sudah ditutup dibuka kembali.` : "") +
        "\nMaster data (Partner, Cash & Bank, Bagan Akun, Tahun Buku) tetap ada." +
        "\nSaldo awal Cash & Bank ikut terhapus dan tidak dapat diisi ulang dari GUI." +
        "\n\nJalankan ulang dengan --confirm untuk benar-benar menghapus:" +
        "\n  npm run db:truncate-transactions -- --confirm\n"
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Order follows the foreign keys: lines before their documents, documents
    // before the layer a payment drew on, everything before the books.
    await tx.accGeneralJournalLine.deleteMany();
    await tx.accGeneralJournal.deleteMany();
    await tx.accJournalLine.deleteMany();
    await tx.accJournal.deleteMany();

    await tx.finCashBankTransactionLine.deleteMany();
    await tx.finFundingRequest.deleteMany();
    await tx.finCashBankTransaction.deleteMany();

    await tx.finCashBankTransferLine.deleteMany();
    await tx.finCashBankTransfer.deleteMany();

    await tx.finItemAdjustmentLine.deleteMany();
    await tx.finItemAdjustment.deleteMany();

    await tx.finItemConversionLineItem.deleteMany();
    await tx.finItemConversionLine.deleteMany();
    await tx.finItemConversion.deleteMany();

    await tx.finItemReclassLineSource.deleteMany();
    await tx.finItemReclassLineTarget.deleteMany();
    await tx.finItemReclassLine.deleteMany();
    await tx.finItemReclass.deleteMany();

    await tx.finCashBankRevaluationLayer.deleteMany();
    await tx.finCashBankRevaluation.deleteMany();

    await tx.budBudget.deleteMany();

    // The closes, the snapshots they wrote, and the Closed rollup over them —
    // see the note at the top of this file.
    await tx.accFiscalClosing.deleteMany();
    await tx.accOpeningBalanceLine.deleteMany({ where: { opening_id: { in: snapshotIds } } });
    await tx.accOpeningBalance.deleteMany({ where: { id: { in: snapshotIds } } });
    await tx.accFiscalYear.updateMany({ where: { status: "Closed" }, data: { status: "Open" } });
    // A close made its periods Closed; they return Locked, as a close found them.
    await tx.accFiscalPeriod.updateMany({ where: { status: "Closed" }, data: { status: "Locked" } });

    await tx.subLedger.deleteMany();
    await tx.subLedgerBalance.deleteMany();

    await tx.cashBankLedger.deleteMany();
    await tx.cashBankLayer.deleteMany();
    await tx.cashBankPeriod.deleteMany();

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
      where: {
        OR: [
          { entity_key: { in: DOCUMENT_ENTITY_KEYS } },
          { entity_key: "acc_opening_balance", row_id: { in: snapshotIds } },
          YEAR_CLOSE_EVENTS,
        ],
      },
    });
  });

  console.log(
    `\n${total} baris dihapus. Saldo ${resources} Cash & Bank direset ke nol, ` +
      `${closedYears} Tahun Buku Closed dibuka kembali.` +
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
