/**
 * The Reklasifikasi Open Item lifecycle, written once and read by both sides.
 *
 *   Draft ──post──> Posted     (final — the items have moved)
 *     │
 *     └──cancel──> Cancelled   (final — nothing ever moved)
 *
 * No cash moves, so the anak posts its own exactly as the induk does: there is
 * no funded route to wait on.
 *
 * Every transition names the status it may start from, the status it produces,
 * and the one permission it needs. The row menu reads this table to decide
 * what to offer; the Server Action reads the same table to decide what to
 * allow. Client-safe on purpose — no `server-only`, no database import.
 *
 * There is no Delete and no reversal. A posted reclassification is corrected
 * by another one moving the value back (concept doc §15).
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type ReclassStatus = "Draft" | "Posted" | "Cancelled";

export type ReclassAction = "post" | "cancel";

export type ReclassTransition = {
  label: string;
  permission: PermissionCode;
  from: ReclassStatus[];
  to: ReclassStatus;
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

export const RECLASS_TRANSITIONS: Record<ReclassAction, ReclassTransition> = {
  post: {
    label: "Post",
    permission: "ITEM_RECLASS_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Post Reklasifikasi Open Item",
    body:
      "Post memindahkan nilainya: open item sumber dilepas pada kurs " +
      "masing-masing, buku tujuan membuka open item baru atau menyelesaikan " +
      "open item yang dipilih, dan Journal tercatat. Tidak ada uang yang " +
      "berpindah. Setelah diposting dokumen tidak dapat diubah maupun dibatalkan.",
    confirmLabel: "Ya, Post",
    done: "Reklasifikasi Open Item diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "ITEM_RECLASS_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Reklasifikasi Open Item?",
    body:
      "Dokumen ditandai Dibatalkan dan tidak dapat diposting lagi. Open item " +
      "tidak terpengaruh karena dokumen belum pernah diposting. Status " +
      "Dibatalkan bersifat final.",
    confirmLabel: "Ya, Batalkan",
    done: "Reklasifikasi Open Item dibatalkan",
  },
};

/** Whether a transition is legal from a status, ignoring permissions. */
export function reclassTransitionAllowed(
  action: ReclassAction,
  status: ReclassStatus
): boolean {
  return RECLASS_TRANSITIONS[action].from.includes(status);
}

/** A document is editable only while it has moved nothing. */
export const RECLASS_EDITABLE: ReclassStatus[] = ["Draft"];

export function reclassIsEditable(status: ReclassStatus): boolean {
  return RECLASS_EDITABLE.includes(status);
}

/** What the signed-in user may do with these documents — presentation only. */
export type ReclassAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
};

export function reclassAbilities(permissions: Iterable<string>): ReclassAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("ITEM_RECLASS_CREATE"),
    edit: held.has("ITEM_RECLASS_EDIT"),
    post: held.has("ITEM_RECLASS_POST"),
    cancel: held.has("ITEM_RECLASS_CANCEL"),
  };
}

/**
 * The transitions this user may run against a document in this status.
 *
 * Safe first, danger last: this is the **vertical** row-menu order.
 * `orderForHeader` is what rearranges it for `.ph-act`.
 */
export function availableReclassActions(
  status: ReclassStatus,
  can: ReclassAbilities
): ReclassAction[] {
  const order: ReclassAction[] = ["post", "cancel"];
  return order.filter((a) => reclassTransitionAllowed(a, status) && can[a]);
}
