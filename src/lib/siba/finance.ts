import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { sumByCurrency, type MoneyTotal } from "@/lib/format";
import { budgetsByIds, openBudgetsFor, openBudgetsMatching, realizeBudgets } from "./budget";
import { InsufficientFunds, cashBankShortfall, recordCashBankEntry } from "./cash-bank";
import { LayerNotAvailable, drawFromLayer, openLayer } from "./cash-bank-layers";
import { createsLayer, maySettle } from "./currency";
import { realizationOf } from "./realization";
import { nextDocumentNumber } from "./document-number";
import { PeriodShut, checkTransactionDate, holdPostingPeriod, todayDay, type TransactionDateCheck } from "./fiscal";
import { describeJournalLines, postJournal, type JournalPreviewLine } from "./journal";
import { type SubledgerDef, subledgerForCategory, subledgerMovement } from "./subledger-catalogue";
import { loadSubledgers } from "./subledger-data";
import { SubledgerItemUnavailable, lockSubledgerPosition, openSubledgerItems, recordSubledgerEntry } from "./subledger";

import { itemOption, toRow, budgetDocTypeId, transactionDocTypeId, type OpenItemOption, type TransactionRow } from "./finance-rows";
import { transactingCompany } from "./finance-options";
import { type PostingResult, type PostingPlan, planPosting, journalEntries } from "./finance-plan";

/**
 * Finance reads and the rules a Realisasi Budget is held to.
 *
 * Finance is the execution layer (concept doc §2.2, §9): Budget plans, Finance
 * executes. A document's **header** — direction, Company, Cash & Bank,
 * Currency — is the context that decides which approved Budgets it may
 * realize, and its **lines** are the realization itself. The direction is the
 * menu the document was opened from (Realisasi Penerimaan / Pengeluaran), and
 * nothing else in the header narrows by classification: one document may
 * settle Budgets of every Budget Category and every Partner at once. Each line
 * then carries its own Budget's classification into every book it writes.
 *
 * Nothing here moves money. Draft is inert by design (§2.3): the balance and
 * `realized_amount` move only at Post, which is `app/actions/finance.ts`.
 *
 * Like Budget, this sits outside the entity registry: a document with a
 * lifecycle, a header that filters its own lines, and a child table is exactly
 * what the registry cannot express.
 */


// ------------------------------------------------------------- eligibility

export type EligibleBudget = {
  id: number;
  budget_no: string;
  budget_date: string;
  description: string;
  category_id: number | null;
  partner_id: number | null;
  currency_id: number;
  budget_amount: number;
  realized_amount: number;
  outstanding: number;
  /** Settlement already written by *other* Draft documents — informational. */
  draftAllocated: number;
  /**
   * True when realizing this Budget **lowers** a subject-book position — a
   * Titipan returned, a Hutang paid, a Piutang collected. Such a line must name
   * the open item it settles; a line that raises a position opens one at Post.
   */
  lowers: boolean;
  /** True when realizing this Budget raises a position, opening a new item. */
  opensItem: boolean;
  /**
   * True when the book this line raises only ever accumulates — Investasi,
   * Hasil Investasi. Its items are a record of where the money went or came
   * from, never something a later line settles, so the form does not speak of
   * an open item for it.
   */
  accumulates: boolean;
  /** The open items this line may settle, oldest first. Empty unless `lowers`. */
  items: OpenItemOption[];
};


export type TransactionHeader = {
  /** Fixed by the menu the document was opened from, never typed. */
  transaction_type: "In" | "Out";
  company_id: number | null;
  cash_bank_id: number | null;
  /**
   * The document's own currency, on **both** routes. It used to be read off the
   * Cash & Bank on the self route, which only worked while the two could not
   * differ — a foreign document paid from a rupiah account is the case that
   * separated them.
   */
  currency_id?: number | null;
  /**
   * The kurs, where the user types one: a foreign document converted by the
   * bank, or foreign currency arriving into a foreign resource. Read off the
   * chosen layer instead when money is leaving a foreign resource, and ignored
   * entirely when the document is already base currency.
   */
  exchange_rate?: number | null;
  /**
   * The rate layer this payment draws on. One transaction, one bank, one kurs —
   * so the document is capped at what this layer still holds.
   */
  cash_bank_layer_id?: number | null;
};

/**
 * How a Company's documents reach actual money.
 *
 * `self` — the Company has Cash & Bank resources of its own and posts
 * directly. `treasury` — it has none, so its document raises a Funding
 * Request and the induk's confirmation posts it (concept doc §26).
 *
 * Keyed on `is_parent` rather than on a label or a setting: which Company
 * holds the treasury is structural, not configuration (CLAUDE.md §12).
 */
export type FundingRoute = "self" | "treasury";

export async function fundingRoute(
  companyId: number
): Promise<FundingRoute | null> {
  const company = await prisma.sysCompany.findUnique({
    where: { id: companyId },
    select: { is_parent: true },
  });
  if (!company) return null;
  return company.is_parent ? "self" : "treasury";
}

/**
 * May this document be dated this day?
 *
 * The date rule is the fiscal calendar's (`checkTransactionDate`); what this
 * adds is **which Companies** it is asked of. A direct document writes one
 * Company's books. A funded one writes both — the induk's cash and journal and
 * the anak's own — so a day either of them has closed cannot be written.
 */
