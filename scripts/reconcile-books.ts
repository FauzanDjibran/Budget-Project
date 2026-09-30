/**
 * Reconciles Budget realization against every book, and every book against
 * the General Ledger. Read-only: the checks run inside a `READ ONLY`
 * transaction, so the database itself refuses a write.
 *
 * A hand-run script, outside install, migrate, reset and CI — like
 * `truncate-transactions.ts`. Run it after changing a posting path, after a
 * simulation, or whenever a report looks wrong:
 *
 *   npm run db:reconcile
 *
 * Each check selects **only the rows that disagree**, so an empty result is a
 * pass. It prints every check, lists the first rows of any that fail, and
 * exits 1 if one did — so it can gate a script of its own.
 *
 * WHAT IT PROVES
 *   1–2   a Budget's realization is exactly its posted lines, and it is Closed
 *         exactly when that reaches its amount
 *   3–5   a posted Realisasi writes one Cash Bank Book entry per line, one
 *         subject-book entry per line whose category keeps a book (none for
 *         the others), each moving the book its own way
 *   6–8   every posted journal balances; a Realisasi has one, with a counter
 *         line per Budget and each FX difference on the side its sign says
 *   9–12  every materialised figure equals the entries under it: cash
 *         balances, foreign layers, open items (Cleared exactly at nil)
 *   13–14 each book equals its General Ledger account — a cash resource on
 *         its own account, a subject book per account and Partner
 *   15–16 a line settling open items is worth what its items add up to, and
 *         the items' shares of the cash and of what was released add up to
 *         the line's own figures
 *
 * WHAT IT LEAVES OUT, ON PURPOSE
 *   An `Opening` Cash Bank Book entry writes no journal (CLAUDE.md §12), so
 *   check 13 compares the book without them and reports them beside it.
 *   Closing journals (`CLS-`) are left out of check 14: they zero Laba Rugi
 *   accounts at year end, while a subject book such as Hasil Investasi keeps
 *   counting, which is what it is for.
 *
 * Every check was confirmed to fail on a fault planted to test it — a
 * realization off by a rupiah, an entry signed the wrong way, a journal line
 * off by a rupiah, a drifted balance.
 */
import { prisma } from "@/lib/prisma";

/** Shared by every check. Prepended as the first CTEs of each query. */
const BASE = `
WITH dt AS (
  SELECT (SELECT id FROM sys_doc_type WHERE doc_table = 'fin_cash_bank_transaction') AS tx,
         (SELECT id FROM sys_doc_type WHERE doc_table = 'bud_budget') AS bud
),
book_cat AS (
  SELECT id, category_code, category_label, raises,
         (require_partner AND raises IS NOT NULL) AS keeps_book
  FROM sys_budget_category
)`;

