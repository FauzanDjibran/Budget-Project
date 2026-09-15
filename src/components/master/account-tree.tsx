"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Select } from "@/components/ui/select";
import type { EntityAbilities } from "@/lib/siba/entity-access";
import { TAG_CLASS, createLabel, type Entity } from "@/lib/siba/entities";
import { moduleByKey } from "@/lib/siba/nav";
import type { TreeAccount, TreeCategory, TreeCompany } from "@/lib/siba/records";

/**
 * Chart of Accounts renders as a tree rather than a table — it is the one
 * registry entity whose *list* the generic table cannot express, because the
 * shape of the bagan akun is the information.
 *
 * Category and kelompok rows are seeded structure, not accounts: only numbered
 * rows can carry a Journal Line. Detail, create and edit stay generic.
 *
 * The tree shows **one Company's** chart at a time. Each Company numbers its
 * own chart independently, so the induk's `1.1.4.1` and the anak's are
 * different accounts that happen to share a number — listing both together
 * reads as duplicated rows rather than as two books.
 */
export function AccountTree({
  entity,
  companies,
  categories,
  accounts,
  can,
}: {
  entity: Entity;
  companies: TreeCompany[];
  categories: TreeCategory[];
  accounts: TreeAccount[];
  can: EntityAbilities;
}) {
  const router = useRouter();
  const basePath = `/${entity.module}/${entity.slug}`;
  const moduleName = moduleByKey(entity.module)?.name ?? entity.module;

  const [companyId, setCompanyId] = useState(companies[0]?.id ?? 0);
  const [query, setQuery] = useState("");
  /** Collapsed keys. Every branch starts open. */
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const company = companies.find((c) => c.id === companyId) ?? null;
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  /** One Company's chart. Everything below works on this set alone. */
  const owned = useMemo(
    () => accounts.filter((a) => a.companyId === companyId),
    [accounts, companyId]
  );

  const childrenOf = useMemo(() => {
    const map = new Map<number, TreeAccount[]>();
    for (const a of owned) {
      if (a.parentId == null) continue;
      const list = map.get(a.parentId) ?? [];
      list.push(a);
      map.set(a.parentId, list);
    }
    return map;
  }, [owned]);

  /**
   * Accounts matching the search, plus every ancestor needed to reach them —
   * a hit two levels down must still be reachable from its root.
   */
  const matched = useMemo(() => {
    if (!searching) return null;
    const byId = new Map(owned.map((a) => [a.id, a]));
    const keep = new Set<number>();
    for (const a of owned) {
      if (
        !a.label.toLowerCase().includes(q) &&
        !a.name.toLowerCase().includes(q)
      ) {
        continue;
      }
      keep.add(a.id);
      let parent = a.parentId;
      while (parent != null && !keep.has(parent)) {
        keep.add(parent);
        parent = byId.get(parent)?.parentId ?? null;
      }
    }
    return keep;
  }, [owned, q, searching]);

  const visibleAccounts = matched
    ? owned.filter((a) => matched.has(a.id))
    : owned;

  const isOpen = (key: string) => searching || !closed.has(key);
  const toggle = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setAll = (open: boolean) => {
    if (open) {
      setClosed(new Set());
      return;
    }
    const all = new Set<string>();
    for (const c of categories) {
      all.add(`c${c.id}`);
      for (const s of c.subcategories) all.add(`s${s.id}`);
    }
    for (const a of owned) all.add(`a${a.id}`);
    setClosed(all);
  };

  const renderAccount = (account: TreeAccount) => {
    const kids = (childrenOf.get(account.id) ?? []).filter(
      (k) => !matched || matched.has(k.id)
    );
    const key = `a${account.id}`;
    const open = isOpen(key);

    return (
      <div key={account.id}>
        <div
          className={`tn k-acc${account.isActive ? "" : " off"}`}
          onClick={() => router.push(`${basePath}/${account.id}`)}
        >
          <span className="tw5">
            {kids.length ? (
              <button
                className="tgl"
                title={open ? "Tutup" : "Buka"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(key);
                }}
              >
                <span className={`chev${open ? " o" : ""}`}>
                  <Icon name="chev" size={12} />
                </span>
              </button>
            ) : (
              <span className="tdot" />
            )}
          </span>
          <span className="lab">{account.label}</span>
          <span className="tname">{account.name}</span>
          <span className="tright">
            {kids.length > 0 && <span className="tcount">{kids.length} turunan</span>}
            <span className={`bdg ${TAG_CLASS[account.normalBalance] ?? "t-slate"}`}>
              {account.normalBalance}
            </span>
            {!account.isPostable && (
              <span className="flag f-h" title="Account header, tidak menerima Journal Line">
                H
              </span>
            )}
            {account.requirePartner && (
              <span
                className="pcflag"
                title={`Subledger per Partner berkategori ${
                  account.partnerCategoryLabel ?? "?"
                }`}
              >
                {account.partnerCategoryLabel ?? "Partner"}
              </span>
            )}
            {account.isControlAccount && (
              <span className="flag f-c" title="Control account">
                C
              </span>
            )}
            {!account.isActive && <span className="bdg s-bad">Non Aktif</span>}
            <span className="tacts">
              <button
                className="iact"
                title="Lihat detail"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`${basePath}/${account.id}`);
                }}
              >
                <Icon name="eye" size={14} />
              </button>
              {can.edit && (
                <button
                  className="iact"
                  title="Ubah"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`${basePath}/${account.id}/edit`);
                  }}
                >
                  <Icon name="pen" size={14} />
                </button>
              )}
            </span>
          </span>
        </div>
        {kids.length > 0 && open && (
          <div className="tkids">{kids.map(renderAccount)}</div>
        )}
      </div>
    );
  };

  const body = categories
    .map((category) => {
      const subs = category.subcategories
        .map((sub) => {
          const all = visibleAccounts.filter((a) => a.subcategoryId === sub.id);
          if (searching && all.length === 0) return null;
          const roots = all.filter(
            (a) => a.parentId == null || !all.some((x) => x.id === a.parentId)
          );
          const key = `s${sub.id}`;
          const open = isOpen(key);
          return (
            <div className="tgrp" key={sub.id}>
              <div className="tn k-sub" onClick={() => toggle(key)}>
                <span className="tw5">
                  <span className={`chev${open ? " o" : ""}`}>
                    <Icon name="chev" size={12} />
                  </span>
                </span>
                <span className="lab">{sub.label}</span>
                <span className="tname">{sub.name}</span>
                <span className="tright">
                  <span className="tcount">{all.length} account</span>
                </span>
              </div>
              {open && (
                <div className="tkids">
                  {roots.length ? (
                    roots.map(renderAccount)
                  ) : (
                    <div className="tempty">Belum ada account pada kelompok ini.</div>
                  )}
                </div>
              )}
            </div>
          );
        })
        .filter(Boolean);

      if (searching && subs.length === 0) return null;

      const count = visibleAccounts.filter((a) =>
        category.subcategories.some((s) => s.id === a.subcategoryId)
      ).length;
      const key = `c${category.id}`;
      const open = isOpen(key);

      return (
        <div className="tgrp" key={category.id}>
          <div className="tn k-cat" onClick={() => toggle(key)}>
            <span className="tw5">
              <span className={`chev${open ? " o" : ""}`}>
                <Icon name="chev" size={12} />
              </span>
            </span>
            <span className="lab">{category.label}</span>
            <span className="tname">{category.name}</span>
            <span className="tright">
              <span className="bdg t-slate">
                {category.typeLabel} {category.typeName}
              </span>
              <span className="tcount">{count} account</span>
            </span>
          </div>
          {open && <div className="tkids">{subs}</div>}
        </div>
      );
    })
    .filter(Boolean);

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
            <button className="btn sm" onClick={() => setAll(true)}>
              <Icon name="expand" size={13} /> Buka Semua
            </button>
            <button className="btn sm" onClick={() => setAll(false)}>
              <Icon name="collapse" size={13} /> Tutup Semua
            </button>
            {can.create && (
              <Link className="btn primary" href={`${basePath}/new`}>
                <Icon name="plus" size={15} /> {createLabel(entity)}
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">{entity.desc}</p>
      </div>

      <div className="card">
        <div className="toolbar">
          {companies.length > 1 && (
            <Select
              variant="toolbar"
              value={String(companyId)}
              onChange={(v) => setCompanyId(Number(v))}
              title="Company pemilik bagan akun"
              ariaLabel="Company"
              options={companies.map((c) => ({
                value: String(c.id),
                label: `${c.label} - ${c.name}`,
              }))}
            />
          )}
          <div
            className={`srch${query ? " has" : ""}`}
            style={{ maxWidth: "none", flex: "1 1 auto" }}
          >
            <Icon name="srch" size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nomor account, nama account, atau kelompok…"
              autoComplete="off"
            />
            <button className="x" onClick={() => setQuery("")} aria-label="Bersihkan">
              <Icon name="block" size={13} />
            </button>
          </div>
          <span className="count">
            <b>{visibleAccounts.length}</b> account
          </span>
        </div>

        <div
          className="card-h"
          style={{ borderTop: 0, borderBottom: "1px solid var(--line-2)" }}
        >
          <span className="ci">
            <Icon name="tree" size={15} />
          </span>
          <div className="ct">
            <h3>
              Struktur Bagan Akun
              {company && <span className="lab">{company.label}</span>}
            </h3>
            <p>
              Bagan akun per Company. Nomor melanjutkan induknya; kategori dan
              kelompok adalah struktur, bukan account.
            </p>
          </div>
          <span className="hint">Klik baris account untuk membuka detail</span>
        </div>

        {body.length ? (
          <div className="tree">{body}</div>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name="srch" size={20} />
            </div>
            <h4>Tidak ada yang cocok</h4>
            <p>
              Tidak ada account atau kelompok pada {company?.label ?? "Company ini"}{" "}
              yang mengandung kata kunci tersebut.
            </p>
            <div className="cta">
              <button className="btn" onClick={() => setQuery("")}>
                Bersihkan pencarian
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
