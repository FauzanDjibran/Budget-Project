/**
 * How a financial statement is laid out: which steps it has, what a column's
 * date range is, and how the chart of accounts becomes its rows.
 *
 * Pure and client-safe — no `server-only`, no database import — for the reason
 * `fx.ts` and `transfer-valuation.ts` are: the rules that decide which figure
 * lands on which row are exercised by the tests directly, and nothing about
 * them needs a connection.
 *
 * The Laba Rugi is **multi-step**. Each Account Category names its step in a
 * stored column (`acc_account_category.pl_group`), never read off its number,
 * and every account inherits the step through its subcategory. The step order
 * and the subtotal names are the one thing fixed here: they are the PSAK 1
 * vocabulary, not a layout choice somebody should be editing.
 */
import { compareCodes } from "./account-code";
import { roundBase } from "./fx";
import type { PeriodRange } from "./period";

// ------------------------------------------------------------------- steps

/** Mirrors the `ProfitLossGroup` enum; declared here to stay client-safe. */
export type ProfitLossStep =
  | "OperatingRevenue"
  | "CostOfSales"
  | "OperatingExpense"
  | "OtherIncome"
  | "OtherExpense";

export type ProfitLossStepDef = {
  key: ProfitLossStep;
  name: string;
  /**
   * Whether the step reads credit-positive. Revenue does, cost does not — so a
   * contra account inside revenue (Pengurang Hasil Penjualan) prints negative
   * where it sits, which is how a reader expects to see a deduction.
   */
  credit: boolean;
  /** The result line closing every step down to and including this one. */
  subtotal?: string;
};

export const PROFIT_LOSS_STEPS: readonly ProfitLossStepDef[] = [
  { key: "OperatingRevenue", name: "Pendapatan Usaha", credit: true },
  { key: "CostOfSales", name: "Harga Pokok Penjualan", credit: false, subtotal: "Laba Kotor" },
  { key: "OperatingExpense", name: "Beban Usaha", credit: false, subtotal: "Laba Usaha" },
  { key: "OtherIncome", name: "Pendapatan Lain-lain", credit: true },
  { key: "OtherExpense", name: "Beban Lain-lain", credit: false, subtotal: "Laba Bersih" },
];

// ----------------------------------------------------------------- columns

/**
 * `mtd` is the chosen period alone; `ytd` runs from the fiscal year's first day
 * to the period's last. Both columns of a comparison share one mode, because a
 * month set against a year-to-date produces a difference that means nothing.
 */
export type StatementMode = "mtd" | "ytd";

export const STATEMENT_MODES: { value: StatementMode; label: string }[] = [
  { value: "mtd", label: "Periode ini" },
  { value: "ytd", label: "s.d. Periode ini" },
];

export function columnRange(
  year: { startDate: string },
  period: { startDate: string; endDate: string },
  mode: StatementMode
): PeriodRange {
  return { from: mode === "ytd" ? year.startDate : period.startDate, to: period.endDate };
}

// -------------------------------------------------------------------- rows

export type StatementRowKind =
  | "step"
  | "category"
  | "subcategory"
  | "account"
  | "partner"
  | "subtotal";

export type StatementRow = {
  key: string;
  kind: StatementRowKind;
  /** Indentation, from 0. */
  depth: number;
  code: string | null;
  name: string;
  /** One figure per column, signed in the statement's own direction. */
  values: number[];
  /** An account row, for the drill-through into its General Ledger. */
  accountId?: number;
  /** An account whose figure is split by Partner, so it carries an arrow. */
  hasPartners?: boolean;
  /** A partner row's account, which collapses it. */
  partnerOf?: string;
  /**
   * A figure the statement computed and placed on this account rather than one
   * posted to it — Laba/Rugi Tahun Berjalan and Tahun Lalu Belum Ditutup.
   */
  computed?: boolean;
};

