import "server-only";

import { prisma } from "@/lib/prisma";
import { BASE_CURRENCY_LABEL, maySettle, rateSource, settlementRefusal } from "./currency";
import { eligibleBudgets, fundingRoute, type TransactionHeader, type FundingRoute } from "./finance";
import { transactingCompany } from "./finance-options";

/** The rules a Realisasi header and its lines are held to — the enforcement `app/actions/finance.ts` calls. */

// ------------------------------------------------------------- enforcement

export type HeaderCheck =
  | {
      ok: true;
      direction: "In" | "Out";
      companyId: number;
      /** Null on the funded route: the anak has no resource of its own. */
      cashBankId: number | null;
      currencyId: number;
      /** The document's own currency, which need not be the resource's. */
      currencyLabel: string;
      /** The paying resource's currency, or "" on the funded route. */
      resourceCurrencyLabel: string;
      /** The kurs this document is valued at — entered, read off a layer, or 1. */
      rate: number;
      /** The layer the payment draws on, where one is involved. */
      layerId: number | null;
      route: FundingRoute;
    }
  | { ok: false; errors: Record<string, string> };

/**
 * The document header, checked against every rule at once.
 *
 * The form narrows each picker as the user goes, but a Server Action is
 * reachable directly with any combination of ids — this is what actually
 * enforces the chain Company -> Cash & Bank -> Currency -> kurs.
 *
 * **Which Company decides the shape of the rest.** The induk holds the cash, so
 * its documents name a Cash & Bank and take their currency from it. The anak
 * holds none by design (concept doc §25, §32), so its documents name a Currency
 * instead and are refused if they name a resource at all — including a resource
 * belonging to the induk, which is exactly the submission this rule exists to
 * stop. What the anak's document then does is raise a Funding Request; the
 * money still only ever leaves an induk resource.
 */
