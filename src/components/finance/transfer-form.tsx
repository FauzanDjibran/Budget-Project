"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { MoneyInput } from "@/components/ui/money-input";
import { RateInput } from "@/components/ui/rate-input";
import { KursSelect } from "./kurs-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import {
  createTransfer,
  transitionTransfer,
  updateTransfer,
  type TransferValues,
} from "@/app/actions/transfer";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { relieve, type Balance } from "@/lib/siba/fx";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type {
  TransferLineRow,
  TransferRefs,
  TransferRow,
} from "@/lib/siba/transfer";
import {
  TRANSFER_PURPOSES,
  transferCurrencyFollowsSource,
  transferPurposeOf,
} from "@/lib/siba/transfer-catalogue";
import { valueTransferLine } from "@/lib/siba/transfer-valuation";
import {
  TRANSFER_TRANSITIONS,
  availableTransferActions,
  transferIsEditable,
  type TransferAbilities,
  type TransferAction,
} from "@/lib/siba/transfer-workflow";
import {
  headerButtonClass,
  orderForHeader,
  type ActionTone,
} from "@/lib/siba/header-actions";

export type TransferFormMode = "new" | "view" | "edit";

/** A destination while the document is being edited. */
type DraftLine = {
  key: number;
  to_cash_bank_id: number | null;
  amount: number;
  rate: string;
};

/**
 * The header fields that decide where this document's money comes from, and
 * therefore what its lines may say. Changing any one re-asks the question, so
 * the previous answers cannot be allowed to survive it.
 */
const SOURCE_CONTEXT: (keyof TransferValues)[] = [
  "purpose",
  "from_cash_bank_id",
  "currency_id",
];

let nextKey = 1;

/**
 * Cash Bank Transfer create / detail / edit.
 *
 * The header names the **source** — one Purpose, one resource, and the layer it
 * draws on where it holds foreign currency — and the lines name the
 * destinations. Nothing on this screen moves money: Post does, and it is
 * deliberately a separate, confirmed act.
 *
 * The preview beside each line is computed by `valueTransferLine`, the same
 * function the posting uses, over a layer relieved by `relieve` — the same
 * kernel `drawFromLayer` calls. That is why the figures shown here are what
 * will actually be written rather than an approximation of them.
 */
