import Link from "next/link";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { Icon } from "@/components/icon";
import { formatDate, formatForeignFace, formatMoney } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { reportHref } from "@/lib/siba/reports";
import type { JournalDetail as Detail } from "@/lib/siba/journal";
import {
  JOURNAL_STATUS_BADGE,
  type JournalAbilities,
  type JournalStatus,
} from "@/lib/siba/journal-workflow";
import { JournalActions } from "./journal-actions";

/**
 * One journal.
 *
 * A server component holding one client island: the page itself has nothing to
 * interact with, because a **posted** journal is immutable from the moment it
 * exists — no edit, no delete, no reverse. A manual journal that is still a
 * Draft is the exception, and the header carries its Ubah, Post and Batalkan
 * buttons; everything else gets a lock chip saying why there are none.
 *
 * The totals row is the point of the page. Debits and credits are equal on
 * every journal this application posts, and the row states both so the reader
 * can see it rather than trust it.
 */
export function JournalDetail({
  journal,
  can,
}: {
  journal: Detail;
  can: JournalAbilities;
}) {
  const balanced = Math.round(journal.debit * 100) === Math.round(journal.credit * 100);
  const status = journal.status as JournalStatus;

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Accounting</span>
          <span>/</span>
          <Link href="/accounting/journal">Journal</Link>
          <span>/</span>
          <span className="cur">{journal.journalNo}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="book" size={16} />
            </span>
            <span className="docno">{journal.journalNo}</span>
            <span className={`bdg ${JOURNAL_STATUS_BADGE[status] ?? "s-mute"}`}>
              {journal.status}
            </span>
            {journal.isManual && <span className="bdg t-vio">Manual</span>}
            {/* An unposted draft does not balance yet and is not supposed to,
                so the warning belongs only on a journal that is in the books. */}
            {!balanced && status === "Posted" && (
              <span className="bdg s-bad">Tidak seimbang</span>
            )}
          </h1>
          <div className="ph-act">
            <JournalActions
              id={journal.id}
              subject={journal.journalNo}
              status={status}
              isManual={journal.isManual}
              can={can}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <FormBody>
          <FormSection>
            <FormRow>
              <Field label="Tanggal Posting" span={3}>
                <div className="ro">
                  {journal.postingDate ? (
                    formatDate(journal.postingDate)
                  ) : (
                    // A draft has none: the date is written when the books are,
                    // and a journal is never back-dated.
                    <span className="dash">belum diposting</span>
                  )}
                </div>
              </Field>
              <Field label="Company" span={3}>
                <div className="ro">
                  <span className="lab">{journal.companyLabel}</span>
                </div>
              </Field>
              <Field label="Sumber" span={3}>
                <div className="ro">
                  {journal.sourceDocLabel ?? <span className="dash">—</span>}
                  {journal.sourceDocId && (
                    <span className="mut">#{journal.sourceDocId}</span>
                  )}
                </div>
              </Field>
              <Field label="Baris" span={3}>
                <div className="ro">{journal.lineCount}</div>
              </Field>
              <Field label="Keterangan" span={12}>
                <div className="ro multi">{journal.description}</div>
              </Field>
            </FormRow>
          </FormSection>
        </FormBody>

        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 48 }} className="num">
                  #
                </th>
                <th style={{ width: 132 }}>Account</th>
                <th>Nama Account</th>
                <th style={{ width: 120 }}>Partner</th>
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
              {journal.lines.map((l) => (
                <tr key={l.id}>
                  <td className="num mut">{l.sequenceNo}</td>
                  <td>
                    <Link
                      className="lab"
                      href={reportHref("general-ledger", { accounts: l.id })}
                      title="Buka General Ledger account ini"
                    >
                      {l.accountLabel}
                    </Link>
                  </td>
                  <td className="pri">{l.accountName}</td>
                  <td className="mut">{l.partnerLabel ?? "—"}</td>
                  <td className="mut">
                    {l.description}
                    {/* A line in another currency says what it was and at what
                        kurs, beside the rupiah figure it became — `USD 1.000,00
                        @ 16.000,00`. A base-currency line would only be stating
                        itself twice. */}
                    {l.foreign && (
                      <span className="rsub">
                        {formatForeignFace(l.trxAmount, l.currencyLabel, l.rate)}
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {l.debit ? formatMoney(l.debit, BASE_CURRENCY_LABEL) : "—"}
                  </td>
                  <td className="num">
                    {l.credit ? formatMoney(l.credit, BASE_CURRENCY_LABEL) : "—"}
                  </td>
                </tr>
              ))}

              <tr className="totrow">
                <td colSpan={5}>
                  {balanced
                    ? "Total — debit dan kredit seimbang"
                    : status === "Posted"
                      ? "Total — TIDAK SEIMBANG"
                      : "Total — belum seimbang, tidak dapat diposting"}
                </td>
                <td className="num">
                  {formatMoney(journal.debit, BASE_CURRENCY_LABEL)}
                </td>
                <td className="num">
                  {formatMoney(journal.credit, BASE_CURRENCY_LABEL)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="foot-note">
        {status === "Draft"
          ? "Draft belum masuk buku besar: General Ledger dan Trial Balance baru membacanya setelah diposting."
          : "Journal yang sudah diposting bersifat final: koreksi dilakukan dengan journal baru."}
      </p>
    </>
  );
}
