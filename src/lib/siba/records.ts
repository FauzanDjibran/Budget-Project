import "server-only";

import { prisma } from "@/lib/prisma";
import { type Entity, entityBySlug } from "./entities";

/**
 * Generic record access for registry-driven entities.
 *
 * Prisma's delegates are not indexable by a runtime string, so the mapping is
 * explicit. Everything crossing into a client component is flattened first:
 * Decimal and Date do not survive serialization.
 */
const DELEGATES = {
  sys_company: () => prisma.sysCompany,
  m_partner: () => prisma.mPartner,
  m_cash_bank: () => prisma.mCashBank,
  ref_currency: () => prisma.refCurrency,
  sys_partner_category: () => prisma.sysPartnerCategory,
  acc_account: () => prisma.accAccount,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function delegate(key: string): any {
  const fn = DELEGATES[key as EntityKey];
  if (!fn) throw new Error(`Unknown entity: ${key}`);
  return fn();
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

/** Ref options for every `ref` field on an entity, keyed by target entity. */
export async function refOptions(
  entity: Entity
): Promise<Record<string, RefOption[]>> {
  const targets = Array.from(
    new Set(entity.fields.filter((f) => f.type === "ref" && f.ref).map((f) => f.ref!))
  );

  const result: Record<string, RefOption[]> = {};
  for (const target of targets) {
    result[target] = await optionsFor(target);
  }
  return result;
}

export async function optionsFor(target: string): Promise<RefOption[]> {
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
    case "ref_currency": {
      const rows = await prisma.refCurrency.findMany({ orderBy: { id: "asc" } });
      return rows.map((r) => ({
        id: r.id,
        label: r.currency_label,
        name: r.currency_name,
        active: r.status === "Active",
      }));
    }
    case "acc_account": {
      // Only postable Kas/Bank accounts can back a cash/bank resource.
      const rows = await prisma.accAccount.findMany({
        where: {
          is_postable: true,
          account_subcategory: { subcategory_label: { in: ["Kas", "Bank"] } },
        },
        orderBy: { id: "asc" },
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
 * Values for columns marked `computed` — counts and derived text the mockup
 * calculated inline against its in-memory store.
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

  return out;
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
