import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { drawLayer, originate, type Layer } from "./fx";

/**
 * The rate layers a foreign Cash & Bank resource holds.
 *
 * A base-currency resource has none: it holds rupiah, which is already the
 * measure everything is reported in, so there is nothing to choose between.
 * Layers exist because foreign currency acquired at 15.000 and foreign currency
 * acquired at 16.000 are not interchangeable — spending one rather than the
 * other produces a different recognised gain or loss, and that is a decision
 * somebody takes rather than an average the system computes for them.
 *
 * **The user picks a layer, and the payment is counted against that layer
 * alone.** One transaction, one bank, one kurs. A document is therefore capped
 * at what its chosen layer still holds: a resource with five layers of a
 * million each holds five million but cannot make a single payment above one.
 * That is a real constraint and a known one, recorded here rather than
 * discovered later.
 *
 * **Never merged.** Two receipts at an identical kurs stay two layers, whatever
 * their source or timing. That is what makes "the layer from 28 January" name
 * something, where "the 15.000" would name three things at once.
 *
 * This table is **mutable**, unlike the books beside it, and deliberately so:
 * the remaining balance is what a payment is checked against and what the
 * picker offers. The immutable record of what was consumed lives on the
 * documents that consumed it, which is where an auditor would look for it.
 *
 * Owned by the Cash Bank Book, so it imports only the shared kernel — the book
 * is meant to be liftable and nothing here reaches back to a caller.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

/** Next layer number, `CBLY-0001`. */
async function nextLayerNo(db: Db): Promise<string> {
  return nextDocumentNumber("CBLY", async () => {
    const row = await db.cashBankLayer.findFirst({
      orderBy: { id: "desc" },
      select: { layer_no: true },
    });
    return row?.layer_no ?? null;
  });
}

export type NewLayer = {
  cashBankId: number;
  /** `YYYY-MM-DD` — when the currency was acquired, which is what orders it. */
  date: string;
  /** The kurs it was acquired at, to base. Immutable for the layer's life. */
  rate: number;
  /** Foreign amount acquired. Must be positive: a layer of nothing is not one. */
  foreign: number;
  /**
   * The exact base value, when the caller already knows it.
   *
   * A transfer **conserves base value** (CORE multi-currency §5.8): a
   * destination layer receives exactly the base its source layer released,
   * which can differ from `foreign × rate` by a rounding unit — that rate is
   * itself derived as `base ÷ foreign`, so re-multiplying by it is not the
   * identity. The caller passes what was actually released; everything else
   * lets this module multiply. The same escape `recordCashBankEntry` takes,
   * for the same reason.
   */
  baseAmount?: number;
  sourceDocTypeId?: number | null;
  sourceDocId?: number | null;
  note?: string | null;
  actorId: number;
};

/**
 * Creates one layer. Never merges into an existing one.
 *
 * The sequence number makes ordering total rather than merely mostly: two
 * receipts on the same day are still ordered, and a picker that showed them in
 * an arbitrary order would make "the earlier one" unnameable.
 */
export async function openLayer(db: Db, input: NewLayer) {
  if (!(input.foreign > 0)) {
    throw new Error(
      `Layer harus memuat nominal positif (diterima ${input.foreign}).`
    );
  }
  if (!(input.rate > 0)) {
    throw new Error(`Kurs layer harus lebih besar dari nol (diterima ${input.rate}).`);
  }

  const originated = originate(input.foreign, input.rate);
  const foreign = originated.foreign;
  const base = input.baseAmount ?? originated.base;

  const sameDay = await db.cashBankLayer.count({
    where: { cash_bank_id: input.cashBankId, acquisition_date: asDate(input.date) },
  });

  return db.cashBankLayer.create({
    data: {
      layer_no: await nextLayerNo(db),
      cash_bank_id: input.cashBankId,
      acquisition_date: asDate(input.date),
      acquisition_seq: sameDay + 1,
      rate: input.rate,
      foreign_original: foreign,
      base_original: base,
      foreign_remaining: foreign,
      base_remaining: base,
      status: "Open",
      source_doc_type_id: input.sourceDocTypeId ?? null,
      source_doc_id: input.sourceDocId ?? null,
      note: input.note ?? null,
      created_by: input.actorId,
    },
  });
}

