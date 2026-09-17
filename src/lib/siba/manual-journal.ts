import "server-only";

import { prisma } from "@/lib/prisma";
import { compareCodes } from "./account-code";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "./currency";
import {
  cancelDraftJournal,
  createDraftJournal,
  postDraftJournal,
  readDraftJournal,
  updateDraftJournal,
  type DraftJournalLine,
  type JournalLineInput,
} from "./journal";
import { controlAccountReasons } from "./records";
import { systemDefaultsUsingAccount } from "./system-settings";

/**
 * The manual journal — what a person may write into the books by hand.
 *
 * Every other journal in this application is produced by a document being
 * posted. A manual journal has no document behind it: it is depreciation, an
 * accrual, a reclassification between two expense accounts, an equity entry —
 * the work that is real accounting but is not a cash movement anybody could
 * raise a Budget for.
 *
 * ## The one thing it must never do
 *
 * **A manual journal may not create a discrepancy between the General Ledger
 * and a book.** The operational books — the Cash Bank Book, its rate layers,
 * and the six subject books — are independent historical stores written
 * alongside the journal by the same posting (concept doc §2.5). They agree with
 * the General Ledger because one posting writes both. A hand-written journal
 * line touching an account one of those books reconciles against would move the
 * General Ledger and leave the book behind, and nothing would error: the
 * application would simply stop being able to prove its own figures.
 *
 * So the rule is structural rather than advisory. An account is selectable when
 * it is **postable** and **not a control account**, and those two flags are the
 * whole test — `is_postable` says it is a place money lands rather than a
 * heading, `is_control_account` says a book outside the General Ledger already
 * reconciles against it. Everything that makes an account a book's counterpart
 * sets that flag when it claims the account, so the two questions the picker
 * asks are the two questions the Server Action asks.
 *
 * What remains reachable is exactly what should be: expense and asset accounts,
 * accruals, prepaid, accumulated depreciation, equity. A Biaya mapping target
 * is *not* a control account, because Biaya keeps no subject book — it
 * reconciles against the General Ledger and nothing else.
 *
 * ## What it inherits unchanged
 *
 * The balance rule, the base-currency measure and the posting date all come
 * from `journal.ts` and are not restated here. Debit and kredit are **always**
 * base currency; a foreign line carries its own currency, its kurs and its face
 * amount as extra information on the same row, exactly as an automatically
 * posted foreign line does.
 */

// --------------------------------------------------------------- the input

export type ManualJournalHeader = {
  company_id: number | null;
  description: string;
};

/** One row of the line editor, as the form submits it. */
export type ManualJournalLineValues = {
  account_id: number | null;
  partner_id: number | null;
  currency_id: number | null;
  /** Null on a base-currency line, where the rate is 1 and is not asked for. */
  exchange_rate: number | null;
  /** In the line's own currency. Exactly one of the two is non-zero. */
  debit: number;
  credit: number;
  description: string;
};

export type ManualJournalCheck =
  | {
      ok: true;
      companyId: number;
      description: string;
      lines: JournalLineInput[];
      /** Base-currency totals, so the caller can report an imbalance. */
      debit: number;
      credit: number;
    }
  | { ok: false; errors: Record<string, string> };

/** `lines.2.account_id` — the form addresses its own rows the same way. */
const lineKey = (index: number, field: string) => `lines.${index}.${field}`;

// ------------------------------------------------------------- the options

export type ManualJournalAccount = {
  id: number;
  label: string;
  name: string;
  normalBalance: string;
  requirePartner: boolean;
  partnerCategoryId: number | null;
};

export type ManualJournalPartner = {
  id: number;
  label: string;
  name: string;
  categoryId: number | null;
};

export type ManualJournalCurrency = {
  id: number;
  label: string;
  name: string;
  isBase: boolean;
};

export type ManualJournalOptions = {
  accounts: ManualJournalAccount[];
  partners: ManualJournalPartner[];
  currencies: ManualJournalCurrency[];
};

/**
 * What a line may be built from, for one Company.
 *
 * The accounts are narrowed by the same two flags the check enforces, plus the
 * tree itself: `children: none` rather than `is_postable` alone, because the
 * flag is what the application writes when an account gains a sub-account and
 * the shape of the tree is what makes it true.
 *
 * An inactive account is not offered. Unlike a ledger report — which must be
 * runnable for an account that closed last quarter — a manual journal writes
 * something new, and nothing new belongs in a closed account.
 */
