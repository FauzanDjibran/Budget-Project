import "server-only";

import { prisma } from "@/lib/prisma";
import { ENTITIES } from "./entities";
import { rowsByIds } from "./records";
import { recordTitle } from "./record-title";
import { budgetsByIds } from "./budget";
import { transactionNumbersByIds } from "./finance";
import { transferNumbersByIds } from "./transfer";
import { noteNumbersByIds } from "./dncn";
import { fundingRequestNumbersByIds } from "./funding";
import { fiscalClosingLabels } from "./fiscal";
import { journalNumbersByIds } from "./journal";
import { openingBalanceNumbersByIds } from "./opening-balance";
import { userLabels, roleLabels } from "./users";

/**
 * Reading the audit log.
 *
 * `audit_log` stores `(entity_key, row_id)` — the cheapest thing to write and
 * the least useful thing to read. The dashboard rendered `m_partner`, which
 * says neither what kind of record changed nor which one, so the panel could be
 * scanned but not actually used (CLAUDE.md §17).
 *
 * This resolves both halves: the **subject** ("Partner") from a catalogue, and
 * the **title** ("PRT.0011 – Cabang Medan") from the module that owns the
 * table. No resolver here queries a foreign table: registry entities go through
 * `records.ts`, which is the registry's own generic reader, and every document
 * is named by its own module. That is the module contract (§3) applied to the
 * one screen that necessarily touches every module at once — the audit log
 * depends on all of them, and none of them depends on it.
 *
 * Entries are grouped by `entity_key` before resolving, so a panel of six costs
 * one query per distinct subject rather than one per entry.
 */

/** Ids -> a human title for each, missing where the record no longer resolves. */
type TitleResolver = (ids: number[]) => Promise<Map<number, string>>;

type Subject = {
  /** What kind of thing changed, in the UI's language. */
  label: string;
  resolve: TitleResolver | null;
};

/** Every registry entity names itself the way its own form and list do. */
function registrySubject(key: string): Subject | null {
  const entity = ENTITIES.find((e) => e.key === key);
  if (!entity) return null;
  return {
    label: entity.single ?? entity.name,
    resolve: async (ids) => {
      const rows = await rowsByIds(entity, ids);
      // `recordTitle` composes a mapping's name from the records it connects,
      // which needs ref options this panel does not load; without them it falls
      // back to the record's own code, which is still readable.
      return new Map(
        rows.map((r) => [Number(r.id), recordTitle(entity, r, {})])
      );
    },
  };
}

/**
 * Subjects that are not registry entities — the documents and the settings.
 *
 * Budget, Finance, User and Role are all deliberately outside the registry
 * (§12), so each needs a line here. A subject with `resolve: null` is one whose
 * rows have no individual identity worth printing.
 */
const EXTRA_SUBJECTS: Record<string, Subject> = {
  bud_budget: {
    label: "Budget",
    resolve: async (ids) => {
      const rows = await budgetsByIds(ids);
      return new Map(rows.map((b) => [b.id, b.budget_no]));
    },
  },
  fin_cash_bank_transaction: {
    label: "Cash Bank Transaction",
    resolve: transactionNumbersByIds,
  },
  fin_cash_bank_transfer: {
    label: "Cash Bank Transfer",
    resolve: transferNumbersByIds,
  },
  fin_dncn: {
    label: "Debit / Credit Note",
    resolve: noteNumbersByIds,
  },
  fin_funding_request: {
    label: "Funding Request",
    resolve: fundingRequestNumbersByIds,
  },
  acc_journal: { label: "Journal", resolve: journalNumbersByIds },
  acc_opening_balance: {
    label: "Opening Balance",
    resolve: openingBalanceNumbersByIds,
  },
  acc_fiscal_closing: {
    label: "Penutupan Fiscal Year",
    resolve: fiscalClosingLabels,
  },
  sys_user: { label: "User", resolve: userLabels },
  sys_role: { label: "Role", resolve: roleLabels },
  // A setting's `row_id` is the id of a `sys_setting` row, not of anything a
  // reader recognises. The catalogue in code is what names these, and there is
  // only ever a handful, so the subject alone is the whole story.
  sys_setting: {
    label: "System Default",
    resolve: null,
  },
};

