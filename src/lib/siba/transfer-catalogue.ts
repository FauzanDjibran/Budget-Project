/**
 * The three transfer Purposes, and the currency relation each one asserts.
 *
 * A transfer Purpose is **not** a `rules.ts` Purpose. Those are one Budget
 * Category × one Partner Category × one direction, which is what lets them
 * resolve to a single mapped account. A transfer has none of the three: it
 * moves the Company's own money between its own resources, so it realizes no
 * Budget, names no Partner, keeps no subject book and needs no mapping — both
 * of its accounts are already known, because a Cash & Bank resource names the
 * account it posts to.
 *
 * What a transfer Purpose says instead is **how the two resources' currencies
 * relate**:
 *
 *   Transfer        same currency on both sides
 *   Pencairan       foreign out, base in   — selling foreign currency
 *   Pembelian Valas base out, foreign in   — buying foreign currency
 *
 * The relation is technically derivable from the two resources, so the Purpose
 * is redundant as data and deliberately kept as an input: the user states what
 * they mean to do and the resources are checked against it, which is what turns
 * picking the wrong account into a refusal rather than a silent currency sale.
 * It is the same relationship a Cash Bank Transaction's Purpose has to its
 * Partner.
 *
 * There is no fourth. Foreign to a *different* foreign currency is refused by
 * `maySettle` in `currency.ts` — crossing goes through the base currency only —
 * and is done as a Pencairan followed by a Pembelian Valas, which is also how a
 * bank does it.
 *
 * Client-safe on purpose: no `server-only`, no database import, no dependency
 * on another module. The form narrows its pickers with these rules and the
 * Server Action refuses with the same ones.
 */
import type { IconName } from "@/components/icon";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "./currency";

export type TransferPurposeKey = "Transfer" | "Pencairan" | "PembelianValas";

export type TransferPurpose = {
  key: TransferPurposeKey;
  label: string;
  /** One clause, for the picker's hint. */
  hint: string;
  icon: IconName;
  /** Whether the source resource must hold the base currency. */
  sourceIsBase: boolean;
  /** Whether each destination must hold the base currency. */
  destinationIsBase: boolean;
  /**
   * Whether a kurs is stated by the user.
   *
   * False for Transfer: same-currency money is either already base, or it is
   * valued by the layer it comes out of. A rate typed there would be a second
   * opinion about a figure the book already holds.
   */
  entersRate: boolean;
};

export const TRANSFER_PURPOSES: TransferPurpose[] = [
  {
    key: "Transfer",
    label: "Transfer",
    hint: "mata uang sama di kedua sisi",
    icon: "link",
    sourceIsBase: false,
    destinationIsBase: false,
    entersRate: false,
  },
  {
    key: "Pencairan",
    label: "Pencairan",
    hint: `valuta asing keluar, ${BASE_CURRENCY_LABEL} masuk`,
    icon: "down",
    sourceIsBase: false,
    destinationIsBase: true,
    entersRate: true,
  },
  {
    key: "PembelianValas",
    label: "Pembelian Valas",
    hint: `${BASE_CURRENCY_LABEL} keluar, valuta asing masuk`,
    icon: "coin",
    sourceIsBase: true,
    destinationIsBase: false,
    entersRate: true,
  },
];

const BY_KEY = new Map(TRANSFER_PURPOSES.map((p) => [p.key, p]));

export function transferPurposeOf(
  key: string | null | undefined
): TransferPurpose | null {
  return key ? BY_KEY.get(key as TransferPurposeKey) ?? null : null;
}

export function transferPurposeLabel(key: string | null | undefined): string {
  return transferPurposeOf(key)?.label ?? key ?? "—";
}

/**
 * Whether the document's currency is the source resource's own.
 *
 * True for Transfer and Pencairan, where the money leaving is what the document
 * is denominated in. False for Pembelian Valas alone: there the source holds
 * rupiah and the document is denominated in the currency being *bought*, which
 * is therefore the one case where the currency is an input rather than a
 * consequence of the source.
 */
