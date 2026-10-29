import "server-only";

import { prisma } from "@/lib/prisma";
import { categoryAccounts } from "./category-accounts";
import { layerDateRefusal } from "./cash-bank-layers";
import { BASE_CURRENCY_LABEL, isBaseCurrency, rateSource, settlementRefusal } from "./currency";
import { allocateBase, drawLayer, fxDifference, relieve, roundBase } from "./fx";
import { todayDay } from "./fiscal";
import { type JournalLineInput } from "./journal";
import { type SubledgerDef, subledgerForCategory, subledgerMovement } from "./subledger-catalogue";
import { loadSubledgers } from "./subledger-data";
import { itemLowestFrom, subledgerItem, type SubledgerItem } from "./subledger";
import { systemAccountId } from "./system-account-data";

const day = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The valuation and posting plan of a Realisasi Budget.
 *
 * What each line and each open item it settles is worth, the cash and counter
 * lines of the journal that follows, and every refusal that can be found before
 * anything is written. Planning only: it reads and never writes, so Post, the
 * draft's own valuation, the funded confirmation and the Post preview all run
 * the one calculation and cannot come to different figures.
 */

// ------------------------------------------------------------------ posting

export type PostingResult =
  | { ok: true; closed: number; journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/**
 * What one Budget line is worth on the cash side.
 *
 * A document has a currency; a resource has a currency; they need not be the
 * same, but under the crossing rule one of them is always the base currency
 * when they differ. Three cases, and `rateSource` in `lib/siba/currency.ts` is
 * the one place they are told apart:
 *
 *   * **foreign out of a foreign resource** — the kurs is the chosen layer's,
 *     read rather than typed, and each line's base is what the layer gives up
 *     for that line, drawn one line after the other;
 *   * **foreign through a base-currency resource** — the kurs is the one the
 *     bank actually converted at, typed on the document, applied per line;
 *   * **base on base** — the kurs is `1`.
 *
 * Valued **per line** rather than once and apportioned, because every line
 * writes a Cash Bank Book entry of its own: an entry's base has to be what that
 * line actually cost, not a share of a figure nobody booked.
 */
export type CashLine = {
  /** What moves through the resource, in the resource's own currency. */
  accountAmount: number;
  /** What the movement was worth in base. */
  base: number;
};

export type Valuation = {
  /** Document currency to base. Never 1 unless the document is base currency. */
  rate: number;
  /** The rate the *resource's* own currency was valued at — 1 when it is base. */
  accountRate: number;
  /** The layer drawn on, where one was. */
  layerId: number | null;
  /** One per document line, in line order. */
  lines: CashLine[];
};

export type ValuationCheck =
  | { ok: true; valuation: Valuation }
  | { ok: false; errors: Record<string, string> };

/**
 * Resolves a document's kurs before anything is written.
 *
 * Reads the layer rather than trusting the rate the document carries: a Draft
 * may have chosen a layer that another document has since drawn to nothing, and
 * the rate stored on the draft would then value the payment at a price the bank
 * no longer holds.
 */
async function resolveValuation(doc: {
  transaction_type: string;
  exchange_rate: { toNumber(): number };
  cash_bank_layer_id: number | null;
  accounting_date: Date | null;
  currency: { currency_label: string };
  cash_bank: { currency: { currency_label: string } } | null;
  amounts: number[];
}): Promise<ValuationCheck> {
  const amounts = doc.amounts;
  const total = amounts.reduce((t, a) => t + a, 0);
  const direction = doc.transaction_type as "In" | "Out";
  const documentCurrency = doc.currency.currency_label;
  const resourceCurrency = doc.cash_bank?.currency.currency_label ?? "";

  const source = rateSource(direction, documentCurrency, resourceCurrency);
  if (!source) {
    return {
      ok: false,
      errors: {
        _form:
          settlementRefusal(documentCurrency, resourceCurrency) ??
          "Kombinasi currency dokumen dan Cash & Bank tidak diperbolehkan.",
      },
    };
  }

  const resourceIsBase = isBaseCurrency(resourceCurrency);

  if (source === "identity") {
    return {
      ok: true,
      valuation: {
        rate: 1,
        accountRate: 1,
        layerId: null,
        lines: amounts.map((a) => ({ accountAmount: a, base: a })),
      },
    };
  }

  if (source === "entered") {
    const rate = doc.exchange_rate.toNumber();
    if (!(rate > 0)) {
      return {
        ok: false,
        errors: { exchange_rate: "Kurs wajib diisi untuk dokumen mata uang asing." },
      };
    }
    // The bank converts only when the document and the resource differ, which
    // under the crossing rule means the resource holds rupiah.
    const converts = resourceIsBase && documentCurrency !== resourceCurrency;
    return {
      ok: true,
      valuation: {
        rate,
        // A base-currency resource is unlayered and worth its own face value.
        accountRate: resourceIsBase ? 1 : rate,
        layerId: null,
        lines: amounts.map((a) => {
          const base = roundBase(a * rate);
          return { accountAmount: converts ? base : a, base };
        }),
      },
    };
  }

  // `layer` — money leaving a foreign resource. The kurs is the layer's, and
  // each line's base is what the layer gives up for it, drawn in line order:
  // drawing a layer to nothing releases its remainder exactly, on the last line.
  if (!doc.cash_bank_layer_id) {
    return {
      ok: false,
      errors: {
        cash_bank_layer_id:
          "Pilih layer kurs yang dipakai. Satu transaksi memakai tepat satu layer.",
      },
    };
  }
  const layer = await prisma.cashBankLayer.findUnique({
    where: { id: doc.cash_bank_layer_id },
    select: {
      rate: true,
      foreign_remaining: true,
      base_remaining: true,
      status: true,
      layer_no: true,
      acquisition_date: true,
    },
  });
  if (!layer || layer.status !== "Open") {
    return {
      ok: false,
      errors: {
        cash_bank_layer_id:
          "Layer kurs yang dipilih sudah tidak tersedia. Buka kembali dokumen dan pilih ulang.",
      },
    };
  }
  const tooNew = doc.accounting_date
    ? layerDateRefusal(layer, doc.accounting_date.toISOString().slice(0, 10))
    : null;
  if (tooNew) return { ok: false, errors: { cash_bank_layer_id: tooNew } };
  if (total > layer.foreign_remaining.toNumber()) {
    return {
      ok: false,
      errors: {
        cash_bank_layer_id:
          `Layer ${layer.layer_no} hanya menyisakan ` +
          `${layer.foreign_remaining.toNumber()}, sedangkan dokumen ini bernilai ` +
          `${total}. Satu transaksi memakai tepat satu layer — pecah dokumen ` +
          "atau pilih layer lain.",
      },
    };
  }

  const rate = layer.rate.toNumber();
  let remaining = {
    foreign: layer.foreign_remaining.toNumber(),
    base: layer.base_remaining.toNumber(),
    rate,
  };
  const lines: CashLine[] = [];
  for (const a of amounts) {
    const drawn = drawLayer(remaining, a);
    lines.push({ accountAmount: a, base: drawn.base });
    remaining = drawn.remaining;
  }

  return {
    ok: true,
    valuation: { rate, accountRate: rate, layerId: doc.cash_bank_layer_id, lines },
  };
}

/**
 * The account one Budget line journals against — Company × its Budget Category
 * × its Partner's Partner Category, or no Partner Category where the Budget
 * names no Partner.
 *
 * Resolved **per line**: a realization may settle Budgets of several categories
 * and several Partners, and each lands on its own account.
 */
async function lineAccountIds(
  companyId: number,
  budgets: { id: number; budget_no: string; category_id: number | null; partner_id: number | null }[]
): Promise<
  | { ok: true; accounts: Map<number, number> }
  | { ok: false; errors: Record<string, string> }
> {
  const partnerIds = [
    ...new Set(budgets.map((b) => b.partner_id).filter((p): p is number => p != null)),
  ];
  const categoryIds = [
    ...new Set(budgets.map((b) => b.category_id).filter((c): c is number => c != null)),
  ];
  const [partners, mappings, categories] = await Promise.all([
    prisma.mPartner.findMany({
      where: { id: { in: partnerIds } },
      select: { id: true, category_id: true, category: { select: { category_label: true } } },
    }),
    categoryAccounts({ companyId, categoryIds }),
    prisma.sysBudgetCategory.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, category_label: true },
    }),
  ]);
  const partnerOf = new Map(partners.map((p) => [p.id, p]));
  const categoryLabel = new Map(categories.map((c) => [c.id, c.category_label]));

  const accounts = new Map<number, number>();
  const missing: string[] = [];
  for (const b of budgets) {
    if (b.category_id == null) {
      missing.push(`${b.budget_no} (belum berkategori)`);
      continue;
    }
    const partner = b.partner_id != null ? partnerOf.get(b.partner_id) : null;
    const partnerCategoryId = partner ? partner.category_id : null;
    const mapping = mappings.find(
      (m) =>
        m.budget_category_id === b.category_id &&
        m.partner_category_id === partnerCategoryId
    );
    if (!mapping) {
      const combination = partner
        ? `${categoryLabel.get(b.category_id)} × ${partner.category.category_label}`
        : `${categoryLabel.get(b.category_id)}`;
      missing.push(`${b.budget_no} (${combination})`);
      continue;
    }
    accounts.set(b.id, mapping.account.id);
  }

  if (missing.length) {
    // Approval tolerates a missing account (§10 rule 28) because that gap
    // belongs to Accounting. Posting cannot: without one there is nothing to
    // journal against, and money must not move unaccounted for.
    return {
      ok: false,
      errors: {
        _form:
          `Belum ada Account yang memegang Kategori untuk: ${missing.join(", ")}. ` +
          "Tambahkan Kategori itu pada Account di Chart of Accounts sebelum dokumen diposting.",
      },
    };
  }
  return { ok: true, accounts };
}

