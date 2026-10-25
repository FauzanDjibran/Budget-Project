import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { sumByCurrency, type MoneyTotal } from "@/lib/format";


import {
  PeriodShut,
  checkTransactionDate,
  holdPostingPeriod,
  todayDay,
} from "./fiscal";
import { relieve, roundBase } from "./fx";
import {
  describeJournalLines,
  postJournal,
  type JournalLineInput,
  type JournalPreviewLine,
} from "./journal";
import { adjustmentDirection, type ItemAdjustmentEffect } from "./item-adjustment-workflow";
import { SubledgerItemUnavailable, lockSubledgerPosition, recordSubledgerEntry, subledgerItem } from "./subledger";


import type { SystemAccountKey } from "./system-accounts";
import { checkSystemAccountValue, systemAccountId } from "./system-account-data";
import { type ItemAdjustmentRow, itemAdjustmentDocTypeId } from "./item-adjustment-rows";
import { type ResolvedItemAdjustmentHeader, checkItemAdjustmentHeader, type CheckedAdjustmentLine, checkItemAdjustmentLines, movedSince, netChange } from "./item-adjustment-check";

/**
 * Penyesuaian Open Item: the adjustment document for a Partner's existing open
 * items in a subject book — what mainstream ERP calls a Debit Note and a
 * Credit Note issued against an invoice, kept under SIBA's own name.
 *
 * **It changes an item that exists, never creates one.** Every line names one
 * open item and the value it should now hold: a Piutang item of 10m typed as
 * 8m is lowered by 2m (a Pengurangan, like a Credit Note), typed as 12m it is
 * raised by 2m (a Penambahan, like a Debit Note). The difference is never
 * typed and the direction never chosen — both are read off the item, the way
 * Business Central's Adjust Inventory posts the gap to a typed New Inventory.
 * The change is a new ledger line on that same item. One document may raise
 * some items and lower others. SIBA keeps no invoice, so the item is what the
 * document references. No cash moves: it writes no Cash Bank Book entry,
 * draws on no rate layer and realizes no Budget.
 *
 * **A new value is typed against a balance, and Post holds it to that
 * balance.** The draft records what each item held when it was saved; Post
 * refuses when an item holds anything else, because the same new value would
 * then move it by a difference nobody saw — possibly the other way.
 *
 * **Each item moves at its own kurs.** A Penambahan raises an item by
 * `difference × its kurs`; a Pengurangan releases what that part is carried
 * at, and taking an item to nil hands back exactly what it holds. Both journal
 * sides carry the same base, so no FX difference can arise and no kurs is
 * typed.
 *
 * **One rule covers every book.** Each line's effect is handed to the book as
 * a cash direction (`adjustmentDirection`), and the book's own `raises`
 * decides the rest. The Partner line is debited exactly when that direction is
 * money leaving, and its counter line is the Company's Pendapatan Penyesuaian
 * account when credited and its Beban Penyesuaian account when debited. Which
 * books may be adjusted is the category's `allows_item_adjustment`, not a
 * code list.
 *
 * **Valued when saved, and again at Post.** A draft states the base of every
 * line Post would write if it ran now; Post re-values under the position's
 * lock and writes them again.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const cents = (n: number) => Math.round(n * 100);

// ---------------------------------------------------------------- valuation

export type ValuedAdjustmentLine = CheckedAdjustmentLine & { base: number };

/**
 * What every line is worth in base, by the kernel the posting runs, and only
 * while every item still holds what the line was stated against.
 *
 * Every item moves at **its own** kurs. A Penambahan raises an item by
 * `difference × its kurs`, so the item's rate never changes. A Pengurangan
 * releases what that part is carried at, and taking an item to nil hands back
 * exactly the base it holds.
 */
