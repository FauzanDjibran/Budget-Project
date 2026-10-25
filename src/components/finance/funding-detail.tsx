"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { DocumentHeader } from "@/components/ui/document-header";
import { Combobox } from "@/components/ui/combobox";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { RateInput } from "@/components/ui/rate-input";
import { JournalPreview } from "@/components/ui/journal-preview";
import { Amount } from "@/components/ui/amount";
import { useToast } from "@/components/ui/toast";
import { KursSelect } from "./kurs-select";
import { confirmFunding, previewFunding } from "@/app/actions/funding";
import { formatDate, formatMoney, formatNumber, formatRate, formatTimestamp } from "@/lib/format";
import { BASE_CURRENCY_LABEL, rateSource } from "@/lib/siba/currency";
import type { TransactionLineRow } from "@/lib/siba/finance-rows";
import type { FundingRequestRow, ProviderResource } from "@/lib/siba/funding";
import { headerButtonClass } from "@/lib/siba/header-actions";
import { realizationHref, realizationOf } from "@/lib/siba/realization";

/**
 * One Funding Request, and the induk's confirmation of it.
 *
 * The anak's document is an ordinary Realisasi that does not name its cash:
 * its Budgets and the open items each line settles were chosen on its draft,
 * and are shown here read-only so the induk can check them. Confirming asks
 * the one thing the anak could not answer — the cash side: which resource,
 * and its layer or kurs where the currencies call for one — and shows the two
 * journals that will be written before it is pressed.
 */
