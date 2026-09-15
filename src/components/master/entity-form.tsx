"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { createRecord, updateRecord, toggleStatus, type FormValues } from "@/app/actions/master";
import {
  COMPANY_LOCK_BADGE,
  COMPANY_LOCK_BODY,
  isCompanyEntity,
} from "@/lib/siba/company";
import type { EntityAbilities } from "@/lib/siba/entity-access";
import {
  STATUS_CLASS,
  STATUS_TEXT,
  TAG_CLASS,
  allowedPartnerCategories,
  fieldApplies,
  isActiveStatus,
  type Entity,
  type Field,
} from "@/lib/siba/entities";
import { moduleByKey } from "@/lib/siba/nav";
import type { RefOption, Row } from "@/lib/siba/records";
import type { SystemDefaultKey } from "@/lib/siba/system-defaults";
import { formatDate, formatTimestamp, todayIso } from "@/lib/format";
import { recordTitle } from "./title";

export type FormMode = "new" | "view" | "edit";

export function EntityForm({
  entity,
  mode,
  row,
  refs,
  createdByEmail,
  updatedByEmail,
  can,
  headerActions,
  defaults,
}: {
  entity: Entity;
  mode: FormMode;
  row: Row | null;
  /** Keyed by field name, not by target table — see `refOptions` in records.ts. */
  refs: Record<string, RefOption[]>;
  createdByEmail?: string;
  updatedByEmail?: string;
  /** Presentation only — the Server Actions check the same permissions. */
  can: EntityAbilities;
  /**
   * Buttons an entity with a lifecycle of its own contributes to the detail
   * header — a Fiscal Year is activated, not edited into Open. The registry
   * describes fields, not lifecycles, so the escape hatch is a slot rather
   * than another config key nothing else would use.
   */
  headerActions?: React.ReactNode;
  /**
   * System Defaults, already resolved against their masters, used to fill a
   * create form in. Absent on view and edit: a default is a starting point for
   * a new record, never something that reaches an existing one.
   */
  defaults?: Partial<Record<SystemDefaultKey, number | null>>;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";
  const basePath = `/${entity.module}/${entity.slug}`;
  const moduleName = moduleByKey(entity.module)?.name ?? entity.module;
  /** Company has no write path at all — see `lib/siba/company.ts`. */
  const locked = isCompanyEntity(entity.slug);
  const canEdit = can.edit && !locked;
  const statusModel = entity.statusModel;

  const [values, setValues] = useState<FormValues>(() =>
    initialValues(entity, row, defaults)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [busyToggle, setBusyToggle] = useState(false);

  const active = statusModel
    ? isActiveStatus(statusModel, row?.[statusModel.field])
    : true;
  const canToggleStatus =
    Boolean(statusModel?.toggle) && (active ? can.deactivate : can.activate);

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

  /** The short label of the Budget Category currently chosen, if any. */
  const budgetCategoryLabel = (id: unknown) =>
    refs.budget_category_id?.find((o) => o.id === Number(id))?.label;

  const applies = (field: Field) =>
    fieldApplies(field, values, budgetCategoryLabel);

  /**
   * The code a `segment` field continues — the first of its `inheritsFrom`
   * fields that has a value. Shown beside the input so the number being typed
   * is read in full; the Server Action resolves the same prefix from the
   * database and composes the code there.
   */
  const inheritedCode = (field: Field): string | null => {
    for (const name of field.inheritsFrom ?? []) {
      const id = Number(values[name] ?? 0);
      if (!id) continue;
      return refs[name]?.find((o) => o.id === id)?.label ?? null;
    }
    return null;
  };

  /**
   * The half of a ref narrowing that depends on what is being entered right
   * now. The server already applied the structural half when it built these
   * options, and re-checks the whole rule when the form is submitted.
   */
  const optionsFor = (field: Field): RefOption[] => {
    const all = refs[field.name] ?? [];
    const companyId = Number(values.company_id ?? 0);

    switch (field.refFilter) {
      case "cashBankAccount":
      case "postableAccount":
        return companyId ? all.filter((o) => o.companyId === companyId) : [];
      case "parentAccount": {
        // A parent decides this account's number, so it has to sit in the same
        // Company and the same kelompok. `validateAccount` re-checks both.
        const subcategoryId = Number(values.account_subcategory_id ?? 0);
        if (!companyId || !subcategoryId) return [];
        return all.filter(
          (o) =>
            o.companyId === companyId &&
            o.subcategoryId === subcategoryId &&
            o.id !== row?.id
        );
      }
      case "mappingPartnerCategory": {
        const label = budgetCategoryLabel(values.budget_category_id);
        if (!label) return [];
        const allowed = allowedPartnerCategories(label);
        return all.filter((o) => allowed.includes(o.label));
      }
      default:
        return all;
    }
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
        `${title} sekarang ${result.active ? "aktif" : "nonaktif"}.`,
        "ok"
      );
      router.refresh();
    } else {
      toast("Gagal", result.message ?? "Status tidak dapat diubah.", "err");
    }
  };

  const label = entity.labelField ? String(row?.[entity.labelField] ?? "") : "";
  const title = recordTitle(entity, row, refs);
  const statusValue = statusModel ? String(row?.[statusModel.field] ?? "") : "";

  // A create-only field has nowhere to read a value back from — it was never a
  // column on this table — so it exists on the create form and nowhere else. A
  // derived field is the mirror image: never typed, but worth showing once it
  // has a value, so it appears read-only on the detail and not on either form.
  const visible = entity.fields.filter(
    (f) =>
      applies(f) &&
      !(f.createOnly && mode !== "new") &&
      !(f.derived && editing)
  );
  const statusFieldName = statusModel?.field;
  const businessFields = visible.filter(
    (f) => f.name !== "note" && f.name !== statusFieldName
  );
  const statusFields = visible.filter((f) => f.name === statusFieldName);
  const noteFields = visible.filter((f) => f.name === "note");

  const heading = mode === "new" ? `Tambah ${entity.single ?? entity.name}` : title;

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <Link href="/dashboard">{moduleName}</Link>
          <span>/</span>
          <Link href={basePath}>{entity.name}</Link>
          <span>/</span>
          <span className="cur">{mode === "new" ? "Baru" : title}</span>
        </div>

        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={entity.icon} size={16} />
            </span>
            {heading}
            {mode !== "new" && label && <span className="lab lg">{label}</span>}
            {mode === "view" && statusValue && (
              canToggleStatus ? (
                <button
                  className={`bdg ${STATUS_CLASS[statusValue] ?? "s-mute"}`}
                  title="Klik untuk mengubah status"
                  onClick={() => setConfirmToggle(true)}
                >
                  {STATUS_TEXT[statusValue] ?? statusValue}
                </button>
              ) : (
                <span className={`bdg ${STATUS_CLASS[statusValue] ?? "s-mute"}`}>
                  {STATUS_TEXT[statusValue] ?? statusValue}
                </span>
              )
            )}
            {mode === "edit" && <span className="bdg t-warn">Mode Ubah</span>}
          </h1>

          <div className="ph-act">
            {mode === "view" && headerActions}
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
                    prefix={f.type === "segment" ? inheritedCode(f) : null}
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
                    {statusModel?.toggle
                      ? "Data Inactive tidak muncul pada pilihan transaksi baru"
                      : "Draft belum dipakai · Open menerima posting · Closed terkunci"}
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
                      statusLike
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
                    {statusValue && (
                      <div className="mrow">
                        <span className="k">Status</span>
                        <span className="v">
                          <span className={`bdg ${STATUS_CLASS[statusValue] ?? "s-mute"}`}>
                            {STATUS_TEXT[statusValue] ?? statusValue}
                          </span>
                        </span>
                      </div>
                    )}
                    <div className="mrow">
                      <span className="k">Dibuat</span>
                      <span className="v">
                        {formatTimestamp(row?.created_at as string)}
                        <small>{createdByEmail ?? "—"}</small>
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
        icon={active ? "warn" : "check"}
        tone={active ? "danger" : "ok"}
        title={`Konfirmasi ${active ? "Nonaktifkan" : "Aktifkan"} Data`}
        subject={title}
        body={
          active
            ? "Data yang nonaktif tidak akan muncul lagi sebagai pilihan pada transaksi baru. Seluruh history dan referensi yang sudah ada tetap utuh."
            : "Data akan kembali tersedia sebagai pilihan pada transaksi baru."
        }
        confirmLabel={`Ya, ${active ? "Nonaktifkan" : "Aktifkan"}`}
        confirmTone={active ? "solid-danger" : "primary"}
        busy={busyToggle}
        onConfirm={onToggle}
        onCancel={() => setConfirmToggle(false)}
      />
    </>
  );
}

