import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatDate, formatNumber } from "@/lib/format";
import { relieve, roundBase } from "./fx";
import {
  SubledgerItemUnavailable,
  itemBalanceOn,
  itemLowestFrom,
  lockSubledgerPosition,
  recordSubledgerEntry,
  subledgerItem,
} from "./subledger";
import { subledgerForCategory, type SubledgerDef } from "./subledger-catalogue";
import { loadSubledgers } from "./subledger-data";

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
  /** The entry the line moves: an open item; null for a new one. */
  subjectId: number | null;
  /** Saldo baru as typed (D14); the adapter turns it into `side` and `face`. */
  newValue: number | null;
  /**
   * What the entry held on the journal's date when the draft was saved.
   * `undefined` on a save, where the adapter reads it; stored at Post, where a
   * different figure refuses the line.
   */
  balanceBefore?: number | null;
  /** The exact base, where the adapter knows it (an item's own kurs, a release). */
  baseAmount?: number;
  description: string;
};

export type AdapterAccount = {
  id: number;
  account_label: string;
  partner_category_id: number | null;
  ledger_book_id: number | null;
};

export type AdapterContext = { companyId: number; date: string };

export type PostContext = AdapterContext & {
  actorId: number;
  sourceDocTypeId: number;
  sourceDocId: number;
};

export type LedgerAdapter = {
  /** Its `acc_account.ledger` value. */
  ledger: string;
  /** Whether a line may be entered as Saldo baru (D14). */
  takesNewValue?: boolean;
  /**
   * Refusals keyed by the line's field (`partner_id`, …); empty when sound.
   * The adapter fills what its ledger decides — the kurs an entry carries, the
   * exact base, the side and amount a Saldo baru comes to — on `line` itself.
   */
  check(
    line: AdapterLine,
    account: AdapterAccount,
    ctx: AdapterContext
  ): Promise<Record<string, string>>;
  /** Advisory locks Post takes, sorted by rank then key across all lines. */
  lockKeys?(line: AdapterLine, account: AdapterAccount): { rank: number; key: string }[];
  lock?(tx: Prisma.TransactionClient, key: string): Promise<void>;
  /** The ledger's own book entry, inside Post's transaction. */
  write?(
    tx: Prisma.TransactionClient,
    line: AdapterLine,
    account: AdapterAccount,
    ctx: PostContext
  ): Promise<void>;
};

const cents = (n: number) => Math.round(n * 100);

/**
 * `partner`: a Partner on every line, for the General Ledger's breakdown only.
 * It writes no book, so it neither locks nor writes.
 */
