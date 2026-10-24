import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { budgetsByIds, realizeBudgets } from "./budget";
import { rateSource, settlementRefusal } from "./currency";
import { realizationOf } from "./realization";
import { checkTransactionDate, holdPostingPeriod, todayDay } from "./fiscal";
import { postJournal, type JournalLineInput } from "./journal";
import { auditTransaction, cashJournalLine, cashShortfall, counterJournalLines, lockPlanPositions, planPosting, transactingCompany, transactionDocTypeId, writeRealizationLines, type PostingPlan } from "./finance";

// ----------------------------------------------------- funded posting (anak)

/**
 * One Company's side of the intercompany bridge: where it records its claim on
 * the other, and what it owes the other.
 *
 * Accounts only. The position between the two Companies is **journal**, not
 * subject book: a subject book's subject is a Partner (§10 rule 56), and the
 * other Company is not one — inventing a Partner to stand for it would put a
 * fiction in the master just to satisfy a foreign key. The General Ledger and
 * the Trial Balance are where the two sides are read and reconciled.
 */
export type BridgeSide = {
  arAccountId: number;
  apAccountId: number;
};

/**
 * The cash side the induk chooses when it confirms: which of its resources,
 * and — where that resource and the document differ, or the resource is
 * foreign — the layer drawn on or the kurs the bank used. Exactly the three
 * things a direct Realisasi carries on its own header.
 */
export type FundingCashSide = {
  cashBankId: number;
  /** The layer drawn on, where foreign currency leaves a foreign resource. */
  layerId: number | null;
  /** The kurs the bank used, where one is entered; ignored otherwise. */
  rate: number | null;
};

export type FundedPostingInput = {
  transactionId: number;
  cash: FundingCashSide;
  bridge: { induk: BridgeSide; anak: BridgeSide };
  /**
   * What the **provider's** journal records as its cause — the Funding Request.
   * Passed in rather than resolved here: the Funding Request belongs to the
   * module that owns it, and Finance must not name its table.
   */
  providerSource: { docTypeId: number; docId: number };
  /** The request's own number, as a fact rather than a phrase. */
  requestNo: string;
};

export type FundedPostingPlan = {
  transactionId: number;
  indukCompanyId: number;
  anakCompanyId: number;
  cashBankId: number;
  direction: "In" | "Out";
  documentCurrencyLabel: string;
  resourceCurrencyLabel: string;
  /** `YYYY-MM-DD` — the day both Companies' books are written for. */
  date: string;
  currencyId: number;
  transactionNo: string;
  title: string;
  requestNo: string;
  providerSource: { docTypeId: number; docId: number };
  requesterSource: { docTypeId: number; docId: number };
  /** Valued exactly as a direct Realisasi of the same lines would be. */
  posting: PostingPlan;
  /** Cash against the induk's bridge account. */
  indukJournal: JournalLineInput[];
  /** The anak's bridge account where the cash line would be, then every Budget. */
  anakJournal: JournalLineInput[];
  lines: { budgetId: number; amount: number }[];
};

export type FundedPostingCheck =
  | { ok: true; plan: FundedPostingPlan }
  | { ok: false; errors: Record<string, string> };

/** The anak's document, read the way both checks below need it. */
async function readFundedDocument(transactionId: number) {
  return prisma.finCashBankTransaction.findUnique({
    where: { id: transactionId },
    include: {
      lines: { include: { items: { orderBy: { sequence_no: "asc" } } } },
      currency: { select: { currency_label: true } },
    },
  });
}

/**
 * The Budgets a funded document realizes, re-read now: another document may
 * have closed one since the request was raised.
 */
async function openBudgetsOf(doc: { lines: { source_doc_id: number }[] }) {
  const budgets = await budgetsByIds(doc.lines.map((l) => l.source_doc_id));
  const byId = new Map(budgets.map((b) => [b.id, b]));
  const stale = doc.lines.filter((l) => byId.get(l.source_doc_id)?.status !== "Open");
  return { byId, stale: stale.length };
}