export async function manualJournalOptions(
  companyId: number
): Promise<ManualJournalOptions> {
  const [accounts, partners, currencies] = await Promise.all([
    prisma.accAccount.findMany({
      where: {
        company_id: companyId,
        is_active: true,
        is_postable: true,
        is_control_account: false,
        children: { none: {} },
      },
      select: {
        id: true,
        account_label: true,
        account_name: true,
        normal_balance: true,
        require_partner: true,
        partner_category_id: true,
      },
    }),
    prisma.mPartner.findMany({
      where: { company_id: companyId, status: "Active" },
      orderBy: { partner_label: "asc" },
      select: {
        id: true,
        partner_label: true,
        partner_name: true,
        category_id: true,
      },
    }),
    prisma.refCurrency.findMany({
      where: { status: "Active" },
      orderBy: { currency_label: "asc" },
      select: { id: true, currency_label: true, currency_name: true },
    }),
  ]);

  return {
    accounts: accounts
      .sort((a, b) => compareCodes(a.account_label, b.account_label))
      .map((a) => ({
        id: a.id,
        label: a.account_label,
        name: a.account_name,
        normalBalance: a.normal_balance,
        requirePartner: a.require_partner,
        partnerCategoryId: a.partner_category_id,
      })),
    partners: partners.map((p) => ({
      id: p.id,
      label: p.partner_label,
      name: p.partner_name,
      categoryId: p.category_id,
    })),
    currencies: currencies.map((c) => ({
      id: c.id,
      label: c.currency_label,
      name: c.currency_name,
      isBase: isBaseCurrency(c.currency_label),
    })),
  };
}

// -------------------------------------------------------------- the checks

/**
 * Why this account may not be written to by hand, or null when it may.
 *
 * The two flags are the test, and the refusal **names the book** rather than
 * stating the flag: "tidak dapat dipilih" tells a user nothing they can act on,
 * while "direkonsiliasi dengan Buku Hutang" says which document they should
 * have raised instead. The reasons come from the structure rather than from the
 * flag, so an account someone declared a control account by hand still refuses
 * — it simply refuses without naming a book, because there is none to name.
 */
async function refuseAccount(
  account: {
    id: number;
    account_label: string;
    is_postable: boolean;
    is_active: boolean;
    is_control_account: boolean;
    company_id: number;
    _count: { children: number };
  },
  companyId: number
): Promise<string | null> {
  if (account.company_id !== companyId) {
    return "Account tersebut milik Company lain.";
  }
  if (!account.is_active) {
    return "Account tersebut non-aktif.";
  }
  if (!account.is_postable || account._count.children > 0) {
    return "Account ini adalah header dan tidak menerima posting. Pilih salah satu sub-accountnya.";
  }
  if (account.is_control_account) {
    const reasons = await controlAccountReasons(account.id);
    const defaults = await systemDefaultsUsingAccount(account.id);
    const named = [...reasons, ...defaults];
    return named.length
      ? `Account ${account.account_label} adalah control account yang direkonsiliasi dengan ${named.join(
          ", "
        )}. Catat lewat dokumen yang menulis buku tersebut, bukan Journal Manual.`
      : `Account ${account.account_label} ditandai sebagai control account dan tidak dapat diisi lewat Journal Manual.`;
  }
  return null;
}

/**
 * The whole document, checked.
 *
 * Reachable from a test, which is why it lives here rather than inside the
 * Server Action: an action resolves its caller from a session cookie, and a
 * test process has none.
 *
 * The balance is computed but **not** refused — a journal halfway through being
 * typed does not balance, and a draft is allowed to be halfway through. Post is
 * where the balance is enforced, by the same engine every other journal goes
 * through.
 */
