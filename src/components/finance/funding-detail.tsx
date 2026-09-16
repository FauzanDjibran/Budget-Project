"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { confirmFunding } from "@/app/actions/funding";
import { formatDate, formatMoney, formatNumber, formatTimestamp } from "@/lib/format";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type { TransactionLineRow } from "@/lib/siba/finance";
import type { FundingRequestRow } from "@/lib/siba/funding";
import { headerButtonClass } from "@/lib/siba/header-actions";

export type ProviderResource = {
  id: number;
  label: string;
  name: string;
  currencyLabel: string;
  balance: number;
};

/**
 * One Funding Request, and the induk's confirmation of it.
 *
 * The screen states what the anak is asking for and what it is for — the
 * realization, its Budgets, its Purpose — and then asks the induk the single
 * question it actually has to answer: **which resource**. There is no amount to
 * agree and nothing to reject (concept doc §28, §29), so a form with more than
 * one field would be inventing decisions the model does not have.
 *
 * Confirming is the actual boundary for both Companies at once, which is what
 * the dialog says before it is pressed.
 */
export function FundingDetail({
  request,
  lines,
  resources,
  companyLabel,
  currencyLabel,
  purposeLabel,
  partnerLabel,
  providerLabel,
  bridgeMissing,
  canConfirm,
}: {
  request: FundingRequestRow;
  lines: TransactionLineRow[];
  resources: ProviderResource[];
  companyLabel: string;
  currencyLabel: string;
  purposeLabel: string;
  partnerLabel: string | null;
  /** The resource that answered it, once it has been confirmed. */
  providerLabel: string | null;
  /** Settings the confirmation needs and that are not filled in yet. */
  bridgeMissing: string[];
  canConfirm: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [asking, setAsking] = useState(false);
  const [cashBankId, setCashBankId] = useState<number | null>(
    resources.length === 1 ? resources[0].id : null
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const doc = request.transaction;
  const incoming = doc?.transaction_type === "In";
  const open = request.status === "Open";
  const ready = open && canConfirm && !bridgeMissing.length && resources.length > 0;

  const confirm = async () => {
    if (!cashBankId) {
      setError("Pilih Cash & Bank yang dipakai terlebih dahulu.");
      return;
    }
    setBusy(true);
    const result = await confirmFunding(request.id, cashBankId);
    setBusy(false);

    if (!result.ok) {
      setError(result.errors._form ?? Object.values(result.errors)[0]);
      return;
    }
    setAsking(false);
    toast(result.message, request.funding_request_no, "ok");
    router.refresh();
  };

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <Link href="/finance/funding-request">Finance</Link>
          <span>/</span>
          <Link href="/finance/funding-request">Funding Request</Link>
          <span>/</span>
          <span className="cur">{request.funding_request_no}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="link" size={16} />
            </span>
            <span className="docno">{request.funding_request_no}</span>
            <span
              className={`bdg ${
                open ? "s-warn" : STATUS_CLASS[request.status] ?? "s-mute"
              }`}
            >
              {open ? "Menunggu Konfirmasi" : STATUS_TEXT[request.status] ?? request.status}
            </span>
          </h1>
          <div className="ph-act">
            {open ? (
              canConfirm ? (
                <button
                  className={headerButtonClass("primary")}
                  disabled={!ready}
                  title={
                    bridgeMissing.length
                      ? "Pengaturan bridge intercompany belum lengkap"
                      : resources.length
                        ? undefined
                        : `Tidak ada Cash & Bank induk bercurrency ${currencyLabel}`
                  }
                  onClick={() => {
                    setError(null);
                    setAsking(true);
                  }}
                >
                  <Icon name="check" size={15} /> Konfirmasi Funding
                </button>
              ) : null
            ) : (
              <span className="lockchip">
                <Icon name="lock" size={13} />{" "}
                {request.status === "Closed"
                  ? "Sudah dikonfirmasi"
                  : "Ditarik kembali pemohon"}
              </span>
            )}
          </div>
        </div>
      </div>

      {Boolean(bridgeMissing.length) && open && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-b">
            <div className="err">
              <Icon name="warn" size={12} />
              Pengaturan bridge intercompany belum lengkap:{" "}
              {bridgeMissing.join(", ")}. Lengkapi di{" "}
              <Link href="/settings/system-default">
                Pengaturan › System Default
              </Link>{" "}
              sebelum funding dapat dikonfirmasi.
            </div>
          </div>
        </div>
      )}

      <div className="fgrid solo">
        <div>
          {/* What the summary card used to carry, as fields. A request's own
              facts are read here, beside the Budgets they are a request for. */}
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
                  hanya menentukan kas mana yang dipakai.
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
                  <Field label="Purpose" span={3}>
                    <div className="ro">{purposeLabel}</div>
                  </Field>
                  <Field label="Partner" span={3}>
                    <div className="ro">
                      {partnerLabel ?? <span className="dash">tanpa Partner</span>}
                    </div>
                  </Field>
                </FormRow>
                <FormRow>
                  <Field label="Currency" span={3}>
                    <div className="ro">
                      <span className="lab">{currencyLabel}</span>
                    </div>
                  </Field>
                  <Field label="Realisasi" span={3} help="dokumen yang dibiayai">
                    <div className="ro">
                      {doc ? (
                        <Link href={`/finance/cash-bank-transaction/${doc.id}`}>
                          <span className="lab">{doc.transaction_no}</span>
                        </Link>
                      ) : (
                        <span className="dash">tidak ditemukan</span>
                      )}
                    </div>
                  </Field>
                  <Field label="Dikonfirmasi" span={3}>
                    <div className="ro">
                      {request.confirmed_at ? (
                        formatTimestamp(request.confirmed_at)
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
                ? "Funding sudah dikonfirmasi: kas induk bergerak dan masing-masing Company memperoleh journal-nya, tempat posisi keduanya terhadap satu sama lain tercatat. Semua bersifat append-only — koreksi dilakukan sebagai dokumen baru."
                : request.status === "Cancelled"
                  ? "Permintaan ditarik kembali oleh Company pemohon sebelum dikonfirmasi, sehingga tidak pernah menyentuh kas maupun Budget."
                  : "Belum ada yang bergerak. Konfirmasi menulis entri Cash Bank Book induk, realisasi Budget, dan satu journal untuk masing-masing Company — seluruhnya dalam satu transaksi. Posisi kedua Company terhadap satu sama lain dibaca dari journal tersebut, lewat General Ledger."}
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
                  Permintaan dibuat pada level realisasi: satu dokumen, satu
                  permintaan, satu funding.
                </p>
              </div>
            </div>

            {lines.length ? (
              <div className="tw">
                <table className="grid">
                  <thead>
                    <tr>
                      <th style={{ width: 38 }}>No</th>
                      <th style={{ width: 104 }}>Nomor</th>
                      <th>Deskripsi</th>
                      <th className="num" style={{ width: 150 }}>
                        Nominal Budget
                      </th>
                      <th className="num" style={{ width: 150 }}>
                        Realisasi
                      </th>
                      <th style={{ width: 44 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.id}>
                        <td className="no">{i + 1}</td>
                        <td>
                          <span className="lab">{l.budget_no}</span>
                        </td>
                        <td className="pri">
                          <span className="dstack">
                            <span className="d1">{l.description}</span>
                            <span className="d2">
                              {formatDate(l.budget_date)} ·{" "}
                              {STATUS_TEXT[l.budget_status] ?? l.budget_status}
                            </span>
                          </span>
                        </td>
                        <td className="num">
                          <span className="mny">
                            {formatMoney(l.budget_amount, currencyLabel)}
                          </span>
                        </td>
                        <td className="num">
                          <span className="mny">
                            {formatMoney(l.settlement_amount, currencyLabel)}
                          </span>
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
                      <td colSpan={4} style={{ textAlign: "right" }}>
                        Nominal Permintaan
                      </td>
                      <td className="num">
                        <span className="mny big">
                          {formatMoney(request.request_amount, currencyLabel)}
                        </span>
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

            <div className="cardfoot">
              <div className="impact">
                <div className="ttl">
                  {request.status === "Closed"
                    ? "Yang Sudah Tercatat"
                    : "Yang Akan Tercatat Saat Konfirmasi"}
                </div>
                <div className="ir">
                  <span>Kas induk</span>
                  <b>
                    {incoming ? "Penerimaan" : "Pengeluaran"}{" "}
                    {formatMoney(request.request_amount, currencyLabel)}
                    {providerLabel ? ` · ${providerLabel}` : ""}
                  </b>
                </div>
                <div className="ir">
                  <span>Journal induk</span>
                  <b>
                    {incoming ? "Hutang kepada" : "Piutang kepada"} {companyLabel}
                  </b>
                </div>
                <div className="ir">
                  <span>Journal {companyLabel}</span>
                  <b>{incoming ? "Piutang kepada induk" : "Hutang kepada induk"}</b>
                </div>
              </div>
            </div>
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
          width={560}
          onClose={() => setAsking(false)}
          foot={
            <>
              <button className="btn" onClick={() => setAsking(false)} disabled={busy}>
                Batal
              </button>
              <button className="btn primary" onClick={confirm} disabled={busy}>
                <Icon name="check" size={15} />{" "}
                {busy ? "Memproses…" : "Ya, Konfirmasi"}
              </button>
            </>
          }
        >
          <FormSection>
            <FormRow>
              <Field
                label="Cash & Bank yang Dipakai"
                span={12}
                required
                help={`hanya kas induk bercurrency ${currencyLabel}`}
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
                    setError(null);
                  }}
                />
              </Field>
            </FormRow>
          </FormSection>

          <p className="sidenote">
            Konfirmasi adalah batas aktual untuk kedua Company sekaligus: kas
            induk {incoming ? "menerima" : "mengeluarkan"}{" "}
            {formatMoney(request.request_amount, currencyLabel)}, realisasi
            Budget berjalan, dokumen {doc?.transaction_no ?? ""} menjadi
            Diposting, dan satu journal terbentuk untuk masing-masing Company —
            di situlah posisi keduanya terhadap satu sama lain tercatat. Setelah
            itu tidak dapat dibatalkan — koreksi dilakukan sebagai dokumen baru.
          </p>
        </Dialog>
      )}
    </>
  );
}
