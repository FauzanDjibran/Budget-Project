"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { headerButtonClass, type ActionTone } from "@/lib/siba/header-actions";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Select } from "@/components/ui/select";
import { MoneyInput } from "@/components/ui/money-input";
import { RateInput } from "@/components/ui/rate-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  Field as FormField,
  FormRow,
  FormSection,
  type FieldSpan,
} from "@/components/ui/form";
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
import { formatDate, formatMoney, formatRate, todayIso } from "@/lib/format";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "@/lib/siba/currency";
import { recordTitle } from "@/lib/siba/record-title";

export type FormMode = "new" | "view" | "edit";

export function EntityForm({
  entity,
  mode,
  row,
  refs,
  can,
  headerActions,
  editTone = "primary",
  defaults,
  lockedFields,
  lockNote,
}: {
  entity: Entity;
  mode: FormMode;
  row: Row | null;
  /** Keyed by field name, not by target table — see `refOptions` in records.ts. */
  refs: Record<string, RefOption[]>;
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
   * How prominent Ubah is, and therefore where it sits. A header carries one
   * primary and it is the rightmost button, so when `headerActions` supplies
   * the screen's chief action — activating a Fiscal Year — Ubah steps down to
   * neutral and moves to its left. See `lib/siba/header-actions.ts`.
   */
  editTone?: ActionTone;
  /**
   * System Defaults, already resolved against their masters, used to fill a
   * create form in. Absent on view and edit: a default is a starting point for
   * a new record, never something that reaches an existing one.
   */
  defaults?: Partial<Record<SystemDefaultKey, number | null>>;
  /**
   * Fields this particular record may not edit, where the registry cannot say
   * so because it depends on the row rather than on the entity — an account
   * that has gained a sub-account no longer decides whether it is postable.
   */
  lockedFields?: string[];
  /** Why those fields are locked, as a closing note at the foot of the card. */
  lockNote?: string;
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

  /** The short label of the Currency currently chosen, if any. */
  const currencyLabel = (id: unknown) =>
    refs.currency_id?.find((o) => o.id === Number(id))?.label;

  const applies = (field: Field) =>
    fieldApplies(field, values, budgetCategoryLabel, currencyLabel);

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
  /** The currency a `money` field is denominated in, for the label in its box. */
  const currencyLabelOf = (field: Field): string | undefined => {
    if (!field.currencyFrom) return undefined;
    const id = Number(values[field.currencyFrom] ?? 0);
    if (!id) return undefined;
    return refs[field.currencyFrom]?.find((o) => o.id === id)?.label;
  };

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

  // Before the first save there is no code and no status to show, so the
  // heading is a placeholder identity rather than a summary of blanks.
  const heading = mode === "new" ? `${entity.single ?? entity.name} Baru` : title;
  const code = mode === "new" ? "" : String(row?.[entity.codeField] ?? "");

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
            {/* A master record is known by its name, so the name stays the
                heading; the system code is its technical reference and belongs
                beside it rather than in a card of its own. */}
            {code && <span className="docno sm">{code}</span>}
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
            {editing && dirty && (
              <span className="ph-dirty">
                <span className="pulse" /> Belum disimpan
              </span>
            )}
            {mode === "view" && editTone === "primary" && headerActions}
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
              <Link
                className={headerButtonClass(editTone)}
                href={`${basePath}/${row!.id}/edit`}
              >
                <Icon name="pen" size={15} /> Ubah
              </Link>
            ) : null}
            {mode === "view" && editTone !== "primary" && headerActions}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>
          <div className="card">
            <FormSection>
              <FormRow>
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
                    currencyLabel={currencyLabelOf(f)}
                    forceLocked={lockedFields?.includes(f.name)}
                    onChange={(v) => setField(f, v)}
                  />
                ))}
              </FormRow>
            </FormSection>

            {statusFields.length > 0 && (
              // No section hint: the status field's own help says the same
              // thing, and with help now on the label row the two sat one line
              // apart.
              <FormSection title="Status Data">
                <FormRow>
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
                      forceLocked={lockedFields?.includes(f.name)}
                      onChange={(v) => setField(f, v)}
                    />
                  ))}
                </FormRow>
              </FormSection>
            )}

            {noteFields.length > 0 && (
              <FormSection>
                <FormRow>
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
                      forceLocked={lockedFields?.includes(f.name)}
                      onChange={(v) => setField(f, v)}
                    />
                  ))}
                </FormRow>
              </FormSection>
            )}

            {/* Company is create- and edit-locked (CLAUDE.md §12). The badge in
                the header says so; the reason belongs beside the fields it
                explains rather than in a subtitle above the whole page. */}
            {locked && <p className="fnote">{COMPANY_LOCK_BODY}</p>}
            {!locked && lockNote && <p className="fnote">{lockNote}</p>}
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
  currencyLabel,
  statusLike,
  forceLocked,
  onChange,
}: {
  field: Field;
  value: string | boolean | null | undefined;
  row: Row | null;
  editing: boolean;
  exists: boolean;
  /** Locked for this row rather than for the entity — see `lockedFields`. */
  forceLocked?: boolean;
  error?: string;
  options: RefOption[];
  /** `segment` only: the code this field's number continues. */
  prefix?: string | null;
  /** `money` only: the currency the amount is in. */
  currencyLabel?: string;
  /** This field carries the record's status, so a boolean reads Aktif/Non Aktif. */
  statusLike?: boolean;
  onChange: (value: string | boolean | null) => void;
}) {
  const locked = Boolean((field.locked || forceLocked) && exists);
  // Three columns by default: a master record's fields are short, and two
  // columns left a date picker in a 500px box. `full` and a textarea still take
  // the whole row, and a field that needs a different share says so in the
  // registry.
  const span: FieldSpan =
    field.span ?? (field.full || field.type === "textarea" ? 12 : 4);

  const node = editing
    ? editableControl({ field, value, locked, error, options, prefix, currencyLabel, onChange })
    : readOnlyBody({ field, row, options, currencyLabel, statusLike });

  return (
    <FormField
      label={field.label}
      span={span}
      required={editing && field.required}
      locked={locked && editing}
      help={editing ? field.help : undefined}
      error={error}
    >
      {node}
    </FormField>
  );
}