export type PostingLine = {
  lineId: number;
  budgetId: number;
  budgetNo: string;
  /** The Budget's own description — what every book entry of this line reads. */
  description: string;
  partnerId: number | null;
  /** In the document's currency. */
  amount: number;
  /** What moved through the resource, in the resource's own currency. */
  accountAmount: number;
  /** What the cash cost for this line, in base. */
  transactionBase: number;
  /** What the obligation released for this line, in base. */
  settlementBase: number;
  /**
   * Signed as a gain. On a line settling items, the sum of theirs — read, not
   * journaled; each item's difference is its own journal line.
   */
  fxDifference: number;
  counterAccountId: number;
  /** The subject book this line writes into, where its category keeps one. */
  book: SubledgerDef | null;
  /** The items a lowering line settles, in the user's order; empty where it raises. */
  items: PostingItem[];
};

/** One open item a line settles, valued. */
export type PostingItem = {
  /** `fin_cash_bank_transaction_line_item.id`. */
  allocationId: number;
  itemId: number;
  itemNo: string;
  /** The kurs the item was raised at — its own, never derived from the relief. */
  rate: number;
  /** In the document's currency. */
  amount: number;
  /** What the item released, at its own kurs. */
  settlementBase: number;
  /** This item's share of what the line's cash cost. */
  transactionBase: number;
  /** Signed as a gain: positive on the credit side, negative on the debit side. */
  fxDifference: number;
};

