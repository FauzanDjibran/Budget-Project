import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { sumByCurrency, type MoneyTotal } from "@/lib/format";
import { nextDocumentNumber } from "./document-number";
import {
  fundingRoute,
  markTransactionCancelled,
  markTransactionPending,
  prepareFundedPosting,
  transactingCompany,
  transactionsByIds,
  writeFundedPosting,
  type TransactionRow,
} from "./finance";
import { purposeLabel } from "./rules";
import { intercompanyBridge } from "./system-settings";

/**
 * Funding Request — the intercompany bridge between the two Companies.
 *
 * The anak has no Cash & Bank of its own (concept doc §25, §32). Its Budgets,
 * its realizations and its books are ordinary in every other way, but the money
 * always moves through an induk resource: the anak submits its Cash Bank
 * Transaction, that raises a request, and the induk's **confirmation** — never
 * a decision, the induk always complies (§29) — is the actual boundary for both
 * Companies at once (§30).
 *
 * This module sits **above** Finance and depends on it one way. Funding reads
 * documents and moves their status through functions Finance exports, and
 * Finance names nothing here: a plan is complete without a funding, and a
 * realization is complete without one too — it is only how the cash arrived.
 *
 * What it does *not* do is decide accounting. The two journals, the four book
 * entries and the realization are `writeFundedPosting`'s, because they are
 * Finance's posting written for two Companies rather than one. This module owns
 * the request: its number, its lifecycle, and the one transaction that closes
 * it at the same moment the books are written.
 */

const day = (d: Date): string => d.toISOString().slice(0, 10);

export type FundingStatus = "Open" | "Closed" | "Cancelled";

export type FundingRequestRow = {
  id: number;
  funding_request_no: string;
  request_date: string;
  status: FundingStatus;
  request_amount: number;
  currency_id: number;
  provider_cash_bank_id: number | null;
  confirmed_at: string | null;
  note: string | null;
  /** The realization that needs the money, read through Finance. */
  transaction: TransactionRow | null;
};

type RequestRecord = {
  id: number;
  funding_request_no: string;
  request_date: Date;
  status: string;
  request_amount: { toNumber(): number };
  currency_id: number;
  transaction_id: number;
  provider_cash_bank_id: number | null;
  confirmed_at: Date | null;
  note: string | null;
};

function toRow(
  r: RequestRecord,
  transaction: TransactionRow | null
): FundingRequestRow {
  return {
    id: r.id,
    funding_request_no: r.funding_request_no,
    request_date: day(r.request_date),
    status: r.status as FundingStatus,
    request_amount: r.request_amount.toNumber(),
    currency_id: r.currency_id,
    provider_cash_bank_id: r.provider_cash_bank_id,
    confirmed_at: r.confirmed_at ? r.confirmed_at.toISOString() : null,
    note: r.note,
    transaction,
  };
}

/** Attaches each request's realization, in one read rather than per row. */
async function withTransactions(
  rows: RequestRecord[]
): Promise<FundingRequestRow[]> {
  if (!rows.length) return [];
  const docs = await transactionsByIds(rows.map((r) => r.transaction_id));
  const byId = new Map(docs.map((d) => [d.id, d]));
  return rows.map((r) => toRow(r, byId.get(r.transaction_id) ?? null));
}

// ------------------------------------------------------------------ reading

/**
 * Every request, newest first.
 *
 * Deliberately unscoped by Company: a Funding Request is the one document that
 * belongs to both of them — the anak raised it and the induk answers it — so
 * narrowing it to one Company's records would hide half of every row from the
 * person who has to act on it. `FUNDING_REQUEST_VIEW` is what governs reading
 * it at all.
 */
export async function listFundingRequests(): Promise<FundingRequestRow[]> {
  const rows = await prisma.finFundingRequest.findMany({
    orderBy: [{ id: "desc" }],
  });
  return withTransactions(rows);
}

export async function getFundingRequest(
  id: number
): Promise<FundingRequestRow | null> {
  const row = await prisma.finFundingRequest.findUnique({ where: { id } });
  if (!row) return null;
  const [withDoc] = await withTransactions([row]);
  return withDoc ?? null;
}

/** The open request a document is waiting on, if it has one. */
export async function openRequestFor(
  transactionId: number
): Promise<FundingRequestRow | null> {
  const row = await prisma.finFundingRequest.findFirst({
    where: { transaction_id: transactionId, status: "Open" },
    orderBy: { id: "desc" },
  });
  if (!row) return null;
  const [withDoc] = await withTransactions([row]);
  return withDoc ?? null;
}

/** Every request ever raised against one document — the trace, in order. */
export async function requestsFor(
  transactionId: number
): Promise<FundingRequestRow[]> {
  const rows = await prisma.finFundingRequest.findMany({
    where: { transaction_id: transactionId },
    orderBy: { id: "asc" },
  });
  return withTransactions(rows);
}

