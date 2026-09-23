import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatMoney, sumByCurrency, type MoneyTotal } from "@/lib/format";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { checkPostingPeriod } from "./fiscal";
import { originate, relieve, roundBase } from "./fx";
import { postJournal, type JournalLineInput } from "./journal";
import {
  DNCN_TYPES,
  dncnDirection,
  type DncnStatus,
  type DncnType,
} from "./dncn-workflow";
import {
  lockSubledgerPosition,
  recordSubledgerEntry,
  subledgerPosition,
  subledgerPositionsFor,
} from "./subledger";
import {
  subledgerForCategory,
  subledgerMovement,
  type SubledgerDef,
} from "./subledger-catalogue";
import { loadSubledgers } from "./subledger-data";
import { refValueOf, type SystemDefaultKey } from "./system-defaults";
import { checkSystemDefaultValue, systemDefaults } from "./system-settings";

/**
 * Debit / Credit Note: the adjustment document for a Partner's standing
 * position in a subject book.
 *
 * **It adjusts a position, not a transaction.** SIBA keeps no invoice for a
 * note to reference, and what needs fixing is the value that stands — the
 * Hutang to Budi, the Piutang on Cabang Medan — so a note names a book, a
 * Partner and a currency, and moves that position. No cash moves: it writes no
 * Cash Bank Book entry, draws on no rate layer and realizes no Budget.
 *
 * **One rule covers every book.** A Debit Note debits the Partner's account
 * and a Credit Note credits it, which on the Partner's side is exactly what a
 * cash payment and a cash receipt do. So a note hands the book the direction
 * money would have moved (`dncnDirection`) and the book's own `raises` decides
 * whether that raises or lowers the position — a Debit Note raises a Piutang
 * and lowers a Hutang, with no per-book rule anywhere. The counter side is one
 * account per note type and Company: a Debit Note always credits the Debit Note
 * account and a Credit Note always debits the Credit Note account. Which books
 * that is sound for is the category's `allows_dncn`, not a code list.
 *
 * **Valuation follows the kernel.** Raising a position originates value at a
 * rate the user states (`1` for base currency). Lowering one relieves it at
 * the carrying rate it already holds, so the journal's two sides carry the same
 * base and no FX difference can arise — there is no cash whose price could
 * disagree with the position.
 *
 * **Nothing below zero.** A note may not lower a position by more than it
 * holds, and may not touch a position that is already negative (a cash
 * overpayment can leave one there). Post takes a transaction-scoped lock on
 * the position before re-checking it, so two notes posted at once cannot both
 * pass the check against the same figure.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const day = (d: Date): string => d.toISOString().slice(0, 10);

// --------------------------------------------------------------------- rows

export type DncnRow = {
  id: number;
  note_no: string;
  note_type: DncnType;
  document_date: string | null;
  posting_date: string | null;
  company_id: number;
  budget_category_id: number;
  partner_id: number;
  currency_id: number;
  exchange_rate: number | null;
  note_amount: number;
  note_base_amount: number;
  reference: string | null;
  note: string | null;
  status: DncnStatus;
  line_count: number;
  /**
   * What the note names, read back through its own relations rather than out
   * of the pickers: a posted note keeps naming a Partner deactivated since, and
   * a book whose flag has since been turned off.
   */
  partner_label: string;
  partner_name: string;
  book_name: string;
  currency_label: string;
  created_by: number;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type DncnLineRow = {
  id: number;
  sequence_no: number;
  description: string;
  amount: number;
  base_amount: number;
};

type DncnRecord = {
  id: number;
  note_no: string;
  note_type: string;
  document_date: Date | null;
  posting_date: Date | null;
  company_id: number;
  budget_category_id: number;
  partner_id: number;
  currency_id: number;
  exchange_rate: { toNumber(): number } | null;
  note_amount: { toNumber(): number };
  note_base_amount: { toNumber(): number };
  reference: string | null;
  note: string | null;
  status: string;
  created_by: number;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
  _count?: { lines: number };
  partner: { partner_label: string; partner_name: string };
  budget_category: { category_label: string };
  currency: { currency_label: string };
};

