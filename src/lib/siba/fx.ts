/**
 * The foreign-exchange kernel: how a foreign amount acquires base value, how
 * that value is released, and what is left over when the two sides disagree.
 *
 * Everything here is a pure function over numbers. There is no database, no
 * `server-only`, no dependency on another module and no knowledge of what a
 * Budget, a Partner or a Cash & Bank is. That is deliberate: the form has to
 * preview exactly what the Server Action will compute, and a rule that exists
 * twice is a rule with two answers.
 *
 * ## The model
 *
 * **A foreign amount and its base value are two independent facts.** The base
 * value is not re-derivable by re-quoting a rate — it is a record of how the
 * balance was built. Every balance here is therefore a pair, and a rate is one
 * of exactly two things:
 *
 *   * an **input**, which creates base value where none existed, or
 *   * an **output**, `base ÷ foreign` over a balance that already exists.
 *
 * Confusing the two is the single failure mode this module exists to prevent.
 * A derived rate is never stored, never defaulted into a document and never
 * treated as a market rate — `carryingRate` exists to be displayed, not to be
 * multiplied by.
 *
 * ## The two sides of a settlement
 *
 * A settlement resolves two independently determined base values for one
 * foreign amount. The obligation releases what it was carried at; the cash
 * gives up what it actually cost. The residual is the **FX difference**, and it
 * is the balancing figure of the journal entry — its sign is never chosen
 * separately, which is what makes an unbalanced FX entry unrepresentable.
 *
 * ## A layer is a balance
 *
 * A foreign Cash & Bank resource holds rate layers, and a layer is a balance
 * like any other. `drawLayer` is therefore `relieve` with a name that says what
 * it is used for — which is also why a layer's rate cannot drift: relieving a
 * balance at its own carrying rate leaves that rate untouched by construction.
 */

/**
 * The base currency's minor unit. Base amounts are stored `Decimal(18,2)`, so
 * every base figure this module returns is rounded to two decimals.
 */
const MINOR_UNIT = 100;

/**
 * The largest base amount that survives rounding intact.
 *
 * Rounding scales by 100 into integer space, and beyond `MAX_SAFE_INTEGER` a
 * double can no longer represent consecutive integers — so a figure above this
 * would round to something that is merely nearby. The column allows larger
 * values than this; the arithmetic does not, and silently returning a wrong
 * rupiah is worse than refusing.
 */
const MAX_BASE = Math.floor(Number.MAX_SAFE_INTEGER / MINOR_UNIT);

export class FxRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxRangeError";
  }
}

/**
 * A base amount, rounded to the base currency's minor unit, **half away from
 * zero**.
 *
 * `Math.round` rounds half toward positive infinity, so `Math.round(-0.5)` is
 * `-0` rather than `-1`. An FX difference is signed and half of its values are
 * negative, so that would round a loss a cent differently from the matching
 * gain — the two would stop being mirror images of each other, which is exactly
 * the kind of asymmetry nobody finds by reading a report.
 */
export function roundBase(value: number): number {
  if (!Number.isFinite(value)) {
    throw new FxRangeError(`Nilai tidak terhingga tidak dapat dibulatkan: ${value}.`);
  }
  if (Math.abs(value) > MAX_BASE) {
    throw new FxRangeError(
      `Nilai base ${value} melampaui batas presisi aman (${MAX_BASE}).`
    );
  }
  const scaled = Math.abs(value) * MINOR_UNIT;
  // A product of a 2-decimal amount and a 6-decimal rate can land a hair below
  // an exact half in binary floating point. The nudge is proportional, so it
  // never moves a value that is not already sitting on the boundary.
  const rounded = Math.round(scaled + Number.EPSILON * scaled);
  return (value < 0 ? -rounded : rounded) / MINOR_UNIT;
}

/**
 * A balance: how much foreign currency, and what it is carried at in base.
 *
 * Both measures are always stored. Neither is derived from the other, which is
 * the whole point — `base` is history, and re-deriving it from `foreign` at a
 * current rate would destroy the only figure that answers what currency
 * movement actually cost.
 */
export type Balance = { foreign: number; base: number };

/** A rate layer. A balance, plus the rate that created it. */
export type Layer = Balance & { rate: number };

