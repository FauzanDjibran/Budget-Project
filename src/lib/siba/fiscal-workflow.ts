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
 * **Closed is a rollup, not a status somebody sets.** Closing happens per
 * Company: the induk can shut 2026 while the anak is still finishing it, and
 * that state lives in `acc_fiscal_closing`. The year itself reads Closed only
 * once every Company has closed it. That is also why `close` is the one
 * transition here that is not run from the Fiscal Year's own header — it needs
 * a Company, a checklist and a preview of the entry it is about to write, so
 * it carries `runAt` and the header links there instead.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type FiscalYearStatus = "Draft" | "Open" | "Closed";

export type FiscalYearAction = "open" | "close";

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
  /**
   * Where the step is run, when it is not run inline from the record's header.
   *
   * A transition with no `runAt` is a button and a confirmation. One with a
   * `runAt` needs more than a yes — closing needs a Company, a validation
   * checklist and a preview of the journal it is about to write — so the
   * header links to that screen rather than pretending the step is one click.
   */
  runAt?: string;
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
  close: {
    label: "Tutup Tahun Buku",
    permission: "FISCAL_YEAR_CLOSE",
    from: ["Open"],
    to: "Closed",
    icon: "lock",
    tone: "primary",
    runAt: "/accounting/closing",
    title: "Tutup tahun buku untuk Company ini?",
    body:
      "Hasil tahun berjalan dipindahkan ke Laba/Rugi Tahun Sebelumnya, dan " +
      "Opening Balance tahun berikutnya ditulis dari posisi akhir tahun ini. " +
      "Setelah ditutup, tidak ada transaksi baru yang dapat dibuat di dalam " +
      "tahun buku ini oleh Company tersebut, dan penutupan tidak dapat " +
      "dibatalkan.",
    confirmLabel: "Ya, Tutup Tahun Buku",
    done: "Tahun buku ditutup",
  },
};

/**
 * Why the closing step leaves this screen.
 *
 * Closing is per Company and produces two documents, so it cannot honestly be
 * a yes/no on a record that belongs to neither Company. The header links to
 * the workspace, and this is the title on that link.
 */
export const FISCAL_YEAR_CLOSING_NOTE =
  "Penutupan dilakukan per Company, di layar Fiscal Year Closing: di sana " +
  "validasinya diperiksa dan journal penutup ditampilkan sebelum dijalankan.";

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

export type FiscalYearAbilities = { open: boolean; close: boolean };

export function fiscalYearAbilities(
  permissions: Iterable<string>
): FiscalYearAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    open: held.has("FISCAL_YEAR_OPEN"),
    close: held.has("FISCAL_YEAR_CLOSE"),
  };
}

/**
 * The transitions this user may run **from the record's own header**.
 *
 * A transition carrying `runAt` is deliberately not here: it is run on a
 * screen of its own, so offering it as a confirm button would be offering a
 * one-click version of a step that needs a Company and a preview first.
 */
export function availableActions(
  status: FiscalYearStatus,
  can: FiscalYearAbilities
): FiscalYearAction[] {
  const order: FiscalYearAction[] = ["open", "close"];
  return order.filter(
    (a) =>
      !FISCAL_YEAR_TRANSITIONS[a].runAt &&
      transitionAllowed(a, status) &&
      can[a]
  );
}
