import { Icon } from "@/components/icon";
import { ReportSummary } from "@/components/report/report-summary";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "@/lib/siba/currency";
import type { SubledgerItemRow } from "@/lib/siba/subledger";
import type { SubledgerDef } from "@/lib/siba/subledger-catalogue";

/**
 * One block per Partner and currency, listing the open items its position is
 * made of.
 *
 * An item is one movement that raised the position, kept at the kurs it was
 * raised at. Two receipts at 15.000 and 13.000 stay two items, so the table is
 * keyed on the item — its number, its date and the words it was raised under —
 * with the kurs as an attribute of that event. That is why a line settling the
 * position picks an item and not a rate.
 *
 * Only open items are listed: a cleared item has nothing left to settle, and
 * its movements stay on the Buku Subjek. A server component: it only reads.
 */
export function SubledgerItemReport({
  book,
  items,
}: {
  book: SubledgerDef;
  items: SubledgerItemRow[];
}) {
  if (!items.length) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name="layers" size={20} />
        </div>
        <h4>Tidak ada open item</h4>
        <p>
          Tidak ada posisi {book.name.replace(/^Buku /, "")} yang masih terbuka
          untuk Partner yang dipilih.
        </p>
      </div>
    );
  }

  const blocks = new Map<string, SubledgerItemRow[]>();
  for (const i of items) {
    const k = `${i.partnerId}:${i.currencyId}`;
    blocks.set(k, [...(blocks.get(k) ?? []), i]);
  }

  return (
    <>
      <div className="rhead">
        <span className="count">
          <b>{items.length}</b> open item · <b>{blocks.size}</b> posisi
        </span>
      </div>

      {[...blocks.values()].map((rows) => {
        const head = rows[0];
        const foreign = !isBaseCurrency(head.currencyLabel);
        const remaining = rows.reduce((t, r) => t + r.remaining, 0);
        const baseRemaining = rows.reduce((t, r) => t + r.baseRemaining, 0);
        const broken = rows.some((r) => !r.reconciles);
        return (
          <div className="cblock" key={`${head.partnerId}:${head.currencyId}`}>
            <div className="cbh">
              <b>{head.partnerLabel}</b>
              <span className="cbn">
                {head.partnerName} · {head.currencyLabel}
              </span>
              {broken && (
                <span className="rwarn">
                  <Icon name="warn" size={11} />
                  Item ≠ entri buku
                </span>
              )}
              <ReportSummary
                figures={[
                  {
                    label: "Open item",
                    value: String(rows.length),
                  },
                  {
                    label: `Sisa ${head.currencyLabel}`,
                    value: formatMoney(remaining, head.currencyLabel),
                    key: !foreign,
                  },
                  ...(foreign
                    ? [
                        {
                          label: `Nilai ${BASE_CURRENCY_LABEL}`,
                          value: formatMoney(baseRemaining, BASE_CURRENCY_LABEL),
                          key: true,
                        },
                      ]
                    : []),
                ]}
              />
            </div>

            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 92 }}>Tanggal</th>
                    <th style={{ width: 96 }}>Item</th>
                    <th>Keterangan</th>
                    {foreign && (
                      <th className="num" style={{ width: 110 }}>
                        Kurs
                      </th>
                    )}
                    <th className="num" style={{ width: 130 }}>
                      Awal
                    </th>
                    <th className="num" style={{ width: 130 }}>
                      Sisa
                    </th>
                    {foreign && (
                      <th className="num" style={{ width: 136 }}>
                        Nilai {BASE_CURRENCY_LABEL}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="mono mut" style={{ fontSize: "11.5px" }}>
                        {formatDate(r.date)}
                      </td>
                      <td>
                        <span className="lab">{r.itemNo}</span>
                      </td>
                      <td className="pri wrapok">{r.note ?? "—"}</td>
                      {foreign && <td className="num">{formatRate(r.rate)}</td>}
                      <td className="num">
                        {formatMoney(r.original, head.currencyLabel)}
                      </td>
                      <td className="num">
                        <span className="mny">
                          {formatMoney(r.remaining, head.currencyLabel)}
                        </span>
                      </td>
                      {foreign && (
                        <td className="num">
                          <span className="mny">
                            {formatMoney(r.baseRemaining, BASE_CURRENCY_LABEL)}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="totrow">
                    <td colSpan={foreign ? 5 : 4} style={{ textAlign: "right" }}>
                      Total open item
                    </td>
                    <td className="num">
                      {formatMoney(remaining, head.currencyLabel)}
                    </td>
                    {foreign && (
                      <td className="num">
                        {formatMoney(baseRemaining, BASE_CURRENCY_LABEL)}
                      </td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>

            {broken && (
              <div className="cbnone">
                Sisa sebuah open item tidak sama dengan jumlah entri buku yang
                menunjuknya. Itu masalah sistem, bukan kesalahan input.
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
