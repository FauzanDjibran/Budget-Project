/**
 * What one Reklasifikasi Open Item line does to its target, and what it is
 * worth.
 *
 * Pure arithmetic over numbers — no database, no `server-only` — so the form
 * previews exactly what the posting computes (CLAUDE.md §12: a rule that exists
 * twice is a rule with two answers).
 *
 * ## The one rule
 *
 * A reclassification answers *what should the original movement have been
 * classified as?* So the target is posted the way a Realisasi would have
 * posted it: as a movement in the direction that **raised the source**. That
 * one fact decides everything, through the target book's own `raises`:
 *
 *   - the same way — **open**: the target gains one item per source item, at
 *     that item's own kurs and base. Value is carried, never recomputed, so no
 *     difference can arise (the transfer's rule 86, applied to items).
 *   - the other way — **settle**: the target's own items are lowered, each
 *     chosen and stated by the user and each relieved at its own kurs. Two
 *     carrying values now meet, so each settled item states its own
 *     difference (§10 rule 107), never netted.
 *
 * ## Sides and sign
 *
 * The source is lowered, so its journal side is the one that lowers it: a book
 * money arriving raises (a credit balance — Hutang, Penerimaan Belum
 * Teridentifikasi) is debited, the other kind credited. The target always takes
 * the opposite side, whether it is being raised or lowered.
 *
 * A settled item's difference is signed **as a gain**. The source side carries
 * the item's share of what the source released, the target side what the item
 * released at its own kurs; whichever side is heavier is balanced by the
 * difference. With the source debited, a share above the target's release
 * leaves debits heavy and needs a credit — a gain: `share − settled`. With the
 * source credited it is the mirror: `settled − share`.
 */
import { allocateBase, roundBase } from "./fx";

export type Raises = "In" | "Out";

/** What a line does to its target book. */
export type ReclassEffect = "open" | "settle";

/**
 * Whether the target gains items or has its own settled — decided by the two
 * books' directions alone, never chosen.
 */
export function reclassEffect(sourceRaises: Raises, targetRaises: Raises): ReclassEffect {
  return sourceRaises === targetRaises ? "open" : "settle";
}

/** Whether the source's journal line is a debit — the side that lowers it. */
export function sourceIsDebit(sourceRaises: Raises): boolean {
  return sourceRaises === "In";
}

/** The cash direction that lowers the source, as its book entry records it. */
export function sourceReleaseDirection(sourceRaises: Raises): Raises {
  return sourceRaises === "In" ? "Out" : "In";
}

/**
 * The cash direction the target is posted in — the one that raised the
 * source, whichever way that moves the target.
 */
export function targetDirection(sourceRaises: Raises): Raises {
  return sourceRaises;
}

export type ReclassLineValuation = {
  /** What the line's source items released, in base. */
  releasedBase: number;
  /**
   * Where the target settles: each target item's share of `releasedBase`, in
   * target order, the last taking the rounding. Empty where it opens.
   */
  shares: number[];
  /** Each settled target item's difference, signed as a gain. */
  fx: number[];
  /** Sum of `fx`. */
  fxTotal: number;
};

export function valueReclassLine(input: {
  sourceRaises: Raises;
  effect: ReclassEffect;
  /** In the document currency — the sum of the source items. */
  amount: number;
  /** What each source item releases, at its own kurs, in source order. */
  sourceReleased: number[];
  /**
   * The target items settled, in target order — their amounts and what each
   * releases at its own kurs. Ignored where the target opens.
   */
  targets: { amount: number; releasedBase: number }[];
}): ReclassLineValuation {
  const releasedBase = roundBase(input.sourceReleased.reduce((t, b) => t + b, 0));
  if (input.effect === "open" || !input.targets.length) {
    return { releasedBase, shares: [], fx: [], fxTotal: 0 };
  }

  const shares = allocateBase(
    input.targets.map((t) => t.amount),
    input.amount,
    releasedBase
  );
  const debit = sourceIsDebit(input.sourceRaises);
  const fx = input.targets.map((t, i) =>
    roundBase(debit ? shares[i] - t.releasedBase : t.releasedBase - shares[i])
  );
  return {
    releasedBase,
    shares,
    fx,
    fxTotal: roundBase(fx.reduce((t, f) => t + f, 0)),
  };
}
