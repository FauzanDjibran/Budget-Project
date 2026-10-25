import "server-only";

import { prisma } from "@/lib/prisma";
import { layerDateRefusal } from "./cash-bank-layers";
import { BASE_CURRENCY_LABEL, consumesLayer, isBaseCurrency } from "./currency";
import { roundBase } from "./fx";
import { transferCurrencyFollowsSource, transferDestinationRefusal, transferPurposeOf, transferSourceRefusal, type TransferPurposeKey } from "./transfer-catalogue";

/** The rules a Cash Bank Transfer header and its destination lines are held to, before anything is written. */

// ------------------------------------------------------------------- header

export type TransferHeader = {
  purpose: string;
  from_cash_bank_id: number | null;
  currency_id: number | null;
  cash_bank_layer_id: number | null;
  /** When given, a layer acquired after it is refused. */
  accounting_date?: string | null;
};

/** A header that passed every rule — the shape the lines are checked against. */
export type ResolvedTransferHeader = {
  purpose: TransferPurposeKey;
  companyId: number;
  fromCashBankId: number;
  /** The source's own currency. */
  sourceCurrencyLabel: string;
  /** The document currency — the foreign side of the pair. */
  currencyId: number;
  currencyLabel: string;
  /** The source layer, where the source holds foreign currency. */
  layerId: number | null;
  layerRate: number | null;
  layerRemaining: number | null;
};

export type TransferHeaderCheck =
  | ({ ok: true } & ResolvedTransferHeader)
  | { ok: false; errors: Record<string, string> };

/**
 * The header, checked against every rule at once.
 *
 * The form narrows each picker as the user goes, but a Server Action is
 * reachable directly with any combination of ids — this is what actually
 * enforces it.
 *
 * **The Company is derived from the source, never picked.** Both legs belong to
 * one Company: a movement between the two is the intercompany bridge, which is
 * Funding Request's business (§36). And because the anak holds no Cash & Bank
 * at all (concept doc §25, §32), every transfer is in practice the induk's —
 * which falls out of the resource rather than being configured anywhere.
 */
