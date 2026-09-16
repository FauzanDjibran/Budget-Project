"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { DateInput } from "@/components/ui/date-input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { MoneyInput } from "@/components/ui/money-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  Field,
  FormBody,
  FormRow,
  FormSection,
} from "@/components/ui/form";
import {
  createBudget,
  transitionBudget,
  updateBudget,
  type BudgetValues,
} from "@/app/actions/budget";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type {
  BudgetMapping,
  BudgetRefs,
  BudgetRow,
} from "@/lib/siba/budget";
import {
  BUDGET_TRANSITIONS,
  BUDGET_TYPE_TEXT,
  availableActions,
  budgetIsEditable,
  type BudgetAbilities,
  type BudgetAction,
} from "@/lib/siba/budget-workflow";
import {
  headerButtonClass,
  orderForHeader,
  type ActionTone,
} from "@/lib/siba/header-actions";
import type { budgetRealizations } from "@/lib/siba/finance";
import { ApproveDialog } from "./approve-dialog";
import { RealizationCard } from "./realization-card";

export type BudgetFormMode = "new" | "view" | "edit";

/**
 * Budget create / detail / edit.
 *
 * The form carries only what a planner supplies — date, company, currency,
 * type, amount, description. Budget Category and Partner are absent on purpose:
 * concept doc §6.2 says creation has no classification, and §6.3 makes it the
 * approver's decision. They appear here read-only, once approval has set them.
 */
