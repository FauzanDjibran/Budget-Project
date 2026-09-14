"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { createRecord, updateRecord, toggleStatus, type FormValues } from "@/app/actions/master";
import {
  COMPANY_LOCK_BADGE,
  COMPANY_LOCK_BODY,
  isCompanyEntity,
} from "@/lib/siba/company";
import type { EntityAbilities } from "@/lib/siba/entity-access";
import { STATUS_CLASS, STATUS_TEXT, TAG_CLASS, type Entity, type Field } from "@/lib/siba/entities";
import type { RefOption, Row } from "@/lib/siba/records";
import { formatTimestamp } from "@/lib/format";

export type FormMode = "new" | "view" | "edit";

export function EntityForm({
  entity,
  mode,
  row,
  refs,
  createdByEmail,
  updatedByEmail,
  can,
}: {
  entity: Entity;
  mode: FormMode;
  row: Row | null;
  refs: Record<string, RefOption[]>;
  createdByEmail?: string;
  updatedByEmail?: string;
  /** Presentation only — the Server Actions check the same permissions. */
  can: EntityAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";
  const basePath = `/${entity.module}/${entity.slug}`;
  /** Company has no write path at all — see `lib/siba/company.ts`. */
  const locked = isCompanyEntity(entity.slug);
  const canEdit = can.edit && !locked;
  const canToggleStatus =
    row?.status === "Active" ? can.deactivate : can.activate;

  const [values, setValues] = useState<FormValues>(() => initialValues(entity, row));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [busyToggle, setBusyToggle] = useState(false);

  const setField = (field: Field, value: string | boolean | null) => {
    setValues((v) => {
      const next = { ...v, [field.name]: value };
      // Dependent refs are cleared so a stale selection can't survive.
      for (const dep of field.resets ?? []) next[dep] = null;
      return next;
    });
    setDirty(true);
    setErrors((e) => {
      if (!e[field.name]) return e;
      const next = { ...e };
      delete next[field.name];
      return next;
    });
  };

  const optionsFor = (field: Field): RefOption[] => {
    const all = (field.ref && refs[field.ref]) || [];
    // Accounts are scoped to the company chosen on this form.
    if (field.refFilter === "cashBankAccount") {
      const companyId = Number(values.company_id ?? 0);
      return companyId ? all.filter((o) => o.companyId === companyId) : [];
    }
    return all;
  };

  const onSave = async () => {
    setSaving(true);
    const result =
      mode === "new"
        ? await createRecord(entity.slug, values)
        : await updateRecord(entity.slug, row!.id, values);
    setSaving(false);

    if (!result.ok) {
      setErrors(result.errors);
      // `_form` is a whole-form refusal (a locked entity), not a field error.
      const refusal = result.errors._form;
      toast(
        refusal ? "Tidak diizinkan" : "Belum bisa disimpan",
        refusal ?? `${Object.keys(result.errors).length} field perlu diperbaiki.`,
        "err"
      );
      return;
    }

    setDirty(false);
    if (mode === "new") {
      toast(
        `${entity.single ?? entity.name} dibuat`,
        `Kode sistem ${result.code} dibuat otomatis.`,
        "ok"
      );
    } else {
      toast("Perubahan tersimpan", `${entity.name} berhasil diperbarui.`, "ok");
    }
    router.push(`${basePath}/${result.id}`);
    router.refresh();
  };

  const onToggle = async () => {
    if (!row) return;
    setBusyToggle(true);
    const result = await toggleStatus(entity.slug, row.id);
    setBusyToggle(false);
    setConfirmToggle(false);
    if (result.ok) {
      toast(
        "Status diperbarui",
        `${String(row[entity.nameField])} sekarang ${
          result.status === "Active" ? "aktif" : "nonaktif"
        }.`,
        "ok"
      );
      router.refresh();
    } else {
      toast("Gagal", result.message ?? "Status tidak dapat diubah.", "err");
    }
  };

  const label = entity.labelField ? String(row?.[entity.labelField] ?? "") : "";
  const name = String(row?.[entity.nameField] ?? "");
  const status = entity.statusField ? String(row?.status ?? "") : "";

  const businessFields = entity.fields.filter(
    (f) => f.name !== "note" && f.name !== "status"
  );
  const statusFields = entity.fields.filter((f) => f.name === "status");
  const noteFields = entity.fields.filter((f) => f.name === "note");

  const title = mode === "new" ? `Tambah ${entity.single ?? entity.name}` : name;

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <Link href="/dashboard">Master</Link>
          <span>/</span>
          <Link href={basePath}>{entity.name}</Link>
          <span>/</span>
          <span className="cur">{mode === "new" ? "Baru" : label || name}</span>
        </div>

        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={entity.icon} size={16} />
            </span>
            {title}
            {mode !== "new" && label && <span className="lab lg">{label}</span>}
            {mode === "view" && status && (
              canToggleStatus ? (
                <button
                  className={`bdg ${STATUS_CLASS[status] ?? "s-mute"}`}
                  title="Klik untuk mengubah status"
                  onClick={() => setConfirmToggle(true)}
                >
                  {STATUS_TEXT[status] ?? status}
                </button>
              ) : (
                <span className={`bdg ${STATUS_CLASS[status] ?? "s-mute"}`}>
                  {STATUS_TEXT[status] ?? status}
                </span>
              )
            )}
            {mode === "edit" && <span className="bdg t-warn">Mode Ubah</span>}
          </h1>

          <div className="ph-act">
            {editing ? (
              <>
                <Link
                  className="btn"
                  href={mode === "new" ? basePath : `${basePath}/${row!.id}`}
                >
                  Batal
                </Link>
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </>
            ) : locked ? (
              <span className="bdg s-mute" title={COMPANY_LOCK_BODY}>
                <Icon name="lock" size={11} /> {COMPANY_LOCK_BADGE}
              </span>
            ) : canEdit ? (
              <Link className="btn primary" href={`${basePath}/${row!.id}/edit`}>
                <Icon name="pen" size={15} /> Ubah
              </Link>
            ) : null}
          </div>
        </div>
        <p className="ph-sub">{entity.desc}</p>
        {locked && <p className="ph-sub">{COMPANY_LOCK_BODY}</p>}
      </div>

      <div className="fgrid">
        <div>
          <div className="card">
            <div className="fsec">
              <div className="sec-t">Informasi Utama</div>
              <div className="frow">
                {businessFields.map((f) => (
                  <FieldControl
                    key={f.name}
                    field={f}
                    value={values[f.name]}
                    row={row}
                    editing={editing}
                    exists={mode !== "new"}
                    error={errors[f.name]}
                    options={optionsFor(f)}
                    onChange={(v) => setField(f, v)}
                  />
                ))}
              </div>
            </div>

            {statusFields.length > 0 && (
              <div className="fsec">
                <div className="sec-t">
                  Status Data
                  <span className="h">
                    Data Inactive tidak muncul pada pilihan transaksi baru
                  </span>
                </div>
                <div className="frow">
                  {statusFields.map((f) => (
                    <FieldControl
                      key={f.name}
                      field={f}
                      value={values[f.name]}
                      row={row}
                      editing={editing}
                      exists={mode !== "new"}
                      error={errors[f.name]}
                      options={[]}
                      onChange={(v) => setField(f, v)}
                    />
                  ))}
                </div>
              </div>
            )}

            {noteFields.length > 0 && (
              <div className="fsec">
                <div className="frow" style={{ paddingTop: 14 }}>
                  {noteFields.map((f) => (
                    <FieldControl
                      key={f.name}
                      field={f}
                      value={values[f.name]}
                      row={row}
                      editing={editing}
                      exists={mode !== "new"}
                      error={errors[f.name]}
                      options={[]}
                      onChange={(v) => setField(f, v)}
                    />
                  ))}
                </div>
              </div>
            )}

            {editing && dirty && (
              <div className="dirty">
                <span className="msg">
                  <span className="pulse" />
                  Ada perubahan yang belum disimpan
                </span>
                <Link
                  className="btn sm"
                  href={mode === "new" ? basePath : `${basePath}/${row!.id}`}
                >
                  Batal
                </Link>
                <button className="btn primary sm" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={14} /> Simpan
                </button>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="card side">
            <div className="card-h">
              <span className="ci">
                <Icon name="file" size={15} />
              </span>
              <div className="ct">
                <h3>Ringkasan</h3>
              </div>
            </div>
            <div className="card-b">
              <div style={{ padding: "5px 0" }}>
                {mode === "new" ? (
                  <>
                    <div className="mrow">
                      <span className="k">Kode</span>
                      <span className="v">
                        <span className="dash">dibuat otomatis</span>
                      </span>
                    </div>
                    <div className="mrow">
                      <span className="k">Status</span>
                      <span className="v">Belum tersimpan</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mrow">
                      <span className="k">Kode</span>
                      <span className="v mono">{String(row?.[entity.codeField] ?? "—")}</span>
                    </div>
                    {label && (
                      <div className="mrow">
                        <span className="k">Label</span>
                        <span className="v">
                          <span className="lab">{label}</span>
                        </span>
                      </div>
                    )}
                    {status && (
                      <div className="mrow">
                        <span className="k">Status</span>
                        <span className="v">
                          <span className={`bdg ${STATUS_CLASS[status] ?? "s-mute"}`}>
                            {STATUS_TEXT[status] ?? status}
                          </span>
                        </span>
                      </div>
                    )}
                    <div className="mrow">
                      <span className="k">Dibuat</span>
                      <span className="v">
                        {formatTimestamp(row?.created_at as string)}
                        <small>{createdByEmail ?? "sistem@siba.app"}</small>
                      </span>
                    </div>
                    <div className="mrow">
                      <span className="k">Diubah</span>
                      <span className="v">
                        {row?.updated_by ? (
                          <>
                            {formatTimestamp(row?.updated_at as string)}
                            <small>{updatedByEmail ?? ""}</small>
                          </>
                        ) : (
                          <span className="dash">Belum pernah diubah</span>
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmToggle}
        icon={status === "Active" ? "warn" : "check"}
        tone={status === "Active" ? "danger" : "ok"}
        title={`Konfirmasi ${status === "Active" ? "Nonaktifkan" : "Aktifkan"} Data`}
        subject={label ? `${label} – ${name}` : name}
        body={
          status === "Active"
            ? "Data yang nonaktif tidak akan muncul lagi sebagai pilihan pada transaksi baru. Seluruh history dan referensi yang sudah ada tetap utuh."
            : "Data akan kembali tersedia sebagai pilihan pada transaksi baru."
        }
        confirmLabel={`Ya, ${status === "Active" ? "Nonaktifkan" : "Aktifkan"}`}
        confirmTone={status === "Active" ? "solid-danger" : "primary"}
        busy={busyToggle}
        onConfirm={onToggle}
        onCancel={() => setConfirmToggle(false)}
      />
    </>
  );
}

function initialValues(entity: Entity, row: Row | null): FormValues {
  const out: FormValues = {};
  for (const f of entity.fields) {
    if (row) {
      const v = row[f.name];
      out[f.name] = f.type === "bool" ? Boolean(v) : v == null ? null : String(v);
    } else {
      out[f.name] = f.defaultValue != null ? (f.defaultValue as string | boolean) : f.type === "bool" ? false : "";
    }
  }
  return out;
}

function FieldControl({
  field,
  value,
  row,
  editing,
  exists,
  error,
  options,
  onChange,
}: {
  field: Field;
  value: string | boolean | null | undefined;
  row: Row | null;
  editing: boolean;
  exists: boolean;
  error?: string;
  options: RefOption[];
  onChange: (value: string | boolean | null) => void;
}) {
  const wrapClass = `fld${field.full || field.type === "textarea" ? " full" : ""}`;
  const locked = Boolean(field.locked && exists);

  const labelNode = (
    <label>
      {field.label}
      {editing && field.required && <span className="req">*</span>}
      {locked && editing && <span className="lockb">Terkunci</span>}
    </label>
  );

  const footer = error ? (
    <div className="err">
      <Icon name="warn" size={11} />
      {error}
    </div>
  ) : editing && field.help ? (
    <div className="help">{field.help}</div>
  ) : null;

  // ---- read-only presentation -------------------------------------------
  if (!editing) {
    let body: React.ReactNode;
    const raw = row?.[field.name];

    if (field.type === "ref") {
      const opt = options.find((o) => o.id === Number(raw));
      body = opt ? (
        <div className="ro">
          <span className="lab">{opt.label}</span>
          <span>{opt.name}</span>
        </div>
      ) : (
        <div className="ro nil">tidak diisi</div>
      );
    } else if (field.type === "bool") {
      body = (
        <div className="ro">
          <span className={`bdg ${raw ? "s-ok" : "s-bad"}`}>{raw ? "Aktif" : "Non Aktif"}</span>
        </div>
      );
    } else if (field.name === "status") {
      const s = String(raw);
      body = (
        <div className="ro">
          <span className={`bdg ${STATUS_CLASS[s] ?? "s-mute"}`}>{STATUS_TEXT[s] ?? s}</span>
        </div>
      );
    } else if (field.type === "select") {
      const s = String(raw);
      body = (
        <div className="ro">
          <span className={`bdg ${TAG_CLASS[s] ?? "t-slate"}`}>{s}</span>
        </div>
      );
    } else if (field.type === "textarea") {
      body = raw ? (
        <div className="ro multi">{String(raw)}</div>
      ) : (
        <div className="ro multi nil">tidak diisi</div>
      );
    } else if (field.ident) {
      body = raw ? (
        <div className="ro">
          <span className="lab">{String(raw)}</span>
        </div>
      ) : (
        <div className="ro nil">tidak diisi</div>
      );
    } else {
      body =
        raw == null || raw === "" ? (
          <div className="ro nil">tidak diisi</div>
        ) : (
          <div className="ro">{String(raw)}</div>
        );
    }

    return (
      <div className={wrapClass}>
        {labelNode}
        {body}
      </div>
    );
  }

  // ---- editable controls -------------------------------------------------
  if (field.type === "bool") {
    return (
      <div className={wrapClass}>
        <label>{field.label}</label>
        <label className={`chk${error ? " bad" : ""}`}>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>
            <span className="ct">{field.caption ?? "Aktif"}</span>
            {field.captionDetail && <span className="cd">{field.captionDetail}</span>}
          </span>
        </label>
        {footer}
      </div>
    );
  }

  let control: React.ReactNode;

  if (field.type === "ref") {
    control = (
      <Combobox
        value={value == null || value === "" ? null : Number(value)}
        options={options}
        placeholder={`Pilih ${field.label}…`}
        invalid={Boolean(error)}
        disabled={locked}
        onChange={(v) => onChange(v == null ? null : String(v))}
      />
    );
  } else if (field.type === "select") {
    control = (
      <select
        className={`slc${error ? " bad" : ""}`}
        value={value == null ? "" : String(value)}
        disabled={locked}
        onChange={(e) => onChange(e.target.value)}
      >
        {!field.required && <option value="">— tidak diisi —</option>}
        {field.required && (value == null || value === "") && (
          <option value="" disabled>
            — pilih {field.label} —
          </option>
        )}
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {field.optionLabels?.[o] ?? o}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "textarea") {
    control = (
      <textarea
        className={`ta${error ? " bad" : ""}`}
        value={value == null ? "" : String(value)}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    control = (
      <input
        className={`inp${field.ident ? " idf" : ""}${error ? " bad" : ""}`}
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
        value={value == null ? "" : String(value)}
        placeholder={field.placeholder}
        disabled={locked}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className={wrapClass}>
      {labelNode}
      {control}
      {footer}
    </div>
  );
}