const partnerAdapter: LedgerAdapter = {
  ledger: "partner",
  async check(line, account, ctx): Promise<Record<string, string>> {
    line.subjectId = null;
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

/** The side of a journal line that raises this book: money in raises a Hutang, credited. */
const raisingSide = (book: SubledgerDef) => (book.raises === "In" ? "credit" : "debit");

async function bookOf(account: AdapterAccount): Promise<SubledgerDef | null> {
  return subledgerForCategory(await loadSubledgers(), account.ledger_book_id);
}

/**
 * `subject_book`: a Partner and an open item in the account's one book (D18).
 * Whether the line raises or lowers is read from its side against the book's
 * `raises` (D19). Lowering names an Open item and relieves it at its own kurs;
 * raising grows a named Open item at its own kurs, or opens a new one at the
 * kurs typed. Every named item holds the balance the draft was saved against,
 * or Post refuses it (D14, Case 10).
 */
const subjectBookAdapter: LedgerAdapter = {
  ledger: "subject_book",
  takesNewValue: true,

  async check(line, account, ctx): Promise<Record<string, string>> {
    const book = await bookOf(account);
    if (!book) {
      return { account_id: `Account ${account.account_label} menunjuk buku subjek yang tidak aktif.` };
    }
    if (!line.partnerId) return { partner_id: "Account ini wajib menyebut Partner." };
    const partner = await prisma.mPartner.findUnique({
      where: { id: line.partnerId },
      select: { company_id: true, status: true, category_id: true, partner_label: true },
    });
    if (!partner) return { partner_id: "Partner tidak ditemukan." };
    if (partner.company_id !== ctx.companyId) {
      return { partner_id: "Partner tersebut milik Company lain." };
    }
    const raise = raisingSide(book);

    if (line.subjectId == null) {
      if (line.newValue != null) {
        return { new_value: "Saldo baru hanya untuk open item yang sudah ada." };
      }
      if (line.side !== raise) {
        return { subject_id: `Pilih open item yang dilunasi: baris ini menurunkan ${book.name}.` };
      }
      if (partner.status !== "Active") return { partner_id: "Partner tersebut non-aktif." };
      const admitted = await prisma.sysBudgetPartnerCategoryMapping.findFirst({
        where: {
          budget_category_id: book.categoryId,
          partner_category_id: partner.category_id,
          status: "Active",
          partner_category: { status: "Active" },
        },
        select: { id: true },
      });
      if (!admitted) {
        return {
          partner_id: `Partner ${partner.partner_label} tidak termasuk Partner Category yang dipakai ${book.name}.`,
        };
      }
      line.balanceBefore = null;
      return {};
    }

    const item = await subledgerItem(line.subjectId);
    if (!item || item.bookId !== book.categoryId || item.partnerId !== line.partnerId) {
      return { subject_id: "Open item tersebut bukan milik buku dan Partner baris ini." };
    }
    if (item.currencyId !== line.currencyId) {
      return { currency_id: `Currency baris harus sama dengan currency open item ${item.itemNo}.` };
    }
    if (item.status !== "Open") return { subject_id: `Open item ${item.itemNo} sudah selesai.` };
    if (ctx.date < item.date) {
      return {
        subject_id: `Open item ${item.itemNo} baru dibuka pada ${formatDate(item.date)}, ` +
          "sesudah tanggal journal ini.",
      };
    }

    const held = await itemBalanceOn(item.id, ctx.date);
    if (line.balanceBefore !== undefined && cents(line.balanceBefore ?? NaN) !== cents(held)) {
      return {
        subject_id: `Open item ${item.itemNo} berubah sejak draft disimpan: kini ` +
          `${formatNumber(held, 2)}. Buka dan simpan ulang draft.`,
      };
    }
    line.balanceBefore = held;

    if (line.newValue != null) {
      if (line.newValue < 0) return { new_value: "Saldo baru tidak boleh di bawah nol." };
      const diff = line.newValue - held;
      if (cents(diff) === 0) {
        return { new_value: `Open item ${item.itemNo} sudah bernilai ${formatNumber(held, 2)}.` };
      }
      line.side = diff > 0 ? raise : raise === "debit" ? "credit" : "debit";
      line.face = cents(Math.abs(diff)) / 100;
    }

    line.rate = item.rate;
    if (line.side === raise) {
      line.baseAmount = roundBase(line.face * item.rate);
      return {};
    }
    // A lowering may not take the item below nothing on any day from its date.
    const lowest = await itemLowestFrom(item.id, ctx.date);
    if (cents(line.face) > cents(lowest.balance)) {
      return {
        amount: `Open item ${item.itemNo} tinggal ${formatNumber(lowest.balance, 2)} pada ` +
          `${lowest.at}, tidak cukup untuk ${formatNumber(line.face, 2)}.`,
      };
    }
    // Released as recordSubledgerEntry will release it, so Post's figure is this one.
    line.baseAmount = relieve(
      { foreign: item.remaining, base: item.baseRemaining },
      cents(line.face) === cents(item.remaining) ? item.remaining : line.face
    ).base;
    return {};
  },

  lockKeys(line, account) {
    return [{ rank: 1, key: `${account.ledger_book_id}:${line.partnerId}:${line.currencyId}` }];
  },

  async lock(tx, key) {
    const [book, partner, currency] = key.split(":").map(Number);
    await lockSubledgerPosition(tx, book, partner, currency);
  },

  async write(tx, line, account, ctx) {
    const book = (await bookOf(account))!;
    if (line.subjectId != null) {
      const held = await itemBalanceOn(line.subjectId, ctx.date, tx);
      if (cents(held) !== cents(line.balanceBefore ?? NaN)) {
        const item = await subledgerItem(line.subjectId, tx);
        throw new SubledgerItemUnavailable(
          `Open item ${item?.itemNo ?? line.subjectId} berubah sejak draft disimpan. Buka dan simpan ulang draft.`
        );
      }
    }
    const raises = line.side === raisingSide(book);
    await recordSubledgerEntry(tx, {
      book,
      partnerId: line.partnerId!,
      currencyId: line.currencyId,
      date: ctx.date,
      type: "Adjustment",
      direction: raises ? book.raises : book.raises === "In" ? "Out" : "In",
      amount: line.face,
      rate: line.rate,
      baseAmount: line.baseAmount,
      itemId: line.subjectId,
      sourceDocTypeId: ctx.sourceDocTypeId,
      sourceDocId: ctx.sourceDocId,
      note: line.description,
      actorId: ctx.actorId,
    });
  },
};

const ADAPTERS: Record<string, LedgerAdapter> = {
  [partnerAdapter.ledger]: partnerAdapter,
  [subjectBookAdapter.ledger]: subjectBookAdapter,
};

/** The adapter for a ledger; null for `none`, undefined for one not built yet. */
export function adapterFor(ledger: string): LedgerAdapter | null | undefined {
  return ledger === "none" ? null : ADAPTERS[ledger];
}