export async function checkTransferHeader(
  header: TransferHeader
): Promise<TransferHeaderCheck> {
  const errors: Record<string, string> = {};

  const purpose = transferPurposeOf(header.purpose);
  if (!purpose) {
    return { ok: false, errors: { purpose: "Purpose transfer wajib dipilih." } };
  }

  if (!header.from_cash_bank_id) {
    return {
      ok: false,
      errors: { from_cash_bank_id: "Cash & Bank sumber wajib dipilih." },
    };
  }

  const source = await prisma.mCashBank.findUnique({
    where: { id: header.from_cash_bank_id },
    select: {
      company_id: true,
      status: true,
      currency_id: true,
      currency: { select: { currency_label: true } },
    },
  });
  if (!source) {
    return {
      ok: false,
      errors: { from_cash_bank_id: "Cash & Bank sumber tidak ditemukan." },
    };
  }
  if (source.status !== "Active") {
    errors.from_cash_bank_id =
      "Cash & Bank tersebut non-aktif dan tidak dapat dipakai.";
  }

  const sourceCurrencyLabel = source.currency.currency_label;
  const refusal = transferSourceRefusal(purpose.key, sourceCurrencyLabel);
  if (refusal) errors.from_cash_bank_id = refusal;

  // The document currency. It follows the source for Transfer and Pencairan —
  // the money leaving is what the document is denominated in — and is an input
  // for Pembelian Valas alone, where the source holds rupiah and the currency
  // being bought is the thing being decided.
  let currencyId = source.currency_id;
  let currencyLabel = sourceCurrencyLabel;
  if (!transferCurrencyFollowsSource(purpose.key)) {
    if (!header.currency_id) {
      errors.currency_id = "Pilih valuta yang dibeli.";
    } else {
      const currency = await prisma.refCurrency.findUnique({
        where: { id: header.currency_id },
        select: { id: true, status: true, currency_label: true },
      });
      if (!currency) errors.currency_id = "Currency tidak ditemukan.";
      else if (currency.status !== "Active") {
        errors.currency_id = "Currency tersebut non-aktif dan tidak dapat dipakai.";
      } else if (isBaseCurrency(currency.currency_label)) {
        errors.currency_id =
          `Pembelian Valas membeli valuta asing, jadi valuta yang dibeli tidak ` +
          `boleh ${BASE_CURRENCY_LABEL}.`;
      } else {
        currencyId = currency.id;
        currencyLabel = currency.currency_label;
      }
    }
  }

  // The source layer. Needed exactly when foreign currency leaves a foreign
  // resource, which `consumesLayer` is the one statement of — Transfer between
  // two foreign accounts and Pencairan. A Pembelian Valas spends rupiah, which
  // is unlayered, and a rupiah Transfer likewise.
  let layerId: number | null = null;
  let layerRate: number | null = null;
  let layerRemaining: number | null = null;
  const needsLayer =
    !errors.from_cash_bank_id &&
    consumesLayer("Out", currencyLabel, sourceCurrencyLabel);

  if (needsLayer) {
    if (!header.cash_bank_layer_id) {
      errors.cash_bank_layer_id =
        "Pilih layer kurs yang dipakai. Satu transfer memakai tepat satu layer.";
    } else {
      const layer = await prisma.cashBankLayer.findUnique({
        where: { id: header.cash_bank_layer_id },
        select: {
          cash_bank_id: true,
          status: true,
          rate: true,
          foreign_remaining: true,
          layer_no: true,
          acquisition_date: true,
        },
      });
      const tooNew = layer && header.accounting_date ? layerDateRefusal(layer, header.accounting_date) : null;
      if (!layer || layer.cash_bank_id !== header.from_cash_bank_id) {
        errors.cash_bank_layer_id =
          "Layer kurs tersebut bukan milik Cash & Bank sumber yang dipilih.";
      } else if (layer.status !== "Open") {
        errors.cash_bank_layer_id =
          "Layer kurs tersebut sudah habis dan tidak dapat dipakai lagi.";
      } else if (tooNew) {
        errors.cash_bank_layer_id = tooNew;
      } else {
        layerId = header.cash_bank_layer_id;
        layerRate = layer.rate.toNumber();
        layerRemaining = layer.foreign_remaining.toNumber();
      }
    }
  } else if (header.cash_bank_layer_id) {
    errors.cash_bank_layer_id =
      "Transfer ini tidak mengambil dari layer kurs mana pun.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    purpose: purpose.key,
    companyId: source.company_id,
    fromCashBankId: header.from_cash_bank_id,
    sourceCurrencyLabel,
    currencyId,
    currencyLabel,
    layerId,
    layerRate,
    layerRemaining,
  };
}

// -------------------------------------------------------------------- lines

export type TransferLineInput = {
  to_cash_bank_id: number;
  /** In the document currency. */
  amount: number;
  /** The kurs, where the Purpose asks for one. */
  exchange_rate: number | null;
};

export type ResolvedTransferLine = {
  toCashBankId: number;
  amount: number;
  rate: number;
};

export type TransferLineCheck =
  | { ok: true; lines: ResolvedTransferLine[]; total: number }
  | { ok: false; errors: Record<string, string> };

/**
 * The destinations, checked against the header that is supposed to admit them.
 *
 * Each destination must belong to the same Company as the source, be active,
 * hold a currency the Purpose admits, and not be the source itself. The kurs is
 * per line on purpose: proceeds split across two accounts may carry the two
 * rates the bank actually used, and a single header rate would force that into
 * two documents.
 */
