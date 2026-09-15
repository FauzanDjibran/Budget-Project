"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  createRoleAction,
  setRolePermissionsAction,
  setRoleStatusAction,
  updateRoleAction,
} from "@/app/actions/users";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import {
  MODULE_LABELS,
  MODULE_ORDER,
  type PermissionDef,
  type PermissionModule,
} from "@/lib/siba/permissions";
import type { RoleRow } from "@/lib/siba/user-admin";
import { firstError } from "./user-list";

export type RoleFormAbilities = {
  edit: boolean;
  managePermissions: boolean;
  activate: boolean;
  deactivate: boolean;
};

/**
 * Create, view and edit one role, including its permission matrix.
 *
 * The matrix is grouped by module and lists every permission in the catalogue,
 * so what a role does NOT grant is as visible as what it does. Codes are shown
 * next to names because the codes are what the server enforces.
 */
export function RoleForm({
  mode,
  role,
  catalogue,
  frozen,
  frozenReason,
  can,
}: {
  mode: "new" | "view" | "edit";
  role: RoleRow | null;
  catalogue: Record<PermissionModule, PermissionDef[]>;
  /** ADMIN's matrix cannot be edited — see `lib/siba/roles.ts`. */
  frozen: boolean;
  frozenReason?: string;
  can: RoleFormAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode === "new" || mode === "edit";

  const [values, setValues] = useState({
    role_label: role?.role_label ?? "",
    role_name: role?.role_name ?? "",
    note: role?.note ?? "",
  });
  const [codes, setCodes] = useState<string[]>(role?.permission_codes ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const held = new Set(codes);
  const matrixEditable = editing && can.managePermissions && !frozen;

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

  const toggle = (code: string) => {
    setCodes((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]));
    setDirty(true);
  };

  const toggleModule = (module: PermissionModule, on: boolean) => {
    const moduleCodes = catalogue[module].map((p) => p.code);
    setCodes((c) =>
      on
        ? Array.from(new Set([...c, ...moduleCodes]))
        : c.filter((x) => !moduleCodes.includes(x))
    );
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    setErrors({});

    if (mode === "new") {
      const result = await createRoleAction(values);
      if (!result.ok) {
        setSaving(false);
        setErrors(result.errors);
        toast("Belum bisa disimpan", firstError(result.errors), "err");
        return;
      }
      // A brand-new role starts empty; its matrix is a second submission,
      // gated by its own permission.
      if (can.managePermissions && codes.length) {
        const perms = await setRolePermissionsAction(result.id, codes);
        if (!perms.ok) {
          setSaving(false);
          toast("Role dibuat tanpa permission", firstError(perms.errors), "err");
          router.push(`/settings/role/${result.id}`);
          router.refresh();
          return;
        }
      }
      setSaving(false);
      setDirty(false);
      toast("Role dibuat", `${values.role_name} siap diberikan kepada user.`, "ok");
      router.push(`/settings/role/${result.id}`);
      router.refresh();
      return;
    }

    const identity = await updateRoleAction(role!.id, values);
    if (!identity.ok) {
      setSaving(false);
      setErrors(identity.errors);
      toast("Belum bisa disimpan", firstError(identity.errors), "err");
      return;
    }

    if (matrixEditable && !sameSet(codes, role!.permission_codes)) {
      const perms = await setRolePermissionsAction(role!.id, codes);
      if (!perms.ok) {
        setSaving(false);
        setErrors(perms.errors);
        toast("Permission tidak diubah", firstError(perms.errors), "err");
        return;
      }
    }

    setSaving(false);
    setDirty(false);
    toast("Perubahan tersimpan", "Role berhasil diperbarui.", "ok");
    router.push(`/settings/role/${role!.id}`);
    router.refresh();
  };

  const onToggleStatus = async () => {
    const next = role!.status === "Active" ? "Inactive" : "Active";
    setBusy(true);
    const result = await setRoleStatusAction(role!.id, next);
    setBusy(false);
    setStatusOpen(false);
    if (result.ok) {
      toast("Status diperbarui", `${role!.role_name} sekarang ${next === "Active" ? "aktif" : "nonaktif"}.`, "ok");
      router.refresh();
    } else {
      toast("Tidak diizinkan", firstError(result.errors), "err");
    }
  };

  const status = role?.status ?? "";
  const canToggle = role && !role.is_system && (status === "Active" ? can.deactivate : can.activate);
  const total = MODULE_ORDER.reduce((n, m) => n + catalogue[m].length, 0);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Pengaturan</span>
          <span>/</span>
          <Link href="/settings/role">Role</Link>
          <span>/</span>
          <span className="cur">{mode === "new" ? "Baru" : (role?.role_label ?? "")}</span>
        </div>

        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="tags" size={16} />
            </span>
            {mode === "new" ? "Tambah Role" : role?.role_name}
            {mode !== "new" && <span className="lab lg">{role?.role_label}</span>}
            {mode === "view" && status && (
              <span className={`bdg ${STATUS_CLASS[status] ?? "s-mute"}`}>
                {STATUS_TEXT[status] ?? status}
              </span>
            )}
            {frozen && (
              <span className="bdg s-mute" title={frozenReason}>
                <Icon name="lock" size={11} /> Terkunci
              </span>
            )}
            {mode === "edit" && <span className="bdg t-warn">Mode Ubah</span>}
          </h1>

          <div className="ph-act">
            {editing && dirty && (
              <span className="ph-dirty">
                <span className="pulse" /> Belum disimpan
              </span>
            )}
            {editing ? (
              <>
                <Link
                  className="btn"
                  href={mode === "new" ? "/settings/role" : `/settings/role/${role!.id}`}
                >
                  Batal
                </Link>
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </>
            ) : (
              <>
                {canToggle && (
                  <button className="btn" onClick={() => setStatusOpen(true)}>
                    <Icon name="gear" size={15} />
                    {status === "Active" ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                )}
                {can.edit && (
                  <Link className="btn primary" href={`/settings/role/${role!.id}/edit`}>
                    <Icon name="pen" size={15} /> Ubah
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
        <p className="ph-sub">
          {frozen
            ? frozenReason
            : "Akses menu dan aksi adalah permission terpisah: melihat sebuah modul bukan izin untuk menambah, menyetujui, atau mem-posting di dalamnya."}
        </p>
      </div>

      <div className="card">
        <div className="fsec">
          <div className="sec-t">Identitas Role</div>
          <div className="frow">
            <div className="fld">
              <label>
                Label
                {editing && <span className="req">*</span>}
                {role?.is_system && editing && <span className="lockb">Terkunci</span>}
              </label>
              {editing ? (
                <input
                  className={`inp idf${errors.role_label ? " bad" : ""}`}
                  value={values.role_label}
                  onChange={(e) => set("role_label", e.target.value.toUpperCase())}
                  placeholder="APPROVER"
                  disabled={role?.is_system}
                  autoComplete="off"
                />
              ) : (
                <div className="ro">
                  <span className="lab">{role?.role_label}</span>
                </div>
              )}
              {errors.role_label ? (
                <div className="err">
                  <Icon name="warn" size={11} />
                  {errors.role_label}
                </div>
              ) : editing ? (
                <div className="help">
                  Huruf kapital, angka, dan garis bawah. Dipakai sebagai kunci di kode,
                  jadi tidak berubah mengikuti nama tampilan.
                </div>
              ) : null}
            </div>

            <div className="fld">
              <label>
                Nama Role
                {editing && <span className="req">*</span>}
              </label>
              {editing ? (
                <input
                  className={`inp${errors.role_name ? " bad" : ""}`}
                  value={values.role_name}
                  onChange={(e) => set("role_name", e.target.value)}
                  placeholder="Penyetuju Budget"
                  autoComplete="off"
                />
              ) : (
                <div className="ro">{role?.role_name}</div>
              )}
              {errors.role_name && (
                <div className="err">
                  <Icon name="warn" size={11} />
                  {errors.role_name}
                </div>
              )}
            </div>

            <div className="fld full">
              <label>Catatan</label>
              {editing ? (
                <textarea
                  className="ta"
                  value={values.note ?? ""}
                  onChange={(e) => set("note", e.target.value)}
                  placeholder="Untuk siapa Role ini dan mengapa…"
                />
              ) : role?.note ? (
                <div className="ro multi">{role.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </div>
          </div>
        </div>

        <div className="fsec">
          <div className="sec-t">
            Permission
            <span className="h">
              {codes.length} dari {total} permission aktif
            </span>
          </div>

          {errors._form && (
            <div className="frow" style={{ paddingBottom: 0 }}>
              <div className="fld full">
                <div className="err">
                  <Icon name="warn" size={11} />
                  {errors._form}
                </div>
              </div>
            </div>
          )}

          {frozen && (
            <div className="frow" style={{ paddingBottom: 0 }}>
              <div className="fld full">
                <div className="help">{frozenReason}</div>
              </div>
            </div>
          )}

          {MODULE_ORDER.map((module) => {
            const defs = catalogue[module];
            if (!defs.length) return null;
            const on = defs.filter((d) => held.has(d.code)).length;

            return (
              <div className="pmod" key={module}>
                <div className="pmod-h">
                  <span className="mt">{MODULE_LABELS[module]}</span>
                  <span className="mc">
                    {on}/{defs.length}
                  </span>
                  {matrixEditable && (
                    <span className="ma">
                      <button
                        className="btn sm ghost"
                        onClick={() => toggleModule(module, true)}
                        type="button"
                      >
                        Pilih semua
                      </button>
                      <button
                        className="btn sm ghost"
                        onClick={() => toggleModule(module, false)}
                        type="button"
                      >
                        Kosongkan
                      </button>
                    </span>
                  )}
                </div>

                <div className="pgrid">
                  {defs.map((p) => {
                    const active = held.has(p.code);
                    const body = (
                      <span>
                        <span className="pn">{p.name}</span>
                        <span className="pc">{p.code}</span>
                        {p.description && <span className="pd">{p.description}</span>}
                      </span>
                    );

                    return matrixEditable ? (
                      <label className="pitem" key={p.code}>
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => toggle(p.code)}
                        />
                        {body}
                      </label>
                    ) : (
                      <div className={`pitem view${active ? "" : " off"}`} key={p.code}>
                        <Icon
                          name={active ? "check" : "block"}
                          size={14}
                          className={active ? "pok" : "pno"}
                        />
                        {body}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={statusOpen}
        icon={status === "Active" ? "warn" : "check"}
        tone={status === "Active" ? "danger" : "ok"}
        title={`Konfirmasi ${status === "Active" ? "Nonaktifkan" : "Aktifkan"} Role`}
        subject={role ? `${role.role_label} – ${role.role_name}` : undefined}
        body={
          status === "Active"
            ? `Role nonaktif tidak memberi akses apa pun. ${role?.user_count ?? 0} user yang memegangnya akan kehilangan permission dari Role ini pada permintaan berikutnya, tanpa satu pun penugasan dihapus.`
            : "Role kembali memberi permission-nya kepada seluruh user yang memegangnya."
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

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((x) => set.has(x));
}
