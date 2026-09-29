import Link from "next/link";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { DocumentHeader } from "@/components/ui/document-header";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { formatDate, formatMoney } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { reportHref } from "@/lib/siba/reports";
import type { OpeningBalanceDetail as Detail } from "@/lib/siba/opening-balance";

/**
 * One Opening Balance — on the same two cards every document reads on.
 *
 * A server component with nothing to interact with: the document is immutable
 * from the moment it exists, so there is no edit, no delete and no lifecycle.
 * The header carries the lock chip every final document carries.
 *
 * The two sides are equal on every snapshot this application writes — what
 * remains once the profit and loss has been closed out is a balance sheet — so
 * the total row speaks about balance only when they are not.
 *
 * Each account links into its own General Ledger, for this Company, on the day
 * the snapshot speaks for.
 */
export function OpeningBalanceDetail({ opening }: { opening: Detail }) {
  const difference = Math.round((opening.debit - opening.credit) * 100) / 100;
  const day = opening.postingDate.slice(0, 10);

  return (
    <>
      <DocumentHeader
        module="Accounting"
        trail={[{ label: "Opening Balance", href: "/accounting/opening-balance" }]}
        icon="file"
        number={opening.openingNo}
        tags={<span className="bdg s-info">{opening.fiscalYearLabel}</span>}
      >
        <span className="lockchip">
          <Icon name="lock" size={13} /> Final, tidak dapat diubah
        </span>
      </DocumentHeader>

      <div className="fgrid solo">
        <div>
          <div className="card">
            <div className="card-h">
              <span className="ci">
                <Icon name="file" size={15} />
              </span>
              <div className="ct">
                <h3>Opening Balance</h3>
                <p>Posisi setiap account pada awal tahun buku, untuk satu Company.</p>
              </div>
            </div>
            <FormBody>
              <FormSection>
                <FormRow>
                  <Field label="Company" span={3}>
                    <div className="ro">
                      <span className="lab">{opening.companyLabel}</span>
                      <span>{opening.companyName}</span>
                    </div>
                  </Field>
                  <Field label="Tanggal" span={3}>
                    <div className="ro">{formatDate(opening.postingDate)}</div>
                  </Field>
                  <Field label="Tahun Buku" span={3}>
                    <div className="ro">{opening.fiscalYearName}</div>
                  </Field>
                  {/* A snapshot a close produced names the year it came from;
                      one with nothing behind it was injected at go-live, and
                      that is the only thing that tells the two apart. */}
                  <Field label="Sumber" span={3}>
                    <div className="ro">
                      {opening.sourceFiscalYearLabel ? (
                        `Penutupan ${opening.sourceFiscalYearLabel}`
                      ) : (
                        <span className="dash">Saldo awal go-live</span>
                      )}
                    </div>
                  </Field>
                </FormRow>
              </FormSection>
            </FormBody>
            <p className="fnote">
              Ditulis sekali oleh penutupan tahun buku dan tidak pernah diubah; General
              Ledger dan Trial Balance membaca saldo awalnya dari sini.
            </p>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="layers" size={15} />
              </span>
              <div className="ct">
                <h3>Baris</h3>
                <p>
                  Satu baris untuk satu pasangan account dan Partner, dalam{" "}
                  {BASE_CURRENCY_LABEL}.
                </p>
              </div>
              <span className="hint">{opening.lineCount} baris</span>
            </div>
            <div className="tw">
              <table className="grid ltab">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>No</th>
                    <th>Account</th>
                    <th style={{ width: 260 }}>Partner</th>
                    <th className="num" style={{ width: 170 }}>
                      Debit
                    </th>
                    <th className="num" style={{ width: 170 }}>
                      Kredit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {opening.lines.map((l, i) => (
                    <tr key={l.id}>
                      <td className="no">{i + 1}</td>
                      <td className="pri">
                        <span className="idc">
                          <Link
                            className="lab"
                            href={reportHref("general-ledger", {
                              company: opening.companyId,
                              accounts: l.accountId,
                              from: day,
                              to: day,
                            })}
                            title="Buka General Ledger account ini"
                          >
                            {l.accountLabel}
                          </Link>
                          <span className="nm">{l.accountName}</span>
                        </span>
                      </td>
                      <td>
                        {l.partnerLabel ? (
                          <span className="idc">
                            <span className="lab">{l.partnerLabel}</span>
                            <span className="nm">{l.partnerName}</span>
                          </span>
                        ) : (
                          <span className="dash">—</span>
                        )}
                      </td>
                      <td className="num">
                        <Amount value={l.debit} nil="dash" />
                      </td>
                      <td className="num">
                        <Amount value={l.credit} nil="dash" />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="totrow">
                    <td colSpan={3} style={{ textAlign: "right" }}>
                      Total
                      {difference !== 0 && (
                        <span className="overtag">
                          tidak seimbang · selisih{" "}
                          {formatMoney(Math.abs(difference), BASE_CURRENCY_LABEL)}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      <Amount value={opening.debit} big />
                    </td>
                    <td className="num">
                      <Amount value={opening.credit} big />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
