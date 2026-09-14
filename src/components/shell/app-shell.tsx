"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { logout } from "@/app/actions/auth";
import { type NavModule, resolvePath, entityHref } from "@/lib/siba/nav";

export type ShellCompany = { id: number; label: string; name: string };
export type ShellUser = {
  name: string;
  initials: string;
  email: string;
  roles: string[];
};

/**
 * `modules` arrives already filtered by the signed-in user's permissions (see
 * `visibleModules` in `lib/siba/nav.ts`). The shell renders what it is given
 * and decides nothing about access itself — the pages behind every link check
 * again on the server.
 */
export function AppShell({
  companies,
  user,
  modules,
  children,
}: {
  companies: ShellCompany[];
  user: ShellUser;
  modules: NavModule[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { module: activeModule, entity: activeEntity } = resolvePath(pathname);

  const [subOpen, setSubOpen] = useState(true);
  const [companyId, setCompanyId] = useState(0);
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!userRef.current?.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [userOpen]);

  // The submenu shows only the leaves this user may reach; a module whose
  // leaves are all hidden never reaches the rail in the first place.
  const visibleModule = modules.find((m) => m.key === activeModule?.key);
  const hasSub = Boolean(visibleModule?.groups?.length);
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

        <div className="uchip-wrap" ref={userRef}>
          <button
            className="uchip"
            onClick={() => setUserOpen((o) => !o)}
            title="Akun saya"
            aria-haspopup="menu"
            aria-expanded={userOpen}
          >
            <div className="avatar">{user.initials}</div>
            <b>{user.name}</b>
            <Icon name="down" size={12} />
          </button>

          {userOpen && (
            <div className="umenu" role="menu">
              <div className="umenu-h">
                <b>{user.name}</b>
                <span>{user.email}</span>
                <span className="umenu-roles">
                  {user.roles.length ? (
                    user.roles.map((r) => (
                      <span className="bdg t-slate" key={r}>
                        {r}
                      </span>
                    ))
                  ) : (
                    <span className="bdg s-mute">Tanpa Role</span>
                  )}
                </span>
              </div>
              <Link
                className="umenu-i"
                href="/settings/profile"
                onClick={() => setUserOpen(false)}
                role="menuitem"
              >
                <Icon name="user" size={14} /> Profil Saya
              </Link>
              <form action={logout}>
                <button className="umenu-i danger" type="submit" role="menuitem">
                  <Icon name="out" size={14} /> Keluar
                </button>
              </form>
            </div>
          )}
        </div>
      </header>

      <div className="body">
        <nav className="rail">
          <div className="rail-mid" style={{ paddingTop: 7 }}>
            {modules.map((m) => (
              <Link
                key={m.key}
                href={m.groups ? firstLeafHref(modules, m.key) : `/${m.key}`}
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
            {(visibleModule?.groups ?? []).map((g) => (
              <div className="grp" key={g.key}>
                <div className="grp-b on open">
                  <span className="dot" />
                  <span className="gt">{g.name}</span>
                </div>
                <div className="grp-i">
                  {g.entities.map((e) => (
                    <Link
                      key={e.key}
                      href={entityHref(visibleModule!.key, e.slug)}
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

/** Rail links land on a module's first visible leaf, not a bare module URL. */
function firstLeafHref(modules: NavModule[], moduleKey: string): string {
  const mod = modules.find((m) => m.key === moduleKey);
  const first = mod?.groups?.[0]?.entities[0];
  return first ? entityHref(moduleKey, first.slug) : `/${moduleKey}`;
}
