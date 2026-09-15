import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import type { LedgerEntryRow } from "@/lib/siba/cash-bank";

/**
 * A resource's Cash Bank Book, shown under its detail.
 *
 * The book is append-only: there is nothing to edit here and no delete, because
 * a record of money that can be rewritten is not a record of anything. A
 * mistake is corrected by a further entry, and both remain visible.
 */
const TYPE_TEXT: Record<string, string> = {
  Opening: "Saldo Awal",
  Transaction: "Transaksi",
  Adjustment: "Penyesuaian",
};

const TYPE_CLASS: Record<string, string> = {
  Opening: "t-slate",
  Transaction: "t-info",
  Adjustment: "t-vio",
};

export function CashBankBook({
  entries,
  balance,
  currencyLabel,
}: {
  entries: LedgerEntryRow[];
  balance: number;
  currencyLabel: string;
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
            Catatan mutasi resource ini · saldo{" "}
            <b>{formatMoney(balance, currencyLabel)}</b>
          </p>
        </div>
      </div>

      {entries.length ? (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 104 }}>Nomor</th>
                <th style={{ width: 118 }}>Tanggal</th>
                <th style={{ width: 118 }}>Jenis</th>
                <th>Keterangan</th>
                <th className="num" style={{ width: 150 }}>
                  Mutasi
                </th>
                <th className="num" style={{ width: 150 }}>
                  Saldo
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={{ cursor: "default" }}>
                  <td>
                    <span className="lab">{e.entryNo}</span>
                  </td>
                  <td className="mono mut" style={{ fontSize: "11.5px" }}>
                    {formatDate(e.date)}
                  </td>
                  <td>
                    <span className={`bdg ${TYPE_CLASS[e.type] ?? "t-slate"}`}>
                      {TYPE_TEXT[e.type] ?? e.type}
                    </span>
                  </td>
                  <td className="mut wrapok">{e.note ?? <span className="dash">—</span>}</td>
                  <td className="num">
                    <span className={`mny${e.movement < 0 ? "" : " in"}`}>
                      {e.movement < 0 ? "−" : "+"}
                      {formatMoney(Math.abs(e.movement), currencyLabel)}
                    </span>
                  </td>
                  <td className="num">
                    <span className={`mny${e.balanceAfter ? "" : " z"}`}>
                      {formatMoney(e.balanceAfter, currencyLabel)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty" style={{ padding: "30px 20px" }}>
          <div className="ic">
            <Icon name="book" size={20} />
          </div>
          <h4>Belum ada mutasi</h4>
          <p>
            Resource ini dibuat tanpa saldo awal. Mutasi akan tercatat begitu
            transaksi kas dan bank mulai diposting.
          </p>
        </div>
      )}
    </div>
  );
}