export async function checkDocumentDate(
  raw: string | Date | null | undefined,
  companyId: number,
  route: FundingRoute
): Promise<TransactionDateCheck> {
  const companies = [companyId];
  if (route === "treasury") {
    const induk = await transactingCompany();
    if (induk) companies.push(induk.id);
  }
  return checkTransactionDate(raw, companies);
}

/**
 * The currency a document is denominated in, and the route it will take.
 *
 * One resolver for both the eligibility query and the header check, so the
 * picker and the enforcement can never disagree about which Budgets a header
 * could settle.
 */
async function headerContext(header: TransactionHeader): Promise<
  | {
      ok: true;
      route: FundingRoute;
      currencyId: number;
      cashBankId: number | null;
    }
  | { ok: false }
> {
  if (!header.company_id) return { ok: false };
  const route = await fundingRoute(header.company_id);
  if (!route) return { ok: false };

  // The document's currency is the document's own on both routes. It used to
  // be read off the Cash & Bank, which only worked while the two could not
  // differ — a foreign document paid from a rupiah account is the case that
  // separated them.
  const currencyId = header.currency_id ?? 0;
  if (!currencyId) return { ok: false };

  if (route === "treasury") {
    if (header.cash_bank_id) return { ok: false };
    return { ok: true, route, currencyId, cashBankId: null };
  }

  if (!header.cash_bank_id) return { ok: false };
  const cashBank = await prisma.mCashBank.findUnique({
    where: { id: header.cash_bank_id },
    select: {
      company_id: true,
      currency: { select: { currency_label: true } },
    },
  });
  if (!cashBank || cashBank.company_id !== header.company_id) {
    return { ok: false };
  }

  // A resource that cannot settle this currency admits no Budgets at all,
  // rather than admitting the resource's own. `checkHeader` refuses the pairing
  // by name; this simply offers nothing.
  const currency = await prisma.refCurrency.findUnique({
    where: { id: currencyId },
    select: { currency_label: true },
  });
  if (
    !currency ||
    !maySettle(currency.currency_label, cashBank.currency.currency_label)
  ) {
    return { ok: false };
  }

  return { ok: true, route, currencyId, cashBankId: header.cash_bank_id };
}

/**
 * The Budgets one header may realize.
 *
 * A Budget is eligible when it is **Open** (approved, so it carries a
 * classification), belongs to the same Company, points the way the menu does,
 * is denominated in the document's own currency, and still has something
 * outstanding. Budget Category and Partner are **not** criteria: a realization
 * may settle plans of every category and every Partner in one document, and
 * each line carries its own Budget's classification into the books.
 *
 * Budget Date is deliberately *not* a filter: §9 says the month is a reporting
 * dimension (early or late realization), never a gate.
 *
 * Currency is the **document's**, not the resource's. A USD document settles
 * USD plans, whether it is paid from a USD account or from a rupiah one.
 */
export async function eligibleBudgets(
  header: TransactionHeader,
  options: { excludeTransactionId?: number } = {}
): Promise<EligibleBudget[]> {
  if (!header.company_id) return [];
  if (header.transaction_type !== "In" && header.transaction_type !== "Out") {
    return [];
  }

  const context = await headerContext(header);
  if (!context.ok) return [];

  const budgets = await openBudgetsMatching({
    companyId: header.company_id,
    budgetType: header.transaction_type,
    currencyId: context.currencyId,
  });

  const outstanding = budgets
    .map((b) => ({ row: b, left: b.budget_amount - b.realized_amount }))
    .filter((x) => x.left > 0);
  if (!outstanding.length) return [];

  const draftAllocated = await draftAllocations(
    outstanding.map((x) => x.row.id),
    options.excludeTransactionId ?? null
  );

  // Which lines lower a subject-book position, and the open items each may
  // settle. Asked of the book's own direction, so a Titipan returned and a
  // Piutang collected both read as lowering whatever the cash direction is.
  const books = await loadSubledgers();
  const lowering = new Map<number, number>();
  const opening = new Set<number>();
  const accumulating = new Set<number>();
  for (const { row } of outstanding) {
    const effect = bookEffect(books, row, header.transaction_type);
    if (effect?.lowers) lowering.set(row.id, effect.bookId);
    else if (effect) {
      opening.add(row.id);
      if (effect.accumulates) accumulating.add(row.id);
    }
  }
  const openItems = await openSubledgerItems(
    outstanding
      .filter(({ row }) => lowering.has(row.id))
      .map(({ row }) => ({
        bookId: lowering.get(row.id)!,
        partnerId: row.partner_id!,
        currencyId: context.currencyId,
      }))
  );

  return outstanding.map(({ row, left }) => ({
    lowers: lowering.has(row.id),
    opensItem: opening.has(row.id),
    accumulates: accumulating.has(row.id),
    items: lowering.has(row.id)
      ? openItems
          .filter(
            (i) =>
              i.bookId === lowering.get(row.id) &&
              i.partnerId === row.partner_id &&
              i.currencyId === context.currencyId
          )
          .map(itemOption)
      : [],
    id: row.id,
    budget_no: row.budget_no,
    budget_date: row.budget_date,
    description: row.description,
    category_id: row.category_id,
    partner_id: row.partner_id,
    currency_id: row.currency_id,
    budget_amount: row.budget_amount,
    realized_amount: row.realized_amount,
    outstanding: left,
    draftAllocated: draftAllocated.get(row.id) ?? 0,
  }));
}