export type PostingPlan = {
  rate: number;
  accountRate: number;
  layerId: number | null;
  /** Σ of every line's base — what the cash side of the journal carries. */
  base: number;
  fxAccountId: number | null;
  lines: PostingLine[];
};

/**
 * Everything a posting needs to know before it writes anything — per line.
 *
 * Each line is a settlement of its own. The cash gives up what that line cost
 * (the layer's rate, or the rate the bank converted at), and the line's own
 * obligation releases what **the open item it settles** was raised at. Where
 * they disagree the residual is **that line's** FX difference, journaled on its
 * own line — never summed across the document.
 *
 * Where there is nothing on the books to relieve — an expense, a Piutang raised
 * by paying out, a first-ever Hutang — the movement *is* the origin of the
 * value, so the two sides come from the same place and no difference arises.
 *
 * Two lines against the same open item are settled one after the other: the
 * second relieves what the first left, which is what the book will hold when
 * its entry is written.
 */
export async function planPosting(
  doc: {
    id: number;
    transaction_type: string;
    exchange_rate: { toNumber(): number };
    cash_bank_layer_id: number | null;
    company_id: number;
    currency_id: number;
    accounting_date: Date | null;
    currency: { currency_label: string };
    cash_bank: { currency: { currency_label: string } } | null;
    lines: {
      id: number;
      source_doc_id: number;
      settlement_amount: { toNumber(): number };
      items: { id: number; sub_ledger_balance_id: number; amount: { toNumber(): number } }[];
    }[];
  },
  budgets: Map<
    number,
    { id: number; budget_no: string; description: string; category_id: number | null; partner_id: number | null }
  >,
  options: {
    /** Whose Selisih Kurs account a difference lands on. */
    induk: boolean;
    /**
     * A cash side valued already, in place of the document's own. Only the
     * Ajukan Dana check passes one: the anak's request has no cash yet, and
     * what it asks is whether the lines themselves could be posted.
     */
    valuation?: Valuation;
    /** False skips resolving the Selisih Kurs account — the same check. */
    resolveFx?: boolean;
    /**
     * Valuing a Draft as it is saved. A missing mapping is Post's refusal, not
     * the draft's (§10 rule 50): the figures are still computed, and the
     * counter account is left unresolved because no journal is written.
     */
    draft?: boolean;
  }
): Promise<
  { ok: true; plan: PostingPlan } | { ok: false; errors: Record<string, string> }
