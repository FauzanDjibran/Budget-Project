import "server-only";
import type { TransactionStatus } from "./transaction-workflow";

import { prisma } from "@/lib/prisma";
import { budgetsByIds } from "./budget";
import { subledgerItemsByIds, type SubledgerItem } from "./subledger";

/** Reads of Realisasi documents: the register rows, a document's lines and a Budget's realizations. */

// ---------------------------------------------------------------- doc types

/**
 * The `sys_doc_type` row a line points at, resolved by table name.
 *
 * Looked up rather than hardcoded: the ids depend on seed order, and a document
 * reference that silently points at the wrong type is the kind of mistake
 * nothing downstream would catch.
 */
async function docTypeIdFor(table: string): Promise<number> {
  const row = await prisma.sysDocType.findFirstOrThrow({
    where: { doc_table: table },
    select: { id: true },
  });
  return row.id;
}

export const budgetDocTypeId = () => docTypeIdFor("bud_budget");
export const transactionDocTypeId = () =>
  docTypeIdFor("fin_cash_bank_transaction");


/** One open item as a line's picker offers it. */
export type OpenItemOption = {
  id: number;
  itemNo: string;
  date: string;
  rate: number;
  remaining: number;
  note: string | null;
};

export const itemOption = (i: SubledgerItem): OpenItemOption => ({
  id: i.id,
  itemNo: i.itemNo,
  date: i.date,
  rate: i.rate,
  remaining: i.remaining,
  note: i.note,
});

const day = (d: Date): string => d.toISOString().slice(0, 10);

// -------------------------------------------------------------------- rows

