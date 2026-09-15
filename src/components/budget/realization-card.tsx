"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import { purposeLabel } from "@/lib/siba/rules";
import type { budgetRealizations } from "@/lib/siba/finance";

type Realization = Awaited<ReturnType<typeof budgetRealizations>>[number];

/**
 * Where a budget's realization came from.
 *
 * `realized_amount` is a number the planner did not write and cannot change;
 * this is the trail behind it. Draft and Cancelled documents appear too, marked
 * as such: a Draft has moved nothing, so it does not count towards the figure,
 * but a plan quietly "reserved" by a document nobody posted is exactly what a
 * planner needs to see before assuming the money is still free.
 */
export function RealizationCard({
  realizations,
  currencyLabel,
}: {
  realizations: Realization[];
  currencyLabel: string;
}) {
  const posted = realizations.filter((r) => r.status === "Posted");
  const drafted = realizations.filter((r) => r.status === "Draft");

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="wallet2" size={15} />
        </span>
        <div className="ct">
          <h3>Realisasi</h3>
          <p>
            Dokumen Cash Bank Transaction yang menunjuk budget ini. Hanya
            dokumen berstatus Posted yang menggerakkan nominal realisasi.
          </p>
        </div>
        <span className="hint">
          {posted.length} posted
          {drafted.length > 0 && ` · ${drafted.length} draft`}
        </span>
      </div>

      {realizations.length ? (
        <div className="tw">
          <table className="grid ltab">
            <thead>
              <tr>
                <th style={{ width: 34 }}>No</th>
                <th style={{ width: 100 }}>Dokumen</th>
                <th style={{ width: 104 }}>Tanggal</th>
                <th>Purpose</th>
                <th style={{ width: 104 }}>Status</th>
                <th className="num" style={{ width: 150 }}>
                  Nominal
                </th>
              </tr>
            </thead>
            <tbody>
              {realizations.map((r, i) => (
                <tr key={r.transactionId}>
                  <td className="no">{i + 1}</td>
                  <td>
                    <Link href={`/finance/cash-bank-transaction/${r.transactionId}`}>
                      <span className="lab">{r.transactionNo}</span>
                    </Link>
                  </td>
                  <td>
                    {r.date ? (
                      formatDate(r.date)
                    ) : (
                      <span className="dash">belum diposting</span>
                    )}
                  </td>
                  <td className="pri">{purposeLabel(r.purpose)}</td>
                  <td>
                    <span className={`bdg ${STATUS_CLASS[r.status] ?? "s-mute"}`}>
                      {STATUS_TEXT[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="num">
                    <span
                      className={`mny${r.status === "Posted" ? "" : " z"}`}
                      title={
                        r.status === "Posted"
                          ? undefined
                          : "Belum diposting — tidak dihitung sebagai realisasi"
                      }
                    >
                      {formatMoney(r.amount, currencyLabel)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty sm">
          <div className="ic">
            <Icon name="wallet2" size={18} />
          </div>
          <h4>Belum pernah direalisasikan</h4>
          <p>
            Budget yang sudah disetujui direalisasikan lewat dokumen kas/bank di
            modul Finance.
          </p>
        </div>
      )}
    </div>
  );
}
