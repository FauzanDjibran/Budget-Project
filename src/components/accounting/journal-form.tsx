"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { DocumentHeader } from "@/components/ui/document-header";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { RateInput } from "@/components/ui/rate-input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Drill } from "@/components/report/drill";
import {
  createJournal,
  listJournalOptions,
  updateJournal,
  type JournalLineValues,
} from "@/app/actions/journal";
import { formatDate, formatForeignFace, formatMoney, todayIso } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import type { Company } from "@/lib/siba/company-access";
import { documentHref } from "@/lib/siba/document-links";
import type { JournalDetail } from "@/lib/siba/journal";
import type { JournalAbilities, JournalStatus } from "@/lib/siba/journal-workflow";
import type { ManualJournalOptions } from "@/lib/siba/manual-journal";
import { reportHref } from "@/lib/siba/reports";
import { JournalActions } from "./journal-actions";

export type JournalFormMode = "new" | "view" | "edit";

/** One row of the editor, before it is a database row. */
type DraftLine = {
  /** Stable across re-orders, so React does not reuse a row's input state. */
  key: number;
  account_id: number | null;
  partner_id: number | null;
  currency_id: number | null;
  exchange_rate: string;
  debit: string;
  credit: string;
  description: string;
};

let nextKey = 1;
const blankLine = (currencyId: number | null): DraftLine => ({
  key: nextKey++,
  account_id: null,
  partner_id: null,
  currency_id: currencyId,
  exchange_rate: "",
  debit: "",
  credit: "",
  description: "",
});

const EMPTY_OPTIONS: ManualJournalOptions = { accounts: [], partners: [], currencies: [] };

/**
 * One journal — read, created and edited on the same two cards.
 *
 * View, new and edit are one component, as every other document is, so the
 * screen a reader opens and the screen they then edit are the same shape: the
 * header card (Company, date, description, and on an automatic journal the
 * document that produced it) and the lines card. It used to be two components
 * with two layouts, and the view had lost its card headings in the split.
 *
 * Only a manual journal is ever editable, and only while Draft: one a document
 * produced is `Posted` the moment it exists (§10 rule 81). The account picker
 * offers only accounts that are postable and are not control accounts — the
 * two questions the Server Action asks, asked here first so nobody composes an
 * entry that will be refused.
 *
 * Debit and kredit are typed in the **line's own currency**; the totals are
 * base currency, because that is the only measure a journal balances in. The
 * balance is shown, not enforced, while it is a draft: Post is where the engine
 * refuses one that still does not balance. It is spoken about only when it is
 * broken.
 */