/** One account of the chart, placed by its own lineage. */
export type StatementAccount = {
  id: number;
  label: string;
  name: string;
  parentId: number | null;
  subcategory: { id: number; label: string; name: string };
  category: { id: number; label: string; name: string; step: ProfitLossStep | null };
  /** The Account Type, with the side its total reads positive on. The Neraca's grouping. */
  type?: { id: number; label: string; name: string; credit: boolean };
};

/** The raw movement or balance of one pair in one column. */
export type StatementPair = {
  accountId: number;
  partnerId: number | null;
  debit: number;
  credit: number;
};

export type StatementPartner = { id: number; label: string; name: string };

export type BuiltStatement = {
  rows: StatementRow[];
  /** The last subtotal — Laba Bersih — per column. */
  result: number[];
  /**
   * Accounts that moved but whose category names no step. The seed and a test
   * both prevent it; if it happens anyway the figure is reported rather than
   * silently left out of every subtotal.
   */
  unplaced: string[];
};

const isZero = (values: number[]) => values.every((v) => Math.round(v * 100) === 0);
const add = (a: number[], b: number[]) => a.map((v, i) => roundBase(v + b[i]));
const clean = (values: number[]) => values.map((v) => (v === 0 ? 0 : v));

/**
 * The part both statements share: signing each pair by the side of the group
 * its account sits in, rolling sub-accounts into their parents, and emitting
 * Category → Kelompok → Account → sub-account → Partner for one group.
 *
 * `sideOf` answers whether an account's group reads credit-positive, or null
 * when the account belongs to no group — which the statement reports rather
 * than drops. `placed` adds a computed figure, already in the statement's
 * direction, onto an account's own value, and its row is marked `computed`.
 */