> {
  const amounts = doc.lines.map((l) => l.settlement_amount.toNumber());
  let valuation: Valuation;
  if (options.valuation) valuation = options.valuation;
  else {
    const resolved = await resolveValuation({ ...doc, amounts });
    if (!resolved.ok) return resolved;
    valuation = resolved.valuation;
  }

  const lineBudgets = doc.lines.map((l) => budgets.get(l.source_doc_id)!);
  const mapped = await lineAccountIds(doc.company_id, lineBudgets);
  if (!mapped.ok && !options.draft) return mapped;
  const accounts = mapped.ok ? mapped.accounts : new Map<number, number>();

  const direction = doc.transaction_type as "In" | "Out";
  const books = await loadSubledgers();

  // The open items this document settles, as they stand now, drawn down line
  // by line — two lines may settle one item, and the second relieves what the
  // first left, which is what the book will hold when its entry is written.
  const items = new Map<number, { foreign: number; base: number }>();
  const lines: PostingLine[] = [];
  for (const [i, line] of doc.lines.entries()) {
    const budget = lineBudgets[i];
    const amount = amounts[i];
    const cash = valuation.lines[i];
    const catalogue = subledgerForCategory(books, budget.category_id);
    const book = catalogue && budget.partner_id != null ? catalogue : null;

    // Raising a position is the origin of its value, so both sides come from
    // the cash and no difference can arise. Lowering one settles the **items
    // the user chose, for the amounts the user chose** — each released at the
    // kurs it was raised at, never an average — and what the line's cash cost
    // is split across them in proportion (`allocateBase`, the last item taking
    // the rounding so the shares add up to what left the bank). Each item's gap
    // is its own FX difference, signed as a gain from the line's direction.
    let settlementBase = cash.base;
    let fx = 0;
    const settled: PostingItem[] = [];
    const cents = (n: number) => Math.round(n * 100);
    if (book && subledgerMovement(book, direction, amount) < 0) {
      if (!line.items.length) {
        return {
          ok: false,
          errors: {
            _form:
              `${budget.budget_no} belum menunjuk open item yang diselesaikan. Ubah ` +
              "dokumen dan pilih open item-nya.",
          },
        };
      }
      const allocated = line.items.map((a) => a.amount.toNumber());
      if (cents(allocated.reduce((t, a) => t + a, 0)) !== cents(amount)) {
        return {
          ok: false,
          errors: {
            _form:
              `Nominal ${budget.budget_no} tidak sama dengan jumlah open item yang ` +
              "diselesaikannya. Ubah dokumen dan periksa nominal per item.",
          },
        };
      }
      const cashShares = allocateBase(allocated, amount, cash.base);
      settlementBase = 0;
      for (const [k, allocation] of line.items.entries()) {
        const share = allocated[k];
        const item: SubledgerItem | null = await subledgerItem(
          allocation.sub_ledger_balance_id
        );
        if (
          !item ||
          item.bookId !== book.categoryId ||
          item.partnerId !== budget.partner_id ||
          item.currencyId !== doc.currency_id
        ) {
          return {
            ok: false,
            errors: {
              _form:
                `${budget.budget_no} menunjuk open item yang bukan milik Partner, ` +
                "buku, dan currency-nya. Ubah dokumen dan pilih ulang.",
            },
          };
        }
        const held = items.get(item.id) ?? {
          foreign: item.remaining,
          base: item.baseRemaining,
        };
        if (item.status !== "Open" || cents(share) > cents(held.foreign)) {
          return {
            ok: false,
            errors: {
              _form:
                `Open item ${item.itemNo} tinggal ${held.foreign}, tidak cukup untuk ` +
                `${budget.budget_no}. Kemungkinan sudah diselesaikan dokumen lain — ` +
                "ubah dokumen dan periksa nominalnya.",
            },
          };
        }
        // What earlier lines of this document took counts against the
        // document's own day as well as against today.
        const lowest = await itemLowestFrom(
          item.id,
          doc.accounting_date ? day(doc.accounting_date) : todayDay()
        );
        if (cents(share) > cents(lowest.balance - (item.remaining - held.foreign))) {
          return {
            ok: false,
            errors: {
              _form:
                `Open item ${item.itemNo} tinggal ${lowest.balance} pada ${lowest.at}, ` +
                `tidak cukup untuk ${budget.budget_no}. Posisi tidak boleh di bawah nol ` +
                "pada hari mana pun — ubah tanggal akuntansi atau nominalnya.",
            },
          };
        }
        const relief = relieve(
          held,
          cents(share) === cents(held.foreign) ? held.foreign : share
        );
        items.set(item.id, relief.remaining);
        const itemFx =
          (direction === "In" ? -1 : 1) *
          fxDifference(relief.base, cashShares[k]).amount;
        settled.push({
          allocationId: allocation.id,
          itemId: item.id,
          itemNo: item.itemNo,
          rate: item.rate,
          amount: share,
          settlementBase: relief.base,
          transactionBase: cashShares[k],
          fxDifference: itemFx,
        });
        settlementBase = roundBase(settlementBase + relief.base);
        fx = roundBase(fx + itemFx);
      }
    }

    lines.push({
      lineId: line.id,
      budgetId: budget.id,
      budgetNo: budget.budget_no,
      description: budget.description,
      partnerId: budget.partner_id,
      amount,
      accountAmount: cash.accountAmount,
      transactionBase: cash.base,
      settlementBase,
      // Signed as a gain, positive on the credit side. The kernel's residual
      // (released − cost) reads that way when money leaves; when it arrives
      // the same residual is a loss — a receivable carried at 15.000 and
      // collected at 13.000 gave up more than the cash brought in — so a
      // receipt turns it over. On a line settling items it is the sum of
      // theirs, for reading; each item's is journaled on its own.
      fxDifference: fx,
      counterAccountId: accounts.get(budget.id) ?? 0,
      book,
      items: settled,
    });
  }

  // An FX difference has to land somewhere named. The account is only looked
  // up when a difference actually arises, so ordinary rupiah work is never
  // blocked by a setting it does not use.
  // Asked of every item, not of the line total: a gain on one item and a loss
  // on another can sum to nil on the line and still be two journal lines.
  let fxAccountId: number | null = null;
  if (
    options.resolveFx !== false &&
    lines.some(
      (l) => l.fxDifference !== 0 || l.items.some((it) => it.fxDifference !== 0)
    )
  ) {
    fxAccountId = await systemAccountId(options.induk, "fx");
    if (!fxAccountId) {
      return {
        ok: false,
        errors: {
          _form:
            "Selisih kurs muncul pada dokumen ini, tetapi Account Selisih Kurs " +
            "belum diatur untuk Company ini. Lengkapi di Accounting › Mapping " +
            "Account System sebelum dokumen diposting.",
        },
      };
    }
  }

  return {
    ok: true,
    plan: {
      rate: valuation.rate,
      accountRate: valuation.accountRate,
      layerId: valuation.layerId,
      base: roundBase(lines.reduce((t, l) => t + l.transactionBase, 0)),
      fxAccountId,
      lines,
    },
  };
}

