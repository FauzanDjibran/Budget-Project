import "server-only";

import { prisma } from "@/lib/prisma";
import { cashBankBalanceMap } from "./cash-bank";
import { openLayersFor, type LayerOption } from "./cash-bank-layers";
import { isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { type TransferPurposeKey } from "./transfer-catalogue";
import type { TransferStatus } from "./transfer-workflow";

const day = (d: Date): string => d.toISOString().slice(0, 10);

/** Reads of Cash Bank Transfer: the register rows, a document and its lines, its number, and the options its form picks from. */

// --------------------------------------------------------------------- rows

export type TransferRow = {
  id: number;
  transfer_no: string;
  accounting_date: string | null;
  posted_at: string | null;
  company_id: number;
  purpose: TransferPurposeKey;
  from_cash_bank_id: number;
  currency_id: number;
  cash_bank_layer_id: number | null;
  transfer_amount: number;
  transfer_base_amount: number;
  note: string | null;
  status: TransferStatus;
  line_count: number;
  created_by: number;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type TransferLineRow = {
  id: number;
  sequence_no: number;
  to_cash_bank_id: number;
  amount: number;
  exchange_rate: number;
  out_amount: number;
  out_base_amount: number;
  in_amount: number;
  in_base_amount: number;
  fx_difference: number;
};

type TransferRecord = {
  id: number;
  transfer_no: string;
  accounting_date: Date | null;
  posted_at: Date | null;
  company_id: number;
  purpose: string;
  from_cash_bank_id: number;
  currency_id: number;
  cash_bank_layer_id: number | null;
  transfer_amount: { toNumber(): number };
  transfer_base_amount: { toNumber(): number };
  note: string | null;
  status: string;
  created_by: number;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
  _count?: { lines: number };
};

function toRow(t: TransferRecord): TransferRow {
  return {
    id: t.id,
    transfer_no: t.transfer_no,
    accounting_date: t.accounting_date ? day(t.accounting_date) : null,
    posted_at: t.posted_at ? t.posted_at.toISOString() : null,
    company_id: t.company_id,
    purpose: t.purpose as TransferPurposeKey,
    from_cash_bank_id: t.from_cash_bank_id,
    currency_id: t.currency_id,
    cash_bank_layer_id: t.cash_bank_layer_id,
    transfer_amount: t.transfer_amount.toNumber(),
    transfer_base_amount: t.transfer_base_amount.toNumber(),
    note: t.note,
    status: t.status as TransferStatus,
    line_count: t._count?.lines ?? 0,
    created_by: t.created_by,
    updated_by: t.updated_by,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
  };
}

export async function listTransfers(companyIds: number[]): Promise<TransferRow[]> {
  const rows = await prisma.finCashBankTransfer.findMany({
    where: { company_id: { in: companyIds } },
    orderBy: [{ id: "desc" }],
    include: { _count: { select: { lines: true } } },
  });
  return rows.map(toRow);
}

export async function getTransfer(id: number): Promise<TransferRow | null> {
  const row = await prisma.finCashBankTransfer.findUnique({
    where: { id },
    include: { _count: { select: { lines: true } } },
  });
  return row ? toRow(row) : null;
}

export async function transferLines(
  transferId: number
): Promise<TransferLineRow[]> {
  const lines = await prisma.finCashBankTransferLine.findMany({
    where: { transfer_id: transferId },
    orderBy: { sequence_no: "asc" },
  });
  return lines.map((l) => ({
    id: l.id,
    sequence_no: l.sequence_no,
    to_cash_bank_id: l.to_cash_bank_id,
    amount: l.amount.toNumber(),
    exchange_rate: l.exchange_rate.toNumber(),
    out_amount: l.out_amount.toNumber(),
    out_base_amount: l.out_base_amount.toNumber(),
    in_amount: l.in_amount.toNumber(),
    in_base_amount: l.in_base_amount.toNumber(),
    fx_difference: l.fx_difference.toNumber(),
  }));
}

// ----------------------------------------------------------------- doc type

async function docTypeIdFor(table: string): Promise<number> {
  const row = await prisma.sysDocType.findFirstOrThrow({
    where: { doc_table: table },
    select: { id: true },
  });
  return row.id;
}

export const transferDocTypeId = () => docTypeIdFor("fin_cash_bank_transfer");

/**
 * Document numbers for a set of ids — how another module names a transfer it
 * holds a reference to, without reading `fin_cash_bank_transfer` itself.
 */
export async function transferNumbersByIds(
  ids: number[]
): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.finCashBankTransfer.findMany({
    where: { id: { in: ids } },
    select: { id: true, transfer_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.transfer_no]));
}

/** Next document number, `TRF-0001`. The format lives in `document-number.ts`. */
export async function nextTransferNo(): Promise<string> {
  return nextDocumentNumber("TRF", async () => {
    const row = await prisma.finCashBankTransfer.findFirst({
      orderBy: { id: "desc" },
      select: { transfer_no: true },
    });
    return row?.transfer_no ?? null;
  });
}

// --------------------------------------------------------------------- refs

export type TransferCashBankOption = {
  id: number;
  label: string;
  name: string;
  companyId: number;
  currencyId: number;
  currencyLabel: string;
  isBase: boolean;
  active: boolean;
  /**
   * The book's balance now, in the resource's own currency, so a draft can say
   * whether the source covers it. A foreign source is capped by its chosen
   * layer instead, which the form reads from `layers`.
   */
  balance: number;
  /** The open rate layers this resource holds — empty for a base-currency one. */
  layers: LayerOption[];
};

export type TransferRefs = {
  cashBanks: TransferCashBankOption[];
  currencies: { id: number; label: string; name: string; isBase: boolean; active: boolean }[];
  companies: { id: number; label: string; name: string }[];
};

/**
 * Everything the transfer form picks from, in one read.
 *
 * Layers travel with their resource rather than being fetched when one is
 * chosen: the choice happens in the browser and the page is where the database
 * is read (CLAUDE.md §3), so asking per resource would cost a round trip per
 * foreign account.
 */
export async function transferRefs(companyIds?: number[]): Promise<TransferRefs> {
  const where = companyIds ? { company_id: { in: companyIds } } : {};

  const [cashBanks, currencies, companies] = await Promise.all([
    prisma.mCashBank.findMany({
      where,
      orderBy: [{ cash_bank_label: "asc" }],
      select: {
        id: true,
        cash_bank_label: true,
        cash_bank_name: true,
        company_id: true,
        currency_id: true,
        status: true,
        currency: { select: { currency_label: true } },
      },
    }),
    prisma.refCurrency.findMany({
      orderBy: [{ currency_label: "asc" }],
      select: { id: true, currency_label: true, currency_name: true, status: true },
    }),
    prisma.sysCompany.findMany({
      where: companyIds ? { id: { in: companyIds } } : {},
      orderBy: [{ id: "asc" }],
      select: { id: true, company_label: true, company_name: true },
    }),
  ]);

  const [layers, balances] = await Promise.all([
    openLayersFor(cashBanks.map((c) => c.id)),
    cashBankBalanceMap(),
  ]);

  return {
    cashBanks: cashBanks.map((c) => ({
      id: c.id,
      label: c.cash_bank_label,
      name: c.cash_bank_name,
      companyId: c.company_id,
      currencyId: c.currency_id,
      currencyLabel: c.currency.currency_label,
      isBase: isBaseCurrency(c.currency.currency_label),
      active: c.status === "Active",
      balance: balances.get(c.id) ?? 0,
      layers: layers.get(c.id) ?? [],
    })),
    currencies: currencies.map((c) => ({
      id: c.id,
      label: c.currency_label,
      name: c.currency_name,
      isBase: isBaseCurrency(c.currency_label),
      active: c.status === "Active",
    })),
    companies: companies.map((c) => ({
      id: c.id,
      label: c.company_label,
      name: c.company_name,
    })),
  };
}

