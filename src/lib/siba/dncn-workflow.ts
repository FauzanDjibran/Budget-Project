/**
 * The Debit / Credit Note lifecycle, written once and read by both sides.
 *
 *   Draft ──post──> Posted     (final — the position has been adjusted)
 *     │
 *     └──cancel──> Cancelled   (final — nothing was ever adjusted)
 *
 * The same shape as a Cash Bank Transfer's, for the same reason: a note moves
 * no cash, so it needs nobody's money and there is no `Pending` and no Funding
 * Request — the anak adjusts its own subject books directly.
 *
 * Every transition names the status it may start from, the status it produces
 * and the one permission it needs. The row menu, the detail header and the
 * Server Action all read this table, so a hidden button and a refused action
 * can never disagree.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 *
 * There is no Delete and no reversal. A posted note is corrected by a note of
 * the opposite type, which is how a Credit Note has always undone a Debit Note.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type DncnStatus = "Draft" | "Posted" | "Cancelled";

export type DncnType = "Debit" | "Credit";

export type DncnAction = "post" | "cancel";

export type DncnTransition = {
  label: string;
  permission: PermissionCode;
  from: DncnStatus[];
  to: DncnStatus;
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

export const DNCN_TRANSITIONS: Record<DncnAction, DncnTransition> = {
  post: {
    label: "Post",
    permission: "DNCN_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Post Nota",
    body:
      "Post menyesuaikan posisi Partner pada buku subjek dan mencatat Journal-nya. " +
      "Tidak ada uang yang berpindah. Setelah diposting nota tidak dapat diubah " +
      "maupun dibatalkan — koreksi dilakukan dengan nota berlawanan.",
    confirmLabel: "Ya, Post",
    done: "Nota diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "DNCN_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Nota?",
    body:
      "Nota ditandai Dibatalkan dan tidak dapat diposting lagi. Posisi Partner " +
      "tidak terpengaruh karena nota belum pernah diposting. Status Dibatalkan " +
      "bersifat final.",
    confirmLabel: "Ya, Batalkan",
    done: "Nota dibatalkan",
  },
};

/** How each type reads on screen, and the number series it is filed under. */
export const DNCN_TYPES: Record<
  DncnType,
  { label: string; short: string; series: "DN" | "CN"; desc: string }
> = {
  Debit: {
    label: "Debit Note",
    short: "DN",
    series: "DN",
    desc: "mendebit Partner",
  },
  Credit: {
    label: "Credit Note",
    short: "CN",
    series: "CN",
    desc: "mengkredit Partner",
  },
};

/**
 * The cash direction a note moves the position like.
 *
 * A Debit Note debits the Partner's account, which is what money leaving does
 * on that side of a cash posting; a Credit Note credits it, like money
 * arriving. Handing this to the book's own `subledgerMovement` is what makes
 * one document correct for every book: a Debit Note raises a Piutang and
 * lowers a Hutang, a Credit Note the reverse, with no per-book rule anywhere.
 */
export function dncnDirection(type: DncnType): "In" | "Out" {
  return type === "Debit" ? "Out" : "In";
}

/** Whether a transition is legal from a status, ignoring permissions. */
export function dncnTransitionAllowed(action: DncnAction, status: DncnStatus): boolean {
  return DNCN_TRANSITIONS[action].from.includes(status);
}

/** A note is editable only while it has adjusted nothing. */
export function dncnIsEditable(status: DncnStatus): boolean {
  return status === "Draft";
}

/** What the signed-in user may do with notes — presentation only. */
export type DncnAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
};

export function dncnAbilities(permissions: Iterable<string>): DncnAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("DNCN_CREATE"),
    edit: held.has("DNCN_EDIT"),
    post: held.has("DNCN_POST"),
    cancel: held.has("DNCN_CANCEL"),
  };
}

/**
 * The transitions this user may run against a note in this status.
 *
 * Safe first, danger last: this is the **vertical** row-menu order.
 * `orderForHeader` is what rearranges it for `.ph-act`.
 */
export function availableDncnActions(status: DncnStatus, can: DncnAbilities): DncnAction[] {
  const order: DncnAction[] = ["post", "cancel"];
  return order.filter((a) => dncnTransitionAllowed(a, status) && can[a]);
}