/** A check's own SQL starts with `SELECT`, or with `, name AS (...)` to add CTEs. */
const CHECKS: { no: number; name: string; sql: string }[] = [
  {
    no: 1,
    name: "Realisasi Budget = jumlah line pada dokumen Posted",
    sql: `
SELECT b.budget_no, b.realized_amount,
       COALESCE(SUM(l.settlement_amount) FILTER (WHERE t.status = 'Posted'), 0) AS posted_lines
FROM bud_budget b
LEFT JOIN fin_cash_bank_transaction_line l
  ON l.source_doc_id = b.id AND l.source_doc_type_id = (SELECT bud FROM dt)
LEFT JOIN fin_cash_bank_transaction t ON t.id = l.transaction_id
GROUP BY b.id
HAVING b.realized_amount <> COALESCE(SUM(l.settlement_amount) FILTER (WHERE t.status = 'Posted'), 0)`,
  },
  {
    no: 2,
    name: "Budget Closed tepat saat realisasi mencapai nominalnya",
    sql: `
SELECT budget_no, status, budget_amount, realized_amount FROM bud_budget
WHERE (status = 'Open' AND budget_amount > 0 AND realized_amount >= budget_amount)
   OR (status = 'Closed' AND realized_amount < budget_amount)`,
  },
  {
    no: 3,
    name: "Satu entri Buku Kas & Bank per line, nilai dasar sama dengan dokumen",
    sql: `
, cb AS (
  SELECT source_doc_id AS id, COUNT(*) AS n, SUM(base_amount) AS base
  FROM cash_bank_ledger WHERE source_doc_type_id = (SELECT tx FROM dt)
  GROUP BY source_doc_id
)
SELECT t.transaction_no, COUNT(l.id) AS lines, COALESCE(cb.n, 0) AS entries,
       t.transaction_base_amount AS doc_base, COALESCE(cb.base, 0) AS entry_base
FROM fin_cash_bank_transaction t
JOIN fin_cash_bank_transaction_line l ON l.transaction_id = t.id
LEFT JOIN cb ON cb.id = t.id
WHERE t.status = 'Posted' AND t.cash_bank_id IS NOT NULL
GROUP BY t.id, cb.n, cb.base
HAVING COUNT(l.id) <> COALESCE(cb.n, 0) OR t.transaction_base_amount <> COALESCE(cb.base, 0)`,
  },
  {
    no: 4,
    name: "Entri Buku Subjek: satu per open item yang diselesaikan, atau satu per line yang menaikkan",
    sql: `
, alloc AS (
  SELECT line_id, COUNT(*) AS n FROM fin_cash_bank_transaction_line_item GROUP BY line_id
), want AS (
  SELECT t.id, t.transaction_no,
         COALESCE(SUM(COALESCE(a.n, 1)) FILTER (WHERE c.keeps_book), 0) AS n,
         COALESCE(SUM(l.settlement_amount) FILTER (WHERE c.keeps_book), 0) AS amount
  FROM fin_cash_bank_transaction t
  JOIN fin_cash_bank_transaction_line l ON l.transaction_id = t.id
  LEFT JOIN alloc a ON a.line_id = l.id
  JOIN bud_budget b ON b.id = l.source_doc_id
  JOIN book_cat c ON c.id = b.category_id
  WHERE t.status = 'Posted'
  GROUP BY t.id
), got AS (
  SELECT source_doc_id AS id, COUNT(*) AS n, SUM(amount) AS amount
  FROM sub_ledger WHERE source_doc_type_id = (SELECT tx FROM dt)
  GROUP BY source_doc_id
)
SELECT w.transaction_no, w.n AS book_lines, COALESCE(g.n, 0) AS entries,
       w.amount AS line_amount, COALESCE(g.amount, 0) AS entry_amount
FROM want w LEFT JOIN got g ON g.id = w.id
WHERE w.n <> COALESCE(g.n, 0) OR w.amount <> COALESCE(g.amount, 0)`,
  },
  {
    no: 5,
    name: "Entri Buku Subjek bergerak ke arah bukunya sendiri",
    sql: `
SELECT s.entry_no, s.book, s.direction::text, s.movement, c.raises::text
FROM sub_ledger s JOIN book_cat c ON c.category_code = s.book
WHERE s.entry_type = 'Transaction'
  AND SIGN(s.movement) <> CASE WHEN s.direction::text = c.raises::text THEN 1 ELSE -1 END`,
  },
  {
    no: 6,
    name: "Setiap journal Posted seimbang",
    sql: `
SELECT j.journal_no, SUM(l.debit_amount) AS debit, SUM(l.kredit_amount) AS kredit
FROM acc_journal j JOIN acc_journal_line l ON l.journal_id = j.id
WHERE j.status = 'Posted'
GROUP BY j.id
HAVING SUM(l.debit_amount) <> SUM(l.kredit_amount)`,
  },
  {
    no: 7,
    name: "Satu journal per Realisasi, dengan satu baris lawan per Budget",
    // The counter lines are every line that is neither the cash account nor an
    // FX line; an FX line is known by the description the engine writes.
    sql: `
, j AS (
  SELECT jj.source_doc_id AS id, COUNT(DISTINCT jj.id) AS journals
  FROM acc_journal jj WHERE jj.source_doc_type_id = (SELECT tx FROM dt)
  GROUP BY jj.source_doc_id
), counter AS (
  SELECT jj.source_doc_id AS id, COUNT(*) AS n
  FROM acc_journal jj
  JOIN acc_journal_line jl ON jl.journal_id = jj.id
  JOIN fin_cash_bank_transaction t ON t.id = jj.source_doc_id
  JOIN m_cash_bank cb ON cb.id = t.cash_bank_id
  WHERE jj.source_doc_type_id = (SELECT tx FROM dt)
    AND jl.account_id <> cb.account_id
    AND jl.description NOT LIKE 'Selisih kurs%'
  GROUP BY jj.source_doc_id
)
SELECT t.transaction_no, COALESCE(j.journals, 0) AS journals,
       COUNT(l.id) AS lines, COALESCE(counter.n, 0) AS counter_lines
FROM fin_cash_bank_transaction t
JOIN fin_cash_bank_transaction_line l ON l.transaction_id = t.id
LEFT JOIN j ON j.id = t.id
LEFT JOIN counter ON counter.id = t.id
WHERE t.status = 'Posted' AND t.cash_bank_id IS NOT NULL
GROUP BY t.id, j.journals, counter.n
HAVING COALESCE(j.journals, 0) <> 1 OR COUNT(l.id) <> COALESCE(counter.n, 0)`,
  },
  {
    no: 8,
    name: "Selisih kurs setiap open item dijurnal sendiri, di sisi sesuai tandanya",
    // A line settling items journals one line per item, never netted; the
    // count of FX lines must match the count of non-nil differences too.
    sql: `
, diffs AS (
  SELECT t.id AS doc, t.transaction_no, a.fx_difference
  FROM fin_cash_bank_transaction t
  JOIN fin_cash_bank_transaction_line l ON l.transaction_id = t.id
  JOIN fin_cash_bank_transaction_line_item a ON a.line_id = l.id
  WHERE t.status = 'Posted' AND a.fx_difference <> 0
  UNION ALL
  SELECT t.id, t.transaction_no, l.fx_difference
  FROM fin_cash_bank_transaction t
  JOIN fin_cash_bank_transaction_line l ON l.transaction_id = t.id
  WHERE t.status = 'Posted' AND l.fx_difference <> 0
    AND NOT EXISTS (SELECT 1 FROM fin_cash_bank_transaction_line_item a WHERE a.line_id = l.id)
), wanted AS (
  SELECT doc, transaction_no,
         COUNT(*) AS n,
         SUM(CASE WHEN fx_difference > 0 THEN fx_difference ELSE 0 END) AS gains,
         SUM(CASE WHEN fx_difference < 0 THEN -fx_difference ELSE 0 END) AS losses
  FROM diffs GROUP BY doc, transaction_no
), written AS (
  SELECT jj.source_doc_id AS doc, COUNT(*) AS n,
         SUM(jl.kredit_amount) AS gains, SUM(jl.debit_amount) AS losses
  FROM acc_journal jj JOIN acc_journal_line jl ON jl.journal_id = jj.id
  WHERE jj.source_doc_type_id = (SELECT tx FROM dt) AND jl.description LIKE 'Selisih kurs%'
  GROUP BY jj.source_doc_id
)
SELECT w.transaction_no, w.n AS differences, COALESCE(j.n, 0) AS fx_lines,
       w.gains, COALESCE(j.gains, 0) AS credited, w.losses, COALESCE(j.losses, 0) AS debited
FROM wanted w LEFT JOIN written j ON j.doc = w.doc
WHERE w.n <> COALESCE(j.n, 0) OR w.gains <> COALESCE(j.gains, 0) OR w.losses <> COALESCE(j.losses, 0)`,
  },
  {
    no: 15,
    name: "Line yang menyelesaikan open item bernilai jumlah item-nya",
    sql: `
SELECT t.transaction_no, l.sequence_no, l.settlement_amount, SUM(a.amount) AS items
FROM fin_cash_bank_transaction t
JOIN fin_cash_bank_transaction_line l ON l.transaction_id = t.id
JOIN fin_cash_bank_transaction_line_item a ON a.line_id = l.id
GROUP BY t.id, l.id
HAVING l.settlement_amount <> SUM(a.amount)`,
  },
  {
    no: 16,
    name: "Bagian kas setiap item berjumlah tepat biaya kas line-nya (Posted)",
    sql: `
SELECT t.transaction_no, l.sequence_no, l.transaction_base_amount,
       SUM(a.transaction_base_amount) AS item_shares,
       l.settlement_base_amount, SUM(a.settlement_base_amount) AS item_released
FROM fin_cash_bank_transaction t
JOIN fin_cash_bank_transaction_line l ON l.transaction_id = t.id
JOIN fin_cash_bank_transaction_line_item a ON a.line_id = l.id
WHERE t.status = 'Posted'
GROUP BY t.id, l.id
HAVING l.transaction_base_amount <> SUM(a.transaction_base_amount)
    OR l.settlement_base_amount <> SUM(a.settlement_base_amount)`,
  },
  {
    no: 9,
    name: "Saldo Cash & Bank = jumlah entrinya, di kedua ukuran",
    sql: `
SELECT cb.cash_bank_label, b.balance, COALESCE(SUM(e.movement), 0) AS summed,
       b.base_balance, COALESCE(SUM(e.base_movement), 0) AS base_summed
FROM cash_bank_balance b
JOIN m_cash_bank cb ON cb.id = b.cash_bank_id
LEFT JOIN cash_bank_ledger e ON e.cash_bank_id = b.cash_bank_id
GROUP BY cb.id, b.balance, b.base_balance
HAVING b.balance <> COALESCE(SUM(e.movement), 0)
    OR b.base_balance <> COALESCE(SUM(e.base_movement), 0)`,
  },
  {
    no: 10,
    name: "Layer kurs yang terbuka = saldo resource asingnya, di kedua ukuran",
    sql: `
SELECT cb.cash_bank_label, b.balance, COALESCE(SUM(y.foreign_remaining), 0) AS layers,
       b.base_balance, COALESCE(SUM(y.base_remaining), 0) AS layer_base
FROM cash_bank_balance b
JOIN m_cash_bank cb ON cb.id = b.cash_bank_id
JOIN ref_currency c ON c.id = cb.currency_id AND c.currency_label <> 'IDR'
LEFT JOIN cash_bank_layer y ON y.cash_bank_id = cb.id AND y.status = 'Open'
GROUP BY cb.id, b.balance, b.base_balance
HAVING b.balance <> COALESCE(SUM(y.foreign_remaining), 0)
    OR b.base_balance <> COALESCE(SUM(y.base_remaining), 0)`,
  },
  {
    no: 11,
    name: "Open item = jumlah entri yang menunjuknya; Cleared tepat di nol",
    sql: `
SELECT i.item_no, i.status::text, i.balance, COALESCE(SUM(s.movement), 0) AS summed,
       i.base_balance, COALESCE(SUM(s.base_movement), 0) AS base_summed
FROM sub_ledger_balance i
LEFT JOIN sub_ledger s ON s.balance_id = i.id
GROUP BY i.id
HAVING i.balance <> COALESCE(SUM(s.movement), 0)
    OR i.base_balance <> COALESCE(SUM(s.base_movement), 0)
    OR (i.status = 'Cleared') <> (i.balance = 0)`,
  },
  {
    no: 12,
    name: "Tidak ada open item di bawah nol",
    sql: `
SELECT item_no, balance, base_balance FROM sub_ledger_balance
WHERE balance < 0 OR base_balance < 0`,
  },
  {
    no: 13,
    name: "Buku Kas & Bank = General Ledger pada account resource (tanpa entri Opening)",
    sql: `
, book AS (
  SELECT cash_bank_id,
         COALESCE(SUM(base_movement) FILTER (WHERE entry_type <> 'Opening'), 0) AS moved,
         COALESCE(SUM(base_movement) FILTER (WHERE entry_type = 'Opening'), 0) AS opening
  FROM cash_bank_ledger GROUP BY cash_bank_id
), gl AS (
  SELECT jl.account_id, SUM(jl.debit_amount - jl.kredit_amount) AS balance
  FROM acc_journal_line jl JOIN acc_journal j ON j.id = jl.journal_id
  WHERE j.status = 'Posted'
  GROUP BY jl.account_id
)
SELECT cb.cash_bank_label, a.account_label,
       COALESCE(book.moved, 0) AS book_without_opening,
       COALESCE(gl.balance, 0) AS gl,
       COALESCE(book.opening, 0) AS opening_not_journaled
FROM m_cash_bank cb
JOIN acc_account a ON a.id = cb.account_id
LEFT JOIN book ON book.cash_bank_id = cb.id
LEFT JOIN gl ON gl.account_id = cb.account_id
WHERE COALESCE(book.moved, 0) <> COALESCE(gl.balance, 0)`,
  },
  {
    no: 14,
    name: "Buku Subjek = General Ledger, per account dan Partner (tanpa journal CLS-)",
    sql: `
, acct AS (
  SELECT DISTINCT m.account_id, c.raises::text AS raises
  FROM acc_budget_category_account m
  JOIN book_cat c ON c.id = m.budget_category_id
  WHERE c.keeps_book
), book AS (
  SELECT m.account_id, s.partner_id, SUM(s.base_movement) AS amount
  FROM sub_ledger s
  JOIN book_cat c ON c.category_code = s.book
  JOIN m_partner p ON p.id = s.partner_id
  JOIN acc_budget_category_account m
    ON m.company_id = p.company_id AND m.budget_category_id = c.id
   AND m.partner_category_id IS NOT DISTINCT FROM p.category_id
  GROUP BY m.account_id, s.partner_id
), gl AS (
  -- Signed the way the book is: a book that rises on money out rises on the
  -- debit side of its account, one that rises on money in on the credit side.
  SELECT jl.account_id, jl.partner_id,
         SUM(CASE WHEN a.raises = 'Out' THEN jl.debit_amount - jl.kredit_amount
                  ELSE jl.kredit_amount - jl.debit_amount END) AS amount
  FROM acc_journal_line jl
  JOIN acc_journal j ON j.id = jl.journal_id
  JOIN acct a ON a.account_id = jl.account_id
  WHERE j.status = 'Posted' AND j.journal_no NOT LIKE 'CLS-%'
  GROUP BY jl.account_id, jl.partner_id
)
SELECT ac.account_label, ac.account_name, p.partner_label,
       COALESCE(book.amount, 0) AS book, COALESCE(gl.amount, 0) AS gl
FROM book
FULL JOIN gl ON gl.account_id = book.account_id
            AND gl.partner_id IS NOT DISTINCT FROM book.partner_id
JOIN acc_account ac ON ac.id = COALESCE(book.account_id, gl.account_id)
LEFT JOIN m_partner p ON p.id = COALESCE(book.partner_id, gl.partner_id)
WHERE COALESCE(book.amount, 0) <> COALESCE(gl.amount, 0)`,
  },
];

