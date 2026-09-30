"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { DocumentHeader } from "@/components/ui/document-header";
import { SearchField } from "@/components/ui/search-field";
import { Pager, usePaging } from "@/components/ui/pager";
import { SelectAll, SelectionCount, useSelection } from "@/components/ui/selection";
import { useToast } from "@/components/ui/toast";
import { classifyBudgets } from "@/app/actions/budget";
import { formatDate, formatMoney } from "@/lib/format";
import type {
  BudgetMapping,
  BudgetRefs,
  BudgetRow,
  ClassificationHint,
} from "@/lib/siba/budget";
import { BUDGET_TYPE_TEXT } from "@/lib/siba/budget-workflow";
import { ClassifyDialog } from "./classify-dialog";

/**
 * Klasifikasi Budget — the classifier's workstation.
 *
 * Every row is an approved Budget waiting for its Budget Category and
 * Partner; classifying one takes it off the list, so the ideal state of this
 * screen is empty. Rows are grouped by Company · Arah · Currency, because the
 * first two decide which Categories and Partners may be chosen: a selection
 * inside one Company and one direction can take one classification, and the
 * group's own checkbox selects exactly such a set.
 *
 * A hint names how the most similar Budget was classified before. It is
 * shown, never prefilled — which Category a plan belongs to is a decision.
 *
 * All-or-nothing, like every bulk action: `classifyBudgets` checks every
 * Budget on its own and refuses the batch by the one that does not fit.
 */