export type TransactionRow = {
  id: number;
  transaction_no: string;
  accounting_date: string | null;
  posted_at: string | null;
  transaction_type: "In" | "Out";
  company_id: number;
  cash_bank_id: number | null;
  currency_id: number;
  transaction_amount: number;
  /** The kurs the document was valued at. */
  exchange_rate: number;
  cash_bank_layer_id: number | null;
  note: string | null;
  status: TransactionStatus;
  line_count: number;
  created_by: number;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type TransactionLineRow = {
  id: number;
  sequence_no: number;
  budget_id: number;
  budget_no: string;
  budget_date: string;
  description: string;
  category_id: number | null;
  partner_id: number | null;
  budget_amount: number;
  realized_amount: number;
  /** What was still settleable when the line was written. */
  outstanding_amount: number;
  settlement_amount: number;
  budget_status: string;
  /** The open items the line settles, where it lowers a position — in order. */
  items: LineItemRow[];
};

/** One open item a saved line settles, and what it came to. */
export type LineItemRow = {
  item: OpenItemOption;
  /** In the document's currency. */
  amount: number;
  /** Signed as a gain; nil until Post, which is when it is valued. */
  fxDifference: number;
};

type TxRecord = {
  id: number;
  transaction_no: string;
  accounting_date: Date | null;
  posted_at: Date | null;
  transaction_type: string;
  company_id: number;
  cash_bank_id: number | null;
  currency_id: number;
  transaction_amount: { toNumber(): number };
  exchange_rate: { toNumber(): number };
  cash_bank_layer_id: number | null;
  note: string | null;
  status: string;
  created_by: number;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
  _count?: { lines: number };
};

export function toRow(t: TxRecord): TransactionRow {
  return {
    id: t.id,
    transaction_no: t.transaction_no,
    accounting_date: t.accounting_date ? day(t.accounting_date) : null,
    posted_at: t.posted_at ? t.posted_at.toISOString() : null,
    transaction_type: t.transaction_type as "In" | "Out",
    company_id: t.company_id,
    cash_bank_id: t.cash_bank_id,
    currency_id: t.currency_id,
    transaction_amount: t.transaction_amount.toNumber(),
    exchange_rate: t.exchange_rate.toNumber(),
    cash_bank_layer_id: t.cash_bank_layer_id,
    note: t.note,
    status: t.status as TransactionStatus,
    line_count: t._count?.lines ?? 0,
    created_by: t.created_by,
    updated_by: t.updated_by,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
  };
}

export async function listTransactions(
  companyIds: number[],
  direction?: "In" | "Out"
): Promise<TransactionRow[]> {
  // Every document belongs to the induk today (§12), so a user holding induk
  // access sees exactly what they did before. What this adds is the other
  // half: a user without it sees none, and the list is already right when
  // Funding Request brings the anak into Finance.
  const rows = await prisma.finCashBankTransaction.findMany({
    where: {
      company_id: { in: companyIds },
      ...(direction ? { transaction_type: direction } : {}),
    },
    orderBy: [{ id: "desc" }],
    include: { _count: { select: { lines: true } } },
  });
  return rows.map(toRow);
}

export async function getTransaction(
  id: number
): Promise<TransactionRow | null> {
  const row = await prisma.finCashBankTransaction.findUnique({
    where: { id },
    include: { _count: { select: { lines: true } } },
  });
  return row ? toRow(row) : null;
}

/**
 * One document's lines, joined to the Budget each settles.
 *
 * `source_doc_type_id` / `source_doc_id` are deliberately generic so a line can
 * one day settle any document type; today only Budget is ever referenced, so
 * the join is resolved here rather than by a polymorphic reader.
 */
export async function transactionLines(
  transactionId: number
): Promise<TransactionLineRow[]> {
  const lines = await prisma.finCashBankTransactionLine.findMany({
    where: { transaction_id: transactionId },
    orderBy: { sequence_no: "asc" },
    include: { items: { orderBy: { sequence_no: "asc" } } },
  });
  if (!lines.length) return [];

  const [budgets, items] = await Promise.all([
    budgetsByIds(lines.map((l) => l.source_doc_id)),
    subledgerItemsByIds(
      lines.flatMap((l) => l.items.map((a) => a.sub_ledger_balance_id))
    ),
  ]);
  const byId = new Map(budgets.map((b) => [b.id, b]));
  const itemOf = new Map(items.map((i) => [i.id, itemOption(i)]));

  return lines.flatMap((l) => {
    const b = byId.get(l.source_doc_id);
    if (!b) return [];
    return [
      {
        id: l.id,
        sequence_no: l.sequence_no,
        budget_id: b.id,
        budget_no: b.budget_no,
        budget_date: b.budget_date,
        description: b.description,
        category_id: b.category_id,
        partner_id: b.partner_id,
        budget_amount: b.budget_amount,
        realized_amount: b.realized_amount,
        outstanding_amount: l.outstanding_amount.toNumber(),
        settlement_amount: l.settlement_amount.toNumber(),
        budget_status: b.status,
        items: l.items.flatMap((a) => {
          const item = itemOf.get(a.sub_ledger_balance_id);
          return item
            ? [
                {
                  item,
                  amount: a.amount.toNumber(),
                  fxDifference: a.fx_difference.toNumber(),
                },
              ]
            : [];
        }),
      },
    ];
  });
}

/**
 * Every document that has ever named one Budget — the realization trace.
 *
 * `realized_amount` says how much has been spent against a plan; this says by
 * which documents, which is the question anybody who doubts the figure asks
 * next. Draft and Cancelled documents are included and labelled, because a
 * Budget "reserved" by a Draft somebody forgot to post is exactly what a
 * planner needs to see.
 */
export async function budgetRealizations(budgetId: number): Promise<
  {
    transactionId: number;
    transactionNo: string;
    date: string | null;
    status: TransactionStatus;
    direction: "In" | "Out";
    amount: number;
    /** The open item the line opened, where it raised a subject-book position. */
    openedItemId: number | null;
  }[]
> {
  const docType = await budgetDocTypeId();
  const lines = await prisma.finCashBankTransactionLine.findMany({
    where: { source_doc_type_id: docType, source_doc_id: budgetId },
    include: { transaction: true },
    orderBy: { id: "asc" },
  });
  return lines.map((l) => ({
    transactionId: l.transaction.id,
    transactionNo: l.transaction.transaction_no,
    date: l.transaction.accounting_date ? day(l.transaction.accounting_date) : null,
    status: l.transaction.status as TransactionStatus,
    direction: l.transaction.transaction_type as "In" | "Out",
    amount: l.settlement_amount.toNumber(),
    openedItemId: l.opened_item_id,
  }));
}

