/**
 * The Cash Bank Transaction lifecycle, written once and read by both sides.
 *
 *   Draft ──post──> Posted   (final — the money has actually moved)
 *     │
 *     └──cancel──> Cancelled (final — the money never moved)
 *
 * Every transition names the status it may start from, the status it produces,
 * and the one permission it needs. The row menu reads this table to decide what
 * to offer; the Server Action reads the same table to decide what to allow, so
 * a hidden menu item and a refused action can never disagree. This is the shape
 * `budget-workflow.ts` established, for the same reason.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 *
 * There is no Delete. The mockup's row menu offered one, but the permission
 * catalogue carries no `CASH_BANK_TRANSACTION_DELETE`, and a capability is a
 * catalogue entry first (CLAUDE.md §12). A document that should not have
 * existed is cancelled, which leaves the number and the reason behind.
 *
 * Post is one-way and there is no reversal. Concept doc §15 makes every posted
 * record append-only: a correction is a *new* business transaction, never an
 * edit of the one that was wrong.
 */
import type { IconName } from "@/components/icon";
import type { PermissionCode } from "./permissions";

export type TransactionStatus = "Draft" | "Posted" | "Cancelled";

export type TransactionAction = "post" | "cancel";

export type TransactionTransition = {
  label: string;
  permission: PermissionCode;
  from: TransactionStatus[];
  to: TransactionStatus;
  icon: IconName;
  danger?: boolean;
  /** Confirmation copy — states the consequence, never just "are you sure?". */
  title: string;
  body: string;
  confirmLabel: string;
  /** Toast shown once the transition has actually been written. */
  done: string;
};

export const TRANSACTION_TRANSITIONS: Record<
  TransactionAction,
  TransactionTransition
> = {
  post: {
    label: "Post",
    permission: "CASH_BANK_TRANSACTION_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    title: "Post Dokumen",
    body:
      "Post menjadikan dokumen ini transaksi aktual: saldo Cash & Bank bergerak " +
      "dan realisasi Budget tercatat. Setelah diposting dokumen tidak dapat " +
      "diubah maupun dibatalkan — koreksi dilakukan sebagai dokumen baru.",
    confirmLabel: "Ya, Post",
    done: "Dokumen diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "CASH_BANK_TRANSACTION_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    danger: true,
    title: "Batalkan Dokumen?",
    body:
      "Dokumen ditandai Dibatalkan dan tidak dapat diposting lagi. Budget dan " +
      "saldo Cash & Bank tidak terpengaruh karena dokumen belum pernah diposting. " +
      "Status Dibatalkan bersifat final.",
    confirmLabel: "Ya, Batalkan",
    done: "Dokumen dibatalkan",
  },
};

/** Whether a transition is legal from a status, ignoring permissions. */
export function transactionTransitionAllowed(
  action: TransactionAction,
  status: TransactionStatus
): boolean {
  return TRANSACTION_TRANSITIONS[action].from.includes(status);
}

/**
 * A document is editable only while it has not moved money. Post freezes it
 * permanently (concept doc §15); Cancel freezes it because there is nothing
 * left to do with it.
 */
export const TRANSACTION_EDITABLE: TransactionStatus[] = ["Draft"];

export function transactionIsEditable(status: TransactionStatus): boolean {
  return TRANSACTION_EDITABLE.includes(status);
}

/** What the signed-in user may do with documents — presentation only. */
export type TransactionAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
};

export function transactionAbilities(
  permissions: Iterable<string>
): TransactionAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("CASH_BANK_TRANSACTION_CREATE"),
    edit: held.has("CASH_BANK_TRANSACTION_EDIT"),
    post: held.has("CASH_BANK_TRANSACTION_POST"),
    cancel: held.has("CASH_BANK_TRANSACTION_CANCEL"),
  };
}

/** The transitions this user may run against a document in this status. */
export function availableTransactionActions(
  status: TransactionStatus,
  can: TransactionAbilities
): TransactionAction[] {
  const order: TransactionAction[] = ["post", "cancel"];
  return order.filter(
    (a) => transactionTransitionAllowed(a, status) && can[a]
  );
}

export const TRANSACTION_TYPE_TEXT: Record<string, string> = {
  In: "Penerimaan",
  Out: "Pengeluaran",
};
