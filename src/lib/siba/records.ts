import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/format";
import { cashBankBalanceMap } from "./cash-bank";
import {
  allowedPartnerCategories,
  budgetCategoryNeedsPartner,
  type Entity,
  type Field,
  entityBySlug,
} from "./entities";

/**
 * Generic record access for registry-driven entities.
 *
 * Prisma's delegates are not indexable by a runtime string, so the mapping is
 * explicit. Everything crossing into a client component is flattened first:
 * Decimal and Date do not survive serialization.
 */
type Client = typeof prisma | Prisma.TransactionClient;

const DELEGATES = {
  sys_company: (db: Client) => db.sysCompany,
  m_partner: (db: Client) => db.mPartner,
  m_cash_bank: (db: Client) => db.mCashBank,
  ref_currency: (db: Client) => db.refCurrency,
  sys_partner_category: (db: Client) => db.sysPartnerCategory,
  sys_budget_category: (db: Client) => db.sysBudgetCategory,
  acc_account: (db: Client) => db.accAccount,
  acc_account_subcategory: (db: Client) => db.accAccountSubcategory,
  acc_budget_category_account: (db: Client) => db.accBudgetCategoryAccount,
  acc_fiscal_year: (db: Client) => db.accFiscalYear,
  acc_fiscal_period: (db: Client) => db.accFiscalPeriod,
} as const;

export type EntityKey = keyof typeof DELEGATES;

export type Row = Record<string, unknown> & { id: number };

/** An option as shown in a dropdown or ref cell: `LABEL - Name`. */
export type RefOption = {
  id: number;
  label: string;
  name: string;
  active: boolean;
  /** Narrows options for dependent fields, e.g. accounts belong to a company. */
  companyId?: number;
};

/** Pass a transaction client to run the write inside someone else's transaction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function delegate(key: string, db: Client = prisma): any {
  const fn = DELEGATES[key as EntityKey];
  if (!fn) throw new Error(`Unknown entity: ${key}`);
  return fn(db);
}

/** Decimal -> number, Date -> ISO string, so rows can cross to the client. */
export function serialize<T extends Record<string, unknown>>(row: T): Row {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (v && typeof v === "object" && "toNumber" in v) {
      out[k] = (v as { toNumber(): number }).toNumber();
    } else out[k] = v;
  }
  return out as Row;
}

export async function listRows(entity: Entity): Promise<Row[]> {
  const rows = await delegate(entity.key).findMany({ orderBy: { id: "asc" } });
  return rows.map(serialize);
}

export async function getRow(entity: Entity, id: number): Promise<Row | null> {
  const row = await delegate(entity.key).findUnique({ where: { id } });
  return row ? serialize(row) : null;
}

/**
 * Ref options for every `ref` field on an entity, keyed by FIELD name.
 *
 * Keying by field rather than by target matters: two fields can point at the
 * same table and still need different option sets. Chart of Accounts is the
 * case that forces it — `parent_account` may pick any account in the Company,
 * while Cash & Bank may only pick a postable Kas/Bank account. Both target
 * `acc_account`.
 *
 * The structural half of each narrowing happens here, on the server, so the
 * options a form offers are already the options the Server Action will accept.
 * The half that depends on what the user is typing right now — the Company, the
 * Budget Category — is applied again in the form.
 */
export async function refOptions(
  entity: Entity
): Promise<Record<string, RefOption[]>> {
  const result: Record<string, RefOption[]> = {};
  for (const field of entity.fields) {
    if (field.type !== "ref" || !field.ref) continue;
    result[field.name] = await optionsFor(field.ref, field.refFilter);
  }
  return result;
}

/** Options a list needs for columns whose field the form does not edit. */
export async function columnRefOptions(
  entity: Entity,
  existing: Record<string, RefOption[]>
): Promise<Record<string, RefOption[]>> {
  const out = { ...existing };
  for (const column of entity.columns) {
    if (!column.isRef || out[column.field]) continue;
    const field = entity.fields.find((f) => f.name === column.field);
    if (field?.ref) out[column.field] = await optionsFor(field.ref);
  }
  return out;
}

