import Link from "next/link";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { reportHref } from "@/lib/siba/reports";
import type { OpeningBalanceDetail as Detail } from "@/lib/siba/opening-balance";

/**
 * One Opening Balance.
 *
 * A server component with nothing to interact with, and no client island at
 * all: the document is immutable from the moment it exists, so there is no
 * edit, no delete and no lifecycle to offer. The header carries a lock chip
 * saying so rather than an empty button bar.
 *
 * The totals row is the point of the page, exactly as it is on a journal. The
 * two sides are equal on every snapshot this application writes — what remains
 * once the profit and loss has been closed out is a balance sheet — and the row
 * states both so a reader can see it rather than take it on trust.
 *
 * Each account links into its own General Ledger, which is where the figure
 * beside it came from.
 */
export function OpeningBalanceDetail({ opening }: { opening: Detail }) {
  const balanced =
    Math.round(opening.debit * 100) === Math.round(opening.credit * 100);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Accounting</span>
          <span>/</span>
          <Link href="/accounting/opening-balance">Opening Balance</Link>
          <span>/</span>
          <span className="cur">{opening.openingNo}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="file" size={16} />
            </span>
            <span className="docno">{opening.openingNo}</span>
            <span className="bdg s-info">{opening.fiscalYearLabel}</span>
            {!balanced && <span className="bdg s-bad">Tidak seimbang</span>}
          </h1>
          <div className="ph-act">
            <span className="bdg s-mute">
              <Icon name="lock" size={13} /> Final
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <FormBody>
          <FormSection>
            <FormRow>
              <Field label="Tanggal" span={3}>
                <div className="ro">{formatDate(opening.postingDate)}</div>
              </Field>
              <Field label="Company" span={3}>
                <div className="ro">
                  <span className="lab">{opening.companyLabel}</span>
                </div>
              </Field>
              <Field label="Tahun Buku" span={3}>
                <div className="ro">{opening.fiscalYearName}</div>
              </Field>
              {/* A snapshot a close produced names the year it came from; one
                  with nothing behind it was injected at go-live, and that is
                  the only thing that tells the two apart. */}
              <Field label="Sumber" span={3}>
                <div className="ro">
                  {opening.sourceFiscalYearLabel ? (
                    `Penutupan ${opening.sourceFiscalYearLabel}`
                  ) : (
                    <span className="mut">Saldo awal go-live</span>
                  )}
                </div>
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
                <th style={{ width: 150 }}>Partner</th>
                <th className="num" style={{ width: 150 }}>
                  Debit
                </th>
                <th className="num" style={{ width: 150 }}>
                  Kredit
                </th>
              </tr>
            </thead>
            <tbody>
              {opening.lines.map((l) => (
                <tr key={l.id}>
                  <td className="num mut">{l.sequenceNo}</td>
                  <td>
                    <Link
                      className="lab"
                      href={reportHref("general-ledger", { accounts: l.accountId })}
                      title="Buka General Ledger account ini"
                    >
                      {l.accountLabel}
                    </Link>
                  </td>
                  <td className="pri">{l.accountName}</td>
                  <td className="mut">{l.partnerLabel ?? "—"}</td>
                  <td className="num">
                    {l.debit ? formatMoney(l.debit, BASE_CURRENCY_LABEL) : "—"}
                  </td>
                  <td className="num">
                    {l.credit ? formatMoney(l.credit, BASE_CURRENCY_LABEL) : "—"}
                  </td>
                </tr>
              ))}

              <tr className="totrow">
                <td colSpan={4}>
                  {balanced
                    ? "Total — debit dan kredit seimbang"
                    : "Total — TIDAK SEIMBANG"}
                </td>
                <td className="num">
                  {formatMoney(opening.debit, BASE_CURRENCY_LABEL)}
                </td>
                <td className="num">
                  {formatMoney(opening.credit, BASE_CURRENCY_LABEL)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="foot-note">
        Satu baris untuk satu pasangan account dan partner, sesuai grain journal
        yang menghasilkannya.
      </p>
    </>
  );
}
