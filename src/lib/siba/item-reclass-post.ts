import "server-only";

import { prisma } from "@/lib/prisma";
import { categoryAccount } from "./category-accounts";
import { formatMoney } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "./currency";
import { PeriodShut, checkTransactionDate, holdPostingPeriod, todayDay } from "./fiscal";
import { relieve, roundBase, type Balance } from "./fx";
import { sourceIsDebit, sourceReleaseDirection, targetDirection, valueReclassLine, type ReclassEffect } from "./item-reclass-valuation";
import { RECLASS_LABEL, cents, checkReclassHeader, checkReclassLines, reclassDocTypeId } from "./item-reclass";
import { describeJournalLines, postJournal, type JournalLineInput, type JournalPreviewLine } from "./journal";
import { SubledgerItemUnavailable, lockSubledgerPosition, recordSubledgerEntry, subledgerItem } from "./subledger";
import { type SubledgerDef } from "./subledger-catalogue";
import { systemAccountId } from "./system-account-data";

// ------------------------------------------------------------------ posting

export type ReclassPostingResult =
  | { ok: true; fxDifference: number; journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/** A refusal raised inside the posting transaction, converted back after the rollback. */
class ReclassRefused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("Reklasifikasi Open Item ditolak");
    this.name = "ReclassRefused";
  }
}

/** Carries a dry run's journal out of the transaction it rolls back. */
class ReclassDryRun extends Error {
  constructor(readonly lines: JournalLineInput[]) {
    super("Pratinjau Reklasifikasi Open Item");
    this.name = "ReclassDryRun";
  }
}

/**
 * The account a position posts to — Company × Budget Category × the Partner's
 * Partner Category, exactly as a cash posting resolves it. A refusal names the
 * book, because the user has to go and map it.
 */
async function mappedAccount(
  companyId: number,
  book: SubledgerDef,
  partnerCategoryId: number,
  partnerLabel: string
): Promise<{ ok: true; accountId: number } | { ok: false; message: string }> {
  const mapping = await categoryAccount(companyId, book.categoryId, partnerCategoryId);
  if (!mapping) {
    return {
      ok: false,
      message:
        `Belum ada Account yang memegang ${book.name} untuk Partner Category ` +
        `${partnerLabel}. Tambahkan pada Account di Chart of Accounts sebelum dokumen diposting.`,
    };
  }
  const account = mapping.account;
  if (account.company_id !== companyId || !account.is_active || !account.is_postable) {
    return {
      ok: false,
      message:
        `Account ${account.account_label} yang dipetakan untuk ${book.name} tidak ` +
        "aktif atau bukan account postable.",
    };
  }
  return { ok: true, accountId: account.id };
}

type ItemState = { itemNo: string; rate: number; note: string | null; balance: Balance };

type PlannedSource = {
  rowId: number;
  itemId: number;
  itemNo: string;
  note: string | null;
  amount: number;
  rate: number;
  releasedBase: number;
};

type PlannedTarget = {
  rowId: number;
  itemId: number;
  itemNo: string;
  amount: number;
  rate: number;
  settledBase: number;
  share: number;
  fx: number;
};

type PlannedLine = {
  rowId: number;
  targetBook: SubledgerDef;
  targetPartnerId: number;
  targetPartnerLabel: string;
  targetAccountId: number;
  effect: ReclassEffect;
  description: string | null;
  releasedBase: number;
  fxTotal: number;
  sources: PlannedSource[];
  targets: PlannedTarget[];
};

/**
 * Post: the actual boundary, and one database transaction.
 *
 * Everything that can be decided without a write is decided first — the date,
 * the header, the lines, the mapped accounts — so an ordinary refusal comes
 * back without a transaction opening. Inside it the period is held, every
 * position the document lowers is locked in one order, and every item is
 * re-read under the lock; then the books, the journal and the document's own
 * figures are written together. Either all of it happened or none of it did.
 *
 * Lives here rather than inside the Server Action so the rule is testable.
 */