/** What realizing a Budget does to its subject book, or null where it keeps none. */
function bookEffect(
  books: SubledgerDef[],
  row: { category_id: number | null; partner_id: number | null },
  direction: "In" | "Out"
): { bookId: number; lowers: boolean; accumulates: boolean } | null {
  const book = subledgerForCategory(books, row.category_id);
  if (!book || row.partner_id == null) return null;
  return {
    bookId: book.categoryId,
    lowers: subledgerMovement(book, direction, 1) < 0,
    accumulates: book.nature === "cumulative",
  };
}

/** An Open Budget still to be realized, as the Realisasi register's tile states it. */
export type ReadyBudget = {
  id: number;
  budget_no: string;
  budget_date: string;
  description: string;
  company_id: number;
  category_id: number | null;
  partner_id: number | null;
  currency_id: number;
  outstanding: number;
  /** Realizing it lowers a position, so a line must name an open item. */
  lowers: boolean;
  /** Open items of its Partner, book and currency — what a lowering line can settle. */
  openItems: number;
  openItemsRemaining: number;
};

/**
 * Every Open Budget one Realisasi menu can still realize, across the reader's
 * Companies. A lowering Budget whose Partner holds no open item cannot be
 * posted yet (§10 rule 105), which is why the items are counted here.
 */
export async function readyToRealize(
  companyIds: number[],
  direction: "In" | "Out"
): Promise<ReadyBudget[]> {
  const rows = (await openBudgetsFor(companyIds, direction)).filter(
    (b) => b.budget_amount - b.realized_amount > 0
  );
  if (!rows.length) return [];

  const books = await loadSubledgers();
  const lowering = new Map<number, number>();
  for (const row of rows) {
    const effect = bookEffect(books, row, direction);
    if (effect?.lowers) lowering.set(row.id, effect.bookId);
  }
  const items = await openSubledgerItems(
    rows
      .filter((r) => lowering.has(r.id))
      .map((r) => ({
        bookId: lowering.get(r.id)!,
        partnerId: r.partner_id!,
        currencyId: r.currency_id,
      }))
  );

  return rows.map((r) => {
    const own = lowering.has(r.id)
      ? items.filter(
          (i) =>
            i.bookId === lowering.get(r.id) &&
            i.partnerId === r.partner_id &&
            i.currencyId === r.currency_id
        )
      : [];
    return {
      id: r.id,
      budget_no: r.budget_no,
      budget_date: r.budget_date,
      description: r.description,
      company_id: r.company_id,
      category_id: r.category_id,
      partner_id: r.partner_id,
      currency_id: r.currency_id,
      outstanding: r.budget_amount - r.realized_amount,
      lowers: lowering.has(r.id),
      openItems: own.length,
      openItemsRemaining: own.reduce((t, i) => t + i.remaining, 0),
    };
  });
}

/**
 * How much of each Budget other Draft documents have already written down.
 *
 * Reported, never subtracted. A Draft has moved nothing (§2.3), so reserving
 * outstanding against it would make a plan look spent because somebody left a
 * document open. Showing the figure lets the user decide.
 */
async function draftAllocations(
  budgetIds: number[],
  excludeTransactionId: number | null
): Promise<Map<number, number>> {
  if (!budgetIds.length) return new Map();
  const docType = await budgetDocTypeId();
  const lines = await prisma.finCashBankTransactionLine.findMany({
    where: {
      source_doc_type_id: docType,
      source_doc_id: { in: budgetIds },
      transaction: {
        status: "Draft",
        ...(excludeTransactionId ? { id: { not: excludeTransactionId } } : {}),
      },
    },
    select: { source_doc_id: true, settlement_amount: true },
  });

  const out = new Map<number, number>();
  for (const l of lines) {
    out.set(
      l.source_doc_id,
      (out.get(l.source_doc_id) ?? 0) + l.settlement_amount.toNumber()
    );
  }
  return out;
}


/**
 * Post: the actual boundary (concept doc §2.3).
 *
 * One database transaction — either the money moved and every book that must
 * know about it does, or nothing happened at all:
 *
 *   1. the **Cash Bank Book** gets one entry **per Budget line**, each reading
 *      its Budget's own description, and its materialised balance moves with
 *      every one (`recordCashBankEntry`);
 *   2. the **subject book** each line's Budget Category keeps, where it keeps
 *      one — again one entry per line, never summed per Partner;
 *   3. the **Journal**, balanced in base currency (`postJournal`);
 *   4. the rate **layer** it draws on, or the one it opens;
 *   5. every Budget on the document has its `realized_amount` raised, and a
 *      Budget that reaches its planned amount closes itself (§6.5);
 *   6. the document acquires its `posted_at` and becomes Posted.
 *
 * The books are written **straight from the document**, never derived from a
 * journal line: operational books are independent historical stores, and only
 * the General Ledger derives from journals (§2.5, §11.7). That is why the three
 * writers are called side by side here and none of them reads another.
 *
 * Budgets are re-read *now* rather than trusted from when the document was
 * drafted: another document may have closed one in the meantime, and posting
 * against a plan that is no longer Open would record a realization nothing
 * authorised. The same is true of the layer — `drawFromLayer` throws rather
 * than returning, so a layer spent since the document was drafted takes the
 * whole posting down instead of being overdrawn.
 *
 * Lives here rather than inside the Server Action so the rule is testable: the
 * action resolves a caller and then calls this, and the test suite calls the
 * same function.
 */