export async function checkTransferLines(
  header: ResolvedTransferHeader,
  lines: TransferLineInput[]
): Promise<TransferLineCheck> {
  const purpose = transferPurposeOf(header.purpose)!;
  const wanted = lines.filter((l) => l.to_cash_bank_id > 0);

  if (!wanted.length) {
    return {
      ok: false,
      errors: { _lines: "Transfer harus memiliki minimal satu Cash & Bank tujuan." },
    };
  }
  if (wanted.some((l) => !(l.amount > 0))) {
    return {
      ok: false,
      errors: { _lines: "Nominal setiap tujuan harus lebih dari nol." },
    };
  }

  const seen = new Set<number>();
  for (const l of wanted) {
    if (l.to_cash_bank_id === header.fromCashBankId) {
      return {
        ok: false,
        errors: {
          _lines:
            "Cash & Bank tujuan tidak boleh sama dengan sumbernya — uangnya " +
            "tidak berpindah ke mana pun.",
        },
      };
    }
    if (seen.has(l.to_cash_bank_id)) {
      return {
        ok: false,
        errors: {
          _lines:
            "Satu Cash & Bank hanya boleh muncul sekali sebagai tujuan. " +
            "Gabungkan nominalnya menjadi satu baris.",
        },
      };
    }
    seen.add(l.to_cash_bank_id);
  }

  const resources = await prisma.mCashBank.findMany({
    where: { id: { in: wanted.map((l) => l.to_cash_bank_id) } },
    select: {
      id: true,
      company_id: true,
      status: true,
      cash_bank_label: true,
      currency: { select: { currency_label: true } },
    },
  });
  const byId = new Map(resources.map((r) => [r.id, r]));

  const resolved: ResolvedTransferLine[] = [];
  for (const l of wanted) {
    const to = byId.get(l.to_cash_bank_id);
    if (!to) {
      return { ok: false, errors: { _lines: "Cash & Bank tujuan tidak ditemukan." } };
    }
    if (to.company_id !== header.companyId) {
      return {
        ok: false,
        errors: {
          _lines:
            `${to.cash_bank_label} milik Company lain. Transfer memindahkan uang ` +
            "di dalam satu Company; pemindahan antar Company berjalan lewat " +
            "Funding Request.",
        },
      };
    }
    if (to.status !== "Active") {
      return {
        ok: false,
        errors: {
          _lines: `${to.cash_bank_label} non-aktif dan tidak dapat menerima dana.`,
        },
      };
    }

    const refusal = transferDestinationRefusal(
      header.purpose,
      header.currencyLabel,
      to.currency.currency_label
    );
    if (refusal) return { ok: false, errors: { _lines: refusal } };

    // The kurs. Stated by the user where the pair crosses, and meaningless
    // where it does not — a rate between a currency and itself is 1, and a rate
    // on a foreign Transfer would be a second opinion about the layer's own.
    // Where no rate is typed, the line still records the one it moved at: the
    // source layer's where one is drawn, and 1 where the money is already the
    // measure. A stored `1` between two foreign amounts would assert that USD
    // 100 is IDR 100.
    let rate = header.layerRate ?? 1;
    if (purpose.entersRate) {
      if (!(l.exchange_rate && l.exchange_rate > 0)) {
        return {
          ok: false,
          errors: {
            _lines:
              `Isi kurs setiap baris — berapa nilai 1 ${header.currencyLabel} ` +
              `dalam ${BASE_CURRENCY_LABEL} pada transaksi ini.`,
          },
        };
      }
      rate = l.exchange_rate;
    } else if (l.exchange_rate && l.exchange_rate !== 1) {
      return {
        ok: false,
        errors: {
          _lines:
            "Transfer mata uang yang sama tidak memakai kurs: nilainya mengikuti " +
            "layer sumbernya, atau sudah dalam mata uang dasar.",
        },
      };
    }

    resolved.push({ toCashBankId: to.id, amount: l.amount, rate });
  }

  const total = roundBase(resolved.reduce((t, l) => t + l.amount, 0));

  // The layer cap. One transfer draws on one layer, so the document is limited
  // to what that layer still holds, whatever the account holds overall.
  if (header.layerId && header.layerRemaining !== null) {
    if (total > header.layerRemaining) {
      return {
        ok: false,
        errors: {
          _lines:
            `Total ${total} melebihi sisa layer yang tinggal ` +
            `${header.layerRemaining}. Satu transfer memakai tepat satu layer — ` +
            "kurangi nominalnya, pilih layer lain, atau pecah dokumen.",
        },
      };
    }
  }

  return { ok: true, lines: resolved, total };
}

