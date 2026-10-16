/**
 * The Revaluasi Kurs lifecycle, written once and read by both sides.
 *
 *   Draft ──post──> Posted     (final — the layers are collapsed)
 *     │
 *     └──cancel──> Cancelled   (final — nothing was ever restated)
 *
 * The same shape as every other posting document. There is no reversal: a
 * posted revaluation is final, and a wrong kurs is corrected by another
 * revaluation at the right one (SIBA multi-currency §7.5).
 *
 * Every transition names the status it may start from, the status it produces
 * and the one permission it needs. The row menu, the detail header and the
 * Server Action all read this table, so a hidden button and a refused action
 * can never disagree.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type RevaluationStatus = "Draft" | "Posted" | "Cancelled";

export type RevaluationAction = "post" | "cancel";

export type RevaluationTransition = {
  label: string;
  permission: PermissionCode;
  from: RevaluationStatus[];
  to: RevaluationStatus;
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

export const REVALUATION_TRANSITIONS: Record<RevaluationAction, RevaluationTransition> = {
  post: {
    label: "Post",
    permission: "CASH_BANK_REVALUATION_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Post Revaluasi Kurs",
    body:
      "Post menutup seluruh layer kurs Cash & Bank ini, membuka satu layer pada " +
      "kurs yang dinyatakan, dan mencatat selisihnya di Journal. Dinilai dari " +
      "layer yang terbuka saat ini. Setelah diposting dokumen tidak dapat diubah " +
      "maupun dibatalkan — kurs yang keliru dikoreksi dengan revaluasi berikutnya.",
    confirmLabel: "Ya, Post",
    done: "Revaluasi kurs diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "CASH_BANK_REVALUATION_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Revaluasi Kurs?",
    body:
      "Dokumen ditandai Dibatalkan dan tidak dapat diposting lagi. Layer kurs " +
      "tidak terpengaruh karena dokumen belum pernah diposting. Status " +
      "Dibatalkan bersifat final.",
    confirmLabel: "Ya, Batalkan",
    done: "Revaluasi kurs dibatalkan",
  },
};

/** The number series every revaluation is filed under. */
export const REVALUATION_SERIES = "RVK";

/** Whether a transition is legal from a status, ignoring permissions. */
export function revaluationTransitionAllowed(
  action: RevaluationAction,
  status: RevaluationStatus
): boolean {
  return REVALUATION_TRANSITIONS[action].from.includes(status);
}

/** A revaluation is editable only while it has restated nothing. */
export function revaluationIsEditable(status: RevaluationStatus): boolean {
  return status === "Draft";
}

/** What the signed-in user may do with revaluations — presentation only. */
export type RevaluationAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
};

export function revaluationAbilities(permissions: Iterable<string>): RevaluationAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("CASH_BANK_REVALUATION_CREATE"),
    edit: held.has("CASH_BANK_REVALUATION_EDIT"),
    post: held.has("CASH_BANK_REVALUATION_POST"),
    cancel: held.has("CASH_BANK_REVALUATION_CANCEL"),
  };
}

/**
 * The transitions this user may run against a revaluation in this status.
 *
 * Safe first, danger last: this is the **vertical** row-menu order.
 * `orderForHeader` is what rearranges it for `.ph-act`.
 */
export function availableRevaluationActions(
  status: RevaluationStatus,
  can: RevaluationAbilities
): RevaluationAction[] {
  const order: RevaluationAction[] = ["post", "cancel"];
  return order.filter((a) => revaluationTransitionAllowed(a, status) && can[a]);
}
