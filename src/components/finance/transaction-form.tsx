"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { DocumentHeader } from "@/components/ui/document-header";
import { CancelButton } from "@/components/ui/cancel-button";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { MoneyInput } from "@/components/ui/money-input";
import { RateInput } from "@/components/ui/rate-input";
import { KursSelect } from "./kurs-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import {
  createTransaction,
  listEligibleBudgets,
  transitionTransaction,
  updateTransaction,
  type TransactionValues,
} from "@/app/actions/finance";
import { requestFunding, withdrawFunding } from "@/app/actions/funding";
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatRate,
  todayIso,
} from "@/lib/format";
import { BASE_CURRENCY_LABEL, rateSource } from "@/lib/siba/currency";
import { STATUS_TEXT } from "@/lib/siba/entities";
import type { BudgetMapping } from "@/lib/siba/budget";
import type {
  EligibleBudget,
  FinanceRefs,
  TransactionLineRow,
  TransactionRow,
} from "@/lib/siba/finance";
import { realizationHref, realizationOf } from "@/lib/siba/realization";
import {
  TRANSACTION_TRANSITIONS,
  TRANSACTION_TYPE_TEXT,
  availableTransactionActions,
  transactionIsEditable,
  type TransactionAbilities,
  type TransactionAction,
} from "@/lib/siba/transaction-workflow";
import {
  headerButtonClass,
  orderForHeader,
  type ActionTone,
} from "@/lib/siba/header-actions";
import { BudgetPicker } from "./budget-picker";

export type TransactionFormMode = "new" | "view" | "edit";

/** A line while the document is being edited — before it is a database row. */
type DraftLine = {
  budget_id: number;
  budget_no: string;
  budget_date: string;
  description: string;
  category_id: number | null;
  partner_id: number | null;
  outstanding: number;
  amount: number;
};

/**
 * The header fields that decide where this document's kurs comes from —
 * `rateSource` reads direction, document currency and resource currency, and
 * these are what carry them. Changing any one re-asks the question, so the
 * previous answer cannot be allowed to survive it.
 */
const RATE_CONTEXT: (keyof TransactionValues)[] = [
  "company_id",
  "cash_bank_id",
  "currency_id",
];

/**
 * Realisasi Penerimaan / Pengeluaran create / detail / edit — one component,
 * the menu's direction passed in.
 *
 * The header is the context (concept doc §9): Company, Cash & Bank and
 * Currency together decide which approved Budgets this document may realize,
 * and the direction is the menu's. Category and Partner are not in the header:
 * each line states its own Budget's, and the account each one posts to. Change
 * the header and the eligible set changes with it, so lines that no longer
 * qualify are dropped and the user is told how many.
 *
 * Nothing on this screen moves money. Post does, and it is deliberately a
 * separate, confirmed act: §2.3 makes Post the actual boundary, and §15 makes
 * everything past it permanent.
 */
