/**
 * What an audit row *means*, in the UI's language.
 *
 * `audit_log.action` is the coarse verb — TAMBAH, UPDATE, HAPUS — and it cannot
 * answer the question a record's history is opened for. Submitting, approving,
 * rejecting, posting and confirming are all writes, so all five read as UPDATE:
 * a Budget's history would print "Diubah · Diubah · Diubah" and say nothing
 * about who approved it or when it closed. `audit_log.event` carries the
 * specific step, and this file is where a step becomes a sentence.
 *
 * **The label is not stored.** Each lifecycle event resolves through the
 * workflow table that already owns it — `BUDGET_TRANSITIONS`,
 * `TRANSACTION_TRANSITIONS`, `JOURNAL_TRANSITIONS`,
 * `FISCAL_YEAR_TRANSITIONS` — so the word a button
 * says and the word its history entry says are the same string, and adding a
 * transition is a row in one table rather than a row in one table plus a label
 * here plus a migration.
 *
 * Client-safe on purpose — no `server-only`, no database import — because the
 * panel that renders a history is a client component, the same way every
 * workflow table it reads is.
 */
import type { IconName } from "@/components/icon";
import { BUDGET_TRANSITIONS } from "./budget-workflow";
import { FISCAL_YEAR_TRANSITIONS } from "./fiscal-workflow";
import type { ActionTone } from "./header-actions";
import { JOURNAL_TRANSITIONS } from "./journal-workflow";
import { TRANSACTION_TRANSITIONS } from "./transaction-workflow";
import { TRANSFER_TRANSITIONS } from "./transfer-workflow";

/** How an entry is drawn: its words, its icon, and its weight. */
export type AuditEventLabel = {
  /** "Disetujui", "Diposting" — past tense, because it has already happened. */
  label: string;
  icon: IconName;
  tone: ActionTone;
  /**
   * True where the event was a consequence rather than a decision — a Budget
   * closing because a posting reached its planned amount. The panel says so,
   * because attributing it to the person who posted would misread the trace.
   */
  systemDriven?: boolean;
};

/**
 * The events every record shares, whatever kind of record it is.
 *
 * `create` and `update` are what `action` alone already said; they are named
 * here so that one vocabulary covers the whole panel and the renderer never
 * has to fall back to reading `action` for some rows and `event` for others.
 */
const COMMON: Record<string, AuditEventLabel> = {
  create: { label: "Dibuat", icon: "plus", tone: "neutral" },
  update: { label: "Diubah", icon: "pen", tone: "neutral" },
  activate: { label: "Diaktifkan", icon: "check", tone: "primary" },
  deactivate: { label: "Dinonaktifkan", icon: "block", tone: "danger" },
};

/**
 * Turning a workflow table into history labels.
 *
 * A transition's `label` is an imperative — "Setujui", "Ajukan", "Post" —
 * because it is written on a button the reader is about to press. A history
 * entry is the opposite: it reports something already done. Rather than derive
 * one from the other by string surgery, each is named, and the transition table
 * still owns the `icon` and the `tone` so a step drawn as danger on a button is
 * drawn as danger in the trace.
 */
function fromTransition(
  source: { icon: IconName; tone: ActionTone },
  label: string
): AuditEventLabel {
  return { label, icon: source.icon, tone: source.tone };
}

/** Budget: Draft → Submitted → Open, and Closed by realization. */
const BUDGET_EVENTS: Record<string, AuditEventLabel> = {
  ...COMMON,
  submit: fromTransition(BUDGET_TRANSITIONS.submit, "Diajukan"),
  approve: fromTransition(BUDGET_TRANSITIONS.approve, "Disetujui"),
  reject: fromTransition(BUDGET_TRANSITIONS.reject, "Ditolak"),
  cancel: fromTransition(BUDGET_TRANSITIONS.cancel, "Dibatalkan"),
  // Nobody closes a Budget by hand (CLAUDE.md §10 rule 36) — it closes because
  // a posting reached its planned amount, so the actor on the row is whoever
  // posted rather than whoever decided.
  realize: {
    label: "Realisasi tercatat",
    icon: "coin",
    tone: "neutral",
    systemDriven: true,
  },
  close: {
    label: "Ditutup oleh realisasi",
    icon: "lock",
    tone: "primary",
    systemDriven: true,
  },
};

/** Cash Bank Transaction: Draft → Pending → Posted, or Draft → Posted. */
const TRANSACTION_EVENTS: Record<string, AuditEventLabel> = {
  ...COMMON,
  submit: fromTransition(TRANSACTION_TRANSITIONS.submit, "Diajukan ke induk"),
  post: fromTransition(TRANSACTION_TRANSITIONS.post, "Diposting"),
  cancel: fromTransition(TRANSACTION_TRANSITIONS.cancel, "Dibatalkan"),
  // Posted by the induk confirming the Funding Request rather than by this
  // document's own Post button. Same destination, different hand.
  post_funded: {
    label: "Diposting via funding induk",
    icon: "check",
    tone: "primary",
  },
};

