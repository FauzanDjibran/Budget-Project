"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CompanyFilter, NoCompanyAccess } from "@/components/master/company-filter";
import { SearchField } from "@/components/ui/search-field";
import { formatDate, formatMoney } from "@/lib/format";
import type { Company } from "@/lib/siba/company-access";
import type { JournalRow } from "@/lib/siba/journal";

/**
 * The Journal register.
 *
 * Read-only by construction: a journal is written by a posting and is never
 * edited, deleted or reversed afterwards, so this list carries no create
 * button and no row actions beyond opening the entry. A correction is a new
 * business transaction, which produces a new journal of its own.
 *
 * One Company at a time, named by the picker in the toolbar. Each Company
 * keeps its own books, so a register holding both reads as duplicated rows —
 * and with the Company stated once above the table, the column that repeated
 * that same label on every row earned nothing.
 *
 * Each row states both sides. They are always equal — `postJournal` refuses to
 * write a journal whose debits and credits differ — so a row where they are not
 * means something wrote the tables outside the application, and the row says so
 * rather than quietly showing two numbers.
 */
export function JournalList({
  journals,
  companies,
  companyId,
}: {
  journals: JournalRow[];
  /** The Companies this reader may choose between. */
  companies: Company[];
  /** The one being shown, or null when the reader may see none. */
  companyId: number | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!q) return journals;
    return journals.filter(
      (j) =>
        j.journalNo.toLowerCase().includes(q) ||
        j.description.toLowerCase().includes(q)
    );
  }, [journals, q]);

  const cents = (n: number) => Math.round(n * 100);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Accounting</span>
          <span>/</span>
          <span className="cur">Journal</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="book" size={16} />
            </span>
            Journal
            <span className="bdg t-slate">Append-only</span>
          </h1>
          <div className="ph-act" />
        </div>
        <p className="ph-sub">
          Journal akuntansi dibuat otomatis setiap kali dokumen diposting, dan
          tidak dapat diubah, dihapus, atau dibalik. Koreksi dilakukan dengan
          transaksi baru yang menghasilkan journal baru.
        </p>
      </div>

      {/* No Company open to this reader means nothing to filter or search, so
          the card carries the refusal alone rather than an empty table that
          would read as "belum ada journal". */}
      {companyId == null ? (
        <div className="card">
          <NoCompanyAccess what="Journal" />
        </div>
      ) : (
      <div className="card">
        <div className="toolbar">
          <CompanyFilter options={companies} selectedId={companyId} />
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Cari nomor journal atau keterangan…"
          />
          <span className="count">
            <b>{rows.length}</b> journal
          </span>
        </div>

        {rows.length ? (
          <div className="tw">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 118 }}>Nomor</th>
                  <th style={{ width: 106 }}>Tanggal Posting</th>
                  <th>Keterangan</th>
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
                {rows.map((j) => {
                  const balanced = cents(j.debit) === cents(j.credit);
                  return (
                    <tr
                      key={j.id}
                      onClick={() => router.push(`/accounting/journal/${j.id}`)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <Link className="lab" href={`/accounting/journal/${j.id}`}>
                          {j.journalNo}
                        </Link>
                      </td>
                      <td>{formatDate(j.postingDate)}</td>
                      <td className="pri">{j.description}</td>
                      <td className="mut">{j.sourceDocLabel ?? "—"}</td>
                      <td className="num">{j.lineCount}</td>
                      <td className="num">{formatMoney(j.debit, "")}</td>
                      <td className="num">
                        {formatMoney(j.credit, "")}
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
              <Icon name="book" size={20} />
            </div>
            <h4>{q ? "Tidak ada yang cocok" : "Belum ada journal"}</h4>
            <p>
              {q
                ? "Tidak ada journal yang mengandung kata kunci tersebut."
                : "Journal terbentuk otomatis saat dokumen Finance diposting. Posting sebuah Cash Bank Transaction untuk melihat journal pertama."}
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