const ROW_INCLUDE = {
  _count: { select: { lines: true } },
  partner: { select: { partner_label: true, partner_name: true } },
  budget_category: { select: { category_label: true } },
  currency: { select: { currency_label: true } },
} as const;

function toRow(n: DncnRecord): DncnRow {
  return {
    id: n.id,
    note_no: n.note_no,
    note_type: n.note_type as DncnType,
    document_date: n.document_date ? day(n.document_date) : null,
    posting_date: n.posting_date ? n.posting_date.toISOString() : null,
    company_id: n.company_id,
    budget_category_id: n.budget_category_id,
    partner_id: n.partner_id,
    currency_id: n.currency_id,
    exchange_rate: n.exchange_rate ? n.exchange_rate.toNumber() : null,
    note_amount: n.note_amount.toNumber(),
    note_base_amount: n.note_base_amount.toNumber(),
    reference: n.reference,
    note: n.note,
    status: n.status as DncnStatus,
    line_count: n._count?.lines ?? 0,
    partner_label: n.partner.partner_label,
    partner_name: n.partner.partner_name,
    book_name: `Buku ${n.budget_category.category_label}`,
    currency_label: n.currency.currency_label,
    created_by: n.created_by,
    updated_by: n.updated_by,
    created_at: n.created_at.toISOString(),
    updated_at: n.updated_at.toISOString(),
  };
}

export async function listNotes(companyIds: number[]): Promise<DncnRow[]> {
  const rows = await prisma.finDncn.findMany({
    where: { company_id: { in: companyIds } },
    orderBy: [{ id: "desc" }],
    include: ROW_INCLUDE,
  });
  return rows.map(toRow);
}

export async function getNote(id: number): Promise<DncnRow | null> {
  const row = await prisma.finDncn.findUnique({
    where: { id },
    include: ROW_INCLUDE,
  });
  return row ? toRow(row) : null;
}

export async function noteLines(noteId: number): Promise<DncnLineRow[]> {
  const lines = await prisma.finDncnLine.findMany({
    where: { note_id: noteId },
    orderBy: { sequence_no: "asc" },
  });
  return lines.map((l) => ({
    id: l.id,
    sequence_no: l.sequence_no,
    description: l.description,
    amount: l.amount.toNumber(),
    base_amount: l.base_amount.toNumber(),
  }));
}

// ----------------------------------------------------------------- doc type

export async function dncnDocTypeId(): Promise<number> {
  const row = await prisma.sysDocType.findFirstOrThrow({
    where: { doc_table: "fin_dncn" },
    select: { id: true },
  });
  return row.id;
}

/**
 * Note numbers for a set of ids — how another module names a note it holds a
 * reference to, without reading `fin_dncn` itself.
 */
export async function noteNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.finDncn.findMany({
    where: { id: { in: ids } },
    select: { id: true, note_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.note_no]));
}

/**
 * Next number in the type's own series — `DN-0001` or `CN-0001`.
 *
 * Two series in one table, so the highest is read per prefix rather than per
 * table. Id order is still number order within a series, because each series
 * only ever grows by one at insert.
 */
export async function nextNoteNo(type: DncnType, db: Db = prisma): Promise<string> {
  const series = DNCN_TYPES[type].series;
  return nextDocumentNumber(series, async () => {
    const row = await db.finDncn.findFirst({
      where: { note_type: type },
      orderBy: { id: "desc" },
      select: { note_no: true },
    });
    return row?.note_no ?? null;
  });
}

// --------------------------------------------------------------------- refs

export type DncnBookOption = {
  categoryId: number;
  key: string;
  label: string;
  name: string;
  /** Which cash direction raises the position — how the form previews a note. */
  raises: "In" | "Out";
  /** The Partner Categories this book admits, so the Partner picker can narrow. */
  partnerCategoryIds: number[];
};

export type DncnPartnerOption = {
  id: number;
  label: string;
  name: string;
  companyId: number;
  categoryId: number;
};