export async function applyPosting(
  transactionId: number,
  actorId: number,
  /**
   * Stop once the journal is known and write nothing — what the Post
   * confirmation shows. Every check and every valuation above that point runs
   * exactly as it does for a real Post, so the preview is the journal.
   */
  dryRun = false
): Promise<PostingResult> {
  const doc = await prisma.finCashBankTransaction.findUnique({
    where: { id: transactionId },
    include: {
      lines: { include: { items: { orderBy: { sequence_no: "asc" } } } },
      currency: { select: { currency_label: true } },
      cash_bank: { select: { currency: { select: { currency_label: true } } } },
    },
  });
  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Draft") {
    return {
      ok: false,
      errors: { _form: "Hanya dokumen berstatus Draft yang dapat diposting." },
    };
  }
  // The funded route never comes through here. An anak document has no
  // resource of its own to move, and its posting is the induk's confirmation
  // of a Funding Request — which posts both Companies at once.
  if ((await fundingRoute(doc.company_id)) !== "self") {
    return {
      ok: false,
      errors: {
        _form:
          "Dokumen Company anak tidak diposting langsung. Ajukan dana ke induk, " +
          "dan dokumen terposting saat induk mengonfirmasi Funding Request.",
      },
    };
  }
  if (!doc.lines.length) {
    return {
      ok: false,
      errors: {
        _form: "Tambahkan minimal satu Budget sebelum dokumen diposting.",
      },
    };
  }
  if (!doc.cash_bank_id) {
    return { ok: false, errors: { _form: "Dokumen belum menunjuk Cash & Bank." } };
  }

  const budgets = await budgetsByIds(doc.lines.map((l) => l.source_doc_id));
  const byId = new Map(budgets.map((b) => [b.id, b]));

  const stale = doc.lines.filter(
    (l) => byId.get(l.source_doc_id)?.status !== "Open"
  );
  if (stale.length) {
    return {
      ok: false,
      errors: {
        _form:
          `${stale.length} Budget pada dokumen ini sudah tidak berstatus Disetujui (Open), ` +
          "kemungkinan sudah ditutup dokumen lain. Ubah dokumen dan keluarkan baris tersebut.",
      },
    };
  }

  // The day this document belongs to in the books — chosen on the draft, and
  // possibly earlier than today. Every book entry, the layer it opens and the
  // journal are dated it; `posted_at` keeps the moment it was actually
  // posted. A draft saved before drafts carried a date posts as today.
  //
  // Re-checked here rather than trusted from the save: a year can close in
  // between. Asked before anything is resolved, so a refusal costs nothing and
  // reads as what it is — not a fault, but a period that is shut.
  const dated = await checkTransactionDate(
    doc.accounting_date ?? todayDay(),
    [doc.company_id]
  );
  if (!dated.ok) return { ok: false, errors: { _form: dated.message } };
  const date = dated.date;

  const docTypeId = await transactionDocTypeId();
  let closed = 0;

  // Everything is resolved and checked before the transaction opens, so a
  // document that cannot be valued, cannot be journalled, or has chosen a layer
  // another document has since emptied refuses rather than aborting halfway: a
  // posting that moves the book without writing accounting is exactly the split
  // §12 forbids.
  const planned = await planPosting(doc, byId, { induk: true });
  if (!planned.ok) return { ok: false, errors: planned.errors };
  const plan = planned.plan;

  const entries = await journalEntries(doc, plan);
  if (!entries.ok) return { ok: false, errors: entries.errors };
  const short = await cashShortfall(doc.cash_bank_id, doc.transaction_type, date, plan);
  if (short) return short;
  if (dryRun) return { ok: true, closed: 0, journal: entries.lines };

  try {
  await prisma.$transaction(async (tx) => {
    // The year this is dated in, held against a close for the rest of the
    // transaction and re-asked under the hold: the check above was before it.
    await holdPostingPeriod(tx, [doc.company_id], date);

    await lockPlanPositions(tx, plan, doc.currency_id);
    await writeRealizationLines(tx, plan, {
      cashBankId: doc.cash_bank_id!,
      direction: doc.transaction_type as "In" | "Out",
      documentCurrencyLabel: doc.currency.currency_label,
      resourceCurrencyLabel: doc.cash_bank?.currency.currency_label ?? "",
      currencyId: doc.currency_id,
      docTypeId,
      docId: doc.id,
      date,
      actorId,
    });

    // Realization is Budget's to write, not Finance's — same transaction, but
    // `bud_budget` is only ever touched by the module that owns it. Closing
    // follows from the figures and is reported back for the caller's message.
    ({ closed } = await realizeBudgets(
      tx,
      doc.lines.map((line) => ({
        budgetId: line.source_doc_id,
        amount: line.settlement_amount.toNumber(),
      })),
      actorId
    ));

    // The Journal is written *alongside* the Cash Bank Book, never from it:
    // an operational book is an independent historical store and only the
    // General Ledger derives from journal lines (concept doc §2.5, §2.6).
    // `postJournal` throws unless the two sides sum equal, and a throw in here
    // takes the whole posting down — which is the guarantee.
    await postJournal(tx, {
      companyId: doc.company_id,
      accountingDate: new Date(`${date}T00:00:00Z`),
      description: `${doc.transaction_no} — ${realizationOf(doc.transaction_type).title}`,
      sourceDocTypeId: docTypeId,
      sourceDocId: doc.id,
      lines: entries.lines,
      actorId,
    });

    await tx.finCashBankTransaction.update({
      where: { id: transactionId },
      data: {
        status: "Posted",
        accounting_date: new Date(`${date}T00:00:00Z`),
        posted_at: new Date(),
        exchange_rate: plan.rate,
        transaction_base_amount: plan.base,
        updated_by: actorId,
      },
    });
  });
  } catch (error) {
    if (isPostingRefusal(error)) {
      return { ok: false, errors: { _form: error.message } };
    }
    throw error;
  }

  return { ok: true, closed };
}

