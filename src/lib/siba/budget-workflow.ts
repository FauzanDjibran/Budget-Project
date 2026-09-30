/**
 * The Budget lifecycle, written once and read by both sides.
 *
 *   Draft ──submit──> Submitted ──approve──> Approved ──classify──> Open ──> Closed
 *     │                   │                (Klasifikasi Budget)       (by realization)
 *     │                   └──reject──> Rejected   (final)
 *     └──cancel──> Cancelled                      (final; also from Submitted)
 *
 * Approval and classification are two steps done by two people: the approver
 * decides whether the plan is justified, and the classifier gives it the
 * Budget Category and Partner its realization will post by. Only a classified
 * Budget — `Open` — can be realized.
 *
 * `Rejected` is final. A plan the approver turned down is replaced by a new
 * Budget, never edited and resubmitted — the user's rule, so that a
 * rejection stays a record of what was refused.
 *
 * Every transition names the status it may start from, the status it produces,
 * and the one permission it needs. The list, the detail header and the Server
 * Action all read this table, so a hidden button and a refused action can
 * never disagree.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 *
 * Close and Delete are deliberately absent: a Budget closes as a consequence of
 * realization, and the catalogue carries neither `BUDGET_CLOSE` nor
 * `BUDGET_DELETE`.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";
import { DIRECTION_TEXT } from "./classification";

export type BudgetStatus =
  | "Draft"
  | "Submitted"
  | "Rejected"
  | "Approved"
  | "Open"
  | "Closed"
  | "Cancelled";

export type BudgetAction = "submit" | "approve" | "reject" | "cancel" | "classify";

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
    from: ["Draft"],
    to: "Submitted",
    icon: "send",
    tone: "primary",
    title: "Ajukan Budget?",
    body:
      "Budget akan masuk daftar pengajuan dan menunggu persetujuan. Setelah " +
      "diajukan, isiannya tidak dapat diubah lagi.",
    confirmLabel: "Ya, Ajukan",
    done: "Budget diajukan",
  },
  approve: {
    label: "Setujui",
    permission: "BUDGET_APPROVE",
    from: ["Submitted"],
    to: "Approved",
    icon: "thumb",
    tone: "primary",
    title: "Setujui Budget?",
    body:
      "Budget masuk Klasifikasi Budget untuk diberi Category dan Partner, " +
      "lalu siap direalisasikan. Isiannya tidak dapat diubah lagi.",
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
      "Status Ditolak bersifat final: budget tidak dapat diubah atau diajukan " +
      "ulang. Perbaikannya dibuat sebagai Budget baru.",
    confirmLabel: "Ya, Tolak",
    done: "Budget ditolak",
  },
  cancel: {
    label: "Batalkan",
    permission: "BUDGET_CANCEL",
    from: ["Draft", "Submitted"],
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
  classify: {
    label: "Klasifikasikan",
    permission: "BUDGET_CLASSIFY",
    from: ["Approved"],
    to: "Open",
    icon: "tags",
    tone: "primary",
    title: "Tetapkan Klasifikasi",
    body:
      "Budget Category dan Partner ditetapkan, dan budget menjadi Open — siap " +
      "direalisasikan. Klasifikasi tidak dapat diubah lagi.",
    confirmLabel: "Ya, Tetapkan",
    done: "Budget diklasifikasikan",
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
 * A budget is editable only while it is the planner's to change. Submitting
 * freezes it, and a rejection is final (concept doc §6.4, and the user's rule
 * that a rejected plan is replaced rather than resubmitted).
 */
export const EDITABLE_STATUSES: BudgetStatus[] = ["Draft"];

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
  classify: boolean;
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
    classify: held.has("BUDGET_CLASSIFY"),
  };
}

/** The transitions this user may run against a budget in this status. */
export function availableActions(
  status: BudgetStatus,
  can: BudgetAbilities
): BudgetAction[] {
  const order: BudgetAction[] = ["submit", "approve", "classify", "reject", "cancel"];
  return order.filter((a) => transitionAllowed(a, status) && can[a]);
}

/**
 * What a selection of budgets can be moved by together: the actions every one
 * of them allows. A bulk action is all-or-nothing, so offering one that some
 * selected row would refuse would only fail at the server.
 */
export function commonActions(
  statuses: BudgetStatus[],
  can: BudgetAbilities
): BudgetAction[] {
  if (!statuses.length) return [];
  const [first, ...rest] = statuses;
  return availableActions(first, can).filter((a) =>
    rest.every((s) => transitionAllowed(a, s))
  );
}

/** Statuses a budget counts as "not yet approved" in the KPI row. */
export const NOT_APPROVED: BudgetStatus[] = ["Draft", "Submitted"];

/**
 * Kept as a name this module's callers already use, but no longer a second
 * copy of the mapping: direction reads "Penerimaan" / "Pengeluaran" everywhere,
 * and three identical two-entry maps is how that stops being true.
 */
export const BUDGET_TYPE_TEXT: Record<string, string> = DIRECTION_TEXT;
