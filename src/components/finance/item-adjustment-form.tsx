"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { DocumentHeader } from "@/components/ui/document-header";
import { CancelButton } from "@/components/ui/cancel-button";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { MoneyInput } from "@/components/ui/money-input";
import { DateInput } from "@/components/ui/date-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { useToast } from "@/components/ui/toast";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import {
  createItemAdjustment,
  previewItemAdjustmentPost,
  transitionItemAdjustment,
  updateItemAdjustment,
  type ItemAdjustmentValues,
} from "@/app/actions/item-adjustment";
import { formatDate, formatForeignFace, formatMoney, formatRate, todayIso } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { relieve, roundBase } from "@/lib/siba/fx";
import type {
  ItemAdjustmentLineRow,
  ItemAdjustmentRefs,
  ItemAdjustmentRow,
} from "@/lib/siba/item-adjustment";
import {
  ITEM_ADJUSTMENT_EFFECTS,
  ITEM_ADJUSTMENT_TRANSITIONS,
  availableItemAdjustmentActions,
  effectOfChange,
  itemAdjustmentIsEditable,
  type ItemAdjustmentAbilities,
  type ItemAdjustmentAction,
  type ItemAdjustmentEffect,
} from "@/lib/siba/item-adjustment-workflow";
import {
  headerButtonClass,
  orderForHeader,
  type ActionTone,
} from "@/lib/siba/header-actions";

export type ItemAdjustmentFormMode = "new" | "view" | "edit";

type DraftLine = {
  key: number;
  /** The open item, as a picker value. */
  item_id: string;
  /** The value the item should now hold, unformatted; "" while untyped. */
  new_amount: string;
};

let nextKey = 1;

/** What a line will do, worked out the way the Server Action does. */
type LinePreview = {
  effect: ItemAdjustmentEffect;
  /** Signed: positive raises the item, negative lowers it. */
  change: number;
  /** The change in base, signed the same way. */
  base: number;
  rate: number;
};

/**
 * Penyesuaian Open Item create / detail / edit.
 *
 * The header names the **position** being adjusted — a book, a Partner, a
 * currency. Every line names one of its open items and the value it should
 * now hold; the difference beside it, and whether that is a Penambahan or a
 * Pengurangan, is never typed. The line's description is written by the
 * system. Nothing on this screen moves a position: Post does, and it is a
 * separate, confirmed act.
 *
 * The figures in IDR are the kernel's own, each item at its own kurs —
 * `difference × kurs` on a raise, `relieve` on a lowering — the same
 * arithmetic the saved draft and Post write.
 */
