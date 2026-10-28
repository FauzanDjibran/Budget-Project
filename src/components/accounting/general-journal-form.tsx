"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { Dialog } from "@/components/ui/dialog";
import { DocumentHeader } from "@/components/ui/document-header";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { JournalPreview } from "@/components/ui/journal-preview";
import { MoneyInput } from "@/components/ui/money-input";
import { PartnerCell } from "@/components/ui/partner-cell";
import { RateInput } from "@/components/ui/rate-input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  createGeneralJournalAction,
  listGeneralJournalOptions,
  previewGeneralJournalPost,
  transitionGeneralJournal,
  updateGeneralJournalAction,
  type GeneralJournalFormLine,
} from "@/app/actions/general-journal";
import { formatDate, formatForeignFace, formatMoney, formatRate, todayIso } from "@/lib/format";
import { LEDGER_TEXT } from "@/lib/siba/account-code";
import type { Company } from "@/lib/siba/company-access";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { drawLayer, relieve, roundBase } from "@/lib/siba/fx";
import type {
  GeneralJournalDetail,
  GeneralJournalLineRow,
  GeneralJournalOptions,
} from "@/lib/siba/general-journal-rows";
import { valueGeneralJournal } from "@/lib/siba/general-journal-valuation";
import {
  GENERAL_JOURNAL_TRANSITIONS,
  availableGeneralJournalActions,
  generalJournalIsEditable,
  lineEffectText,
  type GeneralJournalAbilities,
  type GeneralJournalAction,
} from "@/lib/siba/general-journal-workflow";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/siba/header-actions";

export type GeneralJournalFormMode = "new" | "view" | "edit";

type Side = "debit" | "credit";

/** One row of the editor, before it is a database row. */
type DraftLine = {
  key: number;
  account_id: number | null;
  partner_id: number | null;
  /** An open item (or "new"), or a Cash & Bank, as a picker value. */
  subject: string;
  /** A rate layer, or "new" for money arriving in a foreign Cash & Bank. */
  layer_id: string;
  currency_id: number | null;
  exchange_rate: string;
  /** In the line's own currency; one of the two is filled, and that is its side. */
  debit: string;
  credit: string;
  new_value: string;
  description: string;
};

let nextKey = 1;
const blankLine = (): DraftLine => ({
  key: nextKey++,
  account_id: null,
  partner_id: null,
  subject: "",
  layer_id: "",
  currency_id: null,
  exchange_rate: "",
  debit: "",
  credit: "",
  new_value: "",
  description: "",
});

const NEW_ITEM = "new";
const cents = (n: number) => Math.round(n * 100);
const other = (s: Side): Side => (s === "debit" ? "credit" : "debit");
/** The side that raises a book: money in raises a Hutang, credited. */
const raiseOf = (book: { raises: "In" | "Out" } | null | undefined): Side =>
  book?.raises === "In" ? "credit" : "debit";

const EMPTY: GeneralJournalOptions = {
  accounts: [],
  partners: [],
  books: [],
  items: [],
  cashBanks: [],
  layers: {},
  currencies: [],
};

/**
 * Jurnal Umum — read, created and edited on the same two cards (Journal 2.0).
 *
 * A line is filled Account → Subjek → Entri → Currency → Kurs → Debit or
 * Kredit, as the manual journal is: the account brings its ledger, and the
 * column the amount is typed in is the line's side, which against the
 * ledger's direction says whether it raises or lowers (D19). An entry that
 * can only move one way — *Item baru*, a layer drawn, *Layer baru* — opens
 * only that column. **Saldo Baru** states the value an entry should hold;
 * the side and amount follow (D14).
 *
 * The base figures and the one Selisih Kurs line are the valuation Post runs,
 * from what the options say now; the Server Action values against the
 * ledgers on the journal's date, and that is what is saved.
 */