/**
 * The effective rate a balance is carried at, or **null** when it holds no
 * foreign currency.
 *
 * Null rather than zero and rather than the last known rate: a balance of
 * nothing has no rate, and answering with a number invites it being used as
 * one. It will generally equal no rate anyone quoted — a balance built from a
 * 16.000 receipt and a 15.500 receipt carries at 15.750, which appeared in no
 * deal.
 *
 * **Display only.** Never store it, never default it into a document, never
 * reconcile it against a market rate, and never round it and then multiply by
 * it — `relieve` computes in one expression precisely so that this value never
 * becomes an intermediate.
 */
export function carryingRate(balance: Balance): number | null {
  if (balance.foreign === 0) return null;
  return balance.base / balance.foreign;
}

/**
 * Creates base value where none existed: `foreign × rate`, one multiplication
 * and one rounding.
 *
 * This is the only way base value enters the system — a receipt of foreign
 * currency, an opening balance, a movement through a base-currency account.
 */
export function originate(foreign: number, rate: number): Balance {
  if (foreign < 0) {
    throw new FxRangeError(`Nominal foreign tidak boleh negatif: ${foreign}.`);
  }
  if (rate <= 0) {
    throw new FxRangeError(`Kurs harus lebih besar dari nol: ${rate}.`);
  }
  return { foreign, base: roundBase(foreign * rate) };
}

export class OverRelief extends Error {
  constructor(readonly requested: number, readonly available: number) {
    super(
      `Tidak dapat melepas ${requested} dari saldo yang hanya berisi ${available}.`
    );
    this.name = "OverRelief";
  }
}

export type Relief = {
  /** Foreign released. */
  foreign: number;
  /** Base released, at the balance's own carrying rate. */
  base: number;
  /** What the balance holds afterwards. */
  remaining: Balance;
  /** Whether this took the balance to nothing. */
  exhausted: boolean;
};

/**
 * Releases `foreign` from a balance, at that balance's own carrying rate.
 *
 * Two properties make this correct, and both are easy to lose:
 *
 * **A full release hands back the remaining base exactly**, rather than
 * recomputing `foreign × rate`. Partial releases each round, so a sequence of
 * them leaves a residue; releasing the remainder exactly absorbs that residue
 * into the last movement, where it belongs. Computing the final release as a
 * product instead would leave a balance holding zero foreign against a
 * non-zero base — a state that means nothing and that this rule makes
 * unreachable.
 *
 * **A partial release is one expression and one rounding.** Materialising
 * `base ÷ foreign`, rounding it, and then multiplying pushes the drift into
 * what stays behind, where it compounds over every later release. Computing
 * `foreign × base ÷ foreignBalance` in one go confines the rounding to the
 * amount being released now.
 *
 * Over-release is refused rather than absorbed: a balance cannot give up more
 * than it holds, and quietly letting it would hide the discrepancy inside an
 * FX difference where nobody would look for it.
 */
export function relieve(balance: Balance, foreign: number): Relief {
  if (foreign < 0) {
    throw new FxRangeError(`Nominal yang dilepas tidak boleh negatif: ${foreign}.`);
  }
  if (foreign > balance.foreign) {
    throw new OverRelief(foreign, balance.foreign);
  }

  const exhausted = foreign === balance.foreign;
  const base = exhausted
    ? balance.base
    : roundBase((foreign * balance.base) / balance.foreign);

  return {
    foreign,
    base,
    remaining: { foreign: balance.foreign - foreign, base: balance.base - base },
    exhausted,
  };
}

/**
 * Draws `foreign` out of a rate layer.
 *
 * A layer is a balance, so this is `relieve` under the name the Cash Bank Book
 * uses. The layer's rate is carried through untouched, and it stays true:
 * releasing base in proportion to what is left preserves `base ÷ foreign`, so a
 * layer's rate is fixed for its whole life and only ever set when it is created.
 */
export function drawLayer(
  layer: Layer,
  foreign: number
): { foreign: number; base: number; remaining: Layer; exhausted: boolean } {
  const relief = relieve({ foreign: layer.foreign, base: layer.base }, foreign);
  return {
    foreign: relief.foreign,
    base: relief.base,
    remaining: { ...relief.remaining, rate: layer.rate },
    exhausted: relief.exhausted,
  };
}