export async function applyReclass(
  reclassId: number,
  actorId: number,
  /**
   * Run the whole posting and roll it back once the journal is known — what
   * the Post confirmation shows. The items are valued under the transaction's
   * own reads, so a rolled-back run values them exactly as Post.
   */
  dryRun = false
): Promise<ReclassPostingResult> {
  const doc = await prisma.finItemReclass.findUnique({
    where: { id: reclassId },
    include: {
      lines: {
        orderBy: { sequence_no: "asc" },
        include: {
          sources: { orderBy: { sequence_no: "asc" } },
          targets: { orderBy: { sequence_no: "asc" } },
        },
      },
      company: { select: { is_parent: true } },
    },
  });

  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Draft") {
    return { ok: false, errors: { _form: "Hanya dokumen berstatus Draft yang dapat diposting." } };
  }
  if (!doc.lines.length) {
    return { ok: false, errors: { _form: "Tambahkan minimal satu baris tujuan sebelum dokumen diposting." } };
  }

  const dated = await checkTransactionDate(doc.accounting_date ?? todayDay(), [doc.company_id]);
  if (!dated.ok) return { ok: false, errors: { _form: dated.message } };
  const date = dated.date;

  // Re-checked rather than trusted from the save: a Partner may have been
  // deactivated, a category retired, an item settled by another document.
  const header = await checkReclassHeader(
    {
      budget_category_id: doc.budget_category_id,
      partner_id: doc.partner_id,
      currency_id: doc.currency_id,
    },
    [doc.company_id]
  );
  if (!header.ok) return { ok: false, errors: { _form: Object.values(header.errors)[0] } };
  const lineCheck = await checkReclassLines(
    header,
    doc.lines.map((l) => ({
      target_budget_category_id: l.target_budget_category_id,
      target_partner_id: l.target_partner_id,
      description: l.description,
      sources: l.sources.map((s) => ({ item_id: s.sub_ledger_balance_id, amount: s.amount.toNumber() })),
      targets: l.targets.map((t) => ({ item_id: t.sub_ledger_balance_id, amount: t.amount.toNumber() })),
    })),
    date
  );
  if (!lineCheck.ok) return { ok: false, errors: { _form: lineCheck.errors._lines } };

  const sourceAccount = await mappedAccount(
    doc.company_id,
    header.book,
    header.partnerCategoryId,
    header.partnerLabel
  );
  if (!sourceAccount.ok) return { ok: false, errors: { _form: sourceAccount.message } };
  const targetAccounts: number[] = [];
  for (const l of lineCheck.lines) {
    const account = await mappedAccount(
      doc.company_id,
      l.targetBook,
      l.targetPartnerCategoryId,
      l.targetPartnerLabel
    );
    if (!account.ok) return { ok: false, errors: { _form: account.message } };
    targetAccounts.push(account.accountId);
  }

  const base = await prisma.refCurrency.findFirst({
    where: { currency_label: BASE_CURRENCY_LABEL },
    select: { id: true },
  });
  if (!base) {
    throw new Error(`Currency dasar ${BASE_CURRENCY_LABEL} tidak ada pada master. Jalankan db:seed.`);
  }

  const source = header.book;
  const docTypeId = await reclassDocTypeId();
  const label = `${doc.reclass_no} — ${RECLASS_LABEL}`;
  const sourceDebit = sourceIsDebit(source.raises);
  let fxDifference = 0;

  // Every position the document lowers: the source, and each target whose
  // items it settles. Sorted, so two documents touching the same pair of
  // positions always take their locks in the same order.
  const lowered = new Map<string, { bookId: number; partnerId: number }>();
  lowered.set(`${source.categoryId}:${doc.partner_id}`, {
    bookId: source.categoryId,
    partnerId: doc.partner_id,
  });
  for (const l of lineCheck.lines) {
    if (l.effect === "settle") {
      lowered.set(`${l.targetBook.categoryId}:${l.targetPartnerId}`, {
        bookId: l.targetBook.categoryId,
        partnerId: l.targetPartnerId,
      });
    }
  }
  const locks = [...lowered.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, p]) => p);

  try {
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, [doc.company_id], date);
      for (const p of locks) {
        await lockSubledgerPosition(tx, p.bookId, p.partnerId, doc.currency_id);
      }

      // Every item as it stands under the locks, tracked across lines so an
      // item split between two lines relieves its second part from what the
      // first left — exactly as `recordSubledgerEntry` will.
      const state = new Map<number, ItemState>();
      const read = async (itemId: number): Promise<ItemState> => {
        const known = state.get(itemId);
        if (known) return known;
        const item = await subledgerItem(itemId, tx);
        if (!item || item.status !== "Open") {
          throw new ReclassRefused({
            _form: `Open item ${item?.itemNo ?? ""} sudah selesai sejak dokumen disimpan.`,
          });
        }
        const fresh = {
          itemNo: item.itemNo,
          rate: item.rate,
          note: item.note,
          balance: { foreign: item.remaining, base: item.baseRemaining },
        };
        state.set(itemId, fresh);
        return fresh;
      };
      const release = (s: ItemState, want: number): number => {
        if (cents(want) > cents(s.balance.foreign)) {
          throw new ReclassRefused({
            _form:
              `Open item ${s.itemNo} tinggal ${formatMoney(s.balance.foreign, header.currencyLabel)}, ` +
              `tidak cukup untuk ${formatMoney(want, header.currencyLabel)}.`,
          });
        }
        const relief = relieve(
          s.balance,
          cents(want) === cents(s.balance.foreign) ? s.balance.foreign : want
        );
        s.balance = relief.remaining;
        return relief.base;
      };

      const planned: PlannedLine[] = [];
      for (const [k, l] of doc.lines.entries()) {
        const resolved = lineCheck.lines[k];
        const sources: PlannedSource[] = [];
        for (const s of l.sources) {
          const st = await read(s.sub_ledger_balance_id);
          const amount = s.amount.toNumber();
          sources.push({
            rowId: s.id,
            itemId: s.sub_ledger_balance_id,
            itemNo: st.itemNo,
            note: st.note,
            amount,
            rate: st.rate,
            releasedBase: release(st, amount),
          });
        }
        const settled: { rowId: number; itemId: number; itemNo: string; amount: number; rate: number; base: number }[] = [];
        if (resolved.effect === "settle") {
          for (const t of l.targets) {
            const st = await read(t.sub_ledger_balance_id);
            const amount = t.amount.toNumber();
            settled.push({
              rowId: t.id,
              itemId: t.sub_ledger_balance_id,
              itemNo: st.itemNo,
              amount,
              rate: st.rate,
              base: release(st, amount),
            });
          }
        }
        const valued = valueReclassLine({
          sourceRaises: source.raises,
          effect: resolved.effect,
          amount: l.amount.toNumber(),
          sourceReleased: sources.map((s) => s.releasedBase),
          targets: settled.map((t) => ({ amount: t.amount, releasedBase: t.base })),
        });
        planned.push({
          rowId: l.id,
          targetBook: resolved.targetBook,
          targetPartnerId: resolved.targetPartnerId,
          targetPartnerLabel: resolved.targetPartnerLabel,
          targetAccountId: targetAccounts[k],
          effect: resolved.effect,
          description: resolved.description,
          releasedBase: valued.releasedBase,
          fxTotal: valued.fxTotal,
          sources,
          targets: settled.map((t, i) => ({
            rowId: t.rowId,
            itemId: t.itemId,
            itemNo: t.itemNo,
            amount: t.amount,
            rate: t.rate,
            settledBase: t.base,
            share: valued.shares[i],
            fx: valued.fx[i],
          })),
        });
      }

      fxDifference = roundBase(planned.reduce((t, l) => t + l.fxTotal, 0));
      const anyFx = planned.some((l) => l.targets.some((t) => t.fx !== 0));

      // A difference has to land somewhere named, and is resolved only when
      // one actually arises.
      let fxAccountId: number | null = null;
      if (anyFx) {
        fxAccountId = await systemAccountId(doc.company.is_parent, "fx");
        if (!fxAccountId) {
          throw new ReclassRefused({
            _form:
              "Selisih kurs muncul pada dokumen ini, tetapi Account Selisih Kurs " +
              "belum diatur untuk Company ini. Lengkapi di Accounting › Mapping " +
              "Account System sebelum dokumen diposting.",
          });
        }
      }

      // The journal, line by line: each source item released, then where it
      // went — the items it opened, or the items it settled and each one's
      // own difference. Never netted (§10 rule 107).
      const side = (debit: boolean, amount: number) =>
        debit ? { debit: amount, credit: 0 } : { debit: 0, credit: amount };
      const entries: JournalLineInput[] = [];
      for (const l of planned) {
        const where = `${l.targetBook.name} · ${l.targetPartnerLabel}`;
        for (const s of l.sources) {
          entries.push({
            accountId: sourceAccount.accountId,
            partnerId: doc.partner_id,
            currencyId: doc.currency_id,
            rate: s.rate,
            ...side(sourceDebit, s.amount),
            baseAmount: s.releasedBase,
            description: `${doc.reclass_no} — ${s.itemNo} dipindahkan ke ${where}`,
          });
          if (l.effect === "open") {
            entries.push({
              accountId: l.targetAccountId,
              partnerId: l.targetPartnerId,
              currencyId: doc.currency_id,
              rate: s.rate,
              ...side(!sourceDebit, s.amount),
              baseAmount: s.releasedBase,
              description: `${doc.reclass_no} — dari ${s.itemNo} (${source.name} · ${header.partnerLabel})`,
            });
          }
        }
        for (const t of l.targets) {
          entries.push({
            accountId: l.targetAccountId,
            partnerId: l.targetPartnerId,
            currencyId: doc.currency_id,
            rate: t.rate,
            ...side(!sourceDebit, t.amount),
            baseAmount: t.settledBase,
            description: `${doc.reclass_no} — ${t.itemNo} diselesaikan`,
          });
          if (t.fx !== 0 && fxAccountId) {
            entries.push({
              accountId: fxAccountId,
              currencyId: base.id,
              rate: 1,
              ...side(t.fx < 0, Math.abs(t.fx)),
              description: `Selisih kurs ${t.itemNo} — ${doc.reclass_no}`,
            });
          }
        }
      }

      if (dryRun) throw new ReclassDryRun(entries);

      for (const l of planned) {
        const why = (fallback: string | null) =>
          l.description ?? fallback ?? RECLASS_LABEL;
        for (const s of l.sources) {
          // Released at its own kurs. `baseAmount` is passed so an item that
          // another writer moved since the plan valued it throws rather than
          // posting a figure the journal does not carry.
          await recordSubledgerEntry(tx, {
            book: source,
            partnerId: doc.partner_id,
            currencyId: doc.currency_id,
            date,
            type: "Reclass",
            direction: sourceReleaseDirection(source.raises),
            amount: s.amount,
            rate: s.rate,
            baseAmount: s.releasedBase,
            itemId: s.itemId,
            sourceDocTypeId: docTypeId,
            sourceDocId: doc.id,
            note: `${label} → ${l.targetBook.name} · ${l.targetPartnerLabel}`,
            actorId,
          });

          let openedId: number | null = null;
          if (l.effect === "open") {
            // The item it became: same kurs, same base, so the value is
            // carried rather than recomputed and no difference can arise.
            const opened = await recordSubledgerEntry(tx, {
              book: l.targetBook,
              partnerId: l.targetPartnerId,
              currencyId: doc.currency_id,
              date,
              type: "Reclass",
              direction: targetDirection(source.raises),
              amount: s.amount,
              rate: s.rate,
              baseAmount: s.releasedBase,
              sourceDocTypeId: docTypeId,
              sourceDocId: doc.id,
              note: `${why(s.note)} (${doc.reclass_no} dari ${s.itemNo})`,
              actorId,
            });
            openedId = opened.balance_id;
          }
          await tx.finItemReclassLineSource.update({
            where: { id: s.rowId },
            data: { released_base_amount: s.releasedBase, opened_item_id: openedId, updated_by: actorId },
          });
        }

        for (const t of l.targets) {
          await recordSubledgerEntry(tx, {
            book: l.targetBook,
            partnerId: l.targetPartnerId,
            currencyId: doc.currency_id,
            date,
            type: "Reclass",
            direction: targetDirection(source.raises),
            amount: t.amount,
            rate: t.rate,
            baseAmount: t.settledBase,
            itemId: t.itemId,
            sourceDocTypeId: docTypeId,
            sourceDocId: doc.id,
            note: `${label} ← ${source.name} · ${header.partnerLabel}`,
            actorId,
          });
          await tx.finItemReclassLineTarget.update({
            where: { id: t.rowId },
            data: {
              allocated_base_amount: t.share,
              settlement_base_amount: t.settledBase,
              fx_difference: t.fx,
              updated_by: actorId,
            },
          });
        }

        await tx.finItemReclassLine.update({
          where: { id: l.rowId },
          data: { released_base_amount: l.releasedBase, fx_difference: l.fxTotal, updated_by: actorId },
        });
      }

      // The Journal is written alongside the books, never from them, and
      // throws unless it balances — which takes the whole posting down.
      await postJournal(tx, {
        companyId: doc.company_id,
        accountingDate: new Date(`${date}T00:00:00Z`),
        description: `${label} · ${source.name} · ${header.partnerLabel}`,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        lines: entries,
        actorId,
      });

      await tx.finItemReclass.update({
        where: { id: doc.id },
        data: {
          status: "Posted",
          accounting_date: new Date(`${date}T00:00:00Z`),
          posted_at: new Date(),
          reclass_base_amount: roundBase(planned.reduce((t, l) => t + l.releasedBase, 0)),
          fx_difference: fxDifference,
          updated_by: actorId,
        },
      });
    });
  } catch (error) {
    if (error instanceof ReclassDryRun) return { ok: true, fxDifference, journal: error.lines };
    if (error instanceof ReclassRefused) return { ok: false, errors: error.errors };
    if (error instanceof PeriodShut || error instanceof SubledgerItemUnavailable) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }

  return { ok: true, fxDifference };
}

/** The journal Post would write for this document, or its refusal. Writes nothing. */
export async function previewReclass(
  reclassId: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const result = await applyReclass(reclassId, 0, true);
  if (!result.ok) return result;
  return { ok: true, lines: await describeJournalLines(result.journal ?? []) };
}