export function TransferForm({
  mode,
  transfer,
  lines,
  refs,
  can,
}: {
  mode: TransferFormMode;
  transfer: TransferRow | null;
  lines: TransferLineRow[];
  refs: TransferRefs;
  can: TransferAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";

  const [values, setValues] = useState<TransferValues>(() => ({
    purpose: transfer?.purpose ?? "",
    from_cash_bank_id: transfer ? String(transfer.from_cash_bank_id) : "",
    currency_id: transfer ? String(transfer.currency_id) : "",
    cash_bank_layer_id: transfer?.cash_bank_layer_id
      ? String(transfer.cash_bank_layer_id)
      : "",
    note: transfer?.note ?? "",
  }));

  const [draftLines, setDraftLines] = useState<DraftLine[]>(() =>
    lines.map((l) => ({
      key: nextKey++,
      to_cash_bank_id: l.to_cash_bank_id,
      amount: l.amount,
      rate: l.exchange_rate ? String(l.exchange_rate) : "",
    }))
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<TransferAction | null>(null);
  const [busy, setBusy] = useState(false);

  const purpose = transferPurposeOf(values.purpose);
  const source =
    refs.cashBanks.find((c) => String(c.id) === values.from_cash_bank_id) ?? null;

  // The document currency: the source's own for Transfer and Pencairan, and an
  // input for Pembelian Valas alone, where the source holds rupiah and the
  // currency being bought is the thing being decided.
  const currencyFollowsSource = purpose
    ? transferCurrencyFollowsSource(purpose.key)
    : true;
  const currencyLabel = editing
    ? currencyFollowsSource
      ? source?.currencyLabel ?? "—"
      : refs.currencies.find((c) => String(c.id) === values.currency_id)?.label ??
        "—"
    : refs.currencies.find((c) => c.id === transfer?.currency_id)?.label ?? "—";

  /** Foreign currency leaving a foreign resource is the only layered case. */
  const drawsLayer = Boolean(
    source && !source.isBase && currencyFollowsSource && purpose
  );

  const layer = source?.layers.find(
    (l) => String(l.id) === values.cash_bank_layer_id
  );

  /**
   * The rate the **source** gave its currency up at, for the header to show.
   *
   * Not the line's `exchange_rate`: on a Pencairan that is the rate the bank
   * bought at, and the two differing is the whole point of the document. While
   * the layer is still open its own rate is the answer; once the document has
   * posted the layer may be exhausted and no longer offered, so the figure is
   * read back off what the line actually released.
   *
   * That read-back is a **carrying rate** — derived for display and never
   * stored, defaulted or multiplied by (CLAUDE.md §12).
   */
  const sourceRate = (() => {
    if (!drawsLayer) return null;
    if (layer) return layer.rate;
    const settled = lines.find((l) => l.out_amount > 0);
    return settled ? settled.out_base_amount / settled.out_amount : null;
  })();

  const headerReady = Boolean(
    purpose &&
      source &&
      currencyLabel !== "—" &&
      (!drawsLayer || values.cash_bank_layer_id)
  );

  /**
   * What a destination is still waiting on, named rather than merely greyed.
   *
   * A destination is decided by the whole header — the Purpose says which
   * currency it must be in, the source says which Company and which account it
   * may not be. Offering the picker before those are answered would open it
   * onto an empty list, which reads as "there are no accounts" rather than
   * "the question that picks them has not been asked".
   */
  const destinationWaitingFor = !purpose
    ? "Pilih Purpose dulu…"
    : !source
      ? "Pilih Cash & Bank sumber dulu…"
      : currencyLabel === "—"
        ? "Pilih valuta dulu…"
        : drawsLayer && !values.cash_bank_layer_id
          ? "Pilih Kurs Sumber dulu…"
          : null;

  const set = (key: keyof TransferValues, value: string) => {
    setValues((v) => {
      const next = { ...v, [key]: value };
      // A source left over from a Purpose that no longer admits it would be a
      // header the Server Action refuses while the field looks filled in.
      if (key === "purpose") {
        const p = transferPurposeOf(value);
        const kept = refs.cashBanks.find(
          (c) => String(c.id) === v.from_cash_bank_id
        );
        if (p && kept && p.sourceIsBase !== kept.isBase) {
          next.from_cash_bank_id = "";
        }
        if (p && transferCurrencyFollowsSource(p.key)) next.currency_id = "";
      }
      // A layer belongs to one resource, and which currency the document is in
      // decides whether one is drawn at all. Either moving can leave an answer
      // to a question the form is no longer asking.
      if (SOURCE_CONTEXT.includes(key)) next.cash_bank_layer_id = "";
      return next;
    });
    // The destinations depend on the Purpose and the currency, so a header
    // change invalidates them. They are cleared rather than silently kept
    // against a header that would refuse them.
    if (SOURCE_CONTEXT.includes(key)) {
      setDraftLines((rows) =>
        rows.map((r) => ({ ...r, to_cash_bank_id: null }))
      );
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

  // ------------------------------------------------------------- narrowing

  /** Sources the chosen Purpose admits: rupiah for a purchase, foreign else. */
  const sourceOptions = refs.cashBanks
    .filter((c) => c.active || String(c.id) === values.from_cash_bank_id)
    .filter((c) => {
      if (!purpose) return true;
      if (purpose.key === "PembelianValas") return c.isBase;
      if (purpose.key === "Pencairan") return !c.isBase;
      return true;
    })
    .map((c) => ({
      id: c.id,
      label: c.label,
      name: `${c.name} (${c.currencyLabel})`,
      active: c.active,
    }));

  /**
   * Destinations the header admits: the same Company, not the source, and a
   * currency the Purpose accepts. The Server Action re-checks every one of
   * these — the picker only narrows.
   */
  const destinationOptions = (chosen: number | null) =>
    refs.cashBanks
      .filter((c) => c.active || c.id === chosen)
      .filter((c) => c.companyId === source?.companyId)
      .filter((c) => c.id !== source?.id)
      .filter((c) => {
        if (!purpose) return false;
        if (purpose.destinationIsBase) return c.isBase;
        return c.currencyLabel === currencyLabel;
      })
      .map((c) => ({
        id: c.id,
        label: c.label,
        name: `${c.name} (${c.currencyLabel})`,
        active: c.active,
      }));

  // ------------------------------------------------------------- valuation

  /**
   * What each line will actually move, previewed with the same arithmetic the
   * posting runs.
   *
   * The layer is relieved line by line over a running balance, exactly as
   * `drawFromLayer` will: a full draw releases the layer's remaining base
   * exactly, so the last line of a document that empties a layer shows the
   * figure that will really be written rather than a recomputed product.
   */
  const preview = (() => {
    if (!purpose) return [];
    let balance: Balance | null = layer
      ? { foreign: layer.foreignRemaining, base: layer.baseRemaining }
      : null;

    return draftLines.map((l) => {
      const destination = refs.cashBanks.find((c) => c.id === l.to_cash_bank_id);
      const rate = Number(l.rate) || (layer?.rate ?? 1);
      let releasedBase: number | undefined;

      if (drawsLayer && balance) {
        if (l.amount > balance.foreign) {
          // Over the layer: the posting would refuse, so the preview says so
          // rather than showing a figure that cannot be written.
          balance = null;
          return { valued: null, over: true };
        }
        const relief = relieve(balance, l.amount);
        releasedBase = relief.base;
        balance = relief.remaining;
      }

      if (!destination || !l.amount) return { valued: null, over: false };

      return {
        valued: valueTransferLine({
          amount: l.amount,
          rate,
          sourceIsBase: Boolean(source?.isBase),
          destinationIsBase: destination.isBase,
          drawsLayer,
          releasedBase,
          layerRate: layer?.rate,
        }),
        over: false,
      };
    });
  })();

  const total = editing
    ? draftLines.reduce((t, l) => t + (l.amount || 0), 0)
    : transfer?.transfer_amount ?? 0;

  const fxTotal = editing
    ? preview.reduce((t, p) => t + (p.valued?.fxDifference ?? 0), 0)
    : lines.reduce((t, l) => t + l.fx_difference, 0);

  // ---------------------------------------------------------------- writes

  const onSave = async () => {
    setSaving(true);
    const payload = draftLines
      .filter((l) => l.to_cash_bank_id)
      .map((l) => ({
        to_cash_bank_id: String(l.to_cash_bank_id),
        amount: String(l.amount),
        exchange_rate: l.rate,
      }));
    const result =
      mode === "new"
        ? await createTransfer(values, payload)
        : await updateTransfer(transfer!.id, values, payload);
    setSaving(false);

    if (!result.ok) {
      setErrors(result.errors);
      toast(
        "Gagal menyimpan",
        result.errors._form ??
          result.errors._lines ??
          "Periksa kembali isian yang ditandai.",
        "err"
      );
      return;
    }
    setDirty(false);
    toast(
      mode === "new" ? "Transfer dibuat" : "Perubahan disimpan",
      mode === "new"
        ? `${result.transfer_no} dibuat otomatis. Dokumen masih Draft.`
        : transfer?.transfer_no,
      "ok"
    );
    router.push(`/finance/cash-bank-transfer/${result.id}`);
    router.refresh();
  };

  const run = async (action: TransferAction) => {
    if (!transfer) return;
    setBusy(true);
    const result = await transitionTransfer(transfer.id, action);
    setBusy(false);
    setConfirm(null);
    if (result.ok) {
      toast(result.message, transfer.transfer_no, "ok");
      router.refresh();
      return;
    }
    toast(
      "Tidak dapat diproses",
      result.errors._form ?? Object.values(result.errors)[0],
      "err"
    );
  };

  // ---------------------------------------------------------------- render

  const listHref = "/finance/cash-bank-transfer";
  const backHref = transfer ? `${listHref}/${transfer.id}` : listHref;
  const actions = transfer ? availableTransferActions(transfer.status, can) : [];
  const postable = actions.includes("post") && lines.length > 0;

  /**
   * The view-mode header, in header order: danger, then neutral, then the one
   * primary. `availableTransferActions` returns menu order — safe first —
   * which is the opposite arrangement and right for the row menu only.
   */
  const viewActions: { key: string; tone: ActionTone; node: React.ReactNode }[] =
    transfer
      ? orderForHeader(
          [
            ...(can.edit && transferIsEditable(transfer.status)
              ? [
                  {
                    key: "edit",
                    tone: "neutral" as ActionTone,
                    node: (
                      <Link
                        key="edit"
                        className="btn"
                        href={`${listHref}/${transfer.id}/edit`}
                      >
                        <Icon name="pen" size={15} /> Ubah
                      </Link>
                    ),
                  },
                ]
              : []),
            ...actions.map((a) => {
              const t = TRANSFER_TRANSITIONS[a];
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

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <Link href={listHref}>Finance</Link>
          <span>/</span>
          <Link href={listHref}>Cash Bank Transfer</Link>
          <span>/</span>
          <span className="cur">
            {mode === "new" ? "Baru" : transfer?.transfer_no}
          </span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="link" size={16} />
            </span>
            {transfer ? (
              <>
                <span className="docno">{transfer.transfer_no}</span>
                <span className={`bdg ${STATUS_CLASS[transfer.status] ?? "s-mute"}`}>
                  {STATUS_TEXT[transfer.status] ?? transfer.status}
                </span>
              </>
            ) : (
              "Transfer Baru"
            )}
            {mode === "edit" && <span className="bdg t-vio">Mode Ubah</span>}
          </h1>
          <div className="ph-act">
            {editing && dirty && (
              <span className="ph-dirty">
                <span className="pulse" /> Belum disimpan
              </span>
            )}
            {mode === "view" && transfer && (
              <>
                {viewActions.map((i) => i.node)}
                {!actions.length && (
                  <span className="lockchip">
                    <Icon name="lock" size={13} />{" "}
                    {transfer.status === "Posted"
                      ? "Terkunci setelah Post"
                      : "Dokumen dibatalkan"}
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
                <Icon name="link" size={15} />
              </span>
              <div className="ct">
                <h3>Sumber Dana</h3>
                <p>
                  Purpose menentukan hubungan mata uang kedua sisi; Cash &amp;
                  Bank di sini adalah sumbernya.
                </p>
              </div>
            </div>
            <FormBody>
              <FormSection>
                <FormRow>
                  <Field
                    label="Purpose"
                    span={4}
                    required={editing}
                    help={purpose ? purpose.hint : editing ? "hubungan mata uang" : undefined}
                    error={errors.purpose}
                  >
                    {editing ? (
                      <Select
                        value={values.purpose}
                        invalid={Boolean(errors.purpose)}
                        placeholder="Pilih Purpose…"
                        options={TRANSFER_PURPOSES.map((p) => ({
                          value: p.key,
                          label: p.label,
                          hint: p.hint,
                        }))}
                        onChange={(v) => set("purpose", v)}
                      />
                    ) : (
                      <div className="ro">
                        <span>
                          {transferPurposeOf(transfer!.purpose)?.label ??
                            transfer!.purpose}
                        </span>
                      </div>
                    )}
                  </Field>

                  <Field
                    label="Cash & Bank Sumber"
                    span={4}
                    required={editing}
                    help={editing ? "uang keluar dari sini" : undefined}
                    error={errors.from_cash_bank_id}
                  >
                    {editing ? (
                      <Combobox
                        value={
                          values.from_cash_bank_id
                            ? Number(values.from_cash_bank_id)
                            : null
                        }
                        options={sourceOptions}
                        placeholder="Pilih Cash & Bank…"
                        // The Purpose states which side of the exchange the
                        // source is on — rupiah for a purchase, foreign for a
                        // Pencairan — so choosing the resource first meant
                        // picking from a list the Purpose would then
                        // contradict, and having the selection silently
                        // cleared out from under the field.
                        waitingFor={purpose ? null : "Pilih Purpose dulu…"}
                        invalid={Boolean(errors.from_cash_bank_id)}
                        onChange={(v) =>
                          set("from_cash_bank_id", v ? String(v) : "")
                        }
                      />
                    ) : (
                      <div className="ro">
                        <span className="lab">
                          {refs.cashBanks.find(
                            (c) => c.id === transfer!.from_cash_bank_id
                          )?.label ?? "—"}
                        </span>
                        <span>
                          {refs.cashBanks.find(
                            (c) => c.id === transfer!.from_cash_bank_id
                          )?.name ?? ""}
                        </span>
                      </div>
                    )}
                  </Field>

                  <Field
                    label={currencyFollowsSource ? "Currency" : "Valuta Dibeli"}
                    span={4}
                    required={editing && !currencyFollowsSource}
                    help={
                      editing && currencyFollowsSource
                        ? "mengikuti Cash & Bank sumber"
                        : undefined
                    }
                    error={errors.currency_id}
                  >
                    {editing && !currencyFollowsSource ? (
                      <Combobox
                        value={values.currency_id ? Number(values.currency_id) : null}
                        options={refs.currencies
                          .filter((c) => !c.isBase)
                          .filter((c) => c.active || String(c.id) === values.currency_id)}
                        placeholder="Pilih valuta…"
                        invalid={Boolean(errors.currency_id)}
                        onChange={(v) => set("currency_id", v ? String(v) : "")}
                      />
                    ) : (
                      <div className="ro">
                        <span className="lab">{currencyLabel}</span>
                        <span>
                          {currencyFollowsSource
                            ? "mata uang dokumen"
                            : "valuta yang dibeli"}
                        </span>
                      </div>
                    )}
                  </Field>
                </FormRow>

                <FormRow>
                  {/* The layer, only where foreign currency leaves a foreign
                      resource. Absent entirely for rupiah and for a purchase,
                      where nothing is drawn from a stack. */}
                  {drawsLayer && (
                    <Field
                      label="Kurs Sumber"
                      span={4}
                      required={editing}
                      help={editing ? "satu transfer memakai satu layer" : undefined}
                      error={errors.cash_bank_layer_id}
                    >
                      {editing ? (
                        <KursSelect
                          value={
                            values.cash_bank_layer_id
                              ? Number(values.cash_bank_layer_id)
                              : null
                          }
                          layers={source?.layers ?? []}
                          currencyLabel={currencyLabel}
                          invalid={Boolean(errors.cash_bank_layer_id)}
                          onChange={(v) =>
                            set("cash_bank_layer_id", v ? String(v) : "")
                          }
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
                  )}

                  <Field label="Tanggal Dokumen" span={4}>
                    <div className="ro">
                      {transfer?.document_date ? (
                        formatDate(transfer.document_date)
                      ) : (
                        <span className="dash">dicatat saat diposting</span>
                      )}
                    </div>
                  </Field>

                  <Field label="Catatan" span={drawsLayer ? 4 : 8}>
                    {editing ? (
                      <textarea
                        className="ta"
                        rows={2}
                        value={values.note}
                        onChange={(e) => set("note", e.target.value)}
                        placeholder="Keterangan tambahan untuk transfer ini…"
                      />
                    ) : (
                      <div className="ro">
                        {transfer!.note || <span className="dash">—</span>}
                      </div>
                    )}
                  </Field>
                </FormRow>
              </FormSection>
            </FormBody>

            {mode === "view" && (
              <p className="fnote">
                {transfer!.status === "Posted"
                  ? "Transfer sudah menjadi transaksi aktual: saldo kedua sisi sudah bergerak, entri Cash Bank Book dan Journal sudah tercatat. Historical record bersifat append-only — koreksi dilakukan sebagai dokumen baru."
                  : transfer!.status === "Draft"
                    ? "Dokumen masih Draft. Belum ada saldo yang bergerak, dan Tanggal Dokumen belum dicatat."
                    : "Dokumen dibatalkan sebelum Post, sehingga tidak pernah menyentuh saldo mana pun."}
              </p>
            )}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="wallet" size={15} />
              </span>
              <div className="ct">
                <h3>Tujuan</h3>
                <p>
                  Satu transfer dapat membagi dana ke beberapa Cash &amp; Bank
                  sekaligus.
                </p>
              </div>
              {editing ? (
                <button
                  className="btn sm primary"
                  disabled={!headerReady}
                  title={destinationWaitingFor ?? undefined}
                  onClick={() => {
                    setDraftLines((rows) => [
                      ...rows,
                      { key: nextKey++, to_cash_bank_id: null, amount: 0, rate: "" },
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
                <table className="grid ltab">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>No</th>
                      <th>Cash &amp; Bank Tujuan</th>
                      <th className="num" style={{ width: 150 }}>
                        Nominal ({currencyLabel})
                      </th>
                      {purpose?.entersRate && (
                        <th className="num" style={{ width: 150 }}>
                          Kurs ({currencyLabel} → {BASE_CURRENCY_LABEL})
                        </th>
                      )}
                      <th className="num" style={{ width: 160 }}>
                        Keluar
                      </th>
                      <th className="num" style={{ width: 160 }}>
                        Masuk
                      </th>
                      {editing && <th style={{ width: 44 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {editing
                      ? draftLines.map((l, i) => {
                          const p = preview[i];
                          const destination = refs.cashBanks.find(
                            (c) => c.id === l.to_cash_bank_id
                          );
                          return (
                            <tr key={l.key} className={p?.over ? "overrow" : undefined}>
                              <td className="no">{i + 1}</td>
                              <td className="pri">
                                <Combobox
                                  size="sm"
                                  value={l.to_cash_bank_id}
                                  options={destinationOptions(l.to_cash_bank_id)}
                                  placeholder="Pilih Cash & Bank…"
                                  waitingFor={destinationWaitingFor}
                                  onChange={(v) => {
                                    setDraftLines((rows) =>
                                      rows.map((r) =>
                                        r.key === l.key
                                          ? { ...r, to_cash_bank_id: v }
                                          : r
                                      )
                                    );
                                    setDirty(true);
                                  }}
                                />
                              </td>
                              <td className="num">
                                <MoneyInput
                                  size="sm"
                                  over={p?.over}
                                  ariaLabel="Nominal"
                                  value={l.amount ? String(l.amount) : ""}
                                  onChange={(raw) => {
                                    setDraftLines((rows) =>
                                      rows.map((r) =>
                                        r.key === l.key
                                          ? { ...r, amount: raw ? Number(raw) : 0 }
                                          : r
                                      )
                                    );
                                    setDirty(true);
                                  }}
                                />
                                {p?.over && (
                                  <span className="overtag" title="Melebihi sisa layer">
                                    Melebihi sisa layer
                                  </span>
                                )}
                              </td>
                              {purpose?.entersRate && (
                                <td className="num">
                                  <RateInput
                                    size="sm"
                                    value={l.rate}
                                    // The pair is stated once, in the column
                                    // header. Inside a 150px cell the label
                                    // and a six-decimal rate do not both fit,
                                    // and what gets truncated is the figure
                                    // the operator has to check.
                                    ariaLabel="Kurs"
                                    onChange={(v) => {
                                      setDraftLines((rows) =>
                                        rows.map((r) =>
                                          r.key === l.key ? { ...r, rate: v } : r
                                        )
                                      );
                                      setDirty(true);
                                    }}
                                  />
                                </td>
                              )}
                              <td className="num">
                                <span className="mny">
                                  {p?.valued
                                    ? formatMoney(
                                        p.valued.outAmount,
                                        source?.currencyLabel ?? currencyLabel
                                      )
                                    : "—"}
                                </span>
                              </td>
                              <td className="num">
                                <span className="mny">
                                  {p?.valued && destination
                                    ? formatMoney(
                                        p.valued.inAmount,
                                        destination.currencyLabel
                                      )
                                    : "—"}
                                </span>
                                {p?.valued && p.valued.fxDifference !== 0 && (
                                  <span className="rsub">
                                    selisih kurs{" "}
                                    {formatMoney(
                                      p.valued.fxDifference,
                                      BASE_CURRENCY_LABEL
                                    )}
                                  </span>
                                )}
                              </td>
                              <td className="acts">
                                <button
                                  className="iact del"
                                  title="Keluarkan dari dokumen"
                                  onClick={() => {
                                    setDraftLines((rows) =>
                                      rows.filter((r) => r.key !== l.key)
                                    );
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
                          const destination = refs.cashBanks.find(
                            (c) => c.id === l.to_cash_bank_id
                          );
                          return (
                            <tr key={l.id}>
                              <td className="no">{i + 1}</td>
                              <td className="pri">
                                <span className="dstack">
                                  <span className="d1">
                                    {destination?.label ?? "—"}
                                  </span>
                                  <span className="d2">
                                    {destination?.name ?? ""}
                                  </span>
                                </span>
                              </td>
                              <td className="num">
                                <span className="mny">
                                  {formatMoney(l.amount, currencyLabel)}
                                </span>
                              </td>
                              {purpose?.entersRate && (
                                <td className="num">
                                  <span className="mny">
                                    {formatRate(l.exchange_rate)}
                                  </span>
                                </td>
                              )}
                              <td className="num">
                                <span className="mny">
                                  {formatMoney(
                                    l.out_amount,
                                    refs.cashBanks.find(
                                      (c) => c.id === transfer!.from_cash_bank_id
                                    )?.currencyLabel ?? currencyLabel
                                  )}
                                </span>
                              </td>
                              <td className="num">
                                <span className="mny">
                                  {formatMoney(
                                    l.in_amount,
                                    destination?.currencyLabel ?? currencyLabel
                                  )}
                                </span>
                                {l.fx_difference !== 0 && (
                                  <span className="rsub">
                                    selisih kurs{" "}
                                    {formatMoney(
                                      l.fx_difference,
                                      BASE_CURRENCY_LABEL
                                    )}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                  </tbody>
                  <tfoot>
                    <tr className="totrow">
                      <td
                        colSpan={purpose?.entersRate ? 3 : 2}
                        style={{ textAlign: "right" }}
                      >
                        Total Dipindahkan
                      </td>
                      <td className="num" colSpan={2}>
                        <span className="mny big">
                          {formatMoney(total, currencyLabel)}
                        </span>
                      </td>
                      {editing && <td />}
                    </tr>
                    {/* A row of its own rather than a `.rsub` under the total:
                        `.rsub` is scoped to `tbody td`, so in a footer it runs
                        inline into the figure beside it — and a realized gain
                        is a figure in its own right, not an annotation on the
                        amount transferred. */}
                    {fxTotal !== 0 && (
                      <tr className="totrow">
                        <td
                          colSpan={purpose?.entersRate ? 3 : 2}
                          style={{ textAlign: "right" }}
                        >
                          {fxTotal > 0 ? "Laba Selisih Kurs" : "Rugi Selisih Kurs"}
                        </td>
                        <td className="num" colSpan={2}>
                          <span className="mny">
                            {formatMoney(fxTotal, BASE_CURRENCY_LABEL)}
                          </span>
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
                  <Icon name="wallet" size={18} />
                </div>
                <h4>Belum ada tujuan</h4>
                <p>
                  {headerReady
                    ? "Tambahkan Cash & Bank yang menerima dananya."
                    : "Lengkapi Purpose dan Cash & Bank sumber terlebih dahulu."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirm && transfer && (
        <ConfirmDialog
          open
          icon={TRANSFER_TRANSITIONS[confirm].icon}
          tone={TRANSFER_TRANSITIONS[confirm].tone === "danger" ? "danger" : "ok"}
          title={TRANSFER_TRANSITIONS[confirm].title}
          subject={`${transfer.transfer_no} – ${formatMoney(
            transfer.transfer_amount,
            currencyLabel
          )}`}
          body={TRANSFER_TRANSITIONS[confirm].body}
          confirmLabel={TRANSFER_TRANSITIONS[confirm].confirmLabel}
          confirmTone={
            TRANSFER_TRANSITIONS[confirm].tone === "danger"
              ? "solid-danger"
              : "primary"
          }
          busy={busy}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

