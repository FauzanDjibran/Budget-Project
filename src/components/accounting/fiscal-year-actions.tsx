"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { transitionFiscalYear } from "@/app/actions/fiscal";
import {
  FISCAL_YEAR_CLOSING_NOTE,
  FISCAL_YEAR_TRANSITIONS,
  availableActions,
  type FiscalYearAbilities,
  type FiscalYearAction,
  type FiscalYearStatus,
} from "@/lib/siba/fiscal-workflow";
import { headerButtonClass } from "@/lib/siba/header-actions";

/**
 * The Fiscal Year lifecycle, as buttons in the page header.
 *
 * Status is not an isian anywhere on this screen: a year is created as Draft,
 * activated here, and closed on a screen of its own. What is offered comes
 * from the transition table, so this can never offer a move the Server Action
 * would refuse.
 *
 * **Closing leaves this header on purpose.** It is per Company, it needs a
 * validation checklist and a preview of the journal it is about to post, and
 * it is irreversible — none of which fits behind a yes/no on a record that
 * belongs to neither Company. The transition declares a `runAt`, so the step
 * is offered here as a link to that workspace rather than as a confirm button.
 */
export function FiscalYearActions({
  id,
  subject,
  status,
  can,
}: {
  id: number;
  /** Named in the confirmation, so nobody activates the wrong year. */
  subject: string;
  status: FiscalYearStatus;
  can: FiscalYearAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState<FiscalYearAction | null>(null);
  const [busy, setBusy] = useState(false);

  const actions = availableActions(status, can);

  const run = async (action: FiscalYearAction) => {
    setBusy(true);
    const result = await transitionFiscalYear(id, action);
    setBusy(false);
    setConfirm(null);
    if (!result.ok) {
      toast("Tidak dapat diproses", result.message, "err");
      return;
    }
    toast(
      result.message,
      result.periods
        ? `${subject} · ${result.periods} Fiscal Period dibuat`
        : subject,
      "ok"
    );
    router.refresh();
  };

  // Header order — danger, then neutral, then the one primary. The closing
  // link is neutral rather than primary: it does not close anything, it opens
  // the screen where closing is decided. Only one of the two ever renders on a
  // given status, so no sort is needed here.
  return (
    <>
      {status === "Open" && can.close && (
        <Link
          className="btn"
          href="/accounting/closing"
          title={FISCAL_YEAR_CLOSING_NOTE}
        >
          <Icon name="lock" size={15} /> Tutup Tahun Buku
        </Link>
      )}

      {actions.map((a) => {
        const t = FISCAL_YEAR_TRANSITIONS[a];
        return (
          <button
            key={a}
            className={headerButtonClass(t.tone)}
            disabled={busy}
            onClick={() => setConfirm(a)}
          >
            <Icon name={t.icon} size={15} /> {t.label}
          </button>
        );
      })}

      {confirm && (
        <ConfirmDialog
          open
          icon={FISCAL_YEAR_TRANSITIONS[confirm].icon}
          tone="brand"
          title={FISCAL_YEAR_TRANSITIONS[confirm].title}
          subject={subject}
          body={FISCAL_YEAR_TRANSITIONS[confirm].body}
          confirmLabel={FISCAL_YEAR_TRANSITIONS[confirm].confirmLabel}
          busy={busy}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