export async function checkHeader(
  header: TransactionHeader
): Promise<HeaderCheck> {
  const errors: Record<string, string> = {};

  const direction = header.transaction_type;
  if (direction !== "In" && direction !== "Out") {
    return {
      ok: false,
      errors: { _form: "Arah realisasi tidak dikenali." },
    };
  }

  const induk = await transactingCompany();
  if (!induk) {
    return {
      ok: false,
      errors: { _form: "Company induk belum tersedia pada master Company." },
    };
  }

  let route: FundingRoute | null = null;
  let currencyId = 0;
  let cashBankId: number | null = null;
  /** The paying resource's own currency, where there is a resource. */
  let resourceCurrencyLabel = "";
  if (!header.company_id) {
    errors.company_id = "Company wajib dipilih.";
  } else {
    route = await fundingRoute(header.company_id);
    if (!route) errors.company_id = "Company tidak ditemukan.";
  }

  // The document's own currency, on both routes. It used to be read off the
  // Cash & Bank on the self route, which stopped working the moment a foreign
  // document could be paid from a base-currency resource: the two are no longer
  // the same question.
  let currencyLabel = "";
  if (!header.currency_id) {
    errors.currency_id = "Currency wajib dipilih.";
  } else {
    const currency = await prisma.refCurrency.findUnique({
      where: { id: header.currency_id },
      select: { id: true, status: true, currency_label: true },
    });
    if (!currency) errors.currency_id = "Currency tidak ditemukan.";
    else if (currency.status !== "Active") {
      errors.currency_id = "Currency tersebut non-aktif dan tidak dapat dipakai.";
    } else {
      currencyId = currency.id;
      currencyLabel = currency.currency_label;
    }
  }

  if (route === "treasury") {
    if (header.cash_bank_id) {
      errors.cash_bank_id =
        "Company anak tidak memiliki Cash & Bank sendiri. Dana disediakan " +
        "Company induk melalui Funding Request.";
    }
  } else if (route === "self") {
    if (!header.cash_bank_id) {
      errors.cash_bank_id = "Cash & Bank wajib dipilih.";
    } else {
      const cashBank = await prisma.mCashBank.findUnique({
        where: { id: header.cash_bank_id },
        select: {
          company_id: true,
          status: true,
          currency_id: true,
          currency: { select: { currency_label: true } },
        },
      });
      if (!cashBank) errors.cash_bank_id = "Cash & Bank tidak ditemukan.";
      else if (cashBank.company_id !== header.company_id) {
        errors.cash_bank_id =
          "Cash & Bank harus milik Company yang sama dengan dokumen.";
      } else if (cashBank.status !== "Active") {
        errors.cash_bank_id =
          "Cash & Bank tersebut non-aktif dan tidak dapat dipakai.";
      } else if (
        currencyLabel &&
        !maySettle(currencyLabel, cashBank.currency.currency_label)
      ) {
        // Crossing goes through the base currency only: a foreign document is
        // paid from its own currency or from rupiah, and never from a third
        // currency. `lib/siba/currency.ts` is the one place that rule lives.
        errors.cash_bank_id = settlementRefusal(
          currencyLabel,
          cashBank.currency.currency_label
        )!;
      } else {
        cashBankId = header.cash_bank_id;
        resourceCurrencyLabel = cashBank.currency.currency_label;
      }
    }
  }

  // Where the kurs comes from, and therefore what the header must carry. One
  // control on the form, three provenances — and a rate of `1` means the money
  // is base currency, never that two foreign amounts happen to match.
  let rate = 1;
  let layerId: number | null = null;
  if (route === "self" && currencyLabel && resourceCurrencyLabel) {
    const source = rateSource(
      direction,
      currencyLabel,
      resourceCurrencyLabel
    );

    if (source === "entered") {
      const entered = header.exchange_rate ?? 0;
      if (!(entered > 0)) {
        errors.exchange_rate =
          `Isi kurs — berapa nilai 1 ${currencyLabel} dalam ` +
          `${BASE_CURRENCY_LABEL} pada transaksi ini.`;
      } else {
        rate = entered;
      }
      if (header.cash_bank_layer_id) {
        errors.cash_bank_layer_id =
          "Transaksi ini tidak mengambil dari layer kurs mana pun.";
      }
    } else if (source === "layer") {
      if (!header.cash_bank_layer_id) {
        errors.cash_bank_layer_id =
          "Pilih layer kurs yang dipakai. Satu transaksi memakai tepat satu layer.";
      } else {
        const layer = await prisma.cashBankLayer.findUnique({
          where: { id: header.cash_bank_layer_id },
          select: { cash_bank_id: true, status: true, rate: true },
        });
        if (!layer || layer.cash_bank_id !== cashBankId) {
          errors.cash_bank_layer_id =
            "Layer kurs tersebut bukan milik Cash & Bank yang dipilih.";
        } else if (layer.status !== "Open") {
          errors.cash_bank_layer_id =
            "Layer kurs tersebut sudah habis dan tidak dapat dipakai lagi.";
        } else {
          rate = layer.rate.toNumber();
          layerId = header.cash_bank_layer_id;
        }
      }
    } else if (header.exchange_rate && header.exchange_rate !== 1) {
      // `identity`: rupiah moving through a rupiah account. A rate here would
      // be a rate between the base currency and itself.
      errors.exchange_rate =
        `Dokumen dalam ${BASE_CURRENCY_LABEL} tidak memakai kurs.`;
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    direction,
    companyId: header.company_id!,
    cashBankId,
    currencyId,
    currencyLabel,
    resourceCurrencyLabel,
    rate,
    layerId,
    route: route!,
  };
}

export type LineInput = {
  budget_id: number;
  /** Ignored on a line lowering a position: there it is the sum of its items. */
  amount: number;
  /** The open items a lowering line settles, each for the amount the user chose. */
  items?: { item_id: number; amount: number }[];
};

/** One chosen open item on a checked line. */
export type CheckedItem = { itemId: number; amount: number };

export type LineCheck =
  | {
      ok: true;
      lines: {
        budgetId: number;
        amount: number;
        outstanding: number;
        items: CheckedItem[];
      }[];
      total: number;
    }
  | { ok: false; errors: Record<string, string> };

/**
 * The lines, checked against the header that is supposed to admit them.
 *
 * Every line is re-derived from `eligibleBudgets` rather than trusted: the form
 * drops rows that stop qualifying as the header changes, but a direct call
 * could name any budget id at all.
 *
 * Over-realization is allowed on purpose — concept doc §6.5 permits it and the
 * Post dialog says so — because a real payment can legitimately exceed its
 * plan, and refusing it would push the difference off the books.
 */
export async function checkLines(
  header: TransactionHeader,
  lines: LineInput[],
  options: { excludeTransactionId?: number } = {}
): Promise<LineCheck> {
  // A line lowering a position is worth what its chosen items add up to;
  // whatever amount came with it is not trusted.
  const amountOf = (l: LineInput) =>
    l.items?.length
      ? Math.round(l.items.reduce((t, it) => t + (it.amount > 0 ? it.amount : 0), 0) * 100) / 100
      : l.amount;
  const wanted = lines.filter((l) => amountOf(l) > 0);
  if (!wanted.length) {
    return {
      ok: false,
      errors: {
        _lines: lines.length
          ? "Nominal realisasi setiap Budget harus lebih dari nol."
          : "Dokumen harus merealisasikan minimal satu Budget.",
      },
    };
  }

  const seen = new Set<number>();
  for (const l of wanted) {
    if (seen.has(l.budget_id)) {
      return {
        ok: false,
        errors: { _lines: "Satu Budget hanya boleh muncul sekali dalam dokumen." },
      };
    }
    seen.add(l.budget_id);
  }

  const eligible = await eligibleBudgets(header, options);
  const byId = new Map(eligible.map((b) => [b.id, b]));

  const resolved: {
    budgetId: number;
    amount: number;
    outstanding: number;
    items: CheckedItem[];
  }[] = [];
  // What each open item still holds, drawn down line by line: two lines may
  // settle one item, and together they may not take it below nothing.
  const itemLeft = new Map<number, number>();
  for (const l of wanted) {
    const budget = byId.get(l.budget_id);
    if (!budget) {
      return {
        ok: false,
        errors: {
          _lines:
            "Ada Budget pada dokumen ini yang tidak lagi memenuhi kriteria header. " +
            "Buka kembali dokumen dan pilih ulang Budget-nya.",
        },
      };
    }

    const chosen = l.items ?? [];
    const checked: CheckedItem[] = [];
    if (!budget.lowers) {
      if (chosen.length) {
        return {
          ok: false,
          errors: {
            _lines:
              `${budget.budget_no} tidak menurunkan posisi buku subjek, sehingga ` +
              "tidak menyelesaikan open item — posting akan membuka item baru.",
          },
        };
      }
    } else {
      if (!chosen.length) {
        return {
          ok: false,
          errors: {
            _lines:
              `Pilih open item yang diselesaikan ${budget.budget_no}, dan nominal ` +
              "untuk setiap item. Realisasi yang menurunkan posisi menunjuk open item-nya.",
          },
        };
      }
      const once = new Set<number>();
      for (const c of chosen) {
        if (once.has(c.item_id)) {
          return {
            ok: false,
            errors: {
              _lines: `Satu open item hanya boleh dipilih sekali pada ${budget.budget_no}.`,
            },
          };
        }
        once.add(c.item_id);
        // The pool offers only this line's own open items, so an id outside
        // it is another subject's item, a cleared one, or one that does not
        // exist.
        const offered = budget.items.find((i) => i.id === c.item_id);
        if (!offered) {
          return {
            ok: false,
            errors: {
              _lines:
                `Open item pada ${budget.budget_no} bukan milik Partner, buku, dan ` +
                "currency Budget ini, atau sudah selesai.",
            },
          };
        }
        if (!(c.amount > 0)) {
          return {
            ok: false,
            errors: {
              _lines: `Nominal untuk ${offered.itemNo} pada ${budget.budget_no} harus lebih dari nol.`,
            },
          };
        }
        const left = (itemLeft.get(c.item_id) ?? offered.remaining) - c.amount;
        if (Math.round(left * 100) < 0) {
          return {
            ok: false,
            errors: {
              _lines:
                `Nominal untuk ${offered.itemNo} pada ${budget.budget_no} melebihi ` +
                "sisa open item itu. Posisi buku subjek tidak boleh di bawah nol — " +
                "kurangi nominalnya.",
            },
          };
        }
        itemLeft.set(c.item_id, left);
        checked.push({ itemId: c.item_id, amount: c.amount });
      }
    }

    resolved.push({
      budgetId: budget.id,
      amount: amountOf(l),
      outstanding: budget.outstanding,
      items: checked,
    });
  }

  const total = resolved.reduce((t, l) => t + l.amount, 0);

  // The layer cap. One transaction draws on one layer, so the document is
  // limited to what that layer still holds — whatever the account holds
  // overall. A resource with five layers of a million each holds five million
  // and cannot pay one and a half in a single document.
  //
  // Checked here rather than only at Post because it couples two things the
  // form keeps apart: the Budget lines being filled in, and the kurs chosen in
  // the header. Whichever is chosen second has to validate against the first.
  if (header.cash_bank_layer_id) {
    const layer = await prisma.cashBankLayer.findUnique({
      where: { id: header.cash_bank_layer_id },
      select: { foreign_remaining: true, status: true, layer_no: true },
    });
    if (layer && layer.status === "Open") {
      const remaining = layer.foreign_remaining.toNumber();
      if (total > remaining) {
        return {
          ok: false,
          errors: {
            _lines:
              `Total realisasi ${total} melebihi sisa layer ${layer.layer_no} ` +
              `yang tinggal ${remaining}. Satu transaksi memakai tepat satu ` +
              "layer — kurangi nominalnya, pilih layer lain, atau pecah dokumen.",
          },
        };
      }
    }
  }

  return { ok: true, lines: resolved, total };
}