/**
 * Every position a plan lowers, held for the rest of the transaction so two
 * documents settling one open item cannot both pass against the same remaining
 * figure. Taken after the period lock and in one fixed order, so nothing waits
 * in a circle. Both routes take it.
 */
export async function lockPlanPositions(
  tx: Prisma.TransactionClient,
  plan: PostingPlan,
  currencyId: number
): Promise<void> {
  const held = [
    ...new Set(
      plan.lines
        .filter((l) => l.items.length && l.book)
        .map((l) => `${l.book!.categoryId}|${l.partnerId}`)
    ),
  ].sort();
  for (const k of held) {
    const [bookId, partnerId] = k.split("|");
    await lockSubledgerPosition(tx, Number(bookId), Number(partnerId), currencyId);
  }
}

/**
 * What one realization writes into the books, per Budget line — shared by
 * the direct route and the funded one, which differ only in whose resource
 * the cash moves through and whose journal carries it.
 *
 * Per line: the layer drawn on (or one opened), one Cash Bank Book entry, and
 * the subject-book entries its category keeps — opening an item or settling
 * the ones the user chose. Then each line's and each item's base figures on
 * the document. The journal and the realization are the caller's.
 */
export async function writeRealizationLines(
  tx: Prisma.TransactionClient,
  plan: PostingPlan,
  ctx: {
    /** The resource the money moves through — the induk's on the funded route. */
    cashBankId: number;
    direction: "In" | "Out";
    documentCurrencyLabel: string;
    resourceCurrencyLabel: string;
    /** The document's currency, which the subject books are kept in. */
    currencyId: number;
    docTypeId: number;
    docId: number;
    date: string;
    actorId: number;
  }
): Promise<void> {
  const direction = ctx.direction;
  const opensLayer = createsLayer(
    direction,
    ctx.documentCurrencyLabel,
    ctx.resourceCurrencyLabel
  );

  for (const line of plan.lines) {
    // The layer the payment drew on, taken down by exactly what this line
    // took from it. Drawn before the line's book entry so an exhausted layer
    // refuses before anything else is written — `drawFromLayer` throws, and
    // a throw in here takes the posting down. A layer another document has
    // moved since the plan was made would value the line differently from
    // the journal already composed, so that refuses too.
    if (plan.layerId) {
      const drawn = await drawFromLayer(tx, {
        layerId: plan.layerId,
        cashBankId: ctx.cashBankId,
        foreign: line.accountAmount,
        date: ctx.date,
        actorId: ctx.actorId,
      });
      if (drawn.base !== line.transactionBase) {
        throw new LayerNotAvailable(
          "Layer kurs berubah sejak dokumen divaluasi. Ulangi Post."
        );
      }
    }

    // One Cash Bank Book entry per Budget, reading that Budget's own words,
    // so the book traces back to each plan it paid rather than to a total.
    await recordCashBankEntry(tx, {
      cashBankId: ctx.cashBankId,
      date: ctx.date,
      type: "Transaction",
      direction,
      // In the **resource's** own currency, which is the line's amount
      // unless the bank did the converting.
      amount: line.accountAmount,
      rate: plan.accountRate,
      baseAmount: line.transactionBase,
      sourceDocTypeId: ctx.docTypeId,
      sourceDocId: ctx.docId,
      note: line.description,
      actorId: ctx.actorId,
    });

    // Money arriving into a foreign resource is currency acquired, and each
    // line acquires a layer of its own at the rate it was bought in at —
    // one per book entry, never merged with an existing one.
    if (opensLayer) {
      await openLayer(tx, {
        cashBankId: ctx.cashBankId,
        date: ctx.date,
        rate: plan.accountRate,
        foreign: line.accountAmount,
        baseAmount: line.transactionBase,
        sourceDocTypeId: ctx.docTypeId,
        sourceDocId: ctx.docId,
        note: line.description,
        actorId: ctx.actorId,
      });
    }

    // The subject book this line's Budget Category keeps, where it keeps
    // one — one entry per Budget, never summed per Partner, so a Partner
    // settling six plans shows six movements. Written straight from the
    // document like the Cash Bank Book, never derived from the journal.
    //
    // A line lowering a position writes one entry per item it settles —
    // an entry names exactly one item — each at that item's own rate and
    // reading the Budget's description, so the book still traces every
    // movement to the plan it settled. A raising line writes one entry,
    // which opens its item.
    if (line.book) {
      const entries = line.items.length
        ? line.items.map((it) => ({
            amount: it.amount,
            baseAmount: it.settlementBase,
            itemId: it.itemId as number | null,
          }))
        : [{ amount: line.amount, baseAmount: line.settlementBase, itemId: null }];
      for (const e of entries) {
        const written = await recordSubledgerEntry(tx, {
          book: line.book,
          partnerId: line.partnerId!,
          currencyId: ctx.currencyId,
          date: ctx.date,
          type: "Transaction",
          direction,
          amount: e.amount,
          // **This book's own rate**, not the cash side's. A relief releases
          // what the item was carried at; the gap to what the cash cost is
          // the item's FX difference, and it lives in the journal.
          rate: e.amount ? e.baseAmount / e.amount : plan.rate,
          baseAmount: e.baseAmount,
          // Null raises a new open item; an id settles the one chosen, and
          // the book refuses if it has moved since the plan valued it.
          itemId: e.itemId,
          sourceDocTypeId: ctx.docTypeId,
          sourceDocId: ctx.docId,
          note: line.description,
          actorId: ctx.actorId,
        });
        // The item a raise opened, kept on the line so the Budget can follow
        // its money on — into a reclassification, for one.
        if (!e.itemId) {
          await tx.finCashBankTransactionLine.update({
            where: { id: line.lineId },
            data: { opened_item_id: written.balance_id },
          });
        }
      }
    }
  }

  // What the document was worth, and what each line's share of that was. The
  // draft stored the same figures when it was saved; written again here
  // because Post re-values against the books as they stand now.
  await writeLineValuation(tx, plan, ctx.actorId);
}