export type FundingSummary = {
  open: number;
  openTotals: MoneyTotal[];
  closed: number;
  closedTotals: MoneyTotal[];
};

/** The KPI row, per currency — amounts are never converted (CLAUDE.md §12). */
export async function summariseFunding(
  rows: FundingRequestRow[]
): Promise<FundingSummary> {
  const currencies = await prisma.refCurrency.findMany({
    select: { id: true, currency_label: true },
  });
  const labelOf = new Map(currencies.map((c) => [c.id, c.currency_label]));
  const money = (r: FundingRequestRow) => ({
    currencyId: r.currency_id,
    currencyLabel: labelOf.get(r.currency_id) ?? "",
    amount: r.request_amount,
  });

  const open = rows.filter((r) => r.status === "Open");
  const closed = rows.filter((r) => r.status === "Closed");

  return {
    open: open.length,
    openTotals: sumByCurrency(open.map(money)),
    closed: closed.length,
    closedTotals: sumByCurrency(closed.map(money)),
  };
}

// ---------------------------------------------------------------- numbering

/** `FR-0001` — the document-number form, not a system code (CLAUDE.md §9). */
async function nextRequestNo(
  db: typeof prisma | Prisma.TransactionClient
): Promise<string> {
  return nextDocumentNumber("FR", async () => {
    const row = await db.finFundingRequest.findFirst({
      orderBy: { id: "desc" },
      select: { funding_request_no: true },
    });
    return row?.funding_request_no ?? null;
  });
}

/**
 * Request numbers for a set of ids — how the audit log names a request without
 * reading `fin_funding_request` itself.
 */
export async function fundingRequestNumbersByIds(
  ids: number[]
): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.finFundingRequest.findMany({
    where: { id: { in: ids } },
    select: { id: true, funding_request_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.funding_request_no]));
}

/** The `sys_doc_type` row a journal points at when its cause is a request. */
export async function fundingRequestDocTypeId(): Promise<number> {
  const row = await prisma.sysDocType.findFirstOrThrow({
    where: { doc_table: "fin_funding_request" },
    select: { id: true },
  });
  return row.id;
}

// ------------------------------------------------------------------ writing

export type FundingResult =
  | { ok: true; id: number; funding_request_no: string }
  | { ok: false; errors: Record<string, string> };

/**
 * Raise a request: the anak's document leaves Draft and waits.
 *
 * Nothing moves. The document is frozen so it cannot change under the induk
 * that is about to fund it — the same reason a submitted Budget freezes — and
 * the request carries the document's own amount, because there is no partial
 * funding (§28, §29).
 */
export async function raiseFundingRequest(
  transactionId: number,
  actorId: number
): Promise<FundingResult> {
  const [doc] = await transactionsByIds([transactionId]);
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };

  if (doc.status !== "Draft") {
    return {
      ok: false,
      errors: { _form: "Hanya dokumen berstatus Draft yang dapat diajukan." },
    };
  }
  if ((await fundingRoute(doc.company_id)) !== "treasury") {
    return {
      ok: false,
      errors: {
        _form:
          "Company ini memiliki Cash & Bank sendiri, sehingga dokumennya diposting " +
          "langsung tanpa Funding Request.",
      },
    };
  }
  if (!doc.line_count) {
    return {
      ok: false,
      errors: {
        _form: "Tambahkan minimal satu Budget sebelum dokumen diajukan.",
      },
    };
  }
  if (doc.transaction_amount <= 0) {
    return {
      ok: false,
      errors: { _form: "Nominal dokumen harus lebih dari nol." },
    };
  }

  const existing = await prisma.finFundingRequest.findFirst({
    where: { transaction_id: transactionId, status: "Open" },
    select: { funding_request_no: true },
  });
  if (existing) {
    return {
      ok: false,
      errors: {
        _form: `Dokumen ini sudah memiliki Funding Request terbuka (${existing.funding_request_no}).`,
      },
    };
  }

  const today = new Date().toISOString().slice(0, 10);

  return prisma.$transaction(async (tx) => {
    const created = await tx.finFundingRequest.create({
      data: {
        funding_request_no: await nextRequestNo(tx),
        request_date: new Date(`${today}T00:00:00Z`),
        transaction_id: transactionId,
        currency_id: doc.currency_id,
        request_amount: doc.transaction_amount,
        status: "Open",
        note: `${doc.transaction_no} — ${purposeLabel(doc.purpose)}`,
        created_by: actorId,
      },
      select: { id: true, funding_request_no: true },
    });

    // Finance's table, moved by Finance — in this transaction, so a document
    // waiting on a request that does not exist is not a state that can occur.
    await markTransactionPending(tx, transactionId, actorId);

    await tx.auditLog.create({
      data: {
        entity_key: "fin_funding_request",
        row_id: created.id,
        action: "TAMBAH",
        by: actorId,
      },
    });

    return {
      ok: true as const,
      id: created.id,
      funding_request_no: created.funding_request_no,
    };
  });
}

