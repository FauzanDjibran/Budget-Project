"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { transitionJournal } from "@/app/actions/journal";
import {
  JOURNAL_TRANSITIONS,
  availableJournalActions,
  journalIsEditable,
  type JournalAbilities,
  type JournalAction,
  type JournalStatus,
} from "@/lib/siba/journal-workflow";
import {
  headerButtonClass,
  orderForHeader,
  type ActionTone,
} from "@/lib/siba/header-actions";

/**
 * A manual journal's lifecycle, as buttons in the page header.
 *
 * Only a manual journal has any: one produced by a document being posted is
 * already final the moment it exists, so the detail page shows it a lock chip
 * instead. What is offered here comes from the transition table, so this can
 * never offer a move the Server Action would refuse.
 *
 * Ordered danger → neutral → primary, in the markup rather than with CSS, so a
 * destructive button never lands where a confirming one just was.
 */
export function JournalActions({
  id,
  subject,
  status,
  isManual,
  can,
}: {
  id: number;
  /** Named in the confirmation, so nobody posts the wrong journal. */
  subject: string;
  status: JournalStatus;
  isManual: boolean;
  can: JournalAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState<JournalAction | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isManual) {
    return (
      <span className="lockchip">
        <Icon name="lock" size={13} /> Journal otomatis tidak dapat diubah
      </span>
    );
  }

  const run = async (action: JournalAction) => {
    setBusy(true);
    const result = await transitionJournal(id, action);
    setBusy(false);
    setConfirm(null);
    if (!result.ok) {
      toast("Tidak dapat diproses", result.errors._form, "err");
      return;
    }
    toast(result.message, subject, "ok");
    router.refresh();
  };

  const actions = availableJournalActions(status, can);
  const editable = journalIsEditable(status) && can.edit;

  const buttons = orderForHeader(
    [
      ...(editable
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link
                  key="edit"
                  className="btn"
                  href={`/accounting/journal/${id}/edit`}
                >
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = JOURNAL_TRANSITIONS[a];
        return {
          key: a,
          tone: t.tone,
          node: (
            <button
              key={a}
              className={headerButtonClass(t.tone)}
              disabled={busy}
              onClick={() => setConfirm(a)}
            >
              <Icon name={t.icon} size={15} /> {t.label}
            </button>
          ),
        };
      }),
    ],
    (i) => i.tone
  );

  return (
    <>
      {buttons.length ? (
        buttons.map((b) => b.node)
      ) : (
        <span className="lockchip">
          <Icon name="lock" size={13} />{" "}
          {status === "Posted" ? "Terkunci setelah Post" : "Journal dibatalkan"}
        </span>
      )}

      {confirm && (
        <ConfirmDialog
          open
          icon={JOURNAL_TRANSITIONS[confirm].icon}
          tone={JOURNAL_TRANSITIONS[confirm].tone === "danger" ? "danger" : "ok"}
          title={JOURNAL_TRANSITIONS[confirm].title}
          subject={subject}
          body={JOURNAL_TRANSITIONS[confirm].body}
          confirmLabel={JOURNAL_TRANSITIONS[confirm].confirmLabel}
          confirmTone={
            JOURNAL_TRANSITIONS[confirm].tone === "danger"
              ? "solid-danger"
              : "primary"
          }
          busy={busy}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
