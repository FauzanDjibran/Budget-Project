"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { formatDate, formatMoney } from "@/lib/format";
import type {
  BudgetMapping,
  BudgetRefs,
  BudgetRow,
} from "@/lib/siba/budget";
import { BUDGET_TYPE_TEXT } from "@/lib/siba/budget-workflow";

/**
 * Approval is the one transition that also writes data: the approver assigns
 * the Budget Category and, where the category takes a subject, the Partner.
 *
 * Both pickers narrow themselves from `rules.ts` — categories to those valid
 * for the budget's direction, partners to the budget's Company and to the
 * partner categories that category admits. None of that narrowing is the
 * enforcement: `checkClassification` on the server re-checks the whole chain.
 * This dialog exists so an approver is not guessing.
 */
export function ApproveDialog({
  budget,
  refs,
  mappings,
  errors,
  busy,
  onConfirm,
  onCancel,
}: {
  budget: BudgetRow;
  refs: BudgetRefs;
  mappings: BudgetMapping[];
  errors: Record<string, string>;
  busy: boolean;
  onConfirm: (categoryId: string | null, partnerId: string | null) => void;
  onCancel: () => void;
}) {
  const [categoryId, setCategoryId] = useState(
    budget.category_id ? String(budget.category_id) : ""
  );
  const [partnerId, setPartnerId] = useState(
    budget.partner_id ? String(budget.partner_id) : ""
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  /** Direction follows balance-sheet logic — see BUDGET_CATEGORY_RULES. */
  const categories = useMemo(
    () => refs.categories.filter((c) => c.directions.includes(budget.budget_type)),
    [refs.categories, budget.budget_type]
  );

  const category = categories.find((c) => String(c.id) === categoryId) ?? null;
  const needsPartner = category?.needsPartner ?? false;

  const partners = useMemo(() => {
    if (!category || !needsPartner) return [];
    return refs.partners.filter(
      (p) =>
        p.companyId === budget.company_id &&
        p.active &&
        category.partnerCategories.includes(p.categoryLabel)
    );
  }, [refs.partners, category, needsPartner, budget.company_id]);

  const account = useMemo(() => {
    if (!category) return null;
    if (needsPartner && !partnerId) return null;
    const partner = refs.partners.find((p) => String(p.id) === partnerId);
    const partnerCategoryId = needsPartner ? partner?.categoryId ?? null : null;
    return (
      mappings.find(
        (m) =>
          m.companyId === budget.company_id &&
          m.budgetCategoryId === category.id &&
          m.partnerCategoryId === partnerCategoryId
      ) ?? null
    );
  }, [mappings, category, needsPartner, partnerId, refs.partners, budget.company_id]);

  const company = refs.companies.find((c) => c.id === budget.company_id);
  const currency = refs.currencies.find((c) => c.id === budget.currency_id);
  const arah = BUDGET_TYPE_TEXT[budget.budget_type] ?? budget.budget_type;

  return (
    <div
      className="ovl"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        style={{ width: "min(620px, 100%)" }}
      >
        <div style={{ textAlign: "left" }}>
          <div
            style={{
              display: "flex",
              gap: 11,
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            <span
              className="mi"
              style={{
                margin: 0,
                width: 38,
                height: 38,
                background: "var(--ok-bg)",
                color: "var(--ok)",
              }}
            >
              <Icon name="thumb" size={18} />
            </span>
            <div>
              <h3 style={{ margin: 0, textAlign: "left" }}>Setujui Budget</h3>
              <p style={{ textAlign: "left", marginTop: 2 }}>
                Tetapkan klasifikasi agar budget siap direalisasikan
              </p>
            </div>
          </div>

          <div className="apsum">
            <div>
              <span>Nomor</span>
              <b>{budget.budget_no}</b>
            </div>
            <div>
              <span>Tanggal</span>
              <b>{formatDate(budget.budget_date)}</b>
            </div>
            <div>
              <span>Company</span>
              <b>{company ? `${company.label} - ${company.name}` : "—"}</b>
            </div>
            <div>
              <span>Tipe</span>
              <b>{arah}</b>
            </div>
            <div className="full">
              <span>Deskripsi</span>
              <b>{budget.description}</b>
            </div>
            <div className="full amt">
              <span>Nominal</span>
              <b>
                {formatMoney(budget.budget_amount, currency?.label ?? "IDR")}
              </b>
            </div>
          </div>

          {errors._form && (
            <div className="err" style={{ marginTop: 12 }}>
              <Icon name="warn" size={11} />
              {errors._form}
            </div>
          )}

          <div className="frow" style={{ padding: "14px 0 0", gap: "1px 16px" }}>
            <div className="fld">
              <label>
                Budget Category <span className="req">*</span>
              </label>
              <select
                className={`slc${errors.category_id ? " bad" : ""}`}
                value={categoryId}
                disabled={busy}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  // A category change invalidates any partner already chosen.
                  setPartnerId("");
                }}
              >
                <option value="">— pilih Category —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              {errors.category_id ? (
                <div className="err">
                  <Icon name="warn" size={11} />
                  {errors.category_id}
                </div>
              ) : (
                <div className="help">
                  Hanya Category yang sah untuk budget bertipe <b>{arah}</b> yang
                  ditampilkan.
                </div>
              )}
            </div>

            <div className="fld">
              <label>
                Partner {needsPartner && <span className="req">*</span>}
              </label>
              <select
                className={`slc${errors.partner_id ? " bad" : ""}`}
                value={partnerId}
                disabled={busy || !needsPartner}
                onChange={(e) => setPartnerId(e.target.value)}
              >
                <option value="">
                  {needsPartner
                    ? "— pilih Partner —"
                    : categoryId
                      ? "tidak diperlukan"
                      : "pilih Category dulu"}
                </option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} - {p.name} ({p.categoryLabel})
                  </option>
                ))}
              </select>
              {errors.partner_id ? (
                <div className="err">
                  <Icon name="warn" size={11} />
                  {errors.partner_id}
                </div>
              ) : (
                <div className="help">
                  {needsPartner ? (
                    <>
                      Category ini hanya menerima Partner berkategori{" "}
                      <b>{category!.partnerCategories.join(" / ")}</b>.
                    </>
                  ) : categoryId ? (
                    "Category yang dipilih tidak memakai Partner."
                  ) : (
                    "Kebutuhan Partner ditentukan oleh Budget Category."
                  )}
                </div>
              )}
            </div>
          </div>

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
                Account untuk Company tersebut.
              </div>
            )
          ) : null}

          <div className="mf">
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
                  <Icon name="thumb" size={14} /> Setujui Budget
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