export async function valueItemAdjustment(
  header: ResolvedItemAdjustmentHeader,
  lines: CheckedAdjustmentLine[],
  db: Db = prisma
): Promise<ValuedAdjustmentLine[]> {
  const out: ValuedAdjustmentLine[] = [];
  for (const l of lines) {
    const item = await subledgerItem(l.itemId, db);
    if (!item || item.status !== "Open") {
      throw new SubledgerItemUnavailable(
        `Open item ${l.itemNo} sudah selesai sejak dokumen disimpan. Ubah dokumen dan pilih ulang.`
      );
    }
    if (cents(item.remaining) !== cents(l.balanceBefore)) {
      throw new SubledgerItemUnavailable(movedSince(item, header.currencyLabel, l.balanceBefore));
    }
    const base =
      l.effect === "Increase"
        ? roundBase(l.amount * item.rate)
        : relieve(
            { foreign: item.remaining, base: item.baseRemaining },
            cents(l.amount) === cents(item.remaining) ? item.remaining : l.amount
          ).base;
    out.push({ ...l, base });
  }
  return out;
}

/** The net change in base, signed the way `netChange` signs the amount. */
const netBase = (lines: ValuedAdjustmentLine[]) =>
  roundBase(lines.reduce((t, l) => t + (l.effect === "Increase" ? l.base : -l.base), 0));

// ------------------------------------------------------------------ posting

