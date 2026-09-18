/**
 * The Budget lifecycle, written once and read by both sides.
 *
 *   Draft ──submit──> Submitted ──approve──> Open ──> (Closed, in V2)
 *     ^                   │
 *     │                   └──reject──> Rejected ──submit──> Submitted
 *     └── edit ───────────────────────────┘
 *
 *   Draft / Rejected / Submitted ──cancel──> Cancelled  (final)
 *
 * Every transition names the status it may start from, the status it produces,
 * and the one permission it needs. The row menu reads this table to decide what
 * to offer; the Server Action reads the same table to decide what to allow, so
 * a hidden menu item and a refused action can never disagree.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 *
 * Close and Delete are deliberately absent. Closing belongs to realization,
 * which is V2, and the permission catalogue carries neither `BUDGET_CLOSE` nor
 * `BUDGET_DELETE`. `Closed` still exists as a status because seeded data
 * carries it and the list must render it.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";
import { DIRECTION_TEXT } from "./classification";

export type BudgetStatus =
  | "Draft"
  | "Submitted"
  | "Rejected"
  | "Open"
  | "Closed"
  | "Cancelled";

export type BudgetAction = "submit" | "approve" | "reject" | "cancel";

export type BudgetTransition = {
  label: string;
  permission: PermissionCode;
  from: BudgetStatus[];
  to: BudgetStatus;
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

export const BUDGET_TRANSITIONS: Record<BudgetAction, BudgetTransition> = {
  submit: {
    label: "Ajukan",
    permission: "BUDGET_SUBMIT",
    from: ["Draft", "Rejected"],
    to: "Submitted",
    icon: "send",
    tone: "primary",
    title: "Ajukan Budget?",
    body:
      "Budget akan masuk daftar pengajuan dan menunggu persetujuan. Setelah " +
      "diajukan, isian tidak dapat diubah kecuali ditolak.",
    confirmLabel: "Ya, Ajukan",
    done: "Budget diajukan",
  },
  approve: {
    label: "Setujui",
    permission: "BUDGET_APPROVE",
    from: ["Submitted"],
    to: "Open",
    icon: "thumb",
    tone: "primary",
    title: "Setujui Budget",
    body:
      "Budget menjadi Open dan siap direalisasikan. Isiannya tidak dapat " +
      "diubah lagi setelah disetujui.",
    confirmLabel: "Ya, Setujui",
    done: "Budget disetujui",
  },
  reject: {
    label: "Tolak",
    permission: "BUDGET_REJECT",
    from: ["Submitted"],
    to: "Rejected",
    icon: "block",
    tone: "danger",
    title: "Tolak Budget?",
    body:
      "Budget dikembalikan ke pembuat sebagai Ditolak, dan dapat diperbaiki " +
      "lalu diajukan ulang.",
    confirmLabel: "Ya, Tolak",
    done: "Budget ditolak",
  },
  cancel: {
    label: "Batalkan",
    permission: "BUDGET_CANCEL",
    from: ["Draft", "Rejected", "Submitted"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Budget?",
    body:
      "Budget tidak akan diproses lebih lanjut. Status Dibatalkan bersifat " +
      "final dan tidak dapat dikembalikan.",
    confirmLabel: "Ya, Batalkan",
    done: "Budget dibatalkan",
  },
};

/** Whether a transition is legal from a status, ignoring permissions. */
export function transitionAllowed(
  action: BudgetAction,
  status: BudgetStatus
): boolean {
  return BUDGET_TRANSITIONS[action].from.includes(status);
}

/**
 * A budget is editable only while it is the creator's to change. Approval makes
 * it immutable — concept doc §6.4, "Open membuat Budget immutable".
 */
export const EDITABLE_STATUSES: BudgetStatus[] = ["Draft", "Rejected"];

export function budgetIsEditable(status: BudgetStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** What the signed-in user may do with budgets — presentation only. */
export type BudgetAbilities = {
  create: boolean;
  edit: boolean;
  submit: boolean;
  approve: boolean;
  reject: boolean;
  cancel: boolean;
};

export function budgetAbilities(permissions: Iterable<string>): BudgetAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("BUDGET_CREATE"),
    edit: held.has("BUDGET_EDIT"),
    submit: held.has("BUDGET_SUBMIT"),
    approve: held.has("BUDGET_APPROVE"),
    reject: held.has("BUDGET_REJECT"),
    cancel: held.has("BUDGET_CANCEL"),
  };
}

/** The transitions this user may run against a budget in this status. */
export function availableActions(
  status: BudgetStatus,
  can: BudgetAbilities
): BudgetAction[] {
  const order: BudgetAction[] = ["submit", "approve", "reject", "cancel"];
  return order.filter((a) => transitionAllowed(a, status) && can[a]);
}

/** Statuses a budget counts as "not yet approved" in the KPI row. */
export const NOT_APPROVED: BudgetStatus[] = ["Draft", "Submitted"];

/**
 * Kept as a name this module's callers already use, but no longer a second
 * copy of the mapping: direction reads "Penerimaan" / "Pengeluaran" everywhere,
 * and three identical two-entry maps is how that stops being true.
 */
export const BUDGET_TYPE_TEXT: Record<string, string> = DIRECTION_TEXT;
