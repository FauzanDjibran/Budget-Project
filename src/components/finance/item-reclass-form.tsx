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
import { Amount } from "@/components/ui/amount";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { useToast } from "@/components/ui/toast";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { OpenItemSelect, type ItemAllocation } from "./open-item-select";
import {
  createReclass,
  previewReclassPost,
  transitionReclass,
  updateReclass,
  type ReclassValues,
} from "@/app/actions/item-reclass";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { directionText } from "@/lib/siba/classification";
import { relieve, type Balance } from "@/lib/siba/fx";
import type {
  ReclassBookOption,
  ReclassLineRow,
  ReclassRefs,
  ReclassRow,
} from "@/lib/siba/item-reclass";
import { reclassEffect, valueReclassLine } from "@/lib/siba/item-reclass-valuation";
import {
  RECLASS_TRANSITIONS,
  availableReclassActions,
  reclassIsEditable,
  type ReclassAbilities,
  type ReclassAction,
} from "@/lib/siba/item-reclass-workflow";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/siba/header-actions";

export type ReclassFormMode = "new" | "view" | "edit";

/** A target while the document is being edited. */
type DraftLine = {
  key: number;
  target_budget_category_id: string;
  target_partner_id: number | null;
  description: string;
  sources: ItemAllocation[];
  targets: ItemAllocation[];
};

const LIST_HREF = "/finance/reklasifikasi-open-item";

let nextKey = 1;

const sum = (rows: ItemAllocation[]) => rows.reduce((t, a) => t + a.amount, 0);

/** Whether a book may receive a movement in this cash direction. */
const allows = (book: ReclassBookOption, direction: "In" | "Out") =>
  direction === "In" ? book.allowsIn : book.allowsOut;

/**
 * Reklasifikasi Open Item create / detail / edit.
 *
 * The header names the source position — book, Partner, currency. Each line
 * names a target book and Partner, the source items it moves, and — where the
 * target runs the other way and so has its own items settled — the target items.
 * Where the target runs the same way it gains new items, carrying each source
 * item's kurs, and there is nothing to pick.
 *
 * The estimate beside a settling line is `valueReclassLine` — the function Post
 * runs — over the items relieved line by line with `relieve`, the kernel the
 * books use. The Post confirmation shows the journal itself.
 */
