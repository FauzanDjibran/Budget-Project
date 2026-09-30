"use client";

import { useMemo, useState } from "react";
import { Field, FormRow } from "@/components/ui/form";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney, formatTotals, sumByCurrency } from "@/lib/format";
import type {
  BudgetMapping,
  BudgetRefs,
  BudgetRow,
  ClassificationHint,
} from "@/lib/siba/budget";
import { BUDGET_TYPE_TEXT } from "@/lib/siba/budget-workflow";

/**
 * Tetapkan Klasifikasi — one Budget Category and Partner for every Budget in
 * the selection.
 *
 * The selection shares a Company and a direction, because both decide what
 * may be chosen: the categories valid for the direction, the Partners of the
 * Company. The caller guarantees it; the server re-checks every Budget on its
 * own through `checkClassification`, so a selection that somehow mixes them
 * is refused by name rather than half-classified.
 *
 * Both pickers narrow themselves from the classification catalogue. None of
 * that narrowing is the enforcement — this dialog exists so a classifier is
 * not guessing.
 */
export function ClassifyDialog({
  budgets,
  refs,
  mappings,
  hint,
  errors,
  busy,
  onConfirm,
  onCancel,
}: {
  budgets: BudgetRow[];
  refs: BudgetRefs;
  mappings: BudgetMapping[];
  /** How a similar Budget was classified before — shown, never prefilled. */
  hint?: ClassificationHint | null;
  errors: Record<string, string>;
  busy: boolean;
  onConfirm: (categoryId: string | null, partnerId: string | null) => void;
  onCancel: () => void;
}) {
  const [first] = budgets;
  const [categoryId, setCategoryId] = useState("");
  const [partnerId, setPartnerId] = useState("");

  const categories = useMemo(
    () =>
      refs.categories.filter(
        (c) => c.active && c.directions.includes(first.budget_type)
      ),
    [refs.categories, first.budget_type]
  );

  const category = categories.find((c) => String(c.id) === categoryId) ?? null;
  const needsPartner = category?.needsPartner ?? false;

  const partners = useMemo(() => {
    if (!category || !needsPartner) return [];
    return refs.partners.filter(
      (p) =>
        p.companyId === first.company_id &&
        p.active &&
        category.partnerCategories.includes(p.categoryLabel)
    );
  }, [refs.partners, category, needsPartner, first.company_id]);

  const account = useMemo(() => {
    if (!category) return null;
    if (needsPartner && !partnerId) return null;
    const partner = refs.partners.find((p) => String(p.id) === partnerId);
    const partnerCategoryId = needsPartner ? partner?.categoryId ?? null : null;
    return (
      mappings.find(
        (m) =>
          m.companyId === first.company_id &&
          m.budgetCategoryId === category.id &&
          m.partnerCategoryId === partnerCategoryId
      ) ?? null
    );
  }, [mappings, category, needsPartner, partnerId, refs.partners, first.company_id]);

  const company = refs.companies.find((c) => c.id === first.company_id);
  const currencyOf = (id: number) =>
    refs.currencies.find((c) => c.id === id)?.label ?? "IDR";
  const arah = BUDGET_TYPE_TEXT[first.budget_type] ?? first.budget_type;
  const one = budgets.length === 1;

  const hintCategory = hint
    ? refs.categories.find((c) => c.id === hint.categoryId) ?? null
    : null;
  const hintPartner = hint?.partnerId
    ? refs.partners.find((p) => p.id === hint.partnerId) ?? null
    : null;

  return (
    <Dialog
      open
      icon="tags"
      tone="ok"
      width={620}
      title="Tetapkan Klasifikasi"
      subtitle={
        one
          ? "Budget Category dan Partner menentukan buku dan Account realisasinya"
          : `Satu klasifikasi untuk ${budgets.length} Budget sekaligus`
      }
      onClose={() => {
        if (!busy) onCancel();
      }}
      foot={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            Batal
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              onConfirm(categoryId || null, needsPartner ? partnerId || null : null)
            }
          >
            {busy ? (
              "Memproses…"
            ) : (
              <>
                <Icon name="tags" size={14} /> Tetapkan Klasifikasi
              </>
            )}
          </button>
        </>
      }
    >
      <div className="apsum">
        {one ? (
          <>
            <div>
              <span>Nomor</span>
              <b>{first.budget_no}</b>
            </div>
            <div>
              <span>Tanggal</span>
              <b>{formatDate(first.budget_date)}</b>
            </div>
          </>
        ) : (
          <div className="full">
            <span>Budget</span>
            <b>{budgets.map((b) => b.budget_no).join(", ")}</b>
          </div>
        )}
        <div>
          <span>Company</span>
          <b>{company ? `${company.label} - ${company.name}` : "—"}</b>
        </div>
        <div>
          <span>Tipe</span>
          <b>{arah}</b>
        </div>
        {one && (
          <div className="full">
            <span>Deskripsi</span>
            <b>{first.description}</b>
          </div>
        )}
        <div className="full amt">
          <span>Nominal</span>
          <b>
            {one
              ? formatMoney(first.budget_amount, currencyOf(first.currency_id))
              : formatTotals(
                  sumByCurrency(
                    budgets.map((b) => ({
                      currencyId: b.currency_id,
                      currencyLabel: currencyOf(b.currency_id),
                      amount: b.budget_amount,
                    }))
                  )
                )}
          </b>
        </div>
      </div>

      {hintCategory && (
        <div className="apmap">
          <Icon name="clock" size={13} /> Budget serupa ({hint!.budgetNo})
          diklasifikasikan sebagai{" "}
          <span className="lab">{hintCategory.label}</span>
          {hintPartner && (
            <>
              {" "}
              · <span className="lab">{hintPartner.label}</span> {hintPartner.name}
            </>
          )}
        </div>
      )}

      {errors._form && (
        <div className="err" style={{ marginTop: 12 }}>
          <Icon name="warn" size={11} />
          {errors._form}
        </div>
      )}

      <FormRow>
        <Field
          label="Budget Category"
          span={6}
          required
          help={`hanya Category yang sah untuk budget ${arah}`}
          error={errors.category_id}
        >
          <Select
            value={categoryId}
            invalid={Boolean(errors.category_id)}
            disabled={busy}
            placeholder="Pilih Category…"
            options={categories.map((c) => ({
              value: String(c.id),
              label: c.label,
              hint: c.name,
            }))}
            onChange={(v) => {
              setCategoryId(v);
              // A category change invalidates any partner already chosen.
              setPartnerId("");
            }}
          />
        </Field>

        <Field
          label="Partner"
          span={6}
          required={needsPartner}
          help={
            needsPartner
              ? `hanya kategori ${category!.partnerCategories.join(" / ")}`
              : categoryId
                ? "Category ini tidak memakai Partner"
                : "ditentukan oleh Budget Category"
          }
          error={errors.partner_id}
        >
          <Select
            value={partnerId}
            invalid={Boolean(errors.partner_id)}
            disabled={busy || (Boolean(categoryId) && !needsPartner)}
            waitingFor={categoryId ? null : "Pilih Budget Category dulu…"}
            placeholder={needsPartner ? "Pilih Partner…" : "Tidak diperlukan"}
            options={partners.map((p) => ({
              value: String(p.id),
              label: `${p.label} - ${p.name}`,
              hint: p.categoryLabel,
            }))}
            onChange={setPartnerId}
          />
        </Field>
      </FormRow>

      {account ? (
        <div className="apmap">
          <Icon name="link" size={13} /> Account tujuan:{" "}
          <span className="lab">{account.accountLabel}</span>{" "}
          {account.accountName}
        </div>
      ) : categoryId ? (
        needsPartner && !partnerId ? (
          <div className="apmap">
            <Icon name="link" size={13} /> Account tujuan ditentukan setelah
            Partner dipilih.
          </div>
        ) : (
          <div className="apmap warn">
            <Icon name="warn" size={13} /> Kombinasi ini belum dipetakan ke
            Account untuk Company tersebut. Klasifikasi tetap dapat
            ditetapkan, tetapi realisasinya baru dapat di-Post setelah
            pemetaan dibuat.
          </div>
        )
      ) : null}
    </Dialog>
  );
}
