"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { Combobox } from "@/components/ui/combobox";
import { useToast } from "@/components/ui/toast";
import { saveSystemDefaults } from "@/app/actions/settings";
import type { RefOption } from "@/lib/siba/records";
import {
  SYSTEM_DEFAULT_GROUPS,
  systemDefaultsIn,
  type SystemDefaultKey,
  type SystemDefaultValues,
} from "@/lib/siba/system-defaults";

/**
 * System Default — one page for every value the application assumes when the
 * user has not said otherwise.
 *
 * The page is built from the catalogue rather than written out setting by
 * setting, so a new default appears here as soon as it is declared. Each one
 * says plainly what it fills in, because a default that quietly decides
 * something is a rule wearing a default's clothes.
 */
export function SystemDefaultForm({
  values: initial,
  options,
  canEdit,
}: {
  values: SystemDefaultValues;
  /** Options per setting key, already narrowed on the server. */
  options: Record<SystemDefaultKey, RefOption[]>;
  canEdit: boolean;
}) {
  const toast = useToast();
  const [values, setValues] = useState<SystemDefaultValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (key: SystemDefaultKey, value: string | null) => {
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
    const result = await saveSystemDefaults(values);
    setSaving(false);

    if (!result.ok) {
      setErrors(result.errors);
      toast(
        "Gagal menyimpan",
        result.errors._form ?? "Periksa kembali isian yang ditandai.",
        "err"
      );
      return;
    }
    setDirty(false);
    toast(
      "Pengaturan disimpan",
      result.changed
        ? `${result.changed} default diperbarui`
        : "Tidak ada perubahan",
      "ok"
    );
  };

  const reset = () => {
    setValues(initial);
    setErrors({});
    setDirty(false);
  };

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Pengaturan</span>
          <span>/</span>
          <span className="cur">System Default</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="gear" size={16} />
            </span>
            System Default
          </h1>
          <div className="ph-act">
            {canEdit && dirty && (
              <>
                <span className="ph-dirty">
                  <span className="pulse" /> Belum disimpan
                </span>
                <button className="btn" onClick={reset} disabled={saving}>
                  Batal
                </button>
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

      {SYSTEM_DEFAULT_GROUPS.map((group) => (
        <div className="card" key={group.key} style={{ marginBottom: 14 }}>
          <div className="card-h">
            <span className="ci">
              <Icon name={group.icon} size={15} />
            </span>
            <div className="ct">
              <h3>{group.name}</h3>
              <p>{group.desc}</p>
            </div>
          </div>

          <FormBody>
            <FormSection>
              <FormRow>
                {systemDefaultsIn(group.key).map((def) => {
                  const value = values[def.key];
                  const list = options[def.key] ?? [];
                  return (
                    <Field
                      key={def.key}
                      label={def.name}
                      span={4}
                      help={def.help}
                      error={errors[def.key]}
                    >
                      {canEdit ? (
                        <Combobox
                          value={value ? Number(value) : null}
                          options={list}
                          placeholder={`Pilih ${def.name}…`}
                          invalid={Boolean(errors[def.key])}
                          onChange={(v) =>
                            set(def.key, v == null ? null : String(v))
                          }
                        />
                      ) : (
                        <ReadOnly
                          option={list.find((o) => o.id === Number(value)) ?? null}
                        />
                      )}
                    </Field>
                  );
                })}
              </FormRow>
            </FormSection>
          </FormBody>
        </div>
      ))}

      <p className="foot-note">
        Mengubah default tidak mengubah data yang sudah tersimpan — hanya isian
        awal pada form berikutnya. Pengaturan bridge intercompany adalah
        pengecualian: ia menentukan account dan Partner yang dipakai saat Funding
        Request dikonfirmasi, dan konfirmasi ditolak selama salah satunya belum
        diisi.
      </p>
    </>
  );
}

function ReadOnly({ option }: { option: RefOption | null }) {
  if (!option) return <div className="ro nil">belum diatur</div>;
  return (
    <div className="ro">
      <span className="lab">{option.label}</span>
      <span>{option.name}</span>
    </div>
  );
}