/**
 * Each line's and each item's base figures, as a plan valued them — written
 * when a draft is saved, so the document states what Post will write, and
 * again by Post, which re-values first.
 */
async function writeLineValuation(
  tx: Prisma.TransactionClient,
  plan: PostingPlan,
  actorId: number
): Promise<void> {
  for (const share of plan.lines) {
    await tx.finCashBankTransactionLine.update({
      where: { id: share.lineId },
      data: {
        settlement_base_amount: share.settlementBase,
        settlement_exchange_rate: share.amount
          ? share.settlementBase / share.amount
          : plan.rate,
        transaction_base_amount: share.transactionBase,
        fx_difference: share.fxDifference,
        updated_by: actorId,
      },
    });
    for (const it of share.items) {
      await tx.finCashBankTransactionLineItem.update({
        where: { id: it.allocationId },
        data: {
          settlement_base_amount: it.settlementBase,
          transaction_base_amount: it.transactionBase,
          fx_difference: it.fxDifference,
          updated_by: actorId,
        },
      });
    }
  }
}

/** A draft that could not be valued — rolls its save back. */
export class DraftNotValued extends Error {
  constructor(readonly errors: Record<string, string>) {
    super(Object.values(errors)[0] ?? "Dokumen tidak dapat divaluasi.");
  }
}

/**
 * Values a direct-route draft as it is saved, inside the save's transaction:
 * the same `planPosting` Post runs, so every line and item states the base,
 * the kurs and the FX difference Post would write if it ran now. Post still
 * re-values — a layer or an item may move while the draft waits — and writes
 * the figures again.
 *
 * An anak draft names no cash, so the cash side is the induk's choice at
 * confirmation, in every currency alike: only the settlement side is stated —
 * each settled item at its own kurs. The cash side — the header kurs and base,
 * each line's and item's transaction base and FX difference, and the base of a
 * line that opens an item, which the cash originates — stays unwritten (nil,
 * kurs empty) until the confirmation values the whole document.
 */
