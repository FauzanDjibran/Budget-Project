"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/ui/toast";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { changePasswordAction, updateProfileAction } from "@/app/actions/profile";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import { MODULE_LABELS, MODULE_ORDER, type PermissionModule } from "@/lib/siba/permissions";
import type { ProfileView as Profile } from "@/lib/siba/profile";

/**
 * "Profil Saya" — what a user can see and change about their own account.
 *
 * The access summary is read-only by construction: there is no control here
 * that writes a role or a permission, and the actions this page calls cannot
 * change access even if one were added.
 */
export function ProfileView({ profile }: { profile: Profile }) {
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState(profile.name);
  const [initials, setInitials] = useState(profile.initials);
  const [identityErrors, setIdentityErrors] = useState<Record<string, string>>({});
  const [savingIdentity, setSavingIdentity] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [savingPw, setSavingPw] = useState(false);

  const byModule = MODULE_ORDER.map((m) => ({
    module: m as PermissionModule,
    items: profile.permissions.filter((p) => p.module === m),
  })).filter((g) => g.items.length);

  const onSaveIdentity = async () => {
    setSavingIdentity(true);
    setIdentityErrors({});
    const result = await updateProfileAction({ name, initials });
    setSavingIdentity(false);
    if (result.ok) {
      toast("Profil diperbarui", "Nama dan inisial Anda sudah tersimpan.", "ok");
      router.refresh();
    } else {
      setIdentityErrors(result.errors);
      toast("Belum bisa disimpan", "Periksa kembali isian Anda.", "err");
    }
  };

  const onChangePassword = async () => {
    setSavingPw(true);
    setPwErrors({});
    const result = await changePasswordAction({ current, next, confirm });
    setSavingPw(false);
    if (result.ok) {
      setCurrent("");
      setNext("");
      setConfirm("");
      toast(
        "Password diubah",
        "Sesi Anda di perangkat lain telah diakhiri. Perangkat ini tetap masuk.",
        "ok"
      );
      router.refresh();
    } else {
      setPwErrors(result.errors);
      toast("Password tidak diubah", "Periksa kembali isian Anda.", "err");
    }
  };

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Pengaturan</span>
          <span>/</span>
          <span className="cur">Profil Saya</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="user" size={16} />
            </span>
            {profile.name}
            <span className="lab lg">{profile.initials}</span>
            <span className="docno sm">{profile.user_code}</span>
            <span className={`bdg ${STATUS_CLASS[profile.status] ?? "s-mute"}`}>
              {STATUS_TEXT[profile.status] ?? profile.status}
            </span>
          </h1>
        </div>
      </div>

      <div className="fgrid solo">
        <div>
          <div className="card">
            <FormBody>
            <FormSection title="Identitas">
              <FormRow>
                <Field label="Email" span={4} help="hanya administrator yang dapat mengubahnya">
                  <div className="ro">{profile.email}</div>
                </Field>

                <Field label="Nama" span={4} required error={identityErrors.name}>
                  <input
                    className={`inp${identityErrors.name ? " bad" : ""}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="off"
                  />
                </Field>

                <Field label="Inisial" span={4} required error={identityErrors.initials}>
                  <input
                    className={`inp idf${identityErrors.initials ? " bad" : ""}`}
                    value={initials}
                    onChange={(e) => setInitials(e.target.value)}
                    maxLength={3}
                    autoComplete="off"
                  />
                </Field>

                {/* Role is read-only here by design: nothing reachable from the
                    profile can change access (CLAUDE.md §11). It used to sit in
                    the summary card. */}
                <Field label="Role" span={12} help="diberikan administrator">
                  <div className="ro">
                    {profile.roles.length ? (
                      <span className="rchips">
                        {profile.roles.map((r) => (
                          <span className="bdg t-slate" key={r.label}>
                            {r.name}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="bdg s-mute">Tanpa Role</span>
                    )}
                  </div>
                </Field>

                <div className="fld full">
                  <button
                    className="btn primary"
                    onClick={onSaveIdentity}
                    disabled={savingIdentity}
                  >
                    <Icon name="save" size={15} />
                    {savingIdentity ? "Menyimpan…" : "Simpan Identitas"}
                  </button>
                </div>
              </FormRow>
            </FormSection>

            <FormSection
              title="Ubah Password"
              hint="Mengubah password mengakhiri sesi Anda di perangkat lain"
            >
              <FormRow>
                <Field label="Password Saat Ini" span={4} required error={pwErrors.current}>
                  <input
                    className={`inp${pwErrors.current ? " bad" : ""}`}
                    type="password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    autoComplete="current-password"
                  />
                </Field>

                <Field
                  label="Password Baru"
                  span={4}
                  required
                  help="minimal 8 karakter"
                  error={pwErrors.next}
                >
                  <input
                    className={`inp${pwErrors.next ? " bad" : ""}`}
                    type="password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    autoComplete="new-password"
                  />
                </Field>

                <Field
                  label="Konfirmasi Password Baru"
                  span={4}
                  required
                  error={pwErrors.confirm}
                >
                  <input
                    className={`inp${pwErrors.confirm ? " bad" : ""}`}
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                  />
                </Field>

                <div className="fld full">
                  <button
                    className="btn primary"
                    onClick={onChangePassword}
                    disabled={savingPw}
                  >
                    <Icon name="lock" size={15} />
                    {savingPw ? "Mengubah…" : "Ubah Password"}
                  </button>
                </div>
              </FormRow>
            </FormSection>
            </FormBody>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="ci">
                <Icon name="tags" size={15} />
              </span>
              <div className="ct">
                <h3>Akses Anda</h3>
                <p>
                  {profile.permissions.length} permission, berasal dari Role yang
                  diberikan administrator
                </p>
              </div>
            </div>

            {byModule.length ? (
              byModule.map((g) => (
                <div className="pmod" key={g.module}>
                  <div className="pmod-h">
                    <span className="mt">{MODULE_LABELS[g.module]}</span>
                    <span className="mc">{g.items.length}</span>
                  </div>
                  <div className="pgrid">
                    {g.items.map((p) => (
                      <div className="pitem view" key={p.code}>
                        <Icon name="check" size={14} className="pok" />
                        <span>
                          <span className="pn">{p.name}</span>
                          <span className="pc">{p.code}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty sm">
                <div className="ic">
                  <Icon name="lock" size={20} />
                </div>
                <h4>Belum ada akses</h4>
                <p>
                  {profile.roles.length
                    ? "Role yang Anda pegang belum berisi permission apa pun. Hubungi administrator untuk mendapatkan akses."
                    : "Akun Anda belum memegang Role apa pun. Hubungi administrator untuk mendapatkan akses."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