export function ClassificationQueue({
  budgets,
  hints,
  refs,
  mappings,
}: {
  budgets: BudgetRow[];
  hints: Record<number, ClassificationHint>;
  refs: BudgetRefs;
  mappings: BudgetMapping[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [classifying, setClassifying] = useState<number[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const companyOf = (id: number) => refs.companies.find((c) => c.id === id) ?? null;
  const currencyOf = (id: number) =>
    refs.currencies.find((c) => c.id === id)?.label ?? "IDR";
  const categoryOf = (id: number) => refs.categories.find((c) => c.id === id) ?? null;
  const partnerOf = (id: number | null) =>
    id == null ? null : refs.partners.find((p) => p.id === id) ?? null;

  const groupKey = (b: BudgetRow) => `${b.company_id}|${b.budget_type}|${b.currency_id}`;

  // Grouped first, oldest first inside a group: the list is read one group
  // at a time, and a group's rows must sit together on the page.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = q
      ? budgets.filter((b) =>
          [b.budget_no, b.description, formatDate(b.budget_date)]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
      : budgets.slice();
    return out.sort(
      (a, b) =>
        a.company_id - b.company_id ||
        a.budget_type.localeCompare(b.budget_type) ||
        a.currency_id - b.currency_id ||
        a.budget_date.localeCompare(b.budget_date) ||
        a.id - b.id
    );
  }, [budgets, query]);

  const paging = usePaging(filtered, query);
  const selectable = useMemo(() => filtered.map((b) => b.id), [filtered]);
  const selection = useSelection(selectable);

  const selected = budgets.filter((b) => selection.ids.includes(b.id));
  // One classification fits a selection only inside one Company and one
  // direction; currency does not enter into it.
  const fits =
    selected.length > 0 &&
    selected.every(
      (b) =>
        b.company_id === selected[0].company_id &&
        b.budget_type === selected[0].budget_type
    );

  const groupIds = (key: string) =>
    filtered.filter((b) => groupKey(b) === key).map((b) => b.id);

  const run = async (categoryId: string | null, partnerId: string | null) => {
    if (!classifying) return;
    setBusy(true);
    const result = await classifyBudgets(classifying, {
      category_id: categoryId,
      partner_id: partnerId,
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const one = budgets.find((b) => b.id === classifying[0]);
    toast(
      result.message,
      result.count === 1 && one ? `${one.budget_no} · ${one.description}` : `${result.count} Budget`,
      "ok"
    );
    setClassifying(null);
    setErrors({});
    selection.clear();
    router.refresh();
  };

  const dialogRows = classifying
    ? budgets.filter((b) => classifying.includes(b.id))
    : [];

  return (
    <>
      <DocumentHeader
        module="Budget"
        icon="tags"
        title="Klasifikasi Budget"
        sub="Budget yang sudah disetujui dan menunggu Budget Category serta Partner. Setelah diklasifikasi, Budget keluar dari daftar ini dan siap direalisasikan."
      >
        {selection.ids.length > 0 && (
          <>
            <SelectionCount count={selection.ids.length} onClear={selection.clear} />
            {fits ? (
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => setClassifying(selection.ids)}
              >
                <Icon name="tags" size={15} /> Tetapkan Klasifikasi
              </button>
            ) : (
              <span className="lockchip">
                <Icon name="lock" size={13} /> Pilih Budget dengan Company dan Arah yang sama
              </span>
            )}
          </>
        )}
      </DocumentHeader>

      <div className="card">
        <div className="toolbar">
          <SearchField
            value={query}
            placeholder="Cari nomor atau deskripsi budget…"
            onChange={setQuery}
          />
          <div className="tspace" />
          <span className="count">
            <b>{filtered.length}</b> budget menunggu
          </span>
        </div>

        {filtered.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th className="selchk">
                      <SelectAll
                        many={paging.pageRows.map((b) => b.id)}
                        has={selection.has}
                        onToggle={() =>
                          selection.toggleMany(paging.pageRows.map((b) => b.id))
                        }
                      />
                    </th>
                    <th style={{ width: 38 }}>No</th>
                    <th style={{ width: 100 }}>Nomor</th>
                    <th style={{ width: 104 }}>Tanggal</th>
                    <th>Deskripsi</th>
                    <th style={{ width: 260 }}>Klasifikasi Serupa</th>
                    <th className="num" style={{ width: 170 }}>
                      Nominal
                    </th>
                    <th style={{ width: 88 }} />
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((b, i) => {
                    const key = groupKey(b);
                    const head = i === 0 || groupKey(paging.pageRows[i - 1]) !== key;
                    const ids = head ? groupIds(key) : [];
                    const hint = hints[b.id];
                    const hintCategory = hint ? categoryOf(hint.categoryId) : null;
                    const hintPartner = hint ? partnerOf(hint.partnerId) : null;
                    const on = selection.has(b.id);
                    const company = companyOf(b.company_id);
                    return [
                      head && (
                        <tr key={`g-${key}`} className="qgrp">
                          <td className="selchk">
                            <SelectAll
                              many={ids}
                              has={selection.has}
                              label="Pilih semua di kelompok ini"
                              onToggle={() => selection.toggleMany(ids)}
                            />
                          </td>
                          <td colSpan={7}>
                            {company?.label ?? "—"} · {BUDGET_TYPE_TEXT[b.budget_type]} ·{" "}
                            {currencyOf(b.currency_id)}
                            <span className="mut">{ids.length} budget</span>
                          </td>
                        </tr>
                      ),
                      <tr
                        key={b.id}
                        className={on ? "sel" : undefined}
                        onClick={() => selection.toggle(b.id)}
                      >
                        <td className="selchk" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Pilih ${b.budget_no}`}
                            checked={on}
                            onChange={() => selection.toggle(b.id)}
                          />
                        </td>
                        <td className="no">{paging.start + i + 1}</td>
                        <td>
                          <Link
                            href={`/budget/budget/${b.id}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="lab">{b.budget_no}</span>
                          </Link>
                        </td>
                        <td>{formatDate(b.budget_date)}</td>
                        <td className="pri">{b.description}</td>
                        <td>
                          {hintCategory ? (
                            <span className="dstack">
                              <span className="d1">
                                <span className="lab">{hintCategory.label}</span>
                                {hintPartner && <> {hintPartner.name}</>}
                              </span>
                              <span className="d2">seperti {hint!.budgetNo}</span>
                            </span>
                          ) : (
                            <span className="dash">—</span>
                          )}
                        </td>
                        <td className="num">
                          <span className={`mny ${b.budget_type === "In" ? "in" : "out"}`}>
                            {b.budget_type === "In" ? "+ " : "− "}
                            {formatMoney(b.budget_amount, currencyOf(b.currency_id))}
                          </span>
                        </td>
                        <td className="acts">
                          <span className="ract">
                            <Link
                              className="iact"
                              href={`/budget/budget/${b.id}`}
                              title="Lihat detail"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Icon name="eye" size={15} />
                            </Link>
                            <button
                              className="iact"
                              title="Tetapkan Klasifikasi"
                              onClick={(e) => {
                                e.stopPropagation();
                                setClassifying([b.id]);
                              }}
                            >
                              <Icon name="tags" size={15} />
                            </button>
                          </span>
                        </td>
                      </tr>,
                    ];
                  })}
                </tbody>
              </table>
            </div>

            <Pager
              page={paging.page}
              pages={paging.pages}
              total={paging.total}
              perPage={paging.perPage}
              onPage={paging.setPage}
              onPerPage={paging.setPerPage}
            />
          </>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name={budgets.length ? "srch" : "check"} size={20} />
            </div>
            <h4>
              {budgets.length
                ? "Tidak ada budget yang cocok"
                : "Semua budget sudah diklasifikasi"}
            </h4>
            <p>
              {budgets.length
                ? "Ubah kata kunci pencarian."
                : "Budget yang disetujui di Pengajuan Budget akan muncul di sini untuk diberi Budget Category dan Partner."}
            </p>
          </div>
        )}
      </div>

      {classifying && dialogRows.length > 0 && (
        <ClassifyDialog
          budgets={dialogRows}
          refs={refs}
          mappings={mappings}
          hint={dialogRows.length === 1 ? hints[dialogRows[0].id] ?? null : null}
          errors={errors}
          busy={busy}
          onConfirm={run}
          onCancel={() => {
            setClassifying(null);
            setErrors({});
          }}
        />
      )}

      <p className="foot-note">
        Satu klasifikasi dapat ditetapkan untuk beberapa budget sekaligus bila Company dan
        Arahnya sama — semua diproses, atau tidak satu pun.
      </p>
    </>
  );
}
