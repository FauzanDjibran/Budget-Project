import "server-only";

import { prisma } from "@/lib/prisma";
import { compareCodes } from "./account-code";
import { cashBankBalanceMap } from "./cash-bank";
import { layersByIds, openLayersFor, type LayerOption } from "./cash-bank-layers";
import { isBaseCurrency } from "./currency";
import { openSubledgerItemsFor, subledgerItemsByIds, type SubledgerItem } from "./subledger";
import { loadSubledgers } from "./subledger-data";
import type { GeneralJournalStatus } from "./general-journal-workflow";

/**
 * What the Jurnal Umum screens read: the register, one journal with its lines
 * named, and what a line may be built from. Split from `general-journal.ts` by
 * concern, like every posting document's `-rows`; one module for the contract.
 */

export type GeneralJournalRow = {
  id: number;
  journalNo: string;
  accountingDate: string | null;
  companyLabel: string;
  description: string;
  status: GeneralJournalStatus;
  /** Base total of the debit side, the generated Selisih line included. */
  amount: number;
  lineCount: number;
};

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Every Jurnal Umum of these Companies, newest first. */
export async function listGeneralJournals(companyIds: number[]): Promise<GeneralJournalRow[]> {
  const rows = await prisma.accGeneralJournal.findMany({
    where: { company_id: { in: companyIds } },
    orderBy: { id: "desc" },
    include: {
      company: { select: { company_label: true } },
      lines: { select: { debit_amount: true, is_generated: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    journalNo: r.journal_no,
    accountingDate: day(r.accounting_date),
    companyLabel: r.company.company_label,
    description: r.description,
    status: r.status as GeneralJournalStatus,
    amount: Math.round(r.lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0) * 100) / 100,
    lineCount: r.lines.filter((l) => !l.is_generated).length,
  }));
}

export type GeneralJournalLineRow = {
  id: number;
  accountId: number;
  accountLabel: string;
  accountName: string;
  ledger: string;
  /** The book a Partner line writes into, and its direction. */
  bookId: number | null;
  bookName: string | null;
  raises: "In" | "Out" | null;
  partnerId: number | null;
  partnerLabel: string | null;
  partnerName: string | null;
  currencyId: number;
  currencyLabel: string;
  foreign: boolean;
  rate: number;
  trxAmount: number;
  debit: number;
  credit: number;
  description: string;
  isGenerated: boolean;
  subjectId: number | null;
  /** The open item's number, or the Cash & Bank's label. */
  subjectLabel: string | null;
  layerId: number | null;
  layerNo: string | null;
  balanceBefore: number | null;
};

export type GeneralJournalDetail = {
  id: number;
  journalNo: string;
  companyId: number;
  companyLabel: string;
  companyName: string;
  accountingDate: string | null;
  description: string;
  status: GeneralJournalStatus;
  postedJournalId: number | null;
  postedJournalNo: string | null;
  lines: GeneralJournalLineRow[];
  debit: number;
  credit: number;
};

/** One Jurnal Umum, or null where it does not exist for this reader. */
export async function getGeneralJournal(
  id: number,
  companyIds: number[]
): Promise<GeneralJournalDetail | null> {
  const j = await prisma.accGeneralJournal.findFirst({
    where: { id, company_id: { in: companyIds } },
    include: {
      company: { select: { company_label: true, company_name: true } },
      posted_journal: { select: { journal_no: true } },
      lines: {
        orderBy: { sequence_no: "asc" },
        include: {
          account: {
            select: { account_label: true, account_name: true, ledger: true },
          },
          partner: { select: { partner_label: true, partner_name: true } },
          currency: { select: { currency_label: true } },
        },
      },
    },
  });
  if (!j) return null;

  const subjectIds = (ledger: string) =>
    j.lines.filter((l) => l.account.ledger === ledger && l.subject_id).map((l) => l.subject_id!);
  const [books, items, cashBanks, layers] = await Promise.all([
    loadSubledgers(),
    subledgerItemsByIds(subjectIds("partner")),
    prisma.mCashBank.findMany({
      where: { id: { in: subjectIds("cash_bank") } },
      select: { id: true, cash_bank_label: true },
    }),
    layersByIds(j.lines.filter((l) => l.cash_bank_layer_id).map((l) => l.cash_bank_layer_id!)),
  ]);
  const itemNo = new Map(items.map((i) => [i.id, i.itemNo]));
  const cashLabel = new Map(cashBanks.map((c) => [c.id, c.cash_bank_label]));

  const lines = j.lines.map((l) => {
    const book = books.find((b) => b.categoryId === l.budget_category_id);
    return {
      id: l.id,
      accountId: l.account_id,
      accountLabel: l.account.account_label,
      accountName: l.account.account_name,
      ledger: l.account.ledger,
      bookId: l.budget_category_id,
      bookName: book?.name ?? null,
      raises: book?.raises ?? null,
      partnerId: l.partner_id,
      partnerLabel: l.partner?.partner_label ?? null,
      partnerName: l.partner?.partner_name ?? null,
      currencyId: l.currency_id,
      currencyLabel: l.currency.currency_label,
      foreign: !isBaseCurrency(l.currency.currency_label),
      rate: l.exchange_rate.toNumber(),
      trxAmount: l.trx_amount.toNumber(),
      debit: l.debit_amount.toNumber(),
      credit: l.kredit_amount.toNumber(),
      description: l.description,
      isGenerated: l.is_generated,
      subjectId: l.subject_id,
      subjectLabel: l.subject_id
        ? (l.account.ledger === "cash_bank" ? cashLabel.get(l.subject_id) : itemNo.get(l.subject_id)) ?? null
        : null,
      layerId: l.cash_bank_layer_id,
      layerNo: l.cash_bank_layer_id ? layers.get(l.cash_bank_layer_id)?.layerNo ?? null : null,
      balanceBefore: l.balance_before?.toNumber() ?? null,
    };
  });
  const total = (k: "debit" | "credit") =>
    Math.round(lines.reduce((t, l) => t + l[k], 0) * 100) / 100;

  return {
    id: j.id,
    journalNo: j.journal_no,
    companyId: j.company_id,
    companyLabel: j.company.company_label,
    companyName: j.company.company_name,
    accountingDate: day(j.accounting_date),
    description: j.description,
    status: j.status as GeneralJournalStatus,
    postedJournalId: j.posted_journal_id,
    postedJournalNo: j.posted_journal?.journal_no ?? null,
    lines,
    debit: total("debit"),
    credit: total("credit"),
  };
}

export type GeneralJournalOptions = {
  accounts: {
    id: number;
    label: string;
    name: string;
    ledger: string;
    /** The books a Partner account keeps. */
    bookIds: number[];
    partnerCategoryId: number | null;
  }[];
  partners: { id: number; label: string; name: string; categoryId: number }[];
  books: { id: number; name: string; raises: "In" | "Out" }[];
  items: SubledgerItem[];
  cashBanks: {
    id: number;
    label: string;
    name: string;
    accountId: number;
    currencyId: number;
    balance: number;
  }[];
  layers: Record<number, LayerOption[]>;
  currencies: { id: number; label: string; name: string; isBase: boolean }[];
};

/**
 * What a line may be built from, for one Company: every postable leaf account
 * (Jurnal Umum takes control accounts too, D16), and for each ledger what its
 * pickers offer. The Server Action re-checks every choice.
 */
export async function generalJournalOptions(companyId: number): Promise<GeneralJournalOptions> {
  const [accounts, partners, currencies, books, cashBanks, balances] = await Promise.all([
    prisma.accAccount.findMany({
      where: { company_id: companyId, is_active: true, is_postable: true, children: { none: {} } },
      select: {
        id: true,
        account_label: true,
        account_name: true,
        ledger: true,
        partner_category_id: true,
        books: {
          where: { status: "Active" },
          select: { budget_category_id: true },
          orderBy: { budget_category_id: "asc" },
        },
      },
    }),
    prisma.mPartner.findMany({
      where: { company_id: companyId, status: "Active" },
      orderBy: { partner_label: "asc" },
      select: { id: true, partner_label: true, partner_name: true, category_id: true },
    }),
    prisma.refCurrency.findMany({
      where: { status: "Active" },
      orderBy: { currency_label: "asc" },
      select: { id: true, currency_label: true, currency_name: true },
    }),
    loadSubledgers(),
    prisma.mCashBank.findMany({
      where: { company_id: companyId, status: "Active" },
      orderBy: { cash_bank_label: "asc" },
      select: { id: true, cash_bank_label: true, cash_bank_name: true, account_id: true, currency_id: true },
    }),
    cashBankBalanceMap(),
  ]);
  const [items, layers] = await Promise.all([
    openSubledgerItemsFor(
      partners.map((p) => p.id),
      currencies.map((c) => c.id)
    ),
    openLayersFor(cashBanks.map((c) => c.id)),
  ]);

  return {
    accounts: accounts
      .sort((a, b) => compareCodes(a.account_label, b.account_label))
      .map((a) => ({
        id: a.id,
        label: a.account_label,
        name: a.account_name,
        ledger: a.ledger,
        bookIds: a.books.map((b) => b.budget_category_id),
        partnerCategoryId: a.partner_category_id,
      })),
    partners: partners.map((p) => ({
      id: p.id,
      label: p.partner_label,
      name: p.partner_name,
      categoryId: p.category_id,
    })),
    books: books.map((b) => ({
      id: b.categoryId,
      name: b.name,
      raises: b.raises,
    })),
    items,
    cashBanks: cashBanks.map((c) => ({
      id: c.id,
      label: c.cash_bank_label,
      name: c.cash_bank_name,
      accountId: c.account_id,
      currencyId: c.currency_id,
      balance: balances.get(c.id) ?? 0,
    })),
    layers: Object.fromEntries(layers),
    currencies: currencies.map((c) => ({
      id: c.id,
      label: c.currency_label,
      name: c.currency_name,
      isBase: isBaseCurrency(c.currency_label),
    })),
  };
}
