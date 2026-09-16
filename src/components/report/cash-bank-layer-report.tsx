import { Icon } from "@/components/icon";
import { ReportSummary } from "@/components/report/report-summary";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import type { LayerReport as Report } from "@/lib/siba/cash-bank-layers";

/**
 * One block per foreign-currency resource, listing the rate layers it holds.
 *
 * A layer is a parcel of currency bought at a known price. Two receipts at the
 * same kurs stay two layers, so the table is keyed on the acquisition — date,
 * sequence and the document that brought it in — with the rate as an attribute
 * of that event rather than as the thing being listed. That is the whole reason
 * a user picks a layer and not a rate: with three layers at 15.000, "the
 * 15.000" names none of them.
 *
 * **Exhausted layers stay on the report.** A layer that has been spent is part
 * of how the account reached the position it is in, and dropping it would leave
 * a report that cannot explain its own closing figure. It is simply never
 * offered as something to spend.
 *
 * The weighted average at the foot of each block is **reporting only**. It
 * values nothing, it is never an input, and it will generally equal no rate
 * anyone transacted at — which is precisely why the choice is the user's.
 *
 * A server component: it only reads.
 */
export function CashBankLayerReport({ report }: { report: Report }) {
  if (!report.blocks.length) {
    return (
      <div className="empty">
        <div className="ic">
          <Icon name="layers" size={20} />
        </div>
        <h4>Belum ada resource mata uang asing</h4>
        <p>
          Layer kurs hanya dimiliki resource dalam mata uang selain{" "}
          {BASE_CURRENCY_LABEL}. Resource {BASE_CURRENCY_LABEL} memegang mata
          uang dasar itu sendiri, jadi tidak ada kurs yang perlu dipilih.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rhead">
        <span className="count">
          <b>{report.blocks.length}</b> resource mata uang asing
        </span>
      </div>

      {report.blocks.map((b) => (
        <div className="cblock" key={b.cashBankId}>
          <div className="cbh">
            <b>{b.label}</b>
            <span className="cbn">
              {b.name} · {b.companyLabel} · {b.currencyLabel}
              {b.active ? "" : " · non-aktif"}
            </span>
            {!b.reconciles && (
              <span className="rwarn">
                <Icon name="warn" size={11} />
                Layer ≠ saldo buku
              </span>
            )}
            <ReportSummary
              figures={[
                {
                  label: "Kurs rata-rata",
                  value:
                    b.averageRate == null
                      ? "—"
                      : formatRate(b.averageRate),
                  zero: b.averageRate == null,
                },
                {
                  label: `Sisa ${b.currencyLabel}`,
                  value: formatMoney(b.foreignRemaining, b.currencyLabel),
                  zero: !b.foreignRemaining,
                },
                {
                  label: `Nilai ${BASE_CURRENCY_LABEL}`,
                  value: formatMoney(b.baseRemaining, BASE_CURRENCY_LABEL),
                  key: true,
                },
              ]}
            />
          </div>

          <div className="tw">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 92 }}>Perolehan</th>
                  <th style={{ width: 104 }}>Layer</th>
                  <th>Asal</th>
                  <th className="num" style={{ width: 110 }}>
                    Kurs
                  </th>
                  <th className="num" style={{ width: 122 }}>
                    Diperoleh
                  </th>
                  <th className="num" style={{ width: 122 }}>
                    Sisa
                  </th>
                  <th className="num" style={{ width: 136 }}>
                    Nilai {BASE_CURRENCY_LABEL}
                  </th>
                </tr>
              </thead>
              <tbody>
                {b.layers.map((l) => {
                  const spent = l.status !== "Open";
                  return (
                    <tr key={l.id} className={spent ? "mut" : undefined}>
                      <td className="mono mut" style={{ fontSize: "11.5px" }}>
                        {formatDate(l.date)}
                      </td>
                      <td>
                        <span className="lab">{l.layerNo}</span>
                      </td>
                      <td className="pri wrapok">
                        {l.note ?? "—"}
                        {spent && (
                          <span className="rsub">
                            {l.status === "Exhausted"
                              ? "habis terpakai"
                              : "ditutup oleh revaluasi"}
                          </span>
                        )}
                      </td>
                      <td className="num">{formatRate(l.rate)}</td>
                      <td className="num">
                        {formatMoney(l.foreignOriginal, b.currencyLabel)}
                      </td>
                      <td className="num">
                        {l.foreignRemaining ? (
                          <span className="mny">
                            {formatMoney(l.foreignRemaining, b.currencyLabel)}
                          </span>
                        ) : (
                          <span className="dash">–</span>
                        )}
                      </td>
                      <td className="num">
                        {l.baseRemaining ? (
                          <span className="mny">
                            {formatMoney(l.baseRemaining, BASE_CURRENCY_LABEL)}
                          </span>
                        ) : (
                          <span className="dash">–</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {b.layers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="mut" style={{ textAlign: "center" }}>
                      Resource ini belum memegang currency. Layer terbentuk saat
                      saldo awal diisi atau saat currency masuk.
                    </td>
                  </tr>
                )}
              </tbody>
              {b.layers.length > 0 && (
                <tfoot>
                  <tr className="totrow">
                    <td colSpan={5} style={{ textAlign: "right" }}>
                      Total layer terbuka
                    </td>
                    <td className="num">
                      {formatMoney(b.foreignRemaining, b.currencyLabel)}
                    </td>
                    <td className="num">
                      {formatMoney(b.baseRemaining, BASE_CURRENCY_LABEL)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {!b.reconciles && (
            <div className="cbnone">
              Jumlah layer terbuka tidak sama dengan saldo pada Cash Bank Book.
              Saldo sebuah resource mata uang asing adalah jumlah layer-nya —
              selisih di sini berarti ada yang menulis salah satu tanpa yang
              lain, dan itu masalah sistem, bukan kesalahan input.
            </div>
          )}
        </div>
      ))}
    </>
  );
}
