import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import { reportHref } from "@/lib/siba/reports";
import type { JournalDetail as Detail } from "@/lib/siba/journal";

/**
 * One journal, as it was posted.
 *
 * A server component, because there is nothing to interact with: a journal is
 * immutable from the moment it exists. No edit, no delete, no reverse — the
 * header carries a lock chip saying so rather than a disabled button pretending
 * the capability exists somewhere.
 *
 * The totals row is the point of the page. Debits and credits are equal on
 * every journal this application writes, and the row states both so the reader
 * can see it rather than trust it.
 */
export function JournalDetail({ journal }: { journal: Detail }) {
  const balanced = Math.round(journal.debit * 100) === Math.round(journal.credit * 100);
  const currency = journal.lines[0]?.currencyLabel ?? "";

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
            {journal.journalNo}
            <span className="bdg s-ok">{journal.status}</span>
            {!balanced && <span className="bdg s-bad">Tidak seimbang</span>}
          </h1>
          <div className="ph-act">
            <span className="lockchip">
              <Icon name="lock" size={13} /> Journal tidak dapat diubah
            </span>
          </div>
        </div>
        <p className="ph-sub">{journal.description}</p>
      </div>

      <div className="card">
        <div className="card-b">
          <div className="critbar">
            <span className="cr">
              <i>Tanggal Posting</i>
              {formatDate(journal.postingDate)}
            </span>
            <span className="cr">
              <i>Company</i>
              {journal.companyLabel}
            </span>
            <span className="cr">
              <i>Sumber</i>
              {journal.sourceDocLabel ?? "—"}
              {journal.sourceDocId && <em>#{journal.sourceDocId}</em>}
            </span>
            <span className="cr">
              <i>Baris</i>
              {journal.lineCount}
            </span>
          </div>
        </div>

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
                  <td className="mut">{l.description}</td>
                  <td className="num">
                    {l.debit ? formatMoney(l.debit, l.currencyLabel) : "—"}
                  </td>
                  <td className="num">
                    {l.credit ? formatMoney(l.credit, l.currencyLabel) : "—"}
                  </td>
                </tr>
              ))}

              <tr className="totrow">
                <td colSpan={5}>
                  {balanced
                    ? "Total — debit dan kredit seimbang"
                    : "Total — TIDAK SEIMBANG"}
                </td>
                <td className="num">{formatMoney(journal.debit, currency)}</td>
                <td className="num">{formatMoney(journal.credit, currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="foot-note">
        Journal bersifat append-only dan immutable: setiap journal wajib
        seimbang saat diposting, dan tidak ada jalur untuk mengubah, menghapus,
        atau membalikkannya. Koreksi dilakukan dengan transaksi bisnis baru yang
        menghasilkan journal tersendiri.
      </p>
    </>
  );
}