export async function optionsFor(
  target: string,
  filter?: Field["refFilter"]
): Promise<RefOption[]> {
  switch (target) {
    case "sys_company": {
      const rows = await prisma.sysCompany.findMany({ orderBy: { id: "asc" } });
      return rows.map((r) => ({
        id: r.id,
        label: r.company_label,
        name: r.company_name,
        active: true,
      }));
    }
    case "sys_partner_category": {
      const rows = await prisma.sysPartnerCategory.findMany({ orderBy: { id: "asc" } });
      return rows.map((r) => ({
        id: r.id,
        label: r.category_label,
        name: r.category_name,
        active: true,
      }));
    }
    case "sys_budget_category": {
      const rows = await prisma.sysBudgetCategory.findMany({ orderBy: { id: "asc" } });
      return rows.map((r) => ({
        id: r.id,
        label: r.category_label,
        name: r.category_name,
        active: true,
      }));
    }
    case "ref_currency": {
      const rows = await prisma.refCurrency.findMany({ orderBy: { id: "asc" } });
      return rows.map((r) => ({
        id: r.id,
        label: r.currency_label,
        name: r.currency_name,
        active: r.status === "Active",
      }));
    }
    case "acc_account_subcategory": {
      const rows = await prisma.accAccountSubcategory.findMany({ orderBy: { id: "asc" } });
      return rows.map((r) => ({
        id: r.id,
        label: r.subcategory_label,
        name: r.subcategory_name,
        active: r.status === "Active",
      }));
    }
    case "acc_fiscal_year": {
      const rows = await prisma.accFiscalYear.findMany({ orderBy: { id: "asc" } });
      return rows.map((r) => ({
        id: r.id,
        label: r.year_label,
        name: r.year_name,
        active: r.status !== "Closed",
      }));
    }
    case "acc_account": {
      const rows = await prisma.accAccount.findMany({
        where: accountWhere(filter),
        orderBy: [{ company_id: "asc" }, { account_label: "asc" }],
      });
      return rows.map((r) => ({
        id: r.id,
        label: r.account_label,
        name: r.account_name,
        active: r.is_active,
        companyId: r.company_id,
      }));
    }
    default:
      return [];
  }
}

/**
 * The structural half of an account narrowing — the part that does not depend
 * on anything the user is still choosing. `validateAccountChoice` applies the
 * same rules when the Server Action runs; this only decides what to offer.
 */
function accountWhere(filter?: Field["refFilter"]) {
  switch (filter) {
    case "cashBankAccount":
      return {
        is_postable: true,
        account_subcategory: { subcategory_label: { in: CASH_BANK_SUBCATEGORIES } },
      };
    case "postableAccount":
      return { is_postable: true };
    default:
      return {};
  }
}

/** Only these account groups may back a cash/bank resource. */
export const CASH_BANK_SUBCATEGORIES = ["Kas", "Bank"];

/**
 * The account a Cash & Bank resource posts to, checked against every rule at
 * once. The form narrows its picker to the same set, but this is what actually
 * enforces it: a Server Action is reachable directly, with any account id.
 */
export async function checkCashBankAccount(
  accountId: number,
  companyId: number
): Promise<string | null> {
  const account = await prisma.accAccount.findUnique({
    where: { id: accountId },
    select: {
      company_id: true,
      is_postable: true,
      is_active: true,
      account_subcategory: { select: { subcategory_label: true } },
    },
  });
  if (!account) return "Account tidak ditemukan.";
  if (account.company_id !== companyId) {
    return "Account harus milik Company yang sama dengan resource ini.";
  }
  if (!account.is_postable) {
    return "Account header tidak dapat menerima posting. Pilih account postable.";
  }
  if (!CASH_BANK_SUBCATEGORIES.includes(account.account_subcategory.subcategory_label)) {
    return "Account harus berada pada kelompok Kas atau Bank.";
  }
  if (!account.is_active) {
    return "Account tersebut non-aktif dan tidak dapat dipilih.";
  }
  return null;
}

