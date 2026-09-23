import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";

/**
 * The Opening Balance store.
 *
 * An Opening Balance is a **snapshot**: where one Company's accounts stood at
 * the start of one fiscal year, written once and never touched again. It is
 * not a book — there is no running total to keep and no further entry to
 * append, because the thing it records happened at a single instant.
 *
 * It exists for two reasons, and they are different reasons:
 *
 *  - a closed year has to hand the next one its position in a form somebody
 *    can read, rather than as an instruction to re-add every journal line ever
 *    posted;
 *  - and the General Ledger and the Trial Balance compute their openings from
 *    it instead of scanning from the first historical transaction.
 *    `openingBasisFor` at the foot of this file is that second job, and the
 *    property it lives or dies by is **equivalence**: for the same account and
 *    the same date, the snapshot-based opening equals the full-scan opening to
 *    the cent. A database that has never closed a year has no snapshot to
 *    stand on and produces exactly the figures it produced before any of this
 *    existed.
 *
 * ## Immutable, and read-only in the UI
 *
 * There is no create form, no edit path, and no delete. A snapshot is written
 * by a fiscal year's close, or by a developer injecting go-live figures
 * directly into the database before the application has any history. Nothing
 * a user does through the GUI produces one, and nothing changes one
 * afterwards: a snapshot that could be edited would be a second, unverifiable
 * answer to a question the journal already answers.
 *
 * ## The grain is the journal line's grain
 *
 * One line per `(account, partner?)` pair — a Hutang account owed to three
 * branches produces three lines, and an account naming no Partner produces one
 * line with a null partner. There is no parent row holding an account's total,
 * because that figure is the sum of its children: the materialised balances
 * elsewhere in SIBA are allowed only because a rebuild function can re-derive
 * them, and an immutable snapshot has no rebuild.
 *
 * The pairs come from the posted journal lines **as they actually are**
 * (`closingBalances` in `ledger.ts`), never from `acc_account.require_partner`.
 * Reading the flag would drop a partner-bearing balance sitting on an
 * unflagged account, and would invent a null-partner line for an account that
 * has none.
 *
 * ## Base currency only
 *
 * There is no currency column and no rate. The journal, the General Ledger and
 * the Trial Balance are base-currency statements (concept doc §11.2, §16), and
 * a snapshot of them is the same measure. The transaction-currency face of
 * what produced a balance stays on the journal lines that produced it.
 *
 * This module owns `acc_opening_balance` and `acc_opening_balance_line` and
 * nothing else names them. It imports only the shared kernel, so it can be
 * written into from inside somebody else's posting transaction — which is
 * exactly how a close will use it.
 */

type Client = typeof prisma | Prisma.TransactionClient;

/** One balance: an account, the Partner it is held against if any, one side. */
export type OpeningBalanceLineInput = {
  accountId: number;
  partnerId?: number | null;
  debit: number;
  credit: number;
};

export type OpeningBalanceInput = {
  companyId: number;
  /** The year this snapshot opens. */
  fiscalYearId: number;
  /**
   * The year whose close produced it.
   *
   * Null for go-live balances injected by a developer, and that is the whole
   * distinction: nothing generated those, so there is no year to name. A null
   * source is how an injected snapshot is told from a generated one.
   */
  sourceFiscalYearId?: number | null;
  /** The day the figures speak for — the first day of the year being opened. */
  postingDate: Date;
  lines: OpeningBalanceLineInput[];
  actorId: number;
};

/**
 * Money is compared in whole cents, exactly as a journal's balance is.
 *
 * The amounts are `Decimal(18,2)` in the database and JavaScript numbers here,
 * so 0.1 + 0.2 must not be allowed to fail a check that is arithmetically
 * sound.
 */
const cents = (n: number): number => Math.round(n * 100);