/**
 * Could this anak document be posted, cash aside? Asked at **Ajukan Dana**, so
 * a request that no confirmation could ever answer — a Budget without a
 * mapping, a line lowering a position with no open item, an item another
 * document has since settled — is refused while the anak can still fix it,
 * rather than frozen in front of the induk.
 *
 * The lines are valued as if the cash cost exactly what the obligation is
 * worth in the document's own figures; what the cash actually costs is the
 * induk's to decide, and is asked again, whole, at confirmation.
 */
export async function checkFundable(
  transactionId: number
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const doc = await readFundedDocument(transactionId);
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  const { byId, stale } = await openBudgetsOf(doc);
  if (stale) {
    return {
      ok: false,
      errors: {
        _form:
          `${stale} Budget pada dokumen ini sudah tidak berstatus Disetujui (Open). ` +
          "Ubah dokumen dan keluarkan baris tersebut.",
      },
    };
  }
  const amounts = doc.lines.map((l) => l.settlement_amount.toNumber());
  const planned = await planPosting(
    { ...doc, cash_bank: null },
    byId,
    {
      induk: false,
      resolveFx: false,
      valuation: {
        rate: 1,
        accountRate: 1,
        layerId: null,
        lines: amounts.map((a) => ({ accountAmount: a, base: a })),
      },
    }
  );
  return planned.ok ? { ok: true } : planned;
}

/**
 * Everything the funded posting needs, resolved and checked before anything is
 * written — the atomic intercompany posting of concept doc §30, in two halves.
 *
 * **The anak's document is an ordinary Realisasi that does not name its cash.**
 * Its lines, its Budgets and the open items each line settles were all chosen
 * on its draft, exactly as on the induk's; what the induk adds by confirming
 * is the cash side — a resource, and its layer or kurs. From there the posting
 * is `planPosting`, the same valuation a direct Realisasi runs: one Cash Bank
 * Book entry per Budget, one subject-book entry per Budget or per settled item,
 * one counter line per Budget on its own account and Partner, and one Selisih
 * Kurs line per settled item.
 *
 * The two journals differ only in where the cash line goes. The induk's is
 * cash against its bridge account; the anak's carries its bridge account
 * where the cash line would be, then every Budget. Both bridge lines carry the
 * **cash line's own figures** — the currency the induk actually moved, at the
 * rate it moved at — so the two Companies' positions against each other are
 * equal on both measures, and every FX difference lands in the anak's books,
 * on the anak's Selisih Kurs account: the anak carried the obligation, and the
 * induk's claim is what the cash cost.
 *
 * Split from the write because the Funding Request's own closure belongs to
 * the module that owns it: `prepareFundedPosting` answers "may this be
 * posted, and with what", `writeFundedPosting` does it inside the caller's
 * transaction, and the caller closes its request in the same one. Run alone,
 * this is also the confirmation's preview — the journals it returns are the
 * journals the write posts.
 */