export function FundingDetail({
  request,
  lines,
  lineLabels,
  resources,
  companyLabel,
  currencyLabel,
  providerLabel,
  bridgeMissing,
  canConfirm,
}: {
  request: FundingRequestRow;
  lines: TransactionLineRow[];
  /** Each line's `Category · Partner`, keyed by line id. */
  lineLabels: Record<number, string>;
  resources: ProviderResource[];
  companyLabel: string;
  currencyLabel: string;
  /** The resource that answered it, once it has been confirmed. */
  providerLabel: string | null;
  /** Settings the confirmation needs and that are not filled in yet. */
  bridgeMissing: string[];
  canConfirm: boolean;
}) {
  const toast = useToast();

  const [asking, setAsking] = useState(false);
  const [cashBankId, setCashBankId] = useState<number | null>(
    resources.length === 1 ? resources[0].id : null
  );
  const [layerId, setLayerId] = useState<number | null>(null);
  const [rate, setRate] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const doc = request.transaction;
  const direction = doc?.transaction_type ?? "Out";
  const incoming = direction === "In";
  const open = request.status === "Open";
  const answerable = open && canConfirm && !bridgeMissing.length && resources.length > 0;

  const resource = resources.find((r) => r.id === cashBankId) ?? null;
  const source = resource ? rateSource(direction, currencyLabel, resource.currencyLabel) : null;
  // The cash side is complete once what its kurs source asks for is there;
  // only then is there a journal to preview.
  const complete =
    resource != null &&
    (source === "identity" ||
      (source === "layer" && layerId != null) ||
      (source === "entered" && Number(rate) > 0));
  const cash = { cashBankId: cashBankId ?? 0, layerId, rate: Number(rate) || null };
  const cashKey = `${cashBankId}|${layerId}|${rate}`;

  const confirm = async () => {
    setBusy(true);
    const result = await confirmFunding(request.id, cash);
    setBusy(false);
    if (!result.ok) {
      setError(result.errors._form ?? Object.values(result.errors)[0]);
      return;
    }
    setAsking(false);
    toast(result.message, request.funding_request_no, "ok");
  };

  return (
    <>
      <DocumentHeader
        module="Finance"
        trail={[{ label: "Funding Request", href: "/finance/funding-request" }]}
        icon="link"
        number={request.funding_request_no}
        status={request.status}
        statusLabel={open ? { text: "Menunggu Konfirmasi", tone: "s-warn" } : undefined}
      >
        {open ? (
          canConfirm ? (
            <button
              className={headerButtonClass("primary")}
              disabled={!answerable}
              title={
                bridgeMissing.length
                  ? "Pengaturan bridge intercompany belum lengkap"
                  : resources.length
                    ? undefined
                    : `Tidak ada Cash & Bank induk yang dapat membayar ${currencyLabel}`
              }
              onClick={() => {
                setError(null);
                setReady(false);
                setAsking(true);
              }}
            >
              <Icon name="check" size={15} /> Konfirmasi Funding
            </button>
          ) : null
        ) : (
          <span className="lockchip">
            <Icon name="lock" size={13} />{" "}
            {request.status === "Closed" ? "Sudah dikonfirmasi" : "Ditarik kembali pemohon"}
          </span>
        )}
      </DocumentHeader>

      {Boolean(bridgeMissing.length) && open && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-b">
            <div className="err">
              <Icon name="warn" size={12} />
              Pengaturan bridge intercompany belum lengkap:{" "}
              {bridgeMissing.join(", ")}. Lengkapi di{" "}
              <Link href="/accounting/system-account">
                Accounting › Mapping Account System
              </Link>{" "}
              sebelum funding dapat dikonfirmasi.
            </div>
          </div>
        </div>
      )}

      <div className="fgrid solo">
        <div>
          <div className="card">
            <div className="card-h">
              <span className="ci">
                <Icon name="file" size={15} />
              </span>
              <div className="ct">
                <h3>Permintaan</h3>
                <p>
                  Company {companyLabel} tidak memiliki Cash &amp; Bank sendiri.
                  Tidak ada funding sebagian dan tidak ada penolakan — induk
                  menentukan kas yang dipakai.
                </p>
              </div>
            </div>
            <FormBody>
              <FormSection>
                <FormRow>
                  <Field label="Tanggal" span={3}>
                    <div className="ro">{formatDate(request.request_date)}</div>
                  </Field>
                  <Field label="Pemohon" span={3}>
                    <div className="ro">
                      <span className="lab">{companyLabel}</span>
                    </div>
                  </Field>
                  <Field label="Realisasi" span={3} help="dokumen anak">
                    <div className="ro">
                      {doc ? (
                        <Link href={realizationHref(doc.transaction_type, doc.id)}>
                          <span className="lab">{doc.transaction_no}</span>
                        </Link>
                      ) : (
                        <span className="dash">tidak ditemukan</span>
                      )}
                    </div>
                  </Field>
                  <Field label="Tanggal Akuntansi" span={3}>
                    <div className="ro">
                      {doc?.accounting_date ? (
                        formatDate(doc.accounting_date)
                      ) : (
                        <span className="dash">belum ditentukan</span>
                      )}
                    </div>
                  </Field>
                </FormRow>
                <FormRow>
                  <Field label="Arah" span={3}>
                    <div className="ro">{realizationOf(direction).title}</div>
                  </Field>
                  <Field label="Currency" span={3}>
                    <div className="ro">
                      <span className="lab">{currencyLabel}</span>
                    </div>
                  </Field>
                  <Field label="Cash & Bank Induk" span={3}>
                    <div className="ro">
                      {providerLabel ?? <span className="dash">belum</span>}
                    </div>
                  </Field>
                  <Field label="Dikonfirmasi" span={3}>
                    <div className="ro">
                      {request.confirmed_at ? (
                        <>
                          {formatTimestamp(request.confirmed_at)}
                          {doc && doc.exchange_rate !== 1 && (
                            <span className="mny"> · kurs {formatRate(doc.exchange_rate)}</span>
                          )}
                        </>
                      ) : (
                        <span className="dash">belum</span>
                      )}
                    </div>
                  </Field>
                </FormRow>
              </FormSection>
            </FormBody>

            <p className="fnote">
              {request.status === "Closed"
                ? "Funding sudah dikonfirmasi: kas induk bergerak per Budget, buku subjek anak tercatat, dan masing-masing Company memperoleh journal-nya, tempat posisi keduanya terhadap satu sama lain tercatat. Koreksi dilakukan sebagai dokumen baru."
                : request.status === "Cancelled"
                  ? "Permintaan ditarik kembali oleh Company pemohon sebelum dikonfirmasi, sehingga tidak pernah menyentuh kas maupun Budget."
                  : "Belum ada yang bergerak. Konfirmasi menulis persis yang ditulis Post sebuah Realisasi — per Budget satu entri Cash Bank Book induk dan entri buku subjek anak — ditambah satu journal untuk masing-masing Company, dalam satu transaksi."}
            </p>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="ci">
                <Icon name="clip" size={15} />
              </span>
              <div className="ct">
                <h3>Budget yang Direalisasikan</h3>
                <p>
                  Dipilih anak pada draft-nya, termasuk open item yang
                  diselesaikan setiap baris. Periksa sebelum mengonfirmasi.
                </p>
              </div>
              <span className="hint">{lines.length} budget</span>
            </div>

            {lines.length ? (
              <div className="tw">
                <table className="grid ltab" style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>No</th>
                      <th>Budget</th>
                      <th style={{ width: 180 }}>Open Item</th>
                      <th className="num" style={{ width: 164 }}>
                        Realisasi
                      </th>
                      <th style={{ width: 40 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.id}>
                        <td className="no">{i + 1}</td>
                        <td className="pri">
                          <span className="dstack">
                            <span className="d1">{l.description}</span>
                            <span className="d2 tx">
                              <span className="mono">{l.budget_no}</span> ·{" "}
                              {lineLabels[l.id] ?? "—"}
                            </span>
                          </span>
                        </td>
                        <td>
                          {l.items.length ? (
                            <span className="dstack">
                              <span className="d1">
                                {l.items.map((it) => (
                                  <span key={it.item.id} className="lab">
                                    {it.item.itemNo}
                                  </span>
                                ))}
                              </span>
                              <span className="d2">
                                {l.items.length > 1
                                  ? `${l.items.length} item`
                                  : currencyLabel === BASE_CURRENCY_LABEL
                                    ? formatDate(l.items[0].item.date)
                                    : `kurs ${formatRate(l.items[0].item.rate)}`}
                              </span>
                            </span>
                          ) : (
                            <span className="dash">—</span>
                          )}
                        </td>
                        <td className="num">
                          <Amount value={l.settlement_amount} currency={currencyLabel} />
                        </td>
                        <td className="acts">
                          <Link
                            className="iact"
                            href={`/budget/budget/${l.budget_id}`}
                            title="Buka Budget"
                          >
                            <Icon name="eye" size={14} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="totrow">
                      <td colSpan={3} style={{ textAlign: "right" }}>
                        Nominal Permintaan
                      </td>
                      <td className="num">
                        <Amount value={request.request_amount} currency={currencyLabel} />
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="empty sm">
                <div className="ic">
                  <Icon name="clip" size={18} />
                </div>
                <h4>Dokumen tanpa Budget</h4>
                <p>Realisasi yang mendasari permintaan ini tidak memuat line.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {asking && (
        <Dialog
          open
          icon="wallet2"
          title="Konfirmasi Funding"
          subtitle={`${request.funding_request_no} · ${formatMoney(
            request.request_amount,
            currencyLabel
          )} untuk ${companyLabel}`}
          width={760}
          onClose={() => setAsking(false)}
          foot={
            <>
              <button className="btn" onClick={() => setAsking(false)} disabled={busy}>
                Batal
              </button>
              <button
                className="btn primary"
                onClick={confirm}
                disabled={busy || !complete || !ready}
              >
                <Icon name="check" size={15} />{" "}
                {busy ? "Memproses…" : "Ya, Konfirmasi"}
              </button>
            </>
          }
        >
          <FormSection>
            <FormRow>
              <Field
                label="Cash & Bank Induk"
                span={source === "layer" ? 6 : source === "entered" ? 8 : 12}
                required
                help={`kas induk yang dapat membayar ${currencyLabel}`}
                error={error ?? undefined}
              >
                <Combobox
                  value={cashBankId}
                  options={resources.map((r) => ({
                    id: r.id,
                    label: r.label,
                    name: `${r.name} · ${r.currencyLabel} ${formatNumber(r.balance)}`,
                    active: true,
                  }))}
                  placeholder="Pilih Cash & Bank…"
                  invalid={Boolean(error)}
                  onChange={(v) => {
                    setCashBankId(v);
                    setLayerId(null);
                    setRate("");
                    setReady(false);
                    setError(null);
                  }}
                />
              </Field>
              {source === "layer" && (
                <Field label="Kurs" span={6} required help="satu konfirmasi memakai satu layer">
                  <KursSelect
                    value={layerId}
                    layers={resource?.layers ?? []}
                    asOf={doc?.accounting_date?.slice(0, 10)}
                    currencyLabel={currencyLabel}
                    onChange={(v) => {
                      setLayerId(v);
                      setReady(false);
                      setError(null);
                    }}
                  />
                </Field>
              )}
              {source === "entered" && (
                <Field label="Kurs" span={4} required help={`1 ${currencyLabel} dalam ${BASE_CURRENCY_LABEL}`}>
                  <RateInput
                    value={rate}
                    pairLabel={`${currencyLabel} → ${BASE_CURRENCY_LABEL}`}
                    onChange={(v) => {
                      setRate(v);
                      setReady(false);
                      setError(null);
                    }}
                  />
                </Field>
              )}
            </FormRow>
          </FormSection>

          {complete ? (
            <JournalPreview
              key={cashKey}
              load={() => previewFunding(request.id, cash)}
              onReady={setReady}
            />
          ) : (
            <div className="apmap">
              {resource
                ? source === "layer"
                  ? "Pilih layer kurs dulu…"
                  : "Isi kurs dulu…"
                : "Pilih Cash & Bank dulu…"}
            </div>
          )}

          <p className="sidenote">
            Konfirmasi adalah batas aktual untuk kedua Company sekaligus: kas
            induk {incoming ? "menerima" : "mengeluarkan"} dana per Budget,
            realisasi Budget berjalan, dokumen {doc?.transaction_no ?? ""}{" "}
            menjadi Diposting, dan journal di atas terbentuk. Setelah itu tidak
            dapat dibatalkan — koreksi dilakukan sebagai dokumen baru.
          </p>
        </Dialog>
      )}
    </>
  );
}