export type ItemAdjustmentPostingResult =
  | { ok: true; baseAmount: number; journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/** Carries a dry run's journal out of the transaction it rolls back. */
class AdjustmentDryRun extends Error {
  constructor(readonly lines: JournalLineInput[]) {
    super("Pratinjau penyesuaian");
    this.name = "AdjustmentDryRun";
  }
}

/**
 * The counter account by the side it takes: credited it is income, debited an
 * expense.
 */
const COUNTER = {
  credit: { key: "adjustment_income", name: "Pendapatan Penyesuaian" },
  debit: { key: "adjustment_expense", name: "Beban Penyesuaian" },
} as const satisfies Record<string, { key: SystemAccountKey; name: string }>;

/**
 * Post: the actual boundary, and one database transaction.
 *
 * Everything that can be decided without the position is decided first — the
 * period, the book, the Partner, the accounts the lines need — so an ordinary
 * refusal comes back without a transaction ever opening. Inside it the
 * position is locked, every item re-read and held to the balance its line was
 * stated against, and then the subject-book entries, the journal and the
 * document's own figures are written together. Either all of it happened or
 * none of it did.
 *
 * Lives here rather than inside the Server Action so the rule is testable: the
 * action resolves a caller and then calls this, and the suite calls the same
 * function.
 */
export async function applyItemAdjustment(
  adjustmentId: number,
  actorId: number,
  /**
   * Run the whole posting and roll it back once the journal is known — what
   * the Post confirmation shows. The items are read under the position's lock
   * inside the transaction, so a rolled-back run values them exactly as Post
   * will.
   */
  dryRun = false
): Promise<ItemAdjustmentPostingResult> {
  const doc = await prisma.finItemAdjustment.findUnique({
    where: { id: adjustmentId },
    include: {
      lines: { orderBy: { sequence_no: "asc" } },
      company: { select: { is_parent: true } },
    },
  });

  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Draft") {
    return { ok: false, errors: { _form: "Hanya dokumen berstatus Draft yang dapat diposting." } };
  }
  if (!doc.lines.length) {
    return { ok: false, errors: { _form: "Tambahkan minimal satu baris sebelum dokumen diposting." } };
  }
  if (doc.lines.some((l) => l.balance_before == null || l.new_amount == null)) {
    return {
      ok: false,
      errors: { _form: "Dokumen disimpan dengan cara lama. Ubah dokumen dan isi Nilai Baru setiap baris." },
    };
  }

  // The day this belongs to in the books — chosen on the draft, possibly
  // earlier than today, and re-checked here because a year can close in
  // between.
  const dated = await checkTransactionDate(doc.accounting_date ?? todayDay(), [doc.company_id]);
  if (!dated.ok) return { ok: false, errors: { _form: dated.message } };
  const date = dated.date;

  // Re-checked rather than trusted from when the draft was saved: the book may
  // have lost its flag, the Partner may have been deactivated or moved out of
  // the categories the book admits, and an item may have moved since.
  const header = await checkItemAdjustmentHeader(
    {
      budget_category_id: doc.budget_category_id,
      partner_id: doc.partner_id,
      currency_id: doc.currency_id,
      exchange_rate: doc.exchange_rate?.toNumber() ?? null,
    },
    [doc.company_id]
  );
  if (!header.ok) return { ok: false, errors: { _form: Object.values(header.errors)[0] } };
  const checked = await checkItemAdjustmentLines(
    header,
    doc.lines.map((l) => ({
      item_id: l.sub_ledger_balance_id,
      new_amount: l.new_amount!.toNumber(),
      balance_before: l.balance_before!.toNumber(),
    })),
    date
  );
  if (!checked.ok) return { ok: false, errors: { _form: Object.values(checked.errors)[0] } };

  // The Partner's side: the account its position is mapped to, exactly as a
  // cash posting resolves it — Company × Budget Category × Partner Category.
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
          "Partner Category Partner ini. Lengkapi mapping di Accounting sebelum " +
          "dokumen diposting.",
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

  // Each line's direction, and from it which side its Partner line takes.
  const directionOf = (effect: ItemAdjustmentEffect) =>
    adjustmentDirection(effect, header.book.raises);
  const partnerDebits = (effect: ItemAdjustmentEffect) => directionOf(effect) === "Out";

  // The counter side: Pendapatan or Beban Penyesuaian, by the side it takes —
  // only the ones a line actually needs, never guessed and never a fallback.
  const counterIds = new Map<"credit" | "debit", number>();
  for (const side of ["credit", "debit"] as const) {
    if (!checked.lines.some((l) => partnerDebits(l.effect) === (side === "credit"))) continue;
    const { key, name } = COUNTER[side];
    const id = await systemAccountId(doc.company.is_parent, key);
    const refusal = id ? await checkSystemAccountValue(doc.company_id, key, id) : "belum diatur";
    if (!id || refusal) {
      return {
        ok: false,
        errors: {
          _form:
            `Account ${name} untuk Company ini ${
              id ? `tidak dapat dipakai: ${refusal}` : "belum diatur"
            }. Lengkapi di Accounting › Mapping Account System sebelum dokumen diposting.`,
        },
      };
    }
    counterIds.set(side, id);
  }

  const docTypeId = await itemAdjustmentDocTypeId();
  let baseAmount = 0;

  try {
    await prisma.$transaction(async (tx) => {
      // The year this is dated in, held against a close and re-asked under
      // the hold — taken before the position, the order every writer uses.
      await holdPostingPeriod(tx, [doc.company_id], date);

      // Held until the transaction ends. A second document on the same
      // position waits here, and its read below sees what this one left.
      await lockSubledgerPosition(tx, header.book.categoryId, doc.partner_id, doc.currency_id);
      const valued = await valueItemAdjustment(header, checked.lines, tx);
      baseAmount = netBase(valued);

      // One entry per line, naming its item — a new ledger line on the same
      // item, raising it or lowering it at its own kurs.
      for (const l of valued) {
        await recordSubledgerEntry(tx, {
          book: header.book,
          partnerId: doc.partner_id,
          currencyId: doc.currency_id,
          date,
          type: "Adjustment",
          direction: directionOf(l.effect),
          amount: l.amount,
          rate: l.base / l.amount,
          baseAmount: l.base,
          itemId: l.itemId,
          sourceDocTypeId: docTypeId,
          sourceDocId: doc.id,
          note: `${doc.adjustment_no} — ${l.description}`,
          actorId,
        });
      }

      // Per line, the Partner line and its counter line, each reading the
      // line's own description so the General Ledger reads back to it. Same
      // currency, same base on both sides — there is no second valuation to
      // disagree with. Debits first.
      const journal: JournalLineInput[] = [];
      for (const l of valued) {
        const debit = partnerDebits(l.effect);
        const shared = {
          currencyId: doc.currency_id,
          rate: l.base / l.amount,
          baseAmount: l.base,
          description: `${doc.adjustment_no} — ${l.description}`,
        };
        const partnerLine: JournalLineInput = {
          ...shared,
          accountId: partnerAccount.id,
          partnerId: doc.partner_id,
          debit: debit ? l.amount : 0,
          credit: debit ? 0 : l.amount,
        };
        const counterLine: JournalLineInput = {
          ...shared,
          accountId: counterIds.get(debit ? "credit" : "debit")!,
          debit: debit ? 0 : l.amount,
          credit: debit ? l.amount : 0,
        };
        journal.push(...(debit ? [partnerLine, counterLine] : [counterLine, partnerLine]));
      }
      if (dryRun) throw new AdjustmentDryRun(journal);

      await postJournal(tx, {
        companyId: doc.company_id,
        accountingDate: new Date(`${date}T00:00:00Z`),
        description: `${doc.adjustment_no} — Penyesuaian Open Item`,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        lines: journal,
        actorId,
      });

      await writeValuation(tx, doc.lines, valued, actorId);
      await tx.finItemAdjustment.update({
        where: { id: doc.id },
        data: {
          status: "Posted",
          accounting_date: new Date(`${date}T00:00:00Z`),
          posted_at: new Date(),
          adjustment_amount: netChange(valued),
          adjustment_base_amount: baseAmount,
          updated_by: actorId,
        },
      });
    });
  } catch (error) {
    if (error instanceof AdjustmentDryRun) return { ok: true, baseAmount, journal: error.lines };
    if (error instanceof PeriodShut || error instanceof SubledgerItemUnavailable) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }

  return { ok: true, baseAmount };
}