function statementTree(
  accounts: StatementAccount[],
  columns: StatementPair[][],
  partners: Map<number, StatementPartner>,
  sideOf: (a: StatementAccount) => boolean | null,
  placed: Map<number, number[]> = new Map()
) {
  const n = columns.length;
  const zeros = () => new Array<number>(n).fill(0);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const own = new Map<number, number[]>();
  const byPartner = new Map<number, Map<number | null, number[]>>();
  const unplaced = new Set<string>();

  columns.forEach((pairs, col) => {
    for (const p of pairs) {
      const account = accountById.get(p.accountId);
      if (!account) continue;
      const credit = sideOf(account);
      if (credit === null) {
        if (Math.round((p.debit - p.credit) * 100) !== 0) {
          unplaced.add(`${account.label} ${account.name}`);
        }
        continue;
      }
      const value = credit ? p.credit - p.debit : p.debit - p.credit;

      const mine = own.get(p.accountId) ?? zeros();
      mine[col] = roundBase(mine[col] + value);
      own.set(p.accountId, mine);

      const split = byPartner.get(p.accountId) ?? new Map<number | null, number[]>();
      const slot = split.get(p.partnerId) ?? zeros();
      slot[col] = roundBase(slot[col] + value);
      split.set(p.partnerId, slot);
      byPartner.set(p.accountId, split);
    }
  });

  for (const [accountId, values] of placed) {
    if (!accountById.has(accountId)) continue;
    own.set(accountId, add(own.get(accountId) ?? zeros(), values));
  }

  // An account's total is its own figure plus everything beneath it.
  const children = new Map<number, StatementAccount[]>();
  for (const a of accounts) {
    if (a.parentId !== null && accountById.has(a.parentId)) {
      const list = children.get(a.parentId) ?? [];
      list.push(a);
      children.set(a.parentId, list);
    }
  }
  const byLabel = (x: StatementAccount, y: StatementAccount) => compareCodes(x.label, y.label);
  for (const list of children.values()) list.sort(byLabel);

  const totals = new Map<number, number[]>();
  const totalOf = (a: StatementAccount): number[] => {
    const cached = totals.get(a.id);
    if (cached) return cached;
    let sum = own.get(a.id) ?? zeros();
    for (const c of children.get(a.id) ?? []) sum = add(sum, totalOf(c));
    totals.set(a.id, sum);
    return sum;
  };

  const emitAccount = (rows: StatementRow[], a: StatementAccount, depth: number) => {
    const values = totalOf(a);
    if (isZero(values)) return;

    const split = byPartner.get(a.id);
    const named = split ? [...split.entries()].filter(([pid, v]) => pid !== null && !isZero(v)) : [];
    const key = `a${a.id}`;
    rows.push({
      key,
      kind: "account",
      depth,
      code: a.label,
      name: a.name,
      values,
      accountId: a.id,
      hasPartners: named.length > 0,
      ...(placed.has(a.id) ? { computed: true } : {}),
    });

    if (named.length && split) {
      const lines = named
        .map(([pid, v]) => ({ partner: partners.get(pid!), pid: pid!, v }))
        .sort((x, y) => (x.partner?.label ?? "").localeCompare(y.partner?.label ?? ""));
      for (const l of lines) {
        rows.push({
          key: `${key}p${l.pid}`,
          kind: "partner",
          depth: depth + 1,
          code: l.partner?.label ?? null,
          name: l.partner?.name ?? "Partner tidak dikenal",
          values: l.v,
          partnerOf: key,
        });
      }
      const none = split.get(null);
      if (none && !isZero(none)) {
        rows.push({
          key: `${key}p-`,
          kind: "partner",
          depth: depth + 1,
          code: null,
          name: "Tanpa Partner",
          values: none,
          partnerOf: key,
        });
      }
    }

    for (const c of children.get(a.id) ?? []) emitAccount(rows, c, depth + 1);
  };

  /**
   * Category → Kelompok → Account for the accounts `inGroup` admits, pushed
   * onto `rows`; returns the group's total. A kelompok that is the only one its
   * category shows is folded into it — `4.9` over `4.9.1`, both named
   * PENDAPATAN DILUAR USAHA, would state one figure twice under two names.
   */
  const emitGroup = (rows: StatementRow[], inGroup: (a: StatementAccount) => boolean): number[] => {
    const roots = accounts.filter(
      (a) => inGroup(a) && (a.parentId === null || !accountById.has(a.parentId))
    );

    const categories = new Map<
      number,
      {
        cat: StatementAccount["category"];
        subs: Map<number, { sub: StatementAccount["subcategory"]; roots: StatementAccount[] }>;
      }
    >();
    for (const a of roots) {
      const c = categories.get(a.category.id) ?? { cat: a.category, subs: new Map() };
      const s = c.subs.get(a.subcategory.id) ?? { sub: a.subcategory, roots: [] };
      s.roots.push(a);
      c.subs.set(a.subcategory.id, s);
      categories.set(a.category.id, c);
    }

    let groupTotal = zeros();
    const ordered = [...categories.values()].sort((x, y) => compareCodes(x.cat.label, y.cat.label));
    for (const { cat, subs } of ordered) {
      const shown = [...subs.values()]
        .sort((x, y) => compareCodes(x.sub.label, y.sub.label))
        .map((s) => ({
          ...s,
          roots: s.roots.sort(byLabel),
          total: s.roots.reduce((sum, r) => add(sum, totalOf(r)), zeros()),
        }))
        .filter((s) => !isZero(s.total));
      if (!shown.length) continue;

      const catTotal = shown.reduce((sum, s) => add(sum, s.total), zeros());
      groupTotal = add(groupTotal, catTotal);
      rows.push({ key: `c${cat.id}`, kind: "category", depth: 1, code: cat.label, name: cat.name, values: catTotal });

      const fold = shown.length === 1;
      for (const s of shown) {
        if (!fold) {
          rows.push({ key: `u${s.sub.id}`, kind: "subcategory", depth: 2, code: s.sub.label, name: s.sub.name, values: s.total });
        }
        for (const r of s.roots) emitAccount(rows, r, fold ? 2 : 3);
      }
    }
    return groupTotal;
  };

  return { zeros, emitGroup, unplaced: () => [...unplaced] };
}

