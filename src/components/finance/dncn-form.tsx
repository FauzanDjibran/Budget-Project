"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { MoneyInput } from "@/components/ui/money-input";
import { RateInput } from "@/components/ui/rate-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import {
  createDncn,
  transitionDncn,
  updateDncn,
  type DncnValues,
} from "@/app/actions/dncn";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { originate, relieve } from "@/lib/siba/fx";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type { DncnLineRow, DncnRefs, DncnRow } from "@/lib/siba/dncn";
import {
  DNCN_TRANSITIONS,
  DNCN_TYPES,
  availableDncnActions,
  dncnDirection,
  dncnIsEditable,
  type DncnAbilities,
  type DncnAction,
  type DncnType,
} from "@/lib/siba/dncn-workflow";
import {
  headerButtonClass,
  orderForHeader,
  type ActionTone,
} from "@/lib/siba/header-actions";

export type DncnFormMode = "new" | "view" | "edit";

type DraftLine = { key: number; description: string; amount: number };

let nextKey = 1;

/**
 * Debit / Credit Note create / detail / edit.
 *
 * The header names the **position** being adjusted — a book, a Partner, a
 * currency — and shows where it stands and where the note would leave it. The
 * lines say why and by how much. Nothing on this screen moves a position: Post
 * does, and it is a separate, confirmed act.
 *
 * The preview runs the kernel the posting runs: `originate` for a note that
 * raises the position, `relieve` over the standing position for one that
 * lowers it — so the base figure shown is the one that will be written.
 */