function initialValues(
  entity: Entity,
  row: Row | null,
  defaults?: Partial<Record<SystemDefaultKey, number | null>>
): FormValues {
  const out: FormValues = {};
  for (const f of entity.fields) {
    const preset = f.systemDefault ? defaults?.[f.systemDefault] : null;
    if (row) {
      const v = row[f.name];
      if (f.type === "bool") out[f.name] = Boolean(v);
      // Dates arrive as full ISO timestamps; `DateInput` works in `yyyy-mm-dd`
      // and shows `dd/mm/yyyy`, and the Server Action parses the ISO form back
      // at UTC midnight.
      else if (f.type === "date") out[f.name] = v == null ? null : String(v).slice(0, 10);
      else out[f.name] = v == null ? null : String(v);
    } else if (preset != null) {
      out[f.name] = String(preset);
    } else if (f.defaultValue != null) {
      out[f.name] = f.defaultValue as string | boolean;
    } else if (f.type === "bool") {
      out[f.name] = false;
    } else if (f.type === "date" && !f.derived && !f.locked) {
      // A date somebody types is almost always today's. A derived date is the
      // action's to write, so it is left alone.
      out[f.name] = todayIso();
    } else {
      out[f.name] = "";
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
  prefix,
  statusLike,
  onChange,
}: {
  field: Field;
  value: string | boolean | null | undefined;
  row: Row | null;
  editing: boolean;
  exists: boolean;
  error?: string;
  options: RefOption[];
  /** `segment` only: the code this field's number continues. */
  prefix?: string | null;
  /** This field carries the record's status, so a boolean reads Aktif/Non Aktif. */
  statusLike?: boolean;
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
          <span className={`bdg ${raw ? "s-ok" : "s-bad"}`}>
            {statusLike ? (raw ? "Aktif" : "Non Aktif") : raw ? "Ya" : "Tidak"}
          </span>
        </div>
      );
    } else if (field.type === "date") {
      body = raw ? (
        <div className="ro">{formatDate(raw as string)}</div>
      ) : (
        <div className="ro nil">tidak diisi</div>
      );
    } else if (field.type === "select") {
      const s = String(raw);
      const statusLike = STATUS_CLASS[s];
      body = (
        <div className="ro">
          <span className={`bdg ${statusLike ?? TAG_CLASS[s] ?? "t-slate"}`}>
            {STATUS_TEXT[s] ?? s}
          </span>
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
    // A caption that stands on its own gets the one-line control, so a form
    // full of toggles does not read as a wall of explanation.
    const compact = !field.captionDetail;
    return (
      <div className={wrapClass}>
        <label>{field.label}</label>
        <label className={`chk${compact ? " sm" : ""}${error ? " bad" : ""}`}>
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

  // One number continuing an inherited code. Until the field it inherits from
  // is chosen there is nothing to continue, so the input waits rather than
  // collecting a number that would have no place to go.
  if (field.type === "segment") {
    return (
      <div className={wrapClass}>
        {labelNode}
        <div className={`segf${error ? " bad" : ""}`}>
          <span className={`pfx${prefix ? "" : " nil"}`}>
            {prefix ? `${prefix}.` : "menunggu induk"}
          </span>
          <input
            value={value == null ? "" : String(value)}
            placeholder={field.placeholder}
            disabled={!prefix}
            inputMode="numeric"
            autoComplete="off"
            maxLength={3}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </div>
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
      <Select
        value={value == null ? "" : String(value)}
        options={[
          ...(field.required ? [] : [{ value: "", label: "— tidak diisi —" }]),
          ...(field.options ?? []).map((o) => ({
            value: o,
            label: field.optionLabels?.[o] ?? o,
          })),
        ]}
        placeholder={`Pilih ${field.label}…`}
        invalid={Boolean(error)}
        disabled={locked}
        onChange={onChange}
      />
    );
  } else if (field.type === "date") {
    control = (
      <DateInput
        value={value == null ? "" : String(value)}
        invalid={Boolean(error)}
        disabled={locked}
        onChange={onChange}
      />
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
        type={field.type === "number" ? "number" : "text"}
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
