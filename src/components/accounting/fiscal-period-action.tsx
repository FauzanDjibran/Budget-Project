"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { transitionFiscalPeriod } from "@/app/actions/fiscal";
import {
  FISCAL_PERIOD_TRANSITIONS,
  type FiscalPeriodAction,
} from "@/lib/siba/fiscal-workflow";

/** One period's Kunci / Buka Kunci, behind a confirmation that states the consequence. */
export function FiscalPeriodActionButton({
  periodId,
  subject,
  action,
}: {
  periodId: number;
  subject: string;
  action: FiscalPeriodAction;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = FISCAL_PERIOD_TRANSITIONS[action];

  const run = async () => {
    setBusy(true);
    const result = await transitionFiscalPeriod(periodId, action);
    setBusy(false);
    setConfirm(false);
    if (!result.ok) toast("Tidak dapat diproses", result.message, "err");
    else toast(result.message, subject, "ok");
  };

  return (
    <>
      <button className="btn sm" disabled={busy} onClick={() => setConfirm(true)}>
        <Icon name={t.icon} size={13} /> {t.label}
      </button>
      {confirm && (
        <ConfirmDialog
          open
          icon={t.icon}
          tone="brand"
          title={t.title}
          subject={subject}
          body={t.body}
          confirmLabel={t.confirmLabel}
          busy={busy}
          onConfirm={run}
          onCancel={() => setConfirm(false)}
        />
      )}
    </>
  );
}