export class OpeningBalanceImbalance extends Error {
  constructor(readonly debit: number, readonly credit: number) {
    super(
      `Opening Balance tidak seimbang: debit ${debit.toFixed(2)} dan kredit ` +
        `${credit.toFixed(2)}. Setelah laba rugi ditutup, yang tersisa adalah neraca, ` +
        "sehingga kedua sisinya harus sama."
    );
    this.name = "OpeningBalanceImbalance";
  }
}

type ResolvedLine = OpeningBalanceLineInput & { partnerId: number | null };

/**
 * Every line checked, and the two totals that must agree.
 *
 * Refuses an empty document, a negative amount, a line carrying value on both
 * sides or on neither, and a `(account, partner?)` pair stated twice. The
 * duplicate is also refused by the database — the unique index is
 * `NULLS NOT DISTINCT`, so two null-partner rows for one account collide there
 * too — and it is checked here as well so the refusal can name the pair rather
 * than arriving as a constraint violation.
 *
 * It does not check the balance; `writeOpeningBalance` does, so that the
 * refusal for an unbalanced document is one error rather than one per line.
 *
 * Refusals throw rather than returning a result. Every caller is either inside
 * a transaction, where a bad snapshot must take the whole close down, or is a
 * developer running a script, where a throw is the right way to stop.
 */
function resolveLines(lines: OpeningBalanceLineInput[]): {
  resolved: ResolvedLine[];
  debit: number;
  credit: number;
} {
  if (!lines.length) {
    throw new Error("Opening Balance tanpa baris tidak dapat disimpan.");
  }

  let debit = 0;
  let credit = 0;
  const seen = new Set<string>();
  const resolved: ResolvedLine[] = [];

  for (const [i, line] of lines.entries()) {
    if (line.debit < 0 || line.credit < 0) {
      throw new Error(`Baris Opening Balance ${i + 1} memuat nominal negatif.`);
    }

    const onDebit = cents(line.debit) > 0;
    const onCredit = cents(line.credit) > 0;
    if (onDebit === onCredit) {
      throw new Error(
        `Baris Opening Balance ${i + 1} harus mengisi tepat satu sisi, debit atau kredit.`
      );
    }

    const partnerId = line.partnerId ?? null;
    // An account with no Partner is the common case, so the duplicate that
    // matters most is the one Postgres would otherwise let through: two rows
    // for one account, both with a null partner.
    const pair = `${line.accountId}:${partnerId ?? "-"}`;
    if (seen.has(pair)) {
      throw new Error(
        `Opening Balance memuat account ${line.accountId}` +
          (partnerId ? ` dengan partner ${partnerId}` : " tanpa partner") +
          " lebih dari satu kali. Satu baris untuk satu pasangan account dan partner."
      );
    }
    seen.add(pair);

    resolved.push({ ...line, partnerId });
    debit += line.debit;
    credit += line.credit;
  }

  return { resolved, debit, credit };
}

/**
 * Writes one balanced snapshot, or writes nothing.
 *
 * Takes a client rather than opening its own transaction, so a close can write
 * the snapshot inside the same transaction as the closing journal and the
 * closing record — either all of it happened or none of it did.
 *
 * The balance is refused here, like a journal's. A snapshot taken after the
 * profit and loss has been closed out is a balance sheet, and a balance sheet
 * whose sides disagree is a system fault rather than a bookkeeping one.
 */
export async function writeOpeningBalance(
  tx: Client,
  input: OpeningBalanceInput
): Promise<{ id: number; openingNo: string }> {
  const { resolved, debit, credit } = resolveLines(input.lines);
  if (cents(debit) !== cents(credit)) {
    throw new OpeningBalanceImbalance(debit, credit);
  }

  const opening = await tx.accOpeningBalance.create({
    data: {
      opening_no: await nextOpeningNo(tx),
      posting_date: input.postingDate,
      fiscal_year_id: input.fiscalYearId,
      source_fiscal_year_id: input.sourceFiscalYearId ?? null,
      company_id: input.companyId,
      created_by: input.actorId,
      lines: {
        create: resolved.map((line, i) => ({
          sequence_no: i + 1,
          account_id: line.accountId,
          partner_id: line.partnerId,
          debit_amount: line.debit,
          kredit_amount: line.credit,
          created_by: input.actorId,
        })),
      },
    },
    select: { id: true, opening_no: true },
  });

  await tx.auditLog.create({
    data: {
      entity_key: "acc_opening_balance",
      row_id: opening.id,
      action: "TAMBAH",
      event: "create",
      by: input.actorId,
    },
  });

  return { id: opening.id, openingNo: opening.opening_no };
}