function subjectFor(key: string): Subject | null {
  return EXTRA_SUBJECTS[key] ?? registrySubject(key);
}

/** Every `entity_key` this application knows how to describe. */
export function knownAuditSubjects(): string[] {
  return [
    ...Object.keys(EXTRA_SUBJECTS),
    ...ENTITIES.map((e) => e.key),
  ].sort();
}

export type ActivityEntry = {
  id: number;
  at: Date;
  action: string;
  by: number;
  /** "Partner", "Budget" — always present, even for an unknown key. */
  subject: string;
  /** "PRT.0011 – Cabang Medan", or null when the record cannot be named. */
  title: string | null;
};

/**
 * The most recent changes, already readable.
 *
 * A record that has since been renamed reads under its *current* name, not the
 * name it had when it changed — `audit_log` stores no snapshot, and inventing
 * one here would be worse than saying nothing. A record whose row cannot be
 * resolved keeps its subject and loses only its title.
 */
export async function recentActivity(limit = 6): Promise<ActivityEntry[]> {
  const rows = await prisma.auditLog.findMany({
    orderBy: { at: "desc" },
    take: limit,
  });
  if (!rows.length) return [];

  const idsByKey = new Map<string, number[]>();
  for (const r of rows) {
    const ids = idsByKey.get(r.entity_key) ?? [];
    if (!ids.includes(r.row_id)) ids.push(r.row_id);
    idsByKey.set(r.entity_key, ids);
  }

  const titles = new Map<string, Map<number, string>>();
  await Promise.all(
    [...idsByKey].map(async ([key, ids]) => {
      const subject = subjectFor(key);
      if (!subject?.resolve) return;
      try {
        titles.set(key, await subject.resolve(ids));
      } catch {
        // A subject that cannot be read must not take the dashboard down with
        // it: the entry still reports what changed and when.
      }
    })
  );

  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    by: r.by,
    subject: subjectFor(r.entity_key)?.label ?? r.entity_key,
    title: titles.get(r.entity_key)?.get(r.row_id) ?? null,
  }));
}

// ------------------------------------------------------- one record's history

export type HistoryEntry = {
  id: number;
  at: Date;
  action: string;
  /** The transition key, or null for a row written before `event` existed. */
  event: string | null;
  /** Who did it — a name, falling back to an email, then to nothing. */
  by: string | null;
};

export type RecordHistory = {
  entries: HistoryEntry[];
  /** How many rows exist in total, which is not `entries.length` once capped. */
  total: number;
};

/**
 * Everything that has happened to one record, newest first.
 *
 * Newest first because a history is read backwards: the entry a reader opened
 * the panel for is the most recent one, and putting the oldest at the top would
 * push it below the fold on any record with a long life. Older context is what
 * scrolling is for.
 *
 * Capped, and the cap is visible: `total` is counted separately so the panel can
 * say "menampilkan 10 dari 47" rather than silently presenting a slice as if it
 * were the whole story. A document's lifecycle fits inside the cap comfortably;
 * a master record edited for years does not, and should not pretend to.
 *
 * Only `audit_log` is read here. Resolving *what changed* is not possible —
 * the table stores no snapshot (CLAUDE.md §17) — and inventing one would be
 * worse than the panel saying only that a change happened, and by whom.
 */
export async function recordHistory(
  entityKey: string,
  rowId: number,
  limit = 10
): Promise<RecordHistory> {
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entity_key: entityKey, row_id: rowId },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: limit,
    }),
    prisma.auditLog.count({
      where: { entity_key: entityKey, row_id: rowId },
    }),
  ]);
  if (!rows.length) return { entries: [], total };

  const actors = await userLabels([...new Set(rows.map((r) => r.by))]);

  return {
    entries: rows.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      event: r.event,
      by: actors.get(r.by) ?? null,
    })),
    total,
  };
}
