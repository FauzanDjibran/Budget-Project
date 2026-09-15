"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { setUserStatusAction } from "@/app/actions/users";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type { UserRow } from "@/lib/siba/user-admin";

export type UserAbilities = {
  create: boolean;
  edit: boolean;
  activate: boolean;
  deactivate: boolean;
};

/**
 * The user register. Buttons follow the caller's permissions, but that is
 * presentation only — the actions behind them check again on the server, so
 * unhiding one in the browser changes nothing.
 */
export function UserList({
  users,
  currentUserId,
  can,
}: {
  users: UserRow[];
  currentUserId: number;
  can: UserAbilities;
}) {
  const router = useRouter();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (status && u.status !== status) return false;
      if (!q) return true;
      return [u.user_code, u.email, u.name, ...u.role_names]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [users, query, status]);

  const onToggle = async () => {
    if (!pending) return;
    const next = pending.status === "Active" ? "Inactive" : "Active";
    setBusy(true);
    const result = await setUserStatusAction(pending.id, next);
    setBusy(false);

    if (result.ok) {
      toast(
        "Status diperbarui",
        `${pending.name} sekarang ${next === "Active" ? "aktif" : "nonaktif"}.`,
        "ok"
      );
      setPending(null);
      router.refresh();
    } else {
      toast("Tidak diizinkan", firstError(result.errors), "err");
      setPending(null);
    }
  };

  const toggleAllowed = (u: UserRow) =>
    u.status === "Active" ? can.deactivate : can.activate;

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Pengaturan</span>
          <span>/</span>
          <span className="cur">User</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="user" size={16} />
            </span>
            User
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/settings/user/new">
                <Icon name="plus" size={15} /> Tambah User
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Akun yang dapat masuk ke aplikasi. Akses setiap user ditentukan oleh Role
          yang diberikan kepadanya — bukan oleh akun itu sendiri.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Cari nama, email, atau Role…"
          />

          <Select
            variant="compact"
            value={status}
            set={Boolean(status)}
            onChange={setStatus}
            ariaLabel="Filter status"
            options={[
              { value: "", label: "Semua status" },
              { value: "Active", label: "Aktif" },
              { value: "Inactive", label: "Non Aktif" },
            ]}
          />

          <div className="tspace" />
          <span className="count">
            <b>{filtered.length}</b> dari {users.length} user
          </span>
        </div>

        {filtered.length ? (
          <div className="tw">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 38 }}>No</th>
                  <th style={{ width: 120 }}>Kode</th>
                  <th>Nama</th>
                  <th style={{ width: 230 }}>Email</th>
                  <th style={{ width: 210 }}>Role</th>
                  <th style={{ width: 112 }}>Status</th>
                  <th style={{ width: 88 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, i) => (
                  <tr key={u.id} onClick={() => router.push(`/settings/user/${u.id}`)}>
                    <td className="no">{i + 1}</td>
                    <td className="mut mono">{u.user_code}</td>
                    <td className="pri">
                      <span className="idc">
                        <span className="lab">{u.initials}</span>
                        <span className="nm">{u.name}</span>
                      </span>
                      {u.id === currentUserId && (
                        <span className="bdg t-info" style={{ marginLeft: 6 }}>
                          Anda
                        </span>
                      )}
                    </td>
                    <td className="mut">{u.email}</td>
                    <td>
                      {u.role_names.length ? (
                        <span className="rchips">
                          {u.role_names.map((r) => (
                            <span className="bdg t-slate" key={r}>
                              {r}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="bdg s-mute">Tanpa Role</span>
                      )}
                    </td>
                    <td>
                      <span className={`bdg ${STATUS_CLASS[u.status] ?? "s-mute"}`}>
                        {STATUS_TEXT[u.status] ?? u.status}
                      </span>
                    </td>
                    <td className="acts">
                      <span className="ract">
                        <button
                          className="iact"
                          title="Lihat detail"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/settings/user/${u.id}`);
                          }}
                        >
                          <Icon name="eye" size={15} />
                        </button>
                        {can.edit && (
                          <button
                            className="iact"
                            title="Ubah"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/settings/user/${u.id}/edit`);
                            }}
                          >
                            <Icon name="pen" size={15} />
                          </button>
                        )}
                        {toggleAllowed(u) && u.id !== currentUserId && (
                          <button
                            className="iact"
                            title={u.status === "Active" ? "Nonaktifkan" : "Aktifkan"}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPending(u);
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
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name="srch" size={20} />
            </div>
            <h4>Tidak ada user yang cocok</h4>
            <p>Ubah kata kunci atau bersihkan filter status.</p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pending)}
        icon={pending?.status === "Active" ? "warn" : "check"}
        tone={pending?.status === "Active" ? "danger" : "ok"}
        title={`Konfirmasi ${pending?.status === "Active" ? "Nonaktifkan" : "Aktifkan"} User`}
        subject={pending ? `${pending.initials} – ${pending.name}` : undefined}
        body={
          pending?.status === "Active"
            ? "User tidak akan bisa masuk lagi dan seluruh sesi aktifnya langsung diakhiri. Akun beserta seluruh history-nya tetap tersimpan."
            : "User akan kembali dapat masuk dengan password yang sama dan Role yang sudah melekat padanya."
        }
        confirmLabel={`Ya, ${pending?.status === "Active" ? "Nonaktifkan" : "Aktifkan"}`}
        confirmTone={pending?.status === "Active" ? "solid-danger" : "primary"}
        busy={busy}
        onConfirm={onToggle}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

export function firstError(errors: Record<string, string>): string {
  return errors._form ?? Object.values(errors)[0] ?? "Tindakan ditolak.";
}