/** Cash Bank Transfer: Draft → Posted, or Draft → Cancelled. */
const TRANSFER_EVENTS: Record<string, AuditEventLabel> = {
  ...COMMON,
  post: fromTransition(TRANSFER_TRANSITIONS.post, "Diposting"),
  cancel: fromTransition(TRANSFER_TRANSITIONS.cancel, "Dibatalkan"),
};

/** Funding Request: Open → Closed, or withdrawn by the requester. */
const FUNDING_EVENTS: Record<string, AuditEventLabel> = {
  ...COMMON,
  request: { label: "Permintaan dana dibuka", icon: "send", tone: "primary" },
  confirm: { label: "Dikonfirmasi induk", icon: "check", tone: "primary" },
  withdraw: { label: "Ditarik pemohon", icon: "block", tone: "danger" },
};

/**
 * Journal: written by a posting, or typed and then posted.
 *
 * `create` reads as "dibuat" either way, because it is: an automatic journal is
 * created already posted, and a manual one is created as a draft. The `post`
 * row is what separates the two histories — an automatic journal never has one,
 * and a manual journal's is the moment it became accounting.
 */
const JOURNAL_EVENTS: Record<string, AuditEventLabel> = {
  ...COMMON,
  create: { label: "Journal dibuat", icon: "book", tone: "neutral" },
  post: fromTransition(JOURNAL_TRANSITIONS.post, "Diposting"),
  cancel: fromTransition(JOURNAL_TRANSITIONS.cancel, "Dibatalkan"),
};

/** Fiscal Year: Draft → Open. Closed is not reachable yet (§13). */
const FISCAL_EVENTS: Record<string, AuditEventLabel> = {
  ...COMMON,
  open: fromTransition(FISCAL_YEAR_TRANSITIONS.open, "Diaktifkan"),
};

/** The account-administration events, which are not a document lifecycle. */
const USER_EVENTS: Record<string, AuditEventLabel> = {
  ...COMMON,
  roles: { label: "Role diubah", icon: "users", tone: "neutral" },
  password: { label: "Password diubah", icon: "lock", tone: "neutral" },
  reset: { label: "Password direset admin", icon: "lock", tone: "danger" },
};

const ROLE_EVENTS: Record<string, AuditEventLabel> = {
  ...COMMON,
  permissions: { label: "Permission diubah", icon: "lock", tone: "neutral" },
};

/**
 * Which vocabulary a table speaks.
 *
 * A table absent from this map uses `COMMON`, which is every master record: it
 * is created, edited, and activated or deactivated, and has no lifecycle beyond
 * that. Adding a module means adding its events beside its workflow table, not
 * teaching this map about its internals.
 */
const BY_ENTITY: Record<string, Record<string, AuditEventLabel>> = {
  bud_budget: BUDGET_EVENTS,
  fin_cash_bank_transaction: TRANSACTION_EVENTS,
  fin_cash_bank_transfer: TRANSFER_EVENTS,
  fin_funding_request: FUNDING_EVENTS,
  acc_fiscal_year: FISCAL_EVENTS,
  acc_journal: JOURNAL_EVENTS,
  sys_user: USER_EVENTS,
  sys_role: ROLE_EVENTS,
};

/** The coarse verb, for rows written before `event` existed. */
const BY_ACTION: Record<string, AuditEventLabel> = {
  TAMBAH: COMMON.create,
  UPDATE: COMMON.update,
  HAPUS: { label: "Dihapus", icon: "trash", tone: "danger" },
};

/**
 * How one audit row reads.
 *
 * Falls back twice, and both fallbacks are honest rather than invented: an
 * `event` this build does not recognise reports the coarse verb, and a row with
 * no `event` at all — every row written before the column existed — reports the
 * same. Neither claims to know which transition it was, because the database
 * does not.
 */
export function auditEventLabel(
  entityKey: string,
  action: string,
  event: string | null
): AuditEventLabel {
  const vocabulary = BY_ENTITY[entityKey] ?? COMMON;
  if (event && vocabulary[event]) return vocabulary[event];
  return BY_ACTION[action] ?? { label: action, icon: "hist", tone: "neutral" };
}

/** Every event key this build can name, for the test that keeps them in step. */
export function knownAuditEvents(): Record<string, string[]> {
  return Object.fromEntries([
    ["*", Object.keys(COMMON)],
    ...Object.entries(BY_ENTITY).map(
      ([key, vocabulary]) => [key, Object.keys(vocabulary)] as const
    ),
  ]);
}