export type DncnPositionOption = {
  book: string;
  partnerId: number;
  currencyId: number;
  foreign: number;
  base: number;
};

export type DncnRefs = {
  books: DncnBookOption[];
  partners: DncnPartnerOption[];
  currencies: { id: number; label: string; name: string; isBase: boolean }[];
  companies: { id: number; label: string; name: string }[];
  /** Every standing position the pickers can reach, so the form can show it. */
  positions: DncnPositionOption[];
};

/**
 * The books a note may adjust: categories that keep a subject book **and**
 * carry `allows_dncn`. Both, because the flag alone says nothing once a
 * category has stopped keeping a book.
 */
async function adjustableBooks(): Promise<
  { def: SubledgerDef; partnerCategoryIds: number[] }[]
> {
  const [books, flagged] = await Promise.all([
    loadSubledgers(),
    prisma.sysBudgetCategory.findMany({
      where: { allows_dncn: true, status: "Active" },
      select: {
        id: true,
        partner_categories: {
          where: { status: "Active", partner_category: { status: "Active" } },
          select: { partner_category_id: true },
        },
      },
    }),
  ]);
  const out: { def: SubledgerDef; partnerCategoryIds: number[] }[] = [];
  for (const f of flagged) {
    const def = subledgerForCategory(books, f.id);
    if (def) {
      out.push({
        def,
        partnerCategoryIds: f.partner_categories.map((p) => p.partner_category_id),
      });
    }
  }
  return out;
}

/**
 * Everything the note form picks from, in one read. Active records only: a
 * Partner is deactivated once everything about it is finished, so a note —
 * which exists to finish something — never needs an inactive one.
 */
export async function dncnRefs(companyIds: number[]): Promise<DncnRefs> {
  const [books, partners, currencies, companies] = await Promise.all([
    adjustableBooks(),
    prisma.mPartner.findMany({
      where: { company_id: { in: companyIds }, status: "Active" },
      orderBy: [{ partner_label: "asc" }],
      select: {
        id: true,
        partner_label: true,
        partner_name: true,
        company_id: true,
        category_id: true,
      },
    }),
    prisma.refCurrency.findMany({
      where: { status: "Active" },
      orderBy: [{ currency_label: "asc" }],
      select: { id: true, currency_label: true, currency_name: true },
    }),
    prisma.sysCompany.findMany({
      where: { id: { in: companyIds } },
      orderBy: [{ id: "asc" }],
      select: { id: true, company_label: true, company_name: true },
    }),
  ]);

  const positions: DncnPositionOption[] = await subledgerPositionsFor(
    books.map((b) => b.def.key),
    partners.map((p) => p.id)
  );

  return {
    books: books.map((b) => ({
      categoryId: b.def.categoryId,
      key: b.def.key,
      label: b.def.budgetCategory,
      name: b.def.name,
      raises: b.def.raises,
      partnerCategoryIds: b.partnerCategoryIds,
    })),
    partners: partners.map((p) => ({
      id: p.id,
      label: p.partner_label,
      name: p.partner_name,
      companyId: p.company_id,
      categoryId: p.category_id,
    })),
    currencies: currencies.map((c) => ({
      id: c.id,
      label: c.currency_label,
      name: c.currency_name,
      isBase: isBaseCurrency(c.currency_label),
    })),
    companies: companies.map((c) => ({
      id: c.id,
      label: c.company_label,
      name: c.company_name,
    })),
    positions,
  };
}

// ------------------------------------------------------------------- header

export type DncnHeader = {
  note_type: string;
  budget_category_id: number | null;
  partner_id: number | null;
  currency_id: number | null;
  exchange_rate: number | null;
};

export type ResolvedDncnHeader = {
  type: DncnType;
  book: SubledgerDef;
  companyId: number;
  partnerId: number;
  partnerCategoryId: number;
  currencyId: number;
  currencyLabel: string;
  /** Whether the note raises the position — decided by the book, not the type. */
  raises: boolean;
  /** The entered rate where the note raises a position, null otherwise. */
  rate: number | null;
};