export type FxSide = "gain" | "loss";

export type FxDifference = {
  /** Signed: positive is a gain, negative a loss. */
  amount: number;
  /** Null when the two sides agreed and no line should be written. */
  side: FxSide | null;
};

/**
 * The residual between what an obligation released and what the cash cost.
 *
 * Derived *from* the balance requirement rather than computed as a magnitude
 * and then assigned a side. Positive means the obligation gave up more base
 * than the currency cost to obtain — a gain, sitting on the credit side.
 * Negative is a loss on the debit side. Exactly zero writes no line at all,
 * which is the ordinary case when a balance was built entirely at one rate.
 */
export function fxDifference(
  settlementBase: number,
  transactionBase: number
): FxDifference {
  const amount = roundBase(settlementBase - transactionBase);
  if (amount === 0) return { amount: 0, side: null };
  return { amount, side: amount > 0 ? "gain" : "loss" };
}

export type SettlementInput = {
  /**
   * What the document is settling against, or null when there is nothing on
   * the books — a Purpose that keeps no subject book, or a position this
   * document is the first to touch.
   */
  position: Balance | null;
  /** Foreign amount being settled, in the document's currency. */
  foreign: number;
  /** What the cash actually cost in base, from the layer or the entered kurs. */
  transactionBase: number;
};

export type Settlement = {
  /** Base the position released, plus base created for any excess. */
  settlementBase: number;
  /** Foreign released from an existing position. */
  relieved: number;
  /** Foreign beyond what the position held, which creates rather than relieves. */
  originated: number;
  difference: FxDifference;
  /** What the position holds afterwards, or null when there was none. */
  remaining: Balance | null;
};

/**
 * Settles a foreign amount against a position, creating or relieving as the
 * position requires.
 *
 * **The discriminator is whether base value already exists** — never the
 * document's Purpose, never its direction, never which book it writes into.
 * Where nothing is on the books, the settlement *is* the origin of the value:
 * settlement base is simply the transaction base and no difference can arise,
 * because there is no second opinion to disagree with. Where a position does
 * exist, it releases at its own carrying rate and the two sides are compared.
 *
 * Implementing the branch this way rather than on `purpose === "..."` means a
 * Piutang raised by paying out, an expense, and a first-ever Hutang all behave
 * correctly with no per-Purpose branching, and any future object originated by
 * a cash movement will too.
 *
 * A settlement larger than the position **splits**: the part with base value
 * behind it is relieved, and the excess is created. The transaction base is
 * apportioned between the two, with the relieved share taken as the exact
 * complement of the created share so the two always add back to the figure that
 * actually left the bank.
 */
export function settle(input: SettlementInput): Settlement {
  const { position, foreign, transactionBase } = input;

  if (foreign < 0) {
    throw new FxRangeError(`Nominal settlement tidak boleh negatif: ${foreign}.`);
  }

  const available =
    position && position.foreign > 0 ? Math.min(foreign, position.foreign) : 0;

  // Nothing on the books to disagree with: this movement is the origin of the
  // value, so both measures come from the same place and no difference arises.
  if (available === 0) {
    return {
      settlementBase: transactionBase,
      relieved: 0,
      originated: foreign,
      difference: { amount: 0, side: null },
      remaining: position,
    };
  }

  const relief = relieve(position!, available);
  const originated = foreign - available;

  if (originated === 0) {
    return {
      settlementBase: relief.base,
      relieved: available,
      originated: 0,
      difference: fxDifference(relief.base, transactionBase),
      remaining: relief.remaining,
    };
  }

  // Split. The created share is rounded once and the relieved share is its
  // exact complement, so the two halves always sum to what left the bank
  // rather than to a re-rounded approximation of it.
  const originatedBase = roundBase((transactionBase * originated) / foreign);
  const relievedTransactionBase = roundBase(transactionBase - originatedBase);

  return {
    settlementBase: roundBase(relief.base + originatedBase),
    relieved: available,
    originated,
    difference: fxDifference(relief.base, relievedTransactionBase),
    remaining: relief.remaining,
  };
}