export async function checkManualJournal(
  header: ManualJournalHeader,
  lines: ManualJournalLineValues[]
): Promise<ManualJournalCheck> {
  const errors: Record<string, string> = {};

  const companyId = header.company_id;
  if (!companyId) errors.company_id = "Company wajib dipilih.";

  const description = String(header.description ?? "").trim();
  if (!description) errors.description = "Keterangan wajib diisi.";

  // Two lines is the least a journal can be: something given up and something
  // received. One line cannot balance against anything.
  if (lines.length < 2) {
    errors._form = "Journal memerlukan minimal dua baris.";
  }

  if (!companyId || Object.keys(errors).length) {
    return { ok: false, errors };
  }

  const accountIds = [...new Set(lines.map((l) => l.account_id).filter(Boolean))] as number[];
  const partnerIds = [...new Set(lines.map((l) => l.partner_id).filter(Boolean))] as number[];
  const currencyIds = [...new Set(lines.map((l) => l.currency_id).filter(Boolean))] as number[];

  const [accounts, partners, currencies] = await Promise.all([
    prisma.accAccount.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true,
        account_label: true,
        account_name: true,
        company_id: true,
        is_postable: true,
        is_active: true,
        is_control_account: true,
        require_partner: true,
        partner_category_id: true,
        _count: { select: { children: true } },
      },
    }),
    prisma.mPartner.findMany({
      where: { id: { in: partnerIds } },
      select: {
        id: true,
        partner_label: true,
        company_id: true,
        status: true,
        category_id: true,
      },
    }),
    prisma.refCurrency.findMany({
      where: { id: { in: currencyIds } },
      select: { id: true, currency_label: true, status: true },
    }),
  ]);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const partnerById = new Map(partners.map((p) => [p.id, p]));
  const currencyById = new Map(currencies.map((c) => [c.id, c]));

  const resolved: JournalLineInput[] = [];
  let debit = 0;
  let credit = 0;

  for (const [i, line] of lines.entries()) {
    const account = line.account_id ? accountById.get(line.account_id) : null;
    if (!account) {
      errors[lineKey(i, "account_id")] = "Account wajib dipilih.";
      continue;
    }

    const refused = await refuseAccount(account, companyId);
    if (refused) {
      errors[lineKey(i, "account_id")] = refused;
      continue;
    }

    // An account that names a Partner Category keeps a subject history per
    // Partner, so a line on it without a Partner would be a movement with no
    // subject. The category must match too — that is what the column is for.
    let partnerId: number | null = null;
    if (account.require_partner) {
      const partner = line.partner_id ? partnerById.get(line.partner_id) : null;
      if (!partner) {
        errors[lineKey(i, "partner_id")] =
          "Account ini wajib menyebut Partner.";
      } else if (partner.company_id !== companyId) {
        errors[lineKey(i, "partner_id")] =
          "Partner tersebut milik Company lain.";
      } else if (partner.status !== "Active") {
        errors[lineKey(i, "partner_id")] = "Partner tersebut non-aktif.";
      } else if (
        account.partner_category_id &&
        partner.category_id !== account.partner_category_id
      ) {
        errors[lineKey(i, "partner_id")] =
          "Partner Category tidak sesuai dengan yang ditetapkan pada Account.";
      } else {
        partnerId = partner.id;
      }
    }

    const currency = line.currency_id ? currencyById.get(line.currency_id) : null;
    if (!currency) {
      errors[lineKey(i, "currency_id")] = "Currency wajib dipilih.";
      continue;
    }

    // A rate of 1 is correct only where the money is already base currency.
    // Between two foreign amounts it would assert that USD 100 is IDR 100
    // (CLAUDE.md §10 rule 68), so a foreign line states the kurs the entry was
    // valued at and a base line is never asked for one.
    const base = isBaseCurrency(currency.currency_label);
    let rate = 1;
    if (!base) {
      const entered = line.exchange_rate;
      if (!entered || !(entered > 0)) {
        errors[lineKey(i, "exchange_rate")] =
          `Kurs ${currency.currency_label} ke ${BASE_CURRENCY_LABEL} wajib diisi.`;
        continue;
      }
      rate = entered;
    }

    const d = Math.max(0, Number(line.debit) || 0);
    const c = Math.max(0, Number(line.credit) || 0);
    const onDebit = Math.round(d * 100) > 0;
    const onCredit = Math.round(c * 100) > 0;
    if (onDebit === onCredit) {
      errors[lineKey(i, "amount")] = onDebit
        ? "Isi debit atau kredit, bukan keduanya."
        : "Nominal wajib diisi pada salah satu sisi.";
      continue;
    }

    const text = String(line.description ?? "").trim();
    resolved.push({
      accountId: account.id,
      partnerId,
      currencyId: currency.id,
      rate,
      debit: onDebit ? d : 0,
      credit: onCredit ? c : 0,
      // A line with nothing of its own to say borrows the journal's — every
      // line carries a description, and an empty one reads as a gap in the
      // General Ledger rather than as brevity.
      description: text || description,
    });

    const valued = Math.round((onDebit ? d : c) * rate * 100) / 100;
    if (onDebit) debit += valued;
    else credit += valued;
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return { ok: true, companyId, description, lines: resolved, debit, credit };
}

// ----------------------------------------------------------- the lifecycle

export type ManualJournalResult =
  | { ok: true; id: number; journalNo: string }
  | { ok: false; errors: Record<string, string> };

export async function createManualJournal(
  header: ManualJournalHeader,
  lines: ManualJournalLineValues[],
  actorId: number
): Promise<ManualJournalResult> {
  const checked = await checkManualJournal(header, lines);
  if (!checked.ok) return { ok: false, errors: checked.errors };

  const created = await createDraftJournal({
    companyId: checked.companyId,
    description: checked.description,
    lines: checked.lines,
    actorId,
  });
  return { ok: true, id: created.id, journalNo: created.journalNo };
}

