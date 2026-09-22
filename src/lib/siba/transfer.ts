import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { sumByCurrency, type MoneyTotal } from "@/lib/format";
import { recordCashBankEntry } from "./cash-bank";
import { drawFromLayer, openLayer, openLayersFor, type LayerOption } from "./cash-bank-layers";
import { BASE_CURRENCY_LABEL, consumesLayer, isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { checkPostingPeriod } from "./fiscal";
import { roundBase } from "./fx";
import { valueTransferLine } from "./transfer-valuation";
import { postJournal, type JournalLineInput } from "./journal";
import { refValueOf } from "./system-defaults";
import { systemDefaults } from "./system-settings";
import {
  transferCurrencyFollowsSource,
  transferDestinationRefusal,
  transferPurposeOf,
  transferSourceRefusal,
  type TransferPurposeKey,
} from "./transfer-catalogue";
import type { TransferStatus } from "./transfer-workflow";

/**
 * Cash Bank Transfer: the Company's own money moving between its own Cash &
 * Bank resources.
 *
 * The header names the **source** and each line names a destination, so one
 * document splits one withdrawal across several accounts. A transfer realizes
 * no Budget, names no Partner and writes no subject book — it is not a business
 * event with a counterparty, it is treasury moving money between pockets. That
 * is why this is its own module with its own tables rather than a third
 * `transaction_type` on `fin_cash_bank_transaction`, whose every line settles a
 * Budget.
 *
 * ## The two rules the arithmetic rests on
 *
 * **Base value is conserved** (CORE multi-currency §5.8, invariant 18): a
 * transfer creates no value, so what the destination receives in base is
 * exactly what the source released — never a product recomputed from a derived
 * rate.
 *
 * **Layers propagate one-for-one** (SIBA multi-currency §6): each line draws
 * its own amount out of the source layer and opens its own layer on the
 * destination. Three destinations therefore create three layers, never one
 * blended one — blending would let an unwanted rate be laundered into a fresh
 * average, which is the whole thing layering exists to prevent.
 *
 * ## The one place a difference can arise
 *
 * **Pencairan alone.** Selling foreign currency resolves two independently
 * determined base values: what the source layer was carried at, and what the
 * bank actually credited at the sale rate. The residual is a realized gain or
 * loss and is the balancing figure of the journal, exactly as it is for a Cash
 * Bank Transaction settling an obligation.
 *
 * A Transfer conserves by construction. A Pembelian Valas is origination —
 * nothing is on the books to disagree with, so the rupiah spent *is* the base
 * value of the currency bought (CLAUDE.md §10 rule 73).
 *
 * Nothing here moves money. Draft is inert; Post is the boundary, and it is one
 * database transaction.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const day = (d: Date): string => d.toISOString().slice(0, 10);

// --------------------------------------------------------------------- rows

export type TransferRow = {
  id: number;
  transfer_no: string;
  document_date: string | null;
  posting_date: string | null;
  company_id: number;
  purpose: TransferPurposeKey;
  from_cash_bank_id: number;
  currency_id: number;
  cash_bank_layer_id: number | null;
  transfer_amount: number;
  transfer_base_amount: number;
  note: string | null;
  status: TransferStatus;
  line_count: number;
  created_by: number;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type TransferLineRow = {
  id: number;
  sequence_no: number;
  to_cash_bank_id: number;
  amount: number;
  exchange_rate: number;
  out_amount: number;
  out_base_amount: number;
  in_amount: number;
  in_base_amount: number;
  fx_difference: number;
};

type TransferRecord = {
  id: number;
  transfer_no: string;
  document_date: Date | null;
  posting_date: Date | null;
  company_id: number;
  purpose: string;
  from_cash_bank_id: number;
  currency_id: number;
  cash_bank_layer_id: number | null;
  transfer_amount: { toNumber(): number };
  transfer_base_amount: { toNumber(): number };
  note: string | null;
  status: string;
  created_by: number;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
  _count?: { lines: number };
};

function toRow(t: TransferRecord): TransferRow {
  return {
    id: t.id,
    transfer_no: t.transfer_no,
    document_date: t.document_date ? day(t.document_date) : null,
    posting_date: t.posting_date ? t.posting_date.toISOString() : null,
    company_id: t.company_id,
    purpose: t.purpose as TransferPurposeKey,
    from_cash_bank_id: t.from_cash_bank_id,
    currency_id: t.currency_id,
    cash_bank_layer_id: t.cash_bank_layer_id,
    transfer_amount: t.transfer_amount.toNumber(),
    transfer_base_amount: t.transfer_base_amount.toNumber(),
    note: t.note,
    status: t.status as TransferStatus,
    line_count: t._count?.lines ?? 0,
    created_by: t.created_by,
    updated_by: t.updated_by,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
  };
}

export async function listTransfers(companyIds: number[]): Promise<TransferRow[]> {
  const rows = await prisma.finCashBankTransfer.findMany({
    where: { company_id: { in: companyIds } },
    orderBy: [{ id: "desc" }],
    include: { _count: { select: { lines: true } } },
  });
  return rows.map(toRow);
}

export async function getTransfer(id: number): Promise<TransferRow | null> {
  const row = await prisma.finCashBankTransfer.findUnique({
    where: { id },
    include: { _count: { select: { lines: true } } },
  });
  return row ? toRow(row) : null;
}

export async function transferLines(
  transferId: number
): Promise<TransferLineRow[]> {
  const lines = await prisma.finCashBankTransferLine.findMany({
    where: { transfer_id: transferId },
    orderBy: { sequence_no: "asc" },
  });
  return lines.map((l) => ({
    id: l.id,
    sequence_no: l.sequence_no,
    to_cash_bank_id: l.to_cash_bank_id,
    amount: l.amount.toNumber(),
    exchange_rate: l.exchange_rate.toNumber(),
    out_amount: l.out_amount.toNumber(),
    out_base_amount: l.out_base_amount.toNumber(),
    in_amount: l.in_amount.toNumber(),
    in_base_amount: l.in_base_amount.toNumber(),
    fx_difference: l.fx_difference.toNumber(),
  }));
}

// ----------------------------------------------------------------- doc type

async function docTypeIdFor(table: string): Promise<number> {
  const row = await prisma.sysDocType.findFirstOrThrow({
    where: { doc_table: table },
    select: { id: true },
  });
  return row.id;
}

export const transferDocTypeId = () => docTypeIdFor("fin_cash_bank_transfer");

/**
 * Document numbers for a set of ids — how another module names a transfer it
 * holds a reference to, without reading `fin_cash_bank_transfer` itself.
 */
export async function transferNumbersByIds(
  ids: number[]
): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.finCashBankTransfer.findMany({
    where: { id: { in: ids } },
    select: { id: true, transfer_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.transfer_no]));
}

