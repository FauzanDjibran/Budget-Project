import "server-only";

import { prisma } from "@/lib/prisma";

import { formatMoney, formatRate } from "@/lib/format";
import { InsufficientFunds, lockCashBanks, recordCashBankEntry } from "./cash-bank";
import { LayerNotAvailable, drawFromLayer } from "./cash-bank-layers";
import { BASE_CURRENCY_LABEL } from "./currency";

import {
  PeriodShut,
  checkTransactionDate,
  holdPostingPeriod,
  todayDay,
} from "./fiscal";
import { relieve, roundBase, type Balance } from "./fx";
import { valueConversionLine } from "./item-conversion-valuation";

import {
  describeJournalLines,
  postJournal,
  type JournalLineInput,
  type JournalPreviewLine,
} from "./journal";
import { SubledgerItemUnavailable, lockSubledgerPosition, recordSubledgerEntry, subledgerItem } from "./subledger";


import { systemAccountId } from "./system-account-data";
import { conversionDocTypeId } from "./item-conversion-rows";
import { checkConversionHeader, checkConversionLines } from "./item-conversion-check";

/**
 * Pencairan Open Item: foreign currency sold out of the Company's own Cash &
 * Bank, and one Partner's open items in that currency converted to base
 * currency **at the same kurs**, in one document.
 *
 * The case it exists for: a stakeholder's dollar Titipan is cashed into rupiah.
 * The Company sells dollars at the bank, and from that moment owes the
 * stakeholder rupiah instead. Done as two documents — a Pencairan and a
 * revaluation — each leg would recognise its own difference against two
 * different rates. Done here, one kurs values both legs, so the only
 * difference left is the gap between what the cash and the items were each
 * carried at, and it is journalled as **one** Selisih Kurs line: a difference
 * of the sale, never a revaluation of the Titipan.
 *
 * ## Shape
 *
 * The header names the foreign source, its one layer, one book and one
 * Partner. Each line names a base-currency destination, the kurs the bank
 * paid, and the Partner's items it converts; the line is worth exactly what
 * its items add up to, because the money being sold is the Partner's and a
 * line never mixes it with the Company's own. Post, in one transaction:
 *
 *   1. draws the source layer, line by line, and writes one Cash Bank Book
 *      entry out of the source and one into each destination;
 *   2. releases each foreign item at its own kurs (`Conversion` entries);
 *   3. opens one base-currency item per line, in the same book, for exactly
 *      what the bank paid;
 *   4. writes one balanced journal — the cash legs, a release line per item,
 *      a line per new item, and one Selisih Kurs line for the document.
 *
 * Which side each Partner line takes follows the book's own `raises`, so one
 * document serves every book: a Titipan's release is a debit, a Piutang's a
 * credit (`item-conversion-valuation.ts`).
 *
 * Its own module rather than a fourth Transfer purpose: a transfer names no
 * Partner and writes no subject book (CLAUDE.md §10 rule 84). It reaches the
 * books only through the functions they export, and nothing imports it.
 */

const cents = (n: number) => Math.round(n * 100);

export const CONVERSION_LABEL = "Pencairan Open Item";

// ------------------------------------------------------------------ posting

export type ConversionPostingResult =
  | { ok: true; fxDifference: number; journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/** A refusal raised inside the posting transaction, converted back after the rollback. */
class ConversionRefused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("Pencairan Open Item ditolak");
    this.name = "ConversionRefused";
  }
}

/** Carries a dry run's journal out of the transaction it rolls back. */
class ConversionDryRun extends Error {
  constructor(readonly lines: JournalLineInput[]) {
    super("Pratinjau Pencairan Open Item");
    this.name = "ConversionDryRun";
  }
}

type PlannedItem = {
  rowId: number;
  itemId: number;
  itemNo: string;
  amount: number;
  /** The item's own kurs, which its release is valued at. */
  rate: number;
  releasedBase: number;
  share: number;
  fx: number;
};