/**
 * Withdraw: the requesting Company takes back a document nothing has acted on.
 *
 * This is not the induk rejecting — the induk never rejects (§29). It is the
 * anak cancelling its own realization while it is still only a request, which
 * closes the request with it. Nothing is reversed because nothing was written.
 */
export async function withdrawFundingRequest(
  transactionId: number,
  actorId: number
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const [doc] = await transactionsByIds([transactionId]);
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Pending") {
    return {
      ok: false,
      errors: {
        _form:
          "Hanya dokumen yang sedang menunggu funding yang dapat ditarik kembali.",
      },
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.finFundingRequest.updateMany({
      where: { transaction_id: transactionId, status: "Open" },
      data: { status: "Cancelled", updated_by: actorId },
    });
    await markTransactionCancelled(tx, transactionId, actorId);
  });

  return { ok: true };
}

export type ConfirmResult =
  | { ok: true; closed: number }
  | { ok: false; errors: Record<string, string> };

/**
 * Confirm: the actual boundary, for both Companies at once (§30).
 *
 * The induk names the resource the money moves through, and everything else is
 * already decided — there is no partial funding and no rejection, so the only
 * refusals here are mechanical: a request already answered, a bridge that has
 * not been set up, a resource in the wrong currency, a Budget that has closed
 * since. Each of them refuses before the transaction opens, so a refused
 * confirmation leaves nothing behind.
 *
 * The books and the request's own closure are written in **one** transaction:
 * a closed request whose journals were never written, or journals whose request
 * still reads Open, are both states this makes unreachable.
 */
export async function confirmFundingRequest(
  requestId: number,
  providerCashBankId: number,
  actorId: number
): Promise<ConfirmResult> {
  const request = await prisma.finFundingRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) {
    return { ok: false, errors: { _form: "Funding Request tidak ditemukan." } };
  }
  if (request.status !== "Open") {
    return {
      ok: false,
      errors: {
        _form:
          request.status === "Closed"
            ? "Funding Request ini sudah dikonfirmasi."
            : "Funding Request ini sudah dibatalkan oleh Company pemohon.",
      },
    };
  }

  const bridge = await intercompanyBridge();
  if (!bridge.ok) {
    return {
      ok: false,
      errors: {
        _form:
          "Pengaturan bridge intercompany belum lengkap: " +
          `${bridge.missing.join(", ")}. Lengkapi di Pengaturan › System Default ` +
          "sebelum mengonfirmasi funding.",
      },
    };
  }

  const prepared = await prepareFundedPosting({
    transactionId: request.transaction_id,
    providerCashBankId,
    bridge: { induk: bridge.induk, anak: bridge.anak },
    providerSource: {
      docTypeId: await fundingRequestDocTypeId(),
      docId: request.id,
    },
    note: `${request.funding_request_no} — ${request.note ?? ""}`.trim(),
  });
  if (!prepared.ok) return { ok: false, errors: prepared.errors };

  const { closed } = await prisma.$transaction(async (tx) => {
    const result = await writeFundedPosting(tx, prepared.plan, actorId);

    await tx.finFundingRequest.update({
      where: { id: request.id },
      data: {
        status: "Closed",
        provider_cash_bank_id: providerCashBankId,
        confirmed_at: new Date(),
        confirmed_by: actorId,
        updated_by: actorId,
      },
    });

    await tx.auditLog.create({
      data: {
        entity_key: "fin_funding_request",
        row_id: request.id,
        action: "UPDATE",
        by: actorId,
      },
    });

    return result;
  });

  return { ok: true, closed };
}

/**
 * The resources the induk may answer a request with.
 *
 * Narrowed to the request's own currency, because there is no exchange rate in
 * this system (CLAUDE.md §12): a resource in another currency cannot answer it
 * without inventing one. The picker shows exactly what `prepareFundedPosting`
 * will accept.
 */
export async function providerCashBanks(currencyId: number): Promise<
  {
    id: number;
    label: string;
    name: string;
    currencyLabel: string;
    balance: number;
  }[]
> {
  const induk = await transactingCompany();
  if (!induk) return [];

  const rows = await prisma.mCashBank.findMany({
    where: {
      company_id: induk.id,
      currency_id: currencyId,
      status: "Active",
    },
    orderBy: { id: "asc" },
    include: {
      currency: { select: { currency_label: true } },
      book_balance: { select: { balance: true } },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    label: c.cash_bank_label,
    name: c.cash_bank_name,
    currencyLabel: c.currency.currency_label,
    balance: c.book_balance?.balance.toNumber() ?? 0,
  }));
}
