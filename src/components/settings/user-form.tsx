"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  createUserAction,
  resetUserPasswordAction,
  setUserRolesAction,
  setUserStatusAction,
  updateUserAction,
} from "@/app/actions/users";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import { formatTimestamp } from "@/lib/format";
import type { UserRow } from "@/lib/siba/user-admin";
import { firstError } from "./user-list";

export type AssignableRole = {
  id: number;
  label: string;
  name: string;
  status: string;
};

export type UserFormAbilities = {
  edit: boolean;
  assignRoles: boolean;
  resetPassword: boolean;
  activate: boolean;
  deactivate: boolean;
};

/**
 * Create, view and edit one user.
 *
 * Identity, role assignment and password are three separate submissions,
 * because they are three separate permissions on the server. A user who may
 * edit names but not grant access simply never sees the role section — and
 * would be refused by `setUserRoles` if they called it anyway.
 */
export function UserForm({
  mode,
  user,
  roles,
  assignedRoleIds,
  isSelf,
  can,
}: {
  mode: "new" | "view" | "edit";
  user: UserRow | null;
  roles: AssignableRole[];
  assignedRoleIds: number[];
  isSelf: boolean;
  can: UserFormAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";

  const [values, setValues] = useState({
    email: user?.email ?? "",
    name: user?.name ?? "",
    initials: user?.initials ?? "",
    password: "",
  });
  const [roleIds, setRoleIds] = useState<number[]>(assignedRoleIds);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof values, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  const toggleRole = (id: number) => {
    setRoleIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    setErrors({});

    if (mode === "new") {
      const result = await createUserAction({ ...values, roleIds });
      setSaving(false);
      if (!result.ok) {
        setErrors(result.errors);
        toast("Belum bisa disimpan", firstError(result.errors), "err");
        return;
      }
      setDirty(false);
      toast("User dibuat", `${values.name} sekarang dapat masuk ke aplikasi.`, "ok");
      router.push(`/settings/user/${result.id}`);
      router.refresh();
      return;
    }

    const identity = await updateUserAction(user!.id, values);
    if (!identity.ok) {
      setSaving(false);
      setErrors(identity.errors);
      toast("Belum bisa disimpan", firstError(identity.errors), "err");
      return;
    }

    // Roles are a second, separately permitted submission. It is skipped
    // entirely when the caller cannot grant access or nothing changed.
    if (can.assignRoles && !sameSet(roleIds, assignedRoleIds)) {
      const access = await setUserRolesAction(user!.id, roleIds);
      if (!access.ok) {
        setSaving(false);
        setErrors(access.errors);
        toast("Role tidak diubah", firstError(access.errors), "err");
        return;
      }
    }

    setSaving(false);
    setDirty(false);
    toast("Perubahan tersimpan", "Data user berhasil diperbarui.", "ok");
    router.push(`/settings/user/${user!.id}`);
    router.refresh();
  };

  const onReset = async () => {
    setBusy(true);
    const result = await resetUserPasswordAction(user!.id, newPassword);
    setBusy(false);
    if (result.ok) {
      toast(
        "Password diatur ulang",
        "Seluruh sesi aktif user ini telah diakhiri. Sampaikan password baru melalui jalur yang aman.",
        "ok"
      );
      setResetOpen(false);
      setNewPassword("");
    } else {
      toast("Gagal", firstError(result.errors), "err");
    }
  };

  const onToggleStatus = async () => {
    const next = user!.status === "Active" ? "Inactive" : "Active";
    setBusy(true);
    const result = await setUserStatusAction(user!.id, next);
    setBusy(false);
    setStatusOpen(false);
    if (result.ok) {
      toast("Status diperbarui", `${user!.name} sekarang ${next === "Active" ? "aktif" : "nonaktif"}.`, "ok");
      router.refresh();
    } else {
      toast("Tidak diizinkan", firstError(result.errors), "err");
    }
  };

  const title = mode === "new" ? "Tambah User" : (user?.name ?? "");
  const status = user?.status ?? "";
  const canToggle = user && (user.status === "Active" ? can.deactivate : can.activate);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Pengaturan</span>
          <span>/</span>
          <Link href="/settings/user">User</Link>
          <span>/</span>
          <span className="cur">{mode === "new" ? "Baru" : (user?.initials ?? "")}</span>
        </div>

        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="user" size={16} />
            </span>
            {title}
            {mode !== "new" && <span className="lab lg">{user?.initials}</span>}
            {mode === "view" && status && (
              <span className={`bdg ${STATUS_CLASS[status] ?? "s-mute"}`}>
                {STATUS_TEXT[status] ?? status}
              </span>
            )}
            {mode === "edit" && <span className="bdg t-warn">Mode Ubah</span>}
          </h1>

          <div className="ph-act">
            {editing ? (
              <>
                <Link
                  className="btn"
                  href={mode === "new" ? "/settings/user" : `/settings/user/${user!.id}`}
                >
                  Batal
                </Link>
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </>
            ) : (
              <>
                {can.resetPassword && !isSelf && (
                  <button className="btn" onClick={() => setResetOpen(true)}>
                    <Icon name="lock" size={15} /> Reset Password
                  </button>
                )}
                {canToggle && !isSelf && (
                  <button className="btn" onClick={() => setStatusOpen(true)}>
                    <Icon name="gear" size={15} />
                    {user!.status === "Active" ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                )}
                {can.edit && (
                  <Link className="btn primary" href={`/settings/user/${user!.id}/edit`}>
                    <Icon name="pen" size={15} /> Ubah
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Akses user berasal sepenuhnya dari Role yang melekat padanya. Tidak ada
          permission yang diberikan langsung ke satu akun.
        </p>
      </div>

      <div className="fgrid">
        <div>
          <div className="card">
            <div className="fsec">
              <div className="sec-t">Identitas</div>
              <div className="frow">
                <Field label="Email" required={editing} error={errors.email} help={editing ? "Dipakai sebagai identitas masuk." : undefined}>
                  {editing ? (
                    <input
                      className={`inp${errors.email ? " bad" : ""}`}
                      type="email"
                      value={values.email}
                      onChange={(e) => set("email", e.target.value)}
                      placeholder="nama@siba.app"
                      autoComplete="off"
                    />
                  ) : (
                    <div className="ro">{user?.email}</div>
                  )}
                </Field>

                <Field label="Nama" required={editing} error={errors.name}>
                  {editing ? (
                    <input
                      className={`inp${errors.name ? " bad" : ""}`}
                      value={values.name}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="Nama lengkap"
                      autoComplete="off"
                    />
                  ) : (
                    <div className="ro">{user?.name}</div>
                  )}
                </Field>

                <Field label="Inisial" required={editing} error={errors.initials} help={editing ? "Maksimal 3 karakter, tampil pada avatar." : undefined}>
                  {editing ? (
                    <input
                      className={`inp idf${errors.initials ? " bad" : ""}`}
                      value={values.initials}
                      onChange={(e) => set("initials", e.target.value)}
                      placeholder="MH"
                      maxLength={3}
                      autoComplete="off"
                    />
                  ) : (
                    <div className="ro">
                      <span className="lab">{user?.initials}</span>
                    </div>
                  )}
                </Field>

                {mode === "new" && (
                  <Field
                    label="Password Awal"
                    required
                    error={errors.password}
                    help="Minimal 8 karakter. Sampaikan kepada user melalui jalur yang aman."
                  >
                    <input
                      className={`inp${errors.password ? " bad" : ""}`}
                      type="password"
                      value={values.password}
                      onChange={(e) => set("password", e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                )}
              </div>
            </div>

            {/* Role assignment is its own permission, so it is its own section. */}
            {(can.assignRoles || mode === "view") && (
              <div className="fsec">
                <div className="sec-t">
                  Role
                  <span className="h">
                    Satu-satunya jalur pemberian akses
                  </span>
                </div>
                <div className="frow">
                  <div className="fld full">
                    {errors._form && (
                      <div className="err" style={{ marginBottom: 8 }}>
                        <Icon name="warn" size={11} />
                        {errors._form}
                      </div>
                    )}

                    {isSelf && editing && can.assignRoles && (
                      <p className="help" style={{ marginBottom: 8 }}>
                        Anda tidak dapat mengubah Role akun Anda sendiri. Minta
                        administrator lain melakukannya.
                      </p>
                    )}

                    {editing && can.assignRoles && !isSelf ? (
                      <div className="pgrid" style={{ padding: 0 }}>
                        {roles.map((r) => (
                          <label className="pitem" key={r.id}>
                            <input
                              type="checkbox"
                              checked={roleIds.includes(r.id)}
                              onChange={() => toggleRole(r.id)}
                            />
                            <span>
                              <span className="pn">{r.name}</span>
                              <span className="pc">{r.label}</span>
                              {r.status !== "Active" && (
                                <span className="pd">
                                  Role nonaktif — tidak memberi akses apa pun
                                  selama nonaktif.
                                </span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="ro">
                        {(user?.role_names.length ?? 0) > 0 ? (
                          <span className="rchips">
                            {user!.role_names.map((r) => (
                              <span className="bdg t-slate" key={r}>
                                {r}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="bdg s-mute">Tanpa Role</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {editing && dirty && (
              <div className="dirty">
                <span className="msg">
                  <span className="pulse" />
                  Ada perubahan yang belum disimpan
                </span>
                <Link
                  className="btn sm"
                  href={mode === "new" ? "/settings/user" : `/settings/user/${user!.id}`}
                >
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
                      <span className="k">Kode</span>
                      <span className="v">
                        <span className="dash">dibuat otomatis</span>
                      </span>
                    </div>
                    <div className="mrow">
                      <span className="k">Status</span>
                      <span className="v">Aktif setelah disimpan</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mrow">
                      <span className="k">Kode</span>
                      <span className="v mono">{user?.user_code}</span>
                    </div>
                    <div className="mrow">
                      <span className="k">Status</span>
                      <span className="v">
                        <span className={`bdg ${STATUS_CLASS[status] ?? "s-mute"}`}>
                          {STATUS_TEXT[status] ?? status}
                        </span>
                      </span>
                    </div>
                    <div className="mrow">
                      <span className="k">Dibuat</span>
                      <span className="v">{formatTimestamp(user?.created_at)}</span>
                    </div>
                    <div className="mrow">
                      <span className="k">Diubah</span>
                      <span className="v">
                        {user?.updated_by ? (
                          formatTimestamp(user?.updated_at)
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

      <ConfirmDialog
        open={resetOpen}
        icon="lock"
        tone="danger"
        title="Reset Password User"
        subject={user ? `${user.initials} – ${user.name}` : undefined}
        body="Password lama akan langsung tidak berlaku dan seluruh sesi aktif user ini diakhiri. User harus masuk kembali dengan password baru."
        confirmLabel="Ya, Reset Password"
        confirmTone="solid-danger"
        busy={busy}
        onConfirm={onReset}
        onCancel={() => {
          setResetOpen(false);
          setNewPassword("");
        }}
      >
        <div className="fld full">
          <label>Password Baru</label>
          <input
            className="inp"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Minimal 8 karakter"
            autoComplete="new-password"
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={statusOpen}
        icon={status === "Active" ? "warn" : "check"}
        tone={status === "Active" ? "danger" : "ok"}
        title={`Konfirmasi ${status === "Active" ? "Nonaktifkan" : "Aktifkan"} User`}
        subject={user ? `${user.initials} – ${user.name}` : undefined}
        body={
          status === "Active"
            ? "User tidak akan bisa masuk lagi dan seluruh sesi aktifnya langsung diakhiri. Akun beserta seluruh history-nya tetap tersimpan."
            : "User akan kembali dapat masuk dengan password yang sama dan Role yang sudah melekat padanya."
        }
        confirmLabel={`Ya, ${status === "Active" ? "Nonaktifkan" : "Aktifkan"}`}
        confirmTone={status === "Active" ? "solid-danger" : "primary"}
        busy={busy}
        onConfirm={onToggleStatus}
        onCancel={() => setStatusOpen(false)}
      />
    </>
  );
}

function Field({
  label,
  required,
  error,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fld">
      <label>
        {label}
        {required && <span className="req">*</span>}
      </label>
      {children}
      {error ? (
        <div className="err">
          <Icon name="warn" size={11} />
          {error}
        </div>
      ) : help ? (
        <div className="help">{help}</div>
      ) : null}
    </div>
  );
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((x) => set.has(x));
}
