/**
 * One-off: gives the Cash Bank Book entries written before an entry carried its
 * own Partner and Budget Category those two facts (Laporan Arus Kas). Reads each
 * entry's source document once, here, so the report never has to. The cash-flow
 * group is not written — the report resolves it through Mapping Cash Flow.
 *
 *   Realisasi / Funding   the document's lines, matched to its entries in the
 *                         order both were written (one entry per line, §10
 *                         rule 54); the Budget's Partner and category.
 *   Pencairan Open Item   the document's Partner and book.
 *
 * Idempotent: only an entry still naming neither is touched, and one it cannot
 * place is reported. Run by hand (`npm run db:backfill-cashflow`), never by
 * install or CI.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
  const entries = await prisma.cashBankLedger.findMany({
    where: {
      partner_id: null,
      budget_category_id: null,
      entry_type: { in: ["Realization", "Funding", "Conversion"] },
    },
    orderBy: { id: "asc" },
  });

  const unplaced: string[] = [];
  let placed = 0;
  const set = async (id: number, partnerId: number | null, categoryId: number | null) => {
    await prisma.cashBankLedger.update({
      where: { id },
      data: { partner_id: partnerId, budget_category_id: categoryId },
    });
    placed++;
  };

  // Realisasi and Funding: entries of one document, in write order, against its lines in order.
  const realization = entries.filter((e) => e.entry_type !== "Conversion" && e.source_doc_id != null);
  for (const docId of [...new Set(realization.map((e) => e.source_doc_id!))]) {
    const lines = await prisma.finCashBankTransactionLine.findMany({
      where: { transaction_id: docId },
      orderBy: { sequence_no: "asc" },
      select: { source_doc_id: true },
    });
    const budgets = new Map(
      (
        await prisma.budBudget.findMany({
          where: { id: { in: lines.map((l) => l.source_doc_id) } },
          select: { id: true, partner_id: true, category_id: true },
        })
      ).map((b) => [b.id, b])
    );
    const docEntries = realization.filter((e) => e.source_doc_id === docId);
    if (docEntries.length !== lines.length) {
      for (const e of docEntries) unplaced.push(`${e.entry_no} (${lines.length} baris dokumen, ${docEntries.length} entri)`);
      continue;
    }
    for (const [i, e] of docEntries.entries()) {
      const budget = budgets.get(lines[i].source_doc_id);
      await set(e.id, budget?.partner_id ?? null, budget?.category_id ?? null);
    }
  }

  for (const e of entries.filter((x) => x.entry_type === "Conversion")) {
    const doc = e.source_doc_id
      ? await prisma.finItemConversion.findUnique({
          where: { id: e.source_doc_id },
          select: { partner_id: true, budget_category_id: true },
        })
      : null;
    if (doc) await set(e.id, doc.partner_id, doc.budget_category_id);
    else unplaced.push(`${e.entry_no} (dokumen tidak ditemukan)`);
  }

  console.log(`Diisi Partner dan Budget Category: ${placed} entri.`);
  if (unplaced.length) {
    console.log(`Tidak dapat diisi (${unplaced.length}):`);
    for (const u of unplaced) console.log(`  ${u}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
