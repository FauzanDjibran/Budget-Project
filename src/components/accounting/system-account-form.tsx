"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { Combobox } from "@/components/ui/combobox";
import { useToast } from "@/components/ui/toast";
import { CompanyFilter, NoCompanyAccess } from "@/components/master/company-filter";
import { saveSystemAccounts } from "@/app/actions/system-account";
import type { RefOption } from "@/lib/siba/records";
import {
  SYSTEM_ACCOUNT_GROUPS,
  systemAccountsIn,
  type CompanySide,
  type SystemAccountKey,
  type SystemAccountValues,
} from "@/lib/siba/system-accounts";

/**
 * Mapping Account System — for one Company, the account each posting engine
 * posts a role to.
 *
 * One Company at a time, because every one of these is an account in that
 * Company's own chart: the picker says whose chart is being chosen from before
 * anything is picked, the way the Chart of Accounts and the Budget mapping do.
 */
export function SystemAccountForm({
  companies,
  company,
  values: initial,
  options,
  canEdit,
}: {
  companies: { id: number; label: string; name: string }[];
  company: { id: number; label: string; name: string; side: CompanySide } | null;
  values: SystemAccountValues;
  /** Options per key, already narrowed on the server. */
  options: Record<SystemAccountKey, RefOption[]>;
  canEdit: boolean;
}) {
  const toast = useToast();
  const [values, setValues] = useState<SystemAccountValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (key: SystemAccountKey, value: number | null) => {
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
    if (!company) return;
    setSaving(true);
    const result = await saveSystemAccounts(company.id, values);
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
      "Mapping disimpan",
      result.changed ? `${result.changed} account diperbarui` : "Tidak ada perubahan",
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
          <span>Accounting</span>
          <span>/</span>
          <span className="cur">Mapping Account System</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="link" size={16} />
            </span>
            Mapping Account System
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

      {!company ? (
        <div className="card">
          <NoCompanyAccess what="Mapping Account System" />
        </div>
      ) : (
        <>
          {companies.length > 1 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="toolbar">
                <CompanyFilter options={companies} selectedId={company.id} />
              </div>
            </div>
          )}

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

          {SYSTEM_ACCOUNT_GROUPS.map((group) => (
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
                    {systemAccountsIn(group.key).map((def) => {
                      const name = def.name[company.side];
                      const value = values[def.key];
                      const list = options[def.key] ?? [];
                      return (
                        <Field
                          key={def.key}
                          label={name}
                          span={6}
                          help={def.help}
                          error={errors[def.key]}
                        >
                          {canEdit ? (
                            <Combobox
                              value={value}
                              options={list}
                              placeholder="Pilih Account…"
                              invalid={Boolean(errors[def.key])}
                              onChange={(v) => set(def.key, v == null ? null : Number(v))}
                            />
                          ) : (
                            <ReadOnly option={list.find((o) => o.id === value) ?? null} />
                          )}
                        </Field>
                      );
                    })}
                  </FormRow>
                </FormSection>
              </FormBody>
            </div>
          ))}
        </>
      )}

      <p className="foot-note">
        Account di sini tidak mengisi form: ia menentukan ke mana posting otomatis
        ditulis, menjadi control account, dan proses yang membutuhkannya ditolak
        dengan menyebut nama selama belum diatur.
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
