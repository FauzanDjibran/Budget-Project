/**
 * Which currency is the base, and which resource may settle which document.
 *
 * Until now nothing in the application could ask either question. The base
 * currency existed only as a default inside `prisma/seed.ts`, and currency was
 * a filter rather than a measure: a document took its currency from its Cash &
 * Bank resource, and a Budget had to match it exactly. Multi-currency separates
 * the three, so the relationship between them needs saying somewhere.
 *
 * **Crossing goes through the base currency only.** A foreign document may be
 * settled from a resource in its own currency or from a base-currency resource,
 * and from nothing else. USD settles from USD or IDR; EUR from EUR or IDR; USD
 * never from EUR, and IDR never from anything but IDR.
 *
 * That is narrower than the source specification, which also admits a foreign
 * document paid from a *third* currency's account — the case needing a cross
 * rate applied on top of the account's own rate. Removing it means **the only
 * rate this system ever holds converts a foreign currency to base**. There is
 * no EUR-to-USD rate to enter, store or source, which is why `fx.ts` needs one
 * multiplication where the specification needs two.
 *
 * Client-safe on purpose — no `server-only`, no database import, no dependency
 * on any other module. The form narrows its pickers with these rules and the
 * Server Action refuses with the same ones, which is the only way the two
 * cannot disagree.
 */

/**
 * The reporting base currency.
 *
 * Stated here because the rules below are meaningless without it, and because
 * a page cannot reach the database to ask. It is a currency *label*, matching
 * `ref_currency.currency_label`.
 *
 * **This and `prisma/seed.ts` are currently two statements of one fact.** The
 * seed takes `SIBA_BASE_CURRENCY` from the environment, defaulting to the same
 * value. Nothing reconciles them yet, so that variable must not be changed —
 * reconciling the two (most likely by the seed importing this constant) belongs
 * with the migration that gives the books their base measure, where there is a
 * schema change to carry it.
 */
export const BASE_CURRENCY_LABEL = "IDR";

/** Whether a currency label is the base currency. Case-insensitive. */
export function isBaseCurrency(label: string | null | undefined): boolean {
  return (label ?? "").trim().toUpperCase() === BASE_CURRENCY_LABEL;
}

/**
 * Whether a document in one currency may be settled from a resource in
 * another.
 *
 * Both arguments are currency labels. The rule is symmetric in neither
 * direction and deliberately so: a foreign document reaches base, but a base
 * document never reaches foreign.
 */
export function maySettle(
  documentCurrency: string,
  resourceCurrency: string
): boolean {
  const document = documentCurrency.trim().toUpperCase();
  const resource = resourceCurrency.trim().toUpperCase();
  if (document === resource) return true;
  // A foreign document may be paid from a base-currency resource, converting
  // at the rate the bank actually used. Nothing else crosses.
  return isBaseCurrency(resource);
}

/**
 * Why a pairing was refused, in Indonesian, or null when it is allowed.
 *
 * The message names both currencies, because "Cash & Bank tidak sesuai" tells
 * a user nothing about which half of the pairing to change.
 */
export function settlementRefusal(
  documentCurrency: string,
  resourceCurrency: string
): string | null {
  if (maySettle(documentCurrency, resourceCurrency)) return null;
  if (isBaseCurrency(documentCurrency)) {
    return (
      `Dokumen dalam ${BASE_CURRENCY_LABEL} hanya dapat diselesaikan dari ` +
      `Cash & Bank ${BASE_CURRENCY_LABEL}.`
    );
  }
  return (
    `Dokumen dalam ${documentCurrency.trim().toUpperCase()} hanya dapat ` +
    `diselesaikan dari Cash & Bank ${documentCurrency.trim().toUpperCase()} ` +
    `atau ${BASE_CURRENCY_LABEL}, bukan ${resourceCurrency.trim().toUpperCase()}.`
  );
}

/**
 * Where the kurs for a movement comes from.
 *
 * `identity` — the money is base currency, so the rate is 1 and no control is
 * shown. This is the only case where a rate of 1 is correct; a rate of 1
 * between two foreign amounts would assert that USD 100 is IDR 100.
 *
 * `layer` — foreign currency leaving a foreign resource. The rate is read off
 * the layer the user chose, never typed.
 *
 * `entered` — everywhere else a foreign currency is involved. The user types
 * the rate the bank actually used, and it is never defaulted, inherited or
 * looked up from a table.
 */
export type RateSource = "identity" | "layer" | "entered";

/**
 * Which of the three a given movement uses.
 *
 * Returns null for a pairing `maySettle` refuses, so a caller that skipped the
 * check cannot read a plausible answer out of an impossible combination.
 *
 * Direction is a bare literal rather than the `Direction` type from `rules.ts`
 * to keep this module free of dependencies — it is read by the form, by the
 * Server Action and by the books, and a shared kernel that imports the business
 * rules is not a kernel.
 */
export function rateSource(
  direction: "In" | "Out",
  documentCurrency: string,
  resourceCurrency: string
): RateSource | null {
  if (!maySettle(documentCurrency, resourceCurrency)) return null;

  const resourceIsBase = isBaseCurrency(resourceCurrency);
  const documentIsBase = isBaseCurrency(documentCurrency);

  // Base money on a base resource: nothing is converted and nothing is layered.
  if (documentIsBase && resourceIsBase) return "identity";

  // A base-currency resource is unlayered, so a foreign document paid through
  // one converts at a rate somebody has to state.
  if (resourceIsBase) return "entered";

  // A foreign resource, in the document's own currency. Money leaving it is
  // valued by the layer the user picks; money arriving creates a layer, and the
  // rate that creates it has to be stated.
  return direction === "Out" ? "layer" : "entered";
}

/** Whether this movement needs the user to type a kurs. */
export function needsEnteredRate(
  direction: "In" | "Out",
  documentCurrency: string,
  resourceCurrency: string
): boolean {
  return rateSource(direction, documentCurrency, resourceCurrency) === "entered";
}

/**
 * Whether this movement draws on a layer — the only case that also caps the
 * document at what that layer still holds.
 */
export function consumesLayer(
  direction: "In" | "Out",
  documentCurrency: string,
  resourceCurrency: string
): boolean {
  return rateSource(direction, documentCurrency, resourceCurrency) === "layer";
}

/**
 * Whether this movement creates a layer.
 *
 * Foreign currency arriving into a foreign resource, and nothing else: a base
 * resource is unlayered, and money leaving never creates.
 */
export function createsLayer(
  direction: "In" | "Out",
  documentCurrency: string,
  resourceCurrency: string
): boolean {
  if (!maySettle(documentCurrency, resourceCurrency)) return false;
  return direction === "In" && !isBaseCurrency(resourceCurrency);
}