export function ItemAdjustmentForm({
  mode,
  doc,
  lines,
  refs,
  can,
}: {
  mode: ItemAdjustmentFormMode;
  doc: ItemAdjustmentRow | null;
  lines: ItemAdjustmentLineRow[];
  refs: ItemAdjustmentRefs;
  can: ItemAdjustmentAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";

  const [values, setValues] = useState<ItemAdjustmentValues>(() => ({
    budget_category_id: doc ? String(doc.budget_category_id) : "",
    partner_id: doc ? String(doc.partner_id) : "",
    currency_id: doc ? String(doc.currency_id) : "",
    exchange_rate: doc?.exchange_rate && doc.exchange_rate !== 1 ? String(doc.exchange_rate) : "",
    // Today, as every editable date starts (§10 rule 33); moved back for a
    // backdated document.
    document_date: doc?.document_date ?? todayIso(),
    reference: doc?.reference ?? "",
    note: doc?.note ?? "",
  }));

  const [draftLines, setDraftLines] = useState<DraftLine[]>(() =>
    lines.length
      ? lines.map((l) => ({
          key: nextKey++,
          item_id: l.itemId ? String(l.itemId) : "",
          new_amount: l.new_amount != null ? String(l.new_amount) : "",
        }))
      : [{ key: nextKey++, item_id: "", new_amount: "" }]
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ItemAdjustmentAction | null>(null);
  const [busy, setBusy] = useState(false);
  // Post is answerable once its journal preview has loaded and not refused.
  const [postReady, setPostReady] = useState(false);

  const book = refs.books.find((b) => String(b.categoryId) === values.budget_category_id) ?? null;
  const partner = refs.partners.find((p) => String(p.id) === values.partner_id) ?? null;
  const currency = refs.currencies.find((c) => String(c.id) === values.currency_id) ?? null;
  const currencyLabel = currency?.label ?? doc?.currency_label ?? "—";
  const foreign = currency ? !currency.isBase : doc ? doc.currency_label !== BASE_CURRENCY_LABEL : false;

  const standing =
    book && partner && currency
      ? refs.positions.find(
          (p) => p.bookId === book.categoryId && p.partnerId === partner.id && p.currencyId === currency.id
        ) ?? { foreign: 0, base: 0 }
      : null;

  /** The items this position still holds open — what every line picks from. */
  const positionItems =
    book && partner && currency
      ? refs.items.filter(
          (i) => i.bookId === book.categoryId && i.partnerId === partner.id && i.currencyId === currency.id
        )
      : [];


  /** What the first missing header field is — the clause a line waits on. */
  const lineWaitingFor = !book
      ? "Pilih Buku Subjek dulu…"
      : !partner
        ? "Pilih Partner dulu…"
        : !currency
          ? "Pilih Currency dulu…"
          : null;

  const set = (key: keyof ItemAdjustmentValues, value: string) => {
    setValues((v) => {
      const next = { ...v, [key]: value };
      // A Partner of a category the new book does not admit would be a header
      // the Server Action refuses while the field looks filled in.
      if (key === "budget_category_id") {
        const b = refs.books.find((x) => String(x.categoryId) === value);
        const p = refs.partners.find((x) => String(x.id) === v.partner_id);
        if (p && (!b || !b.partnerCategoryIds.includes(p.categoryId))) next.partner_id = "";
      }
      return next;
    });
    // The items the lines chose belong to one position.
    if (key !== "exchange_rate" && key !== "document_date" && key !== "reference" && key !== "note") {
      setDraftLines((rows) => rows.map((r) => (r.item_id ? { ...r, item_id: "", new_amount: "" } : r)));
    }
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

  const setLine = (key: number, patch: Partial<DraftLine>) => {
    setDraftLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const partnerOptions = refs.partners
    .filter((p) => !book || book.partnerCategoryIds.includes(p.categoryId))
    .map((p) => ({ id: p.id, label: p.label, name: p.name, active: true }));

  // ------------------------------------------------------------- preview

  const itemsById = new Map(positionItems.map((i) => [String(i.id), i]));

  /**
   * What each draft line will do, or null while its item or new value is
   * missing or the value moves nothing. Every item moves at its own kurs.
   */
  const previews: (LinePreview | null)[] = draftLines.map((l) => {
    const item = itemsById.get(l.item_id);
    if (!item || l.new_amount === "") return null;
    const target = Number(l.new_amount);
    const effect = effectOfChange(item.remaining, target);
    if (!effect || target < 0) return null;
    const amount = roundBase(Math.abs(target - item.remaining));
    const base =
      effect === "Increase"
        ? roundBase(amount * item.rate)
        : relieve(
            { foreign: item.remaining, base: item.baseRemaining },
            Math.round(amount * 100) === Math.round(item.remaining * 100) ? item.remaining : amount
          ).base;
    const sign = effect === "Increase" ? 1 : -1;
    return { effect, change: sign * amount, base: sign * base, rate: item.rate };
  });

  const savedPreviews: LinePreview[] = lines.map((l) => {
    const sign = l.effect === "Increase" ? 1 : -1;
    return { effect: l.effect, change: sign * l.amount, base: sign * l.base_amount, rate: l.rate };
  });

  const net = editing
    ? roundBase(previews.reduce((t, p) => t + (p?.change ?? 0), 0))
    : doc?.adjustment_amount ?? 0;
  const netBase = editing
    ? roundBase(previews.reduce((t, p) => t + (p?.base ?? 0), 0))
    : doc?.adjustment_base_amount ?? 0;
  const after = standing ? roundBase(standing.foreign + net) : null;

  /** The items no other line has taken — one item is adjusted once. */
  const optionsFor = (key: number) => {
    const taken = new Set(draftLines.filter((r) => r.key !== key).map((r) => r.item_id));
    return positionItems
      .filter((i) => !taken.has(String(i.id)))
      .map((i) => ({
        value: String(i.id),
        label: `${i.itemNo} · ${formatDate(i.date)}`,
        hint: foreign
          ? `${formatMoney(i.remaining, currencyLabel)} @ ${formatRate(i.rate)}`
          : formatMoney(i.remaining, currencyLabel),
      }));
  };

  // ---------------------------------------------------------------- writes

  const onSave = async () => {
    setSaving(true);
    const payload = draftLines.map((l) => ({ item_id: l.item_id, new_amount: l.new_amount }));
    const result =
      mode === "new"
        ? await createItemAdjustment(values, payload)
        : await updateItemAdjustment(doc!.id, values, payload);
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
      mode === "new" ? "Penyesuaian dibuat" : "Perubahan disimpan",
      mode === "new"
        ? `${result.adjustment_no} dibuat otomatis. Dokumen masih Draft.`
        : doc?.adjustment_no,
      "ok"
    );
    router.push(`/finance/penyesuaian-open-item/${result.id}`);
  };

  const run = async (action: ItemAdjustmentAction) => {
    if (!doc) return;
    setBusy(true);
    const result = await transitionItemAdjustment(doc.id, action);
    setBusy(false);
    setConfirm(null);
    setPostReady(false);
    if (result.ok) {
      toast(result.message, doc.adjustment_no, "ok");
      return;
    }
    toast("Tidak dapat diproses", result.errors._form ?? Object.values(result.errors)[0], "err");
  };

  // ---------------------------------------------------------------- render

  const listHref = "/finance/penyesuaian-open-item";
  const backHref = doc ? `${listHref}/${doc.id}` : listHref;
  const actions = doc ? availableItemAdjustmentActions(doc.status, can) : [];

  const viewActions: { key: string; tone: ActionTone; node: React.ReactNode }[] = doc
    ? orderForHeader(
        [
          ...(can.edit && itemAdjustmentIsEditable(doc.status)
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
            const t = ITEM_ADJUSTMENT_TRANSITIONS[a];
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

  return (
    <>
      <DocumentHeader
        module="Finance"
        trail={[{ label: "Penyesuaian Open Item", href: listHref }]}
        icon="pen"
        number={doc?.adjustment_no ?? null}
        placeholder="Penyesuaian Open Item Baru"
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
                <Icon name="users" size={15} />
              </span>
              <div className="ct">
                <h3>Posisi yang Disesuaikan</h3>
                <p>
                  Satu dokumen menyesuaikan satu posisi: satu buku subjek, satu Partner,
                  satu currency. Tidak ada uang yang berpindah.
                </p>
              </div>
            </div>
            <FormBody>
              <FormSection>
                <FormRow>
                  <Field
                    label="Buku Subjek"
                    span={4}
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
                        <span>{book?.name ?? doc!.book_name}</span>
                      </div>
                    )}
                  </Field>

                  <Field label="Partner" span={5} required={editing} error={errors.partner_id}>
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
                        <span className="lab">{doc!.partner_label}</span>
                        <span>{doc!.partner_name}</span>
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

                  <Field label="Kurs" span={3}>
                    <div className="ro">
                      {!currency ? (
                        <span className="dash">—</span>
                      ) : currency.isBase ? (
                        <span>mata uang dasar</span>
                      ) : (
                        <span>kurs masing-masing open item</span>
                      )}
                    </div>
                  </Field>

                  <Field
                    htmlFor="adjustment-reference"
                    label="Referensi"
                    span={3}
                    help={editing ? "nomor dokumen pihak lain" : undefined}
                  >
                    {editing ? (
                      <input
                        id="adjustment-reference"
                        className="inp"
                        type="text"
                        autoComplete="off"
                        value={values.reference}
                        placeholder="Opsional"
                        onChange={(e) => set("reference", e.target.value)}
                      />
                    ) : (
                      <div className="ro">{doc!.reference || <span className="dash">—</span>}</div>
                    )}
                  </Field>

                  <Field
                    label="Tanggal Dokumen"
                    span={3}
                    required={editing}
                    help={editing ? "boleh mundur" : undefined}
                    error={errors.document_date}
                  >
                    {editing ? (
                      <DateInput
                        value={values.document_date}
                        invalid={Boolean(errors.document_date)}
                        onChange={(v) => set("document_date", v)}
                      />
                    ) : (
                      <div className="ro">
                        {doc?.document_date ? (
                          formatDate(doc.document_date)
                        ) : (
                          <span className="dash">belum ditentukan</span>
                        )}
                      </div>
                    )}
                  </Field>
                </FormRow>

                <FormRow>
                  <Field htmlFor="adjustment-notes" label="Catatan" span={12}>
                    {editing ? (
                      <textarea
                        id="adjustment-notes"
                        className="ta"
                        rows={2}
                        value={values.note}
                        onChange={(e) => set("note", e.target.value)}
                        placeholder="Keterangan tambahan untuk penyesuaian ini…"
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
                  ? "Posisi Partner pada buku subjek sudah disesuaikan dan Journal-nya sudah tercatat. Koreksi dilakukan dengan penyesuaian berlawanan."
                  : doc!.status === "Draft"
                    ? "Dokumen masih Draft. Posisi Partner belum berubah; nilai IDR di bawah adalah yang akan ditulis Post bila diposting sekarang."
                    : "Dokumen dibatalkan sebelum Post, sehingga tidak pernah menyentuh posisi mana pun."}
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
                <p>
                  Setiap baris memilih satu open item dan nilai barunya. Selisihnya
                  menentukan penambahan atau pengurangan, pada kurs open item itu sendiri.
                </p>
              </div>
              {editing ? (
                <button
                  className="btn sm primary"
                  onClick={() => {
                    setDraftLines((rows) => [
                      ...rows,
                      { key: nextKey++, item_id: "", new_amount: "" },
                    ]);
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
              <table className="grid ltab" style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>No</th>
                    <th>Open Item</th>
                    <th className="num" style={{ width: 170 }}>
                      {editing ? "Nilai Saat Ini" : "Nilai Sebelum"}
                    </th>
                    <th className="num" style={{ width: 190 }}>
                      Nilai Baru ({currencyLabel})
                    </th>
                    <th className="num" style={{ width: 170 }}>
                      Selisih
                    </th>
                    {foreign && (
                      <th className="num" style={{ width: 170 }}>
                        Nilai {BASE_CURRENCY_LABEL}
                      </th>
                    )}
                    {editing && <th style={{ width: 44 }} />}
                  </tr>
                </thead>
                <tbody>
                  {editing
                    ? draftLines.map((l, i) => {
                        const item = itemsById.get(l.item_id);
                        return (
                          <tr key={l.key}>
                            <td className="no">{i + 1}</td>
                            <td>
                              <Select
                                size="sm"
                                searchable
                                value={l.item_id}
                                placeholder="Pilih open item…"
                                waitingFor={lineWaitingFor}
                                options={optionsFor(l.key)}
                                ariaLabel={`Open item baris ${i + 1}`}
                                onChange={(v) => setLine(l.key, { item_id: v })}
                              />
                            </td>
                            <td className="num">
                              {item ? (
                                <Amount value={item.remaining} currency={currencyLabel} />
                              ) : (
                                <span className="dash">—</span>
                              )}
                            </td>
                            <td className="num">
                              <MoneyInput
                                size="sm"
                                placeholder=""
                                ariaLabel={`Nilai baru baris ${i + 1}`}
                                currencyLabel={currencyLabel}
                                value={l.new_amount}
                                onChange={(v) => setLine(l.key, { new_amount: v })}
                              />
                            </td>
                            <ChangeCells preview={previews[i]} currency={currencyLabel} foreign={foreign} />
                            <td className="acts">
                              <button
                                className="iact del"
                                title="Keluarkan dari dokumen"
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
                        );
                      })
                    : lines.map((l, i) => (
                        <tr key={l.id}>
                          <td className="no">{i + 1}</td>
                          <td>
                            <span className="dstack">
                              <span className="d1">
                                <span className="lab">{l.itemNo}</span>
                              </span>
                              {l.itemDate && (
                                <span className="d2">
                                  {formatDate(l.itemDate)}
                                  {foreign && <> · kurs {formatRate(l.rate)}</>}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="num">
                            {l.balance_before != null ? (
                              <Amount value={l.balance_before} currency={currencyLabel} />
                            ) : (
                              <span className="dash">—</span>
                            )}
                          </td>
                          <td className="num">
                            {l.new_amount != null ? (
                              <Amount value={l.new_amount} currency={currencyLabel} />
                            ) : (
                              <span className="dash">—</span>
                            )}
                          </td>
                          <ChangeCells preview={savedPreviews[i]} currency={currencyLabel} foreign={foreign} />
                        </tr>
                      ))}
                </tbody>
                <tfoot>
                  <tr className="totrow">
                    <td colSpan={4} style={{ textAlign: "right" }}>
                      Selisih Bersih
                    </td>
                    <td className="num">
                      <Amount value={net} currency={currencyLabel} big />
                    </td>
                    {foreign && (
                      <td className="num">
                        <Amount value={netBase} currency={BASE_CURRENCY_LABEL} />
                      </td>
                    )}
                    {editing && <td />}
                  </tr>
                  {editing && after != null && previews.some(Boolean) && (
                    <tr className="totrow">
                      <td colSpan={4} style={{ textAlign: "right" }}>
                        Posisi Setelah Penyesuaian
                      </td>
                      <td className="num">
                        <Amount value={after} currency={currencyLabel} />
                      </td>
                      {foreign && <td />}
                      <td />
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>

      {confirm && doc && (
        <ConfirmDialog
          open
          icon={ITEM_ADJUSTMENT_TRANSITIONS[confirm].icon}
          tone={ITEM_ADJUSTMENT_TRANSITIONS[confirm].tone === "danger" ? "danger" : "ok"}
          title={ITEM_ADJUSTMENT_TRANSITIONS[confirm].title}
          subject={`${doc.adjustment_no} – selisih bersih ${formatMoney(doc.adjustment_amount, currencyLabel)}`}
          body={ITEM_ADJUSTMENT_TRANSITIONS[confirm].body}
          confirmLabel={ITEM_ADJUSTMENT_TRANSITIONS[confirm].confirmLabel}
          confirmTone={ITEM_ADJUSTMENT_TRANSITIONS[confirm].tone === "danger" ? "solid-danger" : "primary"}
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
            <JournalPreview
              load={() => previewItemAdjustmentPost(doc.id)}
              onReady={setPostReady}
            />
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * A line's difference and its value in base, signed — a Penambahan reads
 * positive, a Pengurangan negative — with the effect named under the figure,
 * so the direction is read rather than inferred from a minus sign.
 */
function ChangeCells({
  preview,
  currency,
  foreign,
}: {
  preview: LinePreview | null;
  currency: string;
  foreign: boolean;
}) {
  return (
    <>
      <td className="num">
        {preview ? (
          <>
            <Amount value={preview.change} currency={currency} />
            <span className="rsub">{ITEM_ADJUSTMENT_EFFECTS[preview.effect].label}</span>
          </>
        ) : (
          <span className="dash">—</span>
        )}
      </td>
      {foreign && (
        <td className="num">
          {preview ? (
            <>
              <Amount value={preview.base} currency={BASE_CURRENCY_LABEL} />
              <span className="rsub">
                {formatForeignFace(Math.abs(preview.change), currency, preview.rate)}
              </span>
            </>
          ) : (
            <span className="dash">—</span>
          )}
        </td>
      )}
    </>
  );
}
