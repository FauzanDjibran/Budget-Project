"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  createBudget,
  transitionBudget,
  updateBudget,
  type BudgetValues,
} from "@/app/actions/budget";
import { formatDate, formatMoney, formatTimestamp } from "@/lib/format";
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
import { ApproveDialog } from "./approve-dialog";

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
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";
  const exists = Boolean(budget);

  const [values, setValues] = useState<BudgetValues>(() => initialValues(budget));
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
            {mode === "view" && budget && (
              <>
                {can.edit && budgetIsEditable(budget.status) && (
                  <Link className="btn" href={`/budget/budget/${budget.id}/edit`}>
                    <Icon name="pen" size={15} /> Ubah
                  </Link>
                )}
                {actions.map((a) => {
                  const t = BUDGET_TRANSITIONS[a];
                  return (
                    <button
                      key={a}
                      className={`btn${t.danger ? " danger" : a === "approve" ? " primary" : ""}`}
                      disabled={busy}
                      onClick={() =>
                        a === "approve" ? setApproving(true) : setConfirm(a)
                      }
                    >
                      <Icon name={t.icon} size={15} /> {t.label}
                    </button>
                  );
                })}
              </>
            )}
            {editing && (
              <Link className="btn" href={backHref}>
                <Icon name="back" size={15} /> Batal
              </Link>
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
                      <input
                        type="date"
                        className={errors.budget_date ? "bad" : undefined}
                        value={values.budget_date}
                        onChange={(e) => set("budget_date", e.target.value)}
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
                      <select
                        className={`slc${errors.budget_type ? " bad" : ""}`}
                        value={values.budget_type}
                        onChange={(e) => set("budget_type", e.target.value)}
                      >
                        <option value="Out">Pengeluaran</option>
                        <option value="In">Penerimaan</option>
                      </select>
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
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        className={errors.budget_amount ? "bad" : undefined}
                        value={values.budget_amount}
                        onChange={(e) => set("budget_amount", e.target.value)}
                        placeholder="0"
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
                        sudah di-Post.
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
                        className={errors.description ? "bad" : undefined}
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

            {editing && dirty && (
              <div className="dirty">
                <span className="msg">
                  <span className="pulse" />
                  Ada perubahan yang belum disimpan
                </span>
                <Link className="btn sm" href={backHref}>
                  Batal
                </Link>
                <button className="btn primary sm" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={14} /> Simpan
                </button>
              </div>
            )}
          </div>
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
          tone={BUDGET_TRANSITIONS[confirm].danger ? "danger" : "brand"}
          title={BUDGET_TRANSITIONS[confirm].title}
          subject={`${budget.budget_no} – ${budget.description}`}
          body={BUDGET_TRANSITIONS[confirm].body}
          confirmLabel={BUDGET_TRANSITIONS[confirm].confirmLabel}
          confirmTone={
            BUDGET_TRANSITIONS[confirm].danger ? "solid-danger" : "primary"
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

function initialValues(budget: BudgetRow | null): BudgetValues {
  if (!budget) {
    return {
      budget_date: "",
      company_id: "",
      currency_id: "",
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