/** The account ids that would form a cycle if made this account's parent. */
export async function accountDescendants(rootId: number): Promise<Set<number>> {
  const all = await prisma.accAccount.findMany({
    select: { id: true, parent_account: true },
  });
  const byParent = new Map<number, number[]>();
  for (const a of all) {
    if (a.parent_account == null) continue;
    const list = byParent.get(a.parent_account) ?? [];
    list.push(a.id);
    byParent.set(a.parent_account, list);
  }
  const out = new Set<number>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    for (const child of byParent.get(queue.shift()!) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

/** Partner category ids a Budget Category accepts, resolved through labels. */
export async function partnerCategoriesForBudgetCategory(
  budgetCategoryId: number
): Promise<{ needsPartner: boolean; allowedIds: number[] } | null> {
  const category = await prisma.sysBudgetCategory.findUnique({
    where: { id: budgetCategoryId },
    select: { category_label: true },
  });
  if (!category) return null;
  const labels = allowedPartnerCategories(category.category_label);
  const rows = await prisma.sysPartnerCategory.findMany({
    where: { category_label: { in: labels } },
    select: { id: true },
  });
  return {
    needsPartner: budgetCategoryNeedsPartner(category.category_label),
    allowedIds: rows.map((r) => r.id),
  };
}

/**
 * Values for columns marked `computed` — counts and derived text that are not
 * columns on the row itself.
 */
export async function computedValues(
  entity: Entity,
  rows: Row[]
): Promise<Record<number, Record<string, string | number>>> {
  const out: Record<number, Record<string, string | number>> = {};
  for (const r of rows) out[r.id] = {};

  if (entity.key === "sys_company") {
    const [partners, cashBanks, accounts] = await Promise.all([
      prisma.mPartner.groupBy({ by: ["company_id"], _count: { _all: true } }),
      prisma.mCashBank.groupBy({ by: ["company_id"], _count: { _all: true } }),
      prisma.accAccount.groupBy({ by: ["company_id"], _count: { _all: true } }),
    ]);
    const pick = (
      groups: { company_id: number; _count: { _all: number } }[],
      id: number
    ) => groups.find((g) => g.company_id === id)?._count._all ?? 0;

    const parent = rows.find((r) => r.is_parent === true);
    for (const r of rows) {
      out[r.id] = {
        rel: r.is_parent
          ? "Induk"
          : parent
            ? `Anak dari ${parent.company_label as string}`
            : "Anak",
        partner_count: pick(partners, r.id),
        cash_bank_count: pick(cashBanks, r.id),
        account_count: pick(accounts, r.id),
      };
    }
  }

  if (entity.key === "ref_currency") {
    const groups = await prisma.mCashBank.groupBy({
      by: ["currency_id"],
      _count: { _all: true },
    });
    for (const r of rows) {
      out[r.id] = {
        cash_bank_count:
          groups.find((g) => g.currency_id === r.id)?._count._all ?? 0,
      };
    }
  }

  // Balance is never a column on the master: it comes from the Cash Bank Book,
  // which is the only thing that knows what has actually moved.
  if (entity.key === "m_cash_bank") {
    const [balances, currencies] = await Promise.all([
      cashBankBalanceMap(),
      prisma.refCurrency.findMany({ select: { id: true, currency_label: true } }),
    ]);
    const label = new Map(currencies.map((c) => [c.id, c.currency_label]));
    for (const r of rows) {
      out[r.id] = {
        balance: formatMoney(
          balances.get(r.id) ?? 0,
          label.get(r.currency_id as number) ?? "IDR"
        ),
      };
    }
  }

  if (entity.key === "acc_budget_category_account") {
    const accounts = await prisma.accAccount.findMany({
      select: { id: true, normal_balance: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a.normal_balance]));
    for (const r of rows) {
      out[r.id] = { normal_balance: byId.get(r.account_id as number) ?? "—" };
    }
  }

  if (entity.key === "acc_fiscal_year") {
    const groups = await prisma.accFiscalPeriod.groupBy({
      by: ["fiscal_year_id"],
      _count: { _all: true },
    });
    for (const r of rows) {
      out[r.id] = {
        period_count:
          groups.find((g) => g.fiscal_year_id === r.id)?._count._all ?? 0,
      };
    }
  }

  return out;
}

// ------------------------------------------------------------------ COA tree

export type TreeAccount = {
  id: number;
  label: string;
  name: string;
  companyId: number;
  companyLabel: string;
  subcategoryId: number;
  parentId: number | null;
  normalBalance: string;
  isPostable: boolean;
  isActive: boolean;
  requirePartner: boolean;
  partnerCategoryLabel: string | null;
  isControlAccount: boolean;
};

export type TreeSubcategory = { id: number; label: string; name: string };

export type TreeCategory = {
  id: number;
  label: string;
  typeLabel: string;
  subcategories: TreeSubcategory[];
};

/**
 * The structural skeleton of the bagan akun: category -> kelompok -> account.
 *
 * Categories and kelompok are system structure with no menu of their own: they
 * are seeded, they are not accounts, and application logic reads them by label.
 * They are read here so the tree can group accounts under them.
 */
export async function accountTree(): Promise<{
  categories: TreeCategory[];
  accounts: TreeAccount[];
}> {
  const [categories, subcategories, types, accounts, companies, partnerCategories] =
    await Promise.all([
      prisma.accAccountCategory.findMany({ orderBy: { id: "asc" } }),
      prisma.accAccountSubcategory.findMany({ orderBy: { id: "asc" } }),
      prisma.sysAccountType.findMany(),
      prisma.accAccount.findMany({ orderBy: [{ account_label: "asc" }] }),
      prisma.sysCompany.findMany(),
      prisma.sysPartnerCategory.findMany(),
    ]);

  const typeLabel = new Map(types.map((t) => [t.id, t.type_label]));
  const companyLabel = new Map(companies.map((c) => [c.id, c.company_label]));
  const partnerLabel = new Map(partnerCategories.map((p) => [p.id, p.category_label]));

  return {
    categories: categories.map((c) => ({
      id: c.id,
      label: c.category_label,
      typeLabel: typeLabel.get(c.account_type_id) ?? "",
      subcategories: subcategories
        .filter((s) => s.account_category_id === c.id)
        .map((s) => ({ id: s.id, label: s.subcategory_label, name: s.subcategory_name })),
    })),
    accounts: accounts.map((a) => ({
      id: a.id,
      label: a.account_label,
      name: a.account_name,
      companyId: a.company_id,
      companyLabel: companyLabel.get(a.company_id) ?? "",
      subcategoryId: a.account_subcategory_id,
      parentId: a.parent_account,
      normalBalance: a.normal_balance,
      isPostable: a.is_postable,
      isActive: a.is_active,
      requirePartner: a.require_partner,
      partnerCategoryLabel: a.partner_category_id
        ? partnerLabel.get(a.partner_category_id) ?? null
        : null,
      isControlAccount: a.is_control_account,
    })),
  };
}

export type CompanyStructure = {
  /** Exactly one parent and exactly one child. */
  ok: boolean;
  total: number;
  parents: number;
  children: number;
};

/**
 * Asserts the foundational two-company invariant: one induk, one anak. Nothing
 * in the application can create or edit a Company, so a violation means the
 * seed or the database was changed out of band — which the dashboard surfaces
 * rather than silently building on.
 */
export async function companyStructure(): Promise<CompanyStructure> {
  const [total, parents] = await Promise.all([
    prisma.sysCompany.count(),
    prisma.sysCompany.count({ where: { is_parent: true } }),
  ]);
  const children = total - parents;
  return { ok: total === 2 && parents === 1 && children === 1, total, parents, children };
}

/** Next system code, e.g. `part.0011`. */
export async function nextCode(entity: Entity): Promise<string> {
  const rows = await delegate(entity.key).findMany({
    select: { [entity.codeField]: true },
  });
  let max = 0;
  for (const r of rows as Record<string, string>[]) {
    const raw = r[entity.codeField];
    const n = Number(String(raw ?? "").split(".")[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${entity.codePrefix}.${String(max + 1).padStart(4, "0")}`;
}

export function requireEntity(slug: string): Entity {
  const entity = entityBySlug(slug);
  if (!entity) throw new Error(`Unknown entity slug: ${slug}`);
  return entity;
}

export { delegate };
