import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The open ledger contract (Journal 2.0 §3). An account names its ledger
 * (`acc_account.ledger`); a Jurnal Umum line on it is checked, locked and
 * written by that ledger's adapter, which translates the line into the book's
 * own exported functions. The books know nothing of the journal.
 *
 * `none` needs no adapter. A ledger with no adapter registered yet refuses its
 * accounts by name. A new ledger is one enum value on the account and one
 * adapter here, never a change to the journal's tables (§3.7).
 */

export type AdapterLine = {
  accountId: number;
  partnerId: number | null;
  currencyId: number;
  side: "debit" | "credit";
  face: number;
  rate: number;
};

export type AdapterAccount = {
  id: number;
  account_label: string;
  partner_category_id: number | null;
  ledger_book_id: number | null;
};

export type AdapterContext = { companyId: number; date: string };

export type LedgerAdapter = {
  /** Its `acc_account.ledger` value. */
  ledger: string;
  /** Refusals keyed by the line's field (`partner_id`, …); empty when sound. */
  check(
    line: AdapterLine,
    account: AdapterAccount,
    ctx: AdapterContext
  ): Promise<Record<string, string>>;
  /** Advisory locks Post takes, sorted by rank then key across all lines. */
  lockKeys?(line: AdapterLine): { rank: number; key: string }[];
  lock?(tx: Prisma.TransactionClient, keys: string[]): Promise<void>;
  /** The ledger's own book entry, inside Post's transaction. */
  write?(tx: Prisma.TransactionClient, line: AdapterLine, ctx: AdapterContext): Promise<void>;
};

/**
 * `partner`: a Partner on every line, for the General Ledger's breakdown only.
 * It writes no book, so it neither locks nor writes.
 */
const partnerAdapter: LedgerAdapter = {
  ledger: "partner",
  async check(line, account, ctx): Promise<Record<string, string>> {
    if (!line.partnerId) return { partner_id: "Account ini wajib menyebut Partner." };
    const partner = await prisma.mPartner.findUnique({
      where: { id: line.partnerId },
      select: { company_id: true, status: true, category_id: true },
    });
    if (!partner) return { partner_id: "Partner tidak ditemukan." };
    if (partner.company_id !== ctx.companyId) {
      return { partner_id: "Partner tersebut milik Company lain." };
    }
    if (partner.status !== "Active") return { partner_id: "Partner tersebut non-aktif." };
    if (account.partner_category_id && partner.category_id !== account.partner_category_id) {
      return {
        partner_id: "Partner Category tidak sesuai dengan yang ditetapkan pada Account.",
      };
    }
    return {};
  },
};

const ADAPTERS: Record<string, LedgerAdapter> = {
  [partnerAdapter.ledger]: partnerAdapter,
};

/** The adapter for a ledger; null for `none`, undefined for one not built yet. */
export function adapterFor(ledger: string): LedgerAdapter | null | undefined {
  return ledger === "none" ? null : ADAPTERS[ledger];
}
