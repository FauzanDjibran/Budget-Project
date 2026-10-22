"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { DocumentHeader } from "@/components/ui/document-header";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { RateInput } from "@/components/ui/rate-input";
import { DateInput } from "@/components/ui/date-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { useToast } from "@/components/ui/toast";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { ReportSummary } from "@/components/report/report-summary";
import {
  createRevaluation,
  previewRevaluationPost,
  transitionRevaluation,
  updateRevaluation,
  type RevaluationValues,
} from "@/app/actions/cash-bank-revaluation";
import { formatDate, formatMoney, formatRate, todayIso } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { revalue, roundBase } from "@/lib/siba/fx";
import type {
  RevaluationLayerRow,
  RevaluationRefs,
  RevaluationRow,
} from "@/lib/siba/cash-bank-revaluation";
import {
  REVALUATION_TRANSITIONS,
  availableRevaluationActions,
  revaluationIsEditable,
  type RevaluationAbilities,
  type RevaluationAction,
} from "@/lib/siba/cash-bank-revaluation-workflow";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/siba/header-actions";

export type RevaluationFormMode = "new" | "view" | "edit";

/**
 * Revaluasi Kurs create / detail / edit.
 *
 * The header names one foreign Cash & Bank and the kurs the user states as
 * current. The card below lists the layers Post closes — on a draft, the ones
 * open **now**, because Post reads the layers as they stand when it runs —
 * and the one layer it opens in their place. The figures are the kernel's own
 * (`revalue`), so what is shown is what Post writes if it runs now.
 */