export function JournalForm({
  mode,
  journal,
  companies = [],
  options: initialOptions = EMPTY_OPTIONS,
  defaultCurrencyId = null,
  can,
}: {
  mode: JournalFormMode;
  /** The journal shown or edited; null on a new one. */
  journal: JournalDetail | null;
  /** The Companies this reader may write for — new and edit only. */
  companies?: Company[];
  /** Accounts, Partners and Currencies for the Company currently chosen. */
  options?: ManualJournalOptions;
  defaultCurrencyId?: number | null;
  /** What the reader may do — view only, for the header's lifecycle buttons. */
  can?: JournalAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";

  // A new journal starts on the **first** Company this reader may write for,
  // which is the one the page already loaded the accounts of. Starting on
  // nothing would leave the Account pickers holding a chart the form does not
  // claim to be on, and "Tambah Baris" disabled until the Company was picked
  // again. The picker is still there; this is a starting point, not a lock.
  const [companyId, setCompanyId] = useState<number | null>(
    journal?.companyId ?? companies[0]?.id ?? null
  );
  const [description, setDescription] = useState(journal?.description ?? "");
  // The day it belongs to in the books, starting on today (§10 rule 33). A
  // draft saved before drafts carried a date starts on today too.
  const [journalDate, setJournalDate] = useState(
    journal?.postingDate ? journal.postingDate.slice(0, 10) : todayIso()
  );
  const [options, setOptions] = useState(initialOptions);
  const [lines, setLines] = useState<DraftLine[]>(() =>
    journal
      ? journal.lines.map((l) => ({
          key: nextKey++,
          account_id: l.accountId,
          partner_id: l.partnerId,
          currency_id: l.currencyId,
          exchange_rate: l.foreign ? String(l.rate) : "",
          debit: l.debit > 0 ? String(l.trxAmount) : "",
          credit: l.credit > 0 ? String(l.trxAmount) : "",
          description: l.description,
        }))
      : [blankLine(defaultCurrencyId), blankLine(defaultCurrencyId)]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // The options belong to a Company's chart, so changing the Company changes
  // which accounts exist at all. Lines that named an account from the previous
  // chart are cleared rather than carried across — an account number means a
  // different account in the other Company (CLAUDE.md §10 rule 8).
  const loadedFor = useRef(companyId);
  useEffect(() => {
    // The options the page handed over already belong to the Company the form
    // starts on, so the first render asks for nothing. Only a *change* of
    // Company needs a new chart.
    if (mode !== "new" || !companyId || loadedFor.current === companyId) return;
    loadedFor.current = companyId;
    let cancelled = false;
    void listJournalOptions(companyId).then((result) => {
      if (cancelled || !result.ok) return;
      setOptions(result.options);
      setLines((rows) =>
        rows.map((r) => ({ ...r, account_id: null, partner_id: null }))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, mode]);

  const accountById = useMemo(
    () => new Map(options.accounts.map((a) => [a.id, a])),
    [options.accounts]
  );
  const currencyById = useMemo(
    () => new Map(options.currencies.map((c) => [c.id, c])),
    [options.currencies]
  );

  /** What one line comes to in base currency, which is what it is totalled in. */
  const baseOf = (line: DraftLine, side: "debit" | "credit"): number => {
    const raw = Number(line[side] || 0);
    if (!raw) return 0;
    const currency = line.currency_id ? currencyById.get(line.currency_id) : null;
    const rate = currency?.isBase ? 1 : Number(line.exchange_rate || 0);
    return rate > 0 ? Math.round(raw * rate * 100) / 100 : 0;
  };

  const totalDebit = editing
    ? lines.reduce((t, l) => t + baseOf(l, "debit"), 0)
    : journal!.debit;
  const totalCredit = editing
    ? lines.reduce((t, l) => t + baseOf(l, "credit"), 0)
    : journal!.credit;
  const difference = Math.round((totalDebit - totalCredit) * 100) / 100;
  const untouched = totalDebit === 0 && totalCredit === 0;

  const status = (journal?.status ?? "Draft") as JournalStatus;
  const isManual = journal?.isManual ?? true;

  const setLine = (key: number, patch: Partial<DraftLine>) => {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const addLine = () => {
    setLines((rows) => [...rows, blankLine(defaultCurrencyId)]);
    setDirty(true);
  };

  const removeLine = (key: number) => {
    setLines((rows) => rows.filter((r) => r.key !== key));
    setDirty(true);
  };

  const submitted = (): JournalLineValues[] =>
    lines.map((l) => ({
      account_id: l.account_id ? String(l.account_id) : "",
      partner_id: l.partner_id ? String(l.partner_id) : "",
      currency_id: l.currency_id ? String(l.currency_id) : "",
      exchange_rate: l.exchange_rate,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
    }));

  async function onSave() {
    setSaving(true);
    setErrors({});
    const header = {
      company_id: companyId ? String(companyId) : "",
      journal_date: journalDate,
      description,
    };
    const result =
      mode === "new"
        ? await createJournal(header, submitted())
        : await updateJournal(journal!.id, header, submitted());
    setSaving(false);

    if (!result.ok) {
      setErrors(result.errors);
      toast(
        "Journal belum tersimpan",
        result.errors._form ?? "Periksa kembali isian pada baris journal.",
        "err"
      );
      return;
    }

    setDirty(false);
    toast("Journal disimpan", `${result.journalNo} · Draft`, "ok");
    router.push(`/accounting/journal/${result.id}`);
    router.refresh();
  }

  const backHref = journal
    ? `/accounting/journal/${journal.id}`
    : "/accounting/journal";

  // What the imbalance reads as, when there is one. An untouched form has none
  // to state; a draft is allowed one; a posted journal with one is a fault.
  const imbalance =
    untouched || difference === 0
      ? null
      : status === "Posted"
        ? `tidak seimbang · selisih ${formatMoney(Math.abs(difference), BASE_CURRENCY_LABEL)}`
        : `belum seimbang · selisih ${formatMoney(Math.abs(difference), BASE_CURRENCY_LABEL)}`;

  const source = journal ? documentHref(journal.sourceDocTable, journal.sourceDocId) : null;
  const viewDate = journal?.postingDate ? journal.postingDate.slice(0, 10) : null;

  return (
    <>
      <DocumentHeader
        module="Accounting"
        list={{ label: "Journal", href: "/accounting/journal" }}
        icon="book"
        number={journal?.journalNo ?? null}
        placeholder="Journal Manual Baru"
        status={journal?.status ?? null}
        tags={journal?.isManual && <span className="bdg t-vio">Manual</span>}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {mode === "view" && journal ? (
          <JournalActions
            id={journal.id}
            subject={journal.journalNo}
            status={status}
            isManual={journal.isManual}
            can={can!}
          />
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
                <h3>{isManual ? "Journal Manual" : "Journal"}</h3>
                <p>
                  {isManual
                    ? "Entri yang tidak berasal dari dokumen — penyusutan, akrual, reklasifikasi."
                    : "Dibuat otomatis saat dokumen sumbernya diposting."}
                </p>
              </div>
            </div>
            <FormBody>
              <FormSection>
                <FormRow>
                  <Field
                    label="Company"
                    span={isManual ? 4 : 3}
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
                        options={companies.map((c) => ({
                          value: String(c.id),
                          label: `${c.label} - ${c.name}`,
                        }))}
                        onChange={(v) => {
                          setCompanyId(v ? Number(v) : null);
                          setDirty(true);
                        }}
                      />
                    ) : (
                      <div className="ro">
                        <span className="lab">
                          {journal?.companyLabel ??
                            companies.find((c) => c.id === companyId)?.label ??
                            "—"}
                        </span>
                        <span>
                          {journal?.companyName ??
                            companies.find((c) => c.id === companyId)?.name ??
                            ""}
                        </span>
                      </div>
                    )}
                  </Field>

                  <Field
                    label="Tanggal"
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
                      <div className="ro">
                        {viewDate ? (
                          formatDate(viewDate)
                        ) : (
                          // Only a draft saved before drafts carried a date has none.
                          <span className="dash">belum ditentukan</span>
                        )}
                      </div>
                    )}
                  </Field>

                  {!isManual && (
                    <Field label="Sumber" span={6}>
                      <div className="ro">
                        {source ? (
                          <Drill href={source} title="Buka dokumen sumber journal ini">
                            {journal!.sourceDocLabel}
                          </Drill>
                        ) : (
                          journal!.sourceDocLabel ?? <span className="dash">—</span>
                        )}
                      </div>
                    </Field>
                  )}

                  <Field
                    label="Keterangan"
                    span={isManual ? 5 : 12}
                    required={editing}
                    help={editing ? "alasan journal ini dibuat" : undefined}
                    error={errors.description}
                  >
                    {editing ? (
                      <input
                        className={`inp${errors.description ? " bad" : ""}`}
                        type="text"
                        autoComplete="off"
                        value={description}
                        placeholder="Penyusutan peralatan kantor bulan ini"
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
              </FormSection>
            </FormBody>

            <p className="fnote">
              {editing || status === "Draft"
                ? "Draft belum masuk buku besar: General Ledger dan Trial Balance baru membacanya setelah diposting."
                : status === "Cancelled"
                  ? "Journal dibatalkan sebelum diposting, sehingga tidak pernah masuk buku besar."
                  : isManual
                    ? "Journal sudah masuk buku besar dan bersifat final: koreksi dilakukan dengan journal baru."
                    : "Journal ini bersifat final: koreksi dilakukan dengan dokumen baru, yang membentuk journal-nya sendiri."}
            </p>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="layers" size={15} />
              </span>
              <div className="ct">
                <h3>Baris Journal</h3>
                <p>
                  {editing
                    ? `Debit dan kredit diisi dalam mata uang barisnya; total diukur dalam ${BASE_CURRENCY_LABEL}.`
                    : `Debit dan kredit dalam ${BASE_CURRENCY_LABEL}; baris mata uang asing menyebut nilai asal dan kursnya.`}
                </p>
              </div>
              {editing ? (
                <button
                  className="btn sm primary"
                  disabled={!companyId}
                  title={companyId ? undefined : "Pilih Company dulu…"}
                  onClick={addLine}
                >
                  <Icon name="plus" size={14} /> Tambah Baris
                </button>
              ) : (
                <span className="hint">{journal!.lineCount} baris</span>
              )}
            </div>

            <div className="tw">
              <table className="grid ltab">
                <thead>
                  {editing ? (
                    <tr>
                      <th style={{ width: 34 }}>No</th>
                      <th style={{ width: 260 }}>Account</th>
                      <th style={{ width: 180 }}>Partner</th>
                      <th>Keterangan</th>
                      <th style={{ width: 100 }}>Currency</th>
                      <th className="num" style={{ width: 120 }}>
                        Kurs
                      </th>
                      <th className="num" style={{ width: 140 }}>
                        Debit
                      </th>
                      <th className="num" style={{ width: 140 }}>
                        Kredit
                      </th>
                      <th style={{ width: 44 }} />
                    </tr>
                  ) : (
                    <tr>
                      <th style={{ width: 34 }}>No</th>
                      <th style={{ width: 300 }}>Account</th>
                      <th style={{ width: 220 }}>Partner</th>
                      <th>Keterangan</th>
                      <th className="num" style={{ width: 150 }}>
                        Debit
                      </th>
                      <th className="num" style={{ width: 150 }}>
                        Kredit
                      </th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {editing
                    ? lines.map((l, i) => {
                        const account = l.account_id ? accountById.get(l.account_id) : null;
                        const currency = l.currency_id
                          ? currencyById.get(l.currency_id)
                          : null;
                        const foreign = Boolean(currency) && !currency!.isBase;
                        const partners = account?.partnerCategoryId
                          ? options.partners.filter(
                              (p) => p.categoryId === account.partnerCategoryId
                            )
                          : options.partners;
                        const base = baseOf(l, "debit") || baseOf(l, "credit") || 0;

                        return (
                          <tr key={l.key}>
                            <td className="no">{i + 1}</td>
                            <td>
                              <Combobox
                                value={l.account_id}
                                placeholder="Pilih Account…"
                                size="sm"
                                invalid={Boolean(errors[`lines.${i}.account_id`])}
                                options={options.accounts.map((a) => ({
                                  id: a.id,
                                  label: a.label,
                                  name: a.name,
                                  active: true,
                                }))}
                                onChange={(v) =>
                                  setLine(l.key, { account_id: v, partner_id: null })
                                }
                              />
                              {errors[`lines.${i}.account_id`] && (
                                <div className="err">
                                  <Icon name="warn" size={11} />
                                  {errors[`lines.${i}.account_id`]}
                                </div>
                              )}
                            </td>
                            <td>
                              {account?.requirePartner ? (
                                <>
                                  <Combobox
                                    value={l.partner_id}
                                    placeholder="Pilih Partner…"
                                    size="sm"
                                    invalid={Boolean(errors[`lines.${i}.partner_id`])}
                                    options={partners.map((p) => ({
                                      id: p.id,
                                      label: p.label,
                                      name: p.name,
                                      active: true,
                                    }))}
                                    onChange={(v) => setLine(l.key, { partner_id: v })}
                                  />
                                  {errors[`lines.${i}.partner_id`] && (
                                    <div className="err">
                                      <Icon name="warn" size={11} />
                                      {errors[`lines.${i}.partner_id`]}
                                    </div>
                                  )}
                                </>
                              ) : (
                                // An account that names no Partner Category keeps
                                // no subject history, so a Partner on it would be
                                // a detail nothing reads back.
                                <span className="dash">—</span>
                              )}
                            </td>
                            <td>
                              <input
                                className="inp sm"
                                type="text"
                                autoComplete="off"
                                value={l.description}
                                placeholder="Opsional"
                                aria-label="Keterangan baris"
                                onChange={(e) =>
                                  setLine(l.key, { description: e.target.value })
                                }
                              />
                            </td>
                            <td>
                              <Select
                                size="sm"
                                value={l.currency_id ? String(l.currency_id) : ""}
                                invalid={Boolean(errors[`lines.${i}.currency_id`])}
                                placeholder="Pilih…"
                                ariaLabel="Currency baris"
                                options={options.currencies.map((c) => ({
                                  value: String(c.id),
                                  label: c.label,
                                }))}
                                onChange={(v) =>
                                  setLine(l.key, {
                                    currency_id: v ? Number(v) : null,
                                    // A base-currency line is never asked for a
                                    // kurs, so a rate left over from the previous
                                    // choice must not survive it.
                                    exchange_rate: "",
                                  })
                                }
                              />
                            </td>
                            <td className="num">
                              {foreign ? (
                                <>
                                  <RateInput
                                    size="sm"
                                    value={l.exchange_rate}
                                    ariaLabel={`Kurs ${currency!.label} ke ${BASE_CURRENCY_LABEL}`}
                                    invalid={Boolean(errors[`lines.${i}.exchange_rate`])}
                                    onChange={(v) => setLine(l.key, { exchange_rate: v })}
                                  />
                                  {base > 0 && (
                                    <span className="rsub">
                                      {formatMoney(base, BASE_CURRENCY_LABEL)}
                                    </span>
                                  )}
                                </>
                              ) : (
                                // A rate of 1 is the identity and is not a
                                // decision, so there is nothing to type
                                // (CLAUDE.md §10 rule 68).
                                <span className="dash">mata uang dasar</span>
                              )}
                            </td>
                            <td className="num">
                              <MoneyInput
                                size="sm"
                                value={l.debit}
                                ariaLabel="Debit"
                                invalid={Boolean(errors[`lines.${i}.amount`])}
                                onChange={(v) =>
                                  setLine(l.key, { debit: v, credit: v ? "" : l.credit })
                                }
                              />
                            </td>
                            <td className="num">
                              <MoneyInput
                                size="sm"
                                value={l.credit}
                                ariaLabel="Kredit"
                                invalid={Boolean(errors[`lines.${i}.amount`])}
                                onChange={(v) =>
                                  setLine(l.key, { credit: v, debit: v ? "" : l.debit })
                                }
                              />
                              {errors[`lines.${i}.amount`] && (
                                <div className="err">
                                  <Icon name="warn" size={11} />
                                  {errors[`lines.${i}.amount`]}
                                </div>
                              )}
                            </td>
                            <td className="acts">
                              <button
                                className="iact del"
                                aria-label="Hapus baris"
                                disabled={lines.length <= 2}
                                title={
                                  lines.length <= 2
                                    ? "Journal memerlukan minimal dua baris"
                                    : "Hapus baris"
                                }
                                onClick={() => removeLine(l.key)}
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
                              {/* The account's own General Ledger, for the day
                                  this journal belongs to. */}
                              <Link
                                className="lab"
                                href={reportHref("general-ledger", {
                                  company: journal!.companyId,
                                  accounts: l.accountId,
                                  from: viewDate,
                                  to: viewDate,
                                })}
                                title="Buka General Ledger account ini"
                              >
                                {l.accountLabel}
                              </Link>
                              <span className="nm">{l.accountName}</span>
                            </span>
                          </td>
                          <td>
                            {l.partnerLabel ? (
                              <span className="idc">
                                <span className="lab">{l.partnerLabel}</span>
                                <span className="nm">{l.partnerName}</span>
                              </span>
                            ) : (
                              <span className="dash">—</span>
                            )}
                          </td>
                          <td className="mut">
                            {l.description || <span className="dash">—</span>}
                            {/* A line in another currency says what it was and
                                at what kurs, beside the rupiah figure it became.
                                A base-currency line would only state itself twice. */}
                            {l.foreign && (
                              <span className="rsub">
                                {formatForeignFace(l.trxAmount, l.currencyLabel, l.rate)}
                              </span>
                            )}
                          </td>
                          <td className="num">
                            <Amount value={l.debit} nil="dash" />
                          </td>
                          <td className="num">
                            <Amount value={l.credit} nil="dash" />
                          </td>
                        </tr>
                      ))}
                </tbody>
                <tfoot>
                  <tr className="totrow">
                    {/* Balance is stated only when it breaks (§12, report
                        rule 10): equal totals are visible in the two columns. */}
                    <td colSpan={editing ? 6 : 4} style={{ textAlign: "right" }}>
                      Total
                      {imbalance && <span className="overtag">{imbalance}</span>}
                    </td>
                    <td className="num">
                      <Amount value={totalDebit} big />
                    </td>
                    <td className="num">
                      <Amount value={totalCredit} big />
                    </td>
                    {editing && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
