/**
 * The Jurnal Umum lifecycle, written once and read by both sides.
 *
 *   Draft ──post──> Posted     (final — every ledger and the General Ledger written)
 *     │
 *     └──cancel──> Cancelled   (final — nothing was ever written)
 *
 * The row, the detail header and the Server Action all read this table, so a
 * hidden button and a refused action can never disagree. Client-safe: no
 * `server-only`, no database import. There is no Delete and no reversal: a
 * posted Jurnal Umum is corrected by another one.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type GeneralJournalStatus = "Draft" | "Posted" | "Cancelled";

export type GeneralJournalAction = "post" | "cancel";

export type GeneralJournalTransition = {
  label: string;
  permission: PermissionCode;
  from: GeneralJournalStatus[];
  to: GeneralJournalStatus;
  icon: IconName;
  /** Decides both where the button sits in `.ph-act` and how it is drawn. */
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  done: string;
};

export const GENERAL_JOURNAL_TRANSITIONS: Record<GeneralJournalAction, GeneralJournalTransition> = {
  post: {
    label: "Post",
    permission: "JOURNAL_GENERAL_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Post Jurnal Umum",
    body:
      "Post menulis setiap buku yang disentuh barisnya — Buku Subjek dan Kas & Bank — " +
      "bersama buku besar, sekaligus. Setelah diposting jurnal tidak dapat diubah maupun " +
      "dibatalkan; koreksi dilakukan dengan Jurnal Umum baru.",
    confirmLabel: "Ya, Post",
    done: "Jurnal Umum diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "JOURNAL_GENERAL_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Jurnal Umum?",
    body:
      "Jurnal ditandai Dibatalkan dan tidak dapat diposting lagi. Tidak ada buku yang " +
      "terpengaruh karena jurnal belum pernah diposting. Status Dibatalkan bersifat final.",
    confirmLabel: "Ya, Batalkan",
    done: "Jurnal Umum dibatalkan",
  },
};

export function generalJournalTransitionAllowed(
  action: GeneralJournalAction,
  status: GeneralJournalStatus
): boolean {
  return GENERAL_JOURNAL_TRANSITIONS[action].from.includes(status);
}

export function generalJournalIsEditable(status: GeneralJournalStatus): boolean {
  return status === "Draft";
}

/** What the signed-in user may do with Jurnal Umum — presentation only. */
export type GeneralJournalAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
};

export function generalJournalAbilities(permissions: Iterable<string>): GeneralJournalAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("JOURNAL_GENERAL_CREATE"),
    edit: held.has("JOURNAL_GENERAL_EDIT"),
    post: held.has("JOURNAL_GENERAL_POST"),
    cancel: held.has("JOURNAL_GENERAL_CANCEL"),
  };
}

/** Safe first, danger last: the vertical order; `orderForHeader` rearranges it. */
export function availableGeneralJournalActions(
  status: GeneralJournalStatus,
  can: GeneralJournalAbilities
): GeneralJournalAction[] {
  const order: GeneralJournalAction[] = ["post", "cancel"];
  return order.filter((a) => generalJournalTransitionAllowed(a, status) && can[a]);
}

/** Which way a line moves its ledger, read from its side (D19). */
export function lineEffectText(
  ledger: string,
  side: "debit" | "credit",
  raises: "In" | "Out" | null
): string | null {
  if (ledger === "cash_bank") return side === "debit" ? "uang masuk" : "uang keluar";
  if (ledger === "partner" && raises) {
    return (side === "credit") === (raises === "In") ? "menambah" : "melunasi";
  }
  return null;
}
