"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { DocumentHeader } from "@/components/ui/document-header";
import { Pager } from "@/components/ui/pager";
import { useRegisterParams } from "@/components/ui/use-register-params";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { CompanyFilter, NoCompanyAccess } from "@/components/master/company-filter";
import { formatDate } from "@/lib/format";
import type { Company } from "@/lib/siba/company-access";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type { JournalRow } from "@/lib/siba/journal";
import type { Paged } from "@/lib/siba/register-query";
import {
  generalJournalIsEditable,
  type GeneralJournalAbilities,
  type GeneralJournalStatus,
} from "@/lib/siba/general-journal-workflow";

const STATUSES: GeneralJournalStatus[] = ["Draft", "Posted", "Cancelled"];


/**
 * The Journal register — every journal, however it came to exist.
 *
 * Most are written by a document being posted and are `Posted` the moment they
 * exist; they are never edited, deleted or reversed. A **typed** journal is
 * the other kind: saved as a Draft and posted from its own page, behind its
 * journal preview, so no row here posts one. Drafts sort to the
 * top, because they are the only rows anybody still has something to do about.
 *
 * Laid out like every other document register: a `No` column, the `Status:`
 * and `Sumber:` facets in the toolbar, the count on the right, and the row's
 * actions in fixed icon columns. One Company at a time, named by the picker —
 * each Company keeps its own books, so a register holding both would read as
 * duplicated rows.
 *
 * Each row states both sides. They are always equal on a posted journal —
 * `postJournal` refuses one whose debits and credits differ — so a row where
 * they are not says so under the figure rather than quietly showing two
 * numbers. A draft may differ; it is not in the books yet.
 */
export function JournalList({
  journals,
  companies,
  companyId,
  can,
}: {
  /** One page, or null when the reader may see no Company. */
  journals: Paged<JournalRow> | null;
  /** The Companies this reader may choose between. */
  companies: Company[];
  /** The one being shown, or null when the reader may see none. */
  companyId: number | null;
  can: GeneralJournalAbilities;
}) {
  const router = useRouter();
  const reg = useRegisterParams();
  const origin = reg.param("origin");

  const rows = journals?.rows ?? [];
  const activeFilters = [reg.status, origin, reg.q].filter(Boolean).length;
  const clearAll = () => reg.clear("origin");

  const cents = (n: number) => Math.round(n * 100);

  return (
    <>
      <DocumentHeader
        module="Accounting"
        icon="book"
        title="Journal"
        sub="Journal dari posting dokumen bersifat final; journal yang diketik disimpan sebagai Draft dan masuk buku besar saat diposting."
      >
        {can.create && (
          <Link className="btn primary" href="/accounting/journal/new">
            <Icon name="plus" size={15} /> Journal
          </Link>
        )}
      </DocumentHeader>

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
              value={reg.search.value}
              onChange={reg.search.onChange}
              placeholder="Cari nomor journal atau keterangan…"
            />
            <Select
              variant="toolbar"
              value={reg.status}
              set={Boolean(reg.status)}
              ariaLabel="Filter status"
              options={[
                { value: "", label: "Status: semua" },
                ...STATUSES.map((s) => ({ value: s, label: STATUS_TEXT[s] ?? s })),
              ]}
              onChange={reg.setStatus}
            />
            <Select
              variant="toolbar"
              value={origin}
              set={Boolean(origin)}
              ariaLabel="Filter sumber"
              options={[
                { value: "", label: "Sumber: semua" },
                { value: "manual", label: "Manual" },
                { value: "auto", label: "Otomatis" },
              ]}
              onChange={(v) => reg.setParam("origin", v)}
            />
            {activeFilters > 0 && (
              <button className="btn sm ghost" onClick={clearAll}>
                Bersihkan filter ({activeFilters})
              </button>
            )}
            <div className="tspace" />
            <span className="count">
              <b>{journals?.total ?? 0}</b> dari {journals?.all ?? 0} journal
            </span>
          </div>

          {journals && journals.total ? (
            <>
              <div className="tw">
                <table className="grid">
                  <thead>
                    <tr>
                      <th style={{ width: 38 }}>No</th>
                      <th style={{ width: 110 }}>Nomor</th>
                      <th style={{ width: 104 }}>Tanggal</th>
                      <th>Keterangan</th>
                      <th style={{ width: 150 }}>Sumber</th>
                      <th className="num" style={{ width: 56 }}>
                        Baris
                      </th>
                      <th className="num" style={{ width: 150 }}>
                        Debit
                      </th>
                      <th className="num" style={{ width: 150 }}>
                        Kredit
                      </th>
                      <th style={{ width: 104 }}>Status</th>
                      <th style={{ width: 88 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((j, i) => {
                      const href = `/accounting/journal/${j.id}`;
                      const editable =
                        j.isManual && can.edit && generalJournalIsEditable(j.status as GeneralJournalStatus);
                      const broken = cents(j.debit) !== cents(j.credit) && j.status === "Posted";
                      return (
                        <tr key={j.id} onClick={() => router.push(href)}>
                          <td className="no">{(journals!.page - 1) * journals!.size + i + 1}</td>
                          <td>
                            <Link href={href}>
                              <span className="lab">{j.journalNo}</span>
                            </Link>
                          </td>
                          <td>
                            {j.accountingDate ? (
                              formatDate(j.accountingDate)
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
                          <td className="num">
                            <Amount value={j.debit} ledger />
                          </td>
                          <td className="num">
                            <Amount value={j.credit} ledger />
                            {broken && <span className="overtag">tidak seimbang</span>}
                          </td>
                          <td>
                            <span className={`bdg ${STATUS_CLASS[j.status] ?? "s-mute"}`}>
                              {STATUS_TEXT[j.status] ?? j.status}
                            </span>
                          </td>
                          <td className="acts">
                            <span className="ract">
                              <Link
                                className="iact"
                                href={href}
                                title="Lihat detail"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Icon name="eye" size={15} />
                              </Link>
                              {editable ? (
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
                page={journals!.page}
                pages={journals!.pages}
                total={journals!.total}
                perPage={journals!.size}
                onPage={reg.setPage}
                onPerPage={reg.setSize}
              />
            </>
          ) : (
            <div className="empty">
              <div className="ic">
                <Icon name={journals?.all ? "srch" : "book"} size={20} />
              </div>
              <h4>{journals?.all ? "Tidak ada journal yang cocok" : "Belum ada journal"}</h4>
              <p>
                {journals?.all
                  ? "Ubah kata kunci atau bersihkan filter yang sedang aktif."
                  : "Journal terbentuk otomatis saat dokumen Finance diposting, atau diketik sendiri."}
              </p>
              <div className="cta">
                {journals?.all ? (
                  <button className="btn" onClick={clearAll}>
                    Bersihkan filter
                  </button>
                ) : (
                  can.create && (
                    <Link className="btn primary" href="/accounting/journal/new">
                      <Icon name="plus" size={15} /> Journal
                    </Link>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}

    </>
  );
}