export function TransactionForm({
  direction,
  mode,
  transaction,
  lines,
  refs,
  mappings,
  defaultCurrencyId,
  fundingRequestNo,
  can,
}: {
  /** The menu this document belongs to. */
  direction: "In" | "Out";
  mode: TransactionFormMode;
  transaction: TransactionRow | null;
  lines: TransactionLineRow[];
  refs: FinanceRefs;
  mappings: BudgetMapping[];
  /** Prefills the Currency picker on the funded route — a default, never a rule. */
  defaultCurrencyId?: number | null;
  /** The open request this document is waiting on, where it has one. */
  fundingRequestNo?: string | null;
  can: TransactionAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";

  const kind = realizationOf(direction);
  const [values, setValues] = useState<TransactionValues>(() =>
    initialValues(direction, transaction, refs, defaultCurrencyId ?? null)
  );
  const [draftLines, setDraftLines] = useState<DraftLine[]>(() =>
    lines.map((l) => ({
      budget_id: l.budget_id,
      budget_no: l.budget_no,
      budget_date: l.budget_date,
      description: l.description,
      category_id: l.category_id,
      partner_id: l.partner_id,
      outstanding: l.outstanding_amount,
      amount: l.settlement_amount,
    }))
  );
  const [pool, setPool] = useState<EligibleBudget[]>([]);
  const [dropped, setDropped] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const [confirm, setConfirm] = useState<TransactionAction | null>(null);
  const [busy, setBusy] = useState(false);

  const companyId = values.company_id ? Number(values.company_id) : null;
  const cashBank =
    refs.cashBanks.find((c) => String(c.id) === values.cash_bank_id) ?? null;

  /**
   * Which route this document takes, decided by whose document it is.
   *
   * The induk holds the cash and posts directly. The anak holds none by design
   * (concept doc §25, §32), so it names a Currency instead of a resource and
   * its document is posted by the induk confirming its Funding Request.
   */
  const funded = Boolean(
    companyId && !refs.companies.find((c) => c.id === companyId)?.isParent
  );

  // The document's own currency, on both routes. It used to be read off the
  // Cash & Bank on the self route; a foreign document paid from a rupiah
  // account is the case that separated the two questions.
  const currencyLabel =
    (editing
      ? refs.currencies.find((c) => String(c.id) === values.currency_id)?.label
      : refs.currencies.find((c) => c.id === transaction?.currency_id)?.label) ??
    "—";

  /**
   * Where this document's kurs comes from — the one question the header has
   * gained. `null` means the pairing is not allowed at all, which the Server
   * Action refuses by name.
   */
  const kursSource =
    !funded && currencyLabel !== "—" && cashBank
      ? rateSource(
          direction,
          currencyLabel,
          cashBank.currencyLabel
        )
      : null;

  const headerReady = Boolean(
    companyId &&
      values.currency_id &&
      (funded || values.cash_bank_id)
  );

  /**
   * The one field still standing between here and choosing a Budget.
   *
   * Which Budgets this document may realize is the whole header at once
   * (concept doc §9), so the picker cannot open before it is complete. It used
   * to say "Lengkapi header dokumen terlebih dahulu", which names none of the
   * fields it could mean — and the header is read left to right, so the first
   * gap is the one to name.
   */
  const budgetWaitingFor = !companyId
    ? "Pilih Company dulu…"
    : !funded && !values.cash_bank_id
      ? "Pilih Cash & Bank dulu…"
      : !values.currency_id
        ? "Pilih Currency dulu…"
        : null;

  const set = (key: keyof TransactionValues, value: string) => {
    setValues((v) => {
      const next = { ...v, [key]: value };
      // Company decides the route, and each route names a different field. A
      // resource left over from the other Company would be a header the Server
      // Action refuses.
      if (key === "company_id") {
        next.cash_bank_id = "";
      }
      // Both kurs fields belong to a header context, not to the document: which
      // of the three provenances applies is decided by direction, document
      // currency and resource currency together, so any of them moving can
      // leave an answer to a question the form is no longer asking. A layer
      // belongs to one resource and `checkHeader` refuses a foreign one — but
      // the control shows empty when its value is not in the list, so the user
      // would be reading a refusal about a field that looks blank. Worse, a
      // rate left behind when the pairing becomes `identity` is refused by a
      // field the form no longer renders, which is an error nobody can clear.
      if (RATE_CONTEXT.includes(key)) {
        next.exchange_rate = "";
        next.cash_bank_layer_id = "";
      }
      return next;
    });
    setDirty(true);
    setErrors((e) => {
      if (!e[key] && !e._form && !e._lines) return e;
      const nextErrors = { ...e };
      delete nextErrors[key];
      delete nextErrors._form;
      delete nextErrors._lines;
      return nextErrors;
    });
  };

  // ------------------------------------------------------- eligibility pool

  // The current lines, readable from the effect below without making it re-run
  // every time an amount is typed. Written from an effect, never during render.
  const linesRef = useRef(draftLines);
  useEffect(() => {
    linesRef.current = draftLines;
  }, [draftLines]);

  const { company_id, cash_bank_id, currency_id } = values;
  const transactionId = transaction?.id;

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;

    const load = async () => {
      const result = headerReady
        ? await listEligibleBudgets(
            {
              transaction_type: direction,
              company_id,
              cash_bank_id,
              currency_id,
              // Eligibility turns on the document's currency, not on the kurs
              // or the date, so none of these narrows the pool.
              exchange_rate: "",
              document_date: "",
              cash_bank_layer_id: "",
              note: "",
            },
            transactionId ? { excludeTransactionId: transactionId } : {}
          )
        : { ok: true as const, budgets: [] };
      if (cancelled) return;

      const budgets = result.ok ? result.budgets : [];
      setPool(budgets);

      // A line whose Budget the new header does not admit cannot stay: the
      // document would otherwise settle a plan its own context rejects. The
      // count is surfaced rather than swallowed.
      const allowed = new Set(budgets.map((b) => b.id));
      const previous = linesRef.current;
      const keep = previous.filter((l) => allowed.has(l.budget_id));
      if (keep.length !== previous.length) {
        setDropped((d) => d + (previous.length - keep.length));
        setDraftLines(keep);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    editing,
    headerReady,
    direction,
    company_id,
    cash_bank_id,
    currency_id,
    transactionId,
  ]);

  // --------------------------------------------------------------- derived

  const total = editing
    ? draftLines.reduce((t, l) => t + (l.amount || 0), 0)
    : transaction?.transaction_amount ?? 0;

  // Plain derivations, not `useMemo`. The React Compiler memoizes this
  // component automatically, and hand-written memoization it cannot prove safe
  // makes it skip the whole file — so the manual version bought nothing and
  // cost the optimization it was imitating. The derivations beside these never
  // had it either.
  /**
   * How one line is classified, and the account it will post to — Company ×
   * its Budget Category × its Partner's Partner Category. Posting is refused
   * for a line with no mapping, so a gap is stated on the line it belongs to.
   */
  const partnerById = new Map(refs.partners.map((p) => [p.id, p]));
  const categoryById = new Map(refs.categories.map((c) => [c.id, c]));
  const classify = (b: { category_id: number | null; partner_id: number | null }) => {
    const partner = b.partner_id != null ? partnerById.get(b.partner_id) ?? null : null;
    const category = b.category_id != null ? categoryById.get(b.category_id) ?? null : null;
    const account =
      companyId && category
        ? mappings.find(
            (m) =>
              m.companyId === companyId &&
              m.budgetCategoryId === category.id &&
              m.partnerCategoryId === (partner ? partner.categoryId : null)
          ) ?? null
        : null;
    return {
      category: category?.label ?? "—",
      partner: partner ? `${partner.label} – ${partner.name}` : null,
      account,
    };
  };

  const cashBankOptions = refs.cashBanks
    .filter((c) => c.companyId === companyId)
    .map((c) => ({
      id: c.id,
      label: c.label,
      name: `${c.name} · ${c.currencyLabel} ${formatNumber(c.balance)}`,
      active: c.active,
    }));

  const company = refs.companies.find((c) => c.id === companyId) ?? null;
  const selectableCompanies = refs.companies.filter((c) => c.selectable);

  const inn = direction === "In";

  const balanceBefore = cashBank?.balance ?? 0;
  const balanceAfter =
    transaction?.status === "Posted" || transaction?.status === "Cancelled"
      ? balanceBefore
      : balanceBefore + (inn ? 1 : -1) * total;

  // ------------------------------------------------------------------ lines

  const alreadyPicked = new Set(draftLines.map((l) => l.budget_id));
  const pickable = pool.filter((b) => !alreadyPicked.has(b.id));

  const addLines = (picked: { budget_id: number; amount: number }[]) => {
    setDraftLines((current) => {
      const byId = new Map(pool.map((b) => [b.id, b]));
      const added = picked.flatMap((p) => {
        const b = byId.get(p.budget_id);
        if (!b) return [];
        return [
          {
            budget_id: b.id,
            budget_no: b.budget_no,
            budget_date: b.budget_date,
            description: b.description,
            category_id: b.category_id,
            partner_id: b.partner_id,
            outstanding: b.outstanding,
            amount: p.amount,
          },
        ];
      });
      return [...current, ...added];
    });
    setDirty(true);
    setPicking(false);
    setErrors((e) => {
      const next = { ...e };
      delete next._lines;
      return next;
    });
  };

  // ----------------------------------------------------------------- writes

  const onSave = async () => {
    setSaving(true);
    const payload = draftLines.map((l) => ({
      budget_id: String(l.budget_id),
      amount: String(l.amount),
    }));
    const result =
      mode === "new"
        ? await createTransaction(values, payload)
        : await updateTransaction(transaction!.id, values, payload);
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
      mode === "new" ? "Dokumen dibuat" : "Perubahan disimpan",
      mode === "new"
        ? `${result.transaction_no} dibuat otomatis. Dokumen masih Draft.`
        : transaction?.transaction_no,
      "ok"
    );
    router.push(realizationHref(direction, result.id));
    router.refresh();
  };

  const run = async (action: TransactionAction) => {
    if (!transaction) return;
    setBusy(true);
    // Submitting raises a Funding Request, and withdrawing a Pending document
    // closes one — both are state the Funding module owns, so both go through
    // its action rather than Finance's. Which one runs is decided here and
    // re-decided by the Server Action; neither is a rule this component holds.
    const viaFunding =
      action === "submit" ||
      (action === "cancel" && transaction.status === "Pending");
    const result = viaFunding
      ? action === "submit"
        ? await requestFunding(transaction.id)
        : await withdrawFunding(transaction.id)
      : await transitionTransaction(transaction.id, action);
    setBusy(false);
    setConfirm(null);
    if (result.ok) {
      toast(result.message, transaction.transaction_no, "ok");
      router.refresh();
      return;
    }
    toast(
      "Tidak dapat diproses",
      result.errors._form ?? Object.values(result.errors)[0],
      "err"
    );
  };

  // ----------------------------------------------------------------- render

  const listHref = realizationHref(direction);
  const backHref = transaction ? `${listHref}/${transaction.id}` : listHref;
  const actions = transaction
    ? availableTransactionActions(transaction.status, can, {
        funded: !refs.companies.find((c) => c.id === transaction.company_id)
          ?.isParent,
      })
    : [];
  const postable = actions.includes("post") && lines.length > 0;

  /**
   * The view-mode header, in header order: danger, then neutral, then the one
   * primary. `availableTransactionActions` returns menu order — safe first —
   * which is the opposite arrangement and right for the vertical row menu only.
   */
  const viewActions: { key: string; tone: ActionTone; node: React.ReactNode }[] =
    transaction
      ? orderForHeader(
          [
            ...(can.edit && transactionIsEditable(transaction.status)
              ? [
                  {
                    key: "edit",
                    tone: "neutral" as ActionTone,
                    node: (
                      <Link
                        key="edit"
                        className="btn"
                        href={`${listHref}/${transaction.id}/edit`}
                      >
                        <Icon name="pen" size={15} /> Ubah
                      </Link>
                    ),
                  },
                ]
              : []),
            ...actions.map((a) => {
              const t = TRANSACTION_TRANSITIONS[a];
              const blocked = a === "post" && !postable;
              return {
                key: a,
                tone: t.tone,
                node: (
                  <button
                    key={a}
                    className={headerButtonClass(t.tone)}
                    disabled={busy || blocked}
                    title={blocked ? "Tambahkan minimal satu Budget" : undefined}
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
      {/* The document names itself by its number. */}
      <DocumentHeader
        module="Finance"
        trail={[{ label: kind.title, href: listHref }]}
        icon="wallet2"
        number={transaction?.transaction_no ?? null}
        placeholder="Dokumen Baru"
        status={transaction?.status ?? null}
        editing={mode === "edit"}
        dirty={editing && dirty}
      >
        {mode === "view" && transaction && (
          <>
            {viewActions.map((i) => i.node)}
            {!actions.length && (
              <span className="lockchip">
                <Icon name="lock" size={13} />{" "}
                {transaction.status === "Posted"
                  ? "Terkunci setelah Post"
                  : transaction.status === "Pending"
                    ? "Menunggu konfirmasi induk"
                    : "Dokumen dibatalkan"}
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
                <Icon name="wallet2" size={15} />
              </span>
              <div className="ct">
                <h3>Header Dokumen</h3>
                <p>
                  Company · Cash &amp; Bank · Currency menentukan Budget{" "}
                  {inn ? "Penerimaan" : "Pengeluaran"} yang dapat
                  direalisasikan.
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
                    help={
                      editing && funded
                        ? "dana diajukan ke induk"
                        : editing
                          ? "menentukan rute dan sumber kas"
                          : undefined
                    }
                    error={errors.company_id}
                  >
                    {mode === "new" && selectableCompanies.length > 1 ? (
                      <Select
                        value={values.company_id}
                        invalid={Boolean(errors.company_id)}
                        placeholder="Pilih Company…"
                        options={selectableCompanies.map((c) => ({
                          value: String(c.id),
                          label: `${c.label} - ${c.name}`,
                          hint: c.isParent
                            ? "Punya Cash & Bank sendiri"
                            : "Dana disediakan induk",
                        }))}
                        onChange={(v) => set("company_id", v)}
                      />
                    ) : (
                      <div className="ro">
                        <span className="lab">{company?.label ?? "—"}</span>
                        <span>{company?.name ?? ""}</span>
                      </div>
                    )}
                  </Field>

                  <Field
                    label="Cash & Bank"
                    span={4}
                    required={editing && !funded}
                    help={
                      funded
                        ? "ditentukan induk saat konfirmasi"
                        : editing
                          ? "boleh currency dokumen atau mata uang dasar"
                          : undefined
                    }
                    error={errors.cash_bank_id}
                  >
                    {funded ? (
                      <div className="ro">
                        <span className="dash">Melalui Funding Request</span>
                      </div>
                    ) : editing ? (
                      <Combobox
                        value={values.cash_bank_id ? Number(values.cash_bank_id) : null}
                        options={cashBankOptions}
                        placeholder="Pilih Cash & Bank…"
                        // Every resource belongs to a Company, and which
                        // Company this document is for also decides whether it
                        // names a resource at all (the anak names a Currency
                        // and goes through Funding Request instead).
                        waitingFor={companyId ? null : "Pilih Company dulu…"}
                        invalid={Boolean(errors.cash_bank_id)}
                        onChange={(v) => set("cash_bank_id", v ? String(v) : "")}
                      />
                    ) : (
                      <div className="ro">
                        <span className="lab">
                          {refs.cashBanks.find(
                            (c) => c.id === transaction!.cash_bank_id
                          )?.label ?? "—"}
                        </span>
                        <span>
                          {refs.cashBanks.find(
                            (c) => c.id === transaction!.cash_bank_id
                          )?.name ?? ""}
                        </span>
                      </div>
                    )}
                  </Field>

                  <Field
                    label="Currency"
                    span={4}
                    required={editing}
                    help={editing ? "menentukan Budget yang cocok" : undefined}
                    error={errors.currency_id}
                  >
                    {editing ? (
                      <Combobox
                        value={values.currency_id ? Number(values.currency_id) : null}
                        options={refs.currencies}
                        placeholder="Pilih Currency…"
                        invalid={Boolean(errors.currency_id)}
                        onChange={(v) => set("currency_id", v ? String(v) : "")}
                      />
                    ) : (
                      <div className="ro">
                        <span className="lab">{currencyLabel}</span>
                        <span>{funded ? "kebutuhan dana" : "mata uang dokumen"}</span>
                      </div>
                    )}
                  </Field>
                </FormRow>

                <FormRow>
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
                        {transaction?.document_date ? (
                          formatDate(transaction.document_date)
                        ) : (
                          <span className="dash">belum ditentukan</span>
                        )}
                      </div>
                    )}
                  </Field>

                {/* The kurs, in whichever of its two modes this document is in.
                    Absent entirely for rupiah on rupiah, where a rate would be
                    a rate between the base currency and itself. */}
                {kursSource && kursSource !== "identity" && (
                  <>
                    {kursSource === "layer" ? (
                      <Field
                        label="Kurs"
                        span={8}
                        required={editing}
                        help={editing ? "satu transaksi memakai satu layer" : undefined}
                        error={errors.cash_bank_layer_id}
                      >
                        {editing ? (
                          <KursSelect
                            value={
                              values.cash_bank_layer_id
                                ? Number(values.cash_bank_layer_id)
                                : null
                            }
                            layers={cashBank?.layers ?? []}
                            currencyLabel={currencyLabel}
                            invalid={Boolean(errors.cash_bank_layer_id)}
                            onChange={(v) =>
                              set("cash_bank_layer_id", v ? String(v) : "")
                            }
                          />
                        ) : (
                          <div className="ro">
                            <span className="mny">
                              {formatRate(transaction?.exchange_rate ?? 0)}
                            </span>
                            <span>dari layer yang dipilih</span>
                          </div>
                        )}
                      </Field>
                    ) : (
                      <Field
                        label="Kurs"
                        span={4}
                        required={editing}
                        help={
                          editing
                            ? `1 ${currencyLabel} dalam ${BASE_CURRENCY_LABEL}`
                            : undefined
                        }
                        error={errors.exchange_rate}
                      >
                        {editing ? (
                          <RateInput
                            value={values.exchange_rate}
                            pairLabel={`${currencyLabel} → ${BASE_CURRENCY_LABEL}`}
                            invalid={Boolean(errors.exchange_rate)}
                            onChange={(v) => set("exchange_rate", v)}
                          />
                        ) : (
                          <div className="ro">
                            <span className="mny">
                              {formatRate(transaction?.exchange_rate ?? 0)}
                            </span>
                          </div>
                        )}
                      </Field>
                    )}
                  </>
                )}

                  <Field
                    label="Catatan"
                    span={kursSource === "layer" ? 12 : kursSource === "entered" ? 4 : 8}
                  >
                    {editing ? (
                      <textarea
                        className="ta"
                        rows={2}
                        value={values.note}
                        onChange={(e) => set("note", e.target.value)}
                        placeholder="Keterangan tambahan untuk dokumen ini…"
                      />
                    ) : (
                      <div className="ro">
                        {transaction!.note || <span className="dash">—</span>}
                      </div>
                    )}
                  </Field>
                </FormRow>
              </FormSection>
            </FormBody>

            {/* What the document's state means for what has already moved. It
                was the summary card's `.sidenote`; the state is stated once, by
                the badge in the heading, and this says what it implies. */}
            {mode === "view" && (
              <p className="fnote">
                {transaction!.status === "Posted"
                  ? "Dokumen sudah menjadi transaksi aktual: realisasi setiap Budget, saldo Cash & Bank, dan buku subjek sudah bergerak — satu entri per Budget. Historical record bersifat append-only — koreksi dilakukan sebagai dokumen baru."
                  : transaction!.status === "Pending"
                    ? `Dokumen menunggu konfirmasi Company induk${
                        fundingRequestNo ? ` (${fundingRequestNo})` : ""
                      }. Belum ada yang bergerak: kas, realisasi Budget, buku pembantu, dan journal kedua Company baru tercatat saat funding dikonfirmasi.`
                    : transaction!.status === "Draft"
                      ? "Dokumen masih Draft. Budget, saldo Cash & Bank, dan buku subjek belum bergerak."
                      : "Dokumen dibatalkan sebelum Post, sehingga tidak pernah menyentuh Budget maupun saldo."}
              </p>
            )}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="clip" size={15} />
              </span>
              <div className="ct">
                <h3>Budget yang Direalisasikan</h3>
                <p>
                  Budget dari Category dan Partner mana pun, selama memenuhi
                  kriteria header. Setiap Budget menjadi entri buku dan baris
                  journal tersendiri.
                </p>
              </div>
              {editing ? (
                <button
                  className="btn sm primary"
                  disabled={!headerReady}
                  title={budgetWaitingFor ?? undefined}
                  onClick={() => setPicking(true)}
                >
                  <Icon name="plus" size={14} /> Tambah Budget
                </button>
              ) : (
                <span className="hint">{lines.length} budget</span>
              )}
            </div>

            {editing && dropped > 0 && (
              <div className="nbox warn slim">
                <span className="ni">
                  <Icon name="warn" size={14} />
                </span>
                <div>
                  <b>{dropped} baris dikeluarkan otomatis.</b>
                  <p>
                    Budget tersebut tidak lagi memenuhi kriteria header yang
                    baru.
                  </p>
                </div>
              </div>
            )}

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
                      <th style={{ width: 92 }}>Budget</th>
                      <th>Deskripsi</th>
                      <th style={{ width: 210 }}>Klasifikasi</th>
                      <th className="num" style={{ width: 124 }}>
                        Nominal Budget
                      </th>
                      <th className="num" style={{ width: 124 }}>
                        Outstanding
                      </th>
                      <th className="num" style={{ width: editing ? 164 : 150 }}>
                        Realisasi Dokumen
                      </th>
                      <th style={{ width: 44 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {editing
                      ? draftLines.map((l, i) => {
                          const over = l.amount > l.outstanding;
                          const full = l.amount >= l.outstanding;
                          const planned =
                            pool.find((b) => b.id === l.budget_id)?.budget_amount ??
                            null;
                          const c = classify(l);
                          return (
                            <tr key={l.budget_id} className={over ? "overrow" : undefined}>
                              <td className="no">{i + 1}</td>
                              <td>
                                <span className="lab">{l.budget_no}</span>
                              </td>
                              <td className="pri">
                                <span className="dstack">
                                  <span className="d1">{l.description}</span>
                                  <span className="d2">
                                    {formatDate(l.budget_date)}
                                  </span>
                                </span>
                              </td>
                              <LineClass c={c} />
                              <td className="num">
                                <span className="mny">
                                  {planned == null
                                    ? "—"
                                    : formatMoney(planned, currencyLabel)}
                                </span>
                              </td>
                              <td className="num">
                                <span className={`mny${l.outstanding ? "" : " z"}`}>
                                  {formatMoney(l.outstanding, currencyLabel)}
                                </span>
                              </td>
                              <td className="num">
                                <MoneyInput
                                  size="sm"
                                  over={over}
                                  ariaLabel="Nominal realisasi"
                                  value={l.amount ? String(l.amount) : ""}
                                  onChange={(raw) => {
                                    setDraftLines((rows) =>
                                      rows.map((r) =>
                                        r.budget_id === l.budget_id
                                          ? { ...r, amount: raw ? Number(raw) : 0 }
                                          : r
                                      )
                                    );
                                    setDirty(true);
                                  }}
                                />
                                {over ? (
                                  <span
                                    className="overtag"
                                    title="Realisasi melebihi outstanding"
                                  >
                                    Over{" "}
                                    {formatMoney(
                                      l.amount - l.outstanding,
                                      currencyLabel
                                    )}
                                  </span>
                                ) : full ? (
                                  <span className="fulltag">Menutup budget</span>
                                ) : null}
                              </td>
                              <td className="acts">
                                <button
                                  className="iact del"
                                  title="Keluarkan dari dokumen"
                                  onClick={() => {
                                    setDraftLines((rows) =>
                                      rows.filter((r) => r.budget_id !== l.budget_id)
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
                          const over = l.settlement_amount > l.outstanding_amount;
                          const c = classify(l);
                          return (
                            <tr key={l.id} className={over ? "overrow" : undefined}>
                              <td className="no">{i + 1}</td>
                              <td>
                                <span className="lab">{l.budget_no}</span>
                              </td>
                              <td className="pri">
                                <span className="dstack">
                                  <span className="d1">{l.description}</span>
                                  <span className="d2">
                                    {formatDate(l.budget_date)} ·{" "}
                                    {STATUS_TEXT[l.budget_status] ?? l.budget_status}
                                  </span>
                                </span>
                              </td>
                              <LineClass c={c} />
                              <td className="num">
                                <span className="mny">
                                  {formatMoney(l.budget_amount, currencyLabel)}
                                </span>
                              </td>
                              <td className="num">
                                <span
                                  className={`mny${l.outstanding_amount ? "" : " z"}`}
                                >
                                  {formatMoney(l.outstanding_amount, currencyLabel)}
                                </span>
                              </td>
                              <td className="num">
                                <span className={`mny${over ? " over" : ""}`}>
                                  {formatMoney(l.settlement_amount, currencyLabel)}
                                </span>
                              </td>
                              <td className="acts">
                                <Link
                                  className="iact"
                                  href={`/budget/budget/${l.budget_id}`}
                                  title="Buka Budget"
                                >
                                  <Icon name="eye" size={14} />
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                  </tbody>
                  <tfoot>
                    <tr className="totrow">
                      <td colSpan={6} style={{ textAlign: "right" }}>
                        Total Realisasi Dokumen
                      </td>
                      <td className="num">
                        <span className="mny big">
                          {formatMoney(total, currencyLabel)}
                        </span>
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="empty sm">
                <div className="ic">
                  <Icon name="clip" size={18} />
                </div>
                <h4>
                  {editing
                    ? headerReady
                      ? "Belum ada Budget dipilih"
                      : "Lengkapi header dokumen"
                    : "Dokumen tanpa Budget"}
                </h4>
                <p>
                  {editing
                    ? headerReady
                      ? "Tekan Tambah Budget untuk melihat Budget yang memenuhi kriteria header dokumen ini."
                      : funded
                        ? "Pilih Company dan Currency terlebih dahulu."
                        : "Pilih Company, Cash & Bank, dan Currency terlebih dahulu."
                    : "Tidak ada line pada dokumen ini."}
                </p>
              </div>
            )}

            {funded && total > 0 && (
              <div className="cardfoot">
                <div className="impact">
                  <div className="ttl">Dampak Transaksi</div>
                  <div className="ir">
                    <span>Arah kas</span>
                    <b>{inn ? "Penerimaan" : "Pengeluaran"}</b>
                  </div>
                  <div className="ir">
                    <span>Sumber dana</span>
                    <b>Kas induk melalui Funding Request</b>
                  </div>
                  <div className="ir">
                    <span>
                      {transaction?.status === "Posted"
                        ? `Posisi terhadap induk`
                        : "Saat funding dikonfirmasi"}
                    </span>
                    <b>
                      {inn ? "Piutang kepada induk" : "Hutang kepada induk"}{" "}
                      {formatMoney(total, currencyLabel)}
                    </b>
                  </div>
                </div>
              </div>
            )}

            {!funded && cashBank && total > 0 && (
              <div className="cardfoot">
                <div className="impact">
                  <div className="ttl">Dampak Transaksi</div>
                  <div className="ir">
                    <span>Arah kas</span>
                    <b>{inn ? "Penerimaan" : "Pengeluaran"}</b>
                  </div>
                  <div className="ir">
                    <span>Cash &amp; Bank</span>
                    <b>{cashBank.label}</b>
                  </div>
                  <div className="ir">
                    <span>Entri Cash Bank Book</span>
                    <b>{editing ? draftLines.length : lines.length} entri, satu per Budget</b>
                  </div>
                  <div className="ir">
                    <span>
                      {transaction?.status === "Posted"
                        ? `Saldo ${cashBank.label} kini`
                        : transaction?.status === "Cancelled"
                          ? "Saldo tidak berubah"
                          : "Saldo setelah posting"}
                    </span>
                    <b>{formatMoney(balanceAfter, currencyLabel)}</b>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {picking && (
        <BudgetPicker
          pool={pickable}
          currencyLabel={currencyLabel}
          classify={classify}
          criteria={[
            { label: "Company", value: company?.label ?? "—" },
            { label: "Tipe Budget", value: TRANSACTION_TYPE_TEXT[direction] },
            { label: "Currency", value: currencyLabel },
          ]}
          onAdd={addLines}
          onClose={() => setPicking(false)}
        />
      )}

      {confirm && transaction && (
        <ConfirmDialog
          open
          icon={TRANSACTION_TRANSITIONS[confirm].icon}
          tone={TRANSACTION_TRANSITIONS[confirm].tone === "danger" ? "danger" : "ok"}
          title={TRANSACTION_TRANSITIONS[confirm].title}
          subject={`${transaction.transaction_no} – ${formatMoney(total, currencyLabel)}`}
          body={TRANSACTION_TRANSITIONS[confirm].body}
          confirmLabel={TRANSACTION_TRANSITIONS[confirm].confirmLabel}
          confirmTone={
            TRANSACTION_TRANSITIONS[confirm].tone === "danger" ? "solid-danger" : "primary"
          }
          busy={busy}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        >
          {confirm === "post" && (
            <div className="apsum" style={{ marginTop: 14, textAlign: "left" }}>
              <div>
                <span>Budget direalisasi</span>
                <b>{lines.length} budget</b>
              </div>
              <div className="amt">
                <span>Nominal</span>
                <b>{formatMoney(total, currencyLabel)}</b>
              </div>
              {cashBank && (
                <div>
                  <span>{cashBank.label} sesudah</span>
                  <b>{formatMoney(balanceAfter, currencyLabel)}</b>
                </div>
              )}
            </div>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * One line's classification cell: its Budget Category and Partner, then the
 * account that combination posts to — or the gap, stated where it is.
 */
function LineClass({
  c,
}: {
  c: {
    category: string;
    partner: string | null;
    account: BudgetMapping | null;
  };
}) {
  return (
    <td>
      <span className="dstack">
        <span className="d1">
          {c.category}
          {c.partner ? ` · ${c.partner}` : ""}
        </span>
        <span className="d2">
          {c.account
            ? `${c.account.accountLabel} ${c.account.accountName}`
            : "account belum dipetakan"}
        </span>
      </span>
    </td>
  );
}

function initialValues(
  direction: "In" | "Out",
  transaction: TransactionRow | null,
  refs: FinanceRefs,
  defaultCurrencyId: number | null
): TransactionValues {
  if (!transaction) {
    // The induk where this reader may write for it, since that is where most
    // documents are written — but it is a starting point, not a lock: the anak
    // reaches Finance through the same screen, by the funded route.
    const selectable = refs.companies.filter((c) => c.selectable);
    const start =
      selectable.find((c) => c.id === refs.transactingCompanyId) ??
      (selectable.length === 1 ? selectable[0] : null);

    return {
      transaction_type: direction,
      company_id: start ? String(start.id) : "",
      cash_bank_id: "",
      currency_id: defaultCurrencyId ? String(defaultCurrencyId) : "",
      exchange_rate: "",
      cash_bank_layer_id: "",
      // Today, as every editable date starts (§10 rule 33); moved back for a
      // backdated document.
      document_date: todayIso(),
      note: "",
    };
  }
  return {
    transaction_type: transaction.transaction_type,
    company_id: String(transaction.company_id),
    cash_bank_id: transaction.cash_bank_id
      ? String(transaction.cash_bank_id)
      : "",
    currency_id: String(transaction.currency_id),
    exchange_rate: transaction.exchange_rate ? String(transaction.exchange_rate) : "",
    cash_bank_layer_id: transaction.cash_bank_layer_id
      ? String(transaction.cash_bank_layer_id)
      : "",
    // A draft saved before drafts carried a date starts on today.
    document_date: transaction.document_date ?? todayIso(),
    note: transaction.note ?? "",
  };
}