export async function prepareFundedPosting(
  input: FundedPostingInput
): Promise<FundedPostingCheck> {
  const doc = await readFundedDocument(input.transactionId);
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Pending") {
    return {
      ok: false,
      errors: {
        _form:
          "Hanya dokumen berstatus Menunggu Funding yang dapat diposting melalui " +
          "konfirmasi Funding Request.",
      },
    };
  }
  if (!doc.lines.length) {
    return { ok: false, errors: { _form: "Dokumen tidak memuat Budget." } };
  }
  if (doc.cash_bank_id) {
    return {
      ok: false,
      errors: { _form: "Dokumen Company anak tidak boleh menunjuk Cash & Bank." },
    };
  }

  const induk = await transactingCompany();
  if (!induk) {
    return {
      ok: false,
      errors: { _form: "Company induk belum tersedia pada master Company." },
    };
  }
  if (doc.company_id === induk.id) {
    return {
      ok: false,
      errors: { _form: "Dokumen Company induk tidak melalui Funding Request." },
    };
  }

  // One business event, two Companies' books — so the date is checked for
  // both. The day is the anak's accounting date, chosen when it was drafted and
  // possibly earlier than today: the realization happened then, whenever the
  // induk gets round to confirming it.
  const dated = await checkTransactionDate(doc.accounting_date ?? todayDay(), [
    induk.id,
    doc.company_id,
  ]);
  if (!dated.ok) return { ok: false, errors: { _form: dated.message } };

  const cashBank = await prisma.mCashBank.findUnique({
    where: { id: input.cash.cashBankId },
    select: {
      company_id: true,
      status: true,
      currency: { select: { currency_label: true } },
    },
  });
  if (!cashBank) {
    return { ok: false, errors: { cash_bank_id: "Cash & Bank tidak ditemukan." } };
  }
  if (cashBank.company_id !== induk.id) {
    return {
      ok: false,
      errors: { cash_bank_id: `Cash & Bank harus milik Company ${induk.label}.` },
    };
  }
  if (cashBank.status !== "Active") {
    return {
      ok: false,
      errors: { cash_bank_id: "Cash & Bank tersebut non-aktif dan tidak dapat dipakai." },
    };
  }
  const documentCurrency = doc.currency.currency_label;
  const resourceCurrency = cashBank.currency.currency_label;
  const direction = doc.transaction_type as "In" | "Out";
  const source = rateSource(direction, documentCurrency, resourceCurrency);
  if (!source) {
    return {
      ok: false,
      errors: {
        cash_bank_id:
          settlementRefusal(documentCurrency, resourceCurrency) ??
          "Cash & Bank tersebut tidak dapat menyelesaikan currency dokumen ini.",
      },
    };
  }
  // The layer must be this resource's own, and is asked for only where the
  // kurs is read off one — the checks `checkHeader` makes on a direct header.
  if (source === "layer" && input.cash.layerId) {
    const layer = await prisma.cashBankLayer.findUnique({
      where: { id: input.cash.layerId },
      select: { cash_bank_id: true },
    });
    if (!layer || layer.cash_bank_id !== input.cash.cashBankId) {
      return {
        ok: false,
        errors: {
          cash_bank_layer_id: "Layer kurs tersebut bukan milik Cash & Bank yang dipilih.",
        },
      };
    }
  }

  const { byId, stale } = await openBudgetsOf(doc);
  if (stale) {
    return {
      ok: false,
      errors: {
        _form:
          `${stale} Budget pada dokumen ini sudah tidak berstatus Disetujui (Open), ` +
          "kemungkinan sudah ditutup dokumen lain. Funding tidak dapat dikonfirmasi.",
      },
    };
  }

  // Valued as a direct Realisasi of the same lines would be, with the induk's
  // cash side standing in for the header the anak's document does not carry.
  const planned = await planPosting(
    {
      ...doc,
      cash_bank: { currency: { currency_label: resourceCurrency } },
      cash_bank_layer_id: source === "layer" ? input.cash.layerId : null,
      exchange_rate: { toNumber: () => (source === "entered" ? input.cash.rate ?? 0 : 1) },
    },
    byId,
    { induk: false }
  );
  if (!planned.ok) return planned;
  const posting = planned.plan;
  const short = await cashShortfall(input.cash.cashBankId, direction, dated.date, posting);
  if (short) return short;

  const cash = await cashJournalLine(input.cash.cashBankId, doc.transaction_type, posting);
  if (!cash) {
    return { ok: false, errors: { cash_bank_id: "Cash & Bank tidak ditemukan." } };
  }

  const outgoing = direction === "Out";
  const title = realizationOf(doc.transaction_type).title;
  const funding = `${input.requestNo} — ${doc.transaction_no} — ${title}`;

  // The induk: cash against its bridge. Money paid out for the anak is a claim
  // on it; money taken in on the anak's behalf is money held for it.
  const indukBridge: JournalLineInput = {
    ...cash,
    accountId: outgoing ? input.bridge.induk.arAccountId : input.bridge.induk.apAccountId,
    debit: cash.credit,
    credit: cash.debit,
    description: funding,
  };
  const indukCash: JournalLineInput = {
    ...cash,
    description: `${funding} — ${cash.description}`,
  };

  // The anak: its own payable (or receivable) where its cash line would be,
  // then each Budget exactly as a direct Realisasi journals it.
  const anakBridge: JournalLineInput = {
    ...cash,
    accountId: outgoing ? input.bridge.anak.apAccountId : input.bridge.anak.arAccountId,
    description: funding,
  };

  return {
    ok: true,
    plan: {
      transactionId: doc.id,
      indukCompanyId: induk.id,
      anakCompanyId: doc.company_id,
      cashBankId: input.cash.cashBankId,
      direction,
      documentCurrencyLabel: documentCurrency,
      resourceCurrencyLabel: resourceCurrency,
      date: dated.date,
      currencyId: doc.currency_id,
      transactionNo: doc.transaction_no,
      title,
      requestNo: input.requestNo,
      providerSource: input.providerSource,
      requesterSource: { docTypeId: await transactionDocTypeId(), docId: doc.id },
      posting,
      indukJournal: outgoing ? [indukBridge, indukCash] : [indukCash, indukBridge],
      anakJournal: [anakBridge, ...(await counterJournalLines(doc, posting))],
      lines: doc.lines.map((l) => ({
        budgetId: l.source_doc_id,
        amount: l.settlement_amount.toNumber(),
      })),
    },
  };
}

