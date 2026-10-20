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
 * Each Company keeps its own calendar, so a year belongs to one Company and
 * its close is that Company's. `close` is still the one transition here that
 * is not run from the Fiscal Year's own header — it needs a checklist and a
 * preview of the entry it is about to write, so it carries `runAt` and the
 * header links there instead.
 *
 * A **period** inside an Open year is Open or Locked, and moves between the
 * two from the year's period list (`FISCAL_PERIOD_TRANSITIONS`). Locked is a
 * state, not a close: it refuses postings until the period is unlocked. A year
 * closes only once all twelve are Locked, and its close makes them Closed.
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
 * Closing produces two documents and is refused until a checklist passes, so it
 * cannot honestly be a yes/no on the year's header. The header links to the
 * workspace, and this is the title on that link.
 */
export const FISCAL_YEAR_CLOSING_NOTE =
  "Penutupan dilakukan di layar Fiscal Year Closing: di sana validasinya " +
  "diperiksa dan journal penutup ditampilkan sebelum dijalankan.";

// ------------------------------------------------------------------ periods

export type FiscalPeriodStatus = "Open" | "Locked" | "Closed";

export type FiscalPeriodAction = "lock" | "unlock";

export type FiscalPeriodTransition = Omit<FiscalYearTransition, "from" | "to" | "runAt"> & {
  from: FiscalPeriodStatus;
  to: FiscalPeriodStatus;
};

/**
 * A period's two moves, both reversible, both from the year's period list.
 *
 * Only inside an Open year: a Draft year has no periods and a Closed one has
 * made all of them Closed for good.
 */
export const FISCAL_PERIOD_TRANSITIONS: Record<FiscalPeriodAction, FiscalPeriodTransition> = {
  lock: {
    label: "Kunci",
    permission: "FISCAL_PERIOD_LOCK",
    from: "Open",
    to: "Locked",
    icon: "lock",
    tone: "neutral",
    title: "Kunci periode?",
    body:
      "Selama terkunci, tidak ada dokumen bertanggal di dalam periode ini yang " +
      "dapat diposting oleh Company ini. Periode dapat dibuka kembali kapan saja.",
    confirmLabel: "Ya, Kunci",
    done: "Periode dikunci",
  },
  unlock: {
    label: "Buka Kunci",
    permission: "FISCAL_PERIOD_UNLOCK",
    from: "Locked",
    to: "Open",
    icon: "check",
    tone: "neutral",
    title: "Buka kunci periode?",
    body:
      "Periode kembali menerima posting bertanggal di dalamnya, termasuk " +
      "dokumen backdate.",
    confirmLabel: "Ya, Buka Kunci",
    done: "Kunci periode dibuka",
  },
};

export type FiscalPeriodAbilities = { lock: boolean; unlock: boolean };

export function fiscalPeriodAbilities(permissions: Iterable<string>): FiscalPeriodAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return { lock: held.has("FISCAL_PERIOD_LOCK"), unlock: held.has("FISCAL_PERIOD_UNLOCK") };
}

/** The one move a period offers, or null — inside an Open year only. */
export function periodAction(
  yearStatus: FiscalYearStatus,
  periodStatus: FiscalPeriodStatus,
  can: FiscalPeriodAbilities
): FiscalPeriodAction | null {
  if (yearStatus !== "Open") return null;
  if (periodStatus === "Open" && can.lock) return "lock";
  if (periodStatus === "Locked" && can.unlock) return "unlock";
  return null;
}

/** Just enough of a Fiscal Year to say which one is being talked about. */
export type OpenYearSummary = { id: number; label: string; name: string };

/** A close the year's Company has already run, as the activation rule needs it. */
export type LaterClosing = { yearLabel: string; yearName: string; companyLabel: string };

/**
 * Why a year may not be activated, or null when it may.
 *
 * **Any number of years may stand Open** — the business has carried several at
 * once while working back through its history, and the posting lock is what
 * keeps each one honest. What may not happen is a year opening **behind** a
 * close: that close wrote the next year's Opening Balance snapshot, and every
 * report opening after it stands on the snapshot, so a posting into an older
 * year would move a figure the snapshot has already frozen. The refusal names
 * the closes in the way, because "not allowed" is not actionable.
 *
 * Pure, and takes the later closes rather than reading them, so the rule is
 * exercised directly instead of against whatever the database holds.
 */
export function activationRefusal(yearLabel: string, later: LaterClosing[]): string | null {
  if (!later.length) return null;
  const named = [...later]
    .sort((a, b) => a.yearLabel.localeCompare(b.yearLabel) || a.companyLabel.localeCompare(b.companyLabel))
    .map((c) => `${c.yearName} (${c.companyLabel})`)
    .join(", ");
  return (
    `Tahun buku ${yearLabel} tidak dapat diaktifkan karena tahun buku setelahnya ` +
    `sudah ditutup: ${named}. Opening Balance-nya sudah dibekukan.`
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