/** How a saved value presents itself — as text, never as a disabled input. */
function readOnlyBody({
  field,
  row,
  options,
  currencyLabel,
  statusLike,
}: {
  field: Field;
  row: Row | null;
  options: RefOption[];
  currencyLabel?: string;
  statusLike?: boolean;
}): React.ReactNode {
  const raw = row?.[field.name];

  if (field.type === "ref") {
    const opt = options.find((o) => o.id === Number(raw));
    return opt ? (
      <div className="ro">
        <span className="lab">{opt.label}</span>
        <span>{opt.name}</span>
      </div>
    ) : (
      <div className="ro nil">tidak diisi</div>
    );
  }
  if (field.type === "bool") {
    return (
      <div className="ro">
        <span className={`bdg ${raw ? "s-ok" : "s-bad"}`}>
          {statusLike ? (raw ? "Aktif" : "Non Aktif") : raw ? "Ya" : "Tidak"}
        </span>
      </div>
    );
  }
  if (field.type === "date") {
    return raw ? (
      <div className="ro">{formatDate(raw as string)}</div>
    ) : (
      <div className="ro nil">tidak diisi</div>
    );
  }
  if (field.type === "select") {
    const s = String(raw);
    return (
      <div className="ro">
        <span className={`bdg ${STATUS_CLASS[s] ?? TAG_CLASS[s] ?? "t-slate"}`}>
          {STATUS_TEXT[s] ?? s}
        </span>
      </div>
    );
  }
  if (field.type === "money") {
    return raw == null || raw === "" ? (
      <div className="ro nil">tidak diisi</div>
    ) : (
      <div className="ro">
        <span className="mny">{formatMoney(raw as number, currencyLabel ?? "IDR")}</span>
      </div>
    );
  }
  if (field.type === "rate") {
    return raw == null || raw === "" ? (
      <div className="ro nil">tidak diisi</div>
    ) : (
      <div className="ro">
        <span className="mny">{formatRate(raw as number)}</span>
      </div>
    );
  }
  if (field.type === "textarea") {
    return raw ? (
      <div className="ro multi">{String(raw)}</div>
    ) : (
      <div className="ro multi nil">tidak diisi</div>
    );
  }
  if (field.ident) {
    return raw ? (
      <div className="ro">
        <span className="lab">{String(raw)}</span>
      </div>
    ) : (
      <div className="ro nil">tidak diisi</div>
    );
  }
  return raw == null || raw === "" ? (
    <div className="ro nil">tidak diisi</div>
  ) : (
    <div className="ro">{String(raw)}</div>
  );
}

