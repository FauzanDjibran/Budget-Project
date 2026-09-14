"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { MODULES, resolvePath, entityHref } from "@/lib/siba/nav";

export type ShellCompany = { id: number; label: string; name: string };
export type ShellUser = { name: string; initials: string };

export function AppShell({
  companies,
  user,
  children,
}: {
  companies: ShellCompany[];
  user: ShellUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { module: activeModule, entity: activeEntity } = resolvePath(pathname);

  const [subOpen, setSubOpen] = useState(true);
  const [companyId, setCompanyId] = useState(0);

  // The dashboard is a single page, so the submenu panel has nothing to show.
  const hasSub = Boolean(activeModule?.groups?.length);
  const showSub = hasSub && subOpen;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S3</div>
          <div className="brand-txt">SIBA</div>
          <span className="brand-ver">3.0</span>
        </div>

        <div className="tb-div" />

        <div className="ctx">
          <span>Company</span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(Number(e.target.value))}
            title="Konteks Company"
          >
            <option value={0}>Semua Company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} - {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="tb-spacer" />

        <div className="uchip">
          <div className="avatar">{user.initials}</div>
          <b>{user.name}</b>
        </div>
      </header>

      <div className="body">
        <nav className="rail">
          <div className="rail-mid" style={{ paddingTop: 7 }}>
            {MODULES.map((m) => (
              <Link
                key={m.key}
                href={m.groups ? firstLeafHref(m.key) : `/${m.key}`}
                className={`ri${activeModule?.key === m.key ? " on" : ""}`}
              >
                <Icon name={m.icon} size={18} />
                <span className="ri-tip">{m.name}</span>
              </Link>
            ))}
          </div>
        </nav>

        <nav className="sub" style={showSub ? undefined : { width: 0, borderWidth: 0, opacity: 0, pointerEvents: "none" }}>
          <div className="sub-h">
            <div className="t">
              <h2>{activeModule?.name ?? ""}</h2>
              <p>{activeModule?.desc ?? ""}</p>
            </div>
            <button
              className="collapse"
              onClick={() => setSubOpen(false)}
              title="Sembunyikan menu"
            >
              <Icon name="back" size={13} />
            </button>
          </div>

          <div className="sub-l">
            {(activeModule?.groups ?? []).map((g) => (
              <div className="grp" key={g.key}>
                <div className="grp-b on open">
                  <span className="dot" />
                  <span className="gt">{g.name}</span>
                </div>
                <div className="grp-i">
                  {g.entities.map((e) => (
                    <Link
                      key={e.key}
                      href={entityHref(activeModule!.key, e.slug)}
                      className={`leaf${activeEntity?.key === e.key ? " on" : ""}`}
                    >
                      <span className="lt">{e.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <main className="content">
          {hasSub && !subOpen && (
            <button
              className="reopen"
              style={{ display: "grid" }}
              onClick={() => setSubOpen(true)}
              title="Tampilkan menu"
            >
              <Icon name="chev" size={13} />
            </button>
          )}
          <div className="pad">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** Rail links land on a module's first leaf rather than a bare module URL. */
function firstLeafHref(moduleKey: string): string {
  const mod = MODULES.find((m) => m.key === moduleKey);
  const first = mod?.groups?.[0]?.entities[0];
  return first ? entityHref(moduleKey, first.slug) : `/${moduleKey}`;
}
