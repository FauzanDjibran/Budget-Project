"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "@/lib/siba/currency";
import { STATUS_TEXT } from "@/lib/siba/entities";
import type { BudgetMapping } from "@/lib/siba/budget";
import type { OpenItemOption } from "@/lib/siba/finance";

/** Everything a Realisasi line knows about itself, whichever mode it is in. */
export type RealizationLineDetail = {
  budgetId: number;
  budgetNo: string;
  budgetDate: string;
  description: string;
  /** Shown once the document is saved; a draft line's Budget is always Open. */
  budgetStatus: string | null;
  category: string;
  partner: string | null;
  account: BudgetMapping | null;
  budgetAmount: number | null;
  realizedAmount: number | null;
  outstanding: number;
  /** Held by other Draft documents — informational, not yet realized. */
  draftAllocated: number;
  amount: number;
  /**
   * The open items the line settles, each for its own amount. `fxDifference`
   * is signed as a gain and known once posted; null on a draft.
   */
  items: { item: OpenItemOption; amount: number; fxDifference: number | null }[];
  /** How this line moves its subject book, where one is known. */
  itemRole: "lowers" | "opens" | "records" | null;
};

/**
 * Rincian Budget — what a Realisasi line settles and what Post will write for
 * it.
 *
 * The line keeps only what the user acts on: the Budget, its open item, what
 * is outstanding and what this document realizes. Everything that helps check
 * the line but is not typed into it — the plan's own figures, the account its
 * classification posts to, the item's kurs — lives here, one click away, so the
 * table stays readable at the width a mouse-first operator actually has.
 */
export function RealizationLineDialog({
  line,
  currencyLabel,
  cashBankLabel,
  onClose,
}: {
  line: RealizationLineDetail;
  currencyLabel: string;
  /** Null on the funded route, where the induk chooses the resource. */
  cashBankLabel: string | null;
  onClose: () => void;
}) {
  const money = (n: number) => formatMoney(n, currencyLabel);
  const foreign = !isBaseCurrency(currencyLabel);
  const over = line.amount > line.outstanding;

  return (
    <Dialog
      open
      icon="clip"
      width={640}
      title={`Rincian ${line.budgetNo}`}
      subtitle={line.description}
      onClose={onClose}
      foot={
        <>
          <Link className="btn" href={`/budget/budget/${line.budgetId}`}>
            <Icon name="eye" size={14} /> Buka Budget
          </Link>
          <button className="btn primary" onClick={onClose}>
            Tutup
          </button>
        </>
      }
    >
      <div className="apsum">
        <div>
          <span>Tanggal Budget</span>
          <b>{formatDate(line.budgetDate)}</b>
        </div>
        <div>
          <span>Status Budget</span>
          <b>
            {line.budgetStatus
              ? STATUS_TEXT[line.budgetStatus] ?? line.budgetStatus
              : "Open"}
          </b>
        </div>
        <div>
          <span>Category</span>
          <b>{line.category}</b>
        </div>
        <div>
          <span>Partner</span>
          <b>{line.partner ?? "Tanpa Partner"}</b>
        </div>
        <div className="full">
          <span>Account posting</span>
          <b>
            {line.account ? (
              `${line.account.accountLabel} ${line.account.accountName}`
            ) : (
              "Belum dipetakan"
            )}
          </b>
        </div>
      </div>

      {!line.account && (
        <div className="apmap warn">
          <Icon name="warn" size={13} />
          Post ditolak sampai kombinasi Company × Category × Partner Category ini
          dipetakan ke account.
        </div>
      )}

      <div className="apsum" style={{ marginTop: 12 }}>
        <div>
          <span>Nominal Budget</span>
          <b className="mono">
            {line.budgetAmount == null ? "—" : money(line.budgetAmount)}
          </b>
        </div>
        <div>
          <span>Sudah Direalisasi</span>
          <b className="mono">
            {line.realizedAmount == null ? "—" : money(line.realizedAmount)}
          </b>
        </div>
        <div>
          <span>Outstanding</span>
          <b className="mono">{money(line.outstanding)}</b>
        </div>
        <div className="amt">
          <span>Realisasi dokumen ini</span>
          <b>{money(line.amount)}</b>
        </div>
        {line.draftAllocated > 0 && (
          <div className="full">
            <span>Dialokasikan dokumen Draft lain</span>
            <b className="mono">{money(line.draftAllocated)}</b>
          </div>
        )}
      </div>

      {over && (
        <div className="apmap warn">
          <Icon name="warn" size={13} />
          Realisasi melebihi outstanding sebesar{" "}
          {money(line.amount - line.outstanding)}. Diizinkan, dan Budget ditutup
          saat Post.
        </div>
      )}

      {line.itemRole === "lowers" &&
        (line.items.length ? (
          <div className="tw boxed" style={{ marginTop: 12 }}>
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 92 }}>Open item</th>
                  <th style={{ width: 92 }}>Tanggal</th>
                  {foreign && (
                    <th className="num" style={{ width: 100 }}>
                      Kurs
                    </th>
                  )}
                  <th className="num">Diselesaikan</th>
                  {foreign && <th className="num">Selisih kurs</th>}
                </tr>
              </thead>
              <tbody>
                {line.items.map((it) => (
                  <tr key={it.item.id}>
                    <td>
                      <span className="lab">{it.item.itemNo}</span>
                    </td>
                    <td className="mut">{formatDate(it.item.date)}</td>
                    {foreign && <td className="num">{formatRate(it.item.rate)}</td>}
                    <td className="num">
                      <span className="mny">{money(it.amount)}</span>
                    </td>
                    {foreign && (
                      <td className="num">
                        {it.fxDifference == null ? (
                          <span className="dash" title="Dinilai saat Post">—</span>
                        ) : it.fxDifference === 0 ? (
                          <span className="mny z">{formatMoney(0, BASE_CURRENCY_LABEL)}</span>
                        ) : (
                          <span className={`mny${it.fxDifference < 0 ? " neg" : ""}`}>
                            {formatMoney(Math.abs(it.fxDifference), BASE_CURRENCY_LABEL)}{" "}
                            {it.fxDifference > 0 ? "laba" : "rugi"}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="apmap warn">
            <Icon name="warn" size={13} />
            Open item yang diselesaikan belum dipilih.
          </div>
        ))}

      <div className="impact" style={{ marginTop: 12 }}>
        <div className="ttl">Saat Post</div>
        <div className="ir">
          <span>Buku Kas &amp; Bank{cashBankLabel ? ` ${cashBankLabel}` : ""}</span>
          <b>1 entri</b>
        </div>
        {line.itemRole && (
          <div className="ir">
            <span>Buku Subjek {line.category}</span>
            <b>
              {line.itemRole === "records"
                ? "bertambah — dicatat per Partner"
                : line.itemRole === "opens"
                ? "membuka open item baru"
                : line.items.length
                  ? `${line.items.length} entri — menyelesaikan ${line.items
                      .map((it) => it.item.itemNo)
                      .join(", ")}`
                  : "menunggu open item"}
            </b>
          </div>
        )}
        <div className="ir">
          <span>Journal, sisi lawan kas</span>
          <b>{line.account ? line.account.accountLabel : "belum dipetakan"}</b>
        </div>
      </div>
    </Dialog>
  );
}