export async function valueDraft(
  tx: Prisma.TransactionClient,
  transactionId: number,
  actorId: number
): Promise<void> {
  const doc = await tx.finCashBankTransaction.findUnique({
    where: { id: transactionId },
    include: {
      lines: { include: { items: { orderBy: { sequence_no: "asc" } } } },
      currency: { select: { currency_label: true } },
      cash_bank: { select: { currency: { select: { currency_label: true } } } },
    },
  });
  if (!doc || !doc.lines.length) return;

  const budgets = await budgetsByIds(doc.lines.map((l) => l.source_doc_id));
  const byId = new Map(budgets.map((b) => [b.id, b]));
  const amounts = doc.lines.map((l) => l.settlement_amount.toNumber());
  const funded = !doc.cash_bank_id;
  const planned = await planPosting(doc, byId, {
    induk: !funded,
    draft: true,
    resolveFx: false,
    // A funded draft has no resource to value against. This only stands in:
    // nothing it produces on the cash side is written below.
    valuation: funded
      ? {
          rate: 1,
          accountRate: 1,
          layerId: null,
          lines: amounts.map((a) => ({ accountAmount: a, base: a })),
        }
      : undefined,
  });
  if (!planned.ok) throw new DraftNotValued(planned.errors);
  const plan = planned.plan;

  if (funded) {
    for (const line of plan.lines) {
      const settles = line.items.length > 0;
      await tx.finCashBankTransactionLine.update({
        where: { id: line.lineId },
        data: {
          settlement_base_amount: settles ? line.settlementBase : 0,
          settlement_exchange_rate:
            settles && line.amount ? line.settlementBase / line.amount : null,
          transaction_base_amount: 0,
          fx_difference: 0,
          updated_by: actorId,
        },
      });
      for (const it of line.items) {
        await tx.finCashBankTransactionLineItem.update({
          where: { id: it.allocationId },
          data: {
            settlement_base_amount: it.settlementBase,
            transaction_base_amount: 0,
            fx_difference: 0,
            updated_by: actorId,
          },
        });
      }
    }
    await tx.finCashBankTransaction.update({
      where: { id: transactionId },
      data: { exchange_rate: 0, transaction_base_amount: 0 },
    });
    return;
  }

  await writeLineValuation(tx, plan, actorId);
  await tx.finCashBankTransaction.update({
    where: { id: transactionId },
    data: { exchange_rate: plan.rate, transaction_base_amount: plan.base },
  });
}

// -------------------------------------------------- status, for the funded route

/**
 * The two status writes the funded route needs, and the only way another module
 * changes a document's status.
 *
 * `fin_cash_bank_transaction` is Finance's table, so Funding never writes it
 * directly (CLAUDE.md §3, the module contract): it calls these inside its own
 * transaction, which is what lets the document's status and the request's
 * status move together or not at all.
 *
 * Neither moves money. `Pending` is exactly as inert as `Draft` — the anak's
 * document waits for the induk's confirmation, and it is that confirmation, not
 * this, that writes the books.
 */
export async function markTransactionPending(
  tx: Prisma.TransactionClient,
  transactionId: number,
  actorId: number
): Promise<void> {
  await tx.finCashBankTransaction.update({
    where: { id: transactionId },
    data: { status: "Pending", updated_by: actorId },
  });
  await auditTransaction(tx, transactionId, "submit", actorId);
}

export async function markTransactionCancelled(
  tx: Prisma.TransactionClient,
  transactionId: number,
  actorId: number
): Promise<void> {
  await tx.finCashBankTransaction.update({
    where: { id: transactionId },
    data: { status: "Cancelled", updated_by: actorId },
  });
  await auditTransaction(tx, transactionId, "cancel", actorId);
}

/**
 * A status write that another module triggers still belongs in the document's
 * own history.
 *
 * It is written here rather than by the caller for the same reason the status
 * is: fin_cash_bank_transaction is Finance's table, and the row has to move in
 * the same transaction as the status it describes — otherwise a rolled-back
 * funding would leave a history entry for something that never happened.
 */
export async function auditTransaction(
  tx: Prisma.TransactionClient,
  transactionId: number,
  event: string,
  actorId: number
): Promise<void> {
  await tx.auditLog.create({
    data: {
      entity_key: "fin_cash_bank_transaction",
      row_id: transactionId,
      action: "UPDATE",
      event,
      by: actorId,
    },
  });
}

/**
 * Documents by id — how another module reads the realizations it points at
 * without naming `fin_cash_bank_transaction` itself.
 */
export async function transactionsByIds(
  ids: number[]
): Promise<TransactionRow[]> {
  if (!ids.length) return [];
  const rows = await prisma.finCashBankTransaction.findMany({
    where: { id: { in: ids } },
    include: { _count: { select: { lines: true } } },
  });
  return rows.map(toRow);
}

// --------------------------------------------------------------- numbering

/**
 * Document numbers for a set of ids — how another module names a transaction
 * it holds a reference to, without reading `fin_cash_bank_transaction` itself.
 */
export async function transactionNumbersByIds(
  ids: number[]
): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.finCashBankTransaction.findMany({
    where: { id: { in: ids } },
    select: { id: true, transaction_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.transaction_no]));
}

/**
 * Next document number in the direction's own series — `RBM-0001` for a
 * Realisasi Penerimaan, `RBK-0001` for a Realisasi Pengeluaran. The format
 * lives in `document-number.ts`, the prefixes in `realization.ts`.
 */
export async function nextTransactionNo(direction: "In" | "Out"): Promise<string> {
  const prefix = realizationOf(direction).prefix;
  return nextDocumentNumber(prefix, async () => {
    const row = await prisma.finCashBankTransaction.findFirst({
      where: { transaction_no: { startsWith: `${prefix}-` } },
      orderBy: { id: "desc" },
      select: { transaction_no: true },
    });
    return row?.transaction_no ?? null;
  });
}

// ---------------------------------------------------- pending commitments

/**
 * A document frozen at `Pending`: the anak has asked for the money and the
 * induk has not yet confirmed. Draft documents are deliberately not here — a
 * draft is a preparation document that may never happen, and its claim on a
 * Budget is released simply by deleting a line, so it commits nothing.
 */