/**
 * The accounting entries a realization produces.
 *
 * One cash line for the whole document — the money left or reached the
 * resource once — then, for **every Budget line**, its own counter line on the
 * account its classification maps to, carrying its own Partner, and its own FX
 * difference line where that line's two base values disagree. A document
 * realizing six Budgets across three categories is one journal of up to
 * thirteen lines, and each one reads back to the plan it settled.
 *
 * Each line carries its own currency and its own rate: a foreign document paid
 * from a rupiah account produces a rupiah cash line and foreign counter lines
 * in the same journal, and the entry balances in base alone.
 */
export async function journalEntries(
  doc: {
    transaction_no: string;
    cash_bank_id: number | null;
    currency_id: number;
    transaction_type: string;
  },
  plan: PostingPlan
): Promise<
  | { ok: true; lines: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> }
> {
  const cash = await cashJournalLine(doc.cash_bank_id!, doc.transaction_type, plan);
  if (!cash) {
    return { ok: false, errors: { _form: "Cash & Bank dokumen tidak ditemukan." } };
  }
  return {
    ok: true,
    lines: [
      { ...cash, description: `${doc.transaction_no} — ${cash.description}` },
      ...(await counterJournalLines(doc, plan)),
    ],
  };
}

/**
 * The cash side of a realization's journal: one line for the whole document,
 * in the resource's own currency and at its own rate. The funded route writes
 * it into the induk's journal, and the same figures, on the bridge account,
 * into the anak's — which is what makes the two Companies' positions against
 * each other equal on both measures.
 */
