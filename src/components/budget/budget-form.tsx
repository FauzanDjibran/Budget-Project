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
  createBudget,
  transitionBudget,
  updateBudget,
  type BudgetValues,
} from "@/app/actions/budget";
import { formatDate, formatMoney, formatTimestamp, todayIso } from "@/lib/format";
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
  createdByEmail,
  updatedByEmail,
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
  createdByEmail?: string;
  updatedByEmail?: string;
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
  const title =
    mode === "new"
      ? "Tambah Budget"
      : budget?.description ?? "Budget";

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
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            {title}
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
        <p className="ph-sub">
          {mode === "new"
            ? "Budget dibuat tanpa klasifikasi. Budget Category dan Partner ditetapkan approver saat persetujuan."
            : "Layer planning. Budget menyediakan rencana nominal; realisasinya terjadi di modul Finance."}
        </p>
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
                <Icon name="clip" size={15} />
              </span>
              <div className="ct">
                <h3>Data Budget</h3>
                <p>Rencana kebutuhan dana dan nominalnya.</p>
              </div>
            </div>
            <div className="card-b">
              <div className="fsec">
                <div className="sec-t">Informasi Utama</div>
                <div className="frow">
                  <div className="fld">
                    <label>
                      Tanggal Budget{editing && <span className="req">*</span>}
                    </label>
                    {editing ? (
                      <DateInput
                        value={values.budget_date}
                        invalid={Boolean(errors.budget_date)}
                        onChange={(v) => set("budget_date", v)}
                      />
                    ) : (
                      <div className="ro">{formatDate(budget!.budget_date)}</div>
                    )}
                    <Foot
                      error={errors.budget_date}
                      help={
                        editing
                          ? "Kapan kebutuhan dana ini direncanakan terjadi. Menentukan Budget Month."
                          : undefined
                      }
                    />
                  </div>

                  <div className="fld">
                    <label>
                      Company{editing && <span className="req">*</span>}
                      {editing && exists && <span className="lockb">Terkunci</span>}
                    </label>
                    {editing && !exists ? (
                      <Combobox
                        value={values.company_id ? Number(values.company_id) : null}
                        options={refs.companies}
                        placeholder="Pilih Company…"
                        invalid={Boolean(errors.company_id)}
                        onChange={(v) => set("company_id", v ? String(v) : "")}
                      />
                    ) : (
                      <div className="ro">
                        <span className="lab">{company?.label ?? "—"}</span>
                        <span>{company?.name ?? ""}</span>
                      </div>
                    )}
                    <Foot
                      error={errors.company_id}
                      help={
                        editing
                          ? "Company yang memiliki kebutuhan. Tidak dapat dipindah setelah disimpan."
                          : undefined
                      }
                    />
                  </div>
                </div>

                <div className="frow">
                  <div className="fld">
                    <label>
                      Tipe{editing && <span className="req">*</span>}
                    </label>
                    {editing ? (
                      <Select
                        value={values.budget_type}
                        invalid={Boolean(errors.budget_type)}
                        options={[
                          { value: "Out", label: "Pengeluaran" },
                          { value: "In", label: "Penerimaan" },
                        ]}
                        onChange={(v) => set("budget_type", v)}
                      />
                    ) : (
                      <div className="ro">
                        <span
                          className={`bdg ${budget!.budget_type === "In" ? "t-acc" : "t-vio"}`}
                        >
                          {BUDGET_TYPE_TEXT[budget!.budget_type]}
                        </span>
                      </div>
                    )}
                    <Foot
                      error={errors.budget_type}
                      help={
                        editing
                          ? "In = penerimaan · Out = pengeluaran. Menentukan Budget Category yang sah saat persetujuan."
                          : undefined
                      }
                    />
                  </div>

                  <div className="fld">
                    <label>
                      Currency{editing && <span className="req">*</span>}
                    </label>
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
                        <span className="lab">{currencyOf(refs, budget!.currency_id)}</span>
                      </div>
                    )}
                    <Foot error={errors.currency_id} />
                  </div>
                </div>

                <div className="frow">
                  <div className="fld">
                    <label>
                      Nominal Budget{editing && <span className="req">*</span>}
                    </label>
                    {editing ? (
                      <MoneyInput
                        value={values.budget_amount}
                        currencyLabel={currencyLabel}
                        invalid={Boolean(errors.budget_amount)}
                        onChange={(v) => set("budget_amount", v)}
                      />
                    ) : (
                      <div className="ro">
                        <span className="mny big">
                          {formatMoney(
                            budget!.budget_amount,
                            currencyOf(refs, budget!.currency_id)
                          )}
                        </span>
                      </div>
                    )}
                    <Foot
                      error={errors.budget_amount}
                      help={
                        editing
                          ? `Nominal yang direncanakan, dalam ${currencyLabel}.`
                          : undefined
                      }
                    />
                  </div>

                  {!editing && (
                    <div className="fld">
                      <label>Realisasi</label>
                      <div className="ro">
                        <span
                          className={`mny${budget!.realized_amount ? "" : " z"}`}
                        >
                          {formatMoney(
                            budget!.realized_amount,
                            currencyOf(refs, budget!.currency_id)
                          )}
                        </span>
                      </div>
                      <div className="help">
                        Terisi otomatis oleh dokumen Cash Bank Transaction yang
                        sudah di-Post — rinciannya ada di kartu Realisasi.
                      </div>
                    </div>
                  )}
                </div>

                <div className="frow">
                  <div className="fld full">
                    <label>
                      Deskripsi{editing && <span className="req">*</span>}
                    </label>
                    {editing ? (
                      <textarea
                        className={`ta${errors.description ? " bad" : ""}`}
                        rows={3}
                        value={values.description}
                        onChange={(e) => set("description", e.target.value)}
                        placeholder="Untuk apa dana ini direncanakan…"
                      />
                    ) : (
                      <div className="ro">{budget!.description}</div>
                    )}
                    <Foot error={errors.description} />
                  </div>
                </div>
              </div>

              {mode !== "new" && (
                <div className="fsec">
                  <div className="sec-t">Klasifikasi (ditetapkan approver)</div>
                  <div className="frow">
                    <div className="fld">
                      <label>Budget Category</label>
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
                      <div className="help">
                        Menentukan Account tujuan saat Journal dibuat otomatis.
                      </div>
                    </div>
                    <div className="fld">
                      <label>Partner</label>
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
                            {category
                              ? "Tidak diperlukan"
                              : "Belum ditetapkan"}
                          </span>
                        )}
                      </div>
                      <div className="help">
                        Diisi hanya bila Budget Category mensyaratkan subjek.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {mode === "view" && realizations && (
            <RealizationCard
              realizations={realizations}
              currencyLabel={currencyOf(refs, budget!.currency_id)}
            />
          )}
        </div>

        <div>
          <div className="card side">
            <div className="card-h">
              <span className="ci">
                <Icon name="file" size={15} />
              </span>
              <div className="ct">
                <h3>Ringkasan</h3>
              </div>
            </div>
            <div className="card-b">
              <div style={{ padding: "5px 0" }}>
                {mode === "new" ? (
                  <>
                    <div className="mrow">
                      <span className="k">Nomor</span>
                      <span className="v">
                        <span className="dash">dibuat otomatis</span>
                      </span>
                    </div>
                    <div className="mrow">
                      <span className="k">Status</span>
                      <span className="v">Akan tersimpan sebagai Draft</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mrow">
                      <span className="k">Nomor</span>
                      <span className="v mono">{budget!.budget_no}</span>
                    </div>
                    <div className="mrow">
                      <span className="k">Status</span>
                      <span className="v">
                        <span
                          className={`bdg ${STATUS_CLASS[budget!.status] ?? "s-mute"}`}
                        >
                          {STATUS_TEXT[budget!.status] ?? budget!.status}
                        </span>
                      </span>
                    </div>
                    <div className="mrow">
                      <span className="k">Budget Month</span>
                      <span className="v">
                        {month ? (
                          <Link href={`/budget/budget/month/${month.id}`}>
                            {month.name}
                          </Link>
                        ) : (
                          <span className="dash">
                            Di luar Fiscal Period mana pun
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mrow">
                      <span className="k">Dibuat</span>
                      <span className="v">
                        {formatTimestamp(budget!.created_at)}
                        <small>{createdByEmail ?? "sistem@siba.app"}</small>
                      </span>
                    </div>
                    <div className="mrow">
                      <span className="k">Diubah</span>
                      <span className="v">
                        {budget!.updated_by ? (
                          <>
                            {formatTimestamp(budget!.updated_at)}
                            <small>{updatedByEmail ?? ""}</small>
                          </>
                        ) : (
                          <span className="dash">Belum pernah diubah</span>
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
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

function Foot({ error, help }: { error?: string; help?: string }) {
  if (error) {
    return (
      <div className="err">
        <Icon name="warn" size={11} />
        {error}
      </div>
    );
  }
  return help ? <div className="help">{help}</div> : null;
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
