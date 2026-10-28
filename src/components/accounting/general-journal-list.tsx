"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { DocumentHeader } from "@/components/ui/document-header";
import { Pager } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type { GeneralJournalRow } from "@/lib/siba/general-journal-rows";
import { generalJournalIsEditable, type GeneralJournalAbilities } from "@/lib/siba/general-journal-workflow";

/**
 * The Jurnal Umum register. Paged in the browser, like the other documents
 * written by hand rather than by every posting.
 * shortcut: loads every row; page in the database (`register-query`) once it passes ~2.000.
 */
export function GeneralJournalList({ rows, can }: { rows: GeneralJournalRow[]; can: GeneralJournalAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q || `${r.journalNo} ${r.description} ${r.companyLabel}`.toLowerCase().includes(q))
    );
  }, [rows, status, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pages);
  const from = (current - 1) * perPage;
  const pageRows = filtered.slice(from, from + perPage);
  const active = (status ? 1 : 0) + (query ? 1 : 0);
  const clear = () => {
    setStatus("");
    setQuery("");
    setPage(1);
  };

  return (
    <>
      <DocumentHeader
        module="Accounting"
        icon="book"
        title="Jurnal Umum"
        sub="Satu jurnal untuk setiap buku bernilai uang: buku besar, Buku Subjek, dan Kas & Bank."
      >
        {can.create && (
          <Link className="btn primary" href="/accounting/jurnal-umum/new">
            <Icon name="plus" size={15} /> Buat Jurnal Umum
          </Link>
        )}
      </DocumentHeader>

      <div className="card">
        <div className="toolbar">
          <SearchField
            value={query}
            placeholder="Cari nomor atau keterangan…"
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
          />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            ariaLabel="Filter status"
            options={[
              { value: "", label: "Status: semua" },
              ...["Draft", "Posted", "Cancelled"].map((s) => ({ value: s, label: STATUS_TEXT[s] ?? s })),
            ]}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          />
          {active > 0 && (
            <button className="btn sm ghost" onClick={clear}>
              Bersihkan filter ({active})
            </button>
          )}
          <div className="tspace" />
          <span className="count">
            <b>{filtered.length}</b> dari {rows.length} jurnal
          </span>
        </div>

        {filtered.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 38 }}>No</th>
                    <th style={{ width: 110 }}>Nomor</th>
                    <th style={{ width: 104 }}>Tanggal</th>
                    <th>Keterangan</th>
                    <th className="num" style={{ width: 170 }}>
                      Total
                    </th>
                    <th style={{ width: 104 }}>Status</th>
                    <th style={{ width: 88 }} />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => {
                    const href = `/accounting/jurnal-umum/${r.id}`;
                    return (
                      <tr key={r.id} onClick={() => router.push(href)}>
                        <td className="no">{from + i + 1}</td>
                        <td>
                          <Link href={href}>
                            <span className="lab">{r.journalNo}</span>
                          </Link>
                        </td>
                        <td>{r.accountingDate ? formatDate(r.accountingDate) : <span className="dash">—</span>}</td>
                        <td className="pri">
                          <span className="dstack">
                            <span className="d1">{r.description}</span>
                            <span className="d2">
                              {r.companyLabel} · {r.lineCount} baris
                            </span>
                          </span>
                        </td>
                        <td className="num">
                          <Amount value={r.amount} currency={BASE_CURRENCY_LABEL} />
                        </td>
                        <td>
                          <span className={`bdg ${STATUS_CLASS[r.status] ?? "s-mute"}`}>
                            {STATUS_TEXT[r.status] ?? r.status}
                          </span>
                        </td>
                        <td className="acts">
                          <span className="ract">
                            <Link className="iact" href={href} title="Lihat detail" onClick={(e) => e.stopPropagation()}>
                              <Icon name="eye" size={15} />
                            </Link>
                            {can.edit && generalJournalIsEditable(r.status) ? (
                              <Link
                                className="iact"
                                href={`${href}/edit`}
                                title="Ubah"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Icon name="pen" size={15} />
                              </Link>
                            ) : (
                              <span className="sp" />
                            )}
                            <span className="sp" />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager
              page={current}
              pages={pages}
              total={filtered.length}
              perPage={perPage}
              onPage={setPage}
              onPerPage={(n) => {
                setPerPage(n);
                setPage(1);
              }}
            />
          </>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name={rows.length ? "srch" : "book"} size={20} />
            </div>
            <h4>{rows.length ? "Tidak ada jurnal yang cocok" : "Belum ada Jurnal Umum"}</h4>
            <p>
              {rows.length
                ? "Ubah kata kunci atau bersihkan filter yang sedang aktif."
                : "Jurnal Umum mencatat penyesuaian, reklasifikasi, dan koreksi pada buku besar, Buku Subjek, dan Kas & Bank sekaligus."}
            </p>
            <div className="cta">
              {rows.length ? (
                <button className="btn" onClick={clear}>
                  Bersihkan filter
                </button>
              ) : (
                can.create && (
                  <Link className="btn primary" href="/accounting/jurnal-umum/new">
                    <Icon name="plus" size={15} /> Buat Jurnal Umum
                  </Link>
                )
              )}
            </div>
          </div>
        )}
      </div>

      <p className="foot-note">Total adalah sisi debit dalam {BASE_CURRENCY_LABEL}, termasuk baris Selisih Kurs.</p>
    </>
  );
}
