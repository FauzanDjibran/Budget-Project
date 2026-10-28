import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatDate, formatNumber } from "@/lib/format";
import { cashBankBalanceOn, cashBankShortfall, lockCashBanks, recordCashBankEntry } from "./cash-bank";
import { LayerNotAvailable, drawFromLayer, openLayer, openLayersOf } from "./cash-bank-layers";
import { isBaseCurrency } from "./currency";
import { drawLayer, relieve, roundBase } from "./fx";
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
  /** What the line moves: an open item (null for a new one), or a Cash & Bank. */
  subjectId: number | null;
  /** Cash & Bank only: the rate layer a foreign payment draws on. */
  layerId: number | null;
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
    line.layerId = null;
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
    line.layerId = null;

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

/**
 * `cash_bank`: a Cash & Bank posting to this account. Debit is money in. A
 * foreign resource paying out names one of its layers and gives up that
 * layer's base at its kurs; money arriving opens a new layer at the kurs
 * typed (D10). A rupiah resource holds no layers. Saldo baru holds to the
 * balance it was typed against (D14, Case 7).
 */
const cashBankAdapter: LedgerAdapter = {
  ledger: "cash_bank",
  takesNewValue: true,

  async check(line, account, ctx): Promise<Record<string, string>> {
    line.partnerId = null;
    if (line.subjectId == null) return { subject_id: "Pilih Cash & Bank." };
    const resource = await prisma.mCashBank.findUnique({
      where: { id: line.subjectId },
      select: {
        cash_bank_label: true,
        company_id: true,
        account_id: true,
        status: true,
        currency_id: true,
        currency: { select: { currency_label: true } },
      },
    });
    if (!resource || resource.company_id !== ctx.companyId || resource.account_id !== account.id) {
      return { subject_id: `Cash & Bank tersebut tidak memakai Account ${account.account_label}.` };
    }
    if (resource.status !== "Active") return { subject_id: "Cash & Bank tersebut non-aktif." };
    if (resource.currency_id !== line.currencyId) {
      return { currency_id: `Currency baris harus sama dengan currency ${resource.cash_bank_label}.` };
    }

    const stored = line.balanceBefore;
    line.balanceBefore = null;
    if (line.newValue != null) {
      const held = await cashBankBalanceOn(line.subjectId, ctx.date);
      if (stored !== undefined && cents(stored ?? NaN) !== cents(held)) {
        return {
          subject_id: `Saldo ${resource.cash_bank_label} berubah sejak draft disimpan: kini ` +
            `${formatNumber(held, 2)}. Buka dan simpan ulang draft.`,
        };
      }
      if (line.newValue < 0) return { new_value: "Saldo baru tidak boleh di bawah nol." };
      const diff = line.newValue - held;
      if (cents(diff) === 0) {
        return { new_value: `${resource.cash_bank_label} sudah bersaldo ${formatNumber(held, 2)}.` };
      }
      line.side = diff > 0 ? "debit" : "credit";
      line.face = cents(Math.abs(diff)) / 100;
      line.balanceBefore = held;
    }

    const foreign = !isBaseCurrency(resource.currency.currency_label);
    const out = line.side === "credit";
    if (!foreign || !out) {
      if (line.layerId != null) {
        return { cash_bank_layer_id: "Layer hanya dipilih untuk uang keluar dari Cash & Bank valas." };
      }
      if (!foreign) line.rate = 1;
    } else {
      if (line.layerId == null) return { cash_bank_layer_id: "Pilih layer kurs yang dipakai." };
      const layer = (await openLayersOf(line.subjectId)).find((l) => l.id === line.layerId);
      if (!layer) {
        return { cash_bank_layer_id: "Layer tersebut bukan layer terbuka milik Cash & Bank ini." };
      }
      if (layer.date > ctx.date) {
        return {
          cash_bank_layer_id: `Layer ${layer.layerNo} baru diperoleh pada ${formatDate(layer.date)}, ` +
            "sesudah tanggal journal ini.",
        };
      }
      if (cents(line.face) > cents(layer.foreignRemaining)) {
        return {
          amount: `Layer ${layer.layerNo} tinggal ${formatNumber(layer.foreignRemaining, 2)}, ` +
            `tidak cukup untuk ${formatNumber(line.face, 2)}.`,
        };
      }
      line.rate = layer.rate;
      line.baseAmount = drawLayer(
        { foreign: layer.foreignRemaining, base: layer.baseRemaining, rate: layer.rate },
        cents(line.face) === cents(layer.foreignRemaining) ? layer.foreignRemaining : line.face
      ).base;
    }

    if (out) {
      const short = await cashBankShortfall(line.subjectId, ctx.date, line.face);
      if (short) return { amount: short.message };
    }
    return {};
  },

  lockKeys(line) {
    return [{ rank: 2, key: String(line.subjectId) }];
  },

  async lock(tx, key) {
    await lockCashBanks(tx, [Number(key)]);
  },

  async write(tx, line, _account, ctx) {
    const cashBankId = line.subjectId!;
    if (line.newValue != null) {
      const held = await cashBankBalanceOn(cashBankId, ctx.date, tx);
      if (cents(held) !== cents(line.balanceBefore ?? NaN)) {
        throw new LayerNotAvailable(
          "Saldo Cash & Bank berubah sejak draft disimpan. Buka dan simpan ulang draft."
        );
      }
    }
    const source = {
      sourceDocTypeId: ctx.sourceDocTypeId,
      sourceDocId: ctx.sourceDocId,
      note: line.description,
      actorId: ctx.actorId,
    };
    if (line.layerId != null) {
      const drawn = await drawFromLayer(tx, {
        layerId: line.layerId,
        cashBankId,
        foreign: line.face,
        date: ctx.date,
        actorId: ctx.actorId,
      });
      if (cents(drawn.base) !== cents(line.baseAmount ?? NaN)) {
        throw new LayerNotAvailable("Layer kurs berubah sejak draft disimpan. Ulangi Post.");
      }
    }
    const into = line.side === "debit";
    const base = line.baseAmount ?? roundBase(line.face * line.rate);
    await recordCashBankEntry(tx, {
      cashBankId,
      date: ctx.date,
      type: "Adjustment",
      direction: into ? "In" : "Out",
      amount: line.face,
      rate: line.rate,
      baseAmount: base,
      ...source,
    });
    // A foreign receipt opens its own layer; a rupiah resource holds none.
    const currency = await tx.refCurrency.findUniqueOrThrow({
      where: { id: line.currencyId },
      select: { currency_label: true },
    });
    if (into && !isBaseCurrency(currency.currency_label)) {
      await openLayer(tx, { cashBankId, date: ctx.date, rate: line.rate, foreign: line.face, baseAmount: base, ...source });
    }
  },
};

const ADAPTERS: Record<string, LedgerAdapter> = {
  [partnerAdapter.ledger]: partnerAdapter,
  [subjectBookAdapter.ledger]: subjectBookAdapter,
  [cashBankAdapter.ledger]: cashBankAdapter,
};

/** The adapter for a ledger; null for `none`, undefined for one not built yet. */
export function adapterFor(ledger: string): LedgerAdapter | null | undefined {
  return ledger === "none" ? null : ADAPTERS[ledger];
}