/** Next document number, `TRF-0001`. The format lives in `document-number.ts`. */
export async function nextTransferNo(): Promise<string> {
  return nextDocumentNumber("TRF", async () => {
    const row = await prisma.finCashBankTransfer.findFirst({
      orderBy: { id: "desc" },
      select: { transfer_no: true },
    });
    return row?.transfer_no ?? null;
  });
}

// --------------------------------------------------------------------- refs

export type TransferCashBankOption = {
  id: number;
  label: string;
  name: string;
  companyId: number;
  currencyId: number;
  currencyLabel: string;
  isBase: boolean;
  active: boolean;
  /** The open rate layers this resource holds — empty for a base-currency one. */
  layers: LayerOption[];
};

export type TransferRefs = {
  cashBanks: TransferCashBankOption[];
  currencies: { id: number; label: string; name: string; isBase: boolean; active: boolean }[];
  companies: { id: number; label: string; name: string }[];
};

/**
 * Everything the transfer form picks from, in one read.
 *
 * Layers travel with their resource rather than being fetched when one is
 * chosen: the choice happens in the browser and the page is where the database
 * is read (CLAUDE.md §3), so asking per resource would cost a round trip per
 * foreign account.
 */
export async function transferRefs(companyIds?: number[]): Promise<TransferRefs> {
  const where = companyIds ? { company_id: { in: companyIds } } : {};

  const [cashBanks, currencies, companies] = await Promise.all([
    prisma.mCashBank.findMany({
      where,
      orderBy: [{ cash_bank_label: "asc" }],
      select: {
        id: true,
        cash_bank_label: true,
        cash_bank_name: true,
        company_id: true,
        currency_id: true,
        status: true,
        currency: { select: { currency_label: true } },
      },
    }),
    prisma.refCurrency.findMany({
      orderBy: [{ currency_label: "asc" }],
      select: { id: true, currency_label: true, currency_name: true, status: true },
    }),
    prisma.sysCompany.findMany({
      where: companyIds ? { id: { in: companyIds } } : {},
      orderBy: [{ id: "asc" }],
      select: { id: true, company_label: true, company_name: true },
    }),
  ]);

  const layers = await openLayersFor(cashBanks.map((c) => c.id));

  return {
    cashBanks: cashBanks.map((c) => ({
      id: c.id,
      label: c.cash_bank_label,
      name: c.cash_bank_name,
      companyId: c.company_id,
      currencyId: c.currency_id,
      currencyLabel: c.currency.currency_label,
      isBase: isBaseCurrency(c.currency.currency_label),
      active: c.status === "Active",
      layers: layers.get(c.id) ?? [],
    })),
    currencies: currencies.map((c) => ({
      id: c.id,
      label: c.currency_label,
      name: c.currency_name,
      isBase: isBaseCurrency(c.currency_label),
      active: c.status === "Active",
    })),
    companies: companies.map((c) => ({
      id: c.id,
      label: c.company_label,
      name: c.company_name,
    })),
  };
}