export type DncnHeaderCheck =
  | ({ ok: true } & ResolvedDncnHeader)
  | { ok: false; errors: Record<string, string> };

const isType = (v: string): v is DncnType => v === "Debit" || v === "Credit";

/**
 * The header, checked against every rule at once. The form narrows each
 * picker, but a Server Action is reachable directly with any combination of
 * ids — this is what actually enforces it.
 */
export async function checkDncnHeader(
  header: DncnHeader,
  companyIds: number[]
): Promise<DncnHeaderCheck> {
  const errors: Record<string, string> = {};

  if (!isType(header.note_type)) {
    return { ok: false, errors: { note_type: "Pilih jenis nota." } };
  }
  const type = header.note_type;

  if (!header.budget_category_id) {
    return { ok: false, errors: { budget_category_id: "Buku subjek wajib dipilih." } };
  }
  const book = (await adjustableBooks()).find(
    (b) => b.def.categoryId === header.budget_category_id
  );
  if (!book) {
    return {
      ok: false,
      errors: {
        budget_category_id:
          "Buku tersebut tidak dapat disesuaikan lewat Debit / Credit Note. " +
          "Aktifkan “Boleh Debit / Credit Note” pada Budget Category-nya.",
      },
    };
  }

  if (!header.partner_id) {
    return { ok: false, errors: { partner_id: "Partner wajib dipilih." } };
  }
  const partner = await prisma.mPartner.findUnique({
    where: { id: header.partner_id },
    select: { company_id: true, category_id: true, status: true, partner_label: true },
  });
  if (!partner || !companyIds.includes(partner.company_id)) {
    return { ok: false, errors: { partner_id: "Partner tidak ditemukan." } };
  }
  if (partner.status !== "Active") {
    errors.partner_id = "Partner tersebut non-aktif dan tidak dapat disesuaikan.";
  } else if (!book.partnerCategoryIds.includes(partner.category_id)) {
    errors.partner_id =
      `Partner ${partner.partner_label} tidak termasuk Partner Category yang ` +
      `dipakai ${book.def.name}.`;
  }

  if (!header.currency_id) {
    return { ok: false, errors: { ...errors, currency_id: "Currency wajib dipilih." } };
  }
  const currency = await prisma.refCurrency.findUnique({
    where: { id: header.currency_id },
    select: { currency_label: true, status: true },
  });
  if (!currency) {
    errors.currency_id = "Currency tidak ditemukan.";
  } else if (currency.status !== "Active") {
    errors.currency_id = "Currency tersebut non-aktif dan tidak dapat dipakai.";
  }

  if (Object.keys(errors).length || !currency) return { ok: false, errors };

  const raises = subledgerMovement(book.def, dncnDirection(type), 1) > 0;
  const base = isBaseCurrency(currency.currency_label);

  // The kurs is an input exactly where the note creates base value: raising a
  // foreign position. Lowering one releases at the carrying rate the position
  // already holds, so a typed rate there would be a second opinion nothing
  // reads — refused rather than silently ignored.
  let rate: number | null = null;
  if (base) {
    rate = 1;
  } else if (raises) {
    if (!(header.exchange_rate && header.exchange_rate > 0)) {
      return {
        ok: false,
        errors: {
          exchange_rate:
            `Isi kurs — berapa nilai 1 ${currency.currency_label} dalam ` +
            `${BASE_CURRENCY_LABEL} untuk nota ini.`,
        },
      };
    }
    rate = header.exchange_rate;
  } else if (header.exchange_rate) {
    return {
      ok: false,
      errors: {
        exchange_rate:
          "Nota ini menurunkan posisi, jadi nilainya mengikuti kurs tercatat " +
          "posisi tersebut dan tidak memakai kurs baru.",
      },
    };
  }

  return {
    ok: true,
    type,
    book: book.def,
    companyId: partner.company_id,
    partnerId: header.partner_id,
    partnerCategoryId: partner.category_id,
    currencyId: header.currency_id,
    currencyLabel: currency.currency_label,
    raises,
    rate,
  };
}

