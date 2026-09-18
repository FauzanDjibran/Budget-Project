/**
 * Writes the subject books for Cash Bank Transactions that were posted before
 * the books existed.
 *
 * A one-off, run by hand. It is deliberately not part of install, migrate,
 * reset or CI, for the same reason `sample-data.ts` is not: it writes business
 * history, and the seed writes system data only (CLAUDE.md §12).
 *
 * Why it exists at all: a subledger is an append-only book whose closing figure
 * is the sum of everything before it. A book that starts halfway through a
 * Partner's history does not merely lack old rows — every balance it reports is
 * wrong, with nothing on the report to say so. Replaying the documents that
 * already posted is what makes the first run of the report true.
 *
 * It replays in document order, so each entry's `balance_after` comes out as it
 * would have at the time, and it is **idempotent**: a document that already has
 * an entry in its book is skipped, so re-running adds only what is missing. It
 * deletes nothing — the books have no delete path, by design.
 *
 * It writes through `recordSubledgerEntry`, the one writer, rather than
 * reproducing its arithmetic here. That is why the npm script runs it under
 * `--conditions=react-server`, the same way the test suite reaches a
 * `server-only` module: a backfill that computed balances its own way would be
 * a second implementation of the book, free to disagree with the first.
 *
 * Run with: npm run db:backfill-subledger
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { isBaseCurrency } from "@/lib/siba/currency";
import { purposeByKey } from "@/lib/siba/purposes";
import { subledgerForCategory } from "@/lib/siba/subledger-catalogue";
import { loadSubledgers } from "@/lib/siba/subledger-data";
import { recordSubledgerEntry } from "@/lib/siba/subledger";

async function main() {
  const docType = await prisma.sysDocType.findFirst({
    where: { doc_table: "fin_cash_bank_transaction" },
    select: { id: true },
  });
  if (!docType) {
    throw new Error("Doc type fin_cash_bank_transaction belum ada. Jalankan db:seed.");
  }

  const posted = await prisma.finCashBankTransaction.findMany({
    where: { status: "Posted" },
    orderBy: { id: "asc" },
    select: {
      id: true,
      transaction_no: true,
      purpose: true,
      partner_id: true,
      currency_id: true,
      currency: { select: { currency_label: true } },
      transaction_type: true,
      transaction_amount: true,
      document_date: true,
      posting_date: true,
      created_by: true,
    },
  });

  const already = new Set(
    (
      await prisma.subLedger.findMany({
        where: { source_doc_type_id: docType.id },
        select: { source_doc_id: true },
      })
    ).map((e) => e.source_doc_id)
  );

  let written = 0;
  let skipped = 0;
  let noBook = 0;
  let unvalued = 0;

  const books = await loadSubledgers();
  for (const doc of posted) {
    if (already.has(doc.id)) {
      skipped += 1;
      continue;
    }

    const purpose = await purposeByKey(doc.purpose);
    // The Budget Category owns the book; the Purpose only names which category
    // this document carries. Resolved by id, never by the label the Purpose
    // holds a copy of.
    const categoryId = purpose?.budgetCategoryId ?? null;
    const book = subledgerForCategory(books, categoryId);
    if (!book || !doc.partner_id) {
      noBook += 1;
      continue;
    }

    // A book entry now states what it was worth in base currency, and this
    // script cannot know the kurs a foreign document moved at — it replays
    // documents that were posted before any rate was recorded. A base-currency
    // document replays at 1, which is true; a foreign one is left alone rather
    // than backfilled at a rate nobody used.
    if (!isBaseCurrency(doc.currency.currency_label)) {
      unvalued += 1;
      continue;
    }

    // The day the money actually moved, exactly as the Cash Bank Book recorded
    // it. Falling back to the posting date keeps a document written before
    // `document_date` was filled in from landing on today.
    const date = (doc.document_date ?? doc.posting_date ?? new Date())
      .toISOString()
      .slice(0, 10);

    await prisma.$transaction((tx) =>
      recordSubledgerEntry(tx, {
        book,
        partnerId: doc.partner_id!,
        currencyId: doc.currency_id,
        date,
        type: "Transaction",
        direction: doc.transaction_type as "In" | "Out",
        amount: doc.transaction_amount.toNumber(),
        rate: 1,
        sourceDocTypeId: docType.id,
        sourceDocId: doc.id,
        note: `${doc.transaction_no} — ${purpose!.label}`,
        actorId: doc.created_by,
      })
    );

    written += 1;
    console.log(`  ${doc.transaction_no} -> ${book.name}`);
  }

  console.log(
    `\n${posted.length} dokumen Posted diperiksa: ${written} entri ditulis, ` +
      `${skipped} sudah ada, ${noBook} tanpa buku pembantu (Asset / Biaya), ` +
      `${unvalued} dilewati karena mata uang asing belum dapat dinilai.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
