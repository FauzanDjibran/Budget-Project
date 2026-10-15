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
import { DateInput } from "@/components/ui/date-input";
import { MoneyInput } from "@/components/ui/money-input";
import { RateInput } from "@/components/ui/rate-input";
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
import { formatDate, formatMoney, formatRate, todayIso } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { originate, relieve, roundBase } from "@/lib/siba/fx";
import type {
  ItemAdjustmentLineRow,
  ItemAdjustmentRefs,
  ItemAdjustmentRow,
} from "@/lib/siba/item-adjustment";
import {
  ITEM_ADJUSTMENT_EFFECTS,
  ITEM_ADJUSTMENT_TRANSITIONS,
  availableItemAdjustmentActions,
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
import { OpenItemSelect, type ItemAllocation } from "./open-item-select";

export type ItemAdjustmentFormMode = "new" | "view" | "edit";

type DraftLine = {
  key: number;
  description: string;
  /** Typed on a Tambah; on a Kurangi the line is worth its items. */
  amount: number;
  items: ItemAllocation[];
};

let nextKey = 1;

const sum = (items: ItemAllocation[]) => roundBase(items.reduce((t, i) => t + (i.amount || 0), 0));

/**
 * Penyesuaian Open Item create / detail / edit.
 *
 * The header names the **position** being adjusted — a book, a Partner, a
 * currency — and whether it is raised or lowered. A Tambah line states its
 * reason and amount and opens one open item; a Kurangi line states its reason
 * and the open items it settles, each for an amount the user chooses, and is
 * worth their sum. Nothing on this screen moves a position: Post does, and it
 * is a separate, confirmed act.
 *
 * The figures in IDR are the kernel's own: `originate` at the entered kurs on
 * a Tambah, `relieve` of each chosen item at its own kurs on a Kurangi — the
 * same arithmetic the saved draft and Post write.
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
    effect: doc?.effect ?? "",
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
          description: l.description,
          amount: l.amount,
          items: l.items.map((i) => ({ item_id: i.itemId, amount: i.amount })),
        }))
      : [{ key: nextKey++, description: "", amount: 0, items: [] }]
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ItemAdjustmentAction | null>(null);
  const [busy, setBusy] = useState(false);
  // Post is answerable once its journal preview has loaded and not refused.
  const [postReady, setPostReady] = useState(false);

  const effect = (values.effect || null) as ItemAdjustmentEffect | null;
  const decrease = effect === "Decrease";
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

  /** The items this position still holds open — what a Kurangi line picks from. */
  const positionItems =
    book && partner && currency
      ? refs.items.filter(
          (i) => i.bookId === book.categoryId && i.partnerId === partner.id && i.currencyId === currency.id
        )
      : [];

  const asksRate = editing && Boolean(currency && !currency.isBase && effect === "Increase");

  /** What the first missing header field is — the clause a line waits on. */
  const lineWaitingFor = !effect
    ? "Pilih Jenis dulu…"
    : !book
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
      // A kurs belongs to one currency and to a Tambah.
      if (key === "currency_id" || key === "effect") next.exchange_rate = "";
      return next;
    });
    // The items a line chose belong to one position and one effect.
    if (key !== "exchange_rate" && key !== "document_date" && key !== "reference" && key !== "note") {
      setDraftLines((rows) => rows.map((r) => (r.items.length ? { ...r, items: [] } : r)));
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

  const lineAmount = (l: DraftLine) => (decrease ? sum(l.items) : l.amount || 0);

  const total = editing
    ? roundBase(draftLines.reduce((t, l) => t + lineAmount(l), 0))
    : doc?.adjustment_amount ?? 0;

  /**
   * Each line's value in IDR, by the posting's own arithmetic — or null where
   * it cannot be known yet (a Tambah without its kurs). A Kurangi draws each
   * item down line by line, as Post will.
   */
  const lineBases: (number | null)[] = (() => {
    if (!editing) return lines.map((l) => l.base_amount);
    if (!effect) return draftLines.map(() => null);
    if (!decrease) {
      const rate = currency?.isBase ? 1 : Number(values.exchange_rate);
      return draftLines.map((l) => (rate > 0 && l.amount > 0 ? originate(l.amount, rate).base : null));
    }
    const held = new Map(positionItems.map((i) => [i.id, { foreign: i.remaining, base: i.baseRemaining }]));
    return draftLines.map((l) => {
      let base = 0;
      for (const a of l.items) {
        const h = held.get(a.item_id);
        if (!h || !(a.amount > 0) || a.amount > h.foreign) return null;
        const r = relieve(h, Math.round(a.amount * 100) === Math.round(h.foreign * 100) ? h.foreign : a.amount);
        held.set(a.item_id, r.remaining);
        base += r.base;
      }
      return l.items.length ? roundBase(base) : null;
    });
  })();
  const totalBase = lineBases.every((b) => b != null)
    ? roundBase(lineBases.reduce<number>((t, b) => t + (b ?? 0), 0))
    : null;

  const after = standing ? (decrease ? standing.foreign - total : standing.foreign + total) : null;

  // ---------------------------------------------------------------- writes

  const onSave = async () => {
    setSaving(true);
    const payload = draftLines.map((l) => ({
      description: l.description,
      amount: String(l.amount || ""),
      items: decrease ? l.items : [],
    }));
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
                    label="Jenis"
                    span={3}
                    required={mode === "new"}
                    locked={mode === "edit"}
                    help={effect ? ITEM_ADJUSTMENT_EFFECTS[effect].desc : undefined}
                    error={errors.effect}
                  >
                    {mode === "new" ? (
                      <Select
                        value={values.effect}
                        invalid={Boolean(errors.effect)}
                        placeholder="Pilih jenis…"
                        options={(Object.keys(ITEM_ADJUSTMENT_EFFECTS) as ItemAdjustmentEffect[]).map(
                          (t) => ({ value: t, label: ITEM_ADJUSTMENT_EFFECTS[t].label })
                        )}
                        onChange={(v) => set("effect", v)}
                      />
                    ) : (
                      <div className="ro">
                        <span>{effect ? ITEM_ADJUSTMENT_EFFECTS[effect].label : "—"}</span>
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
                        <span>{book?.name ?? doc!.book_name}</span>
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

                  <Field
                    label="Kurs"
                    span={3}
                    required={asksRate}
                    help={asksRate ? "nilai 1 unit dalam mata uang dasar" : undefined}
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
                        ) : decrease ? (
                          <span>kurs masing-masing open item</span>
                        ) : doc?.exchange_rate ? (
                          <span className="mny">{formatRate(doc.exchange_rate)}</span>
                        ) : (
                          <span className="dash">—</span>
                        )}
                      </div>
                    )}
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
                  {decrease
                    ? "Alasan penyesuaian dan open item yang dikurangi, masing-masing pada kursnya sendiri."
                    : "Alasan penyesuaian dan nominalnya; setiap baris membuka satu open item."}
                </p>
              </div>
              {editing ? (
                <button
                  className="btn sm primary"
                  onClick={() => {
                    setDraftLines((rows) => [
                      ...rows,
                      { key: nextKey++, description: "", amount: 0, items: [] },
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
              <table className="grid ltab" style={{ minWidth: 560 }}>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>No</th>
                    <th>Alasan</th>
                    {decrease && <th style={{ width: 200 }}>Open Item</th>}
                    <th className="num" style={{ width: 190 }}>
                      Nominal ({currencyLabel})
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
                              onChange={(e) => setLine(l.key, { description: e.target.value })}
                            />
                          </td>
                          {decrease && (
                            <td>
                              {lineWaitingFor ? (
                                <span className="dash">{lineWaitingFor}</span>
                              ) : (
                                <OpenItemSelect
                                  value={l.items}
                                  items={positionItems}
                                  currencyLabel={currencyLabel}
                                  direction={book!.raises}
                                  cashRate={null}
                                  showFx={false}
                                  amountLabel="Dikurangi"
                                  title="Pilih Open Item"
                                  subtitle="Centang setiap open item yang dikurangi dan nominalnya. Nominal baris adalah jumlah item yang dipilih."
                                  onChange={(v) => setLine(l.key, { items: v })}
                                />
                              )}
                            </td>
                          )}
                          <td className="num">
                            {decrease ? (
                              <Amount value={lineAmount(l)} currency={currencyLabel} />
                            ) : (
                              <MoneyInput
                                size="sm"
                                ariaLabel="Nominal"
                                value={l.amount ? String(l.amount) : ""}
                                onChange={(raw) => setLine(l.key, { amount: raw ? Number(raw) : 0 })}
                              />
                            )}
                          </td>
                          {foreign && (
                            <td className="num">
                              {lineBases[i] != null ? (
                                <Amount value={lineBases[i]!} currency={BASE_CURRENCY_LABEL} />
                              ) : (
                                <span className="dash">—</span>
                              )}
                            </td>
                          )}
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
                      ))
                    : lines.map((l, i) => (
                        <tr key={l.id}>
                          <td className="no">{i + 1}</td>
                          <td className="pri wrapok">
                            {l.description}
                            {l.opened_item_no && <span className="rsub">membuka {l.opened_item_no}</span>}
                          </td>
                          {decrease && (
                            <td>
                              <span className="dstack">
                                {l.items.map((it) => (
                                  <span key={it.itemId} className="d1">
                                    <span className="lab">{it.itemNo}</span>{" "}
                                    {formatMoney(it.amount, currencyLabel)}
                                    {foreign && <> @ {formatRate(it.rate)}</>}
                                  </span>
                                ))}
                              </span>
                            </td>
                          )}
                          <td className="num">
                            <Amount value={l.amount} currency={currencyLabel} />
                          </td>
                          {foreign && (
                            <td className="num">
                              <Amount value={l.base_amount} currency={BASE_CURRENCY_LABEL} />
                            </td>
                          )}
                        </tr>
                      ))}
                </tbody>
                <tfoot>
                  <tr className="totrow">
                    <td colSpan={decrease ? 3 : 2} style={{ textAlign: "right" }}>
                      Total {effect ? ITEM_ADJUSTMENT_EFFECTS[effect].label : "Penyesuaian"}
                    </td>
                    <td className="num">
                      <Amount value={total} currency={currencyLabel} big />
                    </td>
                    {foreign && (
                      <td className="num">
                        {(editing ? totalBase : doc?.adjustment_base_amount) != null ? (
                          <Amount
                            value={(editing ? totalBase : doc?.adjustment_base_amount)!}
                            currency={BASE_CURRENCY_LABEL}
                          />
                        ) : (
                          <span className="dash">—</span>
                        )}
                      </td>
                    )}
                    {editing && <td />}
                  </tr>
                  {editing && after != null && total > 0 && (
                    <tr className="totrow">
                      <td colSpan={decrease ? 3 : 2} style={{ textAlign: "right" }}>
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
          subject={`${doc.adjustment_no} – ${formatMoney(doc.adjustment_amount, currencyLabel)}`}
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
