/**
 * The Pencairan Open Item lifecycle, written once and read by both sides.
 *
 *   Draft ──post──> Posted     (final — the currency is sold and the items converted)
 *     │
 *     └──cancel──> Cancelled   (final — nothing ever moved)
 *
 * The shape `transfer-workflow.ts` has, for the same reason: the anak holds no
 * Cash & Bank, so every document is the induk's and funds itself.
 *
 * Every transition names the status it may start from, the status it produces,
 * and the one permission it needs. The row menu reads this table to decide
 * what to offer; the Server Action reads the same table to decide what to
 * allow. Client-safe on purpose — no `server-only`, no database import.
 *
 * There is no Delete and no reversal. A posted document is corrected by a new
 * one (concept doc §15).
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type ConversionStatus = "Draft" | "Posted" | "Cancelled";

export type ConversionAction = "post" | "cancel";

export type ConversionTransition = {
  label: string;
  permission: PermissionCode;
  from: ConversionStatus[];
  to: ConversionStatus;
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

export const CONVERSION_TRANSITIONS: Record<ConversionAction, ConversionTransition> = {
  post: {
    label: "Post",
    permission: "ITEM_CONVERSION_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Post Pencairan Open Item",
    body:
      "Post menjual valutanya dan mengkonversi open item Partner: saldo Cash & " +
      "Bank sumber turun, Cash & Bank tujuan naik, open item valuta asing " +
      "dilepas pada kurs masing-masing dan open item Rupiah dibuka, dan Journal " +
      "tercatat. Setelah diposting dokumen tidak dapat diubah maupun dibatalkan.",
    confirmLabel: "Ya, Post",
    done: "Pencairan Open Item diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "ITEM_CONVERSION_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Pencairan Open Item?",
    body:
      "Dokumen ditandai Dibatalkan dan tidak dapat diposting lagi. Saldo Cash & " +
      "Bank dan open item Partner tidak terpengaruh karena dokumen belum pernah " +
      "diposting. Status Dibatalkan bersifat final.",
    confirmLabel: "Ya, Batalkan",
    done: "Pencairan Open Item dibatalkan",
  },
};

/** Whether a transition is legal from a status, ignoring permissions. */
export function conversionTransitionAllowed(
  action: ConversionAction,
  status: ConversionStatus
): boolean {
  return CONVERSION_TRANSITIONS[action].from.includes(status);
}

/** A document is editable only while it has moved nothing. */
export const CONVERSION_EDITABLE: ConversionStatus[] = ["Draft"];

export function conversionIsEditable(status: ConversionStatus): boolean {
  return CONVERSION_EDITABLE.includes(status);
}

/** What the signed-in user may do with these documents — presentation only. */
export type ConversionAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
};

export function conversionAbilities(
  permissions: Iterable<string>
): ConversionAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("ITEM_CONVERSION_CREATE"),
    edit: held.has("ITEM_CONVERSION_EDIT"),
    post: held.has("ITEM_CONVERSION_POST"),
    cancel: held.has("ITEM_CONVERSION_CANCEL"),
  };
}

/**
 * The transitions this user may run against a document in this status.
 *
 * Safe first, danger last: this is the **vertical** row-menu order.
 * `orderForHeader` is what rearranges it for `.ph-act`.
 */
export function availableConversionActions(
  status: ConversionStatus,
  can: ConversionAbilities
): ConversionAction[] {
  const order: ConversionAction[] = ["post", "cancel"];
  return order.filter((a) => conversionTransitionAllowed(a, status) && can[a]);
}