/**
 * `OPB-0001` — its own series.
 *
 * The highest number is looked up within the series for the same reason every
 * other series does it: ordering by the number column itself would go wrong at
 * `-10000`, and numbers are assigned as "highest + 1" at insert, so id order
 * and number order are the same.
 */
async function nextOpeningNo(tx: Client): Promise<string> {
  return nextDocumentNumber("OPB", async () => {
    const row = await tx.accOpeningBalance.findFirst({
      orderBy: { id: "desc" },
      select: { opening_no: true },
    });
    return row?.opening_no ?? null;
  });
}

// ------------------------------------------------------------------ reading

export type OpeningBalanceLineRow = {
  id: number;
  sequenceNo: number;
  accountId: number;
  accountLabel: string;
  accountName: string;
  partnerId: number | null;
  partnerLabel: string | null;
  /** Base currency, like every figure in this document. */
  debit: number;
  credit: number;
};

export type OpeningBalanceRow = {
  id: number;
  openingNo: string;
  postingDate: string;
  companyId: number;
  companyLabel: string;
  /** The year this snapshot opens. */
  fiscalYearLabel: string;
  fiscalYearName: string;
  /** Null where nothing produced it — go-live figures a developer injected. */
  sourceFiscalYearLabel: string | null;
  lineCount: number;
  debit: number;
  credit: number;
};

export type OpeningBalanceDetail = OpeningBalanceRow & {
  lines: OpeningBalanceLineRow[];
};

const totalOf = (
  lines: { debit_amount: { toNumber(): number }; kredit_amount: { toNumber(): number } }[]
) => ({
  debit: lines.reduce((t, l) => t + l.debit_amount.toNumber(), 0),
  credit: lines.reduce((t, l) => t + l.kredit_amount.toNumber(), 0),
});

/**
 * The snapshots of the Companies a reader may see, newest year first.
 *
 * Ordered by the day the figures speak for rather than by when the row was
 * written: a go-live snapshot injected today states a position from years ago,
 * and a register that sorted it to the top would be sorting by when somebody
 * ran a script.
 */
export async function listOpeningBalances(
  companyIds: number[]
): Promise<OpeningBalanceRow[]> {
  const rows = await prisma.accOpeningBalance.findMany({
    where: { company_id: { in: companyIds } },
    orderBy: [{ posting_date: "desc" }, { id: "desc" }],
    include: {
      company: { select: { company_label: true } },
      fiscal_year: { select: { year_label: true, year_name: true } },
      source_fiscal_year: { select: { year_label: true } },
      lines: { select: { debit_amount: true, kredit_amount: true } },
    },
  });

  return rows.map((o) => ({
    id: o.id,
    openingNo: o.opening_no,
    postingDate: o.posting_date.toISOString(),
    companyId: o.company_id,
    companyLabel: o.company.company_label,
    fiscalYearLabel: o.fiscal_year.year_label,
    fiscalYearName: o.fiscal_year.year_name,
    sourceFiscalYearLabel: o.source_fiscal_year?.year_label ?? null,
    lineCount: o.lines.length,
    ...totalOf(o.lines),
  }));
}

/**
 * One snapshot and its lines.
 *
 * Scoped to the Companies the caller may see, so a snapshot outside that scope
 * reads as **not found** — the same answer one that does not exist gives.
 */