export function DncnForm({
  mode,
  note,
  lines,
  refs,
  can,
}: {
  mode: DncnFormMode;
  note: DncnRow | null;
  lines: DncnLineRow[];
  refs: DncnRefs;
  can: DncnAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";

  const [values, setValues] = useState<DncnValues>(() => ({
    note_type: note?.note_type ?? "",
    budget_category_id: note ? String(note.budget_category_id) : "",
    partner_id: note ? String(note.partner_id) : "",
    currency_id: note ? String(note.currency_id) : "",
    exchange_rate: note?.exchange_rate && note.exchange_rate !== 1 ? String(note.exchange_rate) : "",
    reference: note?.reference ?? "",
    note: note?.note ?? "",
  }));

  const [draftLines, setDraftLines] = useState<DraftLine[]>(() =>
    lines.length
      ? lines.map((l) => ({ key: nextKey++, description: l.description, amount: l.amount }))
      : [{ key: nextKey++, description: "", amount: 0 }]
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<DncnAction | null>(null);
  const [busy, setBusy] = useState(false);

  const type = (values.note_type || null) as DncnType | null;
  const book = refs.books.find((b) => String(b.categoryId) === values.budget_category_id) ?? null;
  const partner = refs.partners.find((p) => String(p.id) === values.partner_id) ?? null;
  const currency = refs.currencies.find((c) => String(c.id) === values.currency_id) ?? null;
  const currencyLabel = currency?.label ?? note?.currency_label ?? "—";

  /** Whether the note raises the position — the book's own `raises` decides. */
  const raises = type && book ? dncnDirection(type) === book.raises : null;

  const standing =
    book && partner && currency
      ? refs.positions.find(
          (p) => p.book === book.key && p.partnerId === partner.id && p.currencyId === currency.id
        ) ?? { foreign: 0, base: 0 }
      : null;

  const asksRate = editing && Boolean(currency && !currency.isBase && raises);

  const set = (key: keyof DncnValues, value: string) => {
    setValues((v) => {
      const next = { ...v, [key]: value };
      // A Partner of a category the new book does not admit would be a header
      // the Server Action refuses while the field looks filled in.
      if (key === "budget_category_id") {
        const b = refs.books.find((x) => String(x.categoryId) === value);
        const p = refs.partners.find((x) => String(x.id) === v.partner_id);
        if (p && (!b || !b.partnerCategoryIds.includes(p.categoryId))) next.partner_id = "";
      }
      // A kurs belongs to one currency and to a note that raises its position.
      if (key === "currency_id" || key === "note_type" || key === "budget_category_id") {
        next.exchange_rate = "";
      }
      return next;
    });
    setDirty(true);
    setErrors((e) => {
      if (!e[key] && !e._form && !e._lines) return e;
      const next = { ...e };
      delete next[key];
      delete next._form;
      delete next._lines;
      return next;
    });
  };

  const partnerOptions = refs.partners
    .filter((p) => !book || book.partnerCategoryIds.includes(p.categoryId))
    .map((p) => ({ id: p.id, label: p.label, name: p.name, active: true }));

  // ------------------------------------------------------------- preview

  const total = editing
    ? draftLines.reduce((t, l) => t + (l.amount || 0), 0)
    : note?.note_amount ?? 0;

  /** What the note will write, or why it cannot — the posting's own arithmetic. */
  const preview = (() => {
    if (!standing || raises === null || !total) return null;
    if (standing.foreign < 0) return { refused: "Posisi sedang di bawah nol" } as const;
    if (!raises && total > standing.foreign) {
      return { refused: "Melebihi posisi yang tersisa" } as const;
    }
    const rate = currency?.isBase ? 1 : Number(values.exchange_rate);
    const base = raises
      ? rate > 0
        ? originate(total, rate).base
        : null
      : relieve(standing, total).base;
    return {
      refused: null,
      base,
      after: raises ? standing.foreign + total : standing.foreign - total,
    } as const;
  })();

  // ---------------------------------------------------------------- writes

  const onSave = async () => {
    setSaving(true);
    const payload = draftLines.map((l) => ({
      description: l.description,
      amount: String(l.amount || ""),
    }));
    const result =
      mode === "new"
        ? await createDncn(values, payload)
        : await updateDncn(note!.id, values, payload);
    setSaving(false);

    if (!result.ok) {
      setErrors(result.errors);
      toast(
        "Gagal menyimpan",
        result.errors._form ?? result.errors._lines ?? "Periksa kembali isian yang ditandai.",
        "err"
      );
      return;
    }
    setDirty(false);
    toast(
      mode === "new" ? "Nota dibuat" : "Perubahan disimpan",
      mode === "new" ? `${result.note_no} dibuat otomatis. Nota masih Draft.` : note?.note_no,
      "ok"
    );
    router.push(`/finance/debit-credit-note/${result.id}`);
    router.refresh();
  };

  const run = async (action: DncnAction) => {
    if (!note) return;
    setBusy(true);
    const result = await transitionDncn(note.id, action);
    setBusy(false);
    setConfirm(null);
    if (result.ok) {
      toast(result.message, note.note_no, "ok");
      router.refresh();
      return;
    }
    toast("Tidak dapat diproses", result.errors._form ?? Object.values(result.errors)[0], "err");
  };

  // ---------------------------------------------------------------- render

  const listHref = "/finance/debit-credit-note";
  const backHref = note ? `${listHref}/${note.id}` : listHref;
  const actions = note ? availableDncnActions(note.status, can) : [];

  const viewActions: { key: string; tone: ActionTone; node: React.ReactNode }[] = note
    ? orderForHeader(
        [
          ...(can.edit && dncnIsEditable(note.status)
            ? [
                {
                  key: "edit",
                  tone: "neutral" as ActionTone,
                  node: (
                    <Link key="edit" className="btn" href={`${listHref}/${note.id}/edit`}>
                      <Icon name="pen" size={15} /> Ubah
                    </Link>
                  ),
                },
              ]
            : []),
          ...actions.map((a) => {
            const t = DNCN_TRANSITIONS[a];
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

  const effectText =
    raises === null ? null : raises ? "menaikkan posisi" : "menurunkan posisi";

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <Link href={listHref}>Finance</Link>
          <span>/</span>
          <Link href={listHref}>Debit / Credit Note</Link>
          <span>/</span>
          <span className="cur">{mode === "new" ? "Baru" : note?.note_no}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="pen" size={16} />
            </span>
            {note ? (
              <>
                <span className="docno">{note.note_no}</span>
                <span className={`bdg ${STATUS_CLASS[note.status] ?? "s-mute"}`}>
                  {STATUS_TEXT[note.status] ?? note.status}
                </span>
              </>
            ) : (
              "Nota Baru"
            )}
            {mode === "edit" && <span className="bdg t-vio">Mode Ubah</span>}
          </h1>
          <div className="ph-act">
            {editing && dirty && (
              <span className="ph-dirty">
                <span className="pulse" /> Belum disimpan
              </span>
            )}
            {mode === "view" && note && (
              <>
                {viewActions.map((i) => i.node)}
                {!actions.length && (
                  <span className="lockchip">
                    <Icon name="lock" size={13} />{" "}
                    {note.status === "Posted" ? "Terkunci setelah Post" : "Nota dibatalkan"}
                  </span>
                )}
              </>
            )}
            {editing && (
              <>
                <Link className="btn" href={backHref}>
                  <Icon name="back" size={15} /> Batal
                </Link>
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

      <div className="fgrid">
        <div>
          <div className="card">
            <div className="card-h">
              <span className="ci">
                <Icon name="users" size={15} />
              </span>
              <div className="ct">
                <h3>Posisi yang Disesuaikan</h3>
                <p>
                  Satu nota menyesuaikan satu posisi: satu buku subjek, satu Partner,
                  satu currency. Tidak ada uang yang berpindah.
                </p>
              </div>
            </div>
            <FormBody>
              <FormSection>
                <FormRow>
                  <Field
                    label="Jenis Nota"
                    span={3}
                    required={mode === "new"}
                    help={type ? DNCN_TYPES[type].desc : undefined}
                    error={errors.note_type}
                  >
                    {mode === "new" ? (
                      <Select
                        value={values.note_type}
                        invalid={Boolean(errors.note_type)}
                        placeholder="Pilih jenis nota…"
                        options={(Object.keys(DNCN_TYPES) as DncnType[]).map((t) => ({
                          value: t,
                          label: DNCN_TYPES[t].label,
                          hint: DNCN_TYPES[t].short,
                        }))}
                        onChange={(v) => set("note_type", v)}
                      />
                    ) : (
                      <div className="ro">
                        <span>{type ? DNCN_TYPES[type].label : "—"}</span>
                      </div>
                    )}
                  </Field>

                  <Field
                    label="Buku Subjek"
                    span={3}
                    required={editing}
                    error={errors.budget_category_id}
                  >
                    {editing ? (
                      <Select
                        value={values.budget_category_id}
                        invalid={Boolean(errors.budget_category_id)}
                        placeholder="Pilih buku subjek…"
                        options={refs.books.map((b) => ({
                          value: String(b.categoryId),
                          label: b.name,
                        }))}
                        onChange={(v) => set("budget_category_id", v)}
                      />
                    ) : (
                      <div className="ro">
                        <span>{book?.name ?? note!.book_name}</span>
                      </div>
                    )}
                  </Field>

                  <Field label="Partner" span={3} required={editing} error={errors.partner_id}>
                    {editing ? (
                      <Combobox
                        value={values.partner_id ? Number(values.partner_id) : null}
                        options={partnerOptions}
                        placeholder="Pilih Partner…"
                        waitingFor={book ? null : "Pilih Buku Subjek dulu…"}
                        invalid={Boolean(errors.partner_id)}
                        onChange={(v) => set("partner_id", v ? String(v) : "")}
                      />
                    ) : (
                      <div className="ro">
                        <span className="lab">{note!.partner_label}</span>
                        <span>{note!.partner_name}</span>
                      </div>
                    )}
                  </Field>

                  <Field label="Currency" span={3} required={editing} error={errors.currency_id}>
                    {editing ? (
                      <Combobox
                        value={values.currency_id ? Number(values.currency_id) : null}
                        options={refs.currencies.map((c) => ({
                          id: c.id,
                          label: c.label,
                          name: c.name,
                          active: true,
                        }))}
                        placeholder="Pilih currency…"
                        invalid={Boolean(errors.currency_id)}
                        onChange={(v) => set("currency_id", v ? String(v) : "")}
                      />
                    ) : (
                      <div className="ro">
                        <span className="lab">{currencyLabel}</span>
                      </div>
                    )}
                  </Field>
                </FormRow>

                <FormRow>
                  <Field label="Posisi Saat Ini" span={3}>
                    <div className="ro">
                      {standing ? (
                        <span className="mny">{formatMoney(standing.foreign, currencyLabel)}</span>
                      ) : (
                        <span className="dash">{editing ? "pilih posisinya dulu" : "—"}</span>
                      )}
                    </div>
                  </Field>

                  <Field
                    label="Kurs"
                    span={3}
                    required={asksRate}
                    help={
                      asksRate
                        ? "nilai 1 unit dalam mata uang dasar"
                        : undefined
                    }
                    error={errors.exchange_rate}
                  >
                    {asksRate ? (
                      <RateInput
                        value={values.exchange_rate}
                        pairLabel={`${currencyLabel} → ${BASE_CURRENCY_LABEL}`}
                        invalid={Boolean(errors.exchange_rate)}
                        onChange={(v) => set("exchange_rate", v)}
                      />
                    ) : (
                      <div className="ro">
                        {!currency ? (
                          <span className="dash">—</span>
                        ) : currency.isBase ? (
                          <span>mata uang dasar</span>
                        ) : note?.exchange_rate ? (
                          <span className="mny">{formatRate(note.exchange_rate)}</span>
                        ) : (
                          <span>mengikuti kurs tercatat posisi</span>
                        )}
                      </div>
                    )}
                  </Field>

                  <Field label="Referensi" span={3} help={editing ? "nomor dokumen pihak lain" : undefined}>
                    {editing ? (
                      <input
                        className="inp"
                        type="text"
                        autoComplete="off"
                        value={values.reference}
                        placeholder="Opsional"
                        onChange={(e) => set("reference", e.target.value)}
                      />
                    ) : (
                      <div className="ro">{note!.reference || <span className="dash">—</span>}</div>
                    )}
                  </Field>

                  <Field label="Tanggal Dokumen" span={3}>
                    <div className="ro">
                      {note?.document_date ? (
                        formatDate(note.document_date)
                      ) : (
                        <span className="dash">dicatat saat diposting</span>
                      )}
                    </div>
                  </Field>
                </FormRow>

                <FormRow>
                  <Field label="Catatan" span={12}>
                    {editing ? (
                      <textarea
                        className="ta"
                        rows={2}
                        value={values.note}
                        onChange={(e) => set("note", e.target.value)}
                        placeholder="Keterangan tambahan untuk nota ini…"
                      />
                    ) : (
                      <div className="ro">{note!.note || <span className="dash">—</span>}</div>
                    )}
                  </Field>
                </FormRow>
              </FormSection>
            </FormBody>

            {mode === "view" && (
              <p className="fnote">
                {note!.status === "Posted"
                  ? "Nota sudah menyesuaikan posisi Partner pada buku subjek dan Journal-nya sudah tercatat. Koreksi dilakukan dengan nota berlawanan."
                  : note!.status === "Draft"
                    ? "Nota masih Draft. Posisi Partner belum berubah, dan Tanggal Dokumen belum dicatat."
                    : "Nota dibatalkan sebelum Post, sehingga tidak pernah menyentuh posisi mana pun."}
              </p>
            )}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="file" size={15} />
              </span>
              <div className="ct">
                <h3>Rincian</h3>
                <p>Alasan penyesuaian dan nominalnya, dalam currency posisi.</p>
              </div>
              {editing ? (
                <button
                  className="btn sm primary"
                  onClick={() => {
                    setDraftLines((rows) => [...rows, { key: nextKey++, description: "", amount: 0 }]);
                    setDirty(true);
                  }}
                >
                  <Icon name="plus" size={14} /> Tambah Baris
                </button>
              ) : (
                <span className="hint">{lines.length} baris</span>
              )}
            </div>

            {errors._lines && (
              <div className="nbox bad slim">
                <span className="ni">
                  <Icon name="warn" size={14} />
                </span>
                <div>
                  <b>{errors._lines}</b>
                </div>
              </div>
            )}

            <div className="tw">
              <table className="grid ltab">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>No</th>
                    <th>Alasan</th>
                    <th className="num" style={{ width: 190 }}>
                      Nominal ({currencyLabel})
                    </th>
                    {editing && <th style={{ width: 44 }} />}
                  </tr>
                </thead>
                <tbody>
                  {editing
                    ? draftLines.map((l, i) => (
                        <tr key={l.key}>
                          <td className="no">{i + 1}</td>
                          <td className="pri">
                            <input
                              className="inp sm"
                              type="text"
                              autoComplete="off"
                              value={l.description}
                              placeholder="Diskon pelunasan, retur barang, koreksi tagihan…"
                              aria-label="Alasan"
                              onChange={(e) => {
                                const v = e.target.value;
                                setDraftLines((rows) =>
                                  rows.map((r) => (r.key === l.key ? { ...r, description: v } : r))
                                );
                                setDirty(true);
                              }}
                            />
                          </td>
                          <td className="num">
                            <MoneyInput
                              size="sm"
                              ariaLabel="Nominal"
                              over={preview?.refused != null}
                              value={l.amount ? String(l.amount) : ""}
                              onChange={(raw) => {
                                setDraftLines((rows) =>
                                  rows.map((r) =>
                                    r.key === l.key ? { ...r, amount: raw ? Number(raw) : 0 } : r
                                  )
                                );
                                setDirty(true);
                              }}
                            />
                          </td>
                          <td className="acts">
                            <button
                              className="iact del"
                              title="Keluarkan dari nota"
                              disabled={draftLines.length === 1}
                              onClick={() => {
                                setDraftLines((rows) => rows.filter((r) => r.key !== l.key));
                                setDirty(true);
                              }}
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          </td>
                        </tr>
                      ))
                    : lines.map((l, i) => (
                        <tr key={l.id}>
                          <td className="no">{i + 1}</td>
                          <td className="pri">{l.description}</td>
                          <td className="num">
                            <span className="mny">{formatMoney(l.amount, currencyLabel)}</span>
                            {note?.status === "Posted" && currency && !currency.isBase && (
                              <span className="rsub">
                                {formatMoney(l.base_amount, BASE_CURRENCY_LABEL)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                </tbody>
                <tfoot>
                  <tr className="totrow">
                    <td colSpan={2} style={{ textAlign: "right" }}>
                      Total {type ? DNCN_TYPES[type].label : "Nota"}
                      {effectText ? ` · ${effectText}` : ""}
                    </td>
                    <td className="num">
                      <span className="mny big">{formatMoney(total, currencyLabel)}</span>
                    </td>
                    {editing && <td />}
                  </tr>
                  {editing && preview && (
                    <tr className="totrow">
                      <td colSpan={2} style={{ textAlign: "right" }}>
                        {preview.refused ? "Tidak dapat diposting" : "Posisi Setelah Nota"}
                      </td>
                      <td className="num">
                        {preview.refused ? (
                          <span className="overtag">{preview.refused}</span>
                        ) : (
                          <span className="mny">{formatMoney(preview.after, currencyLabel)}</span>
                        )}
                      </td>
                      <td />
                    </tr>
                  )}
                  {currency && !currency.isBase && (note?.status === "Posted" || (editing && preview && !preview.refused && preview.base !== null)) && (
                    <tr className="totrow">
                      <td colSpan={2} style={{ textAlign: "right" }}>
                        Nilai dalam {BASE_CURRENCY_LABEL}
                      </td>
                      <td className="num">
                        <span className="mny">
                          {formatMoney(
                            note?.status === "Posted"
                              ? note.note_base_amount
                              : (preview as { base: number }).base,
                            BASE_CURRENCY_LABEL
                          )}
                        </span>
                      </td>
                      {editing && <td />}
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>

      {confirm && note && (
        <ConfirmDialog
          open
          icon={DNCN_TRANSITIONS[confirm].icon}
          tone={DNCN_TRANSITIONS[confirm].tone === "danger" ? "danger" : "ok"}
          title={DNCN_TRANSITIONS[confirm].title}
          subject={`${note.note_no} – ${formatMoney(note.note_amount, currencyLabel)}`}
          body={DNCN_TRANSITIONS[confirm].body}
          confirmLabel={DNCN_TRANSITIONS[confirm].confirmLabel}
          confirmTone={DNCN_TRANSITIONS[confirm].tone === "danger" ? "solid-danger" : "primary"}
          busy={busy}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
