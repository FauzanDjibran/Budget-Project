/**
 * The Penyesuaian Open Item lifecycle, written once and read by both sides.
 *
 *   Draft ──post──> Posted     (final — the position has been adjusted)
 *     │
 *     └──cancel──> Cancelled   (final — nothing was ever adjusted)
 *
 * The same shape as a Cash Bank Transfer's, for the same reason: an
 * adjustment moves no cash, so it needs nobody's money and there is no
 * `Pending` and no Funding Request — the anak adjusts its own subject books
 * directly.
 *
 * Every transition names the status it may start from, the status it produces
 * and the one permission it needs. The row menu, the detail header and the
 * Server Action all read this table, so a hidden button and a refused action
 * can never disagree.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 *
 * There is no Delete and no reversal. A posted adjustment is corrected by one
 * of the opposite effect.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type ItemAdjustmentStatus = "Draft" | "Posted" | "Cancelled";

/** What the adjustment does to the position — raise it or lower it. */
export type ItemAdjustmentEffect = "Increase" | "Decrease";

export type ItemAdjustmentAction = "post" | "cancel";

export type ItemAdjustmentTransition = {
  label: string;
  permission: PermissionCode;
  from: ItemAdjustmentStatus[];
  to: ItemAdjustmentStatus;
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

export const ITEM_ADJUSTMENT_TRANSITIONS: Record<ItemAdjustmentAction, ItemAdjustmentTransition> = {
  post: {
    label: "Post",
    permission: "ITEM_ADJUSTMENT_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Post Penyesuaian",
    body:
      "Post menyesuaikan posisi Partner pada buku subjek dan mencatat Journal-nya. " +
      "Tidak ada uang yang berpindah. Setelah diposting dokumen tidak dapat diubah " +
      "maupun dibatalkan — koreksi dilakukan dengan penyesuaian berlawanan.",
    confirmLabel: "Ya, Post",
    done: "Penyesuaian diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "ITEM_ADJUSTMENT_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Penyesuaian?",
    body:
      "Dokumen ditandai Dibatalkan dan tidak dapat diposting lagi. Posisi Partner " +
      "tidak terpengaruh karena dokumen belum pernah diposting. Status Dibatalkan " +
      "bersifat final.",
    confirmLabel: "Ya, Batalkan",
    done: "Penyesuaian dibatalkan",
  },
};

/** How each effect reads on screen. */
export const ITEM_ADJUSTMENT_EFFECTS: Record<
  ItemAdjustmentEffect,
  { label: string; desc: string }
> = {
  Increase: { label: "Tambah", desc: "membuka open item baru" },
  Decrease: { label: "Kurangi", desc: "menyelesaikan open item yang dipilih" },
};

/** The number series every adjustment is filed under. */
export const ITEM_ADJUSTMENT_SERIES = "PYO";

/**
 * The cash direction an adjustment moves the position like.
 *
 * Raising a position is what money moving the book's own `raises` way does;
 * lowering it is the other way. Handing that direction to the book's
 * `subledgerMovement` is what makes one document correct for every book, and
 * it is also what decides the journal: the Partner line is debited exactly
 * when the direction is money leaving.
 */
export function adjustmentDirection(
  effect: ItemAdjustmentEffect,
  raises: "In" | "Out"
): "In" | "Out" {
  if (effect === "Increase") return raises;
  return raises === "In" ? "Out" : "In";
}

/** Whether a transition is legal from a status, ignoring permissions. */
export function itemAdjustmentTransitionAllowed(
  action: ItemAdjustmentAction,
  status: ItemAdjustmentStatus
): boolean {
  return ITEM_ADJUSTMENT_TRANSITIONS[action].from.includes(status);
}

/** An adjustment is editable only while it has adjusted nothing. */
export function itemAdjustmentIsEditable(status: ItemAdjustmentStatus): boolean {
  return status === "Draft";
}

/** What the signed-in user may do with adjustments — presentation only. */
export type ItemAdjustmentAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
};

export function itemAdjustmentAbilities(permissions: Iterable<string>): ItemAdjustmentAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("ITEM_ADJUSTMENT_CREATE"),
    edit: held.has("ITEM_ADJUSTMENT_EDIT"),
    post: held.has("ITEM_ADJUSTMENT_POST"),
    cancel: held.has("ITEM_ADJUSTMENT_CANCEL"),
  };
}

/**
 * The transitions this user may run against an adjustment in this status.
 *
 * Safe first, danger last: this is the **vertical** row-menu order.
 * `orderForHeader` is what rearranges it for `.ph-act`.
 */
export function availableItemAdjustmentActions(
  status: ItemAdjustmentStatus,
  can: ItemAdjustmentAbilities
): ItemAdjustmentAction[] {
  const order: ItemAdjustmentAction[] = ["post", "cancel"];
  return order.filter((a) => itemAdjustmentTransitionAllowed(a, status) && can[a]);
}