export function GeneralJournalForm({
  mode,
  journal,
  companies = [],
  options: initialOptions = EMPTY,
  can,
}: {
  mode: GeneralJournalFormMode;
  journal: GeneralJournalDetail | null;
  companies?: Company[];
  options?: GeneralJournalOptions;
  can?: GeneralJournalAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";

  const [companyId, setCompanyId] = useState<number | null>(
    journal?.companyId ?? companies[0]?.id ?? null
  );
  const [description, setDescription] = useState(journal?.description ?? "");
  const [journalDate, setJournalDate] = useState(journal?.accountingDate ?? todayIso());
  const [options, setOptions] = useState(initialOptions);
  const [lines, setLines] = useState<DraftLine[]>(() =>
    journal
      ? journal.lines
          .filter((l) => !l.isGenerated)
          .map((l) => ({
            key: nextKey++,
            account_id: l.accountId,
            partner_id: l.partnerId,
            subject:
              l.ledger === "subject_book"
                ? String(l.subjectId ?? NEW_ITEM)
                : l.subjectId
                  ? String(l.subjectId)
                  : "",
            layer_id: l.layerId
              ? String(l.layerId)
              : l.ledger === "cash_bank" && l.foreign && l.debit > 0
                ? NEW_ITEM
                : "",
            currency_id: l.currencyId,
            exchange_rate: l.foreign ? String(l.rate) : "",
            debit: l.newValue == null && l.debit > 0 ? String(l.trxAmount) : "",
            credit: l.newValue == null && l.credit > 0 ? String(l.trxAmount) : "",
            new_value: l.newValue == null ? "" : String(l.newValue),
            description: l.description === journal.description ? "" : l.description,
          }))
      : [blankLine(), blankLine()]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<GeneralJournalAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [postReady, setPostReady] = useState(false);
  const [detail, setDetail] = useState<GeneralJournalLineRow | null>(null);

  // A Company's chart is its own: changing it clears every line's account.
  const loadedFor = useRef(companyId);
  useEffect(() => {
    if (mode !== "new" || !companyId || loadedFor.current === companyId) return;
    loadedFor.current = companyId;
    let cancelled = false;
    void listGeneralJournalOptions(companyId).then((result) => {
      if (cancelled || !result.ok) return;
      setOptions(result.options);
      setLines([blankLine(), blankLine()]);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, mode]);

  const by = useMemo(
    () => ({
      account: new Map(options.accounts.map((a) => [a.id, a])),
      book: new Map(options.books.map((b) => [b.id, b])),
      item: new Map(options.items.map((i) => [String(i.id), i])),
      cash: new Map(options.cashBanks.map((c) => [String(c.id), c])),
      currency: new Map(options.currencies.map((c) => [c.id, c])),
    }),
    [options]
  );

  /** What one draft line resolves to, as the adapters resolve it. */
  const resolve = (l: DraftLine) => {
    const account = l.account_id ? by.account.get(l.account_id) ?? null : null;
    const ledger = account?.ledger ?? "none";
    const book = account?.bookId ? by.book.get(account.bookId) ?? null : null;
    const item = ledger === "subject_book" ? by.item.get(l.subject) ?? null : null;
    const cash = ledger === "cash_bank" ? by.cash.get(l.subject) ?? null : null;
    const currencyId = item?.currencyId ?? cash?.currencyId ?? l.currency_id;
    const currency = currencyId ? by.currency.get(currencyId) ?? null : null;

    const raise: Side = ledger === "cash_bank" ? "debit" : raiseOf(book);
    // An entry that can move only one way opens only that column.
    const only: Side | null =
      ledger === "subject_book" && l.subject === NEW_ITEM
        ? raise
        : ledger === "cash_bank" && l.layer_id
          ? l.layer_id === NEW_ITEM
            ? "debit"
            : "credit"
          : null;

    // Saldo Baru: the side and amount follow from what the entry holds now.
    const held = item ? item.remaining : cash ? cash.balance : null;
    const target = l.new_value === "" ? null : Number(l.new_value);
    let side: Side | "" = Number(l.debit) > 0 ? "debit" : Number(l.credit) > 0 ? "credit" : "";
    let face = side ? Number(l[side]) : 0;
    if (target != null && held != null && cents(target) !== cents(held)) {
      side = target > held ? raise : other(raise);
      face = cents(Math.abs(target - held)) / 100;
    } else if (target != null) {
      face = 0;
    }

    const layers = cash ? options.layers[cash.id] ?? [] : [];
    const layer = layers.find((x) => String(x.id) === l.layer_id) ?? null;
    let rate = currency?.isBase ? 1 : Number(l.exchange_rate || 0);
    let base: number | undefined;
    if (item && side) {
      rate = item.rate;
      const raising = (side === "credit") === (book?.raises === "In");
      base = raising
        ? roundBase(face * item.rate)
        : face > 0 && cents(face) <= cents(item.remaining)
          ? relieve(
              { foreign: item.remaining, base: item.baseRemaining },
              cents(face) === cents(item.remaining) ? item.remaining : face
            ).base
          : undefined;
    }
    if (layer && side === "credit" && face > 0 && cents(face) <= cents(layer.foreignRemaining)) {
      rate = layer.rate;
      base = drawLayer(
        { foreign: layer.foreignRemaining, base: layer.baseRemaining, rate: layer.rate },
        cents(face) === cents(layer.foreignRemaining) ? layer.foreignRemaining : face
      ).base;
    }
    return { account, ledger, book, item, cash, currency, layers, layer, side, face, rate, base, held, only };
  };

  const resolved = lines.map(resolve);
  const valued = useMemo(
    () =>
      valueGeneralJournal(
        resolved
          .filter((r) => r.side && r.currency && r.face > 0 && r.rate > 0)
          .map((r) => ({
            currencyLabel: r.currency!.label,
            isBase: r.currency!.isBase,
            side: r.side as Side,
            face: r.face,
            rate: r.rate,
            baseAmount: r.base,
          }))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, options]
  );

  const totalDebit = editing ? valued.debit : journal!.debit;
  const totalCredit = editing ? valued.credit : journal!.credit;
  const difference = roundBase(totalDebit - totalCredit);
  const status = journal?.status ?? "Draft";

  const setLine = (key: number, patch: Partial<DraftLine>) => {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  async function onSave() {
    setSaving(true);
    setErrors({});
    const header = {
      company_id: companyId ? String(companyId) : "",
      journal_date: journalDate,
      description,
    };
    const payload: GeneralJournalFormLine[] = lines.map((l, i) => {
      const r = resolved[i];
      return {
        account_id: l.account_id ? String(l.account_id) : "",
        side: r.side,
        partner_id: l.partner_id ? String(l.partner_id) : "",
        subject_id: l.subject === NEW_ITEM ? "" : l.subject,
        cash_bank_layer_id: l.layer_id === NEW_ITEM ? "" : l.layer_id,
        currency_id: r.currency ? String(r.currency.id) : "",
        exchange_rate: l.exchange_rate,
        amount: l.new_value !== "" || !r.side ? "" : l[r.side],
        new_value: l.new_value,
        description: l.description,
      };
    });
    const result =
      mode === "new"
        ? await createGeneralJournalAction(header, payload)
        : await updateGeneralJournalAction(journal!.id, header, payload);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast("Jurnal Umum belum tersimpan", result.errors._form ?? "Periksa kembali isian pada baris jurnal.", "err");
      return;
    }
    setDirty(false);
    toast("Jurnal Umum disimpan", `${result.journalNo} · Draft`, "ok");
    router.push(`/accounting/jurnal-umum/${result.id}`);
  }

  const run = async (action: GeneralJournalAction) => {
    if (!journal) return;
    setBusy(true);
    const result = await transitionGeneralJournal(journal.id, action);
    setBusy(false);
    setConfirm(null);
    setPostReady(false);
    if (result.ok) toast(result.message, journal.journalNo, "ok");
    else toast("Tidak dapat diproses", result.errors._form ?? Object.values(result.errors)[0], "err");
  };

  const listHref = "/accounting/jurnal-umum";
  const backHref = journal ? `${listHref}/${journal.id}` : listHref;
  const actions = journal && can ? availableGeneralJournalActions(status, can) : [];
  const viewActions: { key: string; tone: ActionTone; node: React.ReactNode }[] = journal
    ? orderForHeader(
        [
          ...(can?.edit && generalJournalIsEditable(status)
            ? [
                {
                  key: "edit",
                  tone: "neutral" as ActionTone,
                  node: (
                    <Link key="edit" className="btn" href={`${listHref}/${journal.id}/edit`}>
                      <Icon name="pen" size={15} /> Ubah
                    </Link>
                  ),
                },
              ]
            : []),
          ...actions.map((a) => {
            const t = GENERAL_JOURNAL_TRANSITIONS[a];
            return {
              key: a,
              tone: t.tone,
              node: (
                <button key={a} className={headerButtonClass(t.tone)} disabled={busy} onClick={() => setConfirm(a)}>
                  <Icon name={t.icon} size={15} /> {t.label}
                </button>
              ),
            };
          }),
        ],
        (i) => i.tone
      )
    : [];

  const err = (i: number, field: string) =>
    errors[`lines.${i}.${field}`] && (
      <div className="err">
        <Icon name="warn" size={11} />
        {errors[`lines.${i}.${field}`]}
      </div>
    );
  const dash = (text = "—") => <span className="dash">{text}</span>;

  return (
    <>
      <DocumentHeader
        module="Accounting"
        trail={[{ label: "Jurnal Umum", href: listHref }]}
        icon="book"
        number={journal?.journalNo ?? null}
        placeholder="Jurnal Umum Baru"
        status={journal?.status ?? null}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {mode === "view" && journal ? (
          <>
            {viewActions.map((i) => i.node)}
            {!actions.length && !(can?.edit && generalJournalIsEditable(status)) && (
              <span className="lockchip">
                <Icon name="lock" size={13} />{" "}
                {status === "Posted" ? "Terkunci setelah Post" : status === "Cancelled" ? "Jurnal dibatalkan" : "Tidak ada aksi untuk Anda"}
              </span>
            )}
          </>
        ) : (
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
                <Icon name="book" size={15} />
              </span>
              <div className="ct">
                <h3>Jurnal Umum</h3>
                <p>Satu jurnal untuk setiap buku bernilai uang: buku besar, Buku Subjek, dan Kas &amp; Bank.</p>
              </div>
            </div>
            <FormBody>
              <FormSection>
                <FormRow>
                  <Field
                    label="Company"
                    span={4}
                    required={mode === "new"}
                    locked={mode === "edit"}
                    help={mode === "new" ? "menentukan bagan akun" : undefined}
                    error={errors.company_id}
                  >
                    {mode === "new" && companies.length > 1 ? (
                      <Select
                        value={companyId ? String(companyId) : ""}
                        invalid={Boolean(errors.company_id)}
                        placeholder="Pilih Company…"
                        options={companies.map((c) => ({ value: String(c.id), label: `${c.label} - ${c.name}` }))}
                        onChange={(v) => {
                          setCompanyId(v ? Number(v) : null);
                          setDirty(true);
                        }}
                      />
                    ) : (
                      <div className="ro">
                        <span className="lab">
                          {journal?.companyLabel ?? companies.find((c) => c.id === companyId)?.label ?? "—"}
                        </span>
                        <span>{journal?.companyName ?? companies.find((c) => c.id === companyId)?.name ?? ""}</span>
                      </div>
                    )}
                  </Field>

                  <Field
                    label="Tanggal Akuntansi"
                    span={3}
                    required={editing}
                    help={editing ? "boleh mundur, tidak ke depan" : undefined}
                    error={errors.journal_date}
                  >
                    {editing ? (
                      <DateInput
                        value={journalDate}
                        invalid={Boolean(errors.journal_date)}
                        onChange={(v) => {
                          setJournalDate(v);
                          setDirty(true);
                        }}
                      />
                    ) : (
                      <div className="ro">{journal?.accountingDate ? formatDate(journal.accountingDate) : dash()}</div>
                    )}
                  </Field>

                  <Field
                    htmlFor="general-journal-description"
                    label="Keterangan"
                    span={5}
                    required={editing}
                    help={editing ? "alasan jurnal ini dibuat" : undefined}
                    error={errors.description}
                  >
                    {editing ? (
                      <input
                        id="general-journal-description"
                        className={`inp${errors.description ? " bad" : ""}`}
                        type="text"
                        autoComplete="off"
                        value={description}
                        placeholder="Koreksi saldo piutang PT Sinar Abadi"
                        onChange={(e) => {
                          setDescription(e.target.value);
                          setDirty(true);
                        }}
                      />
                    ) : (
                      <div className="ro multi">{journal!.description}</div>
                    )}
                  </Field>
                </FormRow>
                {mode === "view" && journal?.postedJournalNo && (
                  <FormRow>
                    <Field label="Journal" span={4}>
                      <div className="ro">
                        <Link className="lab" href={`/accounting/journal/${journal.postedJournalId}`}>
                          {journal.postedJournalNo}
                        </Link>
                      </div>
                    </Field>
                  </FormRow>
                )}
              </FormSection>
            </FormBody>

            <p className="fnote">
              {editing || status === "Draft"
                ? "Draft belum menyentuh buku mana pun. Post menulis setiap Buku Subjek dan Kas & Bank yang disentuh barisnya bersama buku besar, sekaligus."
                : status === "Cancelled"
                  ? "Jurnal dibatalkan sebelum diposting, sehingga tidak pernah menyentuh buku mana pun."
                  : "Jurnal sudah diposting ke setiap buku dan buku besar, dan bersifat final: koreksi dilakukan dengan Jurnal Umum baru."}
            </p>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="layers" size={15} />
              </span>
              <div className="ct">
                <h3>Baris Jurnal</h3>
                <p>
                  {editing
                    ? `Debit dan kredit diisi dalam mata uang barisnya; total dan Selisih Kurs dalam ${BASE_CURRENCY_LABEL}.`
                    : `Debit dan kredit dalam ${BASE_CURRENCY_LABEL}; baris valas menyebut nilai asal dan kursnya.`}
                </p>
              </div>
              {editing ? (
                <button
                  className="btn sm primary"
                  disabled={!companyId}
                  title={companyId ? undefined : "Pilih Company dulu…"}
                  onClick={() => {
                    setLines((rows) => [...rows, blankLine()]);
                    setDirty(true);
                  }}
                >
                  <Icon name="plus" size={14} /> Tambah Baris
                </button>
              ) : (
                <span className="hint">{journal!.lines.length} baris</span>
              )}
            </div>

            <div className="tw">
              <table className="grid ltab" style={{ minWidth: editing ? 1420 : 1060 }}>
                <thead>
                  {editing ? (
                    <tr>
                      <th style={{ width: 34 }}>No</th>
                      <th style={{ width: 210 }}>Account</th>
                      <th style={{ width: 170 }}>Subjek</th>
                      <th style={{ width: 170 }}>Entri</th>
                      <th style={{ width: 84 }}>Currency</th>
                      <th className="num" style={{ width: 120 }}>Kurs</th>
                      <th className="num" style={{ width: 150 }}>Debit</th>
                      <th className="num" style={{ width: 150 }}>Kredit</th>
                      <th className="num" style={{ width: 150 }}>Saldo Baru</th>
                      <th style={{ minWidth: 140 }}>Keterangan</th>
                      <th style={{ width: 44 }} />
                    </tr>
                  ) : (
                    <tr>
                      <th style={{ width: 34 }}>No</th>
                      <th style={{ width: 280 }}>Account</th>
                      <th style={{ width: 220 }}>Subjek</th>
                      <th>Keterangan</th>
                      <th className="num" style={{ width: 150 }}>Debit</th>
                      <th className="num" style={{ width: 150 }}>Kredit</th>
                      <th style={{ width: 44 }} />
                    </tr>
                  )}
                </thead>
                <tbody>
                  {editing
                    ? lines.map((l, i) => {
                        const r = resolved[i];
                        const ledger = r.ledger;
                        const derived = l.new_value !== "";
                        const foreignCash = ledger === "cash_bank" && r.currency && !r.currency.isBase;
                        const waitAccount = l.account_id ? null : "Pilih Account dulu…";
                        const partners = options.partners.filter((p) =>
                          ledger === "subject_book"
                            ? r.book?.partnerCategoryIds.includes(p.categoryId)
                            : !r.account?.partnerCategoryId || p.categoryId === r.account.partnerCategoryId
                        );
                        const effect = r.side ? lineEffectText(ledger, r.side, r.book?.raises ?? null) : null;
                        const fixedRate = Boolean(r.item) || Boolean(r.layer);
                        /** One side's amount: typed, derived from Saldo Baru, or closed to this entry. */
                        const amountCell = (side: Side) => (
                          <td className="num">
                            {derived ? (
                              r.side === side && r.face > 0 ? (
                                <Amount value={r.face} currency={r.currency?.label} />
                              ) : (
                                dash()
                              )
                            ) : r.only && r.only !== side ? (
                              dash()
                            ) : (
                              <MoneyInput
                                size="sm"
                                value={l[side]}
                                ariaLabel={`${side === "debit" ? "Debit" : "Kredit"} baris ${i + 1}`}
                                currencyLabel={r.currency?.label}
                                invalid={Boolean(errors[`lines.${i}.amount`])}
                                onChange={(v) => setLine(l.key, { [side]: v, [other(side)]: v ? "" : l[other(side)] })}
                              />
                            )}
                            {r.side === side && r.currency && !r.currency.isBase && r.face > 0 && r.rate > 0 && (
                              <span className="rsub">
                                ≈ <span className="mny">{formatMoney(r.base ?? roundBase(r.face * r.rate), BASE_CURRENCY_LABEL)}</span>
                              </span>
                            )}
                            {side === "credit" && err(i, "amount")}
                          </td>
                        );
                        return (
                          <tr key={l.key}>
                            <td className="no">{i + 1}</td>
                            <td>
                              <Combobox
                                value={l.account_id}
                                placeholder="Pilih Account…"
                                size="sm"
                                invalid={Boolean(errors[`lines.${i}.account_id`])}
                                options={options.accounts.map((a) => ({ id: a.id, label: a.label, name: a.name, active: true }))}
                                onChange={(v) =>
                                  setLine(l.key, { ...blankLine(), key: l.key, account_id: v, description: l.description })
                                }
                              />
                              {r.account && r.ledger !== "none" && (
                                <span className="rsub">{LEDGER_TEXT[r.ledger as keyof typeof LEDGER_TEXT]}</span>
                              )}
                              {err(i, "account_id")}
                            </td>
                            <td>
                              {ledger === "none" ? (
                                dash()
                              ) : ledger === "cash_bank" ? (
                                <Select
                                  size="sm"
                                  value={l.subject}
                                  placeholder="Pilih Cash & Bank…"
                                  ariaLabel={`Cash & Bank baris ${i + 1}`}
                                  invalid={Boolean(errors[`lines.${i}.subject_id`])}
                                  options={options.cashBanks
                                    .filter((c) => c.accountId === l.account_id)
                                    .map((c) => ({ value: String(c.id), label: `${c.label} – ${c.name}` }))}
                                  onChange={(v) => setLine(l.key, { subject: v, layer_id: "", new_value: "" })}
                                />
                              ) : (
                                <Combobox
                                  value={l.partner_id}
                                  placeholder="Pilih Partner…"
                                  size="sm"
                                  waitingFor={waitAccount}
                                  invalid={Boolean(errors[`lines.${i}.partner_id`])}
                                  options={partners.map((p) => ({ id: p.id, label: p.label, name: p.name, active: true }))}
                                  onChange={(v) => setLine(l.key, { partner_id: v, subject: "", new_value: "" })}
                                />
                              )}
                              {err(i, "partner_id")}
                              {err(i, "subject_id")}
                            </td>
                            <td>
                              {ledger === "subject_book" ? (
                                <Select
                                  size="sm"
                                  searchable
                                  value={l.subject}
                                  placeholder="Pilih open item…"
                                  waitingFor={l.partner_id ? null : "Pilih Partner dulu…"}
                                  ariaLabel={`Open item baris ${i + 1}`}
                                  options={[
                                    ...(derived ? [] : [{ value: NEW_ITEM, label: "Item baru" }]),
                                    ...options.items
                                      .filter((it) => it.bookId === r.book?.id && it.partnerId === l.partner_id)
                                      .map((it) => {
                                        const cur = by.currency.get(it.currencyId);
                                        return {
                                          value: String(it.id),
                                          label: `${it.itemNo} · ${formatDate(it.date)}`,
                                          hint: cur?.isBase
                                            ? formatMoney(it.remaining, cur.label)
                                            : `${formatMoney(it.remaining, cur?.label)} @ ${formatRate(it.rate)}`,
                                        };
                                      }),
                                  ]}
                                  onChange={(v) =>
                                    // Item baru only raises: a lowering amount typed before it goes.
                                    setLine(l.key, {
                                      subject: v,
                                      new_value: v === NEW_ITEM ? "" : l.new_value,
                                      ...(v === NEW_ITEM && { [other(raiseOf(r.book))]: "" }),
                                    })
                                  }
                                />
                              ) : foreignCash ? (
                                <Select
                                  size="sm"
                                  value={l.layer_id}
                                  placeholder="Pilih layer…"
                                  ariaLabel={`Layer kurs baris ${i + 1}`}
                                  invalid={Boolean(errors[`lines.${i}.cash_bank_layer_id`])}
                                  options={[
                                    { value: NEW_ITEM, label: "Layer baru", hint: "uang masuk, kurs diisi" },
                                    ...r.layers.map((x) => ({
                                      value: String(x.id),
                                      label: `${x.layerNo} · ${formatDate(x.date)}`,
                                      hint: `${formatMoney(x.foreignRemaining, r.currency!.label)} @ ${formatRate(x.rate)}`,
                                    })),
                                  ]}
                                  // A layer is drawn (Kredit); Layer baru receives (Debit).
                                  onChange={(v) =>
                                    setLine(l.key, v === NEW_ITEM ? { layer_id: v, credit: "" } : { layer_id: v, debit: "" })
                                  }
                                />
                              ) : (
                                dash()
                              )}
                              {effect && <span className="rsub">{effect}</span>}
                              {err(i, "cash_bank_layer_id")}
                            </td>
                            <td>
                              {r.item || r.cash ? (
                                <div className="ro">
                                  <span className="lab">{r.currency?.label}</span>
                                </div>
                              ) : (
                                <Select
                                  size="sm"
                                  value={l.currency_id ? String(l.currency_id) : ""}
                                  placeholder="Pilih…"
                                  ariaLabel="Currency baris"
                                  options={options.currencies.map((c) => ({ value: String(c.id), label: c.label }))}
                                  onChange={(v) => setLine(l.key, { currency_id: v ? Number(v) : null, exchange_rate: "" })}
                                />
                              )}
                              {err(i, "currency_id")}
                            </td>
                            <td className="num">
                              {!r.currency || r.currency.isBase ? (
                                dash(r.currency ? "mata uang dasar" : "—")
                              ) : fixedRate ? (
                                <span className="mny">{formatRate(r.rate)}</span>
                              ) : (
                                <RateInput
                                  size="sm"
                                  value={l.exchange_rate}
                                  ariaLabel={`Kurs ${r.currency.label} ke ${BASE_CURRENCY_LABEL}`}
                                  invalid={Boolean(errors[`lines.${i}.exchange_rate`])}
                                  onChange={(v) => setLine(l.key, { exchange_rate: v })}
                                />
                              )}
                              {err(i, "exchange_rate")}
                            </td>
                            {amountCell("debit")}
                            {amountCell("credit")}
                            <td className="num">
                              {(r.item || r.cash) && (
                                <>
                                  <MoneyInput
                                    size="sm"
                                    value={l.new_value}
                                    placeholder=""
                                    ariaLabel={`Saldo baru baris ${i + 1}`}
                                    currencyLabel={r.currency?.label}
                                    invalid={Boolean(errors[`lines.${i}.new_value`])}
                                    onChange={(v) => setLine(l.key, { new_value: v })}
                                  />
                                  {r.held != null && (
                                    <span className="rsub">
                                      kini <span className="mny">{formatMoney(r.held, r.currency?.label)}</span>
                                    </span>
                                  )}
                                </>
                              )}
                              {err(i, "new_value")}
                            </td>
                            <td>
                              <input
                                className="inp sm"
                                type="text"
                                autoComplete="off"
                                value={l.description}
                                placeholder="Opsional"
                                aria-label="Keterangan baris"
                                onChange={(e) => setLine(l.key, { description: e.target.value })}
                              />
                            </td>
                            <td className="acts">
                              <button
                                className="iact del"
                                aria-label="Hapus baris"
                                disabled={lines.length <= 2}
                                title={lines.length <= 2 ? "Jurnal memerlukan minimal dua baris" : "Hapus baris"}
                                onClick={() => {
                                  setLines((rows) => rows.filter((x) => x.key !== l.key));
                                  setDirty(true);
                                }}
                              >
                                <Icon name="trash" size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    : journal!.lines.map((l, i) => (
                        <tr key={l.id}>
                          <td className="no">{i + 1}</td>
                          <td className="pri">
                            <span className="idc">
                              <span className="lab">{l.accountLabel}</span>
                              <span className="nm">{l.accountName}</span>
                            </span>
                          </td>
                          <td>
                            {l.ledger === "cash_bank" ? (
                              <span className="lab">{l.subjectLabel}</span>
                            ) : (
                              <PartnerCell label={l.partnerLabel} name={l.partnerName} mismatch={null} />
                            )}
                            {l.ledger === "subject_book" && (
                              <span className="rsub">{l.subjectLabel ?? "Item baru"}</span>
                            )}
                            {l.layerNo && <span className="rsub">{l.layerNo}</span>}
                          </td>
                          <td className="mut">
                            {l.isGenerated ? "Selisih kurs" : l.description}
                            {l.foreign && (
                              <span className="rsub">{formatForeignFace(l.trxAmount, l.currencyLabel, l.rate)}</span>
                            )}
                          </td>
                          <td className="num">
                            <Amount value={l.debit} nil="dash" ledger />
                          </td>
                          <td className="num">
                            <Amount value={l.credit} nil="dash" ledger />
                          </td>
                          <td className="acts">
                            {l.ledger !== "none" && !l.isGenerated ? (
                              <button className="iact" title="Rincian" onClick={() => setDetail(l)}>
                                <Icon name="eye" size={14} />
                              </button>
                            ) : (
                              <span className="sp" />
                            )}
                          </td>
                        </tr>
                      ))}
                </tbody>
                <tfoot>
                  {editing && valued.selisih !== 0 && (
                    <tr className="totrow">
                      <td colSpan={6} style={{ textAlign: "right" }}>
                        Selisih Kurs
                      </td>
                      <td className="num">
                        {valued.selisih > 0 && (
                          <Amount value={valued.selisih} currency={BASE_CURRENCY_LABEL} />
                        )}
                      </td>
                      <td className="num">
                        {valued.selisih < 0 && (
                          <Amount value={-valued.selisih} currency={BASE_CURRENCY_LABEL} />
                        )}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  )}
                  {/* Balance is spoken about only when it breaks; a foreign
                      currency whose amounts differ is named, since its gap
                      cannot be read as Selisih Kurs. */}
                  {editing ? (
                    <tr className="totrow">
                      <td colSpan={6} style={{ textAlign: "right" }}>
                        Total
                        {difference !== 0 && (
                          <span className="overtag">
                            {valued.unbalancedCurrencies.length
                              ? `nominal ${valued.unbalancedCurrencies.join(", ")} tidak seimbang`
                              : `belum seimbang · selisih ${formatMoney(Math.abs(difference), BASE_CURRENCY_LABEL)}`}
                          </span>
                        )}
                      </td>
                      <td className="num">
                        <Amount value={totalDebit} currency={BASE_CURRENCY_LABEL} big />
                      </td>
                      <td className="num">
                        <Amount value={totalCredit} currency={BASE_CURRENCY_LABEL} big />
                      </td>
                      <td colSpan={3} />
                    </tr>
                  ) : (
                    <tr className="totrow">
                      <td colSpan={4} style={{ textAlign: "right" }}>
                        Total
                        {difference !== 0 && (
                          <span className="overtag">
                            tidak seimbang · selisih {formatMoney(Math.abs(difference), BASE_CURRENCY_LABEL)}
                          </span>
                        )}
                      </td>
                      <td className="num">
                        <Amount value={totalDebit} big ledger />
                      </td>
                      <td className="num">
                        <Amount value={totalCredit} big ledger />
                      </td>
                      <td />
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>

      {detail && <LineDetail line={detail} onClose={() => setDetail(null)} />}

      {confirm && journal && (
        <ConfirmDialog
          open
          icon={GENERAL_JOURNAL_TRANSITIONS[confirm].icon}
          tone={GENERAL_JOURNAL_TRANSITIONS[confirm].tone === "danger" ? "danger" : "ok"}
          title={GENERAL_JOURNAL_TRANSITIONS[confirm].title}
          subject={`${journal.journalNo} – ${formatMoney(journal.debit, BASE_CURRENCY_LABEL)}`}
          body={GENERAL_JOURNAL_TRANSITIONS[confirm].body}
          confirmLabel={GENERAL_JOURNAL_TRANSITIONS[confirm].confirmLabel}
          confirmTone={GENERAL_JOURNAL_TRANSITIONS[confirm].tone === "danger" ? "solid-danger" : "primary"}
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
            <JournalPreview load={() => previewGeneralJournalPost(journal.id)} onReady={setPostReady} />
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

/** A line's Rincian: what it did to its ledger, for checking it. */
function LineDetail({ line, onClose }: { line: GeneralJournalLineRow; onClose: () => void }) {
  const side: Side = line.debit > 0 ? "debit" : "credit";
  const effect = lineEffectText(line.ledger, side, line.raises);
  const face = (n: number | null) => (n == null ? "—" : formatMoney(n, line.currencyLabel));
  return (
    <Dialog
      open
      icon="clip"
      width={600}
      title={`Rincian ${line.accountLabel}`}
      subtitle={line.accountName}
      onClose={onClose}
      foot={
        <button className="btn primary" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <div className="apsum">
        <div>
          <span>Buku</span>
          <b>{LEDGER_TEXT[line.ledger as keyof typeof LEDGER_TEXT]}</b>
        </div>
        <div>
          <span>Efek</span>
          <b>{effect ?? (side === "debit" ? "Debit" : "Kredit")}</b>
        </div>
        <div>
          <span>{line.ledger === "cash_bank" ? "Cash & Bank" : "Open Item"}</span>
          <b>{line.subjectLabel ?? "Item baru"}</b>
        </div>
        <div>
          <span>Layer</span>
          <b>{line.layerNo ?? "—"}</b>
        </div>
        <div>
          <span>Nominal</span>
          <b className="mono">{face(line.trxAmount)}</b>
        </div>
        <div>
          <span>Kurs</span>
          <b className="mono">{line.foreign ? formatRate(line.rate) : "mata uang dasar"}</b>
        </div>
        <div>
          <span>Saldo Sebelum</span>
          <b className="mono">{face(line.balanceBefore)}</b>
        </div>
        <div>
          <span>Saldo Baru</span>
          <b className="mono">{face(line.newValue)}</b>
        </div>
      </div>
    </Dialog>
  );
}