// ------------------------------------------------------------------- header

export type TransferHeader = {
  purpose: string;
  from_cash_bank_id: number | null;
  currency_id: number | null;
  cash_bank_layer_id: number | null;
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
        },
      });
      if (!layer || layer.cash_bank_id !== header.from_cash_bank_id) {
        errors.cash_bank_layer_id =
          "Layer kurs tersebut bukan milik Cash & Bank sumber yang dipilih.";
      } else if (layer.status !== "Open") {
        errors.cash_bank_layer_id =
          "Layer kurs tersebut sudah habis dan tidak dapat dipakai lagi.";
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

// ------------------------------------------------------------------ posting

export type TransferPostingResult =
  | { ok: true; fxDifference: number }
  | { ok: false; errors: Record<string, string> };

/**
 * What one line moves, on both sides of the transfer.
 *
 * `outBase` and `inBase` are two independently determined facts, and on a
 * Pencairan they genuinely differ. Everywhere else they are equal because base
 * value is conserved — which is a property of the arithmetic below, not a rule
 * applied on top of it.
 */
type PlannedLine = {
  toCashBankId: number;
  /** In the document currency. */
  amount: number;
  /** The document-currency-to-base rate recorded on the line. */
  rate: number;
  /** What left the source, in the source's own currency. */
  outAmount: number;
  outBase: number;
  /** What arrived, in the destination's own currency. */
  inAmount: number;
  inBase: number;
  /** The destination's own rate, for its book entry and any layer it opens. */
  inRate: number;
  fxDifference: number;
  /** Whether this line's arrival is foreign currency acquired, so a layer opens. */
  opensLayer: boolean;
};

type TransferPlan = {
  /** What the source gives up, in its own currency, across the whole document. */
  sourceAmount: number;
  sourceBase: number;
  /** The rate the source's own book entry is valued at. */
  sourceRate: number;
  lines: PlannedLine[];
  fxDifference: number;
  fxAccountId: number | null;
};

/**
 * Everything the posting needs to know before it writes anything.
 *
 * Three shapes, and the discriminator is always **which side holds foreign
 * currency**, never the Purpose's name — the Purpose has already been checked
 * against the resources by the time this runs.
 *
 *   * The source is foreign (Transfer between foreign accounts, Pencairan).
 *     What it gives up in base is what its layer *releases*, computed per line
 *     by `drawFromLayer` so a layer drawn to nothing releases its remainder
 *     exactly rather than as a recomputed product.
 *   * The source is base. What it gives up in base is simply the rupiah, and
 *     the rate is 1 — which here means what it always should: the money is
 *     already the measure.
 *   * The destination is foreign (Transfer between foreign accounts, Pembelian
 *     Valas). It acquires currency, so it opens a layer of its own.
 *
 * The layer draws happen inside the caller's transaction, which is why this
 * takes `db` rather than reading `prisma` — a plan that spent a layer and then
 * failed to write the journal would leave the source short.
 */
async function planTransfer(
  db: Db,
  doc: {
    id: number;
    company_id: number;
    purpose: string;
    from_cash_bank_id: number;
    cash_bank_layer_id: number | null;
    currency: { currency_label: string };
    from_cash_bank: { currency: { currency_label: string } };
    lines: {
      to_cash_bank_id: number;
      amount: { toNumber(): number };
      exchange_rate: { toNumber(): number };
      to_cash_bank: { currency: { currency_label: string } };
    }[];
  },
  actorId: number
): Promise<{ ok: true; plan: TransferPlan } | { ok: false; errors: Record<string, string> }> {
  const documentCurrency = doc.currency.currency_label;
  const sourceCurrency = doc.from_cash_bank.currency.currency_label;
  const sourceIsBase = isBaseCurrency(sourceCurrency);
  const drawsLayer = consumesLayer("Out", documentCurrency, sourceCurrency);

  if (drawsLayer && !doc.cash_bank_layer_id) {
    return {
      ok: false,
      errors: {
        cash_bank_layer_id:
          "Pilih layer kurs yang dipakai. Satu transfer memakai tepat satu layer.",
      },
    };
  }

  const planned: PlannedLine[] = [];
  let sourceAmount = 0;
  let sourceBase = 0;
  /**
   * The rate the source's own book entry is valued at: the layer's where one
   * is drawn, and 1 where the source holds rupiah — which here means what it
   * always should, that the money is already the measure.
   */
  let sourceRate = 1;

  for (const line of doc.lines) {
    const amount = line.amount.toNumber();
    const rate = line.exchange_rate.toNumber();
    const destinationIsBase = isBaseCurrency(
      line.to_cash_bank.currency.currency_label
    );

    // The layer is drawn per line, which is what makes layers propagate
    // one-for-one: each destination layer is the relief of the source layer
    // for its own amount. `drawFromLayer` throws on a layer another document
    // has since spent, and a throw here takes the whole posting down.
    let releasedBase: number | undefined;
    if (drawsLayer) {
      const drawn = await drawFromLayer(db, {
        layerId: doc.cash_bank_layer_id!,
        cashBankId: doc.from_cash_bank_id,
        foreign: amount,
        actorId,
      });
      releasedBase = drawn.base;
      // Read from the draw rather than from the line, so a rate written when
      // the document was drafted cannot outvote the layer the posting actually
      // consumed.
      sourceRate = drawn.rate;
    }

    const valued = valueTransferLine({
      amount,
      rate,
      sourceIsBase,
      destinationIsBase,
      drawsLayer,
      releasedBase,
      layerRate: sourceRate,
    });

    sourceAmount = roundBase(sourceAmount + valued.outAmount);
    sourceBase = roundBase(sourceBase + valued.outBase);

    planned.push({
      toCashBankId: line.to_cash_bank_id,
      amount,
      rate,
      ...valued,
    });
  }

  const fxDifference = roundBase(
    planned.reduce((t, l) => t + l.fxDifference, 0)
  );

  // A difference has to land somewhere named. Resolved only when one actually
  // arises, so an ordinary rupiah transfer is never blocked by a setting it
  // does not use.
  let fxAccountId: number | null = null;
  if (fxDifference !== 0) {
    const company = await prisma.sysCompany.findUnique({
      where: { id: doc.company_id },
      select: { is_parent: true },
    });
    const settings = await systemDefaults();
    fxAccountId = refValueOf(
      settings,
      company?.is_parent ? "induk_fx_account" : "anak_fx_account"
    );
    if (!fxAccountId) {
      return {
        ok: false,
        errors: {
          _form:
            "Selisih kurs muncul pada transfer ini, tetapi Account Selisih Kurs " +
            "belum diatur untuk Company ini. Lengkapi di Settings › System " +
            "Default sebelum dokumen diposting.",
        },
      };
    }
  }

  return {
    ok: true,
    plan: { sourceAmount, sourceBase, sourceRate, lines: planned, fxDifference, fxAccountId },
  };
}

/**
 * The accounting entries a transfer produces.
 *
 * One credit for the source, one debit per destination, and — only where the
 * two sides disagree — the Company's FX difference account. Each line carries
 * its own currency and its own rate, because they need not be the same one: a
 * Pencairan produces a foreign credit and a rupiah debit in the same journal,
 * and the entry balances in base alone.
 */
async function transferJournalLines(
  doc: {
    transfer_no: string;
    from_cash_bank_id: number;
    lines: { to_cash_bank_id: number }[];
  },
  plan: TransferPlan,
  label: string
): Promise<
  { ok: true; lines: JournalLineInput[] } | { ok: false; errors: Record<string, string> }
> {
  const ids = [doc.from_cash_bank_id, ...plan.lines.map((l) => l.toCashBankId)];
  const resources = await prisma.mCashBank.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      account_id: true,
      currency_id: true,
      cash_bank_label: true,
    },
  });
  const byId = new Map(resources.map((r) => [r.id, r]));

  const source = byId.get(doc.from_cash_bank_id);
  if (!source) {
    return { ok: false, errors: { _form: "Cash & Bank sumber tidak ditemukan." } };
  }

  const lines: JournalLineInput[] = [
    {
      accountId: source.account_id,
      currencyId: source.currency_id,
      rate: plan.sourceRate,
      debit: 0,
      credit: plan.sourceAmount,
      baseAmount: plan.sourceBase,
      description: `${doc.transfer_no} — ${source.cash_bank_label}`,
    },
  ];

  for (const line of plan.lines) {
    const to = byId.get(line.toCashBankId);
    if (!to) {
      return { ok: false, errors: { _form: "Cash & Bank tujuan tidak ditemukan." } };
    }
    lines.push({
      accountId: to.account_id,
      currencyId: to.currency_id,
      rate: line.inRate,
      debit: line.inAmount,
      credit: 0,
      baseAmount: line.inBase,
      description: `${label} — ${to.cash_bank_label}`,
    });
  }

  // The residual, and only when there is one. Its side is the balancing side,
  // never chosen: selling above the carrying rate gave up less base than was
  // received, which is a gain on the credit side, and a loss sits on the debit
  // side for the mirror reason.
  if (plan.fxDifference !== 0 && plan.fxAccountId) {
    const magnitude = Math.abs(plan.fxDifference);
    const gain = plan.fxDifference > 0;
    const base = await prisma.refCurrency.findFirst({
      where: { currency_label: BASE_CURRENCY_LABEL },
      select: { id: true },
    });
    if (!base) {
      throw new Error(
        `Currency dasar ${BASE_CURRENCY_LABEL} tidak ada pada master. Jalankan db:seed.`
      );
    }
    lines.push({
      accountId: plan.fxAccountId,
      currencyId: base.id,
      rate: 1,
      debit: gain ? 0 : magnitude,
      credit: gain ? magnitude : 0,
      description: `Selisih kurs — ${doc.transfer_no}`,
    });
  }

  return { ok: true, lines };
}

