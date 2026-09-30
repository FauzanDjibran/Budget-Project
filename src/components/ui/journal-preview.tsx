"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { formatForeignFace } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import type { JournalPreviewLine } from "@/lib/siba/journal";

export type JournalPreviewResult =
  | { ok: true; lines: JournalPreviewLine[] }
  | { ok: false; errors: Record<string, string> };

/**
 * The journal a Post is about to write, inside its confirmation —
 * consequences before commitment.
 *
 * `load` runs the document's own posting path as a dry run on the server, so
 * what is shown is the journal Post writes rather than a second calculation of
 * it: the same accounts, the same Partners, the same base values, and an FX
 * line exactly where one will arise. A posting that would be refused says why
 * here, before anybody presses the button, and `onReady` tells the dialog
 * whether there is anything to confirm.
 *
 * Figures are base currency, the measure the journal balances in, drawn the
 * way the Journal draws them (`Amount ledger`); a foreign line states its face
 * under the account, as the General Ledger does.
 */
export function JournalPreview({
  load,
  onReady,
}: {
  load: () => Promise<JournalPreviewResult>;
  onReady: (postable: boolean) => void;
}) {
  const [result, setResult] = useState<JournalPreviewResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void load().then((r) => {
      if (cancelled) return;
      setResult(r);
      onReady(r.ok);
    });
    return () => {
      cancelled = true;
    };
    // Loaded once per confirmation: the dialog mounts this when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result) {
    return <div className="apmap">Menyiapkan journal yang akan ditulis…</div>;
  }
  if (!result.ok) {
    return (
      <div className="apmap warn">
        <Icon name="warn" size={13} />
        {result.errors._form ?? Object.values(result.errors)[0]}
      </div>
    );
  }

  const debit = result.lines.reduce((t, l) => t + l.debit, 0);
  const credit = result.lines.reduce((t, l) => t + l.credit, 0);
  return (
    <div className="tw boxed">
      <table className="grid">
        <thead>
          <tr>
            <th>Account</th>
            <th className="num" style={{ width: 136 }}>
              Debit
            </th>
            <th className="num" style={{ width: 136 }}>
              Kredit
            </th>
          </tr>
        </thead>
        <tbody>
          {result.lines.map((l, i) => (
            <tr key={i}>
              <td>
                <span className="idc">
                  <span className="lab">{l.accountLabel}</span>
                  <span className="nm">{l.accountName}</span>
                </span>
                <span className="rsub">
                  {l.partnerLabel ? `${l.partnerLabel} – ${l.partnerName} · ` : ""}
                  {l.currencyLabel !== BASE_CURRENCY_LABEL
                    ? formatForeignFace(l.trxAmount, l.currencyLabel, l.rate)
                    : l.description}
                </span>
              </td>
              <td className="num">
                <Amount value={l.debit} nil="dash" ledger />
              </td>
              <td className="num">
                <Amount value={l.credit} nil="dash" ledger />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="totrow">
            <td style={{ textAlign: "right" }}>Total</td>
            <td className="num">
              <Amount value={debit} ledger />
            </td>
            <td className="num">
              <Amount value={credit} ledger />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
