import { roundBase } from "./fx";

/**
 * What a Jurnal Umum is worth in base currency, and its one Selisih Kurs
 * (Journal 2.0 §4, D7). Pure, so the form can preview exactly what Post
 * writes.
 *
 * A line's base is `round(face × kurs)`, or the exact figure its adapter
 * supplies (a release handing back an entry's remaining base). Then, for each
 * foreign currency whose face amounts balance, the gap between its two base
 * sides is FX by construction; the gaps are netted into one figure, positive
 * on the Debit side (a loss), negative on the Kredit (a gain). A currency
 * whose faces do not balance is not read as FX: it is left to the base
 * balance check, which refuses the journal by that currency's name.
 */

export type ValuedSide = "debit" | "credit";

export type ValuationLine = {
  currencyLabel: string;
  isBase: boolean;
  side: ValuedSide;
  /** In the line's own currency. */
  face: number;
  rate: number;
  /** The exact base value, where the line's adapter already knows it. */
  baseAmount?: number;
};

export type GeneralJournalValuation = {
  /** Each line's base value, in input order. */
  bases: number[];
  /** Netted Selisih Kurs: positive Debit, negative Kredit, 0 no line. */
  selisih: number;
  /** Base totals, Selisih included. */
  debit: number;
  credit: number;
  /** The foreign currencies whose face amounts do not balance. */
  unbalancedCurrencies: string[];
};

const cents = (n: number) => Math.round(n * 100);

export function valueGeneralJournal(lines: ValuationLine[]): GeneralJournalValuation {
  const bases = lines.map((l) => l.baseAmount ?? roundBase(l.face * l.rate));

  const perCurrency = new Map<string, { face: number; base: number }>();
  let debit = 0;
  let credit = 0;
  lines.forEach((l, i) => {
    const sign = l.side === "debit" ? 1 : -1;
    if (l.side === "debit") debit += bases[i];
    else credit += bases[i];
    if (l.isBase) return;
    const c = perCurrency.get(l.currencyLabel) ?? { face: 0, base: 0 };
    c.face += sign * l.face;
    c.base += sign * bases[i];
    perCurrency.set(l.currencyLabel, c);
  });

  let selisih = 0;
  const unbalancedCurrencies: string[] = [];
  for (const [label, c] of perCurrency) {
    // gap = Σ base kredit − Σ base debit, which is −(debit − kredit).
    if (cents(c.face) === 0) selisih += -c.base;
    else unbalancedCurrencies.push(label);
  }
  selisih = roundBase(selisih);
  if (selisih > 0) debit += selisih;
  else credit += -selisih;

  return {
    bases,
    selisih,
    debit: roundBase(debit),
    credit: roundBase(credit),
    unbalancedCurrencies: unbalancedCurrencies.sort(),
  };
}

export function isBalanced(v: GeneralJournalValuation): boolean {
  return cents(v.debit) === cents(v.credit);
}