function editableControl({
  field,
  value,
  locked,
  error,
  options,
  prefix,
  currencyLabel,
  onChange,
}: {
  field: Field;
  value: string | boolean | null | undefined;
  locked: boolean;
  error?: string;
  options: RefOption[];
  prefix?: string | null;
  currencyLabel?: string;
  onChange: (value: string | boolean | null) => void;
}): React.ReactNode {
  if (field.type === "bool") {
    // A caption that stands on its own gets the one-line control, so a form
    // full of toggles does not read as a wall of explanation.
    const compact = !field.captionDetail;
    return (
      <label
        className={`chk${compact ? " sm" : ""}${error ? " bad" : ""}${
          locked ? " dis" : ""
        }`}
      >
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={locked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          <span className="ct">{field.caption ?? "Aktif"}</span>
          {field.captionDetail && <span className="cd">{field.captionDetail}</span>}
        </span>
      </label>
    );
  }

  // One number continuing an inherited code. Until the field it inherits from
  // is chosen there is nothing to continue, so the input waits rather than
  // collecting a number that would have no place to go.
  if (field.type === "segment") {
    return (
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
    );
  }

  if (field.type === "ref") {
    return (
      <Combobox
        value={value == null || value === "" ? null : Number(value)}
        options={options}
        placeholder={`Pilih ${field.label}…`}
        invalid={Boolean(error)}
        disabled={locked}
        onChange={(v) => onChange(v == null ? null : String(v))}
      />
    );
  }
  if (field.type === "select") {
    return (
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
  }
  if (field.type === "date") {
    return (
      <DateInput
        value={value == null ? "" : String(value)}
        invalid={Boolean(error)}
        disabled={locked}
        onChange={onChange}
      />
    );
  }
  if (field.type === "money") {
    return (
      <MoneyInput
        value={value == null ? "" : String(value)}
        currencyLabel={currencyLabel}
        invalid={Boolean(error)}
        disabled={locked}
        placeholder={field.placeholder ?? "0"}
        onChange={onChange}
      />
    );
  }
  if (field.type === "rate") {
    // The pair the rate converts, inside the box, so it reads in a direction
    // rather than as a bare number.
    const pair =
      currencyLabel && !isBaseCurrency(currencyLabel)
        ? `${currencyLabel} → ${BASE_CURRENCY_LABEL}`
        : undefined;
    return (
      <RateInput
        value={value == null ? "" : String(value)}
        pairLabel={pair}
        invalid={Boolean(error)}
        disabled={locked}
        placeholder={field.placeholder ?? "0"}
        onChange={onChange}
      />
    );
  }
  if (field.type === "textarea") {
    return (
      <textarea
        className={`ta${error ? " bad" : ""}`}
        rows={2}
        value={value == null ? "" : String(value)}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      className={`inp${field.ident ? " idf" : ""}${error ? " bad" : ""}`}
      type="text"
      inputMode={field.type === "number" ? "numeric" : undefined}
      value={value == null ? "" : String(value)}
      placeholder={field.placeholder}
      disabled={locked}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}