export async function cashJournalLine(
  cashBankId: number,
  transactionType: string,
  plan: PostingPlan
): Promise<JournalLineInput | null> {
  const cashBank = await prisma.mCashBank.findUnique({
    where: { id: cashBankId },
    select: { account_id: true, currency_id: true, cash_bank_label: true },
  });
  if (!cashBank) return null;
  const incoming = transactionType === "In";
  const accountAmount = plan.lines.reduce((t, l) => t + l.accountAmount, 0);
  return {
    accountId: cashBank.account_id,
    currencyId: cashBank.currency_id,
    rate: plan.accountRate,
    debit: incoming ? accountAmount : 0,
    credit: incoming ? 0 : accountAmount,
    baseAmount: plan.base,
    description: cashBank.cash_bank_label,
  };
}

/**
 * Per Budget: its counter line on its own mapped account and Partner — one per
 * open item it settles — and its own FX lines where its two base values
 * disagree. The same on both routes —
 * the funded one writes them into the anak's journal.
 */
export async function counterJournalLines(
  doc: { currency_id: number; transaction_type: string },
  plan: PostingPlan
): Promise<JournalLineInput[]> {
  const incoming = doc.transaction_type === "In";
  const baseCurrency = await baseCurrencyId();
  const lines: JournalLineInput[] = [];

  for (const l of plan.lines) {
    // The counter side, in the document's currency and at the rate the
    // obligation was carried at — which is what makes the two differ. A line
    // settling open items writes one per item at that item's own kurs: one
    // line for several would carry their average, a rate nobody dealt at.
    const counters = l.items.length
      ? l.items.map((it) => ({
          amount: it.amount,
          rate: it.rate,
          base: it.settlementBase,
          description: `${l.description} · ${it.itemNo}`,
        }))
      : [
          {
            amount: l.amount,
            rate: l.amount ? l.settlementBase / l.amount : plan.rate,
            base: l.settlementBase,
            description: l.description,
          },
        ];
    for (const c of counters) {
      lines.push({
        accountId: l.counterAccountId,
        partnerId: l.partnerId,
        currencyId: doc.currency_id,
        rate: c.rate,
        debit: incoming ? 0 : c.amount,
        credit: incoming ? c.amount : 0,
        baseAmount: c.base,
        description: c.description,
      });
    }

    // The residuals, and only where there is one. A line settling open items
    // has one per item — never netted, so an item settled at a gain and one at
    // a loss stay a credit and a debit (IAS 21 / PSAK 10 recognise it per
    // monetary item settled). A line raising a position has none: both sides
    // came from the same cash. Each side is the balancing side, never chosen:
    // a gain on the credit side, a loss on the debit side, whichever way the
    // money moved.
    const residuals = l.items.length
      ? l.items.map((it) => ({
          amount: it.fxDifference,
          description: `Selisih kurs — ${l.description} · ${it.itemNo}`,
        }))
      : [{ amount: l.fxDifference, description: `Selisih kurs — ${l.description}` }];
    for (const r of residuals) {
      if (r.amount === 0 || !plan.fxAccountId) continue;
      const magnitude = Math.abs(r.amount);
      const gain = r.amount > 0;
      lines.push({
        accountId: plan.fxAccountId,
        currencyId: baseCurrency,
        rate: 1,
        debit: gain ? 0 : magnitude,
        credit: gain ? magnitude : 0,
        description: r.description,
      });
    }
  }

  return lines;
}

/** The base currency's row id, for the lines that have no foreign face. */
async function baseCurrencyId(): Promise<number> {
  const row = await prisma.refCurrency.findFirst({
    where: { currency_label: BASE_CURRENCY_LABEL },
    select: { id: true },
  });
  if (!row) {
    throw new Error(
      `Currency dasar ${BASE_CURRENCY_LABEL} tidak ada pada master. Jalankan db:seed.`
    );
  }
  return row.id;
}
