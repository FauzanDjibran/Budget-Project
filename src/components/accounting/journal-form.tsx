"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { RateInput } from "@/components/ui/rate-input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  createJournal,
  listJournalOptions,
  updateJournal,
  type JournalLineValues,
} from "@/app/actions/journal";
import { formatMoney } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import type { Company } from "@/lib/siba/company-access";
import type { JournalDetail } from "@/lib/siba/journal";
import {
  JOURNAL_STATUS_BADGE,
  type JournalStatus,
} from "@/lib/siba/journal-workflow";
import type { ManualJournalOptions } from "@/lib/siba/manual-journal";

export type JournalFormMode = "new" | "edit";

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

/**
 * The manual journal editor.
 *
 * What is **not** on this screen is as deliberate as what is. There is no date
 * field: a journal is dated the day it is posted, never back-dated, so the date
 * is the engine's to write. There is no status field: a journal is saved as a
 * draft and posted by a deliberate act. And the account picker offers only
 * accounts that are postable and are not control accounts — the two questions
 * the Server Action asks, asked here first so the user never composes an entry
 * that will be refused.
 *
 * Debit and kredit are typed in the **line's own currency**; the totals below
 * are base currency, because that is the only measure a journal balances in. A
 * foreign line therefore states its kurs and shows what it comes to in rupiah
 * beside the figure that was typed.
 *
 * The balance is shown, not enforced: a draft is allowed not to balance yet,
 * and Post is where the engine refuses one that still does not.
 */
export function JournalForm({
  mode,
  journal,
  companies,
  options: initialOptions,
  defaultCurrencyId,
}: {
  mode: JournalFormMode;
  /** The draft being edited; null on a new journal. */
  journal: JournalDetail | null;
  /** The Companies this reader may write for. */
  companies: Company[];
  /** Accounts, Partners and Currencies for the Company currently chosen. */
  options: ManualJournalOptions;
  defaultCurrencyId: number | null;
}) {
  const router = useRouter();
  const toast = useToast();

  // A new journal starts on the **first** Company this reader may write for,
  // which is the one the page already loaded the accounts of. Starting on
  // nothing would leave the Account pickers holding a chart the form does not
  // claim to be on, and "Tambah Baris" disabled until the Company was picked
  // again. The picker is still there; this is a starting point, not a lock.
  const [companyId, setCompanyId] = useState<number | null>(
    journal?.companyId ?? companies[0]?.id ?? null
  );
  const [description, setDescription] = useState(journal?.description ?? "");
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

  const totalDebit = lines.reduce((t, l) => t + baseOf(l, "debit"), 0);
  const totalCredit = lines.reduce((t, l) => t + baseOf(l, "credit"), 0);
  const difference = Math.round((totalDebit - totalCredit) * 100) / 100;
  const untouched = totalDebit === 0 && totalCredit === 0;
  const balanced = difference === 0 && !untouched;

  const status = (journal?.status ?? "Draft") as JournalStatus;

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

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Accounting</span>
          <span>/</span>
          <Link href="/accounting/journal">Journal</Link>
          <span>/</span>
          <span className="cur">{journal ? journal.journalNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="book" size={16} />
            </span>
            {journal ? (
              <>
                <span className="docno">{journal.journalNo}</span>
                <span className={`bdg ${JOURNAL_STATUS_BADGE[status]}`}>
                  {status}
                </span>
              </>
            ) : (
              "Journal Manual Baru"
            )}
            {mode === "edit" && <span className="bdg t-vio">Mode Ubah</span>}
          </h1>
          <div className="ph-act">
            {dirty && (
              <span className="ph-dirty">
                <span className="pulse" /> Belum disimpan
              </span>
            )}
            <Link className="btn" href={backHref}>
              <Icon name="back" size={15} /> Batal
            </Link>
            <button className="btn primary" onClick={onSave} disabled={saving}>
              <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
            </button>
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

      <div className="fgrid solo">
        <div>
      <div className="card">
        <div className="card-h">
          <span className="ci">
            <Icon name="book" size={15} />
          </span>
          <div className="ct">
            <h3>Journal Manual</h3>
            <p>
              Entri yang tidak berasal dari dokumen — penyusutan, akrual,
              reklasifikasi. Tanggal terisi saat diposting.
            </p>
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
                      {companies.find((c) => c.id === companyId)?.label ?? "—"}
                    </span>
                    <span>
                      {companies.find((c) => c.id === companyId)?.name ?? ""}
                    </span>
                  </div>
                )}
              </Field>

              <Field
                label="Keterangan"
                span={8}
                required
                help="alasan journal ini dibuat"
                error={errors.description}
              >
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
              </Field>
            </FormRow>
          </FormSection>
        </FormBody>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="layers" size={15} />
          </span>
          <div className="ct">
            <h3>Baris Journal</h3>
            <p>
              Debit dan kredit diisi dalam mata uang barisnya; total diukur
              dalam {BASE_CURRENCY_LABEL}.
            </p>
          </div>
          <button
            className="btn sm primary"
            disabled={!companyId}
            title={companyId ? undefined : "Pilih Company terlebih dahulu"}
            onClick={addLine}
          >
            <Icon name="plus" size={14} /> Tambah Baris
          </button>
        </div>

        <div className="tw">
          <table className="grid ltab">
            <thead>
              <tr>
                <th style={{ width: 34 }}>No</th>
                <th style={{ width: 190 }}>Account</th>
                <th style={{ width: 140 }}>Partner</th>
                <th>Keterangan</th>
                <th style={{ width: 110 }}>Currency</th>
                <th className="num" style={{ width: 120 }}>
                  Kurs
                </th>
                <th className="num" style={{ width: 150 }}>
                  Debit
                </th>
                <th className="num" style={{ width: 150 }}>
                  Kredit
                </th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
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
                const base =
                  baseOf(l, "debit") || baseOf(l, "credit") || 0;

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
                        // An account that names no Partner Category keeps no
                        // subject history, so a Partner on it would be a
                        // detail nothing reads back.
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
                            // A base-currency line is never asked for a kurs,
                            // so a rate left over from the previous choice must
                            // not survive it.
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
                        // A rate of 1 is the identity and is not a decision, so
                        // there is nothing to type (CLAUDE.md §10 rule 68).
                        <span className="dash">—</span>
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
              })}

            </tbody>
            <tfoot>
              <tr className="totrow">
                {/* An untouched form has no difference to state — saying
                    "selisih Rp 0" would report a fault where nothing has been
                    entered yet. The balance is spoken about only once there is
                    something to balance (§12, report convention). */}
                <td colSpan={6}>
                  {untouched
                    ? "Total"
                    : balanced
                      ? "Total — debit dan kredit seimbang"
                      : `Total — selisih ${formatMoney(
                          Math.abs(difference),
                          BASE_CURRENCY_LABEL
                        )}`}
                </td>
                <td className="num">
                  {formatMoney(totalDebit, BASE_CURRENCY_LABEL)}
                </td>
                <td className="num">
                  {formatMoney(totalCredit, BASE_CURRENCY_LABEL)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p className="foot-note">
        Draft belum masuk buku besar: General Ledger dan Trial Balance baru
        membacanya setelah diposting.
      </p>
        </div>
      </div>
    </>
  );
}
