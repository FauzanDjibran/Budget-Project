/**
 * One-off: classifies the Cash Bank Book entries written before an entry
 * carried its own Partner, Budget Category and cash-flow group (Laporan Arus
 * Kas step 5). Reads each entry's source document once, here, so the report
 * never has to; uses Mapping Cash Flow as it stands now.
 *
 *   Realisasi / Funding   the document's lines, matched to its entries in the
 *                         order both were written (one entry per line, §10
 *                         rule 54); the Budget's Partner and category; the
 *                         category's group, or the Funding mapping's.
 *   Pencairan Open Item   the document's Partner and book; the book's group.
 *   Pencairan / BuyFx /   the entry type's group.
 *   Journal
 *
 * Idempotent: only a cash flow still without a group is touched, and an entry
 * it cannot place is reported and left for the report's *Belum Dikelompokkan*.
 * Run by hand (`npm run db:backfill-cashflow`), never by install or CI.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

const FLOW_TYPES = ["Realization", "Funding", "Pencairan", "BuyFx", "Conversion", "Journal"] as const;

async function main() {
  const mappings = await prisma.accCashflowMapping.findMany();
  const categoryGroup = new Map(
    mappings.filter((m) => m.budget_category_id != null).map((m) => [m.budget_category_id!, m.cashflow_group_id])
  );
  const typeGroup = new Map(mappings.filter((m) => m.entry_type != null).map((m) => [m.entry_type!, m.cashflow_group_id]));

  const entries = await prisma.cashBankLedger.findMany({
    where: { cashflow_group_id: null, entry_type: { in: [...FLOW_TYPES] } },
    include: { source_doc_type: { select: { doc_table: true } } },
    orderBy: { id: "asc" },
  });

  const unplaced: string[] = [];
  let placed = 0;
  const set = async (id: number, partnerId: number | null, categoryId: number | null, groupId: number | undefined, entryNo: string, why: string) => {
    if (groupId == null) {
      unplaced.push(`${entryNo} (${why})`);
      return;
    }
    await prisma.cashBankLedger.update({
      where: { id },
      data: { partner_id: partnerId, budget_category_id: categoryId, cashflow_group_id: groupId },
    });
    placed++;
  };

  // Realisasi and Funding: entries of one document, in write order, against its lines in order.
  const realizationDocs = [
    ...new Set(
      entries
        .filter((e) => (e.entry_type === "Realization" || e.entry_type === "Funding") && e.source_doc_id != null)
        .map((e) => e.source_doc_id!)
    ),
  ];
  for (const docId of realizationDocs) {
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
    const docEntries = entries.filter(
      (e) => (e.entry_type === "Realization" || e.entry_type === "Funding") && e.source_doc_id === docId
    );
    if (docEntries.length !== lines.length) {
      for (const e of docEntries) unplaced.push(`${e.entry_no} (${lines.length} baris dokumen, ${docEntries.length} entri)`);
      continue;
    }
    for (const [i, e] of docEntries.entries()) {
      const budget = budgets.get(lines[i].source_doc_id);
      const group =
        e.entry_type === "Funding"
          ? typeGroup.get("Funding")
          : budget?.category_id != null
            ? categoryGroup.get(budget.category_id)
            : undefined;
      await set(e.id, budget?.partner_id ?? null, budget?.category_id ?? null, group, e.entry_no, "kategori belum dipetakan");
    }
  }

  for (const e of entries) {
    if (e.entry_type === "Conversion") {
      const doc = e.source_doc_id
        ? await prisma.finItemConversion.findUnique({
            where: { id: e.source_doc_id },
            select: { partner_id: true, budget_category_id: true },
          })
        : null;
      await set(e.id, doc?.partner_id ?? null, doc?.budget_category_id ?? null, doc ? categoryGroup.get(doc.budget_category_id) : undefined, e.entry_no, "buku belum dipetakan");
    } else if (e.entry_type === "Pencairan" || e.entry_type === "BuyFx" || e.entry_type === "Journal") {
      await set(e.id, null, null, typeGroup.get(e.entry_type), e.entry_no, `${e.entry_type} belum dipetakan`);
    }
  }

  console.log(`Dikelompokkan: ${placed} entri.`);
  if (unplaced.length) {
    console.log(`Belum dapat dikelompokkan (${unplaced.length}):`);
    for (const u of unplaced) console.log(`  ${u}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