export function transferCurrencyFollowsSource(purpose: TransferPurposeKey): boolean {
  return purpose !== "PembelianValas";
}

/**
 * Why this source resource cannot carry this Purpose, or null when it can.
 *
 * Messages name the currency on both sides of the complaint: "Cash & Bank tidak
 * sesuai" tells nobody which half to change.
 */
export function transferSourceRefusal(
  purpose: TransferPurposeKey,
  sourceCurrency: string
): string | null {
  const base = isBaseCurrency(sourceCurrency);
  const label = sourceCurrency.trim().toUpperCase();

  if (purpose === "Pencairan" && base) {
    return (
      `Pencairan mencairkan valuta asing menjadi ${BASE_CURRENCY_LABEL}, jadi ` +
      `Cash & Bank sumber tidak boleh ${BASE_CURRENCY_LABEL}. Untuk memindahkan ` +
      `${BASE_CURRENCY_LABEL} antar rekening, pakai Purpose Transfer.`
    );
  }
  if (purpose === "PembelianValas" && !base) {
    return (
      `Pembelian Valas membeli valuta asing memakai ${BASE_CURRENCY_LABEL}, jadi ` +
      `Cash & Bank sumber harus ${BASE_CURRENCY_LABEL}, bukan ${label}.`
    );
  }
  return null;
}

/**
 * Why this destination cannot receive under this Purpose, or null when it can.
 *
 * `documentCurrency` is the foreign currency of the pair — the currency being
 * sold on a Pencairan, bought on a Pembelian Valas, and moved on a Transfer.
 */
export function transferDestinationRefusal(
  purpose: TransferPurposeKey,
  documentCurrency: string,
  destinationCurrency: string
): string | null {
  const doc = documentCurrency.trim().toUpperCase();
  const dest = destinationCurrency.trim().toUpperCase();

  if (purpose === "Transfer") {
    return doc === dest
      ? null
      : `Transfer memindahkan mata uang yang sama, jadi Cash & Bank tujuan ` +
          `harus ${doc}, bukan ${dest}.`;
  }
  if (purpose === "Pencairan") {
    return isBaseCurrency(dest)
      ? null
      : `Hasil pencairan diterima dalam ${BASE_CURRENCY_LABEL}, jadi Cash & Bank ` +
          `tujuan harus ${BASE_CURRENCY_LABEL}, bukan ${dest}.`;
  }
  return doc === dest
    ? null
    : `Valuta yang dibeli adalah ${doc}, jadi Cash & Bank tujuan harus ${doc}, ` +
        `bukan ${dest}.`;
}

/**
 * The Purpose two resources actually describe, or null for a pair no Purpose
 * admits — which under the crossing rule means one foreign currency to another.
 *
 * Used by the form to say what the user has in fact selected, never to write
 * the field: the Purpose is the user's statement of intent and the resources
 * are checked against it, not the other way round.
 */
export function transferPurposeForPair(
  sourceCurrency: string,
  destinationCurrency: string
): TransferPurposeKey | null {
  const source = sourceCurrency.trim().toUpperCase();
  const destination = destinationCurrency.trim().toUpperCase();
  if (source === destination) return "Transfer";
  if (!isBaseCurrency(source) && isBaseCurrency(destination)) return "Pencairan";
  if (isBaseCurrency(source) && !isBaseCurrency(destination)) {
    return "PembelianValas";
  }
  return null;
}

/**
 * Whether this Purpose can produce a realized FX difference at all.
 *
 * **Pencairan alone.** Selling foreign currency resolves two independently
 * determined base values — what the layer released, and what the bank actually
 * credited — and the residual is a realized gain or loss.
 *
 * A Transfer conserves base by construction: the destination receives exactly
 * the base the source released, whatever rate that was. A Pembelian Valas is
 * origination — there is nothing on the books to disagree with, so the rupiah
 * spent *is* the base value of the currency bought (CLAUDE.md §10 rule 73).
 */
export function transferMayDiffer(purpose: TransferPurposeKey): boolean {
  return purpose === "Pencairan";
}
