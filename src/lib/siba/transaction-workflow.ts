/**
 * The Cash Bank Transaction lifecycle, written once and read by both sides.
 *
 * The induk funds itself, so its documents go straight out:
 *
 *   Draft ──post──> Posted   (final — the money has actually moved)
 *     │
 *     └──cancel──> Cancelled (final — the money never moved)
 *
 * The anak has no Cash & Bank of its own, so its documents take the funded
 * route instead (concept doc §26.2): submitting raises a Funding Request and
 * the induk's confirmation is what posts the document.
 *
 *   Draft ──submit──> Pending ──(induk confirms)──> Posted
 *     │                  │
 *     └──cancel──────────┴──cancel──> Cancelled
 *
 * `Pending` has moved exactly as much as `Draft` has: nothing. The induk
 * cannot reject — it always complies (§29) — so `Post` is not offered on a
 * Pending document at all; it is reached only through Funding Request
 * confirmation, which posts both Companies at once.
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
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";
import { DIRECTION_TEXT } from "./classification";

export type TransactionStatus = "Draft" | "Pending" | "Posted" | "Cancelled";

export type TransactionAction = "submit" | "post" | "cancel";

export type TransactionTransition = {
  label: string;
  permission: PermissionCode;
  from: TransactionStatus[];
  to: TransactionStatus;
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

export const TRANSACTION_TRANSITIONS: Record<
  TransactionAction,
  TransactionTransition
> = {
  submit: {
    label: "Ajukan Dana",
    permission: "CASH_BANK_TRANSACTION_SUBMIT",
    from: ["Draft"],
    to: "Pending",
    icon: "send",
    tone: "primary",
    title: "Ajukan Dana ke Induk",
    body:
      "Dokumen dikirim ke Company induk sebagai Funding Request dan tidak dapat " +
      "diubah lagi selama menunggu. Belum ada uang yang bergerak: kas, Budget, " +
      "dan seluruh buku baru tercatat setelah induk mengonfirmasi.",
    confirmLabel: "Ya, Ajukan",
    done: "Funding Request dibuat",
  },
  post: {
    label: "Post",
    permission: "CASH_BANK_TRANSACTION_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
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
    // Also from Pending: the requesting Company may withdraw its own request
    // while it is still open, which closes the Funding Request with it. That is
    // not the induk rejecting — the induk never rejects (§29) — it is the
    // requester taking back something nothing has acted on yet.
    from: ["Draft", "Pending"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Dokumen?",
    body:
      "Dokumen ditandai Dibatalkan dan tidak dapat diposting lagi. Budget dan " +
      "saldo Cash & Bank tidak terpengaruh karena dokumen belum pernah diposting. " +
      "Funding Request yang masih terbuka ikut dibatalkan. Status Dibatalkan " +
      "bersifat final.",
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
  submit: boolean;
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
    submit: held.has("CASH_BANK_TRANSACTION_SUBMIT"),
    post: held.has("CASH_BANK_TRANSACTION_POST"),
    cancel: held.has("CASH_BANK_TRANSACTION_CANCEL"),
  };
}

/**
 * The transitions this user may run against a document in this status.
 *
 * `funded` says which route the document takes: a Company with no Cash & Bank
 * of its own submits a Funding Request instead of posting, and a Company with
 * one posts directly. Both are never offered together — a document has exactly
 * one way out of Draft, decided by whose document it is.
 *
 * Safe first, danger last: this is the **vertical** row-menu order.
 * `orderForHeader` is what rearranges it for `.ph-act`.
 */
export function availableTransactionActions(
  status: TransactionStatus,
  can: TransactionAbilities,
  options: { funded?: boolean } = {}
): TransactionAction[] {
  const order: TransactionAction[] = options.funded
    ? ["submit", "cancel"]
    : ["post", "cancel"];
  return order.filter(
    (a) => transactionTransitionAllowed(a, status) && can[a]
  );
}

/**
 * Kept as a name this module's callers already use, but no longer a second
 * copy of the mapping: direction reads "Penerimaan" / "Pengeluaran" everywhere,
 * and three identical two-entry maps is how that stops being true.
 */
export const TRANSACTION_TYPE_TEXT: Record<string, string> = DIRECTION_TEXT;
