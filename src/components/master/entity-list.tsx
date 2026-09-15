"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toggleStatus } from "@/app/actions/master";
import {
  COMPANY_LOCK_BADGE,
  COMPANY_LOCK_BODY,
  isCompanyEntity,
} from "@/lib/siba/company";
import type { EntityAbilities } from "@/lib/siba/entity-access";
import {
  STATUS_CLASS,
  STATUS_TEXT,
  TAG_CLASS,
  createLabel,
  isActiveStatus,
  type Column,
  type Entity,
} from "@/lib/siba/entities";
import { moduleByKey } from "@/lib/siba/nav";
import { formatDate } from "@/lib/format";
import type { Company } from "@/lib/siba/company-access";
import type { RefOption, Row } from "@/lib/siba/records";
import { CompanyFilter, NoCompanyAccess } from "./company-filter";
import { recordTitle } from "@/lib/siba/record-title";

type Computed = Record<number, Record<string, string | number>>;

/**
 * `can` mirrors the caller's permissions so the toolbar and row actions only
 * offer what they may use. It is presentation, not protection: every action
 * behind these controls re-checks on the server.
 *
 * `refs` is keyed by field name, not by target table — two fields can point at
 * the same table and still carry different option sets.
 */
export function EntityList({
  entity,
  rows,
  refs,
  computed,
  can,
  companies,
  companyId,
}: {
  entity: Entity;
  rows: Row[];
  refs: Record<string, RefOption[]>;
  computed: Computed;
  can: EntityAbilities;
  /** Companies this user may choose between; empty for an unscoped entity. */
  companies: Company[];
  /** The Company being shown, or null when the user may see none. */
  companyId: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  /** Company has no write path at all — see `lib/siba/company.ts`. */
  const locked = isCompanyEntity(entity.slug);
  const canCreate = can.create && !locked;
  const canEdit = can.edit && !locked;
  const status = entity.statusModel;
  const rowIsActive = (row: Row) =>
    status ? isActiveStatus(status, row[status.field]) : true;
  /** Whether the toggle is offered depends on which way it would go. */
  const canToggle = (row: Row) =>
    Boolean(status?.toggle) && (rowIsActive(row) ? can.deactivate : can.activate);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [pendingToggle, setPendingToggle] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const refFor = useCallback(
    (column: Column): RefOption[] => refs[column.field] ?? [],
    [refs]
  );

  /** The text a column contributes to search, sorting and filtering. */
  const textOf = useCallback(
    (column: Column, row: Row): string => {
      if (column.computed) return String(computed[row.id]?.[column.field] ?? "");
      const raw = row[column.field];
      if (column.isRef) {
        const opt = refFor(column).find((o) => o.id === Number(raw));
        return opt ? `${opt.label} ${opt.name}` : "";
      }
      if (column.isDate) return formatDate(raw as string);
      if (column.isStatus || column.isBool) {
        return STATUS_TEXT[String(raw)] ?? String(raw ?? "");
      }
      return raw == null ? "" : String(raw);
    },
    [computed, refFor]
  );

  const filtered = useMemo(() => {
    let out = rows.slice();

    for (const [field, value] of Object.entries(filters)) {
      if (!value) continue;
      const column = entity.columns.find((c) => c.field === field);
      if (!column) continue;
      out = out.filter((row) => {
        if (column.filter === "text") {
          return String(row[field] ?? "").toLowerCase().includes(value.toLowerCase());
        }
        return String(row[field] ?? "") === value;
      });
    }

    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((row) =>
        entity.columns.some((c) => textOf(c, row).toLowerCase().includes(q))
      );
    }

    if (sort) {
      const column = entity.columns.find((c) => c.field === sort.field);
      if (column) {
        const dir = sort.dir === "asc" ? 1 : -1;
        out.sort((a, b) => {
          const av = column.numeric || column.computed ? computed[a.id]?.[column.field] : undefined;
          const bv = column.numeric || column.computed ? computed[b.id]?.[column.field] : undefined;
          if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
          if (column.numeric && !column.computed) {
            return (Number(a[column.field] ?? 0) - Number(b[column.field] ?? 0)) * dir;
          }
          if (column.isDate) {
            return String(a[column.field] ?? "").localeCompare(String(b[column.field] ?? "")) * dir;
          }
          return textOf(column, a).localeCompare(textOf(column, b), "id", { numeric: true }) * dir;
        });
      }
    }
    return out;
  }, [rows, filters, query, sort, entity, computed, textOf]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pages);
  const start = (current - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

  const activeFilters =
    Object.values(filters).filter(Boolean).length + (query ? 1 : 0);

  const clearAll = () => {
    setFilters({});
    setQuery("");
    setPage(1);
  };

  const cycleSort = (field: string) => {
    setSort((s) => {
      if (!s || s.field !== field) return { field, dir: "asc" };
      if (s.dir === "asc") return { field, dir: "desc" };
      return null;
    });
  };

  const identityOf = (row: Row) => recordTitle(entity, row, refs);

  const onToggleConfirmed = async () => {
    if (!pendingToggle) return;
    setBusy(true);
    const result = await toggleStatus(entity.slug, pendingToggle.id);
    setBusy(false);
    if (result.ok) {
      toast(
        "Status diperbarui",
        `${identityOf(pendingToggle)} sekarang ${result.active ? "aktif" : "nonaktif"}.`,
        "ok"
      );
      setPendingToggle(null);
      router.refresh();
    } else {
      toast("Gagal", result.message ?? "Status tidak dapat diubah.", "err");
      setPendingToggle(null);
    }
  };

  const renderCell = (column: Column, row: Row) => {
    if (column.computed) {
      const v = computed[row.id]?.[column.field];
      if (column.numeric && v === 0) return <span className="dash">0</span>;
      return <>{v ?? <span className="dash">—</span>}</>;
    }

    const value = row[column.field];

    if (column.isRef) {
      const opt = refFor(column).find((o) => o.id === Number(value));
      if (!opt) return <span className="dash">—</span>;
      return column.refLabelOnly ? (
        <span className="lab">{opt.label}</span>
      ) : (
        <span className="idc">
          <span className="lab">{opt.label}</span>
          <span className="nm">{opt.name}</span>
        </span>
      );
    }

    if (column.isStatus || column.isBool) {
      const s = String(value);
      return <span className={`bdg ${STATUS_CLASS[s] ?? "s-mute"}`}>{STATUS_TEXT[s] ?? s}</span>;
    }

    if (column.isTag) {
      const s = String(value);
      return <span className={`bdg ${TAG_CLASS[s] ?? "t-slate"}`}>{s}</span>;
    }

    if (column.isDate) {
      return value ? <>{formatDate(value as string)}</> : <span className="dash">—</span>;
    }

    if (column.isLabel) {
      return value ? <span className="lab">{String(value)}</span> : <span className="dash">—</span>;
    }

    if (value === null || value === undefined || value === "") {
      return <span className="dash">—</span>;
    }

    return column.truncate ? (
      <span className="trunc">{String(value)}</span>
    ) : (
      <>{String(value)}</>
    );
  };

  const basePath = `/${entity.module}/${entity.slug}`;
  const moduleName = moduleByKey(entity.module)?.name ?? entity.module;
  const pendingActive = pendingToggle ? rowIsActive(pendingToggle) : false;

  const head = (
    <tr>
      <th style={{ width: 38 }}>No</th>
      {entity.columns.map((c) => (
        <th
          key={c.field}
          className={`srt${sort?.field === c.field ? " act" : ""}${c.numeric ? " num" : ""}`}
          style={c.width ? { width: c.width } : undefined}
          onClick={() => cycleSort(c.field)}
          title={`Urutkan ${c.label}`}
        >
          {c.label}
          <span className="ar">
            {sort?.field === c.field ? (sort.dir === "asc" ? "▲" : "▼") : "▲"}
          </span>
        </th>
      ))}
      <th style={{ width: 88 }} />
    </tr>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <Link href="/dashboard">{moduleName}</Link>
          <span>/</span>
          <span className="cur">{entity.name}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={entity.icon} size={16} />
            </span>
            {entity.name}
          </h1>
          <div className="ph-act">
            {locked ? (
              <span className="bdg s-mute" title={COMPANY_LOCK_BODY}>
                <Icon name="lock" size={11} /> {COMPANY_LOCK_BADGE}
              </span>
            ) : canCreate ? (
              <Link className="btn primary" href={`${basePath}/new`}>
                <Icon name="plus" size={15} /> {createLabel(entity)}
              </Link>
            ) : null}
          </div>
        </div>
        <p className="ph-sub">{entity.desc}</p>
        {locked && <p className="ph-sub">{COMPANY_LOCK_BODY}</p>}
      </div>

      {/* A scoped entity with no Company open to this user has nothing to
          filter or search, so the card carries the refusal alone rather than
          an empty table that would read as "no data yet". */}
      {entity.scope && companyId == null ? (
        <div className="card">
          <NoCompanyAccess what={entity.name} />
        </div>
      ) : (
      <div className="card">
        <div className="toolbar">
          {companyId != null && (
            <CompanyFilter options={companies} selectedId={companyId} />
          )}
          <SearchField
            value={query}
            placeholder={`Cari di ${entity.name}…`}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
          />

          {status && (
            <Select
              variant="compact"
              value={filters[status.field] ?? ""}
              set={Boolean(filters[status.field])}
              ariaLabel="Filter status"
              options={[
                { value: "", label: "Semua status" },
                ...status.options.map((o) => ({
                  value: o,
                  label: STATUS_TEXT[o] ?? o,
                })),
              ]}
              onChange={(v) => {
                setFilters((f) => ({ ...f, [status.field]: v }));
                setPage(1);
              }}
            />
          )}

          {activeFilters > 0 && (
            <button className="btn sm ghost" onClick={clearAll}>
              Bersihkan filter ({activeFilters})
            </button>
          )}

          <div className="tspace" />
          <span className="count">
            <b>{filtered.length}</b> dari {rows.length} data
          </span>
        </div>

        {pageRows.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>{head}</thead>
                <tbody>
                  {pageRows.map((row, i) => (
                    <tr key={row.id} onClick={() => router.push(`${basePath}/${row.id}`)}>
                      <td className="no">{start + i + 1}</td>
                      {entity.columns.map((c) => (
                        <td
                          key={c.field}
                          className={[
                            c.primary ? "pri" : "",
                            c.muted ? "mut" : "",
                            c.numeric ? "num" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {renderCell(c, row)}
                        </td>
                      ))}
                      <td className="acts">
                        <span className="ract">
                          <button
                            className="iact"
                            title="Lihat detail"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`${basePath}/${row.id}`);
                            }}
                          >
                            <Icon name="eye" size={15} />
                          </button>
                          {canEdit && (
                            <button
                              className="iact"
                              title="Ubah"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`${basePath}/${row.id}/edit`);
                              }}
                            >
                              <Icon name="pen" size={15} />
                            </button>
                          )}
                          {canToggle(row) && (
                            <button
                              className="iact"
                              title={rowIsActive(row) ? "Nonaktifkan" : "Aktifkan"}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingToggle(row);
                              }}
                            >
                              <Icon name="gear" size={15} />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pager">
              <span className="inf">
                Halaman <b>{current}</b> dari <b>{pages}</b> ({filtered.length} total)
              </span>
              <Select
                variant="compact"
                value={String(perPage)}
                ariaLabel="Baris per halaman"
                options={[10, 25, 50, 100].map((n) => ({
                  value: String(n),
                  label: `Tampil ${n}`,
                }))}
                onChange={(v) => {
                  setPerPage(Number(v));
                  setPage(1);
                }}
              />
              <div className="pgs">
                <button className="pg" disabled={current <= 1} onClick={() => setPage(1)}>
                  «
                </button>
                <button className="pg" disabled={current <= 1} onClick={() => setPage(current - 1)}>
                  ‹
                </button>
                {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    className={`pg${p === current ? " on" : ""}`}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                ))}
                <button
                  className="pg"
                  disabled={current >= pages}
                  onClick={() => setPage(current + 1)}
                >
                  ›
                </button>
                <button className="pg" disabled={current >= pages} onClick={() => setPage(pages)}>
                  »
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="tw">
              <table className="grid">
                <thead>{head}</thead>
              </table>
            </div>
            <div className="empty">
              <div className="ic">
                <Icon name={rows.length ? "srch" : entity.icon} size={20} />
              </div>
              <h4>
                {rows.length ? "Tidak ada data yang cocok" : `Belum ada ${entity.name}`}
              </h4>
              <p>
                {rows.length
                  ? "Ubah kata kunci atau bersihkan filter yang sedang aktif."
                  : locked
                    ? COMPANY_LOCK_BODY
                    : `Data akan muncul di sini setelah ${entity.single ?? entity.name} pertama dibuat.`}
              </p>
              {/* A CTA only when the user can actually act on it. */}
              {(rows.length > 0 || canCreate) && (
                <div className="cta">
                  {rows.length ? (
                    <button className="btn" onClick={clearAll}>
                      Bersihkan filter
                    </button>
                  ) : (
                    <Link className="btn primary" href={`${basePath}/new`}>
                      <Icon name="plus" size={15} /> {createLabel(entity)}
                    </Link>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingToggle)}
        icon={pendingActive ? "warn" : "check"}
        tone={pendingActive ? "danger" : "ok"}
        title={`Konfirmasi ${pendingActive ? "Nonaktifkan" : "Aktifkan"} Data`}
        subject={pendingToggle ? identityOf(pendingToggle) : undefined}
        body={
          pendingActive
            ? "Data yang nonaktif tidak akan muncul lagi sebagai pilihan pada transaksi baru. Seluruh history dan referensi yang sudah ada tetap utuh."
            : "Data akan kembali tersedia sebagai pilihan pada transaksi baru."
        }
        confirmLabel={`Ya, ${pendingActive ? "Nonaktifkan" : "Aktifkan"}`}
        confirmTone={pendingActive ? "solid-danger" : "primary"}
        busy={busy}
        onConfirm={onToggleConfirmed}
        onCancel={() => setPendingToggle(null)}
      />
    </>
  );
}