export async function getOpeningBalance(
  id: number,
  companyIds: number[]
): Promise<OpeningBalanceDetail | null> {
  const o = await prisma.accOpeningBalance.findFirst({
    where: { id, company_id: { in: companyIds } },
    include: {
      company: { select: { company_label: true } },
      fiscal_year: { select: { year_label: true, year_name: true } },
      source_fiscal_year: { select: { year_label: true } },
      lines: {
        orderBy: { sequence_no: "asc" },
        include: {
          account: { select: { account_label: true, account_name: true } },
          partner: { select: { partner_label: true } },
        },
      },
    },
  });
  if (!o) return null;

  return {
    id: o.id,
    openingNo: o.opening_no,
    postingDate: o.posting_date.toISOString(),
    companyId: o.company_id,
    companyLabel: o.company.company_label,
    fiscalYearLabel: o.fiscal_year.year_label,
    fiscalYearName: o.fiscal_year.year_name,
    sourceFiscalYearLabel: o.source_fiscal_year?.year_label ?? null,
    lineCount: o.lines.length,
    ...totalOf(o.lines),
    lines: o.lines.map((l) => ({
      id: l.id,
      sequenceNo: l.sequence_no,
      accountId: l.account_id,
      accountLabel: l.account.account_label,
      accountName: l.account.account_name,
      partnerId: l.partner_id,
      partnerLabel: l.partner?.partner_label ?? null,
      debit: l.debit_amount.toNumber(),
      credit: l.kredit_amount.toNumber(),
    })),
  };
}

/**
 * Opening Balance numbers for a set of ids — how the audit panel names a
 * snapshot without reading this module's table itself.
 */
export async function openingBalanceNumbersByIds(
  ids: number[]
): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.accOpeningBalance.findMany({
    where: { id: { in: ids } },
    select: { id: true, opening_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.opening_no]));
}

// ------------------------------------------------- the reporting shortcut

export type OpeningBasis = {
  id: number;
  openingNo: string;
  /**
   * The day the figures speak for.
   *
   * A line dated **on or after** this day is *not* in the snapshot — the
   * snapshot was taken as at the end of the day before. That is what makes it
   * a starting point a report can add to rather than a figure it has to
   * reconcile against.
   */
  postingDate: Date;
  /** `debit − credit` per account, rolled up from the snapshot's own lines. */
  byAccount: Map<number, number>;
};

/**
 * The latest snapshot a Company holds on or before a date, if any.
 *
 * This is what a report stands on instead of summing every journal line ever
 * posted. A General Ledger for March 2028 does not need 2026 and 2027 line by
 * line; it needs where the accounts stood on 1 January 2028 — which is exactly
 * what the close of 2027 wrote down — plus the two months since.
 *
 * Reported at **account** grain rather than the pair grain it is stored at,
 * because both ledger reports are about accounts. A pair that nets to nothing
 * is not in the snapshot at all, and dropping it changes no account's total.
 *
 * Returns null where there is no snapshot to stand on, and the caller then
 * scans as it always did. That is the honest fallback: a database that has
 * never closed a year has nothing to shortcut through, and must produce the
 * same figures it produced before this existed.
 */
export async function openingBasisFor(
  companyId: number,
  on: Date,
  db: Client = prisma
): Promise<OpeningBasis | null> {
  const snapshot = await db.accOpeningBalance.findFirst({
    where: { company_id: companyId, posting_date: { lte: on } },
    // The *latest* one that is still not after the date asked about. An older
    // snapshot would be correct too — it just leaves more to scan.
    orderBy: [{ posting_date: "desc" }, { id: "desc" }],
    select: {
      id: true,
      opening_no: true,
      posting_date: true,
      lines: {
        select: { account_id: true, debit_amount: true, kredit_amount: true },
      },
    },
  });
  if (!snapshot) return null;

  const byAccount = new Map<number, number>();
  for (const l of snapshot.lines) {
    byAccount.set(
      l.account_id,
      (byAccount.get(l.account_id) ?? 0) +
        l.debit_amount.toNumber() -
        l.kredit_amount.toNumber()
    );
  }

  return {
    id: snapshot.id,
    openingNo: snapshot.opening_no,
    postingDate: snapshot.posting_date,
    byAccount,
  };
}