/**
 * The Laba Rugi's rows, for any number of columns.
 *
 * Step → Category → Kelompok → Account → sub-account → Partner, each heading
 * carrying the total of what sits beneath it, and a result line after each step
 * that closes one. Steps always show, so the statement keeps its shape on a
 * quiet month; everything below a step shows only where some column is not
 * zero.
 */
export function buildProfitLoss(
  accounts: StatementAccount[],
  columns: StatementPair[][],
  partners: Map<number, StatementPartner>
): BuiltStatement {
  const stepOf = new Map(PROFIT_LOSS_STEPS.map((s) => [s.key, s]));
  const tree = statementTree(accounts, columns, partners, (a) =>
    a.category.step ? (stepOf.get(a.category.step)?.credit ?? null) : null
  );

  const rows: StatementRow[] = [];
  let running = tree.zeros();

  for (const step of PROFIT_LOSS_STEPS) {
    const heading: StatementRow = { key: `s${step.key}`, kind: "step", depth: 0, code: null, name: step.name, values: [] };
    rows.push(heading);
    const stepTotal = tree.emitGroup(rows, (a) => a.category.step === step.key);
    heading.values = stepTotal;
    running = add(running, step.credit ? stepTotal : stepTotal.map((v) => -v));

    if (step.subtotal) {
      rows.push({ key: `t${step.key}`, kind: "subtotal", depth: 0, code: null, name: step.subtotal, values: clean(running) });
    }
  }

  return { rows, result: clean(running), unplaced: tree.unplaced() };
}

export type BuiltBalanceSheet = {
  rows: StatementRow[];
  /** The debit-side types' total per column — Total Aktiva. */
  debitTotal: number[];
  /** The credit-side types' total per column — Total Pasiva dan Ekuitas. */
  creditTotal: number[];
  unplaced: string[];
};

/**
 * The Neraca's rows, for any number of columns.
 *
 * One section per Account Type, in code order, each signed by the type's own
 * side — so Akumulasi Penyusutan prints as the deduction it is inside AKTIVA. A
 * section is headed by its name alone and closed by its total, and after the
 * last section one line totals every credit-side type — PASIVA dan EKUITAS —
 * the figure a balanced Neraca matches against the debit side. The names come
 * from the types, never from this file.
 *
 * `placed` carries the computed equity figures, keyed by the account System
 * Default names; each is already credit-positive, the side of EKUITAS.
 */
export function buildBalanceSheet(
  accounts: StatementAccount[],
  columns: StatementPair[][],
  partners: Map<number, StatementPartner>,
  placed: Map<number, number[]> = new Map()
): BuiltBalanceSheet {
  const tree = statementTree(accounts, columns, partners, (a) => a.type?.credit ?? null, placed);

  const types = new Map<number, NonNullable<StatementAccount["type"]>>();
  for (const a of accounts) if (a.type) types.set(a.type.id, a.type);
  const ordered = [...types.values()].sort((x, y) => compareCodes(x.label, y.label));

  const rows: StatementRow[] = [];
  let debitTotal = tree.zeros();
  let creditTotal = tree.zeros();

  for (const type of ordered) {
    rows.push({ key: `s${type.id}`, kind: "step", depth: 0, code: null, name: type.name, values: [] });
    const total = tree.emitGroup(rows, (a) => a.type?.id === type.id);
    rows.push({ key: `t${type.id}`, kind: "subtotal", depth: 0, code: null, name: `Total ${type.name}`, values: clean(total) });
    if (type.credit) creditTotal = add(creditTotal, total);
    else debitTotal = add(debitTotal, total);
  }

  const creditTypes = ordered.filter((t) => t.credit);
  if (creditTypes.length > 1) {
    rows.push({
      key: "tcredit",
      kind: "subtotal",
      depth: 0,
      code: null,
      name: `Total ${creditTypes.map((t) => t.name).join(" dan ")}`,
      values: clean(creditTotal),
    });
  }

  return { rows, debitTotal: clean(debitTotal), creditTotal: clean(creditTotal), unplaced: tree.unplaced() };
}