export async function updateManualJournal(
  id: number,
  header: ManualJournalHeader,
  lines: ManualJournalLineValues[],
  actorId: number,
  companyIds: number[]
): Promise<ManualJournalResult> {
  const existing = await draftOrRefusal(id, companyIds);
  if ("errors" in existing) return { ok: false, errors: existing.errors };

  const checked = await checkManualJournal(header, lines);
  if (!checked.ok) return { ok: false, errors: checked.errors };

  await updateDraftJournal(id, {
    companyId: checked.companyId,
    description: checked.description,
    lines: checked.lines,
    actorId,
  });
  return { ok: true, id, journalNo: existing.journalNo };
}

/**
 * Post: re-checked, then handed to the engine.
 *
 * The accounts are checked **again here**, not trusted from when the draft was
 * written: a mapping made in the meantime can have turned one of them into a
 * control account, and posting against a chart that has moved on would write
 * exactly the discrepancy this module exists to prevent. The same reasoning
 * `applyPosting` uses for re-reading its Budgets at Post.
 */
export async function postManualJournal(
  id: number,
  actorId: number,
  companyIds: number[]
): Promise<ManualJournalResult> {
  const existing = await draftOrRefusal(id, companyIds);
  if ("errors" in existing) return { ok: false, errors: existing.errors };

  const recheck = await checkManualJournal(
    { company_id: existing.companyId, description: existing.description },
    existing.lines
  );
  // Post is reached from a detail page rather than from the line editor, so a
  // per-line error has nothing to attach itself to. The refusals are stated in
  // full instead of being keyed to fields nobody is looking at.
  if (!recheck.ok) {
    return {
      ok: false,
      errors: { _form: Object.values(recheck.errors).join(" ") },
    };
  }

  const posted = await postDraftJournal(id, actorId);
  if (!posted.ok) return { ok: false, errors: { _form: posted.error } };

  return { ok: true, id, journalNo: posted.journalNo };
}

export async function cancelManualJournal(
  id: number,
  actorId: number,
  companyIds: number[]
): Promise<ManualJournalResult> {
  const existing = await draftOrRefusal(id, companyIds);
  if ("errors" in existing) return { ok: false, errors: existing.errors };

  const cancelled = await cancelDraftJournal(id, actorId);
  if (!cancelled.ok) return { ok: false, errors: { _form: cancelled.error } };

  return { ok: true, id, journalNo: existing.journalNo };
}

/**
 * The draft, or the reason there isn't one.
 *
 * Every write path asks this first. `is_manual` is checked as well as the
 * status, even though only a manual journal is ever a draft: the day something
 * else stages a journal, this refuses rather than quietly editing it.
 *
 * A journal belonging to a Company the caller may not see reads as **not
 * found**, which is the same answer one that does not exist gives — the
 * convention every scoped reader in the application follows.
 */
async function draftOrRefusal(
  id: number,
  companyIds: number[]
): Promise<
  | {
      journalNo: string;
      companyId: number;
      description: string;
      lines: ManualJournalLineValues[];
    }
  | { errors: Record<string, string> }
> {
  const journal = await readDraftJournal(id, companyIds);
  if (!journal) return { errors: { _form: "Journal tidak ditemukan." } };
  if (!journal.isManual) {
    return {
      errors: {
        _form:
          "Journal ini dibuat oleh posting dokumen dan tidak dapat diubah. " +
          "Koreksi dilakukan sebagai transaksi baru.",
      },
    };
  }
  if (journal.status !== "Draft") {
    return {
      errors: {
        _form:
          "Journal hanya dapat diubah selama berstatus Draft. Journal yang " +
          "sudah diposting bersifat final.",
      },
    };
  }

  return {
    journalNo: journal.journalNo,
    companyId: journal.companyId,
    description: journal.description,
    lines: journal.lines.map(toLineValues),
  };
}

/**
 * A stored line, back in the shape the form and the check speak.
 *
 * A base-currency line reports **no** kurs rather than `1`: the field is not
 * asked for on one, and putting a number back into it would invite somebody to
 * change it (CLAUDE.md §10 rule 68).
 */
export function toLineValues(line: DraftJournalLine): ManualJournalLineValues {
  return {
    account_id: line.accountId,
    partner_id: line.partnerId,
    currency_id: line.currencyId,
    exchange_rate: isBaseCurrency(line.currencyLabel) ? null : line.rate,
    debit: line.debit,
    credit: line.credit,
    description: line.description,
  };
}
