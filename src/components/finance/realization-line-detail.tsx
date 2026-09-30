"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { isBaseCurrency } from "@/lib/siba/currency";
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
  item: OpenItemOption | null;
  /** How this line moves its subject book, where one is known. */
  itemRole: "lowers" | "opens" | null;
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

      {line.itemRole === "lowers" && (
        <div className="apsum" style={{ marginTop: 12 }}>
          <div className="full">
            <span>Open item yang diselesaikan</span>
            <b>
              {line.item ? (
                `${line.item.itemNo} ${line.item.note ?? ""}`
              ) : (
                "Belum dipilih"
              )}
            </b>
          </div>
          {line.item && (
            <>
              <div>
                <span>Tanggal item</span>
                <b>{formatDate(line.item.date)}</b>
              </div>
              <div>
                <span>{foreign ? "Kurs item" : "Sisa item"}</span>
                <b className="mono">
                  {foreign ? formatRate(line.item.rate) : money(line.item.remaining)}
                </b>
              </div>
              {foreign && (
                <div className="full">
                  <span>Sisa item</span>
                  <b className="mono">{money(line.item.remaining)}</b>
                </div>
              )}
            </>
          )}
        </div>
      )}

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
              {line.itemRole === "opens"
                ? "membuka open item baru"
                : line.item
                  ? `menyelesaikan ${line.item.itemNo}`
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