export function RevaluationForm({
  mode,
  doc,
  closedLayers,
  openedLayerNo,
  refs,
  can,
}: {
  mode: RevaluationFormMode;
  doc: RevaluationRow | null;
  /** A posted document's record of what it closed; empty otherwise. */
  closedLayers: RevaluationLayerRow[];
  openedLayerNo: string | null;
  refs: RevaluationRefs;
  can: RevaluationAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";

  const [values, setValues] = useState<RevaluationValues>(() => ({
    cash_bank_id: doc ? String(doc.cash_bank_id) : "",
    exchange_rate: doc ? String(doc.exchange_rate) : "",
    // Today, as every editable date starts (§10 rule 33).
    accounting_date: doc?.accounting_date ?? todayIso(),
    note: doc?.note ?? "",
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<RevaluationAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [postReady, setPostReady] = useState(false);

  const resource = refs.cashBanks.find((c) => String(c.id) === values.cash_bank_id) ?? null;
  const currencyLabel = resource?.currencyLabel ?? doc?.currency_label ?? "—";
  const posted = doc?.status === "Posted";

  // What Post closes: the record it kept once posted, the live layers before.
  const layers: RevaluationLayerRow[] = posted
    ? closedLayers
    : (resource?.layers ?? []).map((l) => ({
        layerId: l.id,
        layerNo: l.layerNo,
        date: l.date,
        rate: l.rate,
        foreign: l.foreignRemaining,
        base: l.baseRemaining,
      }));

  const rate = Number(values.exchange_rate);
  const before = {
    foreign: roundBase(layers.reduce((t, l) => t + l.foreign, 0)),
    base: roundBase(layers.reduce((t, l) => t + l.base, 0)),
  };
  // Posted figures are read back, never recomputed: they are history.
  const figures = posted
    ? {
        foreign: doc!.foreign_balance,
        baseBefore: doc!.base_before,
        baseAfter: doc!.base_after,
        difference: doc!.fx_difference,
        rate: doc!.exchange_rate,
      }
    : rate > 0 && before.foreign > 0
      ? (() => {
          const r = revalue(before, rate);
          return {
            foreign: before.foreign,
            baseBefore: before.base,
            baseAfter: r.balance.base,
            difference: r.difference.amount,
            rate,
          };
        })()
      : null;

  const set = (key: keyof RevaluationValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
    setErrors((e) => {
      if (!e[key] && !e._form) return e;
      const next = { ...e };
      delete next[key];
      delete next._form;
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    const result =
      mode === "new" ? await createRevaluation(values) : await updateRevaluation(doc!.id, values);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast("Gagal menyimpan", result.errors._form ?? "Periksa kembali isian yang ditandai.", "err");
      return;
    }
    setDirty(false);
    toast(
      mode === "new" ? "Revaluasi kurs dibuat" : "Perubahan disimpan",
      mode === "new"
        ? `${result.revaluation_no} dibuat otomatis. Dokumen masih Draft.`
        : doc?.revaluation_no,
      "ok"
    );
    router.push(`/finance/revaluasi-kurs/${result.id}`);
  };

  const run = async (action: RevaluationAction) => {
    if (!doc) return;
    setBusy(true);
    const result = await transitionRevaluation(doc.id, action);
    setBusy(false);
    setConfirm(null);
    setPostReady(false);
    if (result.ok) {
      toast(result.message, doc.revaluation_no, "ok");
      return;
    }
    toast("Tidak dapat diproses", result.errors._form ?? Object.values(result.errors)[0], "err");
  };

  const listHref = "/finance/revaluasi-kurs";
  const backHref = doc ? `${listHref}/${doc.id}` : listHref;
  const actions = doc ? availableRevaluationActions(doc.status, can) : [];

  const viewActions: { key: string; tone: ActionTone; node: React.ReactNode }[] = doc
    ? orderForHeader(
        [
          ...(can.edit && revaluationIsEditable(doc.status)
            ? [
                {
                  key: "edit",
                  tone: "neutral" as ActionTone,
                  node: (
                    <Link key="edit" className="btn" href={`${listHref}/${doc.id}/edit`}>
                      <Icon name="pen" size={15} /> Ubah
                    </Link>
                  ),
                },
              ]
            : []),
          ...actions.map((a) => {
            const t = REVALUATION_TRANSITIONS[a];
            return {
              key: a,
              tone: t.tone,
              node: (
                <button
                  key={a}
                  className={headerButtonClass(t.tone)}
                  disabled={busy}
                  onClick={() => setConfirm(a)}
                >
                  <Icon name={t.icon} size={15} /> {t.label}
                </button>
              ),
            };
          }),
        ],
        (i) => i.tone
      )
    : [];

  const differenceLabel = !figures
    ? "Selisih"
    : figures.difference > 0
      ? "Laba Revaluasi"
      : figures.difference < 0
        ? "Rugi Revaluasi"
        : "Selisih";

  return (
    <>
      <DocumentHeader
        module="Finance"
        trail={[{ label: "Revaluasi Kurs", href: listHref }]}
        icon="trend"
        number={doc?.revaluation_no ?? null}
        placeholder="Revaluasi Kurs Baru"
        status={doc?.status ?? null}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {mode === "view" && doc && (
          <>
            {viewActions.map((i) => i.node)}
            {!actions.length && (
              <span className="lockchip">
                <Icon name="lock" size={13} />{" "}
                {doc.status === "Posted" ? "Terkunci setelah Post" : "Dokumen dibatalkan"}
              </span>
            )}
          </>
        )}
        {editing && (
          <>
            <CancelButton href={backHref} dirty={dirty} disabled={saving} />
            <button className="btn primary" onClick={onSave} disabled={saving}>
              <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
            </button>
          </>
        )}
      </DocumentHeader>

      {errors._form && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-b">
            <div className="err">
              <Icon name="warn" size={12} />
              {errors._form}
            </div>
          </div>
        </div>
      )}

      <div className="fgrid solo">
        <div>
          <div className="card">
            <div className="card-h">
              <span className="ci">
                <Icon name="wallet" size={15} />
              </span>
              <div className="ct">
                <h3>Cash & Bank yang Direvaluasi</h3>
                <p>
                  Satu Cash & Bank valas per dokumen, pada kurs yang Anda nyatakan sebagai
                  kurs saat ini.
                </p>
              </div>
            </div>
            <FormBody>
              <FormSection>
                <FormRow>
                  <Field label="Cash & Bank" span={5} required={editing} error={errors.cash_bank_id}>
                    {editing ? (
                      <Combobox
                        value={values.cash_bank_id ? Number(values.cash_bank_id) : null}
                        options={refs.cashBanks.map((c) => ({
                          id: c.id,
                          label: c.label,
                          name: `${c.name} · ${c.currencyLabel}`,
                          active: true,
                        }))}
                        placeholder="Pilih Cash & Bank…"
                        invalid={Boolean(errors.cash_bank_id)}
                        onChange={(v) => set("cash_bank_id", v ? String(v) : "")}
                      />
                    ) : (
                      <div className="ro">
                        <span className="lab">{doc!.cash_bank_label}</span>
                        <span>{doc!.cash_bank_name}</span>
                      </div>
                    )}
                  </Field>

                  <Field
                    label="Kurs Baru"
                    span={4}
                    required={editing}
                    help={editing ? "kurs saat ini, dari bank" : undefined}
                    error={errors.exchange_rate}
                  >
                    {editing ? (
                      <RateInput
                        value={values.exchange_rate}
                        pairLabel={`${resource?.currencyLabel ?? "—"} → ${BASE_CURRENCY_LABEL}`}
                        invalid={Boolean(errors.exchange_rate)}
                        ariaLabel="Kurs baru"
                        onChange={(v) => set("exchange_rate", v)}
                      />
                    ) : (
                      <div className="ro">
                        <span className="mny">{formatRate(doc!.exchange_rate)}</span>
                      </div>
                    )}
                  </Field>

                  <Field
                    label="Tanggal Akuntansi"
                    span={3}
                    required={editing}
                    help={editing ? "boleh mundur" : undefined}
                    error={errors.accounting_date}
                  >
                    {editing ? (
                      <DateInput
                        value={values.accounting_date}
                        invalid={Boolean(errors.accounting_date)}
                        onChange={(v) => set("accounting_date", v)}
                      />
                    ) : (
                      <div className="ro">
                        {doc?.accounting_date ? (
                          formatDate(doc.accounting_date)
                        ) : (
                          <span className="dash">belum ditentukan</span>
                        )}
                      </div>
                    )}
                  </Field>
                </FormRow>

                <FormRow>
                  <Field htmlFor="revaluation-notes" label="Catatan" span={12}>
                    {editing ? (
                      <textarea
                        id="revaluation-notes"
                        className="ta"
                        rows={2}
                        value={values.note}
                        onChange={(e) => set("note", e.target.value)}
                        placeholder="Sumber kurs, alasan revaluasi…"
                      />
                    ) : (
                      <div className="ro">{doc!.note || <span className="dash">—</span>}</div>
                    )}
                  </Field>
                </FormRow>
              </FormSection>
            </FormBody>

            {mode === "view" && (
              <p className="fnote">
                {doc!.status === "Posted"
                  ? "Layer kurs sudah ditutup dan diganti satu layer pada kurs ini; selisihnya sudah dijurnal. Kurs yang keliru dikoreksi dengan revaluasi berikutnya."
                  : doc!.status === "Draft"
                    ? "Dokumen masih Draft. Layer belum berubah; angka di bawah dihitung dari layer yang terbuka saat ini, sama seperti saat Post dijalankan."
                    : "Dokumen dibatalkan sebelum Post, sehingga tidak pernah menyentuh layer mana pun."}
              </p>
            )}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="layers" size={15} />
              </span>
              <div className="ct">
                <h3>Layer Kurs</h3>
                <p>
                  {posted
                    ? "Layer yang ditutup revaluasi ini, dan satu layer yang menggantikannya."
                    : "Seluruh layer yang terbuka saat ini ditutup, lalu diganti satu layer pada kurs baru."}
                </p>
              </div>
              <span className="hint">{layers.length} layer</span>
            </div>

            <div className="lsum">
              {!resource && !doc ? (
                <span className="wait">Pilih Cash & Bank dulu…</span>
              ) : !figures ? (
                <span className="wait">
                  {before.foreign > 0 || posted ? "Isi Kurs Baru dulu…" : "Cash & Bank ini tidak memegang valas saat ini"}
                </span>
              ) : (
                <ReportSummary
                  figures={[
                    {
                      label: `Nilai ${BASE_CURRENCY_LABEL} Saat Ini`,
                      value: formatMoney(figures.baseBefore, BASE_CURRENCY_LABEL),
                    },
                    {
                      label: `Nilai ${BASE_CURRENCY_LABEL} Baru`,
                      value: formatMoney(figures.baseAfter, BASE_CURRENCY_LABEL),
                    },
                    {
                      label: differenceLabel,
                      value: formatMoney(Math.abs(figures.difference), BASE_CURRENCY_LABEL),
                      key: true,
                      negative: figures.difference < 0,
                      zero: figures.difference === 0,
                    },
                  ]}
                />
              )}
            </div>

            {layers.length ? (
              <div className="tw">
                <table className="grid ltab" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>No</th>
                      <th>Layer</th>
                      <th className="num" style={{ width: 150 }}>
                        Kurs
                      </th>
                      <th className="num" style={{ width: 170 }}>
                        Sisa ({currencyLabel})
                      </th>
                      <th className="num" style={{ width: 190 }}>
                        Nilai {BASE_CURRENCY_LABEL}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {layers.map((l, i) => (
                      <tr key={l.layerId}>
                        <td className="no">{i + 1}</td>
                        <td>
                          <span className="dstack">
                            <span className="d1">
                              <span className="lab">{l.layerNo}</span>
                            </span>
                            {l.date && <span className="d2">{formatDate(l.date)}</span>}
                          </span>
                        </td>
                        <td className="num">{formatRate(l.rate)}</td>
                        <td className="num">
                          <Amount value={l.foreign} currency={currencyLabel} />
                        </td>
                        <td className="num">
                          <Amount value={l.base} currency={BASE_CURRENCY_LABEL} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {figures && (
                    <tfoot>
                      <tr className="totrow">
                        <td colSpan={2} style={{ textAlign: "right" }}>
                          {posted && openedLayerNo
                            ? `Diganti layer ${openedLayerNo}`
                            : "Diganti satu layer baru"}
                        </td>
                        <td className="num">{formatRate(figures.rate)}</td>
                        <td className="num">
                          <Amount value={figures.foreign} currency={currencyLabel} />
                        </td>
                        <td className="num">
                          <Amount value={figures.baseAfter} currency={BASE_CURRENCY_LABEL} big />
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            ) : (
              <div className="empty sm">
                <div className="ic">
                  <Icon name="layers" size={18} />
                </div>
                <h4>{resource || doc ? "Tidak ada layer terbuka" : "Belum ada Cash & Bank"}</h4>
                <p>
                  {resource || doc
                    ? "Cash & Bank ini tidak memegang valas, jadi tidak ada yang direvaluasi."
                    : "Pilih Cash & Bank valas untuk melihat layer kurs yang akan ditutup."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirm && doc && (
        <ConfirmDialog
          open
          icon={REVALUATION_TRANSITIONS[confirm].icon}
          tone={REVALUATION_TRANSITIONS[confirm].tone === "danger" ? "danger" : "ok"}
          title={REVALUATION_TRANSITIONS[confirm].title}
          subject={`${doc.revaluation_no} – ${doc.cash_bank_label} @ ${formatRate(doc.exchange_rate)}`}
          body={REVALUATION_TRANSITIONS[confirm].body}
          confirmLabel={REVALUATION_TRANSITIONS[confirm].confirmLabel}
          confirmTone={REVALUATION_TRANSITIONS[confirm].tone === "danger" ? "solid-danger" : "primary"}
          busy={busy}
          onConfirm={() => run(confirm)}
          onCancel={() => {
            setConfirm(null);
            setPostReady(false);
          }}
          wide={confirm === "post"}
          confirmDisabled={confirm === "post" && !postReady}
        >
          {confirm === "post" && (
            <JournalPreview load={() => previewRevaluationPost(doc.id)} onReady={setPostReady} />
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
