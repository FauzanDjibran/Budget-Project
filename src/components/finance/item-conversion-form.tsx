"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { DocumentHeader } from "@/components/ui/document-header";
import { CancelButton } from "@/components/ui/cancel-button";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { RateInput } from "@/components/ui/rate-input";
import { Amount } from "@/components/ui/amount";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { useToast } from "@/components/ui/toast";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { KursSelect } from "./kurs-select";
import { OpenItemSelect, type ItemAllocation } from "./open-item-select";
import {
  createConversion,
  previewConversionPost,
  transitionConversion,
  updateConversion,
  type ConversionValues,
} from "@/app/actions/item-conversion";
import { formatDate, formatMoney, formatRate, todayIso } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { relieve, roundBase, type Balance } from "@/lib/siba/fx";
import type {
  ConversionLineRow,
  ConversionRefs,
  ConversionRow,
} from "@/lib/siba/item-conversion";
import { valueConversionLine } from "@/lib/siba/item-conversion-valuation";
import {
  CONVERSION_TRANSITIONS,
  availableConversionActions,
  conversionIsEditable,
  type ConversionAbilities,
  type ConversionAction,
} from "@/lib/siba/item-conversion-workflow";
import {
  headerButtonClass,
  orderForHeader,
  type ActionTone,
} from "@/lib/siba/header-actions";

export type ConversionFormMode = "new" | "view" | "edit";

/** A destination while the document is being edited. */
type DraftLine = {
  key: number;
  to_cash_bank_id: number | null;
  rate: string;
  items: ItemAllocation[];
};

const LIST_HREF = "/finance/pencairan-open-item";

let nextKey = 1;

/**
 * Pencairan Open Item create / detail / edit.
 *
 * The header names the foreign source and its one layer, then the book and
 * the Partner whose items are converted. Each line names a Rupiah destination,
 * the kurs the bank paid, and the items it converts — the line is worth what
 * its items add up to, so it has no amount field of its own.
 *
 * The preview beside each line is `valueConversionLine` — the function Post
 * runs — over the layer and the items relieved line by line with `relieve`,
 * the kernel the books use. The Post confirmation shows the journal itself.
 */