/**
 * Post: the actual boundary, and it is one database transaction.
 *
 * Either all of this happened or none of it did:
 *
 *   1. the source **layer** is drawn down, per line, where one is involved;
 *   2. the source's **Cash Bank Book** entry and its balance — one entry for
 *      the whole document, because the money left once;
 *   3. each destination's book entry and balance;
 *   4. each destination's **rate layer**, where foreign currency arrived;
 *   5. the **Journal**, balanced in base (`postJournal`);
 *   6. what each line was worth on both sides, and the document's own dates.
 *
 * The books are written straight from the document and never derived from a
 * journal line: operational books are independent historical stores, and only
 * the General Ledger derives from journals (concept doc §2.5, §11.7).
 *
 * `recordCashBankEntry` throws on an overdrawn resource, `drawFromLayer` throws
 * on a layer another document has spent since, and `postJournal` throws on an
 * unbalanced journal. All three take the whole posting down rather than being
 * reported and skipped, which is the guarantee.
 *
 * Lives here rather than inside the Server Action so the rule is testable: the
 * action resolves a caller and then calls this, and the test suite calls the
 * same function.
 */
export async function applyTransfer(
  transferId: number,
  actorId: number
): Promise<TransferPostingResult> {
  const doc = await prisma.finCashBankTransfer.findUnique({
    where: { id: transferId },
    include: {
      lines: {
        orderBy: { sequence_no: "asc" },
        include: {
          to_cash_bank: { select: { currency: { select: { currency_label: true } } } },
        },
      },
      currency: { select: { currency_label: true } },
      from_cash_bank: {
        select: { currency: { select: { currency_label: true } } },
      },
    },
  });

  if (!doc) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (doc.status !== "Draft") {
    return {
      ok: false,
      errors: { _form: "Hanya dokumen berstatus Draft yang dapat diposting." },
    };
  }
  if (!doc.lines.length) {
    return {
      ok: false,
      errors: {
        _form: "Tambahkan minimal satu Cash & Bank tujuan sebelum dokumen diposting.",
      },
    };
  }

  const today = new Date().toISOString().slice(0, 10);

  // Both legs belong to one Company (§10 rule 84), so one period check answers
  // for the whole document — asked before the transaction opens, because a
  // refusal in there would have to be raised as a throw and rolled back.
  const period = await checkPostingPeriod(doc.company_id, today);
  if (!period.ok) return { ok: false, errors: { _form: period.message } };

  const docTypeId = await transferDocTypeId();
  const label = transferPurposeOf(doc.purpose)?.label ?? doc.purpose;
  let fxDifference = 0;

  try {
    await prisma.$transaction(async (tx) => {
      // The layers are drawn inside the transaction, which is why the plan is
      // built in here rather than before it opens: a plan that spent a layer
      // and then failed would leave the source short.
      const planned = await planTransfer(tx, doc, actorId);
      if (!planned.ok) throw new TransferRefused(planned.errors);
      const plan = planned.plan;
      fxDifference = plan.fxDifference;

      const entries = await transferJournalLines(doc, plan, label);
      if (!entries.ok) throw new TransferRefused(entries.errors);

      // The source gives up once, however many destinations there are.
      await recordCashBankEntry(tx, {
        cashBankId: doc.from_cash_bank_id,
        date: today,
        type: "Transaction",
        direction: "Out",
        amount: plan.sourceAmount,
        rate: plan.sourceRate,
        baseAmount: plan.sourceBase,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        note: `${doc.transfer_no} — ${label}`,
        actorId,
      });

      for (const [i, line] of plan.lines.entries()) {
        await recordCashBankEntry(tx, {
          cashBankId: line.toCashBankId,
          date: today,
          type: "Transaction",
          direction: "In",
          amount: line.inAmount,
          rate: line.inRate,
          baseAmount: line.inBase,
          sourceDocTypeId: docTypeId,
          sourceDocId: doc.id,
          note: `${doc.transfer_no} — ${label}`,
          actorId,
        });

        // Foreign currency arriving is currency acquired, and it acquires a
        // layer of its own — one per line, never merged with an existing one
        // and never blended with its siblings. The base is passed exactly,
        // because it is the base the source released and conservation is the
        // whole point.
        if (line.opensLayer) {
          await openLayer(tx, {
            cashBankId: line.toCashBankId,
            date: today,
            rate: line.inRate,
            foreign: line.inAmount,
            baseAmount: line.inBase,
            sourceDocTypeId: docTypeId,
            sourceDocId: doc.id,
            note: `${doc.transfer_no} — ${label}`,
            actorId,
          });
        }

        await tx.finCashBankTransferLine.update({
          where: { id: doc.lines[i].id },
          data: {
            out_amount: line.outAmount,
            out_base_amount: line.outBase,
            in_amount: line.inAmount,
            in_base_amount: line.inBase,
            fx_difference: line.fxDifference,
            updated_by: actorId,
          },
        });
      }

      // The Journal is written *alongside* the books, never from them.
      // `postJournal` throws unless the two sides sum equal, and a throw in
      // here takes the whole posting down — which is the guarantee.
      await postJournal(tx, {
        companyId: doc.company_id,
        description: `${doc.transfer_no} — ${label}`,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        lines: entries.lines,
        actorId,
      });

      await tx.finCashBankTransfer.update({
        where: { id: transferId },
        data: {
          status: "Posted",
          document_date: new Date(`${today}T00:00:00Z`),
          posting_date: new Date(),
          transfer_base_amount: plan.sourceBase,
          updated_by: actorId,
        },
      });
    });
  } catch (error) {
    // A refusal is a decision, not a failure: it is raised as a throw only
    // because it has to roll back the layers already drawn inside the
    // transaction, and it comes back out as the ordinary error shape.
    if (error instanceof TransferRefused) {
      return { ok: false, errors: error.errors };
    }
    throw error;
  }

  return { ok: true, fxDifference };
}

