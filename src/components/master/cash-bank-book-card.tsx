import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import { reportHref } from "@/lib/siba/reports";

/**
 * What a Cash & Bank resource's book adds up to, on the master detail.
 *
 * The book itself is **not** here. It is a report — a subject plus a period —
 * and it lives at `Finance › Laporan › Buku Kas & Bank`, where it can be run
 * for any range and reconciled. Embedding a second, range-less copy under the
 * master record would mean two implementations of the same book drifting apart,
 * and would go on implying that a balance is a property of the master row when
 * the whole point of CLAUDE.md §12 is that it is not.
 *
 * What stays is the summary and the way through to the report, already filtered
 * to this resource.
 */
export function CashBankBookCard({
  cashBankId,
  balance,
  entries,
  lastEntryDate,
  currencyLabel,
  canViewReport,
}: {
  cashBankId: number;
  balance: number;
  entries: number;
  lastEntryDate: string | null;
  currencyLabel: string;
  /** The report has its own permission; without it there is nowhere to go. */
  canViewReport: boolean;
}) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>
          <Icon name="book" size={15} />
        </span>
        <div className="ct">
          <h3>Cash Bank Book</h3>
          <p>
            Saldo resource ini berasal sepenuhnya dari bukunya — tidak disimpan
            pada data master.
          </p>
        </div>
        {canViewReport && (
          <Link
            className="btn sm"
            href={reportHref("cash-bank-ledger", { cashBank: cashBankId })}
          >
            <Icon name="book" size={14} /> Lihat Buku Kas &amp; Bank
          </Link>
        )}
      </div>

      <div className="card-b">
        <div style={{ padding: "5px 0" }}>
          <div className="mrow">
            <span className="k">Saldo saat ini</span>
            <span className="v">
              <span className={`mny big${balance ? "" : " z"}`}>
                {formatMoney(balance, currencyLabel)}
              </span>
            </span>
          </div>
          <div className="mrow">
            <span className="k">Jumlah mutasi</span>
            <span className="v">
              {entries ? `${entries} entri` : <span className="dash">Belum ada mutasi</span>}
            </span>
          </div>
          <div className="mrow">
            <span className="k">Mutasi terakhir</span>
            <span className="v">
              {lastEntryDate ? (
                formatDate(lastEntryDate)
              ) : (
                <span className="dash">—</span>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