export function BudgetForm({
  mode,
  budget,
  refs,
  mappings,
  month,
  can,
  defaultCurrencyId,
  realizations,
}: {
  mode: BudgetFormMode;
  budget: BudgetRow | null;
  refs: BudgetRefs;
  mappings: BudgetMapping[];
  /** The fiscal period the budget's date falls into, if any. */
  month: { id: number; label: string; name: string } | null;
  can: BudgetAbilities;
  /**
   * The Currency a new budget starts on, from System Default and already
   * resolved against the master. A starting point only — the planner changes
   * it like any other field, and the Server Action validates what is saved.
   */
  defaultCurrencyId?: number | null;
  /** The documents behind `realized_amount` — view mode only. */
  realizations?: Awaited<ReturnType<typeof budgetRealizations>>;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";
  const exists = Boolean(budget);

  const [values, setValues] = useState<BudgetValues>(() =>
    initialValues(budget, defaultCurrencyId)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState<BudgetAction | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveErrors, setApproveErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = (key: keyof BudgetValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
    setErrors((e) => {
      if (!e[key] && !e._form) return e;
      const next = { ...e };
      delete next[key];
      delete next._form;
      return next;
    });
  };

  const currencyLabel =
    refs.currencies.find((c) => String(c.id) === values.currency_id)?.label ?? "IDR";
  const category = refs.categories.find((c) => c.id === budget?.category_id) ?? null;
  const partner = refs.partners.find((p) => p.id === budget?.partner_id) ?? null;
  const company = refs.companies.find((c) => c.id === budget?.company_id) ?? null;

  const backHref = budget ? `/budget/budget/${budget.id}` : listHref(month);

  const onSave = async () => {
    setSaving(true);
    const result =
      mode === "new"
        ? await createBudget(values)
        : await updateBudget(budget!.id, values);
    setSaving(false);

    if (!result.ok) {
      setErrors(result.errors);
      toast(
        "Gagal menyimpan",
        result.errors._form ?? "Periksa kembali isian yang ditandai.",
        "err"
      );
      return;
    }
    setDirty(false);
    toast(
      mode === "new" ? "Budget dibuat" : "Perubahan disimpan",
      result.budget_no ?? budget?.budget_no,
      "ok"
    );
    router.push(`/budget/budget/${result.id}`);
    router.refresh();
  };

  const run = async (
    action: BudgetAction,
    classification?: { category_id: string | null; partner_id: string | null }
  ) => {
    if (!budget) return;
    setBusy(true);
    const result = await transitionBudget(budget.id, action, classification);
    setBusy(false);
    if (result.ok) {
      setConfirm(null);
      setApproving(false);
      setApproveErrors({});
      toast(result.message, `${budget.budget_no} · ${budget.description}`, "ok");
      router.refresh();
      return;
    }
    if (action === "approve") {
      setApproveErrors(result.errors);
      return;
    }
    setConfirm(null);
    toast(
      "Tidak dapat diproses",
      result.errors._form ?? Object.values(result.errors)[0],
      "err"
    );
  };

  const actions = budget ? availableActions(budget.status, can) : [];

  /**
   * The view-mode header, in header order: danger, then neutral, then the one
   * primary. `availableActions` returns menu order — safe first — which is the
   * opposite arrangement and the right one for the vertical row menu only.
   */
  const viewActions: { key: string; tone: ActionTone; node: React.ReactNode }[] =
    budget
      ? orderForHeader(
          [
            ...(can.edit && budgetIsEditable(budget.status)
              ? [
                  {
                    key: "edit",
                    tone: "neutral" as ActionTone,
                    node: (
                      <Link
                        key="edit"
                        className="btn"
                        href={`/budget/budget/${budget.id}/edit`}
                      >
                        <Icon name="pen" size={15} /> Ubah
                      </Link>
                    ),
                  },
                ]
              : []),
            ...actions.map((a) => {
              const t = BUDGET_TRANSITIONS[a];
              return {
                key: a,
                tone: t.tone,
                node: (
                  <button
                    key={a}
                    className={headerButtonClass(t.tone)}
                    disabled={busy}
                    onClick={() =>
                      a === "approve" ? setApproving(true) : setConfirm(a)
                    }
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
          <Link href="/dashboard">Budget</Link>
          <span>/</span>
          <Link href="/budget/budget">Budget Month</Link>
          <span>/</span>
          <Link href={listHref(month)}>{month ? month.name : "Semua Bulan"}</Link>
          <span>/</span>
          <span className="cur">{mode === "new" ? "Baru" : budget?.budget_no}</span>
        </div>
        <div className="ph-row">
          {/* A document names itself by its number, so that is the heading and
              the status sits beside it — the description is a field on the form
              below, and stating it here as well would say it twice. Before the
              first save there is no number and no status, so the heading is a
              placeholder instead. */}
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            {budget ? (
              <>
                <span className="docno">{budget.budget_no}</span>
                <span className={`bdg ${STATUS_CLASS[budget.status] ?? "s-mute"}`}>
                  {STATUS_TEXT[budget.status] ?? budget.status}
                </span>
              </>
            ) : (
              "Budget Baru"
            )}
          </h1>
          <div className="ph-act">
            {editing && dirty && (
              <span className="ph-dirty">
                <span className="pulse" /> Belum disimpan
              </span>
            )}
            {mode === "view" && budget && viewActions.map((i) => i.node)}
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

      {/* One column: there is no summary card any more. Its facts went where
          each is actually read — the number and the status into the page
          heading, the authorship into the record's own history panel, and the
          Budget Month into the breadcrumb that already linked to it. */}
      <div className="fgrid solo">
        <div>
          <div className="card">
            <div className="card-h">
              <span className="ci">
                <Icon name="clip" size={15} />
              </span>
              <div className="ct">
                <h3>Data Budget</h3>
                <p>
                  {mode === "new"
                    ? "Budget Category dan Partner ditetapkan approver saat persetujuan."
                    : editing
                      ? "Rencana kebutuhan dana dan nominalnya."
                      : "Layer planning — realisasinya terjadi di modul Finance."}
                </p>
              </div>
            </div>
            <FormBody>
              {editing ? (
                <FormSection>
                  <FormRow>
                    <Field
                      label="Tanggal Budget"
                      span={4}
                      required
                      help="menentukan Budget Month"
                      error={errors.budget_date}
                    >
                      <DateInput
                        value={values.budget_date}
                        invalid={Boolean(errors.budget_date)}
                        onChange={(v) => set("budget_date", v)}
                      />
                    </Field>

                    <Field
                      label="Company"
                      span={4}
                      required
                      locked={exists}
                      help="pemilik kebutuhan dana"
                      error={errors.company_id}
                    >
                      {exists ? (
                        <div className="ro">
                          <span className="lab">{company?.label ?? "—"}</span>
                          <span>{company?.name ?? ""}</span>
                        </div>
                      ) : (
                        <Combobox
                          value={values.company_id ? Number(values.company_id) : null}
                          options={refs.companies}
                          placeholder="Pilih Company…"
                          invalid={Boolean(errors.company_id)}
                          onChange={(v) => set("company_id", v ? String(v) : "")}
                        />
                      )}
                    </Field>

                    <Field
                      label="Tipe"
                      span={4}
                      required
                      help="In = penerimaan · Out = pengeluaran"
                      error={errors.budget_type}
                    >
                      <Select
                        value={values.budget_type}
                        invalid={Boolean(errors.budget_type)}
                        options={[
                          { value: "Out", label: "Pengeluaran" },
                          { value: "In", label: "Penerimaan" },
                        ]}
                        onChange={(v) => set("budget_type", v)}
                      />
                    </Field>
                  </FormRow>

                  <FormRow>
                    <Field
                      label="Currency"
                      span={4}
                      required
                      error={errors.currency_id}
                    >
                      <Combobox
                        value={values.currency_id ? Number(values.currency_id) : null}
                        options={refs.currencies}
                        placeholder="Pilih Currency…"
                        invalid={Boolean(errors.currency_id)}
                        onChange={(v) => set("currency_id", v ? String(v) : "")}
                      />
                    </Field>

                    <Field
                      label="Nominal Budget"
                      span={4}
                      required
                      help={`dalam ${currencyLabel}`}
                      error={errors.budget_amount}
                    >
                      <MoneyInput
                        value={values.budget_amount}
                        currencyLabel={currencyLabel}
                        invalid={Boolean(errors.budget_amount)}
                        onChange={(v) => set("budget_amount", v)}
                      />
                    </Field>

                    <Field
                      label="Deskripsi"
                      span={4}
                      required
                      error={errors.description}
                    >
                      <textarea
                        className={`ta${errors.description ? " bad" : ""}`}
                        rows={2}
                        value={values.description}
                        onChange={(e) => set("description", e.target.value)}
                        placeholder="Untuk apa dana ini direncanakan…"
                      />
                    </Field>
                  </FormRow>
                </FormSection>
              ) : (
                <>
                  <FormSection title="Informasi Utama">
                    <FormRow>
                      <Field label="Tanggal Budget" span={4}>
                        <div className="ro">{formatDate(budget!.budget_date)}</div>
                      </Field>

                      <Field label="Company" span={4}>
                        <div className="ro">
                          <span className="lab">{company?.label ?? "—"}</span>
                          <span>{company?.name ?? ""}</span>
                        </div>
                      </Field>

                      <Field label="Tipe" span={4}>
                        <div className="ro">
                          <span
                            className={`bdg ${budget!.budget_type === "In" ? "t-acc" : "t-vio"}`}
                          >
                            {BUDGET_TYPE_TEXT[budget!.budget_type]}
                          </span>
                        </div>
                      </Field>
                    </FormRow>

                    <FormRow>
                      <Field label="Currency" span={4}>
                        <div className="ro">
                          <span className="lab">
                            {currencyOf(refs, budget!.currency_id)}
                          </span>
                        </div>
                      </Field>

                      <Field label="Nominal Budget" span={4}>
                        <div className="ro">
                          <span className="mny big">
                            {formatMoney(
                              budget!.budget_amount,
                              currencyOf(refs, budget!.currency_id)
                            )}
                          </span>
                        </div>
                      </Field>

                      <Field label="Realisasi" span={4} help="dari dokumen ter-Post">
                        <div className="ro">
                          <span className={`mny${budget!.realized_amount ? "" : " z"}`}>
                            {formatMoney(
                              budget!.realized_amount,
                              currencyOf(refs, budget!.currency_id)
                            )}
                          </span>
                        </div>
                      </Field>
                    </FormRow>

                    <FormRow>
                      <Field label="Deskripsi" span={12}>
                        <div className="ro">{budget!.description}</div>
                      </Field>
                    </FormRow>
                  </FormSection>

                  <FormSection title="Klasifikasi (ditetapkan approver)">
                    <FormRow>
                      <Field
                        label="Budget Category"
                        span={6}
                        help="menentukan Account tujuan Journal"
                      >
                        <div className="ro">
                          {category ? (
                            <>
                              <span className="lab">{category.label}</span>
                              <span>{category.name}</span>
                            </>
                          ) : (
                            <span className="dash">Belum ditetapkan</span>
                          )}
                        </div>
                      </Field>

                      <Field
                        label="Partner"
                        span={6}
                        help="bila Category mensyaratkan subjek"
                      >
                        <div className="ro">
                          {partner ? (
                            <>
                              <span className="lab">{partner.label}</span>
                              <span>
                                {partner.name} ({partner.categoryLabel})
                              </span>
                            </>
                          ) : (
                            <span className="dash">
                              {category ? "Tidak diperlukan" : "Belum ditetapkan"}
                            </span>
                          )}
                        </div>
                      </Field>
                    </FormRow>
                  </FormSection>
                </>
              )}
            </FormBody>
          </div>

          {mode === "view" && realizations && (
            <RealizationCard
              realizations={realizations}
              currencyLabel={currencyOf(refs, budget!.currency_id)}
            />
          )}
        </div>
      </div>

      {confirm && budget && (
        <ConfirmDialog
          open
          icon={BUDGET_TRANSITIONS[confirm].icon}
          tone={BUDGET_TRANSITIONS[confirm].tone === "danger" ? "danger" : "brand"}
          title={BUDGET_TRANSITIONS[confirm].title}
          subject={`${budget.budget_no} – ${budget.description}`}
          body={BUDGET_TRANSITIONS[confirm].body}
          confirmLabel={BUDGET_TRANSITIONS[confirm].confirmLabel}
          confirmTone={
            BUDGET_TRANSITIONS[confirm].tone === "danger" ? "solid-danger" : "primary"
          }
          busy={busy}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {approving && budget && (
        <ApproveDialog
          budget={budget}
          refs={refs}
          mappings={mappings}
          errors={approveErrors}
          busy={busy}
          onConfirm={(categoryId, partnerId) =>
            run("approve", { category_id: categoryId, partner_id: partnerId })
          }
          onCancel={() => {
            setApproving(false);
            setApproveErrors({});
          }}
        />
      )}
    </>
  );
}

function currencyOf(refs: BudgetRefs, id: number): string {
  return refs.currencies.find((c) => c.id === id)?.label ?? "IDR";
}

function listHref(month: { id: number } | null): string {
  return month ? `/budget/budget/month/${month.id}` : "/budget/budget/month/all";
}

function initialValues(
  budget: BudgetRow | null,
  defaultCurrencyId?: number | null
): BudgetValues {
  if (!budget) {
    return {
      // A plan is nearly always made for today, so the field starts there and
      // is changed only when it is not.
      budget_date: todayIso(),
      company_id: "",
      currency_id: defaultCurrencyId ? String(defaultCurrencyId) : "",
      budget_type: "Out",
      budget_amount: "",
      description: "",
    };
  }
  return {
    budget_date: budget.budget_date,
    company_id: String(budget.company_id),
    currency_id: String(budget.currency_id),
    budget_type: budget.budget_type,
    budget_amount: String(budget.budget_amount),
    description: budget.description,
  };
}
