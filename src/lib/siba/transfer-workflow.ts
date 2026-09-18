/**
 * The Cash Bank Transfer lifecycle, written once and read by both sides.
 *
 *   Draft ──post──> Posted     (final — the money has actually moved)
 *     │
 *     └──cancel──> Cancelled   (final — the money never moved)
 *
 * Simpler than a Cash Bank Transaction's by one whole branch: there is no
 * `Pending` and no Funding Request. A transfer moves money between two Cash &
 * Bank resources, the anak holds none by design (concept doc §25, §32), and so
 * every transfer is the induk's and funds itself. There is nothing to ask
 * anybody for.
 *
 * Every transition names the status it may start from, the status it produces,
 * and the one permission it needs. The row menu reads this table to decide what
 * to offer; the Server Action reads the same table to decide what to allow, so
 * a hidden menu item and a refused action can never disagree. This is the shape
 * `budget-workflow.ts` established and `transaction-workflow.ts` followed.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 *
 * There is no Delete and no reversal. A document that should not have existed
 * is cancelled, which leaves its number and its reason behind, and a posted
 * transfer is corrected by a new transfer in the other direction — concept doc
 * §15 makes every posted record append-only.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type TransferStatus = "Draft" | "Posted" | "Cancelled";

export type TransferAction = "post" | "cancel";

export type TransferTransition = {
  label: string;
  permission: PermissionCode;
  from: TransferStatus[];
  to: TransferStatus;
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

export const TRANSFER_TRANSITIONS: Record<TransferAction, TransferTransition> = {
  post: {
    label: "Post",
    permission: "CASH_BANK_TRANSFER_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Post Transfer",
    body:
      "Post memindahkan uangnya: saldo Cash & Bank sumber turun, saldo setiap " +
      "Cash & Bank tujuan naik, dan Journal tercatat. Setelah diposting dokumen " +
      "tidak dapat diubah maupun dibatalkan — koreksi dilakukan sebagai dokumen baru.",
    confirmLabel: "Ya, Post",
    done: "Transfer diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "CASH_BANK_TRANSFER_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Transfer?",
    body:
      "Dokumen ditandai Dibatalkan dan tidak dapat diposting lagi. Saldo Cash & " +
      "Bank tidak terpengaruh karena dokumen belum pernah diposting. Status " +
      "Dibatalkan bersifat final.",
    confirmLabel: "Ya, Batalkan",
    done: "Transfer dibatalkan",
  },
};

/** Whether a transition is legal from a status, ignoring permissions. */
export function transferTransitionAllowed(
  action: TransferAction,
  status: TransferStatus
): boolean {
  return TRANSFER_TRANSITIONS[action].from.includes(status);
}

/**
 * A document is editable only while it has not moved money. Post freezes it
 * permanently (concept doc §15); Cancel freezes it because there is nothing
 * left to do with it.
 */
export const TRANSFER_EDITABLE: TransferStatus[] = ["Draft"];

export function transferIsEditable(status: TransferStatus): boolean {
  return TRANSFER_EDITABLE.includes(status);
}

/** What the signed-in user may do with transfers — presentation only. */
export type TransferAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
};

export function transferAbilities(
  permissions: Iterable<string>
): TransferAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("CASH_BANK_TRANSFER_CREATE"),
    edit: held.has("CASH_BANK_TRANSFER_EDIT"),
    post: held.has("CASH_BANK_TRANSFER_POST"),
    cancel: held.has("CASH_BANK_TRANSFER_CANCEL"),
  };
}

/**
 * The transitions this user may run against a document in this status.
 *
 * Safe first, danger last: this is the **vertical** row-menu order.
 * `orderForHeader` is what rearranges it for `.ph-act`.
 */
export function availableTransferActions(
  status: TransferStatus,
  can: TransferAbilities
): TransferAction[] {
  const order: TransferAction[] = ["post", "cancel"];
  return order.filter((a) => transferTransitionAllowed(a, status) && can[a]);
}
