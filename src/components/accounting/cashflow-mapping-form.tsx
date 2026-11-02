"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { saveCashflowMapping } from "@/app/actions/cashflow-mapping";
import { entryTypeLabel } from "@/lib/siba/cashflow-catalogue";
import type { CashflowMappingView } from "@/lib/siba/cashflow-mapping";

/**
 * Mapping Cash Flow — which group of the Laporan Arus Kas each Budget Category
 * falls in, and each entry type that carries no category of its own. Read at
 * Post and copied onto the Cash Bank Book entry, so a change reaches later
 * postings only.
 */
export function CashflowMappingForm({ view, canEdit }: { view: CashflowMappingView; canEdit: boolean }) {
  const toast = useToast();
  const initial = Object.fromEntries([
    ...view.categories.map((c) => [`category:${c.id}`, c.groupId == null ? "" : String(c.groupId)]),
    ...view.types.map((t) => [`type:${t.type}`, t.groupId == null ? "" : String(t.groupId)]),
  ]) as Record<string, string>;
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const options = view.groups
    .filter((g) => g.active || Object.values(values).includes(String(g.id)))
    .map((g) => ({ value: String(g.id), label: g.label, hint: g.name }));
  const groupName = (v: string) => view.groups.find((g) => String(g.id) === v)?.label;

  const set = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      delete next._form;
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    const result = await saveCashflowMapping(values);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast("Gagal menyimpan", result.errors._form ?? "Periksa kembali isian yang ditandai.", "err");
      return;
    }
    setDirty(false);
    toast("Mapping disimpan", result.changed ? `${result.changed} mapping diperbarui` : "Tidak ada perubahan", "ok");
  };

  const reset = () => {
    setValues(initial);
    setErrors({});
    setDirty(false);
  };

  const control = (key: string) =>
    canEdit ? (
      <Select
        value={values[key]}
        options={options}
        placeholder="Pilih Kelompok…"
        invalid={Boolean(errors[key])}
        onChange={(v) => set(key, v)}
      />
    ) : values[key] ? (
      <div className="ro">{groupName(values[key])}</div>
    ) : (
      <div className="ro nil">belum dipetakan</div>
    );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Accounting</span>
          <span>/</span>
          <span className="cur">Mapping Cash Flow</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="link" size={16} />
            </span>
            Mapping Cash Flow
          </h1>
          <div className="ph-act">
            {canEdit && dirty && (
              <>
                <span className="ph-dirty">
                  <span className="pulse" /> Belum disimpan
                </span>
                <CancelButton onCancel={reset} dirty={dirty} disabled={saving} />
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

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

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="tags" size={15} />
          </span>
          <div className="ct">
            <h3>Budget Category</h3>
            <p>Kelompok untuk setiap realisasi Budget dan Pencairan Open Item pada kategori ini.</p>
          </div>
        </div>
        <FormBody>
          <FormSection>
            <FormRow>
              {view.categories.map((c) => (
                <Field key={c.id} label={c.label} span={4} help={c.name === c.label ? undefined : c.name.toLowerCase()} error={errors[`category:${c.id}`]}>
                  {control(`category:${c.id}`)}
                </Field>
              ))}
            </FormRow>
          </FormSection>
        </FormBody>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="link" size={15} />
          </span>
          <div className="ct">
            <h3>Jenis Entri tanpa Budget Category</h3>
            <p>Transfer antar Cash &amp; Bank sendiri, saldo awal rekening dan revaluasi kurs bukan arus kas.</p>
          </div>
        </div>
        <FormBody>
          <FormSection>
            <FormRow>
              {view.types.map((t) => (
                <Field key={t.type} label={entryTypeLabel(t.type)} span={3} error={errors[`type:${t.type}`]}>
                  {control(`type:${t.type}`)}
                </Field>
              ))}
            </FormRow>
          </FormSection>
        </FormBody>
        <p className="fnote">Perubahan berlaku untuk posting berikutnya; entri yang sudah diposting tetap pada kelompoknya.</p>
      </div>
    </>
  );
}