/**
 * Writes both Companies' books, inside the caller's transaction — the same
 * writes a direct Post makes, with the cash on the induk's resource and the
 * journal split in two.
 *
 * `postJournal` throws rather than returns, and so do the layer, the cash book
 * and the subject book when what the plan valued has moved; any of them takes
 * the whole confirmation down, the caller's request closure included.
 * `isPostingRefusal` tells the caller which throws are refusals.
 *
 * Neither journal derives from the other, and neither derives from a book: they
 * are two accounting representations of one business event, each pointing at
 * the document its own Company produced (§31).
 */
export async function writeFundedPosting(
  tx: Prisma.TransactionClient,
  plan: FundedPostingPlan,
  actorId: number
): Promise<{ closed: number }> {
  const { date } = plan;
  const accountingDate = new Date(`${date}T00:00:00Z`);

  // Both Companies' years, held against a close and re-asked under the hold;
  // then every position the anak's lines lower.
  await holdPostingPeriod(tx, [plan.indukCompanyId, plan.anakCompanyId], date);
  await lockPlanPositions(tx, plan.posting, plan.currencyId);

  await writeRealizationLines(tx, plan.posting, {
    cashBankId: plan.cashBankId,
    direction: plan.direction,
    documentCurrencyLabel: plan.documentCurrencyLabel,
    resourceCurrencyLabel: plan.resourceCurrencyLabel,
    currencyId: plan.currencyId,
    docTypeId: plan.requesterSource.docTypeId,
    docId: plan.requesterSource.docId,
    date,
    actorId,
  });

  const { closed } = await realizeBudgets(tx, plan.lines, actorId);

  // Journal A — the induk's. Its cause is the Funding Request it confirmed.
  await postJournal(tx, {
    companyId: plan.indukCompanyId,
    accountingDate,
    description: `${plan.requestNo} — ${plan.transactionNo} — ${plan.title}`,
    sourceDocTypeId: plan.providerSource.docTypeId,
    sourceDocId: plan.providerSource.docId,
    lines: plan.indukJournal,
    actorId,
  });

  // Journal B — the anak's. Its cause is its own realization, which is an
  // ordinary Realisasi that happened to be funded (§10 rule 60).
  await postJournal(tx, {
    companyId: plan.anakCompanyId,
    accountingDate,
    description: `${plan.transactionNo} — ${plan.title}`,
    sourceDocTypeId: plan.requesterSource.docTypeId,
    sourceDocId: plan.requesterSource.docId,
    lines: plan.anakJournal,
    actorId,
  });

  await tx.finCashBankTransaction.update({
    where: { id: plan.transactionId },
    data: {
      status: "Posted",
      accounting_date: accountingDate,
      posted_at: new Date(),
      exchange_rate: plan.posting.rate,
      transaction_base_amount: plan.posting.base,
      updated_by: actorId,
    },
  });
  // Posted, but by the induk confirming rather than by this document's own Post
  // button — the history says which, because for the anak those are different
  // events with different hands on them.
  await auditTransaction(tx, plan.transactionId, "post_funded", actorId);

  return { closed };
}