/**
 * Each line's base, as a valuation found them — written when a draft is
 * saved, so it states what Post will write, and again by Post.
 */
async function writeValuation(
  db: Db,
  lines: { id: number }[],
  valued: ValuedAdjustmentLine[],
  actorId: number
): Promise<void> {
  for (const [n, line] of lines.entries()) {
    await db.finItemAdjustmentLine.update({
      where: { id: line.id },
      data: { base_amount: valued[n].base, updated_by: actorId },
    });
  }
}

// ------------------------------------------------------------------ summary

export type ItemAdjustmentSummary = {
  draft: number;
  posted: number;
  cancelled: number;
  /** Posted value per currency — amounts are never added across currencies. */
  increaseTotals: MoneyTotal[];
  decreaseTotals: MoneyTotal[];
};

export function summariseItemAdjustments(rows: ItemAdjustmentRow[]): ItemAdjustmentSummary {
  const posted = rows.filter((r) => r.status === "Posted");
  const totals = (pick: (r: ItemAdjustmentRow) => number) =>
    sumByCurrency(
      posted
        .filter((r) => pick(r) > 0)
        .map((r) => ({
          currencyId: r.currency_id,
          currencyLabel: r.currency_label,
          amount: pick(r),
        }))
    );
  return {
    draft: rows.filter((r) => r.status === "Draft").length,
    posted: posted.length,
    cancelled: rows.filter((r) => r.status === "Cancelled").length,
    increaseTotals: totals((r) => r.increase_amount),
    decreaseTotals: totals((r) => r.decrease_amount),
  };
}

/** The journal Post would write for this document, or its refusal. Writes nothing. */
export async function previewItemAdjustment(
  adjustmentId: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const result = await applyItemAdjustment(adjustmentId, 0, true);
  if (!result.ok) return result;
  return { ok: true, lines: await describeJournalLines(result.journal ?? []) };
}

/**
 * A draft's figures, written inside its own save: what every line is worth
 * now, as Post would value it.
 */
export async function valueItemAdjustmentDraft(
  db: Db,
  adjustmentId: number,
  header: ResolvedItemAdjustmentHeader,
  lines: CheckedAdjustmentLine[],
  actorId: number
): Promise<void> {
  const valued = await valueItemAdjustment(header, lines, db);
  const written = await db.finItemAdjustmentLine.findMany({
    where: { adjustment_id: adjustmentId },
    orderBy: { sequence_no: "asc" },
    select: { id: true },
  });
  await writeValuation(db, written, valued, actorId);
  await db.finItemAdjustment.update({
    where: { id: adjustmentId },
    data: { adjustment_base_amount: netBase(valued) },
  });
}

/** The rows a checked set of lines is saved as. */
export function adjustmentLineData(lines: CheckedAdjustmentLine[], actorId: number) {
  return lines.map((l, i) => ({
    sequence_no: i + 1,
    description: l.description,
    sub_ledger_balance_id: l.itemId,
    effect: l.effect,
    balance_before: l.balanceBefore,
    new_amount: l.newAmount,
    amount: l.amount,
    created_by: actorId,
  }));
}

/** Document numbers by id, for a book report to name the document an entry came from. */
export async function documentNumbers(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.finItemAdjustment.findMany({ where: { id: { in: ids } }, select: { id: true, adjustment_no: true } });
  return new Map(rows.map((r) => [r.id, r.adjustment_no]));
}