// -------------------------------------------------------------------- lines

export type DncnLineInput = { description: string; amount: number };

export type DncnLineCheck =
  | { ok: true; lines: DncnLineInput[]; total: number }
  | { ok: false; errors: Record<string, string> };

/** Every note says why it adjusts, line by line, and by how much. */
export function checkDncnLines(lines: DncnLineInput[]): DncnLineCheck {
  const wanted = lines
    .map((l) => ({ description: l.description.trim(), amount: l.amount }))
    .filter((l) => l.description || l.amount);

  if (!wanted.length) {
    return { ok: false, errors: { _lines: "Nota harus memiliki minimal satu baris." } };
  }
  if (wanted.some((l) => !l.description)) {
    return {
      ok: false,
      errors: { _lines: "Setiap baris wajib menyebut alasan penyesuaiannya." },
    };
  }
  if (wanted.some((l) => !(l.amount > 0))) {
    return { ok: false, errors: { _lines: "Nominal setiap baris harus lebih dari nol." } };
  }
  return { ok: true, lines: wanted, total: roundBase(wanted.reduce((t, l) => t + l.amount, 0)) };
}

/**
 * The zero rule, asked of a position as it stands.
 *
 * A negative position is refused outright: it is what a cash overpayment
 * leaves behind, its base value no longer tracks its face, and adjusting it is
 * the next scope. A note lowering a position may take it to nothing and no
 * further.
 */
export function positionRefusal(
  position: { foreign: number },
  raises: boolean,
  amount: number,
  currencyLabel: string
): string | null {
  if (position.foreign < 0) {
    return (
      "Posisi Partner ini sedang di bawah nol. Debit / Credit Note belum dapat " +
      "menyesuaikan posisi negatif."
    );
  }
  if (!raises && amount > position.foreign) {
    return (
      `Nota ini menurunkan posisi sebesar ${formatMoney(amount, currencyLabel)}, ` +
      `melebihi posisi yang tersisa ${formatMoney(position.foreign, currencyLabel)}. ` +
      "Posisi tidak boleh menjadi di bawah nol."
    );
  }
  return null;
}

// ------------------------------------------------------------------ posting

export type DncnPostingResult =
  | { ok: true; baseAmount: number }
  | { ok: false; errors: Record<string, string> };

class DncnRefused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("Nota ditolak");
    this.name = "DncnRefused";
  }
}

/** Splits one base figure across lines in proportion, keeping the total exact. */
function allocateBase(amounts: number[], total: number, base: number): number[] {
  let given = 0;
  return amounts.map((a, i) => {
    if (i === amounts.length - 1) return roundBase(base - given);
    const share = roundBase((a * base) / total);
    given = roundBase(given + share);
    return share;
  });
}

const NOTE_ACCOUNT_KEY: Record<"induk" | "anak", Record<DncnType, SystemDefaultKey>> = {
  induk: { Debit: "induk_debit_note_account", Credit: "induk_credit_note_account" },
  anak: { Debit: "anak_debit_note_account", Credit: "anak_credit_note_account" },
};

/**
 * Post: the actual boundary, and one database transaction.
 *
 * Everything that can be decided without the position is decided first — the
 * period, the book, the Partner, both accounts — so an ordinary refusal comes
 * back without a transaction ever opening. Inside it the position is locked,
 * re-read and checked, and then the subject-book entry, the journal and the
 * note's own figures are written together. Either all of it happened or none
 * of it did.
 *
 * Lives here rather than inside the Server Action so the rule is testable: the
 * action resolves a caller and then calls this, and the suite calls the same
 * function.
 */