type PlannedLine = {
  rowId: number;
  toCashBankId: number;
  toLabel: string;
  toAccountId: number;
  toCurrencyId: number;
  amount: number;
  rate: number;
  outBase: number;
  inAmount: number;
  cashFx: number;
  itemFx: number;
  items: PlannedItem[];
};

/**
 * Post: the actual boundary, and one database transaction.
 *
 * Everything that can be decided without a write is decided first — the date,
 * the header, the mapped account — so an ordinary refusal comes back without a
 * transaction opening. Inside it the period is held, the Partner's foreign
 * position is locked, the layer is drawn and the items are re-read under the
 * lock; then the books, the journal and the document's own figures are written
 * together. Either all of it happened or none of it did.
 *
 * Lives here rather than inside the Server Action so the rule is testable.
 */
export async function applyConversion(
  conversionId: number,
  actorId: number,
  /**
   * Run the whole posting and roll it back once the journal is known — what
   * the Post confirmation shows. The layer and the items are valued under the
   * transaction's own reads, so a rolled-back run values them exactly as Post.
   */
  dryRun = false
): Promise<ConversionPostingResult> {
  const doc = await prisma.finItemConversion.findUnique({
    where: { id: conversionId },
    include: {
      lines: {
        orderBy: { sequence_no: "asc" },
        include: {
          items: { orderBy: { sequence_no: "asc" } },
          to_cash_bank: {
            select: { cash_bank_label: true, account_id: true, currency_id: true },
          },
        },
      },
      from_cash_bank: { select: { cash_bank_label: true, account_id: true } },
      company: { select: { is_parent: true } },
    },
  });

  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Draft") {
    return { ok: false, errors: { _form: "Hanya dokumen berstatus Draft yang dapat diposting." } };
  }
  if (!doc.lines.length) {
    return {
      ok: false,
      errors: { _form: "Tambahkan minimal satu Cash & Bank tujuan sebelum dokumen diposting." },
    };
  }

  const dated = await checkTransactionDate(doc.accounting_date ?? todayDay(), [doc.company_id]);
  if (!dated.ok) return { ok: false, errors: { _form: dated.message } };
  const date = dated.date;

  // Re-checked rather than trusted from the save: the layer may have been
  // spent, the Partner deactivated, the book's category retired.
  const header = await checkConversionHeader(
    {
      from_cash_bank_id: doc.from_cash_bank_id,
      cash_bank_layer_id: doc.cash_bank_layer_id,
      budget_category_id: doc.budget_category_id,
      partner_id: doc.partner_id,
    },
    [doc.company_id]
  );
  if (!header.ok) return { ok: false, errors: { _form: Object.values(header.errors)[0] } };
  const lineCheck = await checkConversionLines(
    header,
    doc.lines.map((l) => ({
      to_cash_bank_id: l.to_cash_bank_id,
      exchange_rate: l.exchange_rate.toNumber(),
      items: l.items.map((i) => ({ item_id: i.sub_ledger_balance_id, amount: i.amount.toNumber() })),
    })),
    date
  );
  if (!lineCheck.ok) return { ok: false, errors: { _form: lineCheck.errors._lines } };

  // The Partner's account, exactly as a cash posting resolves it — Company ×
  // Budget Category × Partner Category. One account for both currencies.
  const mapping = await prisma.accBudgetCategoryAccount.findFirst({
    where: {
      company_id: doc.company_id,
      budget_category_id: doc.budget_category_id,
      partner_category_id: header.partnerCategoryId,
    },
    select: {
      account: {
        select: { id: true, company_id: true, is_active: true, is_postable: true, account_label: true },
      },
    },
  });
  if (!mapping) {
    return {
      ok: false,
      errors: {
        _form:
          `Belum ada Mapping Budget ke Account untuk ${header.book.name} dan ` +
          `Partner Category ${header.partnerLabel}. Lengkapi mapping di Accounting ` +
          "sebelum dokumen diposting.",
      },
    };
  }
  const partnerAccount = mapping.account;
  if (
    partnerAccount.company_id !== doc.company_id ||
    !partnerAccount.is_active ||
    !partnerAccount.is_postable
  ) {
    return {
      ok: false,
      errors: {
        _form:
          `Account ${partnerAccount.account_label} yang dipetakan untuk posisi ini ` +
          "tidak aktif atau bukan account postable.",
      },
    };
  }

  const base = await prisma.refCurrency.findFirst({
    where: { currency_label: BASE_CURRENCY_LABEL },
    select: { id: true },
  });
  if (!base) {
    throw new Error(`Currency dasar ${BASE_CURRENCY_LABEL} tidak ada pada master. Jalankan db:seed.`);
  }

  const book = header.book;
  const raisesOnIn = book.raises === "In";
  // Releasing moves the position the way money leaving would for a book money
  // arriving raises, and the mirror for the other kind.
  const releaseDirection = raisesOnIn ? "Out" : "In";
  const docTypeId = await conversionDocTypeId();
  const label = `${doc.conversion_no} — ${CONVERSION_LABEL}`;
  let fxDifference = 0;

  try {
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, [doc.company_id], date);
      // Held until the transaction ends: a second document converting or
      // settling this Partner's foreign items waits here, and reads what this
      // one left.
      await lockSubledgerPosition(tx, book.categoryId, doc.partner_id, doc.currency_id);
      await lockCashBanks(tx, [doc.from_cash_bank_id, ...doc.lines.map((l) => l.to_cash_bank_id)]);

      // The items as they stand under the lock, tracked across lines so an
      // item split between two lines relieves its second part from what the
      // first left — exactly as `recordSubledgerEntry` will.
      const itemState = new Map<number, { itemNo: string; rate: number; balance: Balance }>();
      for (const l of doc.lines) {
        for (const i of l.items) {
          if (itemState.has(i.sub_ledger_balance_id)) continue;
          const item = await subledgerItem(i.sub_ledger_balance_id, tx);
          if (!item || item.status !== "Open") {
            throw new ConversionRefused({
              _form: `Open item ${item?.itemNo ?? ""} sudah selesai sejak dokumen disimpan.`,
            });
          }
          itemState.set(item.id, {
            itemNo: item.itemNo,
            rate: item.rate,
            balance: { foreign: item.remaining, base: item.baseRemaining },
          });
        }
      }

      const planned: PlannedLine[] = [];
      let sourceAmount = 0;
      let sourceBase = 0;
      let sourceRate = header.layerRate;

      for (const l of doc.lines) {
        const amount = l.amount.toNumber();
        const rate = l.exchange_rate.toNumber();
        const drawn = await drawFromLayer(tx, {
          layerId: doc.cash_bank_layer_id,
          cashBankId: doc.from_cash_bank_id,
          foreign: amount,
          date,
          actorId,
        });
        sourceRate = drawn.rate;

        const released = l.items.map((i) => {
          const state = itemState.get(i.sub_ledger_balance_id)!;
          const want = i.amount.toNumber();
          if (cents(want) > cents(state.balance.foreign)) {
            throw new ConversionRefused({
              _form:
                `Open item ${state.itemNo} tinggal ${formatMoney(state.balance.foreign, header.currencyLabel)}, ` +
                `tidak cukup untuk ${formatMoney(want, header.currencyLabel)}.`,
            });
          }
          const relief = relieve(
            state.balance,
            cents(want) === cents(state.balance.foreign) ? state.balance.foreign : want
          );
          state.balance = relief.remaining;
          return { row: i, state, amount: want, base: relief.base };
        });

        const valued = valueConversionLine({
          amount,
          rate,
          layerReleasedBase: drawn.base,
          layerRate: drawn.rate,
          raisesOnIn,
          items: released.map((r) => ({ amount: r.amount, releasedBase: r.base })),
        });

        sourceAmount = roundBase(sourceAmount + amount);
        sourceBase = roundBase(sourceBase + valued.outBase);

        planned.push({
          rowId: l.id,
          toCashBankId: l.to_cash_bank_id,
          toLabel: l.to_cash_bank.cash_bank_label,
          toAccountId: l.to_cash_bank.account_id,
          toCurrencyId: l.to_cash_bank.currency_id,
          amount,
          rate,
          outBase: valued.outBase,
          inAmount: valued.inAmount,
          cashFx: valued.cashFx,
          itemFx: valued.itemFxTotal,
          items: released.map((r, k) => ({
            rowId: r.row.id,
            itemId: r.row.sub_ledger_balance_id,
            itemNo: r.state.itemNo,
            amount: r.amount,
            rate: r.state.rate,
            releasedBase: r.base,
            share: valued.shares[k],
            fx: valued.itemFx[k],
          })),
        });
      }

      fxDifference = roundBase(
        planned.reduce((t, l) => t + l.cashFx + l.itemFx, 0)
      );

      // A difference has to land somewhere named, and is resolved only when
      // one actually arises.
      let fxAccountId: number | null = null;
      if (fxDifference !== 0) {
        fxAccountId = await systemAccountId(doc.company.is_parent, "fx");
        if (!fxAccountId) {
          throw new ConversionRefused({
            _form:
              "Selisih kurs muncul pada dokumen ini, tetapi Account Selisih Kurs " +
              "belum diatur untuk Company ini. Lengkapi di Accounting › Mapping " +
              "Account System sebelum dokumen diposting.",
          });
        }
      }

      // The journal, in the order a reader checks it: the cash legs, then the
      // Partner legs, then the one difference.
      const entries: JournalLineInput[] = [
        {
          accountId: doc.from_cash_bank.account_id,
          currencyId: doc.currency_id,
          rate: sourceRate,
          debit: 0,
          credit: sourceAmount,
          baseAmount: sourceBase,
          description: `${doc.conversion_no} — ${doc.from_cash_bank.cash_bank_label}`,
        },
        ...planned.map((l) => ({
          accountId: l.toAccountId,
          currencyId: l.toCurrencyId,
          rate: 1,
          debit: l.inAmount,
          credit: 0,
          baseAmount: l.inAmount,
          description: `${CONVERSION_LABEL} — ${l.toLabel}`,
        })),
      ];
      for (const l of planned) {
        for (const i of l.items) {
          entries.push({
            accountId: partnerAccount.id,
            partnerId: doc.partner_id,
            currencyId: doc.currency_id,
            rate: i.rate,
            debit: raisesOnIn ? i.amount : 0,
            credit: raisesOnIn ? 0 : i.amount,
            baseAmount: i.releasedBase,
            description: `${doc.conversion_no} — ${i.itemNo} dikonversi`,
          });
        }
        entries.push({
          accountId: partnerAccount.id,
          partnerId: doc.partner_id,
          currencyId: base.id,
          rate: 1,
          debit: raisesOnIn ? 0 : l.inAmount,
          credit: raisesOnIn ? l.inAmount : 0,
          baseAmount: l.inAmount,
          description: `${doc.conversion_no} — konversi ke ${BASE_CURRENCY_LABEL} @ ${formatRate(l.rate)}`,
        });
      }
      if (fxDifference !== 0 && fxAccountId) {
        const gain = fxDifference > 0;
        entries.push({
          accountId: fxAccountId,
          currencyId: base.id,
          rate: 1,
          debit: gain ? 0 : Math.abs(fxDifference),
          credit: gain ? Math.abs(fxDifference) : 0,
          description: `Selisih pencairan — ${doc.conversion_no}`,
        });
      }

      // The source gives up once, however many destinations there are.
      await recordCashBankEntry(tx, {
        cashBankId: doc.from_cash_bank_id,
        date,
        type: "Transaction",
        direction: "Out",
        amount: sourceAmount,
        rate: sourceRate,
        baseAmount: sourceBase,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        note: `${label} · ${header.partnerLabel}`,
        actorId,
      });
      // Stopped after the source's entry, so the preview is refused exactly
      // where Post would be — on a day the source would go below nothing.
      if (dryRun) throw new ConversionDryRun(entries);

      for (const l of planned) {
        await recordCashBankEntry(tx, {
          cashBankId: l.toCashBankId,
          date,
          type: "Transaction",
          direction: "In",
          amount: l.inAmount,
          rate: 1,
          baseAmount: l.inAmount,
          sourceDocTypeId: docTypeId,
          sourceDocId: doc.id,
          note: `${label} · ${header.partnerLabel}`,
          actorId,
        });

        // Each foreign item released at its own kurs. `baseAmount` is passed
        // so an item another writer moved since the plan valued it throws
        // rather than posting a figure the journal does not carry.
        for (const i of l.items) {
          await recordSubledgerEntry(tx, {
            book,
            partnerId: doc.partner_id,
            currencyId: doc.currency_id,
            date,
            type: "Conversion",
            direction: releaseDirection,
            amount: i.amount,
            rate: i.rate,
            baseAmount: i.releasedBase,
            itemId: i.itemId,
            sourceDocTypeId: docTypeId,
            sourceDocId: doc.id,
            note: label,
            actorId,
          });
          await tx.finItemConversionLineItem.update({
            where: { id: i.rowId },
            data: {
              settlement_base_amount: i.releasedBase,
              converted_base_amount: i.share,
              fx_difference: i.fx,
              updated_by: actorId,
            },
          });
        }

        // What the line's sale produced is what the Partner's position now
        // is, in base currency: one new item, at a kurs of 1, named after
        // what it came from.
        const opened = await recordSubledgerEntry(tx, {
          book,
          partnerId: doc.partner_id,
          currencyId: base.id,
          date,
          type: "Conversion",
          direction: book.raises,
          amount: l.inAmount,
          rate: 1,
          baseAmount: l.inAmount,
          sourceDocTypeId: docTypeId,
          sourceDocId: doc.id,
          note:
            `${doc.conversion_no} — konversi ${l.items.map((i) => i.itemNo).join(", ")} ` +
            `(${formatMoney(l.amount, header.currencyLabel)} @ ${formatRate(l.rate)})`,
          actorId,
        });

        await tx.finItemConversionLine.update({
          where: { id: l.rowId },
          data: {
            out_base_amount: l.outBase,
            in_amount: l.inAmount,
            opened_item_id: opened.balance_id,
            cash_fx_difference: l.cashFx,
            item_fx_difference: l.itemFx,
            updated_by: actorId,
          },
        });
      }

      // The Journal is written alongside the books, never from them, and
      // throws unless it balances — which takes the whole posting down.
      await postJournal(tx, {
        companyId: doc.company_id,
        accountingDate: new Date(`${date}T00:00:00Z`),
        description: `${label} · ${header.partnerLabel}`,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        lines: entries,
        actorId,
      });

      await tx.finItemConversion.update({
        where: { id: doc.id },
        data: {
          status: "Posted",
          accounting_date: new Date(`${date}T00:00:00Z`),
          posted_at: new Date(),
          conversion_base_amount: sourceBase,
          fx_difference: fxDifference,
          updated_by: actorId,
        },
      });
    });
  } catch (error) {
    if (error instanceof ConversionDryRun) return { ok: true, fxDifference, journal: error.lines };
    if (error instanceof ConversionRefused) return { ok: false, errors: error.errors };
    if (
      error instanceof PeriodShut ||
      error instanceof InsufficientFunds ||
      error instanceof LayerNotAvailable ||
      error instanceof SubledgerItemUnavailable
    ) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }

  return { ok: true, fxDifference };
}

/** The journal Post would write for this document, or its refusal. Writes nothing. */
export async function previewConversion(
  conversionId: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const result = await applyConversion(conversionId, 0, true);
  if (!result.ok) return result;
  return { ok: true, lines: await describeJournalLines(result.journal ?? []) };
}

/** Document numbers by id, for a book report to name the document an entry came from. */
export async function documentNumbers(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.finItemConversion.findMany({ where: { id: { in: ids } }, select: { id: true, conversion_no: true } });
  return new Map(rows.map((r) => [r.id, r.conversion_no]));
}