export function ItemReclassForm({
  mode,
  reclass,
  lines,
  refs,
  can,
}: {
  mode: ReclassFormMode;
  reclass: ReclassRow | null;
  lines: ReclassLineRow[];
  refs: ReclassRefs;
  can: ReclassAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";

  const [values, setValues] = useState<ReclassValues>(() => ({
    budget_category_id: reclass ? String(reclass.budget_category_id) : "",
    partner_id: reclass ? String(reclass.partner_id) : "",
    currency_id: reclass ? String(reclass.currency_id) : "",
    // Today, as every editable date starts (§10 rule 33).
    accounting_date: reclass?.accounting_date ?? todayIso(),
    note: reclass?.note ?? "",
  }));

  const [draftLines, setDraftLines] = useState<DraftLine[]>(() =>
    lines.map((l) => ({
      key: nextKey++,
      target_budget_category_id: String(l.target_budget_category_id),
      target_partner_id: l.target_partner_id,
      description: l.description ?? "",
      sources: l.sources.map((s) => ({ item_id: s.item_id, amount: s.amount })),
      targets: l.targets.map((t) => ({ item_id: t.item_id, amount: t.amount })),
    }))
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ReclassAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [postReady, setPostReady] = useState(false);

  const book = refs.books.find((b) => String(b.categoryId) === values.budget_category_id) ?? null;
  const partnerId = values.partner_id ? Number(values.partner_id) : null;
  const partner = refs.partners.find((p) => p.id === partnerId) ?? null;
  const currencyId = values.currency_id ? Number(values.currency_id) : null;
  const currencyLabel = editing
    ? refs.currencies.find((c) => c.id === currencyId)?.label ?? "—"
    : reclass?.currency_label ?? "—";

  /** The source position's open items — what a line may move. */
  const sourceItems = refs.items.filter(
    (i) => book && i.bookId === book.categoryId && i.partnerId === partnerId && i.currencyId === currencyId
  );

  const headerReady = Boolean(book && partnerId && currencyId);
  const lineWaitingFor = !book
    ? "Pilih Buku Sumber dulu…"
    : !partnerId
      ? "Pilih Partner Sumber dulu…"
      : !currencyId
        ? "Pilih Currency dulu…"
        : null;

  /**
   * Changing what decides the lines clears what depended on it: the book
   * decides which targets may take its direction, the Partner which Company
   * they belong to, and the currency which items exist at all.
   */
  const set = (key: keyof ReclassValues, value: string) => {
    setValues((v) => {
      const next = { ...v, [key]: value };
      if (key === "budget_category_id") {
        next.partner_id = "";
        next.currency_id = "";
      }
      if (key === "partner_id") next.currency_id = "";
      return next;
    });
    if (key === "budget_category_id") {
      setDraftLines([]);
    } else if (key === "partner_id") {
      const company = refs.partners.find((p) => String(p.id) === value)?.companyId;
      setDraftLines((rows) =>
        rows.map((r) => {
          const target = refs.partners.find((p) => p.id === r.target_partner_id);
          return {
            ...r,
            target_partner_id: target && target.companyId === company ? r.target_partner_id : null,
            sources: [],
            targets: [],
          };
        })
      );
    } else if (key === "currency_id") {
      setDraftLines((rows) => rows.map((r) => ({ ...r, sources: [], targets: [] })));
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

  /** Partners holding an open item in the chosen book, in any currency. */
  const holders = new Set(refs.items.filter((i) => book && i.bookId === book.categoryId).map((i) => i.partnerId));
  const partnerOptions = refs.partners
    .filter((p) => (p.active && holders.has(p.id)) || p.id === partnerId)
    .map((p) => ({ id: p.id, label: p.label, name: p.name, active: p.active }));

  /** The currencies the source Partner holds in this book. */
  const currencyOptions = refs.currencies
    .filter(
      (c) =>
        c.id === currencyId ||
        refs.items.some((i) => book && i.bookId === book.categoryId && i.partnerId === partnerId && i.currencyId === c.id)
    )
    .map((c) => ({ value: String(c.id), label: c.label }));

  /** Books that may take the direction that raised the source. */
  const targetBookOptions = book
    ? refs.books
        .filter((b) => allows(b, book.raises))
        .map((b) => ({ value: String(b.categoryId), label: b.name }))
    : [];

  const targetPartnerOptions = (target: ReclassBookOption | null, chosen: number | null) =>
    target && partner
      ? refs.partners
          .filter((p) => p.companyId === partner.companyId)
          .filter((p) => target.partnerCategories.includes(p.categoryLabel))
          .filter((p) => !(target.categoryId === book?.categoryId && p.id === partnerId))
          .filter((p) => p.active || p.id === chosen)
          .map((p) => ({ id: p.id, label: p.label, name: p.name, active: p.active }))
      : [];

  const targetItemsFor = (target: ReclassBookOption | null, targetPartner: number | null) =>
    refs.items.filter(
      (i) => target && i.bookId === target.categoryId && i.partnerId === targetPartner && i.currencyId === currencyId
    );

  // ------------------------------------------------------------- valuation

  /**
   * What each settling line's items will recognise, with the arithmetic Post
   * runs. Every item is relieved over a running balance, line by line, so an
   * item split across two lines is valued from what the first left.
   */
  const preview = (() => {
    if (!editing || !book) return [];
    const state = new Map(
      refs.items.map((i) => [i.id, { foreign: i.remaining, base: i.baseRemaining } as Balance])
    );
    const take = (a: ItemAllocation): number | null => {
      const s = state.get(a.item_id);
      if (!s || a.amount > s.foreign) return null;
      const relief = relieve(s, a.amount);
      state.set(a.item_id, relief.remaining);
      return relief.base;
    };
    return draftLines.map((l) => {
      const target = refs.books.find((b) => String(b.categoryId) === l.target_budget_category_id);
      const amount = sum(l.sources);
      if (!target || !amount) return null;
      const released = l.sources.map(take);
      if (released.some((b) => b === null)) return null;
      const effect = reclassEffect(book.raises, target.raises);
      const settled = effect === "settle" ? l.targets.map(take) : [];
      if (settled.some((b) => b === null)) return null;
      if (effect === "settle" && Math.round(sum(l.targets) * 100) !== Math.round(amount * 100)) {
        return null;
      }
      return valueReclassLine({
        sourceRaises: book.raises,
        effect,
        amount,
        sourceReleased: released as number[],
        targets: l.targets.map((t, i) => ({ amount: t.amount, releasedBase: settled[i] as number })),
      });
    });
  })();

  const total = editing
    ? draftLines.reduce((t, l) => t + sum(l.sources), 0)
    : reclass?.reclass_amount ?? 0;

  const fxTotal = editing
    ? preview.reduce((t, p) => t + (p ? p.fxTotal : 0), 0)
    : reclass?.fx_difference ?? 0;

  // ---------------------------------------------------------------- writes

  const onSave = async () => {
    setSaving(true);
    const payload = draftLines.map((l) => ({
      target_budget_category_id: l.target_budget_category_id,
      target_partner_id: l.target_partner_id ? String(l.target_partner_id) : "",
      description: l.description,
      sources: l.sources,
      targets: l.targets,
    }));
    const result =
      mode === "new"
        ? await createReclass(values, payload)
        : await updateReclass(reclass!.id, values, payload);
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
      mode === "new" ? "Reklasifikasi Open Item dibuat" : "Perubahan disimpan",
      mode === "new" ? `${result.reclass_no} dibuat otomatis. Dokumen masih Draft.` : reclass?.reclass_no,
      "ok"
    );
    router.push(`${LIST_HREF}/${result.id}`);
  };

  const run = async (action: ReclassAction) => {
    if (!reclass) return;
    setBusy(true);
    const result = await transitionReclass(reclass.id, action);
    setBusy(false);
    setConfirm(null);
    setPostReady(false);
    if (result.ok) {
      toast(result.message, reclass.reclass_no, "ok");
      return;
    }
    toast("Tidak dapat diproses", result.errors._form ?? Object.values(result.errors)[0], "err");
  };

  // ---------------------------------------------------------------- render

  const backHref = reclass ? `${LIST_HREF}/${reclass.id}` : LIST_HREF;
  const actions = reclass ? availableReclassActions(reclass.status, can) : [];
  const postable = actions.includes("post") && lines.length > 0;

  const viewActions: { key: string; tone: ActionTone; node: React.ReactNode }[] = reclass
    ? orderForHeader(
        [
          ...(can.edit && reclassIsEditable(reclass.status)
            ? [
                {
                  key: "edit",
                  tone: "neutral" as ActionTone,
                  node: (
                    <Link key="edit" className="btn" href={`${LIST_HREF}/${reclass.id}/edit`}>
                      <Icon name="pen" size={15} /> Ubah
                    </Link>
                  ),
                },
              ]
            : []),
          ...actions.map((a) => {
            const t = RECLASS_TRANSITIONS[a];
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

  const ro = (label: string | null | undefined, name?: string | null) => (
    <div className="ro">
      {label ? <span className="lab">{label}</span> : null}
      <span>{name ?? (label ? "" : "—")}</span>
    </div>
  );

  const fxCell = (fx: number) =>
    fx === 0 ? null : (
      <span className="rsub">
        {fx > 0 ? "laba" : "rugi"} selisih {formatMoney(Math.abs(fx), BASE_CURRENCY_LABEL)}
      </span>
    );

  const sourceDirection = book ? directionText(book.raises).toLowerCase() : null;

  return (
    <>
      <DocumentHeader
        module="Finance"
        trail={[{ label: "Reklasifikasi Open Item", href: LIST_HREF }]}
        icon="tags"
        number={reclass?.reclass_no ?? null}
        placeholder="Reklasifikasi Open Item Baru"
        status={reclass?.status ?? null}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {mode === "view" && reclass && (
          <>
            {viewActions.map((i) => i.node)}
            {!actions.length && (
              <span className="lockchip">
                <Icon name="lock" size={13} />{" "}
                {reclass.status === "Posted" ? "Terkunci setelah Post" : "Dokumen dibatalkan"}
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
                <Icon name="tags" size={15} />
              </span>
              <div className="ct">
                <h3>Posisi Sumber</h3>
                <p>Buku, Partner, dan currency yang open item-nya dipindahkan.</p>
              </div>
            </div>
            <FormBody>
              <FormSection>
                <FormRow>
                  <Field
                    label="Buku Sumber"
                    span={4}
                    required={editing}
                    help={editing ? "misalnya Belum Teridentifikasi" : undefined}
                    error={errors.budget_category_id}
                  >
                    {editing ? (
                      <Select
                        value={values.budget_category_id}
                        invalid={Boolean(errors.budget_category_id)}
                        placeholder="Pilih Buku…"
                        searchable
                        options={refs.books.map((b) => ({ value: String(b.categoryId), label: b.name }))}
                        onChange={(v) => set("budget_category_id", v)}
                      />
                    ) : (
                      ro(null, reclass!.book_name)
                    )}
                  </Field>

                  <Field
                    label="Partner Sumber"
                    span={4}
                    required={editing}
                    help={editing ? "yang memegang open item-nya" : undefined}
                    error={errors.partner_id}
                  >
                    {editing ? (
                      <Combobox
                        value={partnerId}
                        options={partnerOptions}
                        placeholder="Pilih Partner…"
                        waitingFor={book ? null : "Pilih Buku Sumber dulu…"}
                        invalid={Boolean(errors.partner_id)}
                        onChange={(v) => set("partner_id", v ? String(v) : "")}
                      />
                    ) : (
                      ro(reclass!.partner_label, reclass!.partner_name)
                    )}
                  </Field>

                  <Field
                    label="Tanggal Akuntansi"
                    span={4}
                    required={editing}
                    help={editing ? "boleh mundur, tidak ke depan" : undefined}
                    error={errors.accounting_date}
                  >
                    {editing ? (
                      <DateInput
                        value={values.accounting_date}
                        invalid={Boolean(errors.accounting_date)}
                        onChange={(v) => set("accounting_date", v)}
                      />
                    ) : (
                      <div className="ro">
                        {reclass?.accounting_date ? (
                          formatDate(reclass.accounting_date)
                        ) : (
                          <span className="dash">belum ditentukan</span>
                        )}
                      </div>
                    )}
                  </Field>
                </FormRow>

                <FormRow>
                  <Field
                    label="Currency"
                    span={4}
                    required={editing}
                    help={editing ? "tujuan memakai currency yang sama" : undefined}
                    error={errors.currency_id}
                  >
                    {editing ? (
                      <Select
                        value={values.currency_id}
                        invalid={Boolean(errors.currency_id)}
                        placeholder="Pilih Currency…"
                        waitingFor={!book ? "Pilih Buku Sumber dulu…" : !partnerId ? "Pilih Partner Sumber dulu…" : undefined}
                        options={currencyOptions}
                        onChange={(v) => set("currency_id", v)}
                      />
                    ) : (
                      ro(reclass!.currency_label)
                    )}
                  </Field>

                  <Field htmlFor="reclass-notes" label="Catatan" span={8}>
                    {editing ? (
                      <textarea
                        id="reclass-notes"
                        className="ta"
                        rows={2}
                        value={values.note}
                        onChange={(e) => set("note", e.target.value)}
                        placeholder="Dasar reklasifikasi — konfirmasi pengirim, bukti transfer…"
                      />
                    ) : (
                      <div className="ro">{reclass!.note || <span className="dash">—</span>}</div>
                    )}
                  </Field>
                </FormRow>
              </FormSection>
            </FormBody>

            {mode === "view" && (
              <p className="fnote">
                {reclass!.status === "Posted"
                  ? "Nilainya sudah dipindahkan: open item sumber dilepas, buku tujuan dan Journal sudah tercatat. Historical record bersifat append-only — koreksi dilakukan sebagai reklasifikasi baru."
                  : reclass!.status === "Draft"
                    ? "Dokumen masih Draft. Belum ada open item yang bergerak."
                    : "Dokumen dibatalkan sebelum Post, sehingga tidak pernah menyentuh open item mana pun."}
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
                  {sourceDirection
                    ? `Tujuan dibukukan seolah ${sourceDirection} asalnya diklasifikasi ke sana: buku yang searah membuka open item baru, buku yang berlawanan menyelesaikan open item-nya.`
                    : "Setiap baris memindahkan open item sumber ke satu buku dan Partner tujuan."}
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
                      {
                        key: nextKey++,
                        target_budget_category_id: "",
                        target_partner_id: null,
                        description: "",
                        sources: [],
                        targets: [],
                      },
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
                <table className="grid ltab" style={{ minWidth: 1180 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>No</th>
                      <th style={{ width: 200 }}>Buku Tujuan</th>
                      <th style={{ width: 200 }}>Partner Tujuan</th>
                      <th style={{ width: 150 }}>Open Item Sumber</th>
                      <th style={{ width: 150 }}>Open Item Tujuan</th>
                      <th className="num" style={{ width: 170 }}>
                        Nominal ({currencyLabel})
                      </th>
                      <th>Keterangan</th>
                      {editing && <th style={{ width: 44 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {editing
                      ? draftLines.map((l, i) => {
                          const target =
                            refs.books.find((b) => String(b.categoryId) === l.target_budget_category_id) ??
                            null;
                          const effect = book && target ? reclassEffect(book.raises, target.raises) : null;
                          const amount = sum(l.sources);
                          const p = preview[i];
                          // The kurs the line's source items carry, weighted —
                          // what a settled item's gap is estimated against.
                          const sourceRate = amount
                            ? l.sources.reduce(
                                (t, a) => t + a.amount * (sourceItems.find((s) => s.id === a.item_id)?.rate ?? 0),
                                0
                              ) / amount
                            : null;
                          return (
                            <tr key={l.key}>
                              <td className="no">{i + 1}</td>
                              <td>
                                <Select
                                  size="sm"
                                  value={l.target_budget_category_id}
                                  placeholder="Pilih Buku…"
                                  searchable
                                  waitingFor={lineWaitingFor ?? undefined}
                                  options={targetBookOptions}
                                  onChange={(v) => {
                                    const next = refs.books.find((b) => String(b.categoryId) === v) ?? null;
                                    const kept = refs.partners.find((p) => p.id === l.target_partner_id);
                                    setLine(l.key, {
                                      target_budget_category_id: v,
                                      target_partner_id:
                                        next && kept && next.partnerCategories.includes(kept.categoryLabel)
                                          ? l.target_partner_id
                                          : null,
                                      targets: [],
                                    });
                                  }}
                                />
                              </td>
                              <td>
                                <Combobox
                                  size="sm"
                                  value={l.target_partner_id}
                                  options={targetPartnerOptions(target, l.target_partner_id)}
                                  placeholder="Pilih Partner…"
                                  waitingFor={lineWaitingFor ?? (target ? null : "Pilih Buku Tujuan dulu…")}
                                  onChange={(v) => setLine(l.key, { target_partner_id: v, targets: [] })}
                                />
                              </td>
                              <td>
                                {headerReady ? (
                                  <OpenItemSelect
                                    value={l.sources}
                                    items={sourceItems}
                                    currencyLabel={currencyLabel}
                                    direction={book!.raises}
                                    cashRate={null}
                                    showFx={false}
                                    amountLabel="Dipindahkan"
                                    title="Pilih Open Item Sumber"
                                    subtitle="Centang setiap open item yang dipindahkan dan nominalnya. Nominal baris adalah jumlah item yang dipilih."
                                    onChange={(v) => setLine(l.key, { sources: v })}
                                  />
                                ) : (
                                  <span className="dash">{lineWaitingFor}</span>
                                )}
                              </td>
                              <td>
                                {effect === "settle" && l.target_partner_id ? (
                                  <OpenItemSelect
                                    value={l.targets}
                                    items={targetItemsFor(target, l.target_partner_id)}
                                    currencyLabel={currencyLabel}
                                    direction={book!.raises}
                                    cashRate={sourceRate}
                                    title="Pilih Open Item Tujuan"
                                    subtitle={`Centang open item ${target!.name} yang diselesaikan. Jumlahnya harus sama dengan open item sumber.`}
                                    fxNote={
                                      sourceRate
                                        ? "Perkiraan terhadap kurs open item sumber; setiap item dijurnal pada baris Selisih Kurs-nya sendiri. Angka pastinya tampil pada konfirmasi Post."
                                        : undefined
                                    }
                                    onChange={(v) => setLine(l.key, { targets: v })}
                                  />
                                ) : effect === "open" ? (
                                  <span className="hint">dibuka baru</span>
                                ) : (
                                  <span className="dash">
                                    {target ? "Pilih Partner Tujuan dulu…" : "Pilih Buku Tujuan dulu…"}
                                  </span>
                                )}
                              </td>
                              <td className="num">
                                <Amount value={amount} currency={currencyLabel} />
                                {p && fxCell(p.fxTotal)}
                              </td>
                              <td>
                                <input
                                  className="inp sm"
                                  type="text"
                                  autoComplete="off"
                                  value={l.description}
                                  placeholder="Teridentifikasi sebagai…"
                                  aria-label="Keterangan"
                                  onChange={(e) => setLine(l.key, { description: e.target.value })}
                                />
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
                          const opened = l.sources.flatMap((s) => (s.opened_item_no ? [s.opened_item_no] : []));
                          return (
                            <tr key={l.id}>
                              <td className="no">{i + 1}</td>
                              <td className="pri">{l.target_book_name}</td>
                              <td>
                                <span className="dstack">
                                  <span className="d1">{l.target_partner_name}</span>
                                  <span className="d2">{l.target_partner_label}</span>
                                </span>
                              </td>
                              <td>
                                <span className="lab">{l.sources.map((s) => s.item_no).join(", ")}</span>
                              </td>
                              <td>
                                {l.targets.length ? (
                                  <span className="dstack">
                                    <span className="d1">{l.targets.map((t) => t.item_no).join(", ")}</span>
                                    <span className="d2">diselesaikan</span>
                                  </span>
                                ) : opened.length ? (
                                  <span className="dstack">
                                    <span className="d1">{opened.join(", ")}</span>
                                    <span className="d2">dibuka</span>
                                  </span>
                                ) : (
                                  <span className="hint">dibuka saat Post</span>
                                )}
                              </td>
                              <td className="num">
                                <Amount value={l.amount} currency={currencyLabel} />
                                {fxCell(l.fx_difference)}
                              </td>
                              <td className="wrapok">
                                {l.description || l.sources[0]?.item_note || <span className="dash">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                  </tbody>
                  <tfoot>
                    <tr className="totrow">
                      <td colSpan={5} style={{ textAlign: "right" }}>
                        Total Dipindahkan
                      </td>
                      <td className="num">
                        <Amount value={total} currency={currencyLabel} big />
                      </td>
                      <td />
                      {editing && <td />}
                    </tr>
                    {fxTotal !== 0 && (
                      <tr className="totrow">
                        <td colSpan={5} style={{ textAlign: "right" }}>
                          {fxTotal > 0 ? "Laba Selisih Kurs (bersih)" : "Rugi Selisih Kurs (bersih)"}
                        </td>
                        <td className="num">
                          <Amount value={Math.abs(fxTotal)} currency={BASE_CURRENCY_LABEL} />
                        </td>
                        <td />
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
                    ? "Tambahkan buku dan Partner tujuan, lalu pilih open item sumber yang dipindahkan."
                    : "Lengkapi Buku Sumber, Partner Sumber, dan Currency terlebih dahulu."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirm && reclass && (
        <ConfirmDialog
          open
          icon={RECLASS_TRANSITIONS[confirm].icon}
          tone={RECLASS_TRANSITIONS[confirm].tone === "danger" ? "danger" : "ok"}
          title={RECLASS_TRANSITIONS[confirm].title}
          subject={`${reclass.reclass_no} – ${formatMoney(reclass.reclass_amount, currencyLabel)}`}
          body={RECLASS_TRANSITIONS[confirm].body}
          confirmLabel={RECLASS_TRANSITIONS[confirm].confirmLabel}
          confirmTone={RECLASS_TRANSITIONS[confirm].tone === "danger" ? "solid-danger" : "primary"}
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
            <JournalPreview load={() => previewReclassPost(reclass.id)} onReady={setPostReady} />
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