export async function applyDncn(noteId: number, actorId: number): Promise<DncnPostingResult> {
  const doc = await prisma.finDncn.findUnique({
    where: { id: noteId },
    include: {
      lines: { orderBy: { sequence_no: "asc" } },
      currency: { select: { currency_label: true } },
      company: { select: { is_parent: true } },
    },
  });

  if (!doc) return { ok: false, errors: { _form: "Nota tidak ditemukan." } };
  if (doc.status !== "Draft") {
    return { ok: false, errors: { _form: "Hanya nota berstatus Draft yang dapat diposting." } };
  }
  if (!doc.lines.length) {
    return { ok: false, errors: { _form: "Tambahkan minimal satu baris sebelum nota diposting." } };
  }

  const type = doc.note_type as DncnType;
  const today = new Date().toISOString().slice(0, 10);

  const period = await checkPostingPeriod(doc.company_id, today);
  if (!period.ok) return { ok: false, errors: { _form: period.message } };

  // Re-checked rather than trusted from when the draft was saved: the book may
  // have lost its flag, the Partner may have been deactivated or moved out of
  // the categories the book admits.
  const header = await checkDncnHeader(
    {
      note_type: type,
      budget_category_id: doc.budget_category_id,
      partner_id: doc.partner_id,
      currency_id: doc.currency_id,
      exchange_rate: doc.exchange_rate?.toNumber() ?? null,
    },
    [doc.company_id]
  );
  if (!header.ok) return { ok: false, errors: { _form: Object.values(header.errors)[0] } };

  // The Partner's side: the account its position is mapped to, exactly as a
  // cash posting resolves it — Company × Budget Category × Partner Category.
  const mapping = await prisma.accBudgetCategoryAccount.findFirst({
    where: {
      company_id: doc.company_id,
      budget_category_id: doc.budget_category_id,
      partner_category_id: header.partnerCategoryId,
    },
    select: {
      account: {
        select: { id: true, company_id: true, is_active: true, is_postable: true, account_label: true },
      },
    },
  });
  if (!mapping) {
    return {
      ok: false,
      errors: {
        _form:
          `Belum ada Mapping Budget ke Account untuk ${header.book.name} dan ` +
          "Partner Category Partner ini. Lengkapi mapping di Accounting sebelum " +
          "nota diposting.",
      },
    };
  }
  const partnerAccount = mapping.account;
  if (
    partnerAccount.company_id !== doc.company_id ||
    !partnerAccount.is_active ||
    !partnerAccount.is_postable
  ) {
    return {
      ok: false,
      errors: {
        _form:
          `Account ${partnerAccount.account_label} yang dipetakan untuk posisi ini ` +
          "tidak aktif atau bukan account postable.",
      },
    };
  }

  // The counter side: the Company's own Debit or Credit Note account. Never
  // guessed and never a fallback — a note without one is refused by name.
  const settingKey = NOTE_ACCOUNT_KEY[doc.company.is_parent ? "induk" : "anak"][type];
  const counterAccountId = refValueOf(await systemDefaults(), settingKey);
  const settingRefusal = counterAccountId
    ? await checkSystemDefaultValue(settingKey, counterAccountId)
    : "belum diatur";
  if (!counterAccountId || settingRefusal) {
    return {
      ok: false,
      errors: {
        _form:
          `Account ${DNCN_TYPES[type].label} untuk Company ini ${
            counterAccountId ? `tidak dapat dipakai: ${settingRefusal}` : "belum diatur"
          }. Lengkapi di Settings › System Default sebelum nota diposting.`,
      },
    };
  }

  const docTypeId = await dncnDocTypeId();
  const amount = doc.note_amount.toNumber();
  const lineAmounts = doc.lines.map((l) => l.amount.toNumber());
  const direction = dncnDirection(type);
  const label = `${doc.note_no} — ${DNCN_TYPES[type].label}`;
  let baseAmount = 0;

  try {
    await prisma.$transaction(async (tx) => {
      // Held until the transaction ends. A second note on the same position
      // waits here, and its read below sees what this one left.
      await lockSubledgerPosition(tx, header.book.key, doc.partner_id, doc.currency_id);
      const position = await subledgerPosition(
        header.book.key,
        doc.partner_id,
        doc.currency_id,
        tx
      );

      const refusal = positionRefusal(position, header.raises, amount, header.currencyLabel);
      if (refusal) throw new DncnRefused({ _form: refusal });

      // Raising creates value at the stated rate; lowering releases what the
      // position was carried at, the full remainder exactly when it empties.
      const base = header.raises
        ? originate(amount, header.rate!).base
        : relieve(position, amount).base;
      baseAmount = base;
      // The rate this entry was valued at, as the cash posting records its own
      // relief: stated where the note originated value, base ÷ face where it
      // released it. A record of the entry, never an input to anything.
      const entryRate = header.raises ? header.rate! : base / amount;

      await recordSubledgerEntry(tx, {
        book: header.book,
        partnerId: doc.partner_id,
        currencyId: doc.currency_id,
        date: today,
        type: "Adjustment",
        direction,
        amount,
        rate: entryRate,
        baseAmount: base,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        note: label,
        actorId,
      });

      // The Partner line debits on a Debit Note and credits on a Credit Note;
      // the counter lines are the mirror, one per note line so the General
      // Ledger reads back to each reason. Same currency, same base on both
      // sides — there is no second valuation to disagree with.
      const shares = allocateBase(lineAmounts, amount, base);
      const debitNote = type === "Debit";
      const lines: JournalLineInput[] = [
        {
          accountId: partnerAccount.id,
          partnerId: doc.partner_id,
          currencyId: doc.currency_id,
          rate: entryRate,
          debit: debitNote ? amount : 0,
          credit: debitNote ? 0 : amount,
          baseAmount: base,
          description: label,
        },
        ...doc.lines.map((l, i) => ({
          accountId: counterAccountId,
          currencyId: doc.currency_id,
          rate: entryRate,
          debit: debitNote ? 0 : lineAmounts[i],
          credit: debitNote ? lineAmounts[i] : 0,
          baseAmount: shares[i],
          description: `${doc.note_no} — ${l.description}`,
        })),
      ];

      await postJournal(tx, {
        companyId: doc.company_id,
        description: label,
        sourceDocTypeId: docTypeId,
        sourceDocId: doc.id,
        lines: debitNote ? lines : [...lines.slice(1), lines[0]],
        actorId,
      });

      for (const [i, l] of doc.lines.entries()) {
        await tx.finDncnLine.update({
          where: { id: l.id },
          data: { base_amount: shares[i], updated_by: actorId },
        });
      }

      await tx.finDncn.update({
        where: { id: doc.id },
        data: {
          status: "Posted",
          document_date: new Date(`${today}T00:00:00Z`),
          posting_date: new Date(),
          note_base_amount: base,
          updated_by: actorId,
        },
      });
    });
  } catch (error) {
    if (error instanceof DncnRefused) return { ok: false, errors: error.errors };
    throw error;
  }

  return { ok: true, baseAmount };
}

// ------------------------------------------------------------------ summary

export type DncnSummary = {
  draft: number;
  posted: number;
  cancelled: number;
  /** Posted value per currency — amounts are never added across currencies. */
  debitTotals: MoneyTotal[];
  creditTotals: MoneyTotal[];
};

export async function summariseNotes(rows: DncnRow[]): Promise<DncnSummary> {
  const currencies = await prisma.refCurrency.findMany({
    select: { id: true, currency_label: true },
  });
  const labels = new Map(currencies.map((c) => [c.id, c.currency_label]));
  const posted = rows.filter((r) => r.status === "Posted");
  const totals = (type: DncnType) =>
    sumByCurrency(
      posted
        .filter((r) => r.note_type === type)
        .map((r) => ({
          currencyId: r.currency_id,
          currencyLabel: labels.get(r.currency_id) ?? "?",
          amount: r.note_amount,
        }))
    );
  return {
    draft: rows.filter((r) => r.status === "Draft").length,
    posted: posted.length,
    cancelled: rows.filter((r) => r.status === "Cancelled").length,
    debitTotals: totals("Debit"),
    creditTotals: totals("Credit"),
  };
}
