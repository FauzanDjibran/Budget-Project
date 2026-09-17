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
import type { JournalRow } from "@/lib/siba/journal";
import {
  JOURNAL_STATUS_BADGE,
  type JournalAbilities,
  type JournalStatus,
} from "@/lib/siba/journal-workflow";

/**
 * The Journal register — every journal, however it came to exist.
 *
 * Most are written by a document being posted and are `Posted` the moment they
 * exist; they are never edited, deleted or reversed, and a correction is a new
 * business transaction producing a journal of its own. A **manual** journal is
 * the other kind: typed here, saved as a Draft, and posted through the same
 * engine. Drafts sort to the top, because they are the only rows anybody still
 * has something to do about.
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
  can,
}: {
  journals: JournalRow[];
  /** The Companies this reader may choose between. */
  companies: Company[];
  /** The one being shown, or null when the reader may see none. */
  companyId: number | null;
  can: JournalAbilities;
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
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/accounting/journal/new">
                <Icon name="plus" size={15} /> Journal Manual
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Journal dari posting dokumen bersifat final dan tidak dapat diubah.
          Journal manual — penyusutan, akrual, reklasifikasi — disimpan sebagai
          Draft lebih dulu dan masuk buku besar saat diposting.
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
                  <th style={{ width: 96 }}>Status</th>
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
                      <td>
                        <span
                          className={`bdg ${
                            JOURNAL_STATUS_BADGE[j.status as JournalStatus] ??
                            "s-mute"
                          }`}
                        >
                          {j.status}
                        </span>
                      </td>
                      <td>
                        {j.postingDate ? (
                          formatDate(j.postingDate)
                        ) : (
                          <span className="dash">—</span>
                        )}
                      </td>
                      <td className="pri">{j.description}</td>
                      {/* A manual journal has no source document — it is the
                          source. Saying so in the same column keeps the two
                          kinds readable without a column of its own. */}
                      <td className="mut">
                        {j.sourceDocLabel ?? (j.isManual ? "Manual" : "—")}
                      </td>
                      <td className="num">{j.lineCount}</td>
                      <td className="num">{formatMoney(j.debit, BASE_CURRENCY_LABEL)}</td>
                      <td className="num">
                        {formatMoney(j.credit, BASE_CURRENCY_LABEL)}
                        {!balanced && j.status === "Posted" && (
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
                : "Journal terbentuk otomatis saat dokumen Finance diposting, atau dibuat sendiri sebagai Journal Manual."}
            </p>
            {q ? (
              <div className="cta">
                <button className="btn" onClick={() => setQuery("")}>
                  Bersihkan pencarian
                </button>
              </div>
            ) : (
              can.create && (
                <div className="cta">
                  <Link className="btn primary" href="/accounting/journal/new">
                    <Icon name="plus" size={15} /> Journal Manual
                  </Link>
                </div>
              )
            )}
          </div>
        )}
      </div>
      )}
    </>
  );
}
