/**
 * What one transfer line is worth on each side of the move.
 *
 * Pure arithmetic over numbers — no database, no `server-only`, no dependency
 * on another module beyond the FX kernel. That is the point: the form has to
 * preview exactly what the posting will compute, and a rule that exists twice
 * is a rule with two answers (CLAUDE.md §12).
 *
 * ## The three shapes, and what tells them apart
 *
 * The discriminator is always **which side holds foreign currency**, never the
 * Purpose's name — by the time this runs the Purpose has already been checked
 * against the two resources, so asking it again would be asking a question that
 * cannot disagree.
 *
 *   * **Foreign leaves a foreign account** (a same-currency transfer between
 *     two foreign accounts, or a Pencairan). What the source gives up in base
 *     is what its layer *released*, which the caller supplies: a layer drawn to
 *     nothing releases its remainder exactly rather than as a recomputed
 *     product, so it cannot be derived here from a rate.
 *   * **Base leaves a base account.** What it gives up in base is simply the
 *     rupiah, and the rate is 1 — which here means what it always should: the
 *     money is already the measure.
 *   * **Foreign arrives.** The destination acquires currency, so it opens a
 *     layer of its own, and the base it receives is **conserved** from the
 *     source rather than recomputed.
 *
 * ## Where the one difference comes from
 *
 * Only a Pencairan can produce one. Selling foreign currency resolves two
 * independently determined base values: what the layer was carried at, and what
 * the bank actually credited at the sale rate. Everywhere else `inBase` is
 * `outBase` by construction, so the residual is exactly zero and no journal
 * line is written for it.
 */
import { roundBase } from "./fx";

export type TransferLineValuation = {
  /** What left the source, in the source resource's own currency. */
  outAmount: number;
  outBase: number;
  /** What arrived, in the destination resource's own currency. */
  inAmount: number;
  inBase: number;
  /** The destination's own rate, for its book entry and any layer it opens. */
  inRate: number;
  /** `inBase − outBase`, signed. Non-zero on a Pencairan and nowhere else. */
  fxDifference: number;
  /** Whether the arrival is foreign currency acquired, so a layer opens. */
  opensLayer: boolean;
};

export type TransferLineInputs = {
  /** In the document currency — the foreign side of the pair. */
  amount: number;
  /**
   * The kurs recorded on the line: the sale or purchase rate the user typed,
   * or the source layer's where no rate is typed.
   */
  rate: number;
  sourceIsBase: boolean;
  destinationIsBase: boolean;
  /** Whether the source draws on a rate layer. */
  drawsLayer: boolean;
  /**
   * What the source layer actually released for this amount. Required whenever
   * `drawsLayer`, and supplied rather than computed because only the layer
   * knows: a full draw releases its remaining base exactly.
   */
  releasedBase?: number;
  /** The source layer's own rate, which a destination layer inherits exactly. */
  layerRate?: number;
};

export function valueTransferLine(
  input: TransferLineInputs
): TransferLineValuation {
  const {
    amount,
    rate,
    sourceIsBase,
    destinationIsBase,
    drawsLayer,
    releasedBase,
    layerRate,
  } = input;

  // --- what the source gives up, and what base goes with it
  let outAmount: number;
  let outBase: number;
  if (drawsLayer) {
    outAmount = amount;
    outBase = releasedBase ?? 0;
  } else if (sourceIsBase && !destinationIsBase) {
    // Pembelian Valas: rupiah leaves, and how much is the foreign amount
    // bought valued at the purchase kurs. A multiplication, never a division —
    // the kurs always values the foreign side into base, which is what keeps
    // the foreign amount a figure somebody stated rather than a quotient.
    outAmount = roundBase(amount * rate);
    outBase = outAmount;
  } else {
    outAmount = amount;
    outBase = amount;
  }

  // --- what arrives, and what base goes with it
  let inAmount: number;
  let inBase: number;
  let inRate: number;
  if (destinationIsBase && !sourceIsBase) {
    // Pencairan: the bank credits rupiah at the sale rate. This figure and
    // `outBase` are the two independently determined base values whose residual
    // is the realized gain or loss.
    inAmount = roundBase(amount * rate);
    inBase = inAmount;
    inRate = 1;
  } else if (!destinationIsBase) {
    // Foreign currency arrives: a same-currency transfer, or a purchase. Base
    // is **conserved** — the destination receives exactly what the source
    // released, never `foreign × rate` recomputed.
    //
    // The rate the destination layer carries: its source layer's exactly, where
    // one was drawn (SIBA multi-currency §6), and otherwise the rate the
    // currency was bought at.
    inAmount = amount;
    inBase = outBase;
    inRate = drawsLayer ? layerRate ?? rate : rate;
  } else {
    inAmount = amount;
    inBase = outBase;
    inRate = 1;
  }

  return {
    outAmount,
    outBase,
    inAmount,
    inBase,
    inRate,
    fxDifference: roundBase(inBase - outBase),
    opensLayer: !destinationIsBase,
  };
}
