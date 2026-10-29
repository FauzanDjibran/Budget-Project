"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { KursSelect } from "@/components/finance/kurs-select";
import { OpenItemSelect } from "@/components/finance/open-item-select";
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

/**
 * What a line is written against, chosen first (D22), as Business Central's
 * Account Type: a subject book, a Cash & Bank, or a plain account.
 */
type Kind = "book" | "cash" | "gl";
const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: "book", label: "Buku Subjek" },
  { value: "cash", label: "Kas & Bank" },
  { value: "gl", label: "Account" },
];
const kindOfLedger = (ledger: string): Kind =>
  ledger === "partner" ? "book" : ledger === "cash_bank" ? "cash" : "gl";

/** One row of the editor, before it is a database row. */
type DraftLine = {
  key: number;
  kind: Kind | "";
  /** Account only; a book's or a Cash & Bank's account is found, never chosen. */
  account_id: number | null;
  book_id: number | null;
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
  description: string;
};

let nextKey = 1;
const blankLine = (): DraftLine => ({
  key: nextKey++,
  kind: "",
  account_id: null,
  book_id: null,
  partner_id: null,
  subject: "",
  layer_id: "",
  currency_id: null,
  exchange_rate: "",
  debit: "",
  credit: "",
  description: "",
});

/** A new open item (Baru), or a new layer, as a picker value. */
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
 * A line is filled Jenis → Akun → Partner → Entri → Currency → Kurs → Debit
 * or Kredit (D22): what the line is written against comes first and its
 * account follows, and the column the amount is typed in is the line's side,
 * which against the ledger's direction says whether it raises or lowers
 * (D19). Choosing an existing entry and opening a new one are two controls:
 * the open-item or layer dialog, and a **Baru** checkbox beside it (D20, D23),
 * so no line opens an item or a layer by omission. An entry that can only
 * move one way — a new item, a layer drawn, a new layer — opens only that
 * column.
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
            kind: kindOfLedger(l.ledger),
            account_id: l.accountId,
            book_id: l.bookId,
            partner_id: l.partnerId,
            subject: l.subjectId ? String(l.subjectId) : l.ledger === "partner" ? NEW_ITEM : "",
            layer_id: l.layerId
              ? String(l.layerId)
              : l.ledger === "cash_bank" && l.foreign && l.debit > 0
                ? NEW_ITEM
                : "",
            currency_id: l.currencyId,
            exchange_rate: l.foreign ? String(l.rate) : "",
            debit: l.debit > 0 ? String(l.trxAmount) : "",
            credit: l.credit > 0 ? String(l.trxAmount) : "",
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
      partner: new Map(options.partners.map((p) => [p.id, p])),
      book: new Map(options.books.map((b) => [b.id, b])),
      item: new Map(options.items.map((i) => [String(i.id), i])),
      cash: new Map(options.cashBanks.map((c) => [String(c.id), c])),
      currency: new Map(options.currencies.map((c) => [c.id, c])),
    }),
    [options]
  );

  /** The one account keeping a book for a Partner Category (D21). */
  const bookAccount = (bookId: number | null, categoryId: number | undefined) =>
    options.accounts.find(
      (a) => a.ledger === "partner" && bookId != null && a.bookIds.includes(bookId) && a.partnerCategoryId === categoryId
    ) ?? null;

  /** What one draft line resolves to, as the adapters resolve it. */
  const resolve = (l: DraftLine) => {
    const ledger = l.kind === "book" ? "partner" : l.kind === "cash" ? "cash_bank" : "none";
    const book = l.kind === "book" && l.book_id ? by.book.get(l.book_id) ?? null : null;
    const cash = l.kind === "cash" ? by.cash.get(l.subject) ?? null : null;
    // A book's account follows from the Partner's category, a Cash & Bank's
    // from its master; only a plain account is chosen (D22).
    const account =
      l.kind === "gl"
        ? (l.account_id && by.account.get(l.account_id)) || null
        : l.kind === "cash"
          ? (cash && by.account.get(cash.accountId)) || null
          : book
            ? bookAccount(book.id, by.partner.get(l.partner_id ?? 0)?.categoryId)
            : null;
    const item = l.kind === "book" ? by.item.get(l.subject) ?? null : null;
    const isNew = l.kind === "book" && l.subject === NEW_ITEM;
    const currencyId = item?.currencyId ?? cash?.currencyId ?? l.currency_id;
    const currency = currencyId ? by.currency.get(currencyId) ?? null : null;

    const raise: Side = ledger === "cash_bank" ? "debit" : raiseOf(book);
    // An entry that can move only one way opens only that column.
    // A foreign Cash & Bank draws a layer (Kredit) unless Baru opens one (Debit).
    const only: Side | null =
      isNew && book
        ? raise
        : ledger === "cash_bank" && currency && !currency.isBase
          ? l.layer_id === NEW_ITEM
            ? "debit"
            : "credit"
          : null;

    const side: Side | "" = Number(l.debit) > 0 ? "debit" : Number(l.credit) > 0 ? "credit" : "";
    const face = side ? Number(l[side]) : 0;

    const layers = cash ? options.layers[cash.id] ?? [] : [];
    const layer = layers.find((x) => String(x.id) === l.layer_id) ?? null;
    // An entry's kurs is the line's from the moment it is chosen.
    const rate = item?.rate ?? layer?.rate ?? (currency?.isBase ? 1 : Number(l.exchange_rate || 0));
    let base: number | undefined;
    if (item && side) {
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
      base = drawLayer(
        { foreign: layer.foreignRemaining, base: layer.baseRemaining, rate: layer.rate },
        cents(face) === cents(layer.foreignRemaining) ? layer.foreignRemaining : face
      ).base;
    }
    return { account, ledger, book, item, isNew, cash, currency, layers, layer, side, face, rate, base, only };
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
        account_id: r.account ? String(r.account.id) : "",
        side: r.side,
        partner_id: l.kind === "book" && l.partner_id ? String(l.partner_id) : "",
        subject_id: l.kind === "cash" || r.item ? l.subject : "",
        // Naming the book without an item is what makes a new item (D20).
        budget_category_id: r.book && (r.item || r.isNew) ? String(r.book.id) : "",
        cash_bank_layer_id: l.layer_id === NEW_ITEM ? "" : l.layer_id,
        currency_id: r.currency ? String(r.currency.id) : "",
        exchange_rate: l.exchange_rate,
        amount: r.side ? l[r.side] : "",
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
              <table className="grid ltab" style={{ minWidth: editing ? 1430 : 1060 }}>
                <thead>
                  {editing ? (
                    <tr>
                      <th style={{ width: 34 }}>No</th>
                      <th style={{ width: 130 }}>Jenis</th>
                      <th style={{ width: 210 }}>Akun</th>
                      <th style={{ width: 170 }}>Partner</th>
                      <th style={{ width: 200 }}>Entri</th>
                      <th style={{ width: 84 }}>Currency</th>
                      <th className="num" style={{ width: 120 }}>Kurs</th>
                      <th className="num" style={{ width: 150 }}>Debit</th>
                      <th className="num" style={{ width: 150 }}>Kredit</th>
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
                        const foreignCash = ledger === "cash_bank" && r.currency && !r.currency.isBase;
                        // A book offers the Partners whose category has an account keeping it.
                        const partners = options.partners.filter((p) => bookAccount(l.book_id, p.categoryId));
                        const effect = r.side ? lineEffectText(ledger, r.side, r.book?.raises ?? null) : null;
                        /** Baru: a new item only raises, so a lowering amount typed before it goes. */
                        const toggleNew = () =>
                          setLine(
                            l.key,
                            r.isNew
                              ? { subject: "" }
                              : { subject: NEW_ITEM, ...(r.book && { [other(raiseOf(r.book))]: "" }) }
                          );
                        /** A new Jenis or a new Akun starts the line again, keeping its keterangan. */
                        const restart = (patch: Partial<DraftLine>) =>
                          setLine(l.key, { ...blankLine(), key: l.key, kind: l.kind, description: l.description, ...patch });
                        const fixedRate = Boolean(r.item) || Boolean(r.layer);
                        // A kurs is typed only for something new; an entry brings its own.
                        const typedRate = l.kind === "gl" || r.isNew || l.layer_id === NEW_ITEM;
                        /** One side's amount: typed, or closed to this entry. */
                        const amountCell = (side: Side) => (
                          <td className="num">
                            {r.only && r.only !== side ? (
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
                              <Select
                                size="sm"
                                value={l.kind}
                                placeholder="Pilih Jenis…"
                                ariaLabel={`Jenis baris ${i + 1}`}
                                options={KIND_OPTIONS}
                                onChange={(v) => restart({ kind: v as Kind })}
                              />
                            </td>
                            <td>
                              {l.kind === "book" ? (
                                <Select
                                  size="sm"
                                  value={l.book_id ? String(l.book_id) : ""}
                                  placeholder="Pilih Buku…"
                                  ariaLabel={`Buku subjek baris ${i + 1}`}
                                  options={options.books
                                    .filter((b) => options.accounts.some((a) => a.ledger === "partner" && a.bookIds.includes(b.id)))
                                    .map((b) => ({ value: String(b.id), label: b.name }))}
                                  onChange={(v) => restart({ book_id: v ? Number(v) : null })}
                                />
                              ) : l.kind === "cash" ? (
                                <Select
                                  size="sm"
                                  value={l.subject}
                                  placeholder="Pilih Cash & Bank…"
                                  ariaLabel={`Cash & Bank baris ${i + 1}`}
                                  invalid={Boolean(errors[`lines.${i}.subject_id`])}
                                  options={options.cashBanks.map((c) => ({ value: String(c.id), label: `${c.label} – ${c.name}` }))}
                                  onChange={(v) => restart({ subject: v })}
                                />
                              ) : (
                                <Combobox
                                  value={l.account_id}
                                  placeholder="Pilih Account…"
                                  size="sm"
                                  waitingFor={l.kind ? null : "Pilih Jenis dulu…"}
                                  invalid={Boolean(errors[`lines.${i}.account_id`])}
                                  // A book's or a Cash & Bank's account is reached through its own Jenis.
                                  options={options.accounts
                                    .filter((a) => a.ledger === "none")
                                    .map((a) => ({ id: a.id, label: a.label, name: a.name, active: true }))}
                                  onChange={(v) => restart({ account_id: v })}
                                />
                              )}
                              {l.kind !== "gl" && r.account && (
                                <span className="rsub">
                                  {r.account.label} {r.account.name}
                                </span>
                              )}
                              {err(i, "account_id")}
                              {l.kind === "cash" && err(i, "subject_id")}
                            </td>
                            <td>
                              {l.kind === "book" ? (
                                <Combobox
                                  value={l.partner_id}
                                  placeholder="Pilih Partner…"
                                  size="sm"
                                  waitingFor={l.book_id ? null : "Pilih Buku dulu…"}
                                  invalid={Boolean(errors[`lines.${i}.partner_id`])}
                                  options={partners.map((p) => ({ id: p.id, label: p.label, name: p.name, active: true }))}
                                  onChange={(v) => setLine(l.key, { partner_id: v, subject: "" })}
                                />
                              ) : (
                                dash()
                              )}
                              {err(i, "partner_id")}
                            </td>
                            <td>
                              {l.kind === "book" ? (
                                // Choosing an item and opening a new one are two controls (D20).
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                  <label className={`chk sm${l.partner_id ? "" : " dis"}`} title="Buka item baru">
                                    <input
                                      type="checkbox"
                                      aria-label={`Item baru baris ${i + 1}`}
                                      disabled={!l.partner_id}
                                      checked={r.isNew}
                                      onChange={toggleNew}
                                    />
                                    <span className="ct">Baru</span>
                                  </label>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    {r.isNew ? (
                                      dash("item baru")
                                    ) : (
                                      <OpenItemSelect
                                        single
                                        value={r.item ? [{ item_id: r.item.id, amount: 0 }] : []}
                                        items={options.items
                                          .filter((it) => it.bookId === l.book_id && it.partnerId === l.partner_id)
                                          .map((it) => ({ ...it, currencyLabel: by.currency.get(it.currencyId)?.label }))}
                                        currencyLabel={BASE_CURRENCY_LABEL}
                                        direction="In"
                                        cashRate={null}
                                        waitingFor={l.partner_id ? null : "Pilih Partner dulu…"}
                                        invalid={Boolean(errors[`lines.${i}.subject_id`])}
                                        onChange={(v) => setLine(l.key, { subject: v[0] ? String(v[0].item_id) : "" })}
                                      />
                                    )}
                                  </div>
                                </div>
                              ) : foreignCash ? (
                                // As an open item: drawing a layer and opening one are two controls.
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                  <label className="chk sm" title="Uang masuk membuka layer baru">
                                    <input
                                      type="checkbox"
                                      aria-label={`Layer baru baris ${i + 1}`}
                                      checked={l.layer_id === NEW_ITEM}
                                      onChange={() =>
                                        setLine(
                                          l.key,
                                          l.layer_id === NEW_ITEM
                                            ? { layer_id: "", debit: "" }
                                            : { layer_id: NEW_ITEM, credit: "", exchange_rate: "" }
                                        )
                                      }
                                    />
                                    <span className="ct">Baru</span>
                                  </label>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    {l.layer_id === NEW_ITEM ? (
                                      dash("layer baru")
                                    ) : (
                                      <KursSelect
                                        size="sm"
                                        value={r.layer?.id ?? null}
                                        layers={r.layers}
                                        currencyLabel={r.currency!.label}
                                        asOf={journalDate}
                                        invalid={Boolean(errors[`lines.${i}.cash_bank_layer_id`])}
                                        onChange={(v) => setLine(l.key, { layer_id: v ? String(v) : "" })}
                                      />
                                    )}
                                  </div>
                                </div>
                              ) : (
                                dash()
                              )}
                              {effect && <span className="rsub">{effect}</span>}
                              {l.kind === "book" && err(i, "subject_id")}
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
                              ) : !typedRate ? (
                                dash()
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
                            {l.ledger === "partner" && (
                              <span className="rsub">
                                {l.subjectLabel ?? "Item baru"}
                                {l.bookName && ` · ${l.bookName}`}
                              </span>
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
                      <td colSpan={7} style={{ textAlign: "right" }}>
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
                      <td colSpan={2} />
                    </tr>
                  )}
                  {/* Balance is spoken about only when it breaks; a foreign
                      currency whose amounts differ is named, since its gap
                      cannot be read as Selisih Kurs. */}
                  {editing ? (
                    <tr className="totrow">
                      <td colSpan={7} style={{ textAlign: "right" }}>
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
                      <td colSpan={2} />
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
  const raises = (side === "credit") === (line.raises === "In");
  const after =
    line.balanceBefore == null ? null : line.balanceBefore + (raises ? line.trxAmount : -line.trxAmount);
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
          <b>{line.bookName ?? LEDGER_TEXT[line.ledger as keyof typeof LEDGER_TEXT]}</b>
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
          <span>Saldo Sesudah</span>
          <b className="mono">{face(after)}</b>
        </div>
      </div>
    </Dialog>
  );
}
