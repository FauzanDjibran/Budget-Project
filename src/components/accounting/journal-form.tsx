"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { DocumentHeader } from "@/components/ui/document-header";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { PartnerCell } from "@/components/ui/partner-cell";
import { Drill } from "@/components/report/drill";
import { formatDate, formatForeignFace, formatMoney } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { documentHref } from "@/lib/siba/document-links";
import type { JournalDetail } from "@/lib/siba/journal";
import { reportHref } from "@/lib/siba/reports";

/**
 * A journal a document's posting, or a fiscal year's close, wrote — read only.
 *
 * Such a journal is `Posted` the moment it exists and is never edited, so this
 * screen offers no button: a correction is a new document, which writes its own
 * journal. A typed journal opens in Jurnal Umum instead, where it is drafted,
 * edited and posted (the page sends it there).
 *
 * Debit and kredit are base currency, the only measure a journal balances in;
 * a foreign line states its face and kurs beneath. Balance is spoken about only
 * when it is broken.
 */
export function JournalForm({ journal }: { journal: JournalDetail }) {
  const difference = Math.round((journal.debit - journal.credit) * 100) / 100;
  const source = documentHref(journal.sourceDocTable, journal.sourceDocId);
  const viewDate = journal.accountingDate ? journal.accountingDate.slice(0, 10) : null;

  return (
    <>
      <DocumentHeader
        module="Accounting"
        trail={[{ label: "Journal", href: "/accounting/journal" }]}
        icon="book"
        number={journal.journalNo}
        status={journal.status}
      >
        <span className="lockchip">
          <Icon name="lock" size={13} /> Journal otomatis tidak dapat diubah
        </span>
      </DocumentHeader>

      <div className="fgrid solo">
        <div>
          <div className="card">
            <div className="card-h">
              <span className="ci">
                <Icon name="book" size={15} />
              </span>
              <div className="ct">
                <h3>Journal</h3>
                <p>Dibuat otomatis saat dokumen sumbernya diposting.</p>
              </div>
            </div>
            <FormBody>
              <FormSection>
                <FormRow>
                  <Field label="Company" span={3}>
                    <div className="ro">
                      <span className="lab">{journal.companyLabel}</span>
                      <span>{journal.companyName}</span>
                    </div>
                  </Field>

                  <Field label="Tanggal Akuntansi" span={3}>
                    <div className="ro">
                      {viewDate ? formatDate(viewDate) : <span className="dash">—</span>}
                    </div>
                  </Field>

                  <Field label="Sumber" span={6}>
                    <div className="ro">
                      {source ? (
                        <Drill href={source} title="Buka dokumen sumber journal ini">
                          {journal.sourceDocLabel}
                        </Drill>
                      ) : (
                        journal.sourceDocLabel ?? <span className="dash">—</span>
                      )}
                    </div>
                  </Field>

                  <Field label="Keterangan" span={12}>
                    <div className="ro multi">{journal.description}</div>
                  </Field>
                </FormRow>
              </FormSection>
            </FormBody>

            <p className="fnote">
              Journal ini bersifat final: koreksi dilakukan dengan dokumen baru, yang
              membentuk journal-nya sendiri.
            </p>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="layers" size={15} />
              </span>
              <div className="ct">
                <h3>Baris Journal</h3>
                <p>
                  Debit dan kredit dalam {BASE_CURRENCY_LABEL}; baris mata uang asing menyebut nilai
                  asal dan kursnya.
                </p>
              </div>
              <span className="hint">{journal.lineCount} baris</span>
            </div>

            <div className="tw">
              <table className="grid ltab" style={{ minWidth: 1060 }}>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>No</th>
                    <th style={{ width: 300 }}>Account</th>
                    <th style={{ width: 220 }}>Partner</th>
                    <th>Keterangan</th>
                    <th className="num" style={{ width: 150 }}>
                      Debit
                    </th>
                    <th className="num" style={{ width: 150 }}>
                      Kredit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {journal.lines.map((l, i) => (
                    <tr key={l.id}>
                      <td className="no">{i + 1}</td>
                      <td className="pri">
                        <span className="idc">
                          {/* The account's own General Ledger, for the day
                              this journal belongs to. */}
                          <Link
                            className="lab"
                            href={reportHref("general-ledger", {
                              company: journal.companyId,
                              accounts: l.accountId,
                              from: viewDate,
                              to: viewDate,
                            })}
                            title="Buka General Ledger account ini"
                          >
                            {l.accountLabel}
                          </Link>
                          <span className="nm">{l.accountName}</span>
                        </span>
                      </td>
                      <td>
                        <PartnerCell label={l.partnerLabel} name={l.partnerName} mismatch={l.partnerMismatch} />
                      </td>
                      <td className="mut">
                        {l.description || <span className="dash">—</span>}
                        {l.foreign && (
                          <span className="rsub">{formatForeignFace(l.trxAmount, l.currencyLabel, l.rate)}</span>
                        )}
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
                    <td colSpan={4} style={{ textAlign: "right" }}>
                      Total
                      {difference !== 0 && (
                        <span className="overtag">
                          tidak seimbang · selisih {formatMoney(Math.abs(difference), BASE_CURRENCY_LABEL)}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      <Amount value={journal.debit} big ledger />
                    </td>
                    <td className="num">
                      <Amount value={journal.credit} big ledger />
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
