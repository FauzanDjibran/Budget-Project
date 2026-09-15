"use client";

import { useState } from "react";
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

/**
 * The Fiscal Year lifecycle, as buttons in the page header.
 *
 * Status is not an isian anywhere on this screen: a year is created as Draft,
 * activated here, and closed by a process that does not exist yet. What is
 * offered comes from the transition table, so this can never offer a move the
 * Server Action would refuse.
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

  return (
    <>
      {actions.map((a) => {
        const t = FISCAL_YEAR_TRANSITIONS[a];
        return (
          <button
            key={a}
            className="btn primary"
            disabled={busy}
            onClick={() => setConfirm(a)}
          >
            <Icon name={t.icon} size={15} /> {t.label}
          </button>
        );
      })}

      {status === "Open" && (
        <button className="btn" disabled title={FISCAL_YEAR_CLOSING_NOTE}>
          <Icon name="lock" size={15} /> Tutup Tahun Buku
        </button>
      )}

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