/** Decimals and bigints printed as plain figures, for `console.table`. */
const plain = (rows: Record<string, unknown>[]) =>
  rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        typeof v === "bigint" || (v !== null && typeof v === "object" && "toFixed" in v)
          ? String(v)
          : v,
      ])
    )
  );

async function main() {
  const results = await prisma.$transaction(async (tx) => {
    // The database refuses any write for the rest of this transaction, so no
    // check can change what it is checking — whatever its SQL says.
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const out: { no: number; name: string; rows: Record<string, unknown>[] }[] = [];
    for (const c of CHECKS) {
      // Constant SQL with no user input anywhere in it (CLAUDE.md §11).
      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(BASE + c.sql);
      out.push({ no: c.no, name: c.name, rows });
    }
    return out;
  });

  let failed = 0;
  results.sort((a, b) => a.no - b.no);
  for (const r of results) {
    if (!r.rows.length) {
      console.log(`✓ ${String(r.no).padStart(2)}. ${r.name}`);
      continue;
    }
    failed++;
    console.log(`✗ ${String(r.no).padStart(2)}. ${r.name} — ${r.rows.length} baris tidak cocok`);
    console.table(plain(r.rows.slice(0, 20)));
    if (r.rows.length > 20) console.log(`   … dan ${r.rows.length - 20} lainnya`);
  }

  const [counts] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
SELECT (SELECT COUNT(*) FROM fin_cash_bank_transaction WHERE status = 'Posted') AS posted_documents,
       (SELECT COUNT(*) FROM sub_ledger) AS subledger_entries,
       (SELECT COUNT(*) FROM sub_ledger_balance) AS open_items,
       (SELECT COUNT(*) FROM acc_journal WHERE status = 'Posted') AS posted_journals`);
  console.log("\nDiperiksa:", plain([counts])[0]);
  console.log(
    failed
      ? `\n${failed} dari ${results.length} pemeriksaan gagal.`
      : `\nSemua ${results.length} pemeriksaan cocok.`
  );
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
