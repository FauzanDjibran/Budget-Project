"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney, formatTotals } from "@/lib/format";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type { FinanceRefs, PurposeOption } from "@/lib/siba/finance";
import type { FundingRequestRow, FundingSummary } from "@/lib/siba/funding";

/**
 * The Funding Request register — the induk's queue.
 *
 * A request is raised by the anak submitting a realization it has no cash of
 * its own to execute, and answered by the induk confirming it. There is no
 * rejection (concept doc §29), so this screen is a queue rather than an
 * approval inbox: what it is chiefly for is finding the open ones and opening
 * them.
 *
 * Confirmation lives on the detail screen, not here, because it asks a question
 * — which resource the money moves through — and a row menu cannot ask one.
 */
export function FundingList({
  requests,
  refs,
  purposes,
  summary,
  canConfirm,
}: {
  requests: FundingRequestRow[];
  refs: FinanceRefs;
  purposes: PurposeOption[];
  summary: FundingSummary;
  canConfirm: boolean;
}) {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const purposeLabelOf = useMemo(() => {
    const byKey = new Map(purposes.map((p) => [p.key, p.label]));
    return (key: string | undefined) => (key ? byKey.get(key) ?? key : "—");
  }, [purposes]);

  const currencyOf = useMemo(() => {
    const byId = new Map(refs.currencies.map((c) => [c.id, c.label]));
    return (id: number) => byId.get(id) ?? "IDR";
  }, [refs.currencies]);

  const companyOf = useMemo(() => {
    const byId = new Map(refs.companies.map((c) => [c.id, c.label]));
    return (id: number | undefined) => (id ? byId.get(id) ?? "—" : "—");
  }, [refs.companies]);

  const filtered = useMemo(() => {
    let out = requests.slice();
    if (status) out = out.filter((r) => r.status === status);

    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        [
          r.funding_request_no,
          r.transaction?.transaction_no ?? "",
          purposeLabelOf(r.transaction?.purpose),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return out;
  }, [requests, status, query, purposeLabelOf]);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <span className="cur">Funding Request</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="link" size={16} />
            </span>
            Funding Request
          </h1>
          <div className="ph-act" />
        </div>
        <p className="ph-sub">
          Kebutuhan dana Company anak atas realisasi yang sudah diajukan. Induk
          tidak menolak — konfirmasi adalah batas aktualnya: kas induk bergerak,
          dan kedua Company memperoleh journal pada saat yang sama.
        </p>
      </div>

      <div className="kpis bud">
        <button
          className="kpi"
          onClick={() => setStatus("Open")}
          style={{ textAlign: "left", font: "inherit" }}
        >
          <div className="h">
            <span
              className="i"
              style={{ background: "var(--warn-bg)", color: "var(--warn)" }}
            >
              <Icon name="clock" size={14} />
            </span>
            <span className="l">Menunggu Konfirmasi</span>
          </div>
          <div className="v">{summary.open}</div>
          <div className="d">
            {formatTotals(summary.openTotals)} · belum menyentuh kas maupun
            Budget
          </div>
        </button>

        <button
          className="kpi"
          onClick={() => setStatus("Closed")}
          style={{ textAlign: "left", font: "inherit" }}
        >
          <div className="h">
            <span
              className="i"
              style={{ background: "var(--ok-bg)", color: "var(--ok)" }}
            >
              <Icon name="check" size={14} />
            </span>
            <span className="l">Sudah Dikonfirmasi</span>
          </div>
          <div className="v">{summary.closed}</div>
          <div className="d">{formatTotals(summary.closedTotals)} disalurkan</div>
        </button>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField
            value={query}
            placeholder="Cari nomor request, dokumen, atau purpose…"
            onChange={setQuery}
          />

          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            ariaLabel="Filter status"
            options={[
              { value: "", label: "Status: semua" },
              ...["Open", "Closed", "Cancelled"].map((s) => ({
                value: s,
                label: s === "Open" ? "Menunggu" : STATUS_TEXT[s] ?? s,
              })),
            ]}
            onChange={setStatus}
          />

          {(status || query) && (
            <button
              className="btn sm ghost"
              onClick={() => {
                setStatus("");
                setQuery("");
              }}
            >
              Bersihkan filter
            </button>
          )}

          <div className="tspace" />
          <span className="count">
            <b>{filtered.length}</b> dari {requests.length} permintaan
          </span>
        </div>

        {filtered.length ? (
          <div className="tw">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 38 }}>No</th>
                  <th style={{ width: 100 }}>Nomor</th>
                  <th style={{ width: 104 }}>Tanggal</th>
                  <th>Pemohon / Realisasi</th>
                  <th className="num" style={{ width: 160 }}>
                    Nominal
                  </th>
                  <th style={{ width: 116 }}>Status</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const href = `/finance/funding-request/${r.id}`;
                  const inn = r.transaction?.transaction_type === "In";
                  return (
                    <tr key={r.id} onClick={() => router.push(href)}>
                      <td className="no">{i + 1}</td>
                      <td>
                        <Link href={href}>
                          <span className="lab">{r.funding_request_no}</span>
                        </Link>
                      </td>
                      <td>{formatDate(r.request_date)}</td>
                      <td className="pri">
                        <Link href={href}>
                          <span className="dstack">
                            <span className="d1">
                              {companyOf(r.transaction?.company_id)} ·{" "}
                              {purposeLabelOf(r.transaction?.purpose)}
                            </span>
                            <span className="d2">
                              {r.transaction?.transaction_no ?? "—"} ·{" "}
                              {r.transaction?.line_count ?? 0} Budget
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="num">
                        <span className={`mny ${inn ? "in" : "out"}`}>
                          {inn ? "+ " : "− "}
                          {formatMoney(r.request_amount, currencyOf(r.currency_id))}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`bdg ${
                            r.status === "Open"
                              ? "s-warn"
                              : STATUS_CLASS[r.status] ?? "s-mute"
                          }`}
                        >
                          {r.status === "Open"
                            ? "Menunggu"
                            : STATUS_TEXT[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="acts">
                        <Link
                          className="iact"
                          href={href}
                          title={
                            r.status === "Open" && canConfirm
                              ? "Tinjau dan konfirmasi"
                              : "Lihat detail"
                          }
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Icon name="eye" size={15} />
                        </Link>
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
              <Icon name="link" size={20} />
            </div>
            <h4>
              {requests.length
                ? "Tidak ada permintaan yang cocok"
                : "Belum ada Funding Request"}
            </h4>
            <p>
              {requests.length
                ? "Ubah kata kunci atau bersihkan filter."
                : "Permintaan muncul di sini ketika Company anak mengajukan dana atas dokumen kas/bank-nya."}
            </p>
          </div>
        )}
      </div>

      <p className="foot-note">
        Tidak ada funding sebagian: nominal permintaan selalu sama dengan
        nominal realisasi yang mendasarinya. Selama masih menunggu, belum ada
        yang bergerak — kas, realisasi Budget, buku pembantu, dan journal kedua
        Company tercatat serentak saat konfirmasi.
      </p>
    </>
  );
}