/**
 * A posting refused after the transaction had already opened.
 *
 * Everything a Cash Bank Transaction checks is resolved *before* its
 * transaction opens, which is the better shape. A transfer cannot do that
 * entirely: what its layer releases is known only by drawing it, and drawing it
 * is a write. So the refusals that depend on the draw are thrown and converted
 * back, and the rollback is what makes the draw safe.
 */
class TransferRefused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("Transfer ditolak");
    this.name = "TransferRefused";
  }
}

// ------------------------------------------------------------------ summary

export type TransferSummary = {
  draft: number;
  posted: number;
  cancelled: number;
  /** Posted value, per currency — amounts are never converted (CLAUDE.md §12). */
  postedTotals: MoneyTotal[];
};

export async function summariseTransfers(
  rows: TransferRow[]
): Promise<TransferSummary> {
  const currencies = await prisma.refCurrency.findMany({
    select: { id: true, currency_label: true },
  });
  const labels = new Map(currencies.map((c) => [c.id, c.currency_label]));

  const posted = rows.filter((r) => r.status === "Posted");
  return {
    draft: rows.filter((r) => r.status === "Draft").length,
    posted: posted.length,
    cancelled: rows.filter((r) => r.status === "Cancelled").length,
    postedTotals: sumByCurrency(
      posted.map((r) => ({
        currencyId: r.currency_id,
        currencyLabel: labels.get(r.currency_id) ?? "?",
        amount: r.transfer_amount,
      }))
    ),
  };
}
