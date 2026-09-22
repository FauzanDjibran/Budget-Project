/**
 * The Fiscal Year lifecycle, written once and read by both sides.
 *
 *   Draft ──open──> Open ──(closing process)──> Closed
 *
 * A fiscal year is not a record with a status field somebody types. It is
 * created as Draft, is *activated* into Open by a deliberate act — which is
 * what generates its twelve periods — and leaves Open only through a closing
 * process. None of those steps is a value anyone picks from a dropdown, which
 * is why `status` is not an editable field on the Fiscal Year form at all.
 *
 * Open is a one-way door: periods exist behind it and budgets are already
 * grouped by them, so returning a year to Draft would strand data inside a year
 * that claims never to have started.
 *
 * Closing is declared here but not yet executable. The lock it needs now
 * exists: `checkPostingPeriod` in `fiscal.ts` refuses a posting into a year
 * that is not Open, or into one the posting's Company has already closed, on
 * every path that writes a book. What is still outstanding is the closing
 * process itself — the entry that moves a year's result into equity and the
 * snapshot the next year opens from (CLAUDE.md §13). The step is described
 * here so the screen can say so plainly rather than offering a status change
 * that would only pretend to close.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type FiscalYearStatus = "Draft" | "Open" | "Closed";

/** Transitions a user can actually run today. */
export type FiscalYearAction = "open";

export type FiscalYearTransition = {
  label: string;
  permission: PermissionCode;
  from: FiscalYearStatus[];
  to: FiscalYearStatus;
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

export const FISCAL_YEAR_TRANSITIONS: Record<
  FiscalYearAction,
  FiscalYearTransition
> = {
  open: {
    label: "Aktifkan Tahun Buku",
    permission: "FISCAL_YEAR_OPEN",
    from: ["Draft"],
    to: "Open",
    icon: "check",
    tone: "primary",
    title: "Aktifkan tahun buku?",
    body:
      "12 Fiscal Period — Januari sampai Desember — dibuat sekarang dan " +
      "Budget mulai dikelompokkan ke dalamnya. Tahun buku yang sudah aktif " +
      "tidak dapat dikembalikan menjadi Draft.",
    confirmLabel: "Ya, Aktifkan",
    done: "Tahun buku diaktifkan",
  },
};

/** Why Closed is not reachable from this screen. Shown where the step would be. */
export const FISCAL_YEAR_CLOSING_NOTE =
  "Penutupan tahun buku dilakukan melalui proses closing tersendiri, bukan " +
  "dengan mengubah status. Prosesnya mengunci periode terhadap posting dan " +
  "akan tersedia bersama modul Accounting.";

/**
 * How many fiscal years may stand Open at once.
 *
 * Two, and the reason is the overlap at a year-end: January's work belongs to
 * the new year while December's invoices are still arriving against the old
 * one, so a book that had to be shut before the next one opened would refuse
 * one of them. Three is not that case — it is a year nobody has got round to
 * closing, and every month it stays open is a month of figures that cannot be
 * carried forward.
 */
export const MAX_OPEN_FISCAL_YEARS = 2;

/** Just enough of a Fiscal Year to say which one is being talked about. */
export type OpenYearSummary = { id: number; label: string; name: string };

/**
 * Why one more year may not be opened, or null when it may.
 *
 * Pure, and takes the years already Open rather than reading them, so the rule
 * can be exercised directly at every count instead of only at whatever the
 * database happens to hold. Ordered here rather than by the caller: the refusal
 * has to name the **oldest** open year — the only one that can be closed next,
 * since closing a newer one would leave an Open year with no successor to
 * inherit into — and "oldest" is a property of the list, not of the query.
 */
export function openLimitRefusal(open: OpenYearSummary[]): string | null {
  if (open.length < MAX_OPEN_FISCAL_YEARS) return null;

  const ordered = [...open].sort((a, b) => a.label.localeCompare(b.label));
  const oldest = ordered[0];
  return (
    `Sudah ada ${ordered.length} tahun buku aktif (${ordered
      .map((y) => y.label)
      .join(", ")}). Tutup ${oldest.name} lebih dahulu sebelum mengaktifkan ` +
    "tahun buku berikutnya."
  );
}

export function transitionAllowed(
  action: FiscalYearAction,
  status: FiscalYearStatus
): boolean {
  return FISCAL_YEAR_TRANSITIONS[action].from.includes(status as FiscalYearStatus);
}

export type FiscalYearAbilities = { open: boolean };

export function fiscalYearAbilities(
  permissions: Iterable<string>
): FiscalYearAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return { open: held.has("FISCAL_YEAR_OPEN") };
}

/** The transitions this user may run against a year in this status. */
export function availableActions(
  status: FiscalYearStatus,
  can: FiscalYearAbilities
): FiscalYearAction[] {
  const order: FiscalYearAction[] = ["open"];
  return order.filter((a) => transitionAllowed(a, status) && can[a]);
}