export class LayerNotAvailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayerNotAvailable";
  }
}

/**
 * Draws foreign currency out of one layer, and says what base it released.
 *
 * The arithmetic is `fx.drawLayer`, which is `relieve` under the name the book
 * uses — a layer *is* a balance. Two properties come with it: drawing a layer
 * to nothing releases its remaining base **exactly** rather than as a
 * recomputed product, and a partial draw is one expression and one rounding, so
 * the drift stays in what was taken instead of compounding into what is left.
 *
 * Because relief is at the layer's own rate, the rate is untouched by being
 * spent. That is what makes it immutable in practice as well as by rule.
 *
 * Throws rather than returns: every caller is inside the posting transaction,
 * and a layer that cannot cover the payment has to take the posting down.
 */
export async function drawFromLayer(
  db: Db,
  input: { layerId: number; cashBankId: number; foreign: number; actorId: number }
): Promise<{ base: number; rate: number; exhausted: boolean }> {
  const row = await db.cashBankLayer.findUnique({
    where: { id: input.layerId },
    select: {
      id: true,
      cash_bank_id: true,
      status: true,
      rate: true,
      foreign_remaining: true,
      base_remaining: true,
      layer_no: true,
    },
  });

  if (!row) throw new LayerNotAvailable("Layer kurs tidak ditemukan.");
  // A layer belongs to one resource. Checked rather than assumed: the id
  // arrives from a form, and a payment drawing on another account's currency
  // would be invisible in both books.
  if (row.cash_bank_id !== input.cashBankId) {
    throw new LayerNotAvailable(
      `Layer ${row.layer_no} bukan milik Cash & Bank yang dipilih.`
    );
  }
  if (row.status !== "Open") {
    throw new LayerNotAvailable(
      `Layer ${row.layer_no} sudah habis dan tidak dapat dipakai lagi.`
    );
  }

  const layer: Layer = {
    foreign: row.foreign_remaining.toNumber(),
    base: row.base_remaining.toNumber(),
    rate: row.rate.toNumber(),
  };
  if (input.foreign > layer.foreign) {
    throw new LayerNotAvailable(
      `Layer ${row.layer_no} hanya menyisakan ${layer.foreign}, sedangkan ` +
        `transaksi membutuhkan ${input.foreign}. Satu transaksi hanya boleh ` +
        "memakai satu layer kurs."
    );
  }

  const drawn = drawLayer(layer, input.foreign);

  await db.cashBankLayer.update({
    where: { id: row.id },
    data: {
      foreign_remaining: drawn.remaining.foreign,
      base_remaining: drawn.remaining.base,
      status: drawn.exhausted ? "Exhausted" : "Open",
      updated_by: input.actorId,
    },
  });

  return { base: drawn.base, rate: layer.rate, exhausted: drawn.exhausted };
}

// ------------------------------------------------------------------- reads

export type LayerOption = {
  id: number;
  layerNo: string;
  date: string;
  rate: number;
  foreignRemaining: number;
  baseRemaining: number;
  /** What brought the currency in, for the picker to name the layer by. */
  note: string | null;
};

/**
 * The open layers of one resource, oldest first.
 *
 * Oldest first because that is how a treasury reads a stack, and because the
 * ordering is what lets a user say "the earlier one". It is **display order
 * only** — nothing consumes a layer without being told to.
 */
export async function openLayersOf(cashBankId: number): Promise<LayerOption[]> {
  return (await openLayersFor([cashBankId])).get(cashBankId) ?? [];
}

