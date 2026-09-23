"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CompanyFilter, NoCompanyAccess } from "@/components/master/company-filter";
import { SearchField } from "@/components/ui/search-field";
import { formatDate, formatMoney } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import type { Company } from "@/lib/siba/company-access";
import type { OpeningBalanceRow } from "@/lib/siba/opening-balance";

/**
 * The Opening Balance register.
 *
 * Read-only, and there is no button anywhere on it: a snapshot is written by a
 * fiscal year's close, or injected by a developer before the application has
 * any history of its own. Nothing here creates one and nothing edits one.
 *
 * One Company at a time, named by the picker in the toolbar. Each Company
 * numbers its own chart of accounts, so a register holding both would read as
 * one set of duplicated rows — the same reason the Journal register and the
 * Chart of Accounts tree each show one.
 *
 * Each row states both sides, which are always equal: the writer refuses an
 * unbalanced snapshot, because what remains once the profit and loss has been
 * closed out is a balance sheet. A row where they disagree means something
 * wrote the table from outside the application, and the row says so rather
 * than showing two numbers and leaving the reader to notice.
 */
export function OpeningBalanceList({
  openings,
  companies,
  companyId,
}: {
  openings: OpeningBalanceRow[];
  /** The Companies this reader may choose between. */
  companies: Company[];
  /** The one being shown, or null when the reader may see none. */
  companyId: number | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!q) return openings;
    return openings.filter(
      (o) =>
        o.openingNo.toLowerCase().includes(q) ||
        o.fiscalYearName.toLowerCase().includes(q) ||
        o.fiscalYearLabel.toLowerCase().includes(q)
    );
  }, [openings, q]);

  const cents = (n: number) => Math.round(n * 100);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Accounting</span>
          <span>/</span>
          <span className="cur">Opening Balance</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="file" size={16} />
            </span>
            Opening Balance
          </h1>
          <div className="ph-act" />
        </div>
        <p className="ph-sub">
          Posisi setiap account pada awal tahun buku, satu dokumen per Company
          per tahun. Dokumen bersifat final: ditulis oleh penutupan tahun buku,
          tidak pernah diubah, dan tidak diisi melalui aplikasi.
        </p>
      </div>

      {companyId == null ? (
        <div className="card">
          <NoCompanyAccess what="Opening Balance" />
        </div>
      ) : (
        <div className="card">
          <div className="toolbar">
            <CompanyFilter options={companies} selectedId={companyId} />
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Cari nomor dokumen atau tahun buku…"
            />
            <span className="count">
              <b>{rows.length}</b> dokumen
            </span>
          </div>

          {rows.length ? (
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 118 }}>Nomor</th>
                    <th style={{ width: 106 }}>Tanggal</th>
                    <th>Tahun Buku</th>
                    <th style={{ width: 150 }}>Sumber</th>
                    <th className="num" style={{ width: 64 }}>
                      Baris
                    </th>
                    <th className="num" style={{ width: 150 }}>
                      Debit
                    </th>
                    <th className="num" style={{ width: 150 }}>
                      Kredit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => {
                    const balanced = cents(o.debit) === cents(o.credit);
                    return (
                      <tr
                        key={o.id}
                        onClick={() =>
                          router.push(`/accounting/opening-balance/${o.id}`)
                        }
                        style={{ cursor: "pointer" }}
                      >
                        <td>
                          <Link
                            className="lab"
                            href={`/accounting/opening-balance/${o.id}`}
                          >
                            {o.openingNo}
                          </Link>
                        </td>
                        <td>{formatDate(o.postingDate)}</td>
                        <td className="pri">{o.fiscalYearName}</td>
                        {/* A snapshot a close produced names the year it came
                            from. One with nothing behind it was injected at
                            go-live, and saying so is the only thing that tells
                            the two apart. */}
                        <td className="mut">
                          {o.sourceFiscalYearLabel
                            ? `Penutupan ${o.sourceFiscalYearLabel}`
                            : "Saldo awal go-live"}
                        </td>
                        <td className="num">{o.lineCount}</td>
                        <td className="num">
                          {formatMoney(o.debit, BASE_CURRENCY_LABEL)}
                        </td>
                        <td className="num">
                          {formatMoney(o.credit, BASE_CURRENCY_LABEL)}
                          {!balanced && (
                            <span className="bdg s-bad" style={{ marginLeft: 6 }}>
                              Tidak seimbang
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <div className="ic">
                <Icon name="file" size={20} />
              </div>
              <h4>{q ? "Tidak ada yang cocok" : "Belum ada Opening Balance"}</h4>
              <p>
                {q
                  ? "Tidak ada dokumen yang mengandung kata kunci tersebut."
                  : "Opening Balance terbentuk saat sebuah tahun buku ditutup. Saldo awal pertama — sebelum aplikasi punya riwayat — dimasukkan langsung ke database."}
              </p>
              {q && (
                <div className="cta">
                  <button className="btn" onClick={() => setQuery("")}>
                    Bersihkan pencarian
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
