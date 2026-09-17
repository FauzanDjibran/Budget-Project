/**
 * The manual journal's lifecycle, written once and read by both sides.
 *
 *   Draft ──post──> Posted     (final — it is in the books)
 *     │
 *     └──cancel──> Cancelled   (final — it never was)
 *
 * Only a **manual** journal has a lifecycle at all. A journal produced by a
 * document being posted is born `Posted`, because it records something that has
 * already happened; there is nothing to draft, nothing to cancel, and nothing
 * to decide about it.
 *
 * `Posted` is one-way and there is no reversal. Concept doc §15 makes every
 * posted record append-only: a correction is a *new* journal, never an edit of
 * the one that was wrong. There is no delete either, here or anywhere — a draft
 * that should not exist is cancelled, which leaves its number behind.
 *
 * Every transition names the status it may start from, the status it produces,
 * and the one permission it needs. The row menu reads this table to decide what
 * to offer; the Server Action reads the same table to decide what to allow, so
 * a hidden menu item and a refused action can never disagree. This is the shape
 * `budget-workflow.ts` and `transaction-workflow.ts` established.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type JournalStatus = "Draft" | "Posted" | "Cancelled";

export type JournalAction = "post" | "cancel";

export type JournalTransition = {
  label: string;
  permission: PermissionCode;
  from: JournalStatus[];
  to: JournalStatus;
  icon: IconName;
  /** Decides both where the button sits in `.ph-act` and how it is drawn. */
  tone: ActionTone;
  /** Confirmation copy — states the consequence, never just "are you sure?". */
  title: string;
  body: string;
  confirmLabel: string;
  /** Toast shown once the transition has actually been written. */
  done: string;
};

export const JOURNAL_TRANSITIONS: Record<JournalAction, JournalTransition> = {
  post: {
    label: "Post",
    permission: "JOURNAL_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Post Journal Manual",
    body:
      "Journal masuk ke buku besar dengan tanggal hari ini dan langsung " +
      "terbaca pada General Ledger dan Trial Balance. Setelah diposting " +
      "journal tidak dapat diubah, dibatalkan, maupun dibalik — koreksi " +
      "dilakukan sebagai journal baru.",
    confirmLabel: "Ya, Post",
    done: "Journal diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "JOURNAL_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Journal Manual?",
    body:
      "Journal ditandai Dibatalkan dan tidak dapat diposting lagi. Tidak ada " +
      "saldo yang terpengaruh karena draft belum pernah masuk buku besar. " +
      "Nomor journal tetap tersimpan sebagai jejak.",
    confirmLabel: "Ya, Batalkan",
    done: "Journal dibatalkan",
  },
};

/** Whether a transition is legal from a status, ignoring permissions. */
export function journalTransitionAllowed(
  action: JournalAction,
  status: JournalStatus
): boolean {
  return JOURNAL_TRANSITIONS[action].from.includes(status);
}

/**
 * A manual journal is editable only while it is a Draft — that is, only while
 * it is not yet accounting. Posting freezes it permanently.
 */
export const JOURNAL_EDITABLE: JournalStatus[] = ["Draft"];

export function journalIsEditable(status: JournalStatus): boolean {
  return JOURNAL_EDITABLE.includes(status);
}

/** What the signed-in user may do with manual journals — presentation only. */
export type JournalAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
};

export function journalAbilities(
  permissions: Iterable<string>
): JournalAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("JOURNAL_CREATE"),
    edit: held.has("JOURNAL_EDIT"),
    post: held.has("JOURNAL_POST"),
    cancel: held.has("JOURNAL_CANCEL"),
  };
}

/**
 * The transitions this user may run against a journal in this status.
 *
 * Safe first, danger last: this is the **vertical** row-menu order.
 * `orderForHeader` is what rearranges it for `.ph-act`.
 */
export function availableJournalActions(
  status: JournalStatus,
  can: JournalAbilities
): JournalAction[] {
  return (["post", "cancel"] as JournalAction[]).filter(
    (a) => journalTransitionAllowed(a, status) && can[a]
  );
}

/** How a status reads, and which badge it wears. */
export const JOURNAL_STATUS_BADGE: Record<JournalStatus, string> = {
  Draft: "s-warn",
  Posted: "s-ok",
  Cancelled: "s-mute",
};