/**
 * The same, for several resources at once.
 *
 * The form that picks a layer is handed every resource's layers up front,
 * because the choice of resource happens in the browser and the page is where
 * the database is read (§3). Asking per resource made that page cost one round
 * trip per foreign account — so it is one query, grouped in memory, and a
 * resource with no open layers is simply absent from the map.
 */
export async function openLayersFor(
  cashBankIds: number[]
): Promise<Map<number, LayerOption[]>> {
  const byResource = new Map<number, LayerOption[]>();
  if (!cashBankIds.length) return byResource;

  const rows = await prisma.cashBankLayer.findMany({
    where: { cash_bank_id: { in: cashBankIds }, status: "Open" },
    orderBy: [
      { cash_bank_id: "asc" },
      { acquisition_date: "asc" },
      { acquisition_seq: "asc" },
    ],
    select: {
      id: true,
      cash_bank_id: true,
      layer_no: true,
      acquisition_date: true,
      rate: true,
      foreign_remaining: true,
      base_remaining: true,
      note: true,
    },
  });

  for (const r of rows) {
    const list = byResource.get(r.cash_bank_id) ?? [];
    list.push({
      id: r.id,
      layerNo: r.layer_no,
      date: r.acquisition_date.toISOString().slice(0, 10),
      rate: r.rate.toNumber(),
      foreignRemaining: r.foreign_remaining.toNumber(),
      baseRemaining: r.base_remaining.toNumber(),
      note: r.note,
    });
    byResource.set(r.cash_bank_id, list);
  }
  return byResource;
}

/**
 * Whether a resource's layers still add up to what its book says it holds.
 *
 * This is SIBA invariant 1 — an account's balance **is** the sum of its open
 * layers, on both measures — and it is the closest thing the layer table has to
 * the rebuild the books get. The layers are mutable, so nothing can recompute
 * them from an entry log; what can be checked is that they agree with the book
 * that was written beside them.
 *
 * A base-currency resource is unlayered and reconciles trivially.
 */
export async function reconcileLayers(cashBankId: number): Promise<{
  layered: boolean;
  bookBalance: number;
  bookBaseBalance: number;
  layerForeign: number;
  layerBase: number;
  reconciles: boolean;
}> {
  const resource = await prisma.mCashBank.findUnique({
    where: { id: cashBankId },
    select: {
      currency: { select: { currency_label: true } },
      book_balance: { select: { balance: true, base_balance: true } },
    },
  });

  const bookBalance = resource?.book_balance?.balance.toNumber() ?? 0;
  const bookBaseBalance = resource?.book_balance?.base_balance.toNumber() ?? 0;
  const layered = resource
    ? !isBaseCurrency(resource.currency.currency_label)
    : false;

  if (!layered) {
    return {
      layered: false,
      bookBalance,
      bookBaseBalance,
      layerForeign: 0,
      layerBase: 0,
      reconciles: true,
    };
  }

  const open = await prisma.cashBankLayer.aggregate({
    where: { cash_bank_id: cashBankId, status: "Open" },
    _sum: { foreign_remaining: true, base_remaining: true },
  });
  const layerForeign = open._sum.foreign_remaining?.toNumber() ?? 0;
  const layerBase = open._sum.base_remaining?.toNumber() ?? 0;

  return {
    layered: true,
    bookBalance,
    bookBaseBalance,
    layerForeign,
    layerBase,
    // Compared in cents, like every other money comparison here.
    reconciles:
      Math.round(layerForeign * 100) === Math.round(bookBalance * 100) &&
      Math.round(layerBase * 100) === Math.round(bookBaseBalance * 100),
  };
}

export type LayerRow = {
  id: number;
  layerNo: string;
  date: string;
  seq: number;
  rate: number;
  foreignOriginal: number;
  baseOriginal: number;
  foreignRemaining: number;
  baseRemaining: number;
  status: string;
  note: string | null;
};