export type PendingDocumentRow = {
  id: number;
  transactionNo: string;
  companyId: number;
  companyLabel: string;
  currencyId: number;
  currencyLabel: string;
  transactionType: "In" | "Out";
  amount: number;
  lineCount: number;
  /** When the document was submitted — `Pending` is written once and frozen. */
  since: string;
};

export type PendingCommitments = {
  count: number;
  totals: MoneyTotal[];
  inTotals: MoneyTotal[];
  outTotals: MoneyTotal[];
  rows: PendingDocumentRow[];
  /**
   * Budget id -> how much of it a pending document has already claimed.
   *
   * This is what stops the dashboard counting the same money twice.
   * `realized_amount` is written at Post, so a Budget behind a pending
   * document still reports its whole outstanding — and that outstanding is
   * simultaneously sitting in this queue, waiting on the induk. The caller
   * subtracts one from the other.
   */
  claims: Map<number, number>;
};

export async function pendingCommitments(
  companyIds: number[]
): Promise<PendingCommitments> {
  const empty: PendingCommitments = {
    count: 0,
    totals: [],
    inTotals: [],
    outTotals: [],
    rows: [],
    claims: new Map(),
  };
  if (!companyIds.length) return empty;

  const docs = await prisma.finCashBankTransaction.findMany({
    where: { status: "Pending", company_id: { in: companyIds } },
    include: {
      company: { select: { company_label: true } },
      currency: { select: { currency_label: true } },
      _count: { select: { lines: true } },
    },
  });
  if (!docs.length) return empty;

  const budgetDocType = await budgetDocTypeId();
  const lines = await prisma.finCashBankTransactionLine.findMany({
    where: {
      transaction_id: { in: docs.map((d) => d.id) },
      source_doc_type_id: budgetDocType,
    },
    select: { source_doc_id: true, settlement_amount: true },
  });

  const claims = new Map<number, number>();
  for (const l of lines) {
    claims.set(
      l.source_doc_id,
      (claims.get(l.source_doc_id) ?? 0) + l.settlement_amount.toNumber()
    );
  }

  const rows: PendingDocumentRow[] = docs.map((t) => ({
    id: t.id,
    transactionNo: t.transaction_no,
    companyId: t.company_id,
    companyLabel: t.company.company_label,
    currencyId: t.currency_id,
    currencyLabel: t.currency.currency_label,
    transactionType: t.transaction_type as "In" | "Out",
    amount: t.transaction_amount.toNumber(),
    lineCount: t._count.lines,
    since: t.updated_at.toISOString(),
  }));

  const money = (r: PendingDocumentRow) => ({
    currencyId: r.currencyId,
    currencyLabel: r.currencyLabel,
    amount: r.amount,
  });

  return {
    count: rows.length,
    totals: sumByCurrency(rows.map(money)),
    inTotals: sumByCurrency(
      rows.filter((r) => r.transactionType === "In").map(money)
    ),
    outTotals: sumByCurrency(
      rows.filter((r) => r.transactionType === "Out").map(money)
    ),
    rows: rows.sort((a, b) => a.since.localeCompare(b.since)),
    claims,
  };
}

/**
 * The journal Post would write for this document, named for a reader — or
 * the refusal Post would give. Writes nothing.
 */
export async function previewPosting(
  transactionId: number
): Promise<
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> }
> {
  const result = await applyPosting(transactionId, 0, true);
  if (!result.ok) return result;
  return { ok: true, lines: await describeJournalLines(result.journal ?? []) };
}

/** Document numbers by id, for a book report to name the document an entry came from. */
export async function documentNumbers(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.finCashBankTransaction.findMany({ where: { id: { in: ids } }, select: { id: true, transaction_no: true } });
  return new Map(rows.map((r) => [r.id, r.transaction_no]));
}

/**
 * Money leaving the resource, refused here when the day it is dated on, or any
 * day since, would leave less than nothing. The dry run stops before the book
 * is written, so without this a preview would pass a Post that then refuses.
 * The lines are entries on one day, so their total is the whole question.
 */
export async function cashShortfall(
  cashBankId: number,
  direction: string,
  date: string,
  plan: { lines: { accountAmount: number }[] }
): Promise<{ ok: false; errors: { _form: string } } | null> {
  if (direction !== "Out") return null;
  const total = plan.lines.reduce((sum, l) => sum + l.accountAmount, 0);
  const short = await cashBankShortfall(cashBankId, date, total);
  return short ? { ok: false, errors: { _form: short.message } } : null;
}

/**
 * Whether a throw out of a posting transaction is a refusal the user can act
 * on — a year closed meanwhile, a layer or an open item moved since the plan
 * valued it, a resource that does not hold enough — rather than a fault. The
 * funded route's caller lives in another module, so it asks here instead of
 * naming every book's error class itself.
 */
export function isPostingRefusal(error: unknown): error is Error {
  return (
    error instanceof PeriodShut ||
    error instanceof LayerNotAvailable ||
    error instanceof SubledgerItemUnavailable ||
    error instanceof InsufficientFunds
  );
}


