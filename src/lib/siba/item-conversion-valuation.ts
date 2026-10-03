/**
 * What one Pencairan Open Item line is worth, on both legs.
 *
 * Pure arithmetic over numbers — no database, no `server-only` — so the form
 * previews exactly what the posting computes (CLAUDE.md §12: a rule that exists
 * twice is a rule with two answers).
 *
 * ## The two legs, at one kurs
 *
 * **The cash leg** is a Pencairan, valued by `valueTransferLine`: the layer
 * releases what it carried the currency at, and the bank pays `amount × kurs`
 * in base currency. Their gap is the cash difference.
 *
 * **The Partner leg** releases each chosen foreign item at its own kurs and
 * opens one base-currency item for exactly what the bank paid — the Partner's
 * money was sold, so what it became is what the Partner is now owed, or owes.
 * The new item's value is shared across the items it came from
 * (`allocateBase`, the last taking the rounding) so each item states its own
 * difference.
 *
 * Both are signed **as a gain**, and their sum is the line's contribution to
 * the document's one Selisih Kurs line. For a book that money arriving raises —
 * a Titipan, a Hutang — the position is something owed, so releasing it at
 * more than it is now owed is a gain: `released − converted`. For one that
 * money leaving raises — a Piutang — the position is something owed **to** the
 * Company, and the mirror holds: `converted − released`.
 *
 * Summed over a document this equals exactly what the journal needs to
 * balance, which is why it can be journalled as the balancing figure.
 */
import { allocateBase, roundBase } from "./fx";
import { valueTransferLine } from "./transfer-valuation";

export type ConversionItemInput = {
  /** In the document currency. */
  amount: number;
  /** What the item releases for that amount, at its own kurs. */
  releasedBase: number;
};

export type ConversionLineValuation = {
  /** What the source layer released for the line. */
  outBase: number;
  /** What the bank paid, in base currency — and the new item's value. */
  inAmount: number;
  /** Signed as a gain: the currency sold above or below its layer's kurs. */
  cashFx: number;
  /** Each item's share of the new base-currency item, in item order. */
  shares: number[];
  /** Each item's difference, signed as a gain, in item order. */
  itemFx: number[];
  /** Sum of `itemFx`. */
  itemFxTotal: number;
  /** `cashFx + itemFxTotal` — the line's part of the one Selisih Kurs line. */
  fxDifference: number;
};

export function valueConversionLine(input: {
  /** In the document currency — always the sum of the items. */
  amount: number;
  /** The kurs the bank bought at, which also converts the items. */
  rate: number;
  /** What the source layer released for `amount`. */
  layerReleasedBase: number;
  layerRate: number;
  /** Whether the book's position is raised by money arriving. */
  raisesOnIn: boolean;
  items: ConversionItemInput[];
}): ConversionLineValuation {
  const cash = valueTransferLine({
    amount: input.amount,
    rate: input.rate,
    sourceIsBase: false,
    destinationIsBase: true,
    drawsLayer: true,
    releasedBase: input.layerReleasedBase,
    layerRate: input.layerRate,
  });

  const shares = input.items.length
    ? allocateBase(
        input.items.map((i) => i.amount),
        input.amount,
        cash.inAmount
      )
    : [];
  const itemFx = input.items.map((item, i) =>
    roundBase(
      input.raisesOnIn
        ? item.releasedBase - shares[i]
        : shares[i] - item.releasedBase
    )
  );
  const itemFxTotal = roundBase(itemFx.reduce((t, f) => t + f, 0));

  return {
    outBase: cash.outBase,
    inAmount: cash.inAmount,
    cashFx: cash.fxDifference,
    shares,
    itemFx,
    itemFxTotal,
    fxDifference: roundBase(cash.fxDifference + itemFxTotal),
  };
}