export type LayerResourceBlock = {
  cashBankId: number;
  label: string;
  name: string;
  companyLabel: string;
  currencyLabel: string;
  active: boolean;
  layers: LayerRow[];
  foreignRemaining: number;
  baseRemaining: number;
  /**
   * The account's own weighted-average rate — `base ÷ foreign` over its open
   * layers, or null where it holds nothing.
   *
   * **Reporting only.** It values nothing and is never an input: it will
   * generally equal no rate anyone transacted at, which is precisely why the
   * user picks a layer instead of being handed this figure.
   */
  averageRate: number | null;
  reconciles: boolean;
};

export type LayerReport = {
  blocks: LayerResourceBlock[];
  /** Resources with no layers at all are not blocks — base currency has none. */
  resources: number;
};

/**
 * Every foreign resource's layers, for the Report View.
 *
 * Exhausted layers are included and marked: a layer that has been spent is part
 * of how the account got where it is, and dropping it would leave a report that
 * cannot explain its own closing figure. They are simply never offered as a
 * choice.
 *
 * Scoped to the Companies the reader may see, like every other report here.
 */
export async function layerReport(
  companyIds: number[],
  cashBankId?: number | null
): Promise<LayerReport> {
  const resources = await prisma.mCashBank.findMany({
    where: {
      company_id: { in: companyIds },
      ...(cashBankId ? { id: cashBankId } : {}),
    },
    orderBy: [{ company_id: "asc" }, { cash_bank_label: "asc" }],
    select: {
      id: true,
      cash_bank_label: true,
      cash_bank_name: true,
      status: true,
      company: { select: { company_label: true } },
      currency: { select: { currency_label: true } },
      book_balance: { select: { balance: true, base_balance: true } },
      layers: {
        orderBy: [{ acquisition_date: "asc" }, { acquisition_seq: "asc" }],
        select: {
          id: true,
          layer_no: true,
          acquisition_date: true,
          acquisition_seq: true,
          rate: true,
          foreign_original: true,
          base_original: true,
          foreign_remaining: true,
          base_remaining: true,
          status: true,
          note: true,
        },
      },
    },
  });

  const blocks: LayerResourceBlock[] = [];
  for (const r of resources) {
    // A base-currency resource is unlayered by design, not by omission — it
    // would be a block of nothing, stating that rupiah is worth rupiah.
    if (isBaseCurrency(r.currency.currency_label)) continue;

    const layers: LayerRow[] = r.layers.map((l) => ({
      id: l.id,
      layerNo: l.layer_no,
      date: l.acquisition_date.toISOString().slice(0, 10),
      seq: l.acquisition_seq,
      rate: l.rate.toNumber(),
      foreignOriginal: l.foreign_original.toNumber(),
      baseOriginal: l.base_original.toNumber(),
      foreignRemaining: l.foreign_remaining.toNumber(),
      baseRemaining: l.base_remaining.toNumber(),
      status: l.status,
      note: l.note,
    }));

    const open = layers.filter((l) => l.status === "Open");
    const foreignRemaining = open.reduce((t, l) => t + l.foreignRemaining, 0);
    const baseRemaining = open.reduce((t, l) => t + l.baseRemaining, 0);
    const bookBalance = r.book_balance?.balance.toNumber() ?? 0;
    const bookBase = r.book_balance?.base_balance.toNumber() ?? 0;

    blocks.push({
      cashBankId: r.id,
      label: r.cash_bank_label,
      name: r.cash_bank_name,
      companyLabel: r.company.company_label,
      currencyLabel: r.currency.currency_label,
      active: r.status === "Active",
      layers,
      foreignRemaining,
      baseRemaining,
      averageRate: foreignRemaining ? baseRemaining / foreignRemaining : null,
      reconciles:
        Math.round(foreignRemaining * 100) === Math.round(bookBalance * 100) &&
        Math.round(baseRemaining * 100) === Math.round(bookBase * 100),
    });
  }

  return { blocks, resources: blocks.length };
}