export function ItemConversionForm({
  mode,
  conversion,
  lines,
  refs,
  can,
}: {
  mode: ConversionFormMode;
  conversion: ConversionRow | null;
  lines: ConversionLineRow[];
  refs: ConversionRefs;
  can: ConversionAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";

  const [values, setValues] = useState<ConversionValues>(() => ({
    from_cash_bank_id: conversion ? String(conversion.from_cash_bank_id) : "",
    cash_bank_layer_id: conversion ? String(conversion.cash_bank_layer_id) : "",
    budget_category_id: conversion ? String(conversion.budget_category_id) : "",
    partner_id: conversion ? String(conversion.partner_id) : "",
    // Today, as every editable date starts (§10 rule 33).
    document_date: conversion?.document_date ?? todayIso(),
    note: conversion?.note ?? "",
  }));

  const [draftLines, setDraftLines] = useState<DraftLine[]>(() =>
    lines.map((l) => ({
      key: nextKey++,
      to_cash_bank_id: l.to_cash_bank_id,
      rate: String(l.exchange_rate),
      items: l.items.map((i) => ({ item_id: i.item_id, amount: i.amount })),
    }))
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConversionAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [postReady, setPostReady] = useState(false);

  const source =
    refs.cashBanks.find((c) => String(c.id) === values.from_cash_bank_id) ?? null;
  const currencyLabel = editing
    ? source?.currencyLabel ?? "—"
    : conversion?.currency_label ?? "—";
  const layer = source?.layers.find((l) => String(l.id) === values.cash_bank_layer_id);
  const book = refs.books.find((b) => String(b.categoryId) === values.budget_category_id);
  const partnerId = values.partner_id ? Number(values.partner_id) : null;

  /** The Partner's foreign items in this book and currency — what a line may convert. */
  const items = refs.items.filter(
    (i) =>
      book &&
      source &&
      i.book === book.key &&
      i.partnerId === partnerId &&
      i.currencyId === source.currencyId
  );

  const headerReady = Boolean(source && layer && book && partnerId);
  const lineWaitingFor = !source
    ? "Pilih Cash & Bank sumber dulu…"
    : !layer
      ? "Pilih Kurs Sumber dulu…"
      : !book
        ? "Pilih Buku dulu…"
        : !partnerId
          ? "Pilih Partner dulu…"
          : null;

  /**
   * Changing what decides the lines clears what depended on it: a source
   * decides the layer and the destinations, and the book and the Partner
   * decide which items exist at all.
   */
  const set = (key: keyof ConversionValues, value: string) => {
    setValues((v) => {
      const next = { ...v, [key]: value };
      if (key === "from_cash_bank_id") {
        next.cash_bank_layer_id = "";
        const cb = refs.cashBanks.find((c) => String(c.id) === value);
        const kept = refs.partners.find((p) => String(p.id) === v.partner_id);
        if (cb && kept && kept.companyId !== cb.companyId) next.partner_id = "";
      }
      if (key === "budget_category_id") next.partner_id = "";
      return next;
    });
    if (key === "from_cash_bank_id") {
      setDraftLines((rows) => rows.map((r) => ({ ...r, to_cash_bank_id: null, items: [] })));
    }
    if (key === "budget_category_id" || key === "partner_id") {
      setDraftLines((rows) => rows.map((r) => ({ ...r, items: [] })));
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

  // ------------------------------------------------------------- narrowing

  const sourceOptions = refs.cashBanks
    .filter((c) => !c.isBase)
    .filter((c) => c.active || String(c.id) === values.from_cash_bank_id)
    .map((c) => ({
      id: c.id,
      label: c.label,
      name: `${c.name} (${c.currencyLabel})`,
      active: c.active,
    }));

  /** Partners of the source's Company holding an open item in this book and currency. */
  const holders = new Set(
    refs.items
      .filter((i) => book && source && i.book === book.key && i.currencyId === source.currencyId)
      .map((i) => i.partnerId)
  );
  const partnerOptions = refs.partners
    .filter((p) => p.companyId === source?.companyId)
    .filter((p) => (p.active && holders.has(p.id)) || p.id === partnerId)
    .map((p) => ({ id: p.id, label: p.label, name: p.name, active: p.active }));

  const destinationOptions = (chosen: number | null) =>
    refs.cashBanks
      .filter((c) => c.active || c.id === chosen)
      .filter((c) => c.isBase && c.companyId === source?.companyId)
      .map((c) => ({ id: c.id, label: c.label, name: `${c.name} (${c.currencyLabel})`, active: c.active }));

  // ------------------------------------------------------------- valuation

  /**
   * What each line will move, previewed with the arithmetic Post runs. The
   * layer and every item are relieved line by line over running balances,
   * exactly as the posting does, so an item split across two lines is valued
   * from what the first left.
   */
  const preview = (() => {
    if (!editing || !layer || !book) return [];
    let balance: Balance | null = { foreign: layer.foreignRemaining, base: layer.baseRemaining };
    const itemState = new Map(
      items.map((i) => [i.id, { foreign: i.remaining, base: i.baseRemaining } as Balance])
    );
    return draftLines.map((l) => {
      const amount = l.items.reduce((t, a) => t + a.amount, 0);
      const rate = Number(l.rate);
      if (!amount || !balance) return null;
      if (amount > balance.foreign) {
        balance = null;
        return { over: true as const };
      }
      const drawn = relieve(balance, amount);
      balance = drawn.remaining;
      const released: { amount: number; releasedBase: number }[] = [];
      for (const a of l.items) {
        const state = itemState.get(a.item_id);
        if (!state || a.amount > state.foreign) return null;
        const relief = relieve(state, a.amount);
        itemState.set(a.item_id, relief.remaining);
        released.push({ amount: a.amount, releasedBase: relief.base });
      }
      if (!(rate > 0)) return null;
      return {
        over: false as const,
        valued: valueConversionLine({
          amount,
          rate,
          layerReleasedBase: drawn.base,
          layerRate: layer.rate,
          raisesOnIn: book.raises === "In",
          items: released,
        }),
      };
    });
  })();

  const total = editing
    ? draftLines.reduce((t, l) => t + l.items.reduce((s, a) => s + a.amount, 0), 0)
    : conversion?.conversion_amount ?? 0;

  const fxTotal = editing
    ? preview.reduce((t, p) => t + (p && !p.over ? p.valued.fxDifference : 0), 0)
    : conversion?.fx_difference ?? 0;

  // ---------------------------------------------------------------- writes

  const onSave = async () => {
    setSaving(true);
    const payload = draftLines
      .filter((l) => l.to_cash_bank_id)
      .map((l) => ({
        to_cash_bank_id: String(l.to_cash_bank_id),
        exchange_rate: l.rate,
        items: l.items,
      }));
    const result =
      mode === "new"
        ? await createConversion(values, payload)
        : await updateConversion(conversion!.id, values, payload);
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
      mode === "new" ? "Pencairan Open Item dibuat" : "Perubahan disimpan",
      mode === "new"
        ? `${result.conversion_no} dibuat otomatis. Dokumen masih Draft.`
        : conversion?.conversion_no,
      "ok"
    );
    router.push(`${LIST_HREF}/${result.id}`);
  };

  const run = async (action: ConversionAction) => {
    if (!conversion) return;
    setBusy(true);
    const result = await transitionConversion(conversion.id, action);
    setBusy(false);
    setConfirm(null);
    setPostReady(false);
    if (result.ok) {
      toast(result.message, conversion.conversion_no, "ok");
      return;
    }
    toast("Tidak dapat diproses", result.errors._form ?? Object.values(result.errors)[0], "err");
  };

  // ---------------------------------------------------------------- render

  const backHref = conversion ? `${LIST_HREF}/${conversion.id}` : LIST_HREF;
  const actions = conversion ? availableConversionActions(conversion.status, can) : [];
  const postable = actions.includes("post") && lines.length > 0;

  const viewActions: { key: string; tone: ActionTone; node: React.ReactNode }[] = conversion
    ? orderForHeader(
        [
          ...(can.edit && conversionIsEditable(conversion.status)
            ? [
                {
                  key: "edit",
                  tone: "neutral" as ActionTone,
                  node: (
                    <Link key="edit" className="btn" href={`${LIST_HREF}/${conversion.id}/edit`}>
                      <Icon name="pen" size={15} /> Ubah
                    </Link>
                  ),
                },
              ]
            : []),
          ...actions.map((a) => {
            const t = CONVERSION_TRANSITIONS[a];
            const blocked = a === "post" && !postable;
            return {
              key: a,
              tone: t.tone,
              node: (
                <button
                  key={a}
                  className={headerButtonClass(t.tone)}
                  disabled={busy || blocked}
                  title={blocked ? "Tambahkan minimal satu tujuan" : undefined}
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

  /** The rate the source carried the currency at, read back off a posted line. */
  const sourceRate =
    layer?.rate ??
    (() => {
      const settled = lines.find((l) => l.out_base_amount > 0);
      return settled ? settled.out_base_amount / settled.amount : null;
    })();

  const ro = (label: string | null | undefined, name?: string | null) => (
    <div className="ro">
      {label ? <span className="lab">{label}</span> : null}
      <span>{name ?? (label ? "" : "—")}</span>
    </div>
  );

  return (
    <>
      <DocumentHeader
        module="Finance"
        trail={[{ label: "Pencairan Open Item", href: LIST_HREF }]}
        icon="down"
        number={conversion?.conversion_no ?? null}
        placeholder="Pencairan Open Item Baru"
        status={conversion?.status ?? null}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {mode === "view" && conversion && (
          <>
            {viewActions.map((i) => i.node)}
            {!actions.length && (
              <span className="lockchip">
                <Icon name="lock" size={13} />{" "}
                {conversion.status === "Posted" ? "Terkunci setelah Post" : "Dokumen dibatalkan"}
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
                <Icon name="down" size={15} />
              </span>
              <div className="ct">
                <h3>Sumber Dana &amp; Partner</h3>
                <p>
                  Valuta asing yang dijual, dan Partner yang open item-nya ikut
                  dikonversi pada kurs yang sama.
                </p>
              </div>
            </div>
            <FormBody>
              <FormSection>
                <FormRow>
                  <Field
                    label="Cash & Bank Sumber"
                    span={4}
                    required={editing}
                    help={editing ? "valuta asing yang dijual" : undefined}
                    error={errors.from_cash_bank_id}
                  >
                    {editing ? (
                      <Combobox
                        value={values.from_cash_bank_id ? Number(values.from_cash_bank_id) : null}
                        options={sourceOptions}
                        placeholder="Pilih Cash & Bank…"
                        invalid={Boolean(errors.from_cash_bank_id)}
                        onChange={(v) => set("from_cash_bank_id", v ? String(v) : "")}
                      />
                    ) : (
                      ro(conversion!.source_label, conversion!.source_name)
                    )}
                  </Field>

                  <Field
                    label="Kurs Sumber"
                    span={4}
                    required={editing}
                    help={editing ? "satu dokumen memakai satu layer" : undefined}
                    error={errors.cash_bank_layer_id}
                  >
                    {editing && source ? (
                      <KursSelect
                        value={values.cash_bank_layer_id ? Number(values.cash_bank_layer_id) : null}
                        layers={source.layers}
                        currencyLabel={currencyLabel}
                        invalid={Boolean(errors.cash_bank_layer_id)}
                        onChange={(v) => set("cash_bank_layer_id", v ? String(v) : "")}
                      />
                    ) : editing ? (
                      <Select
                        value=""
                        options={[]}
                        placeholder="Pilih layer kurs…"
                        waitingFor="Pilih Cash & Bank sumber dulu…"
                        onChange={() => {}}
                      />
                    ) : (
                      <div className="ro">
                        <span className="mny">
                          {sourceRate === null ? "—" : formatRate(sourceRate)}
                        </span>
                        <span>dari layer yang dipilih</span>
                      </div>
                    )}
                  </Field>

                  <Field
                    label="Tanggal Dokumen"
                    span={4}
                    required={editing}
                    help={editing ? "boleh mundur, tidak ke depan" : undefined}
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
                        {conversion?.document_date ? (
                          formatDate(conversion.document_date)
                        ) : (
                          <span className="dash">belum ditentukan</span>
                        )}
                      </div>
                    )}
                  </Field>
                </FormRow>

                <FormRow>
                  <Field
                    label="Buku"
                    span={4}
                    required={editing}
                    help={editing ? "buku subjek open item-nya" : undefined}
                    error={errors.budget_category_id}
                  >
                    {editing ? (
                      <Select
                        value={values.budget_category_id}
                        invalid={Boolean(errors.budget_category_id)}
                        placeholder="Pilih Buku…"
                        options={refs.books.map((b) => ({
                          value: String(b.categoryId),
                          label: b.name,
                        }))}
                        onChange={(v) => set("budget_category_id", v)}
                      />
                    ) : (
                      ro(null, conversion!.book_name)
                    )}
                  </Field>

                  <Field
                    label="Partner"
                    span={4}
                    required={editing}
                    help={editing ? "yang memegang open item valuta ini" : undefined}
                    error={errors.partner_id}
                  >
                    {editing ? (
                      <Combobox
                        value={partnerId}
                        options={partnerOptions}
                        placeholder="Pilih Partner…"
                        waitingFor={
                          !source
                            ? "Pilih Cash & Bank sumber dulu…"
                            : !book
                              ? "Pilih Buku dulu…"
                              : null
                        }
                        invalid={Boolean(errors.partner_id)}
                        onChange={(v) => set("partner_id", v ? String(v) : "")}
                      />
                    ) : (
                      ro(conversion!.partner_label, conversion!.partner_name)
                    )}
                  </Field>

                  <Field htmlFor="conversion-notes" label="Catatan" span={4}>
                    {editing ? (
                      <textarea id="conversion-notes"
                        className="ta"
                        rows={2}
                        value={values.note}
                        onChange={(e) => set("note", e.target.value)}
                        placeholder="Keterangan tambahan untuk dokumen ini…"
                      />
                    ) : (
                      <div className="ro">{conversion!.note || <span className="dash">—</span>}</div>
                    )}
                  </Field>
                </FormRow>
              </FormSection>
            </FormBody>

            {mode === "view" && (
              <p className="fnote">
                {conversion!.status === "Posted"
                  ? "Valuta sudah dijual dan open item Partner sudah dikonversi: saldo Cash & Bank, buku subjek, dan Journal sudah tercatat. Historical record bersifat append-only — koreksi dilakukan sebagai dokumen baru."
                  : conversion!.status === "Draft"
                    ? "Dokumen masih Draft. Belum ada saldo maupun open item yang bergerak."
                    : "Dokumen dibatalkan sebelum Post, sehingga tidak pernah menyentuh saldo maupun open item mana pun."}
              </p>
            )}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="layers" size={15} />
              </span>
              <div className="ct">
                <h3>Tujuan &amp; Open Item</h3>
                <p>
                  Setiap baris menerima Rupiah hasil penjualan, dan nominalnya
                  adalah jumlah open item yang dikonversi.
                </p>
              </div>
              {editing ? (
                <button
                  className="btn sm primary"
                  disabled={!headerReady}
                  title={lineWaitingFor ?? undefined}
                  onClick={() => {
                    setDraftLines((rows) => [
                      ...rows,
                      { key: nextKey++, to_cash_bank_id: null, rate: "", items: [] },
                    ]);
                    setDirty(true);
                  }}
                >
                  <Icon name="plus" size={14} /> Tambah Tujuan
                </button>
              ) : (
                <span className="hint">{lines.length} tujuan</span>
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

            {(editing ? draftLines.length : lines.length) ? (
              <div className="tw">
                <table className="grid ltab" style={{ minWidth: 960 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>No</th>
                      <th>Cash &amp; Bank Tujuan</th>
                      <th style={{ width: 170 }}>Open Item</th>
                      <th className="num" style={{ width: 160 }}>
                        Nominal ({currencyLabel})
                      </th>
                      <th className="num" style={{ width: 150 }}>
                        Kurs ({currencyLabel} → {BASE_CURRENCY_LABEL})
                      </th>
                      <th className="num" style={{ width: 180 }}>
                        Masuk
                      </th>
                      {editing && <th style={{ width: 44 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {editing
                      ? draftLines.map((l, i) => {
                          const p = preview[i];
                          const amount = l.items.reduce((t, a) => t + a.amount, 0);
                          return (
                            <tr key={l.key} className={p?.over ? "overrow" : undefined}>
                              <td className="no">{i + 1}</td>
                              <td className="pri">
                                <Combobox
                                  size="sm"
                                  value={l.to_cash_bank_id}
                                  options={destinationOptions(l.to_cash_bank_id)}
                                  placeholder="Pilih Cash & Bank…"
                                  waitingFor={lineWaitingFor}
                                  onChange={(v) => setLine(l.key, { to_cash_bank_id: v })}
                                />
                              </td>
                              <td>
                                <OpenItemSelect
                                  value={l.items}
                                  items={items}
                                  currencyLabel={currencyLabel}
                                  direction={book?.raises === "In" ? "Out" : "In"}
                                  cashRate={Number(l.rate) > 0 ? Number(l.rate) : null}
                                  fxNote={
                                    Number(l.rate) > 0
                                      ? `Perkiraan pada kurs ${formatRate(Number(l.rate))}. Selisih seluruh dokumen dijurnal sebagai satu baris Selisih Kurs; angka pastinya tampil pada konfirmasi Post.`
                                      : undefined
                                  }
                                  onChange={(v) => setLine(l.key, { items: v })}
                                />
                              </td>
                              <td className="num">
                                <Amount value={amount} currency={currencyLabel} />
                                {p?.over && (
                                  <span className="overtag" title="Melebihi sisa layer">
                                    Melebihi sisa layer
                                  </span>
                                )}
                              </td>
                              <td className="num">
                                <RateInput
                                  size="sm"
                                  value={l.rate}
                                  ariaLabel="Kurs"
                                  onChange={(v) => setLine(l.key, { rate: v })}
                                />
                              </td>
                              <td className="num">
                                {p && !p.over ? (
                                  <>
                                    <Amount value={p.valued.inAmount} currency={BASE_CURRENCY_LABEL} />
                                    {p.valued.fxDifference !== 0 && (
                                      <span className="rsub">
                                        selisih {formatMoney(p.valued.fxDifference, BASE_CURRENCY_LABEL)}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="dash">—</span>
                                )}
                              </td>
                              <td className="acts">
                                <button
                                  className="iact del"
                                  title="Keluarkan dari dokumen"
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
                      : lines.map((l, i) => {
                          const destination = refs.cashBanks.find((c) => c.id === l.to_cash_bank_id);
                          const fx = l.cash_fx_difference + l.item_fx_difference;
                          return (
                            <tr key={l.id}>
                              <td className="no">{i + 1}</td>
                              <td className="pri">
                                <span className="dstack">
                                  <span className="d1">{destination?.label ?? "—"}</span>
                                  <span className="d2">{destination?.name ?? ""}</span>
                                </span>
                              </td>
                              <td>
                                <span className="dstack">
                                  <span className="d1">
                                    {l.items.map((it) => it.item_no).join(", ")}
                                  </span>
                                  {l.opened_item_no && (
                                    <span className="d2">menjadi {l.opened_item_no}</span>
                                  )}
                                </span>
                              </td>
                              <td className="num">
                                <Amount value={l.amount} currency={currencyLabel} />
                              </td>
                              <td className="num">
                                <span className="mny">{formatRate(l.exchange_rate)}</span>
                              </td>
                              <td className="num">
                                {conversion?.status === "Posted" ? (
                                  <>
                                    <Amount value={l.in_amount} currency={BASE_CURRENCY_LABEL} />
                                    {fx !== 0 && (
                                      <span className="rsub">
                                        selisih {formatMoney(fx, BASE_CURRENCY_LABEL)}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <Amount
                                    value={roundBase(l.amount * l.exchange_rate)}
                                    currency={BASE_CURRENCY_LABEL}
                                  />
                                )}
                              </td>
                            </tr>
                          );
                        })}
                  </tbody>
                  <tfoot>
                    <tr className="totrow">
                      <td colSpan={3} style={{ textAlign: "right" }}>
                        Total Dicairkan
                      </td>
                      <td className="num">
                        <Amount value={total} currency={currencyLabel} big />
                      </td>
                      <td colSpan={2} />
                      {editing && <td />}
                    </tr>
                    {fxTotal !== 0 && (
                      <tr className="totrow">
                        <td colSpan={5} style={{ textAlign: "right" }}>
                          {fxTotal > 0 ? "Laba Selisih Pencairan" : "Rugi Selisih Pencairan"}
                        </td>
                        <td className="num">
                          <Amount value={Math.abs(fxTotal)} currency={BASE_CURRENCY_LABEL} />
                        </td>
                        {editing && <td />}
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="empty sm">
                <div className="ic">
                  <Icon name="layers" size={18} />
                </div>
                <h4>Belum ada tujuan</h4>
                <p>
                  {headerReady
                    ? "Tambahkan Cash & Bank Rupiah yang menerima hasil pencairan, lalu pilih open item-nya."
                    : "Lengkapi Cash & Bank sumber, Kurs Sumber, Buku, dan Partner terlebih dahulu."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirm && conversion && (
        <ConfirmDialog
          open
          icon={CONVERSION_TRANSITIONS[confirm].icon}
          tone={CONVERSION_TRANSITIONS[confirm].tone === "danger" ? "danger" : "ok"}
          title={CONVERSION_TRANSITIONS[confirm].title}
          subject={`${conversion.conversion_no} – ${formatMoney(conversion.conversion_amount, currencyLabel)}`}
          body={CONVERSION_TRANSITIONS[confirm].body}
          confirmLabel={CONVERSION_TRANSITIONS[confirm].confirmLabel}
          confirmTone={CONVERSION_TRANSITIONS[confirm].tone === "danger" ? "solid-danger" : "primary"}
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
            <JournalPreview load={() => previewConversionPost(conversion.id)} onReady={setPostReady} />
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
